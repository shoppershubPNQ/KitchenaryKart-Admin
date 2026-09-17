/**
 * Analytics → Excel workbook, for the owner's own analysis.
 *
 * Built from the SAME functions the dashboard uses (getMetrics, getSessions,
 * getTraffic), so a number in the file always matches the number on screen —
 * a separate export query would drift the first time either side changed.
 *
 * Written with exceljs, not the `xlsx` package used elsewhere in admin: the
 * free SheetJS build cannot style cells at all (bold, fills, borders are a paid
 * feature), and the first plain export was hard to read (owner, 2026-09-17).
 *
 * Rules that make the file readable AND usable for analysis:
 * - Values are real numbers / real dates; the look comes from number formats.
 *   Rs amounts carry "₹#,##0", rates are stored as fractions shown "0.0%",
 *   durations as Excel time "[h]:mm:ss" — so Excel still sums, sorts, filters
 *   and pivots them correctly.
 * - Times are IST wall-clock. exceljs turns a JS Date into an Excel serial from
 *   its UTC epoch, so each instant is shifted +5:30 before it is written.
 * - Every data sheet: styled header frozen on scroll, filter dropdowns, zebra
 *   rows (skipped past 3,000 rows to keep a year's export light).
 * - Orders and Daily end with a TOTAL row using SUBTOTAL(109, …), which ignores
 *   rows the owner has filtered out, so the total always matches what is shown.
 * - A previous-period value that predates visitor tracking shows "—", not 0.
 *   Zero would claim nobody visited; the truth is nobody was counting.
 *
 * Queries run one after another. Several fan out internally, and the pooled
 * Neon connection has closed mid-request under parallel load before.
 */
import * as ExcelJS from 'exceljs';
import { prisma } from '@/lib/db';
import { getMetrics, type MetricSet } from '@/lib/analytics-metrics';
import { getSessions, getTraffic } from '@/lib/visitor-analytics';
import { isInternalCustomer } from '@/lib/analytics-range';

/** Enough for every visit in a year at today's traffic, with a lot of room. */
const MAX_VISIT_ROWS = 20_000;
/** Above this, per-row zebra fills cost more file size than they are worth. */
const ZEBRA_MAX_ROWS = 3_000;

const IST_OFFSET_MS = 5.5 * 3_600_000;
const IST = 'Asia/Kolkata';

const C = {
  red: 'FFA01818',
  redDark: 'FF7A1212',
  ink: 'FF1A1A1A',
  body: 'FF3F3B38',
  muted: 'FF8A8178',
  line: 'FFE8E2D4',
  cream: 'FFF5F1EA',
  creamSoft: 'FFFAF7EE',
  white: 'FFFFFFFF',
  green: 'FF1E7A4C',
  amber: 'FF8A5A00',
} as const;

const FMT = {
  int: '#,##0',
  dec: '#,##0.00',
  money: '"₹"#,##0',
  money2: '"₹"#,##0.00',
  pct: '0.0%',
  change: '+0.0%;-0.0%;0.0%',
  date: 'dd-mmm-yyyy',
  datetime: 'dd-mmm-yyyy hh:mm',
  duration: '[h]:mm:ss',
} as const;

type ColType = 'text' | 'int' | 'dec' | 'money' | 'money2' | 'pct' | 'date' | 'datetime' | 'duration';
interface Col<R> {
  header: string;
  type: ColType;
  width: number;
  value: (row: R) => unknown;
  /** Adds this column to the TOTAL row (numeric columns only). */
  total?: boolean;
}

/** Instant → Date whose UTC fields read as IST wall-clock, for exceljs. */
const istDate = (d: Date | string | null | undefined): Date | null =>
  d ? new Date(new Date(d).getTime() + IST_OFFSET_MS) : null;
/** "2026-09-17" (already an IST day) → Excel date. */
const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);
/** Milliseconds → Excel time fraction, shown [h]:mm:ss. */
const duration = (ms: number) => (ms || 0) / 86_400_000;
const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

