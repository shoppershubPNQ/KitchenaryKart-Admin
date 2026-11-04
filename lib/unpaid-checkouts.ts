/**
 * Unpaid website checkouts — the buyer reached the Razorpay payment step and
 * did not pay — as a call list for the sales team, and as an Excel file.
 *
 * Pure: no database here, so the rules can be unit-tested
 * (lib/unpaid-checkouts.test.ts). lib/unpaid-checkouts-load.ts runs the
 * queries and hands the rows in.
 *
 * Who is on the list (same idea as the 15-minute alert email,
 * app/api/cron/abandoned-checkout-alerts):
 *   - a website checkout: has a razorpayOrderId (admin drafts and payment-link
 *     orders never do), and is not a free replacement order
 *   - not paid: payment pending or failed; order still pending, or cancelled
 *     (the 24 h auto-cancel keeps payment "pending", so those stay listed —
 *     they are still a buyer worth calling)
 *   - at least 30 minutes old, so someone still on the payment screen is not
 *     listed while they pay
 *   - NOT a staff test: the shared isInternalCustomer rule
 *     (hotelicessentials.com email, or the word "test") that the funnel
 *     metrics and the alert email use
 *   - NOT a buyer who paid a later order (same last-10 phone digits, or the
 *     same email) — they retried and bought, nobody should call them
 *   - one row per buyer, however many attempts: the latest cart is shown and
 *     the earlier order numbers are listed beside it
 */
import * as ExcelJS from 'exceljs';
import { isInternalCustomer } from '@/lib/analytics-range';
import { GST_STATES } from '@/lib/gst-states';

export const MIN_AGE_MINUTES = 30;

export interface CheckoutOrder {
  id: number;
  orderNumber: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  shippingAddress: string | null;
  /** Prisma Decimal, number or null. */
  totalAmount: unknown;
  orderStatus: string;
  paymentStatus: string;
  razorpayOrderId: string | null;
  replacementOfId: number | null;
  contactedAt: Date | null;
  createdAt: Date;
  items: Array<{ productName: string | null; productSku: string | null; quantity: number }>;
}

/** A paid order, only to spot buyers who came back and bought. */
export interface PaidOrder {
  customerPhone: string | null;
  customerEmail: string | null;
  createdAt: Date;
}

export interface UnpaidCheckoutRow {
  orderId: number;
  /** The buyer's latest attempt. */
  orderNumber: string;
  /** Earlier attempts by the same buyer, oldest first. */
  earlierOrderNumbers: string[];
  attempts: number;
  createdAt: Date;
  name: string;
  /** Last 10 digits, '' when the order has none. */
  phone10: string;
  email: string;
  city: string;
  state: string;
  pincode: string;
  /** "Chafing Dish × 2; Bain Marie × 1" */
  items: string;
  amount: number;
  minutesSince: number;
  status: string;
  contactedAt: Date | null;
  /** What they said in the exit popup, if they answered it. */
  reason: string;
  whatsappUrl: string | null;
}

export interface UnpaidCheckoutResult {
  rows: UnpaidCheckoutRow[];
  skipped: { staffTest: number; boughtLater: number; tooRecent: number };
}

export const last10 = (p: string | null | undefined) => (p || '').replace(/\D/g, '').slice(-10);
const lowerEmail = (e: string | null | undefined) => (e || '').trim().toLowerCase();

export function sameBuyer(
  a: { customerPhone: string | null; customerEmail: string | null },
  b: { customerPhone: string | null; customerEmail: string | null },
): boolean {
  const pa = last10(a.customerPhone);
  const ea = lowerEmail(a.customerEmail);
  return (!!pa && pa === last10(b.customerPhone)) || (!!ea && ea === lowerEmail(b.customerEmail));
}

