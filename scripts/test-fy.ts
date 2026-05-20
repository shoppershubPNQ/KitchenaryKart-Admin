// Smoke test for invoice-serial date helpers.
// Run: npx tsx scripts/test-fy.ts
import {
  getFinancialYear,
  getFinancialYearBounds,
  getMonthBounds,
  formatInvoiceNumber,
} from '../lib/invoice-serial';

function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✓' : '✗'} ${label}  got=${JSON.stringify(got)}${ok ? '' : ` want=${JSON.stringify(want)}`}`);
  if (!ok) process.exitCode = 1;
}

check('FY 2026-05-20', getFinancialYear(new Date('2026-05-20')), '2026-27');
check('FY 2026-04-01', getFinancialYear(new Date('2026-04-01')), '2026-27');
check('FY 2026-03-31', getFinancialYear(new Date('2026-03-31')), '2025-26');
check('FY 2027-04-01', getFinancialYear(new Date('2027-04-01')), '2027-28');

check('format 1', formatInvoiceNumber('2026-27', 1), 'KK/2026-27/0001');
check('format 42', formatInvoiceNumber('2026-27', 42), 'KK/2026-27/0042');
check('format 10000', formatInvoiceNumber('2026-27', 10000), 'KK/2026-27/10000');

const fyBounds = getFinancialYearBounds('2026-27');
check('FY 2026-27 start', fyBounds.start.toISOString(), '2026-04-01T00:00:00.000Z');
check('FY 2026-27 end', fyBounds.end.toISOString(), '2027-04-01T00:00:00.000Z');

const may = getMonthBounds('2026-27', 5);
check('May 2026 start', may.start.toISOString(), '2026-05-01T00:00:00.000Z');
check('May 2026 end', may.end.toISOString(), '2026-06-01T00:00:00.000Z');

// January is month 1 → calendar year is FY start + 1 (Jan 2027 in FY 2026-27)
const jan = getMonthBounds('2026-27', 1);
check('Jan 2027 start', jan.start.toISOString(), '2027-01-01T00:00:00.000Z');
check('Jan 2027 end', jan.end.toISOString(), '2027-02-01T00:00:00.000Z');
