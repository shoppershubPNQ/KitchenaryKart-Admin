/** KKBT0105-FLEDRG → KKBT0105-FLWDRG (owner-approved 28 Sep 2026).
 *
 *  The Rose Gold double-head food lamp warmer was the only one of its range
 *  spelt FLED; its siblings are KKBT0103-FLWDSS and KKBT0104-FLWDG.
 *
 *  Checked before writing this: 0 order lines, and no collection, business
 *  category, banner, reel, spotlight, review, notify-me request or analytics
 *  event names the old SKU. It exists only as variant #952.
 *
 *  RUN THIS WHEN THE STOREFRONT DEPLOY WITH THE 301 GOES LIVE. The redirect
 *  (/product/KKBT0105-FLEDRG → /product/KKBT0105-FLWDRG) lives in
 *  web/next.config.js; renaming the row before it ships would turn the old url
 *  into a 404 until then, and shipping it before the rename would redirect to
 *  a page that does not exist yet.
 *
 *  Usage: npx tsx scripts/rename-sku-KKBT0105.ts [--apply]
 */
import { writeFileSync } from 'fs';
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');
const FROM = 'KKBT0105-FLEDRG';
const TO = 'KKBT0105-FLWDRG';
const VARIANT_ID = 952;

(async () => {
  const v = await prisma.productVariant.findUnique({
    where: { id: VARIANT_ID },
    select: { id: true, skuSuffix: true, variantValue: true, product: { select: { sku: true } } },
  });
  if (v?.skuSuffix === TO) { console.log('already renamed'); await prisma.$disconnect(); return; }
  if (v?.skuSuffix !== FROM) throw new Error(`variant #${VARIANT_ID} holds ${v?.skuSuffix}, expected ${FROM}`);

  const [asProduct, asVariant, orderLines] = await Promise.all([
    prisma.product.count({ where: { sku: TO } }),
    prisma.productVariant.count({ where: { skuSuffix: TO } }),
    prisma.orderItem.count({ where: { OR: [{ productSku: FROM }, { variantId: VARIANT_ID }] } }),
  ]);
  if (asProduct || asVariant) throw new Error(`${TO} is already taken`);
  console.log(`variant #${v.id} (${v.variantValue}, parent ${v.product.sku}): ${FROM} → ${TO} · order lines: ${orderLines}`);
  if (orderLines) throw new Error('an order now references this SKU — re-check before renaming');

  if (!APPLY) { console.log('DRY RUN — re-run with --apply'); await prisma.$disconnect(); return; }
  writeFileSync(`backup-rename-${FROM}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ id: VARIANT_ID, from: FROM, to: TO }, null, 2));
  await prisma.productVariant.update({ where: { id: VARIANT_ID }, data: { skuSuffix: TO } });
  const after = await prisma.productVariant.findUnique({ where: { id: VARIANT_ID }, select: { skuSuffix: true } });
  console.log(after?.skuSuffix === TO ? 'renamed · verified' : `NOT VERIFIED — row holds ${after?.skuSuffix}`);
  await prisma.$disconnect();
})();
