/**
 * Products & stock. Every stock change is an inventory_movement row; the
 * product's stock_qty is updated under a row lock in the same transaction.
 * Inventory value is kept at moving-average cost and mirrored in the ledger.
 */
import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { DB, Executor, Tx } from "../db/client";
import * as s from "../db/schema";
import { AppError, assertCan, audit, can, getSettingsRow, nextCode, notFound, postJournal, type Actor } from "../core";
import { ACC } from "@/lib/accounts";
import { productSchema, stockAdjustSchema, type ProductInput } from "@/lib/validators";
import { divRound, formatQty, fromMilli, fromPaise, lineAmount, toMilli, toPaise, type Paise } from "@/lib/money";
import { todayIST } from "@/lib/dates";
import { notify } from "./notifications";

type MovementType = (typeof s.movementTypeEnum.enumValues)[number];

/**
 * Applies a stock movement. Inbound movements with a cost update the moving
 * average; outbound movements are valued at the current average cost.
 * Returns the unit cost used (paise) and the new quantity.
 */
export async function applyMovement(
  tx: Tx,
  actor: Actor,
  m: {
    productId: string;
    qtyMilli: number; // signed
    type: MovementType;
    date: string;
    unitCost?: Paise; // for inbound; outbound uses avg cost
    sourceType?: string;
    sourceId?: string;
    reason?: string;
    allowNegative?: boolean;
    journalEntryId?: string | null;
  },
) {
  const [p] = await tx.select().from(s.products).where(eq(s.products.id, m.productId)).for("update");
  if (!p) throw notFound("Product");
  const oldQty = toMilli(p.stockQty);
  const oldAvg = toPaise(p.avgCost);
  const newQty = oldQty + m.qtyMilli;
  if (newQty < 0 && !m.allowNegative) {
    throw new AppError(`Not enough stock for ${p.name}: available ${formatQty(oldQty)} ${p.unit}, required ${formatQty(-m.qtyMilli)} ${p.unit}.`, undefined, "CONFLICT");
  }
  let unitCost = oldAvg;
  let newAvg = oldAvg;
  if (m.qtyMilli > 0 && m.unitCost !== undefined) {
    unitCost = m.unitCost;
    if (oldQty <= 0 || newQty <= 0) newAvg = m.unitCost;
    else newAvg = divRound(BigInt(oldQty) * BigInt(oldAvg) + BigInt(m.qtyMilli) * BigInt(m.unitCost), BigInt(newQty));
  }
  await tx
    .update(s.products)
    .set({ stockQty: fromMilli(newQty), avgCost: fromPaise(newAvg), updatedAt: new Date() })
    .where(eq(s.products.id, p.id));
  await tx.insert(s.inventoryMovements).values({
    productId: p.id,
    movementDate: m.date,
    type: m.type,
    quantity: fromMilli(m.qtyMilli),
    unitCost: fromPaise(unitCost),
    balanceAfter: fromMilli(newQty),
    sourceType: m.sourceType ?? null,
    sourceId: m.sourceId ?? null,
    reason: m.reason ?? null,
    journalEntryId: m.journalEntryId ?? null,
    createdBy: actor.id,
  });
  // Low-stock alert when crossing below the minimum level.
  const min = toMilli(p.minStock);
  if (m.qtyMilli < 0 && min > 0 && newQty <= min && oldQty > min) {
    await notify(tx, {
      type: "LOW_STOCK",
      title: `Low stock: ${p.name}`,
      body: `${formatQty(newQty)} ${p.unit} left (minimum ${formatQty(min)})`,
      link: `/inventory/${p.id}`,
      severity: "warning",
      audience: "MANAGERS",
    });
  }
  return { unitCost, newQty, product: p };
}

export async function allowNegativeFor(tx: Executor, actor: Actor, requested: boolean) {
  const settings = await getSettingsRow(tx);
  return settings.allowNegativeStock || (requested && can(actor, "inventory.negative"));
}

