/**
 * Queries behind the Analytics dashboard's visitor views. Kept out of the
 * route handlers so they can be exercised from a script (the routes are
 * behind admin login). Data: analytics_events, written by the storefront's
 * first-party tracker (web/lib/track.ts -> web /api/collect).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { isInternalCustomer, num } from '@/lib/analytics-range';

const FUNNEL_EVENTS = ['product_view', 'add_to_cart', 'begin_checkout', 'checkout_submitted', 'payment_opened', 'purchase'];

export async function getTraffic(days: number) {
  const since = new Date(Date.now() - days * 86_400_000);

  const [totalsRows, engagementRows, funnelRows, devices, sources, cities, pages, products, sold, searchRows, actions, firstRows] =
    await Promise.all([
      prisma.$queryRaw<Array<{ visitors: bigint; sessions: bigint; pageviews: bigint }>>`
        SELECT COUNT(DISTINCT visitor_id) AS visitors, COUNT(DISTINCT session_id) AS sessions,
               COUNT(*) FILTER (WHERE event_type = 'page_view') AS pageviews
        FROM analytics_events WHERE created_at >= ${since}`,
      prisma.$queryRaw<Array<{ avg_active_ms: number | null; bounce: number | null; pages_per_session: number | null }>>`
        WITH pv AS (
          SELECT session_id, metadata->>'pv' AS pv, MAX(duration_ms) AS dur
          FROM analytics_events WHERE event_type = 'page_leave' AND created_at >= ${since} GROUP BY 1, 2),
        act AS (SELECT session_id, SUM(dur) AS active FROM pv GROUP BY 1),
        v AS (SELECT session_id, COUNT(*) AS pages FROM analytics_events
              WHERE event_type = 'page_view' AND created_at >= ${since} GROUP BY 1)
        SELECT (SELECT AVG(active) FROM act)::float AS avg_active_ms,
               (SELECT AVG(CASE WHEN pages = 1 THEN 1.0 ELSE 0 END) FROM v)::float AS bounce,
               (SELECT AVG(pages) FROM v)::float AS pages_per_session`,
      prisma.$queryRaw<Array<{ step: string; n: bigint }>>`
        SELECT event_type AS step, COUNT(DISTINCT session_id) AS n FROM analytics_events
        WHERE created_at >= ${since} AND event_type IN (${Prisma.join(FUNNEL_EVENTS)}) GROUP BY 1
        UNION ALL
        SELECT 'checkout_page' AS step, COUNT(DISTINCT session_id) AS n FROM analytics_events
        WHERE created_at >= ${since} AND event_type = 'page_view' AND path LIKE '/checkout%'`,
      prisma.$queryRaw<Array<{ device: string | null; n: bigint }>>`
        SELECT metadata->>'device' AS device, COUNT(*) AS n FROM analytics_events
        WHERE created_at >= ${since} AND event_type = 'session_start' GROUP BY 1 ORDER BY 2 DESC`,
      prisma.$queryRaw<Array<{ src: string | null; sessions: bigint; carts: bigint; buyers: bigint }>>`
        WITH st AS (SELECT session_id, COALESCE(metadata->>'src', 'direct') AS src FROM analytics_events
                    WHERE created_at >= ${since} AND event_type = 'session_start'),
        f AS (SELECT session_id, BOOL_OR(event_type = 'add_to_cart') AS cart, BOOL_OR(event_type = 'purchase') AS paid
              FROM analytics_events WHERE created_at >= ${since} GROUP BY 1)
        SELECT st.src, COUNT(*) AS sessions, COUNT(*) FILTER (WHERE f.cart) AS carts, COUNT(*) FILTER (WHERE f.paid) AS buyers
        FROM st LEFT JOIN f USING (session_id) GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
      prisma.$queryRaw<Array<{ city: string | null; region: string | null; country: string | null; n: bigint }>>`
        SELECT metadata->>'city' AS city, metadata->>'region' AS region, metadata->>'country' AS country, COUNT(*) AS n
        FROM analytics_events WHERE created_at >= ${since} AND event_type = 'session_start'
        GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 15`,
      prisma.$queryRaw<Array<{ path: string; views: bigint; visitors: bigint; avg_ms: number | null }>>`
        WITH v AS (SELECT split_part(path, '?', 1) AS path, visitor_id FROM analytics_events
                   WHERE created_at >= ${since} AND event_type = 'page_view'),
        t AS (SELECT split_part(path, '?', 1) AS path, metadata->>'pv' AS pv, MAX(duration_ms) AS dur
              FROM analytics_events WHERE created_at >= ${since} AND event_type = 'page_leave' GROUP BY 1, 2),
        ta AS (SELECT path, AVG(dur)::float AS avg_ms FROM t GROUP BY 1)
        SELECT v.path, COUNT(*) AS views, COUNT(DISTINCT v.visitor_id) AS visitors, MAX(ta.avg_ms) AS avg_ms
        FROM v LEFT JOIN ta ON ta.path = v.path GROUP BY v.path ORDER BY views DESC LIMIT 25`,
      prisma.$queryRaw<Array<{ sku: string; name: string | null; viewers: bigint; views: bigint; carted: bigint }>>`
        SELECT sku, MAX(metadata->>'name') AS name,
               COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'product_view') AS viewers,
               COUNT(*) FILTER (WHERE event_type = 'product_view') AS views,
               COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'add_to_cart') AS carted
        FROM analytics_events
        WHERE created_at >= ${since} AND sku IS NOT NULL AND event_type IN ('product_view', 'add_to_cart')
        GROUP BY sku ORDER BY viewers DESC, carted DESC LIMIT 60`,
      prisma.orderItem.groupBy({
        by: ['productSku'],
        where: { order: { paymentStatus: 'completed', orderStatus: { not: 'cancelled' }, createdAt: { gte: since } } },
        _sum: { quantity: true },
      }),
      prisma.$queryRaw<Array<{ path: string }>>`
        SELECT path FROM analytics_events
        WHERE created_at >= ${since} AND event_type = 'page_view' AND path LIKE '%q=%' LIMIT 3000`,
      prisma.$queryRaw<Array<{ event_type: string; n: bigint }>>`
        SELECT event_type, COUNT(*) AS n FROM analytics_events
        WHERE created_at >= ${since}
          AND event_type IN ('whatsapp_click', 'call_click', 'payment_failed', 'payment_dismissed', 'remove_from_cart')
        GROUP BY 1`,
      prisma.$queryRaw<Array<{ first: Date | null }>>`SELECT MIN(created_at) AS first FROM analytics_events WHERE session_id IS NOT NULL`,
    ]);

  const t = totalsRows[0];
  const e = engagementRows[0];
  const f = Object.fromEntries(funnelRows.map((r) => [r.step, num(r.n)]));
  const sessions = num(t?.sessions);

  const soldBySku = new Map(sold.map((s) => [s.productSku ?? '', s._sum.quantity ?? 0]));
  const searches = new Map<string, number>();
  for (const r of searchRows) {
    try {
      const q = new URL(r.path, 'https://x').searchParams.get('q')?.trim().toLowerCase();
      if (q) searches.set(q, (searches.get(q) ?? 0) + 1);
    } catch {
      /* skip malformed */
    }
  }

  return {
    days,
    trackingSince: firstRows[0]?.first ?? null,
    totals: {
      visitors: num(t?.visitors),
      sessions,
      pageviews: num(t?.pageviews),
      avgActiveMs: e?.avg_active_ms ?? 0,
      bounceRate: e?.bounce ?? 0,
      pagesPerSession: e?.pages_per_session ?? 0,
    },
    funnel: [
      { key: 'visit', label: 'Visited the site', n: sessions },
      { key: 'product_view', label: 'Viewed a product', n: f.product_view ?? 0 },
      { key: 'add_to_cart', label: 'Added to cart', n: f.add_to_cart ?? 0 },
      { key: 'checkout', label: 'Opened checkout', n: Math.max(f.begin_checkout ?? 0, f.checkout_page ?? 0) },
      { key: 'checkout_submitted', label: 'Filled address & details', n: f.checkout_submitted ?? 0 },
      { key: 'payment_opened', label: 'Opened payment', n: f.payment_opened ?? 0 },
      { key: 'purchase', label: 'Paid', n: f.purchase ?? 0 },
    ],
    devices: devices.map((d) => ({ device: d.device ?? 'unknown', n: num(d.n) })),
    sources: sources.map((s) => ({ source: s.src ?? 'direct', sessions: num(s.sessions), carts: num(s.carts), buyers: num(s.buyers) })),
    cities: cities.map((c) => ({ city: c.city, region: c.region, country: c.country, n: num(c.n) })),
    pages: pages.map((p) => ({ path: p.path, views: num(p.views), visitors: num(p.visitors), avgMs: p.avg_ms ?? 0 })),
    products: products.map((p) => ({
      sku: p.sku,
      name: p.name,
      viewers: num(p.viewers),
      views: num(p.views),
      carted: num(p.carted),
      sold: soldBySku.get(p.sku) ?? 0,
    })),
    searches: [...searches].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([q, n]) => ({ q, n })),
    actions: Object.fromEntries(actions.map((a) => [a.event_type, num(a.n)])),
  };
}

