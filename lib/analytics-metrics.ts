/**
 * The metrics engine behind the Analytics dashboard — GA4-style definitions,
 * computed from our own analytics_events table plus the orders table.
 *
 * Three rules make these numbers trustworthy:
 *
 * 1. MONEY COMES FROM `orders`, NEVER FROM A BROWSER EVENT. The client fires a
 *    `purchase` event, but it only fires if the tab survives Razorpay's
 *    redirect, and payments confirmed later (webhook, admin reconcile) never
 *    fire it at all. So a visit counts as converted when the order_number it
 *    carried is a paid, non-cancelled order in the DB — the same PAID rule the
 *    rest of the admin uses. Revenue is summed from orders for the same reason.
 *
 * 2. STAFF TEST VISITS ARE EXCLUDED BY DEFAULT. On 15 Sep 2026 most checkouts
 *    in the data were the owner testing, and counted as real that reads
 *    "everyone abandons payment". A visitor is staff if any order they placed
 *    is internal by email or name — the shared isInternalCustomer rule, so the
 *    dashboard, the Visits list and the Excel export all agree. NOT by phone:
 *    staff order on a customer's behalf using that customer's number.
 *
 * 3. DAYS ARE IST DAYS. created_at is UTC; an Indian shop's "yesterday" ends at
 *    midnight IST, so every bucket converts before truncating. Without this the
 *    evening's orders (after 05:30 UTC) land on the wrong day.
 *
 * GA4 definitions used here, so the words mean what the owner expects if they
 * ever compare against Google Analytics:
 *   - Session: activity under one session id (the tracker starts a new one
 *     after 30 minutes idle).
 *   - Engaged session: lasted 10s+, OR saw 2+ pages, OR reached checkout.
 *   - Engagement rate: engaged sessions / sessions. Bounce rate is its
 *     complement — NOT the old "left after one page".
 *   - Average engagement time: only time the page was actually on screen
 *     (a backgrounded tab does not count), summed per session.
 *   - New user: their first event ever falls inside the window.
 *
 * ON DATABASE LOAD: every query here runs ONE AT A TIME, and the staff-visitor
 * list is resolved once and passed down as ids. Fanning these out with
 * Promise.all — and re-running the staff subquery inside each of them — put a
 * dozen table scans on the pooled Neon connection at once and the server closed
 * it mid-request (P1017/P1001). Each query returns in milliseconds; the route
 * also caches the whole result for 60s.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { num } from '@/lib/analytics-range';

/** Engaged-session threshold, matching GA4's default. */
const ENGAGED_MS = 10_000;
const IST = 'Asia/Kolkata';

/** Paid, not cancelled — money actually received. */
const PAID = Prisma.sql`o.payment_status = 'completed' AND o.order_status <> 'cancelled'`;
/** created_at as an IST wall-clock timestamp (the column is UTC). */
const istTime = (col: Prisma.Sql) => Prisma.sql`(${col} AT TIME ZONE 'UTC' AT TIME ZONE ${IST})`;

/**
 * An order placed by us rather than a customer. Mirrors isInternalCustomer:
 * a hotelicessentials.com address, or the word "test" as a whole word. The
 * POSIX pattern is used instead of ILIKE '%test%' so a genuine buyer named
 * "Testa" is not swept up.
 */
const INTERNAL_ORDER = (alias: string) => Prisma.raw(
  `(${alias}.customer_email ILIKE '%@hotelicessentials.com'` +
  ` OR (COALESCE(${alias}.customer_name, '') || ' ' || COALESCE(${alias}.customer_email, ''))` +
  ` ~* '(^|[^a-z])test([^a-z]|$)')`,
);

/**
 * Visitors to treat as staff: anyone whose tracked order is internal by email
 * or name — the same isInternalCustomer rule the Visits list, the abandoned-
 * checkout alerts and the Orders export all use.
 *
 * There used to be a second arm matching by PHONE ("shares a number with an
 * internal order"). It was wrong and is gone: staff place orders on a real
 * customer's behalf from the office email but with THAT customer's phone, so
 * the phone rule marked the customer as staff. It hid Amit Singh — a real
 * buyer who spent 43 minutes on a chafing dish on 17 Sep — and it made the
 * dashboard's visit count disagree with the Visits list (141 vs 146).
 *
 * Resolved ONCE per request and passed to the queries as a list of ids.
 */