function istLabel(d: Date | string | null | undefined): string {
  if (!d) return '';
  const x = new Date(d);
  const date = x.toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' });
  const time = x.toLocaleTimeString('en-GB', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
}

/**
 * Product names recorded by the tracker can carry a raw variant object —
 * "Chafing Dish — {"Size":"2 Compartment","Capacity":"3.5L/Pan"}" — from before
 * the storefront learned to format it. Turn the object into "2 Compartment /
 * 3.5L/Pan" so the column reads like a product name.
 */
function cleanName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .replace(/\{[^{}]*\}/g, (blob) => {
      try {
        const vals = Object.values(JSON.parse(blob) as Record<string, unknown>)
          .map((v) => String(v).trim())
          .filter(Boolean);
        return [...new Set(vals)].join(' / ');
      } catch {
        return blob;
      }
    })
    .trim();
}

const STEP_LABEL: Record<string, string> = {
  paid: 'Paid',
  payment_failed: 'Payment failed',
  payment: 'Opened payment',
  details: 'Filled details',
  checkout: 'Opened checkout',
  cart: 'Added to cart',
  viewed: 'Viewed products',
  browsed: 'Browsed',
};

const thinLine = { style: 'thin' as const, color: { argb: C.line } };

function styleHeaderRow(row: ExcelJS.Row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: C.white }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.red } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
    cell.border = { bottom: { style: 'medium', color: { argb: C.redDark } } };
  });
}

/**
 * One data table per sheet: header in row 1, frozen, with filter dropdowns,
 * zebra rows, per-column number formats and an optional SUBTOTAL row.
 */
function addTableSheet<R>(
  wb: ExcelJS.Workbook,
  name: string,
  cols: Array<Col<R>>,
  rows: R[],
  emptyNote: string,
) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width }));
  styleHeaderRow(ws.getRow(1));

  if (rows.length === 0) {
    const r = ws.addRow([emptyNote]);
    r.getCell(1).font = { italic: true, color: { argb: C.muted } };
    return ws;
  }

  const zebra = rows.length <= ZEBRA_MAX_ROWS;
  rows.forEach((src, i) => {
    const row = ws.addRow(cols.map((c) => c.value(src) ?? ''));
    cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      if (c.type !== 'text') cell.numFmt = FMT[c.type];
      cell.alignment = { vertical: 'middle', horizontal: c.type === 'text' ? 'left' : 'right' };
      cell.font = { color: { argb: C.body }, size: 10.5 };
      if (zebra && i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.creamSoft } };
      cell.border = { bottom: thinLine };
    });
  });

  const lastData = rows.length + 1;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastData, column: cols.length } };

  if (cols.some((c) => c.total)) {
    const totalRow = ws.addRow(
      cols.map((c, ci) => {
        if (ci === 0) return 'TOTAL';
        if (!c.total) return '';
        const letter = ws.getColumn(ci + 1).letter;
        const result = rows.reduce((s, r) => s + (Number(c.value(r)) || 0), 0);
        // SUBTOTAL 109 = SUM that skips rows hidden by the filter.
        return { formula: `SUBTOTAL(109,${letter}2:${letter}${lastData})`, result };
      }),
    );
    totalRow.height = 20;
    cols.forEach((c, ci) => {
      const cell = totalRow.getCell(ci + 1);
      if (c.total && c.type !== 'text') cell.numFmt = FMT[c.type];
      cell.font = { bold: true, color: { argb: C.ink }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.cream } };
      cell.alignment = { vertical: 'middle', horizontal: ci === 0 ? 'left' : 'right' };
      cell.border = { top: { style: 'medium', color: { argb: C.red } } };
    });
  }
  return ws;
}

type MetricKind = 'visitor' | 'order';
interface MetricLine {
  label: string;
  key: keyof MetricSet;
  fmt: keyof typeof FMT;
  /** Stored value from the raw metric (fraction stays fraction, ms → time). */
  toCell: (n: number) => number;
  /** 'order' metrics come from the orders table and exist before tracking did. */
  kind: MetricKind;
  /** Rising is bad (bounce, abandonment) — flips the change colour. */
  worseWhenUp?: boolean;
}

