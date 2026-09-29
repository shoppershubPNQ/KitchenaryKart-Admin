/** Stock count sheet "ITEMLIST25 — FRYER 3 | SEP WEEK 2" (owner, 29 Sep 2026).
 *
 *  The sheet's QTY is the FINAL stock, not an addition. Each row is set to
 *  that figure and logged as an 'adjustment' movement for the difference,
 *  the way admin's Adjust stock records a change.
 *
 *  Not on the site, so not set: "Spares for Fryer 4L & 8L - Handle" (100) —
 *  our only fryer handles come attached to the baskets.
 *
 *  Each row names the exact row id and SKU; it refuses if either moved.
 *
 *  Usage: npx tsx scripts/set-stock-itemlist25.ts [--apply]
 */
import { writeFileSync } from 'fs';
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');
const SHEET = 'ITEMLIST25 Fryer 3 Sep week 2';

type Row = { sheet: string; table: 'product' | 'variant'; id: number; sku: string; to: number };
const ROWS: Row[] = [
  { sheet: 'FY61', table: 'product', id: 2603, sku: 'KKHE0092-FY61', to: 500 },
  { sheet: 'FY62', table: 'product', id: 2602, sku: 'KKHE0091-FY62', to: 100 },
  { sheet: 'FY81', table: 'product', id: 2606, sku: 'KKHE0095-FY81', to: 240 },
  { sheet: 'FY82', table: 'product', id: 2604, sku: 'KKHE0093-FY82', to: 259 },
  { sheet: 'FY83', table: 'product', id: 2599, sku: 'KKHE0088-FY83', to: 100 },
  { sheet: '1PW Regular', table: 'variant', id: 1523, sku: 'KKHE0277-1PW', to: 38 },
  { sheet: 'Spares for Fryer 8L - Basket', table: 'product', id: 2619, sku: 'KKHE0113-DFS4', to: 1000 },
  { sheet: 'Spares for Fryer 4L - Basket', table: 'product', id: 2618, sku: 'KKHE0112-DFS12', to: 500 },
  { sheet: '811E', table: 'product', id: 2632, sku: 'KKHE0126-811E', to: 46 },
];

async function read(r: Row) {
  if (r.table === 'product') {
    const p = await prisma.product.findUnique({ where: { id: r.id }, select: { sku: true, stock: true, name: true, _count: { select: { variants: true } } } });
    if (!p || p.sku !== r.sku) throw new Error(`product #${r.id} is not ${r.sku}`);
    if (p._count.variants) throw new Error(`${r.sku} has variants — set the variant row`);
    return { stock: p.stock, name: p.name, productId: r.id };
  }
  const v = await prisma.productVariant.findUnique({ where: { id: r.id }, select: { skuSuffix: true, stock: true, variantValue: true, productId: true, product: { select: { name: true } } } });
  if (!v || v.skuSuffix !== r.sku) throw new Error(`variant #${r.id} is not ${r.sku}`);
  return { stock: v.stock ?? 0, name: `${v.product.name} — ${v.variantValue}`, productId: v.productId };
}

(async () => {
  const plan: Array<Row & { from: number; productId: number }> = [];
  for (const r of ROWS) {
    const cur = await read(r);
    const open = await prisma.orderItem.findMany({
      where: { productSku: r.sku, order: { is: { orderStatus: { notIn: ['delivered', 'cancelled', 'returned'] } } } },
      select: { quantity: true, order: { select: { orderNumber: true, orderStatus: true, paymentStatus: true } } },
    });
    const openTxt = open.length ? ' · OPEN ORDERS: ' + open.map((o) => `${o.order.orderNumber} ${o.order.orderStatus}/${o.order.paymentStatus} ×${o.quantity}`).join(', ') : '';
    console.log(`${r.sheet.padEnd(30)} ${r.sku.padEnd(16)} ${String(cur.stock).padStart(6)} → ${String(r.to).padStart(5)}  ${cur.name.slice(0, 55)}${openTxt}`);
    plan.push({ ...r, from: cur.stock, productId: cur.productId });
  }
  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply'); await prisma.$disconnect(); return; }

  writeFileSync(`backup-stock-itemlist25-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(plan, null, 2));
  for (const r of plan) {
    if (r.from === r.to) continue;
    const note = `Stock set to ${r.to} from count sheet "${SHEET}" (was ${r.from})${r.table === 'variant' ? ` — variant ${r.sku}` : ''}`;
    await prisma.$transaction([
      prisma.inventoryMovement.create({ data: { productId: r.productId, movementType: 'adjustment', quantity: r.to - r.from, notes: note } }),
      r.table === 'product'
        ? prisma.product.update({ where: { id: r.id }, data: { stock: r.to } })
        : prisma.productVariant.update({ where: { id: r.id }, data: { stock: r.to } }),
    ]);
  }
  let ok = 0;
  for (const r of plan) if ((await read(r)).stock === r.to) ok++;
  console.log(`\nverified ${ok}/${plan.length}`);
  await prisma.$disconnect();
})();