const HAVING: Record<string, Prisma.Sql> = {
  engaged: Prisma.sql`HAVING COUNT(*) FILTER (WHERE event_type = 'page_view') >= 2`,
  cart: Prisma.sql`HAVING BOOL_OR(event_type = 'add_to_cart')`,
  checkout: Prisma.sql`HAVING BOOL_OR(event_type IN ('begin_checkout', 'checkout_submitted') OR (event_type = 'page_view' AND path LIKE '/checkout%'))`,
  payment: Prisma.sql`HAVING BOOL_OR(event_type = 'payment_opened')`,
  buyers: Prisma.sql`HAVING BOOL_OR(event_type = 'purchase')`,
};

type SessionAggRow = {
  session_id: string;
  visitor_id: string | null;
  started: Date;
  last_at: Date;
  pages: bigint;
  products: bigint;
  cart: boolean;
  checkout: boolean;
  details: boolean;
  payment: boolean;
  failed: boolean;
  paid: boolean;
  order_number: string | null;
  start_meta: Record<string, unknown> | null;
  viewed: Array<string | null> | null;
  active_ms: bigint | number | null;
};

export async function getSessions(days: number, filter: string, hideStaff: boolean) {
  const since = new Date(Date.now() - days * 86_400_000);
  const having = HAVING[filter] ?? Prisma.empty;
  const limit = filter === 'known' ? 1000 : 150;

  const rows = await prisma.$queryRaw<SessionAggRow[]>`
    WITH pv AS (
      SELECT session_id, metadata->>'pv' AS pv, MAX(duration_ms) AS dur
      FROM analytics_events WHERE created_at >= ${since} AND event_type = 'page_leave' GROUP BY 1, 2),
    act AS (SELECT session_id, SUM(dur) AS active_ms FROM pv GROUP BY 1),
    s AS (
      SELECT session_id, MAX(visitor_id) AS visitor_id, MIN(created_at) AS started, MAX(created_at) AS last_at,
        COUNT(*) FILTER (WHERE event_type = 'page_view') AS pages,
        COUNT(DISTINCT sku) FILTER (WHERE event_type = 'product_view') AS products,
        BOOL_OR(event_type = 'add_to_cart') AS cart,
        BOOL_OR(event_type = 'begin_checkout' OR (event_type = 'page_view' AND path LIKE '/checkout%')) AS checkout,
        BOOL_OR(event_type = 'checkout_submitted') AS details,
        BOOL_OR(event_type = 'payment_opened') AS payment,
        BOOL_OR(event_type = 'payment_failed') AS failed,
        BOOL_OR(event_type = 'purchase') AS paid,
        MAX(order_number) AS order_number,
        (ARRAY_AGG(metadata ORDER BY created_at) FILTER (WHERE event_type = 'session_start'))[1] AS start_meta,
        (ARRAY_AGG(metadata->>'name' ORDER BY created_at) FILTER (WHERE event_type = 'product_view'))[1:4] AS viewed
      FROM analytics_events
      WHERE created_at >= ${since} AND session_id IS NOT NULL
      GROUP BY session_id ${having}
      ORDER BY started DESC LIMIT ${limit})
    SELECT s.*, act.active_ms FROM s LEFT JOIN act USING (session_id) ORDER BY started DESC`;

  // Who is this visitor? Any order they ever placed names them.
  const visitorIds = [...new Set(rows.map((r) => r.visitor_id).filter((v): v is string => !!v))];
  const links = visitorIds.length
    ? await prisma.analyticsEvent.findMany({
        where: { visitorId: { in: visitorIds }, orderNumber: { not: null } },
        select: { visitorId: true, orderNumber: true },
        distinct: ['visitorId', 'orderNumber'],
      })
    : [];
  const orders = links.length
    ? await prisma.order.findMany({
        where: { orderNumber: { in: [...new Set(links.map((l) => l.orderNumber!))] } },
        select: { orderNumber: true, customerName: true, customerPhone: true, customerEmail: true, paymentStatus: true },
      })
    : [];
  const orderByNumber = new Map(orders.map((o) => [o.orderNumber, o]));
  const who = new Map<string, { name: string | null; phone: string | null; email: string | null; paidOrders: number; internal: boolean }>();
  for (const l of links) {
    const o = orderByNumber.get(l.orderNumber!);
    if (!o || !l.visitorId) continue;
    const cur = who.get(l.visitorId) ?? { name: null, phone: null, email: null, paidOrders: 0, internal: false };
    cur.name = cur.name ?? o.customerName;
    cur.phone = cur.phone ?? o.customerPhone;
    cur.email = cur.email ?? o.customerEmail;
    if (o.paymentStatus === 'completed') cur.paidOrders++;
    cur.internal = cur.internal || isInternalCustomer(o.customerEmail, o.customerName);
    who.set(l.visitorId, cur);
  }

  let sessions = rows.map((r) => {
    const m = (r.start_meta ?? {}) as Record<string, unknown>;
    const person = r.visitor_id ? who.get(r.visitor_id) ?? null : null;
    const step = r.paid
      ? 'paid'
      : r.failed
        ? 'payment_failed'
        : r.payment
          ? 'payment'
          : r.details
            ? 'details'
            : r.checkout
              ? 'checkout'
              : r.cart
                ? 'cart'
                : num(r.products) > 0
                  ? 'viewed'
                  : 'browsed';
    return {
      sessionId: r.session_id,
      visitorId: r.visitor_id,
      started: r.started,
      lastAt: r.last_at,
      pages: num(r.pages),
      products: num(r.products),
      viewed: (r.viewed ?? []).filter((v): v is string => !!v),
      activeMs: num(r.active_ms),
      step,
      orderNumber: r.order_number,
      source: (m.src as string) || 'direct',
      device: (m.device as string) || null,
      city: (m.city as string) || null,
      region: (m.region as string) || null,
      landing: (m.landing as string) || null,
      person,
    };
  });
  if (hideStaff) sessions = sessions.filter((s) => !s.person?.internal);
  if (filter === 'known') sessions = sessions.filter((s) => s.person).slice(0, 150);

  return { days, filter, count: sessions.length, sessions };
}