async function staffVisitorIds(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ visitor_id: string }>>(Prisma.sql`
    SELECT DISTINCT e.visitor_id
    FROM analytics_events e
    JOIN orders o ON o.order_number = e.order_number
    WHERE e.visitor_id IS NOT NULL
      AND ${INTERNAL_ORDER('o')}`);
  return rows.map((r) => r.visitor_id);
}

/** `AND visitor_id NOT IN (…)`, or nothing when there is nobody to exclude. */
const notStaff = (ids: string[]) =>
  ids.length ? Prisma.sql`AND visitor_id NOT IN (${Prisma.join(ids)})` : Prisma.empty;

export interface MetricSet {
  users: number;
  newUsers: number;
  returningUsers: number;
  sessions: number;
  engagedSessions: number;
  /** 0-1. */
  engagementRate: number;
  /** 0-1, = 1 - engagementRate. */
  bounceRate: number;
  avgEngagementMs: number;
  views: number;
  viewsPerSession: number;
  eventCount: number;
  sessionsPerUser: number;
  productViewSessions: number;
  cartSessions: number;
  checkoutSessions: number;
  paymentSessions: number;
  /** Visits whose order was actually PAID. */
  convertedSessions: number;
  /** 0-1, converted sessions / sessions. */
  conversionRate: number;
  /** 0-1, cart sessions / sessions that saw a product. */
  cartRate: number;
  /** 0-1, of visits that reached checkout, how many did NOT pay. */
  checkoutAbandonRate: number;
  /** Store-wide paid orders in the window (not only tracked visits). */
  orders: number;
  revenue: number;
  aov: number;
  /** Revenue per visit — only meaningful once tracking covers the window. */
  revenuePerSession: number;
}

export interface SeriesPoint {
  day: string;
  users: number;
  newUsers: number;
  sessions: number;
  engagedSessions: number;
  views: number;
  avgEngagementMs: number;
  orders: number;
  revenue: number;
}

type WindowRow = {
  users: bigint; new_users: bigint; sessions: bigint; engaged: bigint;
  avg_engagement_ms: number | null; views: bigint; events: bigint;
  product_sessions: bigint; cart_sessions: bigint; checkout_sessions: bigint;
  payment_sessions: bigint; converted_sessions: bigint;
};

/**
 * One window's visitor metrics. `since`/`until` are absolute instants.
 *
 * The first-seen lookup deliberately scans ALL history, not the window — a
 * visitor who first came last week is "returning" today even though the window
 * only holds today.
 */
