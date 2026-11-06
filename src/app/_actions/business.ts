"use server";
/**
 * Server actions for business operations. Every action:
 *  1. authenticates the session and checks permissions (runAction),
 *  2. validates input with Zod inside the service,
 *  3. executes atomically in a DB transaction,
 *  4. revalidates affected pages.
 */
import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import { runAction } from "@/server/auth/session";
import * as parties from "@/server/services/parties";
import * as khata from "@/server/services/khata";
import * as payments from "@/server/services/payments";
import * as inventory from "@/server/services/inventory";
import * as sales from "@/server/services/sales";
import * as purchases from "@/server/services/purchases";
import * as expenses from "@/server/services/expenses";
import * as admin from "@/server/services/admin";
import * as notifications from "@/server/services/notifications";
import { putFile } from "@/server/storage";
import { createBackup } from "@/server/services/jobs";
import { reverseSchema } from "@/lib/validators";
import { AppError } from "@/server/core";
import type { CustomerInput, ExpenseInput, KhataEntryInput, PaymentInput, ProductInput, PurchaseInput, SaleInput, SupplierInput } from "@/lib/validators";
import type { SettingsInput } from "@/server/services/admin";

const refresh = (...paths: string[]) => {
  for (const p of ["/", ...paths]) revalidatePath(p, p === "/" ? "layout" : "page");
};

// ---------------------------------------------------------------- customers
export async function createCustomerAction(input: CustomerInput) {
  return runAction(["customers.manage"], async (a) => {
    const c = await parties.createCustomer(await getDb(), a, input);
    refresh("/customers", "/khata");
    return { id: c.id, name: c.name, mobile: c.mobile };
  });
}
export async function updateCustomerAction(id: string, input: CustomerInput) {
  return runAction(["customers.manage"], async (a) => {
    await parties.updateCustomer(await getDb(), a, id, input);
    refresh("/customers", `/customers/${id}`, "/khata");
  });
}
export async function archiveCustomerAction(id: string, archive: boolean) {
  return runAction(["customers.archive"], async (a) => {
    await parties.archiveCustomer(await getDb(), a, id, archive);
    refresh("/customers", `/customers/${id}`);
  });
}
export async function deleteCustomerAction(id: string) {
  return runAction(["customers.archive"], async (a) => {
    await parties.deleteCustomer(await getDb(), a, id);
    refresh("/customers");
  });
}

// ---------------------------------------------------------------- suppliers
export async function createSupplierAction(input: SupplierInput) {
  return runAction(["suppliers.manage"], async (a) => {
    const s = await parties.createSupplier(await getDb(), a, input);
    refresh("/suppliers");
    return { id: s.id, name: s.name };
  });
}
export async function updateSupplierAction(id: string, input: SupplierInput) {
  return runAction(["suppliers.manage"], async (a) => {
    await parties.updateSupplier(await getDb(), a, id, input);
    refresh("/suppliers", `/suppliers/${id}`);
  });
}
export async function archiveSupplierAction(id: string, archive: boolean) {
  return runAction(["suppliers.manage"], async (a) => {
    await parties.archiveSupplier(await getDb(), a, id, archive);
    refresh("/suppliers", `/suppliers/${id}`);
  });
}