const id = (n: number) => n;
const SECTIONS: Array<{ title: string; lines: MetricLine[] }> = [
  {
    title: 'Traffic',
    lines: [
      { label: 'Visitors (unique people)', key: 'users', fmt: 'int', toCell: id, kind: 'visitor' },
      { label: 'New visitors', key: 'newUsers', fmt: 'int', toCell: id, kind: 'visitor' },
      { label: 'Returning visitors', key: 'returningUsers', fmt: 'int', toCell: id, kind: 'visitor' },
      { label: 'Visits', key: 'sessions', fmt: 'int', toCell: id, kind: 'visitor' },
      { label: 'Page views', key: 'views', fmt: 'int', toCell: id, kind: 'visitor' },
      { label: 'Pages per visit', key: 'viewsPerSession', fmt: 'dec', toCell: round2, kind: 'visitor' },
      { label: 'Visits per visitor', key: 'sessionsPerUser', fmt: 'dec', toCell: round2, kind: 'visitor' },
    ],
  },
  {
    title: 'Engagement',
    lines: [
      { label: 'Engaged visits', key: 'engagedSessions', fmt: 'int', toCell: id, kind: 'visitor' },
      { label: 'Engagement rate', key: 'engagementRate', fmt: 'pct', toCell: id, kind: 'visitor' },
      { label: 'Bounce rate', key: 'bounceRate', fmt: 'pct', toCell: id, kind: 'visitor', worseWhenUp: true },
      { label: 'Avg engagement time per visit', key: 'avgEngagementMs', fmt: 'duration', toCell: duration, kind: 'visitor' },
    ],
  },
  {
    title: 'Shopping funnel',
    lines: [
      { label: 'Visits that viewed a product', key: 'productViewSessions', fmt: 'int', toCell: id, kind: 'visitor' },
      { label: 'Visits that added to cart', key: 'cartSessions', fmt: 'int', toCell: id, kind: 'visitor' },
      { label: 'Visits that reached checkout', key: 'checkoutSessions', fmt: 'int', toCell: id, kind: 'visitor' },
      { label: 'Visits that opened payment', key: 'paymentSessions', fmt: 'int', toCell: id, kind: 'visitor' },
      { label: 'Visits that PAID', key: 'convertedSessions', fmt: 'int', toCell: id, kind: 'visitor' },
      { label: 'Conversion rate', key: 'conversionRate', fmt: 'pct', toCell: id, kind: 'visitor' },
      { label: 'Add-to-cart rate (of product viewers)', key: 'cartRate', fmt: 'pct', toCell: id, kind: 'visitor' },
      { label: 'Checkout abandonment', key: 'checkoutAbandonRate', fmt: 'pct', toCell: id, kind: 'visitor', worseWhenUp: true },
    ],
  },
  {
    title: 'Sales (paid orders, whole store)',
    lines: [
      { label: 'Paid orders', key: 'orders', fmt: 'int', toCell: id, kind: 'order' },
      { label: 'Revenue', key: 'revenue', fmt: 'money', toCell: round2, kind: 'order' },
      { label: 'Average order value', key: 'aov', fmt: 'money2', toCell: round2, kind: 'order' },
      { label: 'Revenue per visit', key: 'revenuePerSession', fmt: 'money2', toCell: round2, kind: 'visitor' },
    ],
  },
];