async function metricsFor(since: Date, until: Date, staffIds: string[]): Promise<MetricSet> {
  const rows = await prisma.$queryRaw<WindowRow[]>(Prisma.sql`
    WITH ev AS (
      SELECT * FROM analytics_events
      WHERE created_at >= ${since} AND created_at < ${until} AND session_id IS NOT NULL
        ${notStaff(staffIds)}
    ),
    pv AS (
      SELECT session_id, metadata->>'pv' AS pv, MAX(duration_ms) AS dur
      FROM ev WHERE event_type = 'page_leave' GROUP BY 1, 2
    ),
    eng AS (SELECT session_id, SUM(dur) AS engaged_ms FROM pv GROUP BY 1),
    s AS (
      SELECT session_id,
             MAX(visitor_id) AS visitor_id,
             MIN(created_at) AS started,
             COUNT(*) FILTER (WHERE event_type = 'page_view') AS views,
             COUNT(*) AS events,
             BOOL_OR(event_type = 'product_view') AS saw_product,
             BOOL_OR(event_type = 'add_to_cart') AS carted,
             BOOL_OR(event_type IN ('begin_checkout', 'checkout_submitted')
                     OR (event_type = 'page_view' AND path LIKE '/checkout%')) AS checkout,
             BOOL_OR(event_type = 'payment_opened') AS payment,
             MAX(order_number) AS order_number
      FROM ev GROUP BY session_id
    ),
    firstseen AS (
      SELECT visitor_id, MIN(created_at) AS first_at
      FROM analytics_events WHERE visitor_id IS NOT NULL GROUP BY 1
    ),
    j AS (
      SELECT s.*, COALESCE(eng.engaged_ms, 0) AS engaged_ms, f.first_at,
             (o.order_number IS NOT NULL AND ${PAID}) AS converted
      FROM s
      LEFT JOIN eng USING (session_id)
      LEFT JOIN firstseen f ON f.visitor_id = s.visitor_id
      LEFT JOIN orders o ON o.order_number = s.order_number
    )
    SELECT COUNT(DISTINCT visitor_id) AS users,
           COUNT(DISTINCT visitor_id) FILTER (WHERE first_at >= ${since}) AS new_users,
           COUNT(*) AS sessions,
           COUNT(*) FILTER (WHERE engaged_ms >= ${ENGAGED_MS} OR views >= 2 OR checkout) AS engaged,
           AVG(engaged_ms)::float AS avg_engagement_ms,
           COALESCE(SUM(views), 0) AS views,
           COALESCE(SUM(events), 0) AS events,
           COUNT(*) FILTER (WHERE saw_product) AS product_sessions,
           COUNT(*) FILTER (WHERE carted) AS cart_sessions,
           COUNT(*) FILTER (WHERE checkout) AS checkout_sessions,
           COUNT(*) FILTER (WHERE payment) AS payment_sessions,
           COUNT(*) FILTER (WHERE converted) AS converted_sessions
    FROM j`);

  const moneyRows = await prisma.$queryRaw<Array<{ orders: bigint; revenue: number | null }>>`
    SELECT COUNT(*) AS orders, COALESCE(SUM(o.total_amount), 0)::float AS revenue
    FROM orders o
    WHERE o.created_at >= ${since} AND o.created_at < ${until} AND ${PAID}`;

  const r = rows[0];
  const sessions = num(r?.sessions);
  const users = num(r?.users);
  const newUsers = num(r?.new_users);
  const engaged = num(r?.engaged);
  const views = num(r?.views);
  const productSessions = num(r?.product_sessions);
  const checkoutSessions = num(r?.checkout_sessions);
  const converted = num(r?.converted_sessions);
  const orders = num(moneyRows[0]?.orders);
  const revenue = moneyRows[0]?.revenue ?? 0;
  const rate = (a: number, b: number) => (b > 0 ? a / b : 0);

  return {
    users,
    newUsers,
    returningUsers: Math.max(0, users - newUsers),
    sessions,
    engagedSessions: engaged,
    engagementRate: rate(engaged, sessions),
    bounceRate: sessions ? 1 - rate(engaged, sessions) : 0,
    avgEngagementMs: r?.avg_engagement_ms ?? 0,
    views,
    viewsPerSession: rate(views, sessions),
    eventCount: num(r?.events),
    sessionsPerUser: rate(sessions, users),
    productViewSessions: productSessions,
    cartSessions: num(r?.cart_sessions),
    checkoutSessions,
    paymentSessions: num(r?.payment_sessions),
    convertedSessions: converted,
    conversionRate: rate(converted, sessions),
    cartRate: rate(num(r?.cart_sessions), productSessions),
    checkoutAbandonRate: checkoutSessions ? 1 - rate(converted, checkoutSessions) : 0,
    orders,
    revenue,
    aov: rate(revenue, orders),
    revenuePerSession: rate(revenue, sessions),
  };
}