async function resolveCategory(tx: Tx, categoryId: string | null, newCategory: string | null) {
  if (newCategory) {
    const [existing] = await tx.select().from(s.productCategories).where(sql`lower(${s.productCategories.name}) = ${newCategory.toLowerCase()}`);
    if (existing) return existing.id;
    const [c] = await tx.insert(s.productCategories).values({ name: newCategory }).returning();
    return c.id;
  }
  return categoryId;
}

export async function createProduct(db: DB, actor: Actor, raw: ProductInput) {
  assertCan(actor, "inventory.manage");
  const input = productSchema.parse(raw);
  return db.transaction(async (tx) => {
    if (input.sku) {
      const [dup] = await tx.select({ id: s.products.id }).from(s.products).where(eq(s.products.sku, input.sku));
      if (dup) throw new AppError("SKU already exists", { sku: "Already in use" });
    }
    const code = await nextCode(tx, "product");
    const categoryId = await resolveCategory(tx, input.categoryId ?? null, input.newCategory);
    const [p] = await tx
      .insert(s.products)
      .values({
        code,
        name: input.name,
        sku: input.sku,
        barcode: input.barcode,
        hsnCode: input.hsnCode,
        categoryId,
        unit: input.unit,
        purchasePrice: input.purchasePrice,
        sellingPrice: input.sellingPrice,
        avgCost: input.purchasePrice,
        gstRate: input.gstRate,
        minStock: input.minStock,
        imageKey: input.imageKey,
        createdBy: actor.id,
      })
      .returning();
    const opening = toMilli(input.openingStock);
    if (opening > 0) {
      const cost = toPaise(input.purchasePrice);
      const value = lineAmount(opening, cost);
      let jeId: string | null = null;
      if (value > 0) {
        const je = await postJournal(tx, actor, {
          date: todayIST(),
          memo: `Opening stock — ${p.name}`,
          sourceType: "STOCK",
          sourceId: p.id,
          lines: [{ account: ACC.INVENTORY, debit: value }, { account: ACC.OPENING_EQUITY, credit: value }],
        });
        jeId = je.id;
      }
      await applyMovement(tx, actor, { productId: p.id, qtyMilli: opening, type: "OPENING", date: todayIST(), unitCost: cost, reason: "Opening stock", journalEntryId: jeId, sourceType: "PRODUCT", sourceId: p.id });
    }
    await audit(tx, actor, "CREATE", "product", p.id, `Product ${p.name} (${p.code}) created`, { after: p });
    return p;
  });
}

export async function updateProduct(db: DB, actor: Actor, id: string, raw: ProductInput) {
  assertCan(actor, "inventory.manage");
  const input = productSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(s.products).where(eq(s.products.id, id));
    if (!before) throw notFound("Product");
    if (input.sku && input.sku !== before.sku) {
      const [dup] = await tx.select({ id: s.products.id }).from(s.products).where(eq(s.products.sku, input.sku));
      if (dup) throw new AppError("SKU already exists", { sku: "Already in use" });
    }
    const categoryId = await resolveCategory(tx, input.categoryId ?? null, input.newCategory);
    const [after] = await tx
      .update(s.products)
      .set({
        name: input.name,
        sku: input.sku,
        barcode: input.barcode,
        hsnCode: input.hsnCode,
        categoryId,
        unit: input.unit,
        purchasePrice: input.purchasePrice,
        sellingPrice: input.sellingPrice,
        gstRate: input.gstRate,
        minStock: input.minStock,
        imageKey: input.imageKey ?? before.imageKey,
        updatedAt: new Date(),
      })
      .where(eq(s.products.id, id))
      .returning();
    await audit(tx, actor, "UPDATE", "product", id, `Product ${after.name} updated`, { before, after });
    return after;
  });
}