// ---------------------------------------------------------------- khata & payments
export async function addKhataEntryAction(input: KhataEntryInput) {
  return runAction([], async (a) => {
    const r = await khata.addKhataEntry(await getDb(), a, input);
    const base = input.partyType === "CUSTOMER" ? "customers" : "suppliers";
    refresh(`/${base}`, `/${base}/${input.partyId}`, "/khata", "/payments");
    return { duplicate: r.duplicate, txnNo: r.entry.txnNo, paymentId: "payment" in r ? r.payment?.id : undefined };
  });
}
export async function reverseKhataEntryAction(id: string, reason: string, partyPath: string) {
  return runAction([], async (a) => {
    const input = reverseSchema.parse({ id, reason });
    await khata.reverseKhataEntry(await getDb(), a, input.id, input.reason);
    refresh(partyPath, "/khata", "/payments", "/customers", "/suppliers");
  });
}
export async function recordPaymentAction(input: PaymentInput) {
  return runAction([], async (a) => {
    const r = await payments.recordPayment(await getDb(), a, input);
    const base = input.partyType === "CUSTOMER" ? "customers" : "suppliers";
    refresh("/payments", `/${base}`, `/${base}/${input.partyId}`, "/khata", "/sales", "/purchases");
    return { id: r.payment.id, paymentNo: r.payment.paymentNo, duplicate: r.duplicate, balanceAfter: r.payment.balanceAfter };
  });
}
export async function reversePaymentAction(id: string, reason: string) {
  return runAction(["payments.reverse"], async (a) => {
    const input = reverseSchema.parse({ id, reason });
    await payments.reversePayment(await getDb(), a, input.id, input.reason);
    refresh("/payments", `/payments/${id}`, "/customers", "/suppliers", "/khata");
  });
}
export async function openInvoicesAction(customerId: string) {
  return runAction(["payments.receive"], async (a) => {
    const db = await getDb();
    await parties.getCustomerForActor(db, a, customerId);
    return payments.openInvoices(db, customerId);
  });
}
export async function partyBalanceAction(type: "CUSTOMER" | "SUPPLIER", id: string) {
  return runAction([], async (a) => {
    const db = await getDb();
    await parties.assertPartyAccess(db, a, { type, id });
    return (await parties.partySummary(db, { type, id })).balance;
  });
}
export async function searchPartiesAction(type: "CUSTOMER" | "SUPPLIER", q: string) {
  return runAction([], async (a) => {
    const db = await getDb();
    if (type === "CUSTOMER") {
      const r = await parties.listCustomers(db, a, { q, limit: 12, sort: q ? "name" : "recent" });
      return r.rows.map((c) => ({ id: c.id, name: c.name, mobile: c.mobile, balance: c.balance, code: c.code, stateCode: c.stateCode }));
    }
    const r = await parties.listSuppliers(db, a, { q, limit: 12, sort: q ? "name" : "recent" });
    return r.rows.map((c) => ({ id: c.id, name: c.name, mobile: c.mobile, balance: c.balance, code: c.code, stateCode: c.stateCode }));
  });
}

// ---------------------------------------------------------------- inventory
export async function createProductAction(input: ProductInput) {
  return runAction(["inventory.manage"], async (a) => {
    const p = await inventory.createProduct(await getDb(), a, input);
    refresh("/inventory");
    return { id: p.id };
  });
}
export async function updateProductAction(id: string, input: ProductInput) {
  return runAction(["inventory.manage"], async (a) => {
    await inventory.updateProduct(await getDb(), a, id, input);
    refresh("/inventory", `/inventory/${id}`);
  });
}
export async function archiveProductAction(id: string, archive: boolean) {
  return runAction(["inventory.manage"], async (a) => {
    await inventory.archiveProduct(await getDb(), a, id, archive);
    refresh("/inventory", `/inventory/${id}`);
  });
}
export async function adjustStockAction(input: unknown) {
  return runAction(["inventory.adjust"], async (a) => {
    const r = await inventory.adjustStock(await getDb(), a, input);
    refresh("/inventory", `/inventory/${(input as { productId: string }).productId}`);
    return r;
  });
}

// ---------------------------------------------------------------- sales & purchases
export async function createSaleAction(input: SaleInput) {
  return runAction(["sales.create"], async (a) => {
    const r = await sales.createSale(await getDb(), a, input);
    refresh("/sales", "/invoices", "/inventory", "/customers", "/khata", "/payments");
    if (input.customerId) refresh(`/customers/${input.customerId}`);
    return { id: r.sale.id, invoiceNo: r.sale.invoiceNo, duplicate: r.duplicate };
  });
}
export async function cancelSaleAction(input: { id: string; reason: string; reversePayments: boolean }) {
  return runAction(["sales.cancel"], async (a) => {
    await sales.cancelSale(await getDb(), a, input);
    refresh("/sales", `/sales/${input.id}`, "/invoices", "/inventory", "/customers", "/khata", "/payments");
  });
}
export async function saleReturnAction(input: unknown) {
  return runAction(["sales.return"], async (a) => {
    const r = await sales.createSaleReturn(await getDb(), a, input);
    const id = (input as { saleId: string }).saleId;
    refresh("/sales", `/sales/${id}`, "/inventory", "/customers", "/khata");
    return r;
  });
}
export async function createPurchaseAction(input: PurchaseInput) {
  return runAction(["purchases.create"], async (a) => {
    const r = await purchases.createPurchase(await getDb(), a, input);
    refresh("/purchases", "/inventory", "/suppliers", `/suppliers/${input.supplierId}`, "/payments");
    return { id: r.purchase.id, purchaseNo: r.purchase.purchaseNo, duplicate: r.duplicate };
  });
}
export async function cancelPurchaseAction(input: { id: string; reason: string; reversePayments: boolean }) {
  return runAction(["purchases.cancel"], async (a) => {
    await purchases.cancelPurchase(await getDb(), a, input);
    refresh("/purchases", `/purchases/${input.id}`, "/inventory", "/suppliers", "/payments");
  });
}