/** Per-IST-day series for the chart: visitor metrics and money side by side. */
async function seriesFor(since: Date, until: Date, staffIds: string[]): Promise<SeriesPoint[]> {
  const visits = await prisma.$queryRaw<Array<{
    day: Date; users: bigint; new_users: bigint; sessions: bigint;
    engaged: bigint; views: bigint; avg_ms: number | null;
  }>>(Prisma.sql`
    WITH ev AS (
      SELECT * FROM analytics_events
      WHERE created_at >= ${since} AND created_at < ${until} AND session_id IS NOT NULL
        ${notStaff(staffIds)}
    ),
    pv AS (
      SELECT session_id, metadata->>'pv' AS pv, MAX(duration_ms) AS dur
      FROM ev WHERE event_type = 'page_leave' GROUP BY 1, 2
    ),
    eng AS (SELECT session_id, SUM(dur) AS engaged_ms FROM pv GROUP BY 1),
    s AS (
      SELECT session_id, MAX(visitor_id) AS visitor_id, MIN(created_at) AS started,
             COUNT(*) FILTER (WHERE event_type = 'page_view') AS views,
             BOOL_OR(event_type IN ('begin_checkout', 'checkout_submitted')) AS checkout
      FROM ev GROUP BY session_id
    ),
    firstseen AS (
      SELECT visitor_id, MIN(created_at) AS first_at
      FROM analytics_events WHERE visitor_id IS NOT NULL GROUP BY 1
    )
    SELECT DATE_TRUNC('day', ${istTime(Prisma.sql`s.started`)}) AS day,
           COUNT(DISTINCT s.visitor_id) AS users,
           COUNT(DISTINCT s.visitor_id) FILTER (WHERE f.first_at >= ${since}) AS new_users,
           COUNT(*) AS sessions,
           COUNT(*) FILTER (WHERE COALESCE(eng.engaged_ms, 0) >= ${ENGAGED_MS} OR s.views >= 2 OR s.checkout) AS engaged,
           COALESCE(SUM(s.views), 0) AS views,
           AVG(COALESCE(eng.engaged_ms, 0))::float AS avg_ms
    FROM s
    LEFT JOIN eng USING (session_id)
    LEFT JOIN firstseen f ON f.visitor_id = s.visitor_id
    GROUP BY 1 ORDER BY 1`);

  const money = await prisma.$queryRaw<Array<{ day: Date; orders: bigint; revenue: number | null }>>`
    SELECT DATE_TRUNC('day', ${istTime(Prisma.sql`o.created_at`)}) AS day,
           COUNT(*) AS orders, COALESCE(SUM(o.total_amount), 0)::float AS revenue
    FROM orders o
    WHERE o.created_at >= ${since} AND o.created_at < ${until} AND ${PAID}
    GROUP BY 1 ORDER BY 1`;

  const key = (d: Date) => d.toISOString().slice(0, 10);
  const byDay = new Map<string, SeriesPoint>();
  const blank = (day: string): SeriesPoint => ({
    day, users: 0, newUsers: 0, sessions: 0, engagedSessions: 0, views: 0, avgEngagementMs: 0, orders: 0, revenue: 0,
  });

  // Every day in the window, so a quiet day is a zero on the chart, not a gap.
  for (let t = Date.parse(key(since)); t <= Date.parse(key(new Date(until.getTime() - 1))); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    byDay.set(day, blank(day));
  }
  for (const v of visits) {
    const day = key(v.day);
    const p = byDay.get(day) ?? blank(day);
    p.users = num(v.users);
    p.newUsers = num(v.new_users);
    p.sessions = num(v.sessions);
    p.engagedSessions = num(v.engaged);
    p.views = num(v.views);
    p.avgEngagementMs = v.avg_ms ?? 0;
    byDay.set(day, p);
  }
  for (const m of money) {
    const day = key(m.day);
    const p = byDay.get(day) ?? blank(day);
    p.orders = num(m.orders);
    p.revenue = m.revenue ?? 0;
    byDay.set(day, p);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Dimension tables GA4 shows: landing pages, referrers, devices, hours, depth. */
async function breakdownsFor(since: Date, until: Date, staffIds: string[]) {
  const staff = notStaff(staffIds);

  const landing = await prisma.$queryRaw<Array<{ landing: string | null; sessions: bigint; engaged: bigint; converted: bigint }>>(Prisma.sql`
    WITH s AS (
      SELECT session_id,
             (ARRAY_AGG(metadata->>'landing' ORDER BY created_at) FILTER (WHERE event_type = 'session_start'))[1] AS landing,
             COUNT(*) FILTER (WHERE event_type = 'page_view') AS views,
             BOOL_OR(event_type IN ('begin_checkout', 'checkout_submitted')) AS checkout,
             MAX(order_number) AS order_number
      FROM analytics_events
      WHERE created_at >= ${since} AND created_at < ${until} AND session_id IS NOT NULL ${staff}
      GROUP BY session_id
    )
    SELECT split_part(COALESCE(s.landing, '/'), '?', 1) AS landing,
           COUNT(*) AS sessions,
           COUNT(*) FILTER (WHERE s.views >= 2 OR s.checkout) AS engaged,
           COUNT(*) FILTER (WHERE o.order_number IS NOT NULL AND ${PAID}) AS converted
    FROM s LEFT JOIN orders o ON o.order_number = s.order_number
    GROUP BY 1 ORDER BY sessions DESC LIMIT 20`);

  const referrers = await prisma.$queryRaw<Array<{ referrer: string | null; medium: string | null; campaign: string | null; sessions: bigint }>>(Prisma.sql`
    SELECT COALESCE(metadata->>'src', 'direct') AS referrer,
           metadata->>'medium' AS medium, metadata->>'campaign' AS campaign,
           COUNT(*) AS sessions
    FROM analytics_events
    WHERE created_at >= ${since} AND created_at < ${until} AND event_type = 'session_start' ${staff}
    GROUP BY 1, 2, 3 ORDER BY sessions DESC LIMIT 20`);

  const devices = await prisma.$queryRaw<Array<{ device: string | null; screen: string | null; sessions: bigint }>>(Prisma.sql`
    SELECT metadata->>'device' AS device, metadata->>'screen' AS screen, COUNT(*) AS sessions
    FROM analytics_events
    WHERE created_at >= ${since} AND created_at < ${until} AND event_type = 'session_start' ${staff}
    GROUP BY 1, 2 ORDER BY sessions DESC LIMIT 25`);

  const hours = await prisma.$queryRaw<Array<{ hour: number; sessions: bigint }>>(Prisma.sql`
    SELECT EXTRACT(HOUR FROM ${istTime(Prisma.sql`created_at`)})::int AS hour, COUNT(*) AS sessions
    FROM analytics_events
    WHERE created_at >= ${since} AND created_at < ${until} AND event_type = 'session_start' ${staff}
    GROUP BY 1 ORDER BY 1`);

  const depth = await prisma.$queryRaw<Array<{ path: string; views: bigint; avg_scroll: number | null; avg_ms: number | null }>>(Prisma.sql`
    SELECT split_part(path, '?', 1) AS path, COUNT(*) AS views,
           AVG((metadata->>'scroll')::numeric)::float AS avg_scroll,
           AVG(dur)::float AS avg_ms
    FROM (
      SELECT path, metadata, MAX(duration_ms) AS dur
      FROM analytics_events
      WHERE created_at >= ${since} AND created_at < ${until} AND event_type = 'page_leave' ${staff}
      GROUP BY path, metadata
    ) x
    GROUP BY 1 ORDER BY views DESC LIMIT 20`);

  const exits = await prisma.$queryRaw<Array<{ path: string; exits: bigint }>>(Prisma.sql`
    WITH last_page AS (
      SELECT DISTINCT ON (session_id) session_id, split_part(path, '?', 1) AS path
      FROM analytics_events
      WHERE created_at >= ${since} AND created_at < ${until} AND event_type = 'page_view' ${staff}
      ORDER BY session_id, created_at DESC
    )
    SELECT path, COUNT(*) AS exits FROM last_page GROUP BY 1 ORDER BY exits DESC LIMIT 15`);

  return {
    landingPages: landing.map((l) => ({
      path: l.landing || '/',
      sessions: num(l.sessions),
      engagedSessions: num(l.engaged),
      conversions: num(l.converted),
    })),
    referrers: referrers.map((r) => ({
      source: r.referrer || 'direct',
      medium: r.medium,
      campaign: r.campaign,
      sessions: num(r.sessions),
    })),
    devices: devices.map((d) => ({ device: d.device || 'unknown', screen: d.screen, sessions: num(d.sessions) })),
    hours: Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      sessions: num(hours.find((x) => x.hour === h)?.sessions ?? 0),
    })),
    scrollDepth: depth.map((d) => ({
      path: d.path,
      views: num(d.views),
      avgScroll: d.avg_scroll ?? 0,
      avgMs: d.avg_ms ?? 0,
    })),
    exitPages: exits.map((e) => ({ path: e.path, exits: num(e.exits) })),
  };
}

