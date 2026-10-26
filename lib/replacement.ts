/**
 * Free REPLACEMENT orders (owner 2026-10-26: a bread-box lid and an oven bulb arrived broken — "replacement order
 * kaise kare").
 *
 * A replacement is a new Order row linked to the original (Order.replacementOfId) that sends an item or part again
 * at no charge. It is created already "paid" (paymentStatus completed, paymentMethod "replacement", total ₹0) so
 * the normal fulfilment path works unchanged — courier booking from the order page, tracking email, stock coming
 * down on delivery — while everything that treats an order as a SALE skips it:
 *   - no GST tax-invoice serial (lib/invoice-serial) — it prints a Delivery Challan instead (lib/invoice-build)
 *   - no Payment row, coupon, confirmation email or team "new order" alert (it never goes through finalizePaidOrder)
 *   - no review request, no abandoned-checkout handling
 *   - left out of every sales / revenue / conversion figure (SALE filters below)
 * The courier and the challan get a declared value per unit (OrderItem.declaredUnitValue): what the customer paid
 * for that line on the original order, the catalogue price for an extra spare, or the value typed for a part we
 * do not sell on its own.
 */
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { resolveOrderItems } from './order-items';
import { withContactLine } from './order-contact-line';

export const REPLACEMENT_METHOD = 'replacement';

/** True for a free replacement order. replacementOfId is the authoritative flag; paymentMethod is the label the
 *  storefront (whose schema does not carry the column) keys on. */
export function isReplacementOrder(o: { replacementOfId?: number | null; paymentMethod?: string | null }): boolean {
  return o.replacementOfId != null || o.paymentMethod === REPLACEMENT_METHOD;
}

/** Prisma filter: real sales only (no replacements). Spread into any `where` that counts orders as sales. */
export const NOT_REPLACEMENT: Prisma.OrderWhereInput = { replacementOfId: null };

