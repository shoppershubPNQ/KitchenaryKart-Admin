/** Catalogue-wide audit fixes, owner 30 Sep 2026 ("Har ek category check kro").
 *
 *  1. GN-pan lid sizes that Excel turned into dates on import: "01-Feb" is 1/2,
 *     "01-Mar" 1/3 … (the SKU suffix confirms: …LR12 = 1/2, …LR19 = 1/9).
 *  2. Spelling / capitalisation in product names (and the same words wherever
 *     they also appear in the description or SEO text): Bult-In, Vama, Muddller,
 *     "2 Roles", wiith, premium, Mix Color, Gray, "J shape", trailing space.
 *  3. KKA0410 material field: a silicone spatula with an SS handle, not "SS".
 *
 *  Guards: each variant label must still read the date text; each name fix must
 *  still find its typo in the name. Usage: npx tsx scripts/fix-listings-2026-09-30c.ts [--apply]
 */
import { writeFileSync } from 'fs';
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');
const DATE_TO_GN: Record<string, string> = { '01-Jan': '1/1', '01-Feb': '1/2', '01-Mar': '1/3', '01-Apr': '1/4', '01-Jun': '1/6', '01-Sep': '1/9' };
const GN_BY_SUFFIX: Record<string, string> = { '11': '1/1', '12': '1/2', '13': '1/3', '14': '1/4', '16': '1/6', '19': '1/9' };
const LID_VARIANTS = [994, 995, 996, 997, 998, 999, 967, 968, 969, 970, 971, 972];

const NAME_FIXES: Array<{ sku: string; from: string; to: string }> = [
  { sku: 'KKBBA0089-VJD4L', from: 'Bult-In', to: 'Built-In' },
  { sku: 'KKBBA0089-VJD4L', from: 'Vama Glass', to: 'VAMA Glass' },
  { sku: 'KKBBA0094-MUSSS', from: 'Muddller', to: 'Muddler' },
  { sku: 'KKBBA0108-PBMSL', from: '2 Roles', to: '2 Rolls' },
  { sku: 'KK-3924-006', from: 'wiith', to: 'with' },
  { sku: 'KKA0055-CCAG', from: 'premium', to: 'Premium' },
  { sku: 'KKA0124-SBGMX', from: 'Mix Color', to: 'Mix Colour' },
  { sku: 'KKSP0309-SPM5', from: 'Gray Plate', to: 'Grey Plate' },
  { sku: 'KK-8302-014', from: 'Hooks J shape', to: 'J-Shaped Hooks' },
  { sku: 'KKBT0091-DC20', from: 'for Food ', to: 'for Food' },
];
const FIELD_SET = [{ sku: 'KKA0410-SSSP27', field: 'material' as const, expect: 'Stainless Steel', to: 'Silicone (SS Handle)' }];
const TEXT_FIELDS = ['name', 'description', 'metaTitle', 'metaDescription'] as const;

(async () => {
  const refused: string[] = [];
  const backup: unknown[] = [];
  const vUpd: Array<{ id: number; data: { variantValue: string } }> = [];
  const pUpd = new Map<number, Record<string, string>>();

  const lids = await prisma.productVariant.findMany({ where: { id: { in: LID_VARIANTS } }, select: { id: true, skuSuffix: true, variantValue: true } });
  for (const v of lids) {
    const to = DATE_TO_GN[(v.variantValue ?? '').trim()];
    const bySku = GN_BY_SUFFIX[/LR?F?(\d{2})$/.exec(v.skuSuffix ?? '')?.[1] ?? ''] ?? GN_BY_SUFFIX[/(\d{2})$/.exec(v.skuSuffix ?? '')?.[1] ?? ''];
    if (!to) { refused.push(`V#${v.id} ${v.skuSuffix}: label is ${JSON.stringify(v.variantValue)}`); continue; }
    if (bySku !== to) { refused.push(`V#${v.id} ${v.skuSuffix}: date says ${to}, SKU says ${bySku}`); continue; }
    backup.push({ table: 'variant', ...v });
    vUpd.push({ id: v.id, data: { variantValue: to } });
    console.log(`V#${v.id} ${v.skuSuffix!.padEnd(18)} ${v.variantValue} → ${to}`);
  }
  if (lids.length !== LID_VARIANTS.length) refused.push(`found ${lids.length} of ${LID_VARIANTS.length} lid variants`);

  for (const f of NAME_FIXES) {
    const p = await prisma.product.findUnique({ where: { sku: f.sku }, select: { id: true, sku: true, name: true, description: true, metaTitle: true, metaDescription: true } });
    if (!p) { refused.push(`${f.sku}: not found`); continue; }
    const u = pUpd.get(p.id) ?? {};
    const curName = u.name ?? p.name;
    if (!curName.includes(f.from)) { refused.push(`${f.sku}: "${f.from}" not in name ${JSON.stringify(curName)}`); continue; }
    if (!pUpd.has(p.id)) backup.push({ table: 'product', ...p });
    for (const fld of TEXT_FIELDS) {
      if (f.from.endsWith(' ') && fld !== 'name') continue; // trailing-space fix: the name only
      const cur = u[fld] ?? p[fld];
      if (cur && cur.includes(f.from)) u[fld] = fld === 'name' && f.from.endsWith(' ') ? cur.trimEnd() : cur.split(f.from).join(f.to);
    }
    pUpd.set(p.id, u);
  }
  for (const r of FIELD_SET) {
    const p = await prisma.product.findUnique({ where: { sku: r.sku }, select: { id: true, sku: true, material: true } });
    if (!p || p.material !== r.expect) { refused.push(`${r.sku}: material is ${JSON.stringify(p?.material)}`); continue; }
    backup.push({ table: 'product', ...p });
    pUpd.set(p.id, { ...(pUpd.get(p.id) ?? {}), [r.field]: r.to });
  }
  for (const [id, u] of pUpd) for (const [k, v] of Object.entries(u)) console.log(`P#${id} ${k.padEnd(15)} → ${v.split('\n')[0].slice(0, 120)}`);

  if (refused.length) { console.log(`\nREFUSED — nothing written:\n  ${refused.join('\n  ')}`); process.exitCode = 1; return; }
  if (!APPLY) { console.log(`\n${vUpd.length} option label(s), ${pUpd.size} product row(s). DRY RUN — re-run with --apply`); return; }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  writeFileSync(`backup-listing-fixes-c-${stamp}.json`, JSON.stringify(backup, null, 2));
  await prisma.$transaction([
    ...vUpd.map((v) => prisma.productVariant.update({ where: { id: v.id }, data: v.data })),
    ...[...pUpd].map(([id, data]) => prisma.product.update({ where: { id }, data })),
  ]);
  console.log(`\n${vUpd.length} option label(s) + ${pUpd.size} product row(s) written · backup backup-listing-fixes-c-${stamp}.json`);
})().finally(() => prisma.$disconnect());