/** GA4's realtime card: who is on the site in the last 30 minutes. */
async function realtime(staffIds: string[]) {
  const since = new Date(Date.now() - 30 * 60_000);
  const staff = notStaff(staffIds);

  const rows = await prisma.$queryRaw<Array<{ users: bigint; sessions: bigint; views: bigint }>>(Prisma.sql`
    SELECT COUNT(DISTINCT visitor_id) AS users, COUNT(DISTINCT session_id) AS sessions,
           COUNT(*) FILTER (WHERE event_type = 'page_view') AS views
    FROM analytics_events WHERE created_at >= ${since} ${staff}`);

  const pages = await prisma.$queryRaw<Array<{ path: string; views: bigint }>>(Prisma.sql`
    SELECT split_part(path, '?', 1) AS path, COUNT(*) AS views
    FROM analytics_events
    WHERE created_at >= ${since} AND event_type = 'page_view' ${staff}
    GROUP BY 1 ORDER BY views DESC LIMIT 8`);

  return {
    users: num(rows[0]?.users),
    sessions: num(rows[0]?.sessions),
    views: num(rows[0]?.views),
    pages: pages.map((p) => ({ path: p.path, views: num(p.views) })),
  };
}

/** How many visits the staff filter is removing — shown in the UI so the
 *  exclusion is visible rather than a silent hand on the scale. */