// ---------------------------------------------------------------- expenses
export async function createExpenseAction(input: ExpenseInput) {
  return runAction(["expenses.manage"], async (a) => {
    const r = await expenses.createExpense(await getDb(), a, input);
    refresh("/expenses");
    return { id: r.expense.id, duplicate: r.duplicate };
  });
}
export async function updateExpenseAction(id: string, input: ExpenseInput) {
  return runAction(["expenses.manage"], async (a) => {
    await expenses.updateExpense(await getDb(), a, id, input);
    refresh("/expenses");
  });
}
export async function voidExpenseAction(id: string, reason: string) {
  return runAction(["expenses.manage"], async (a) => {
    await expenses.voidExpense(await getDb(), a, id, reason);
    refresh("/expenses");
  });
}

// ---------------------------------------------------------------- uploads
export async function uploadFileAction(form: FormData) {
  return runAction([], async () => {
    const file = form.get("file");
    const folder = String(form.get("folder") || "attachments");
    if (!(file instanceof File)) throw new Error("No file");
    if (!["attachments", "receipts", "products", "logos", "bills"].includes(folder)) throw new Error("Invalid folder");
    const buf = Buffer.from(await file.arrayBuffer());
    try {
      return { key: await putFile(folder, buf) };
    } catch (e) {
      throw new AppError((e as Error).message);
    }
  });
}

// ---------------------------------------------------------------- settings & admin
export async function updateSettingsAction(input: SettingsInput) {
  return runAction(["settings.manage"], async (a) => {
    await admin.updateSettings(await getDb(), a, input);
    refresh("/settings");
  });
}
export async function setLogoAction(key: string | null) {
  return runAction(["settings.manage"], async (a) => {
    await admin.setLogo(await getDb(), a, key);
    refresh("/settings");
  });
}
export async function createEmployeeAction(input: unknown) {
  return runAction(["employees.manage"], async (a) => {
    const r = await admin.createEmployee(await getDb(), a, input);
    refresh("/employees");
    return r;
  });
}
export async function updateEmployeeAction(id: string, input: unknown) {
  return runAction(["employees.manage"], async (a) => {
    await admin.updateEmployee(await getDb(), a, id, input);
    refresh("/employees");
  });
}
export async function resetEmployeePasswordAction(id: string) {
  return runAction(["employees.manage"], async (a) => {
    const temp = await admin.adminResetPassword(await getDb(), a, id);
    refresh("/employees");
    return { tempPassword: temp };
  });
}
export async function setRolePermissionsAction(role: "ADMIN" | "EMPLOYEE", keys: string[]) {
  return runAction(["employees.manage"], async (a) => {
    await admin.setRolePermissions(await getDb(), a, role, keys);
    refresh("/employees");
  });
}
export async function backupNowAction() {
  return runAction(["settings.manage"], async () => {
    const name = await createBackup(await getDb());
    refresh("/settings");
    return { name };
  });
}

// ---------------------------------------------------------------- notifications
export async function markNotificationsReadAction(ids: string[] | "all") {
  return runAction([], async (a) => {
    await notifications.markRead(await getDb(), a, ids);
    refresh("/notifications");
  });
}

// ---------------------------------------------------------------- cash & bank
export async function addCashEntryAction(input: unknown) {
  return runAction(["settings.manage"], async (a) => {
    const { addCashEntry } = await import("@/server/services/cashbook");
    await addCashEntry(await getDb(), a, input);
    refresh("/settings", "/reports/cash-flow");
  });
}