function addSummarySheet(wb: ExcelJS.Workbook, m: Awaited<ReturnType<typeof getMetrics>>, days: number, hideStaff: boolean) {
  const ws = wb.addWorksheet('Summary', {
    properties: { tabColor: { argb: C.red } },
    views: [{ state: 'frozen', ySplit: 6, showGridLines: false }],
  });
  ws.columns = [{ width: 42 }, { width: 20 }, { width: 20 }, { width: 14 }];

  const prevSince = new Date(m.range.since.getTime() - days * 86_400_000);
  // Previous window has visitor data only if tracking existed before it ended.
  const prevHasTracking = !!m.trackingSince && new Date(m.trackingSince) < m.range.since;
  const tracked = !!m.trackingSince;

  // Title block — outside the table so the table itself stays clean.
  ws.mergeCells('A1:D1');
  const title = ws.getCell('A1');
  title.value = 'Kitchenary Kart — Analytics report';
  title.font = { bold: true, size: 16, color: { argb: C.ink } };
  ws.getRow(1).height = 26;

  ws.mergeCells('A2:D2');
  ws.getCell('A2').value = `Last ${days} day(s): ${istLabel(m.range.since)} → ${istLabel(m.range.until)} IST   ·   compared with ${istLabel(prevSince)} → ${istLabel(m.range.since)}`;
  ws.getCell('A2').font = { size: 10.5, color: { argb: C.body } };

  ws.mergeCells('A3:D3');
  ws.getCell('A3').value = hideStaff
    ? `Staff test visits excluded (${m.excludedSessions} visit(s) removed)   ·   Visitor tracking began ${istLabel(m.trackingSince)}`
    : `Staff test visits INCLUDED   ·   Visitor tracking began ${istLabel(m.trackingSince)}`;
  ws.getCell('A3').font = { size: 10.5, color: { argb: C.muted } };

  ws.mergeCells('A4:D4');
  if (m.partialWindow || !prevHasTracking) {
    ws.getCell('A4').value =
      '“—” means there is no figure to show: visitor tracking had not started yet for that period. ' +
      'Orders and revenue are always complete — they come from the orders themselves.';
    ws.getCell('A4').font = { italic: true, size: 10, color: { argb: C.amber } };
    ws.getCell('A4').alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(4).height = 30;
  }

  const header = ws.getRow(6);
  header.values = ['Metric', 'This period', 'Previous period', 'Change'];
  styleHeaderRow(header);
  [2, 3, 4].forEach((c) => (header.getCell(c).alignment = { vertical: 'middle', horizontal: 'right' }));

  let r = 7;
  for (const section of SECTIONS) {
    ws.mergeCells(`A${r}:D${r}`);
    const s = ws.getCell(`A${r}`);
    s.value = section.title;
    s.font = { bold: true, size: 11, color: { argb: C.red } };
    s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.cream } };
    s.border = { top: thinLine, bottom: thinLine };
    ws.getRow(r).height = 20;
    r++;

    for (const line of section.lines) {
      const row = ws.getRow(r);
      const nowRaw = m.current[line.key];
      const prevRaw = m.previous[line.key];
      const nowAvailable = line.kind === 'order' || tracked;
      const prevAvailable = line.kind === 'order' || prevHasTracking;

      row.getCell(1).value = line.label;
      row.getCell(1).font = { size: 10.5, color: { argb: C.body } };
      row.getCell(1).alignment = { indent: 1, vertical: 'middle' };

      const setVal = (col: number, available: boolean, raw: number) => {
        const cell = row.getCell(col);
        if (!available) {
          cell.value = '—';
          cell.font = { color: { argb: C.muted }, size: 10.5 };
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          return;
        }
        cell.value = line.toCell(raw);
        cell.numFmt = FMT[line.fmt];
        cell.font = { size: 10.5, color: { argb: col === 2 ? C.ink : C.body }, bold: col === 2 };
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      };
      setVal(2, nowAvailable, nowRaw);
      setVal(3, prevAvailable, prevRaw);

      const ch = row.getCell(4);
      if (nowAvailable && prevAvailable && prevRaw) {
        const delta = (nowRaw - prevRaw) / prevRaw;
        ch.value = Math.round(delta * 1000) / 1000;
        ch.numFmt = FMT.change;
        const good = line.worseWhenUp ? delta < 0 : delta > 0;
        ch.font = { bold: true, size: 10.5, color: { argb: Math.abs(delta) < 0.0005 ? C.muted : good ? C.green : C.red } };
      } else {
        ch.value = '—';
        ch.font = { color: { argb: C.muted }, size: 10.5 };
      }
      ch.alignment = { horizontal: 'right', vertical: 'middle' };

      [1, 2, 3, 4].forEach((c) => (row.getCell(c).border = { bottom: thinLine }));
      row.height = 18;
      r++;
    }
  }

  ws.getRow(r + 1).getCell(1).value = `Generated ${istLabel(new Date())} IST from the live admin data.`;
  ws.getRow(r + 1).getCell(1).font = { italic: true, size: 9, color: { argb: C.muted } };
}

