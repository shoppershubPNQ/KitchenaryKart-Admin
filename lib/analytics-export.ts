/**
 * Analytics → Excel workbook, for the owner's own analysis.
 *
 * Built from the SAME functions the dashboard uses (getMetrics, getSessions,
 * getTraffic), so a number in the file always matches the number on screen —
 * a separate export query would drift the first time either side changed.
 *
 * Rules that make the file usable for analysis rather than just readable:
 * - Numbers are written as numbers, never "₹1,234" or "66.7%" strings, so
 *   Excel can sum, average and pivot them. Units go in the column header.
 * - Rates are percentages with one decimal (66.7), not fractions (0.667) —
 *   the owner reads these directly, and the header says "(%)".
 * - Times are IST, written "YYYY-MM-DD HH:mm", which sorts correctly as text.
 * - One sheet per table, no merged cells, header in row 1 — every sheet can be
 *   turned into a pivot table as it stands.
 *
 * Queries run one after another. Several of these fan out internally and the
 * pooled Neon connection has closed mid-request under that load before.
 */
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/db';
import { getMetrics, type MetricSet } from '@/lib/analytics-metrics';
import { getSessions, getTraffic } from '@/lib/visitor-analytics';
import { isInternalCustomer } from '@/lib/analytics-range';

/** Enough for every visit in a year at today's traffic, with a lot of room. */
const MAX_VISIT_ROWS = 20_000;

const IST = 'Asia/Kolkata';

