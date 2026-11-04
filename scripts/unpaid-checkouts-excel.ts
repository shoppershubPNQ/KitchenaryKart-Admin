/**
 * READ-ONLY: writes the unpaid-checkouts Excel from live data to a file, the
 * same file the Abandoned carts page downloads. Nothing is marked or sent.
 *
 *   npx tsx scripts/unpaid-checkouts-excel.ts [days=7] [out=C:/path/file.xlsx]
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../lib/db';
import { periodDays, unpaidCheckoutsExcel } from '../lib/unpaid-checkouts-load';
import { ageText } from '../lib/unpaid-checkouts';

(async () => {
  const days = periodDays(process.argv[2]);
  const { buffer, filename, result } = await unpaidCheckoutsExcel(days);
  const out = resolve(process.argv[3] || filename);
  writeFileSync(out, buffer);
  console.log(`last ${days} day(s): ${result.rows.length} buyer row(s); left out`, result.skipped);
  for (const r of result.rows) {
    console.log(
      `  ${r.orderNumber} ${r.name || '(no name)'} | ${r.city || '-'}, ${r.state || '-'} | ₹${r.amount} | ${ageText(r.minutesSince)} | ${r.status}` +
        `${r.attempts > 1 ? ` | ${r.attempts} attempts` : ''} | ${r.items.slice(0, 70)}`,
    );
  }
  console.log(`written: ${out}`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
