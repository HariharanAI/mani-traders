/**
 * End-to-end smoke test through the real UI.
 *
 *   BASE_URL=http://localhost:3000 CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" \
 *   OUT_DIR=./e2e-out node tests/e2e/smoke.mjs
 *
 * Requires a FRESH database (it performs first-run setup).
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? "./e2e-out";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    results.push(`✔ ${name} (${Date.now() - t}ms)`);
  } catch (e) {
    results.push(`✘ ${name}: ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: path.join(OUT, `FAIL-${name.replace(/\W+/g, "_")}.png`), fullPage: true }).catch(() => {});
    throw e;
  }
};
const shot = (name, full = true) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
const expectText = async (text, timeout = 15000) => page.getByText(text, { exact: false }).first().waitFor({ timeout });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "en-IN", timezoneId: "Asia/Kolkata" });
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !/favicon|Download the React DevTools|caret-color/.test(m.text()) && errors.push(`console: ${m.text().slice(0, /hydrat/i.test(m.text()) ? 3000 : 300)}`));

const dialog = () => page.getByRole("dialog");
let customerUrl = "";

try {
  await step("first-run setup creates owner", async () => {
    await page.goto(`${BASE}/login`);
    await page.waitForURL(/\/setup/);
    await shot("01-setup");
    await page.getByLabel("Your name").fill("Mani Owner");
    await page.getByLabel("Email (used to sign in)").fill("owner@manitraders.in");
    await page.getByLabel("Password", { exact: true }).fill("Mani2026secure");
    await page.getByLabel("Confirm password").fill("Mani2026secure");
    await page.getByRole("button", { name: "Create owner account" }).click();
    await page.waitForURL(/\/settings/);
  });

  await step("business settings: Tamil Nadu + GST regular", async () => {
    await page.getByLabel("Address line 1").fill("12, Bazaar Street");
    await page.getByLabel("City").fill("Madurai");
    await page.getByLabel("State").selectOption("33");
    await page.getByLabel("Phone").fill("9876500000");
    await page.getByRole("button", { name: "GST & tax" }).click();
    await page.getByRole("switch").first().click();
    await page.getByLabel("GSTIN").fill("33AAAAA0000A1Z5");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expectText("Settings saved");
    await shot("02-settings-gst");
  });

  await step("add product with opening stock", async () => {
    await page.goto(`${BASE}/inventory`);
    await expectText("No products yet");
    await page.getByRole("button", { name: "Add product" }).first().click();
    await dialog().getByLabel("Product name").fill("Rice 25kg");
    await dialog().getByLabel("Unit").selectOption("bag");
    await dialog().getByLabel("Purchase price").fill("1000");
    await dialog().getByLabel("Selling price").fill("1300");
    await dialog().getByLabel("GST rate").selectOption("5");
    await dialog().getByLabel("Low-stock alert at").fill("2");
    await dialog().getByLabel("Opening stock").fill("10");
    await dialog().getByRole("button", { name: "Add product" }).click();
    await expectText("Product added");
    await page.waitForTimeout(500);
    await expectText("Rice 25kg");
    await shot("03-inventory");
  });

  await step("add customer Ravi Kumar", async () => {
    await page.goto(`${BASE}/customers`);
    await page.getByRole("button", { name: "Add customer" }).first().click();
    await dialog().getByLabel("Customer name").fill("Ravi Kumar");
    await dialog().getByLabel("Mobile number").fill("9876543210");
    await dialog().getByRole("button", { name: "Add customer" }).click();
    await page.waitForURL(/\/customers\/[0-9a-f-]{36}/);
    customerUrl = page.url();
    await expectText("No entries yet");
  });

  await step("khata: gave 5,000, got 2,000 (UPI), gave 3,000 → balance 6,000", async () => {
    const entry = async (button, amount, desc, method) => {
      await page.getByRole("button", { name: button }).first().click();
      await dialog().getByLabel("Amount").fill(amount);
      if (method) await dialog().getByRole("button", { name: method, exact: true }).click();
      if (desc) await dialog().getByLabel("Description").fill(desc);
      await dialog().getByRole("button", { name: "Save entry" }).click();
      await dialog().waitFor({ state: "detached" });
      await page.waitForTimeout(600);
    };
    await entry("You gave", "5000", "Goods purchased");
    await entry("You got", "2000", "Part payment", "UPI");
    await entry("You gave", "3000", "Goods purchased");
    await expectText("₹6,000.00");
    await shot("04-customer-khata");
  });

  await step("credit sale with GST and partial payment", async () => {
    await page.goto(`${customerUrl.replace("/customers/", "/sales/new?customer=")}`);
    await page.getByPlaceholder("Search product by name, SKU or scan barcode").fill("Rice");
    await page.keyboard.press("Enter");
    const qty = page.locator('input[inputmode="decimal"].tnum').first();
    await qty.fill("3");
    await expectText("₹4,095.00");
    await page.locator('input[placeholder="0"][inputmode="decimal"]').last().fill("1000");
    await shot("05-new-sale");
    await page.getByRole("button", { name: /Save invoice/ }).click();
    await page.waitForURL(/\/sales\/[0-9a-f-]{36}/);
    await expectText("Invoice saved");
    await expectText("CGST");
    await shot("06-invoice");
  });

  await step("invoice PDF renders", async () => {
    const id = page.url().match(/sales\/([0-9a-f-]{36})/)[1];
    const res = await page.request.get(`${BASE}/api/pdf/invoice/${id}`);
    if (res.status() !== 200 || res.headers()["content-type"] !== "application/pdf") throw new Error(`PDF status ${res.status()}`);
    const buf = await res.body();
    if (buf.subarray(0, 5).toString() !== "%PDF-") throw new Error("Not a PDF");
    fs.writeFileSync(path.join(OUT, "invoice.pdf"), buf);
  });

  await step("customer balance now 6,000 + 4,095 − 1,000 = 9,095", async () => {
    await page.goto(customerUrl);
    await expectText("₹9,095.00");
  });

  await step("stock reduced to 7 bags", async () => {
    await page.goto(`${BASE}/inventory`);
    await page.getByRole("row", { name: /Rice 25kg/ }).getByText("7", { exact: true }).waitFor();
  });

  await step("expense recorded", async () => {
    await page.goto(`${BASE}/expenses`);
    await page.getByRole("button", { name: "Add expense" }).first().click();
    await dialog().getByLabel("Amount").fill("2500");
    await dialog().getByRole("button", { name: "Electricity" }).click();
    await dialog().getByLabel("Paid to").fill("TNEB");
    await dialog().getByRole("button", { name: "Add expense" }).click();
    await expectText("Expense added");
  });

  await step("dashboard shows ledger-derived metrics", async () => {
    await page.goto(`${BASE}/`);
    await expectText("Total receivables");
    await expectText("₹9,095.00");
    await page.waitForTimeout(1200);
    await shot("07-dashboard");
  });

  await step("trial balance & integrity report balanced", async () => {
    await page.goto(`${BASE}/reports/trial-balance`);
    await expectText("Ledger balanced (debits = credits)");
    await expectText("Party ledgers match control accounts");
    await shot("08-trial-balance");
  });

  await step("profit estimate & exports", async () => {
    await page.goto(`${BASE}/reports/profit-estimate`);
    await expectText("Estimated net profit");
    await shot("09-profit");
    for (const fmt of ["csv", "xlsx", "pdf"]) {
      const res = await page.request.get(`${BASE}/api/reports/customer-outstanding?format=${fmt}`);
      if (res.status() !== 200) throw new Error(`${fmt} export status ${res.status()}`);
    }
    const csv = await (await page.request.get(`${BASE}/api/reports/customer-outstanding?format=csv`)).text();
    if (!csv.includes("Ravi Kumar") || !csv.includes("9095.00")) throw new Error("CSV content wrong: " + csv.slice(0, 200));
  });

  await step("global search finds the invoice", async () => {
    await page.goto(`${BASE}/customers`);
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Ravi");
    await expectText("Customer ·");
    await page.keyboard.press("Escape");
  });

  await step("reverse a payment keeps history", async () => {
    await page.goto(`${BASE}/payments`);
    const href = await page.getByRole("link", { name: /RC\/\d\d-\d\d\/0001/ }).getAttribute("href");
    await page.goto(BASE + href, { timeout: 120000 });
    await page.getByRole("button", { name: "Reverse" }).click({ timeout: 90000 });
    await dialog().getByLabel("Reason").fill("UPI payment bounced in bank");
    await dialog().getByRole("button", { name: "Reverse payment" }).click();
    await expectText("Payment reversed");
    await page.goto(customerUrl);
    await expectText("₹11,095.00");
    await expectText("Reversed");
  });

  await step("mobile layout", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(customerUrl);
    await expectText("You gave");
    await shot("10-mobile-customer", false);
    await page.goto(`${BASE}/`);
    await shot("11-mobile-dashboard", false);
    await page.emulateMedia({ colorScheme: "dark" });
    await shot("12-mobile-dashboard-dark", false);
  });

  await step("employee role is restricted", async () => {
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto(`${BASE}/employees`);
    await page.getByRole("button", { name: "Add employee" }).click();
    await dialog().getByLabel("Name").fill("Counter Staff");
    await dialog().getByLabel("Email (sign-in)").fill("staff@manitraders.in");
    await dialog().getByLabel("Initial password (optional)").fill("Staff2026pass");
    await dialog().getByRole("button", { name: "Create account" }).click();
    await expectText("Temporary password");
    const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const p2 = await ctx2.newPage();
    await p2.goto(`${BASE}/login`);
    await p2.getByLabel("Email").fill("staff@manitraders.in");
    await p2.getByLabel("Password").fill("Staff2026pass");
    await p2.getByRole("button", { name: "Sign in" }).click();
    await p2.waitForURL(`${BASE}/`);
    await p2.getByText("Your counter for today").waitFor();
    await p2.goto(`${BASE}/reports`);
    await p2.waitForURL(/forbidden/);
    const res = await p2.request.get(`${BASE}/api/reports/profit-estimate?format=csv`);
    if (res.status() !== 403) throw new Error(`employee report export returned ${res.status()}`);
    await p2.goto(`${BASE}/customers`);
    await p2.getByText("No customers yet").waitFor(); // employee sees only assigned customers
    await p2.screenshot({ path: path.join(OUT, "13-employee-view.png") });
    await ctx2.close();
  });
} catch {
  // reported below
} finally {
  console.log(results.join("\n"));
  if (errors.length) console.log("\nBrowser errors:\n" + [...new Set(errors)].join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("✘")) ? 1 : 0);
}