/** Raw-SQL twin of NOT_REPLACEMENT for an orders alias, e.g. `AND ${notReplacementSql('o')}`. */
export function notReplacementSql(alias?: string): Prisma.Sql {
  return Prisma.raw(`${alias ? `${alias}.` : ''}replacement_of_id IS NULL`);
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The value of the goods in an order, as the courier / e-way bill / challan should state it. A sale: what the
 *  customer pays (totalAmount, as before). A replacement: Σ declared unit value × quantity. */
export function goodsValue(order: {
  replacementOfId?: number | null;
  paymentMethod?: string | null;
  totalAmount: Prisma.Decimal | number | null;
  items: Array<{ quantity: number; declaredUnitValue?: Prisma.Decimal | number | null }>;
}): number {
  if (!isReplacementOrder(order)) return Number(order.totalAmount ?? 0);
  return r2(order.items.reduce((s, it) => s + Number(it.declaredUnitValue ?? 0) * it.quantity, 0));
}

// ─── Create ──────────────────────────────────────────────────────────────

export type ReplacementLine =
  /** Re-send (part of) a line of the original order — same product/variant, value = what was paid for it. */
  | { kind: 'item'; orderItemId: number; quantity: number }
  /** A catalogue product/spare by SKU (e.g. only the bulb of a machine) — value = its current price. */
  | { kind: 'sku'; sku: string; quantity: number }
  /** A part we do not sell on its own (e.g. a bread-box lid) — no stock effect; value typed by the admin. */
  | { kind: 'text'; name: string; quantity: number; unitValue: number; taxPercent?: number };

export interface CreateReplacementInput {
  lines: ReplacementLine[];
  reason: string;
  /** Different delivery address (bare address; the "Name · Phone" first line is added). Default: the original's. */
  shippingAddress?: string | null;
}

export class ReplacementError extends Error {}

/** Statuses an original order may be in to have a replacement raised against it. */
export const REPLACEABLE_STATUSES = ['processing', 'shipped', 'delivered', 'returned'] as const;

export async function createReplacementOrder(
  originalId: number,
  input: CreateReplacementInput,
  admin: { id: number; name: string },
) {
  const reason = input.reason.trim();
  if (!reason) throw new ReplacementError('Write the reason (what arrived broken)');
  if (!input.lines.length) throw new ReplacementError('Add at least one item to send');

  const original = await prisma.order.findUnique({ where: { id: originalId }, include: { items: true } });
  if (!original) throw new ReplacementError('Original order not found');
  if (isReplacementOrder(original)) throw new ReplacementError('This is itself a replacement — raise it against the original order');
  if (original.paymentStatus !== 'completed') throw new ReplacementError('The original order is not paid');
  if (!(REPLACEABLE_STATUSES as readonly string[]).includes(original.orderStatus)) {
    throw new ReplacementError(`The original order is ${original.orderStatus}`);
  }

  // What the customer actually paid per unit on the original: unit price less its share of a coupon/discount
  // (Order.discountAmount is GST-inclusive, spread pro rata — the same rule the courier lines use).
  const gross = original.items.reduce((s, it) => s + Number(it.unitPrice) * it.quantity, 0);
  const discount = Number(original.discountAmount ?? 0);
  const paidFactor = gross > 0 && discount > 0 && gross > discount ? (gross - discount) / gross : 1;

  const skuLines = input.lines.filter((l): l is Extract<ReplacementLine, { kind: 'sku' }> => l.kind === 'sku');
  const resolved = await resolveOrderItems(skuLines.map((l) => l.sku.trim()), { qualifyVariantNames: true });

  const rows: Prisma.OrderItemCreateManyOrderInput[] = [];
  const summary: string[] = [];
  for (const l of input.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new ReplacementError('Each quantity must be 1 or more');
    if (l.kind === 'item') {
      const it = original.items.find((x) => x.id === l.orderItemId);
      if (!it) throw new ReplacementError('That item is not on the original order');
      if (l.quantity > it.quantity) throw new ReplacementError(`${it.productName ?? it.productSku}: only ${it.quantity} were ordered`);
      rows.push({
        productId: it.productId, variantId: it.variantId, productName: it.productName, productSku: it.productSku,
        unitPrice: 0, quantity: l.quantity, taxPercent: it.taxPercent, discountPercent: 0, lineTotal: 0,
        declaredUnitValue: r2(Number(it.unitPrice) * paidFactor),
      });
      summary.push(`${l.quantity} × ${it.productName ?? it.productSku}`);
    } else if (l.kind === 'sku') {
      const hit = resolved.get(l.sku.trim());
      if (!hit) throw new ReplacementError(`SKU ${l.sku} not found`);
      rows.push({
        productId: hit.productId, variantId: hit.variantId, productName: hit.name, productSku: l.sku.trim(),
        unitPrice: 0, quantity: l.quantity, taxPercent: hit.taxPercent, discountPercent: 0, lineTotal: 0,
        declaredUnitValue: r2(hit.price),
      });
      summary.push(`${l.quantity} × ${hit.name} (${l.sku.trim()})`);
    } else {
      const name = l.name.trim();
      if (!name) throw new ReplacementError('Name the part being sent');
      if (!(l.unitValue > 0)) throw new ReplacementError(`${name}: enter its value per piece (for the courier and the challan)`);
      rows.push({
        productId: null, variantId: null, productName: name, productSku: null,
        unitPrice: 0, quantity: l.quantity, taxPercent: l.taxPercent ?? 18, discountPercent: 0, lineTotal: 0,
        declaredUnitValue: r2(l.unitValue),
      });
      summary.push(`${l.quantity} × ${name}`);
    }
  }

  const shippingAddress = input.shippingAddress?.trim()
    ? withContactLine(input.shippingAddress.trim(), original.customerName, original.customerPhone)
    : original.shippingAddress;
  const stamp = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });

  return prisma.$transaction(async (tx) => {
    // Lock the original so two clicks cannot both take the same -R number.
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${original.id} FOR UPDATE`;
    // Next -R number from the highest one used (not a count), so a deleted replacement never makes it collide.
    const prior = await tx.order.findMany({ where: { orderNumber: { startsWith: `${original.orderNumber}-R` } }, select: { orderNumber: true } });
    const used = prior.map((p) => Number(p.orderNumber.slice(original.orderNumber.length + 2))).filter((x) => Number.isInteger(x) && x > 0);
    const orderNumber = `${original.orderNumber}-R${(used.length ? Math.max(...used) : 0) + 1}`;
    const created = await tx.order.create({
      data: {
        orderNumber,
        customerId: original.customerId,
        customerName: original.customerName,
        customerEmail: original.customerEmail,
        customerPhone: original.customerPhone,
        customerGstin: original.customerGstin,
        shippingAddress,
        shippingCost: 0,
        internalShippingCost: 0,
        subtotal: 0,
        taxAmount: 0,
        discountAmount: 0,
        totalAmount: 0,
        orderStatus: 'processing',
        paymentStatus: 'completed',
        paymentMethod: REPLACEMENT_METHOD,
        replacementOfId: original.id,
        // A free part must never trigger "how was your purchase?" — the cron also filters replacements out.
        reviewEmailAt: new Date(),
        // The bare reason — printed on the Delivery Challan (Order.notes is never shown to the customer online).
        notes: reason,
        internalNotes: `Free replacement for ${original.orderNumber} — ${reason}. Sent: ${summary.join(', ')}. Raised by ${admin.name} on ${stamp}.`,
        items: { createMany: { data: rows } },
      },
    });
    const note = `[${stamp}] Replacement ${orderNumber} raised by ${admin.name}: ${reason} — ${summary.join(', ')}`;
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: original.id }, select: { internalNotes: true } });
    await tx.order.update({
      where: { id: original.id },
      data: { internalNotes: fresh.internalNotes ? `${fresh.internalNotes}\n${note}` : note },
    });
    return created;
  });
}