export async function archiveProduct(db: DB, actor: Actor, id: string, archive: boolean) {
  assertCan(actor, "inventory.manage");
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(s.products).where(eq(s.products.id, id));
    if (!p) throw notFound("Product");
    await tx.update(s.products).set({ archivedAt: archive ? new Date() : null, updatedAt: new Date() }).where(eq(s.products.id, id));
    await audit(tx, actor, archive ? "ARCHIVE" : "RESTORE", "product", id, `Product ${p.name} ${archive ? "archived" : "restored"}`);
  });
}

/** Manual stock in / out / set-to-count with a reason; posts the value change to the ledger. */
export async function adjustStock(db: DB, actor: Actor, raw: unknown) {
  assertCan(actor, "inventory.adjust");
  const input = stockAdjustSchema.parse(raw);
  const [dup] = await db.select({ id: s.inventoryMovements.id }).from(s.inventoryMovements).where(and(eq(s.inventoryMovements.sourceType, "ADJUST"), eq(s.inventoryMovements.reason, `${input.reason} [${input.idempotencyKey}]`)));
  if (dup) return { duplicate: true };
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(s.products).where(eq(s.products.id, input.productId)).for("update");
    if (!p) throw notFound("Product");
    const current = toMilli(p.stockQty);
    const q = toMilli(input.quantity);
    let change: number;
    let type: MovementType;
    if (input.kind === "STOCK_IN") {
      change = q;
      type = "STOCK_IN";
    } else if (input.kind === "STOCK_OUT") {
      change = -q;
      type = "STOCK_OUT";
    } else {
      change = q - current;
      type = "ADJUSTMENT";
    }
    if (change === 0) throw new AppError("Stock is already at this quantity.");
    const unitCost = change > 0 && input.unitCost && toPaise(input.unitCost) > 0 ? toPaise(input.unitCost) : toPaise(p.avgCost);
    const value = lineAmount(Math.abs(change), unitCost);
    let jeId: string | null = null;
    if (value > 0) {
      const je = await postJournal(tx, actor, {
        date: input.date,
        memo: `Stock ${change > 0 ? "increase" : "decrease"} — ${p.name}: ${input.reason}`,
        sourceType: "STOCK",
        sourceId: p.id,
        lines:
          change > 0
            ? [{ account: ACC.INVENTORY, debit: value }, { account: ACC.STOCK_ADJUST, credit: value }]
            : [{ account: ACC.STOCK_ADJUST, debit: value }, { account: ACC.INVENTORY, credit: value }],
      });
      jeId = je.id;
    }
    const res = await applyMovement(tx, actor, {
      productId: p.id,
      qtyMilli: change,
      type,
      date: input.date,
      unitCost: change > 0 ? unitCost : undefined,
      reason: `${input.reason} [${input.idempotencyKey}]`,
      sourceType: "ADJUST",
      allowNegative: await allowNegativeFor(tx, actor, false),
      journalEntryId: jeId,
    });
    await audit(tx, actor, "STOCK_ADJUST", "product", p.id, `${p.name}: ${change > 0 ? "+" : ""}${formatQty(change)} ${p.unit} (${input.reason}) → ${formatQty(res.newQty)}`);
    return { duplicate: false, newQty: res.newQty };
  });
}