export async function getSessionDetail(id: string) {
  const events = await prisma.analyticsEvent.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: 'asc' },
    take: 600,
    select: { eventType: true, path: true, sku: true, orderNumber: true, durationMs: true, metadata: true, createdAt: true, visitorId: true },
  });
  if (events.length === 0) return null;

  // Time on each page = the largest page_leave duration for its page-view id.
  const pageTime = new Map<string, { dur: number; scroll: number }>();
  for (const e of events) {
    if (e.eventType !== 'page_leave') continue;
    const m = (e.metadata ?? {}) as Record<string, unknown>;
    const pv = String(m.pv ?? '');
    const cur = pageTime.get(pv) ?? { dur: 0, scroll: 0 };
    pageTime.set(pv, { dur: Math.max(cur.dur, e.durationMs ?? 0), scroll: Math.max(cur.scroll, Number(m.scroll ?? 0)) });
  }

  const start = events[0].createdAt.getTime();
  const timeline = events
    .filter((e) => e.eventType !== 'page_leave')
    .map((e) => {
      const m = (e.metadata ?? {}) as Record<string, unknown>;
      const pt = e.eventType === 'page_view' ? pageTime.get(String(m.pv ?? '')) : undefined;
      return {
        type: e.eventType,
        at: e.createdAt,
        offsetMs: e.createdAt.getTime() - start,
        path: e.path,
        sku: e.sku,
        orderNumber: e.orderNumber,
        durationMs: pt?.dur ?? null,
        scroll: pt?.scroll ?? null,
        data: m,
      };
    });

  const visitorId = events.find((e) => e.visitorId)?.visitorId ?? null;
  let visitor: {
    sessions: number;
    firstSeen: Date | null;
    orders: Array<{ orderNumber: string; customerName: string | null; customerPhone: string | null; paymentStatus: string; totalAmount: number }>;
  } | null = null;
  if (visitorId) {
    const [agg, links] = await Promise.all([
      prisma.$queryRaw<Array<{ sessions: bigint; first: Date }>>`
        SELECT COUNT(DISTINCT session_id) AS sessions, MIN(created_at) AS first
        FROM analytics_events WHERE visitor_id = ${visitorId}`,
      prisma.analyticsEvent.findMany({
        where: { visitorId, orderNumber: { not: null } },
        select: { orderNumber: true },
        distinct: ['orderNumber'],
      }),
    ]);
    const orders = links.length
      ? await prisma.order.findMany({
          where: { orderNumber: { in: links.map((l) => l.orderNumber!) } },
          select: { orderNumber: true, customerName: true, customerPhone: true, paymentStatus: true, totalAmount: true },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    visitor = {
      sessions: num(agg[0]?.sessions),
      firstSeen: agg[0]?.first ?? null,
      orders: orders.map((o) => ({ ...o, paymentStatus: String(o.paymentStatus), totalAmount: Number(o.totalAmount ?? 0) })),
    };
  }

  return { sessionId: id, visitorId, visitor, timeline };
}
