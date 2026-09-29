/** FESTIVE10 — owner's choice, 29 Sep 2026: replaces the WELCOME-named codes for a 10% offer.
 *  10% off, minimum order ₹2,000, capped at ₹2,000 off, one use per customer (matched on
 *  phone), valid until the end of 31 Oct 2026 IST. No overall usage cap.
 *  Written the way POST /api/coupons writes one (code upper-cased). WELCOME10 stays off.
 *  Usage: npx tsx scripts/create-coupon-festive10.ts [--apply] */
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');
const DATA = {
  code: 'FESTIVE10',
  description: 'Festive offer — 10% off orders of ₹2,000+ (max ₹2,000 off), one use per customer, till 31 Oct 2026',
  discountType: 'percent' as const,
  discountValue: 10,
  minOrderValue: 2000,
  maxDiscountAmount: 2000,
  usageLimit: null,
  perCustomerLimit: 1,
  startsAt: null,
  expiresAt: new Date('2026-10-31T23:59:59.999+05:30'), // end of 31 Oct, India time
  isActive: true,
};

(async () => {
  const existing = await prisma.coupon.findUnique({ where: { code: DATA.code } });
  if (existing) { console.log(`${DATA.code} already exists (#${existing.id}, active ${existing.isActive}) — nothing written`); await prisma.$disconnect(); return; }
  console.log(JSON.stringify({ ...DATA, expiresAt: DATA.expiresAt.toISOString() }, null, 1));
  if (!APPLY) { console.log('DRY RUN — re-run with --apply'); await prisma.$disconnect(); return; }
  const c = await prisma.coupon.create({ data: DATA });
  console.log(`created #${c.id} ${c.code} · active ${c.isActive} · expires ${c.expiresAt?.toISOString()}`);
  await prisma.$disconnect();
})();