/** An unpaid website checkout at all, before the staff / timing / bought-later rules. */
export function isUnpaidCheckout(o: CheckoutOrder): boolean {
  return (
    !!o.razorpayOrderId &&
    o.replacementOfId == null &&
    (o.paymentStatus === 'pending' || o.paymentStatus === 'failed') &&
    (o.orderStatus === 'pending' || o.orderStatus === 'cancelled')
  );
}

export function statusLabel(o: Pick<CheckoutOrder, 'orderStatus' | 'paymentStatus'>): string {
  if (o.orderStatus === 'cancelled') return 'Cancelled, not paid';
  if (o.paymentStatus === 'failed') return 'Payment failed';
  return 'Not paid yet';
}

/**
 * City, state and pincode from the checkout's address blob:
 *   "Name · +91 98xxxxxxxx\nline, line, City, State, 411048"
 * Best effort; the pincode column is there for anything it misses. Real data
 * has a missing state ("…, Mumbai, Dharavi, 400017"), an unpicked dropdown
 * ("---Select---"), misspellings ("maharastra"), "Maharashtra – 401602" and
 * doubled commas. The state is looked for ONLY in the last two parts: a
 * two-letter short form inside a street name ("MN Reddy Nagar") is not a state.
 */
export function placeFromAddress(blob: string | null | undefined): { city: string; state: string; pincode: string } {
  const text = String(blob ?? '').trim();
  if (!text) return { city: '', state: '', pincode: '' };
  const lines = text.split('\n');
  const body = (lines.length > 1 && lines[0].includes('·') ? lines.slice(1) : lines).join(', ');

  let pincode = '';
  const pin = body.match(/\b(\d{6})\b/) ?? body.match(/\b(\d{3}\s\d{3})\b/);
  if (pin) pincode = pin[1].replace(/\s/g, '');

  const parts = body
    .split(',')
    // "Maharashtra – 401602", "Pune 411048": drop the pincode, keep the words.
    .map((s) => s.replace(/\b\d{6}\b|\b\d{3}\s\d{3}\b/g, '').replace(/^[-–\s]+|[-–\s]+$/g, '').trim())
    .filter((s) => s && !/^-*\s*select\s*-*$/i.test(s) && !/^india$/i.test(s));

  const cityOf = (s: string | undefined) => (s || '').replace(/^dist(rict)?\.?\s+/i, '').trim();
  for (const idx of [parts.length - 1, parts.length - 2]) {
    if (idx < 0) continue;
    const found = stateOfPart(parts[idx]);
    if (found) return { city: cityOf(found.rest || parts[idx - 1]), state: found.name, pincode };
  }
  return { city: parts.length >= 2 ? cityOf(parts[parts.length - 1]) : '', state: '', pincode };
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** Edit distance, for misspelt state names. Short strings only. */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

const STATES_LONGEST_FIRST = [...GST_STATES].sort((a, b) => b.name.length - a.name.length);

/**
 * Is this one address part a state? The whole part as a short form ("MH") or
 * as the name, allowing a typo or two in a long name ("maharastra"), or the
 * name inside it ("Mumbai Maharashtra" → rest "Mumbai").
 */
function stateOfPart(part: string): { name: string; rest: string } | null {
  const sq = squash(part);
  if (!sq) return null;
  for (const s of GST_STATES) {
    if (squash(s.name) === sq || s.aliases.some((a) => squash(a) === sq)) return { name: s.name, rest: '' };
  }
  // Manipal (a city) is 2 edits from Manipur, so short names allow only 1.
  if (sq.length >= 6) {
    for (const s of GST_STATES) {
      const n = squash(s.name);
      if (Math.abs(n.length - sq.length) <= 2 && editDistance(sq, n) <= (n.length >= 9 ? 2 : 1)) return { name: s.name, rest: '' };
    }
  }
  for (const s of STATES_LONGEST_FIRST) {
    // State names are letters and spaces only, so nothing to escape.
    const re = new RegExp(`(^|[^a-z])${s.name}([^a-z]|$)`, 'i');
    if (re.test(part)) return { name: s.name, rest: part.replace(re, ' ').replace(/\s+/g, ' ').trim() };
  }
  return null;
}

const firstName = (full: string | null | undefined) => (full || '').trim().split(/\s+/)[0] || '';

/** Click-to-chat link to the BUYER with a short opening line. */
export function buyerWhatsAppUrl(o: Pick<CheckoutOrder, 'customerPhone' | 'customerName' | 'items'>): string | null {
  const digits = (o.customerPhone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const phone = digits.length === 10 ? `91${digits}` : digits.length === 11 && digits.startsWith('0') ? `91${digits.slice(1)}` : digits;
  const first = o.items[0];
  const what = first ? `${first.productName || first.productSku}${o.items.length > 1 ? ` and ${o.items.length - 1} more item${o.items.length > 2 ? 's' : ''}` : ''}` : 'an order';
  const hi = firstName(o.customerName);
  const msg =
    `Hi${hi ? ` ${hi}` : ''}, this is Kitchenary Kart. ` +
    `You were ordering ${what} on our website. Can we help you complete the order?`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

const itemsText = (items: CheckoutOrder['items']) =>
  items.map((it) => `${it.productName || it.productSku || 'Item'} × ${it.quantity}`).join('; ');

/**
 * The call list. `orders` may hold anything — the rules above decide; `paid`
 * is every paid order from the same period (and a little after).
 * Newest first: the freshest buyer is the likeliest to still buy.
 */
export function selectUnpaidCheckouts(
  orders: CheckoutOrder[],
  paid: PaidOrder[],
  opts: { now: Date; minAgeMinutes?: number; reasons?: Map<string, { label: string; note: string | null }> },
): UnpaidCheckoutResult {
  const now = opts.now.getTime();
  const minAge = (opts.minAgeMinutes ?? MIN_AGE_MINUTES) * 60_000;
  const skipped = { staffTest: 0, boughtLater: 0, tooRecent: 0 };

  const kept: CheckoutOrder[] = [];
  for (const o of orders) {
    if (!isUnpaidCheckout(o)) continue;
    if (now - o.createdAt.getTime() < minAge) {
      skipped.tooRecent++;
      continue;
    }
    if (isInternalCustomer(o.customerEmail, o.customerName)) {
      skipped.staffTest++;
      continue;
    }
    // Judged per attempt, not per buyer: a buyer who paid on Tuesday and
    // left a new cart on Wednesday is a fresh lead for the Wednesday cart.
    if (paid.some((p) => sameBuyer(o, p) && p.createdAt.getTime() > o.createdAt.getTime())) {
      skipped.boughtLater++;
      continue;
    }
    kept.push(o);
  }

  const groups = new Map<string, CheckoutOrder[]>();
  for (const o of kept) {
    // Phone first (stored in mixed formats), then email; never merge two
    // orders that have neither.
    const existing = [...groups.entries()].find(([, g]) => g.some((x) => sameBuyer(x, o)));
    const key = existing ? existing[0] : `order:${o.id}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }

  const rows: UnpaidCheckoutRow[] = [...groups.values()].map((g) => {
    const attempts = [...g].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const latest = attempts[attempts.length - 1];
    const reason = opts.reasons?.get(latest.orderNumber) ??
      attempts.map((a) => opts.reasons?.get(a.orderNumber)).filter(Boolean).pop() ?? null;
    const named = [...attempts].reverse().find((a) => a.customerName?.trim());
    const withPhone = [...attempts].reverse().find((a) => last10(a.customerPhone));
    const withEmail = [...attempts].reverse().find((a) => a.customerEmail?.trim());
    const contacted = attempts.map((a) => a.contactedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      orderId: latest.id,
      orderNumber: latest.orderNumber,
      earlierOrderNumbers: attempts.slice(0, -1).map((a) => a.orderNumber),
      attempts: attempts.length,
      createdAt: latest.createdAt,
      name: (named?.customerName || '').trim(),
      phone10: last10(withPhone?.customerPhone),
      email: (withEmail?.customerEmail || '').trim(),
      ...placeFromAddress(latest.shippingAddress),
      items: itemsText(latest.items),
      amount: Math.round(Number(latest.totalAmount ?? 0) * 100) / 100,
      minutesSince: Math.max(0, Math.floor((now - latest.createdAt.getTime()) / 60_000)),
      status: statusLabel(latest),
      contactedAt: contacted,
      reason: reason ? `${reason.label}${reason.note ? ` — "${reason.note}"` : ''}` : '',
      whatsappUrl: buyerWhatsAppUrl({
        customerPhone: withPhone?.customerPhone ?? null,
        customerName: named?.customerName ?? null,
        items: latest.items,
      }),
    };
  });
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { rows, skipped };
}

// ─── Excel ───────────────────────────────────────────────────────────────

const IST = 'Asia/Kolkata';
const IST_OFFSET_MS = 5.5 * 3_600_000;
/** exceljs writes a Date from its UTC fields, so shift to IST wall-clock first. */
const istCell = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS);

export function istStamp(d: Date): string {
  const date = d.toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date}, ${time}`;
}

/** "unpaid-checkouts-2026-11-04.xlsx", dated in IST. */
export function unpaidCheckoutsFilename(now: Date): string {
  return `unpaid-checkouts-${istCell(now).toISOString().slice(0, 10)}.xlsx`;
}

/** "45 min", "3 h 10 min", "2 days 4 h" */
export function ageText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}${h % 24 ? ` ${h % 24} h` : ''}`;
}

const C = { red: 'FFA01818', redDark: 'FF7A1212', ink: 'FF1A1A1A', body: 'FF3F3B38', muted: 'FF8A8178', line: 'FFE8E2D4', cream: 'FFF5F1EA', creamSoft: 'FFFAF7EE', white: 'FFFFFFFF', link: 'FF1E7A4C' } as const;

type Col = {
  header: string;
  width: number;
  fmt?: string;
  value: (r: UnpaidCheckoutRow) => ExcelJS.CellValue;
};

const COLS: Col[] = [
  { header: 'Order no.', width: 15, value: (r) => r.orderNumber },
  { header: 'Date & time (IST)', width: 18, fmt: 'dd-mmm-yyyy hh:mm AM/PM', value: (r) => istCell(r.createdAt) },
  { header: 'Name', width: 22, value: (r) => r.name },
  { header: 'Phone', width: 15, value: (r) => (r.phone10 ? `+91 ${r.phone10.slice(0, 5)} ${r.phone10.slice(5)}` : '') },
  { header: 'Email', width: 28, value: (r) => r.email },
  { header: 'City', width: 14, value: (r) => r.city },
  { header: 'State', width: 14, value: (r) => r.state },
  { header: 'Pincode', width: 9, value: (r) => r.pincode },
  { header: 'Items', width: 48, value: (r) => r.items },
  { header: 'Amount', width: 12, fmt: '"₹"#,##0', value: (r) => r.amount },
  { header: 'Minutes since checkout', width: 12, fmt: '#,##0', value: (r) => r.minutesSince },
  { header: 'Waiting', width: 12, value: (r) => ageText(r.minutesSince) },
  { header: 'Status', width: 18, value: (r) => r.status },
  { header: 'Attempts', width: 9, fmt: '0', value: (r) => r.attempts },
  { header: 'Earlier attempts', width: 18, value: (r) => r.earlierOrderNumbers.join(', ') },
  { header: 'Contacted', width: 18, fmt: 'dd-mmm-yyyy hh:mm AM/PM', value: (r) => (r.contactedAt ? istCell(r.contactedAt) : '') },
  { header: 'Why they left', width: 26, value: (r) => r.reason },
  { header: 'WhatsApp the buyer', width: 18, value: (r) => (r.whatsappUrl ? { text: 'Open WhatsApp', hyperlink: r.whatsappUrl } : '') },
];

const HEADER_ROW = 4;

/** The call list as an .xlsx file: a title, one row per buyer, a total. */
export async function buildUnpaidCheckoutsWorkbook(
  result: UnpaidCheckoutResult,
  meta: { now: Date; periodLabel: string },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kitchenary Kart admin';
  wb.created = meta.now;
  const ws = wb.addWorksheet('Unpaid checkouts', {
    views: [{ state: 'frozen', ySplit: HEADER_ROW }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = COLS.map((c) => ({ width: c.width }));

  const { rows, skipped } = result;
  const total = rows.reduce((s, r) => s + r.amount, 0);
  ws.getCell('A1').value = `Unpaid checkouts — ${meta.periodLabel}`;
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: C.ink } };
  ws.getCell('A2').value =
    `${rows.length} buyer${rows.length === 1 ? '' : 's'} reached payment on the website and did not pay · ` +
    `₹${Math.round(total).toLocaleString('en-IN')} in carts · made ${istStamp(meta.now)} IST`;
  ws.getCell('A2').font = { size: 10.5, color: { argb: C.body } };
  const left = [
    skipped.staffTest ? `${skipped.staffTest} staff test checkout${skipped.staffTest === 1 ? '' : 's'}` : '',
    skipped.boughtLater ? `${skipped.boughtLater} attempt${skipped.boughtLater === 1 ? '' : 's'} by buyers who paid later` : '',
    skipped.tooRecent ? `${skipped.tooRecent} still under ${MIN_AGE_MINUTES} min (may be paying now)` : '',
  ].filter(Boolean);
  ws.getCell('A3').value = `Left out: ${left.length ? left.join(' · ') : 'nothing'}. One row per buyer; repeat tries are under "Earlier attempts".`;
  ws.getCell('A3').font = { italic: true, size: 9.5, color: { argb: C.muted } };

  const head = ws.getRow(HEADER_ROW);
  COLS.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: C.white }, size: 10.5 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.red } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: C.redDark } } };
  });
  head.height = 30;

  if (rows.length === 0) {
    const cell = ws.getRow(HEADER_ROW + 1).getCell(1);
    cell.value = 'No unpaid checkouts in this period.';
    cell.font = { italic: true, color: { argb: C.muted } };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  const thin = { style: 'thin' as const, color: { argb: C.line } };
  rows.forEach((r, i) => {
    const row = ws.getRow(HEADER_ROW + 1 + i);
    COLS.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = c.value(r);
      if (c.fmt) cell.numFmt = c.fmt;
      const isLink = typeof cell.value === 'object' && cell.value !== null && 'hyperlink' in cell.value;
      cell.font = isLink ? { color: { argb: C.link }, underline: true, size: 10.5 } : { color: { argb: C.body }, size: 10.5 };
      cell.alignment = { vertical: 'top', horizontal: c.fmt && c.fmt !== 'dd-mmm-yyyy hh:mm AM/PM' ? 'right' : 'left', wrapText: c.header === 'Items' || c.header === 'Why they left' };
      if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.creamSoft } };
      cell.border = { bottom: thin };
    });
  });

  const first = HEADER_ROW + 1;
  const last = HEADER_ROW + rows.length;
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: last, column: COLS.length } };

  const amountCol = COLS.findIndex((c) => c.header === 'Amount') + 1;
  const letter = ws.getColumn(amountCol).letter;
  const totalRow = ws.getRow(last + 1);
  totalRow.getCell(1).value = 'TOTAL';
  // SUBTOTAL 109 = SUM that skips rows hidden by a filter.
  totalRow.getCell(amountCol).value = { formula: `SUBTOTAL(109,${letter}${first}:${letter}${last})`, result: total };
  totalRow.getCell(amountCol).numFmt = '"₹"#,##0';
  COLS.forEach((_, ci) => {
    const cell = totalRow.getCell(ci + 1);
    cell.font = { bold: true, color: { argb: C.ink }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.cream } };
    cell.border = { top: { style: 'medium', color: { argb: C.red } } };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