async function staffSessions(since: Date, until: Date, staffIds: string[]): Promise<number> {
  if (!staffIds.length) return 0;
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events
    WHERE created_at >= ${since} AND created_at < ${until} AND session_id IS NOT NULL
      AND visitor_id IN (${Prisma.join(staffIds)})`);
  return num(rows[0]?.n);
}

/**
 * Everything the Overview needs: this window, the window before it (same
 * length, for the % change), the daily series, dimension tables and realtime.
 *
 * `trackingSince` lets the UI say "this range is older than our tracking"
 * instead of drawing a confident flat zero.
 */
export async function getMetrics(days: number, hideStaff = true) {
  const until = new Date();
  const since = new Date(until.getTime() - days * 86_400_000);
  const prevSince = new Date(since.getTime() - days * 86_400_000);

  // Resolved once, then passed down — see the note on database load above.
  const allStaff = await staffVisitorIds();
  const staffIds = hideStaff ? allStaff : [];

  const current = await metricsFor(since, until, staffIds);
  const previous = await metricsFor(prevSince, since, staffIds);
  const series = await seriesFor(since, until, staffIds);
  const breakdowns = await breakdownsFor(since, until, staffIds);
  const live = await realtime(staffIds);
  const excludedSessions = hideStaff ? await staffSessions(since, until, allStaff) : 0;
  const firstRow = await prisma.$queryRaw<Array<{ first: Date | null }>>`
    SELECT MIN(created_at) AS first FROM analytics_events WHERE session_id IS NOT NULL`;

  const trackingSince = firstRow[0]?.first ?? null;
  return {
    days,
    hideStaff,
    range: { since, until },
    trackingSince,
    /** True when the window starts before tracking did — visitor metrics are partial. */
    partialWindow: !!trackingSince && trackingSince > since,
    /** Visits the staff filter removed from this window. */
    excludedSessions,
    current,
    previous,
    series,
    breakdowns,
    realtime: live,
  };
}