function istStamp(d: Date | string | null | undefined): string {
  if (!d) return '';
  const x = new Date(d);
  // en-CA gives YYYY-MM-DD; build the time separately so the order is stable.
  const date = x.toLocaleDateString('en-CA', { timeZone: IST });
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

const pct = (n: number) => Math.round(n * 1000) / 10; // 0.6667 -> 66.7
const secs = (ms: number) => Math.round((ms || 0) / 1000);
const money = (n: number) => Math.round((n || 0) * 100) / 100;
const change = (now: number, before: number) =>
  before ? Math.round(((now - before) / before) * 1000) / 10 : '';

/** Sheet with column widths sized to the longest value (capped), so it opens readable. */
function sheet(rows: Array<Record<string, unknown>>, emptyNote: string): XLSX.WorkSheet {
  const data = rows.length ? rows : [{ Note: emptyNote }];
  const ws = XLSX.utils.json_to_sheet(data);
  const keys = Object.keys(data[0]);
  ws['!cols'] = keys.map((k) => {
    const longest = Math.max(k.length, ...data.slice(0, 500).map((r) => String(r[k] ?? '').length));
    return { wch: Math.min(60, Math.max(10, longest + 2)) };
  });
  return ws;
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

  const wb = XLSX.utils.book_new();
  const c = m.current;
  const p = m.previous;

  // ---- Summary -----------------------------------------------------------
  const metricRows: Array<[string, keyof MetricSet, (n: number) => number]> = [
    ['Visitors (unique people)', 'users', (n) => n],
    ['New visitors', 'newUsers', (n) => n],
    ['Returning visitors', 'returningUsers', (n) => n],
    ['Visits', 'sessions', (n) => n],
    ['Engaged visits', 'engagedSessions', (n) => n],
    ['Engagement rate (%)', 'engagementRate', pct],
    ['Bounce rate (%)', 'bounceRate', pct],
    ['Avg engagement time per visit (sec)', 'avgEngagementMs', secs],
    ['Page views', 'views', (n) => n],
    ['Pages per visit', 'viewsPerSession', (n) => Math.round(n * 100) / 100],
    ['Visits per visitor', 'sessionsPerUser', (n) => Math.round(n * 100) / 100],
    ['Visits that viewed a product', 'productViewSessions', (n) => n],
    ['Visits that added to cart', 'cartSessions', (n) => n],
    ['Visits that reached checkout', 'checkoutSessions', (n) => n],
    ['Visits that opened payment', 'paymentSessions', (n) => n],
    ['Visits that PAID', 'convertedSessions', (n) => n],
    ['Conversion rate (%)', 'conversionRate', pct],
    ['Add-to-cart rate of product viewers (%)', 'cartRate', pct],
    ['Checkout abandonment (%)', 'checkoutAbandonRate', pct],
    ['Paid orders (whole store)', 'orders', (n) => n],
    ['Revenue, paid orders (Rs)', 'revenue', money],
    ['Average order value (Rs)', 'aov', money],
    ['Revenue per visit (Rs)', 'revenuePerSession', money],
  ];
  const summary: Array<Record<string, unknown>> = [
    { Metric: 'Range', 'This period': `${istStamp(m.range.since)} to ${istStamp(m.range.until)} IST`, 'Previous period': `the ${days} day(s) before`, 'Change (%)': '' },
    { Metric: 'Staff test visits', 'This period': hideStaff ? `excluded (${m.excludedSessions} visit(s) removed)` : 'included', 'Previous period': '', 'Change (%)': '' },
    { Metric: 'Visitor tracking started', 'This period': istStamp(m.trackingSince), 'Previous period': m.partialWindow ? 'range starts before tracking — visitor figures are partial; orders and revenue are complete' : '', 'Change (%)': '' },
    { Metric: '', 'This period': '', 'Previous period': '', 'Change (%)': '' },
    ...metricRows.map(([label, key, f]) => ({
      Metric: label,
      'This period': f(c[key]),
      'Previous period': f(p[key]),
      'Change (%)': change(c[key], p[key]),
    })),
  ];
  XLSX.utils.book_append_sheet(wb, sheet(summary, ''), 'Summary');

  // ---- Daily -------------------------------------------------------------
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      m.series.map((s) => ({
        'Date (IST)': s.day,
        Visitors: s.users,
        'New visitors': s.newUsers,
        Visits: s.sessions,
        'Engaged visits': s.engagedSessions,
        'Page views': s.views,
        'Avg engagement (sec)': secs(s.avgEngagementMs),
        'Paid orders': s.orders,
        'Revenue (Rs)': money(s.revenue),
      })),
      'No days in range.',
    ),
    'Daily',
  );

  // ---- Visits ------------------------------------------------------------
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      visits.sessions.map((v) => ({
        'Started (IST)': istStamp(v.started),
        'Visitor ID': v.visitorId ?? '',
        Source: v.source,
        Device: v.device ?? '',
        City: v.city ?? '',
        Region: v.region ?? '',
        'Landing page': v.landing ?? '',
        Pages: v.pages,
        'Products viewed': v.products,
        'Time on site (sec)': secs(v.activeMs),
        'Furthest step': STEP_LABEL[v.step] ?? v.step,
        'Order number': v.orderNumber ?? '',
        'Customer name': v.person?.name ?? '',
        'Customer phone': v.person?.phone ?? '',
        'Paid orders by this customer': v.person?.paidOrders ?? '',
        'First product viewed': cleanName(v.viewed[0]),
      })),
      'No visits in range.',
    ),
    'Visits',
  );

  // ---- Orders ------------------------------------------------------------
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      orders.map((o) => ({
        'Order number': o.orderNumber,
        'Placed (IST)': istStamp(o.createdAt),
        Customer: o.customerName ?? '',
        Phone: o.customerPhone ?? '',
        Email: o.customerEmail ?? '',
        // Free text, often one long line; collapsed so it stays in one cell.
        'Ship to': (o.shippingAddress ?? '').replace(/\s*\n\s*/g, ', ').trim(),
        Items: o._count.items,
        'Subtotal (Rs)': money(Number(o.subtotal ?? 0)),
        'Discount (Rs)': money(Number(o.discountAmount ?? 0)),
        'GST (Rs)': money(Number(o.taxAmount ?? 0)),
        'Shipping (Rs)': money(Number(o.shippingCost ?? 0)),
        'Total paid (Rs)': money(Number(o.totalAmount ?? 0)),
        Coupon: o.couponCode ?? '',
        'Payment method': o.paymentMethod ?? '',
        'Order status': o.orderStatus,
        // Kept in, not dropped: staff also place real orders. Filter on this.
        'Staff / test order': isInternalCustomer(o.customerEmail, o.customerName) ? 'Yes' : 'No',
      })),
      'No paid orders in range.',
    ),
    'Orders',
  );

  // ---- Products ----------------------------------------------------------
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      traffic.products.map((x) => ({
        SKU: x.sku,
        Product: cleanName(x.name),
        'Visitors who viewed': x.viewers,
        Views: x.views,
        'Visitors who added to cart': x.carted,
        'Add-to-cart rate (%)': x.viewers ? pct(x.carted / x.viewers) : '',
        'Units sold (paid)': x.sold,
      })),
      'No product views in range.',
    ),
    'Products',
  );

  // ---- Breakdowns --------------------------------------------------------
  const b = m.breakdowns;
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      b.landingPages.map((x) => ({
        'Landing page': x.path,
        Visits: x.sessions,
        'Engaged visits': x.engagedSessions,
        'Engagement rate (%)': x.sessions ? pct(x.engagedSessions / x.sessions) : '',
        'Paid visits': x.conversions,
      })),
      'No visits in range.',
    ),
    'Landing pages',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      b.referrers.map((x) => ({ Source: x.source, Medium: x.medium ?? '', Campaign: x.campaign ?? '', Visits: x.sessions })),
      'No visits in range.',
    ),
    'Sources',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(b.devices.map((x) => ({ Device: x.device, Screen: x.screen ?? '', Visits: x.sessions })), 'No visits in range.'),
    'Devices',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      b.scrollDepth.map((x) => ({
        Page: x.path,
        Views: x.views,
        'Avg scrolled (%)': Math.round(x.avgScroll * 10) / 10,
        'Avg time on page (sec)': secs(x.avgMs),
      })),
      'No page views in range.',
    ),
    'Read depth',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(b.exitPages.map((x) => ({ 'Exit page': x.path, Exits: x.exits })), 'No visits in range.'),
    'Exit pages',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(b.hours.map((x) => ({ 'Hour (IST)': `${String(x.hour).padStart(2, '0')}:00`, Visits: x.sessions })), ''),
    'Time of day',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(traffic.searches.map((x) => ({ 'Search term': x.q, Searches: x.n })), 'No searches in range.'),
    'Searches',
  );

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const filename = `kitchenarykart-analytics-${days}d-${new Date().toLocaleDateString('en-CA', { timeZone: IST })}.xlsx`;
  return { buffer, filename, sheets: wb.SheetNames, counts: { visits: visits.sessions.length, orders: orders.length } };
}