// ---------------------------------------------------------------- queries
export async function listProducts(
  db: Executor,
  actor: Actor,
  f: { q?: string; categoryId?: string; stock?: "all" | "low" | "out"; archived?: boolean; limit?: number; offset?: number; sort?: "name" | "stock" | "value" } = {},
) {
  assertCan(actor, "inventory.view");
  const q = f.q?.trim();
  const where = and(
    f.archived ? isNotNull(s.products.archivedAt) : isNull(s.products.archivedAt),
    f.categoryId ? eq(s.products.categoryId, f.categoryId) : undefined,
    q ? or(ilike(s.products.name, `%${q}%`), ilike(s.products.sku, `%${q}%`), eq(s.products.barcode, q), ilike(s.products.code, `%${q}%`)) : undefined,
    f.stock === "low" ? sql`${s.products.stockQty} <= ${s.products.minStock} and ${s.products.minStock} > 0` : undefined,
    f.stock === "out" ? sql`${s.products.stockQty} <= 0` : undefined,
  );
  const value = sql<string>`round(greatest(${s.products.stockQty}, 0) * ${s.products.avgCost}, 2)`;
  const order = f.sort === "stock" ? [asc(s.products.stockQty)] : f.sort === "value" ? [desc(value)] : [asc(sql`lower(${s.products.name})`)];
  const rows = await db
    .select({ p: s.products, category: s.productCategories.name, value })
    .from(s.products)
    .leftJoin(s.productCategories, eq(s.productCategories.id, s.products.categoryId))
    .where(where)
    .orderBy(...order)
    .limit(f.limit ?? 100)
    .offset(f.offset ?? 0);
  const [agg] = await db
    .select({ total: sql<number>`count(*)::int`, value: sql<string>`coalesce(sum(${value}), 0)` })
    .from(s.products)
    .where(where);
  return {
    total: agg.total,
    totalValue: toPaise(agg.value),
    rows: rows.map((r) => ({
      ...r.p,
      category: r.category,
      qtyMilli: toMilli(r.p.stockQty),
      minMilli: toMilli(r.p.minStock),
      valueP: toPaise(r.value),
      isLow: toMilli(r.p.minStock) > 0 && toMilli(r.p.stockQty) <= toMilli(r.p.minStock),
    })),
  };
}

export async function inventorySummary(db: Executor) {
  const [r] = await db
    .select({
      value: sql<string>`coalesce(sum(round(greatest(${s.products.stockQty}, 0) * ${s.products.avgCost}, 2)), 0)`,
      retail: sql<string>`coalesce(sum(round(greatest(${s.products.stockQty}, 0) * ${s.products.sellingPrice}, 2)), 0)`,
      count: sql<number>`count(*)::int`,
      low: sql<number>`count(*) filter (where ${s.products.minStock} > 0 and ${s.products.stockQty} <= ${s.products.minStock})::int`,
      out: sql<number>`count(*) filter (where ${s.products.stockQty} <= 0)::int`,
    })
    .from(s.products)
    .where(isNull(s.products.archivedAt));
  return { value: toPaise(r.value), retail: toPaise(r.retail), count: r.count, low: r.low, out: r.out };
}

export async function getProduct(db: Executor, actor: Actor, id: string) {
  assertCan(actor, "inventory.view");
  const [r] = await db
    .select({ p: s.products, category: s.productCategories.name })
    .from(s.products)
    .leftJoin(s.productCategories, eq(s.productCategories.id, s.products.categoryId))
    .where(eq(s.products.id, id));
  if (!r) throw notFound("Product");
  return { ...r.p, category: r.category };
}

export async function productMovements(db: Executor, productId: string, limit = 200) {
  const rows = await db
    .select({ m: s.inventoryMovements, by: s.users.name })
    .from(s.inventoryMovements)
    .leftJoin(s.users, eq(s.users.id, s.inventoryMovements.createdBy))
    .where(eq(s.inventoryMovements.productId, productId))
    .orderBy(desc(s.inventoryMovements.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.m, by: r.by }));
}

export async function listCategories(db: Executor) {
  return db.select().from(s.productCategories).orderBy(asc(s.productCategories.name));
}

/** Lightweight product list for bill entry pickers. */
export async function productOptions(db: Executor) {
  const rows = await db
    .select({
      id: s.products.id,
      name: s.products.name,
      code: s.products.code,
      sku: s.products.sku,
      barcode: s.products.barcode,
      hsnCode: s.products.hsnCode,
      unit: s.products.unit,
      sellingPrice: s.products.sellingPrice,
      purchasePrice: s.products.purchasePrice,
      gstRate: s.products.gstRate,
      stockQty: s.products.stockQty,
    })
    .from(s.products)
    .where(isNull(s.products.archivedAt))
    .orderBy(asc(sql`lower(${s.products.name})`));
  return rows;
}