export async function buildAnalyticsWorkbook(days: number, hideStaff = true) {
  const m = await getMetrics(days, hideStaff);
  const visits = await getSessions(days, 'all', hideStaff, MAX_VISIT_ROWS);
  const traffic = await getTraffic(days);
  const orders = await prisma.order.findMany({
    where: {
      paymentStatus: 'completed',
      orderStatus: { not: 'cancelled' },
      createdAt: { gte: m.range.since, lt: m.range.until },
    },
    select: {
      orderNumber: true, createdAt: true, customerName: true, customerPhone: true, customerEmail: true,
      shippingAddress: true, subtotal: true, taxAmount: true, shippingCost: true, discountAmount: true,
      totalAmount: true, paymentMethod: true, orderStatus: true, couponCode: true,
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kitchenary Kart admin';
  wb.created = new Date();

  addSummarySheet(wb, m, days, hideStaff);

  addTableSheet(wb, 'Daily', [
    { header: 'Date (IST)', type: 'date', width: 14, value: (s) => dayDate(s.day) },
    { header: 'Visitors', type: 'int', width: 11, value: (s) => s.users, total: false },
    { header: 'New visitors', type: 'int', width: 13, value: (s) => s.newUsers },
    { header: 'Visits', type: 'int', width: 10, value: (s) => s.sessions, total: true },
    { header: 'Engaged visits', type: 'int', width: 15, value: (s) => s.engagedSessions, total: true },
    { header: 'Page views', type: 'int', width: 12, value: (s) => s.views, total: true },
    { header: 'Avg engagement', type: 'duration', width: 15, value: (s) => duration(s.avgEngagementMs) },
    { header: 'Paid orders', type: 'int', width: 12, value: (s) => s.orders, total: true },
    { header: 'Revenue', type: 'money', width: 14, value: (s) => round2(s.revenue), total: true },
  ], m.series, 'No days in range.');

  addTableSheet(wb, 'Visits', [
    { header: 'Started (IST)', type: 'datetime', width: 18, value: (v) => istDate(v.started) },
    { header: 'Source', type: 'text', width: 18, value: (v) => v.source },
    { header: 'Device', type: 'text', width: 10, value: (v) => v.device ?? '' },
    { header: 'City', type: 'text', width: 14, value: (v) => v.city ?? '' },
    { header: 'Region', type: 'text', width: 8, value: (v) => v.region ?? '' },
    { header: 'Landing page', type: 'text', width: 34, value: (v) => v.landing ?? '' },
    { header: 'Pages', type: 'int', width: 8, value: (v) => v.pages },
    { header: 'Products viewed', type: 'int', width: 16, value: (v) => v.products },
    { header: 'Time on site', type: 'duration', width: 13, value: (v) => duration(v.activeMs) },
    { header: 'Furthest step', type: 'text', width: 17, value: (v) => STEP_LABEL[v.step] ?? v.step },
    { header: 'Order number', type: 'text', width: 15, value: (v) => v.orderNumber ?? '' },
    { header: 'Customer', type: 'text', width: 20, value: (v) => v.person?.name ?? '' },
    { header: 'Phone', type: 'text', width: 16, value: (v) => v.person?.phone ?? '' },
    { header: 'Paid orders (customer)', type: 'int', width: 20, value: (v) => v.person?.paidOrders ?? '' },
    { header: 'First product viewed', type: 'text', width: 40, value: (v) => cleanName(v.viewed[0]) },
    { header: 'Visitor ID', type: 'text', width: 34, value: (v) => v.visitorId ?? '' },
  ], visits.sessions, 'No visits in range.');

  addTableSheet(wb, 'Orders', [
    { header: 'Order number', type: 'text', width: 15, value: (o) => o.orderNumber },
    { header: 'Placed (IST)', type: 'datetime', width: 18, value: (o) => istDate(o.createdAt) },
    { header: 'Customer', type: 'text', width: 24, value: (o) => o.customerName ?? '' },
    { header: 'Phone', type: 'text', width: 16, value: (o) => o.customerPhone ?? '' },
    { header: 'Email', type: 'text', width: 28, value: (o) => o.customerEmail ?? '' },
    { header: 'Ship to', type: 'text', width: 46, value: (o) => (o.shippingAddress ?? '').replace(/\s*\n\s*/g, ', ').trim() },
    { header: 'Items', type: 'int', width: 8, value: (o) => o._count.items, total: true },
    { header: 'Subtotal', type: 'money2', width: 13, value: (o) => round2(Number(o.subtotal ?? 0)), total: true },
    { header: 'Discount', type: 'money2', width: 12, value: (o) => round2(Number(o.discountAmount ?? 0)), total: true },
    { header: 'GST', type: 'money2', width: 12, value: (o) => round2(Number(o.taxAmount ?? 0)), total: true },
    { header: 'Shipping', type: 'money2', width: 12, value: (o) => round2(Number(o.shippingCost ?? 0)), total: true },
    { header: 'Total paid', type: 'money2', width: 14, value: (o) => round2(Number(o.totalAmount ?? 0)), total: true },
    { header: 'Coupon', type: 'text', width: 12, value: (o) => o.couponCode ?? '' },
    { header: 'Payment', type: 'text', width: 11, value: (o) => o.paymentMethod ?? '' },
    { header: 'Status', type: 'text', width: 12, value: (o) => o.orderStatus },
    // Kept in, not dropped: staff also place real orders. Filter on this.
    { header: 'Staff / test order', type: 'text', width: 17, value: (o) => (isInternalCustomer(o.customerEmail, o.customerName) ? 'Yes' : 'No') },
  ], orders, 'No paid orders in range.');

  addTableSheet(wb, 'Products', [
    { header: 'SKU', type: 'text', width: 20, value: (x) => x.sku },
    { header: 'Product', type: 'text', width: 60, value: (x) => cleanName(x.name) },
    { header: 'Visitors who viewed', type: 'int', width: 19, value: (x) => x.viewers },
    { header: 'Views', type: 'int', width: 9, value: (x) => x.views },
    { header: 'Added to cart', type: 'int', width: 14, value: (x) => x.carted },
    { header: 'Add-to-cart rate', type: 'pct', width: 16, value: (x) => (x.viewers ? x.carted / x.viewers : '') },
    { header: 'Units sold (paid)', type: 'int', width: 17, value: (x) => x.sold },
  ], traffic.products, 'No product views in range.');

  const b = m.breakdowns;
  addTableSheet(wb, 'Landing pages', [
    { header: 'Landing page', type: 'text', width: 46, value: (x) => x.path },
    { header: 'Visits', type: 'int', width: 10, value: (x) => x.sessions },
    { header: 'Engaged visits', type: 'int', width: 15, value: (x) => x.engagedSessions },
    { header: 'Engagement rate', type: 'pct', width: 16, value: (x) => (x.sessions ? x.engagedSessions / x.sessions : '') },
    { header: 'Paid visits', type: 'int', width: 12, value: (x) => x.conversions },
  ], b.landingPages, 'No visits in range.');

  addTableSheet(wb, 'Sources', [
    { header: 'Source', type: 'text', width: 36, value: (x) => x.source },
    { header: 'Medium', type: 'text', width: 14, value: (x) => x.medium ?? '' },
    { header: 'Campaign', type: 'text', width: 20, value: (x) => x.campaign ?? '' },
    { header: 'Visits', type: 'int', width: 10, value: (x) => x.sessions },
  ], b.referrers, 'No visits in range.');

  addTableSheet(wb, 'Devices', [
    { header: 'Device', type: 'text', width: 12, value: (x) => x.device },
    { header: 'Screen', type: 'text', width: 14, value: (x) => x.screen ?? '' },
    { header: 'Visits', type: 'int', width: 10, value: (x) => x.sessions },
  ], b.devices, 'No visits in range.');

  addTableSheet(wb, 'Read depth', [
    { header: 'Page', type: 'text', width: 46, value: (x) => x.path },
    { header: 'Views', type: 'int', width: 9, value: (x) => x.views },
    { header: 'Avg scrolled', type: 'pct', width: 13, value: (x) => (x.avgScroll || 0) / 100 },
    { header: 'Avg time on page', type: 'duration', width: 17, value: (x) => duration(x.avgMs) },
  ], b.scrollDepth, 'No page views in range.');

  addTableSheet(wb, 'Exit pages', [
    { header: 'Exit page', type: 'text', width: 46, value: (x) => x.path },
    { header: 'Exits', type: 'int', width: 9, value: (x) => x.exits },
  ], b.exitPages, 'No visits in range.');

  addTableSheet(wb, 'Time of day', [
    { header: 'Hour (IST)', type: 'text', width: 12, value: (x) => `${String(x.hour).padStart(2, '0')}:00` },
    { header: 'Visits', type: 'int', width: 10, value: (x) => x.sessions },
  ], b.hours, '');

  addTableSheet(wb, 'Searches', [
    { header: 'Search term', type: 'text', width: 32, value: (x) => x.q },
    { header: 'Searches', type: 'int', width: 11, value: (x) => x.n },
  ], traffic.searches, 'No searches in range.');

  const buffer = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  const filename = `kitchenarykart-analytics-${days}d-${new Date().toLocaleDateString('en-CA', { timeZone: IST })}.xlsx`;
  return {
    buffer,
    filename,
    sheets: wb.worksheets.map((w) => w.name),
    counts: { visits: visits.sessions.length, orders: orders.length },
  };
}
