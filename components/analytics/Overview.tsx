'use client';

/**
 * Analytics Overview — modelled on Google Search Console's report page and
 * GA4's snapshot.
 *
 * The GSC idea, which is what makes this readable: the metric cards along the
 * top ARE the chart legend. Click a card to add or remove its line. Every card
 * carries its own change against the previous equal-length window, so a number
 * is never shown without the context of where it came from.
 *
 * Definitions (engaged session, engagement rate, new vs returning) come from
 * lib/analytics-metrics.ts and follow GA4, so the words mean the same thing
 * they do in Google Analytics.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api, inr } from '@/lib/fetch';

interface MetricSet {
  users: number; newUsers: number; returningUsers: number; sessions: number;
  engagedSessions: number; engagementRate: number; bounceRate: number; avgEngagementMs: number;
  views: number; viewsPerSession: number; eventCount: number; sessionsPerUser: number;
  productViewSessions: number; cartSessions: number; checkoutSessions: number; paymentSessions: number;
  convertedSessions: number; conversionRate: number; cartRate: number; checkoutAbandonRate: number;
  orders: number; revenue: number; aov: number; revenuePerSession: number;
}
interface SeriesPoint {
  day: string; users: number; newUsers: number; sessions: number; engagedSessions: number;
  views: number; avgEngagementMs: number; orders: number; revenue: number;
}
interface Metrics {
  days: number;
  hideStaff: boolean;
  trackingSince: string | null;
  partialWindow: boolean;
  excludedSessions: number;
  current: MetricSet;
  previous: MetricSet;
  series: SeriesPoint[];
  breakdowns: {
    landingPages: Array<{ path: string; sessions: number; engagedSessions: number; conversions: number }>;
    referrers: Array<{ source: string; medium: string | null; campaign: string | null; sessions: number }>;
    devices: Array<{ device: string; screen: string | null; sessions: number }>;
    hours: Array<{ hour: number; sessions: number }>;
    scrollDepth: Array<{ path: string; views: number; avgScroll: number; avgMs: number }>;
    exitPages: Array<{ path: string; exits: number }>;
  };
  realtime: { users: number; sessions: number; views: number; pages: Array<{ path: string; views: number }> };
}

const STORE = 'https://kitchenarykart.com';

const int = (n: number) => n.toLocaleString('en-IN');
const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;
function fmtDur(ms: number): string {
  if (!ms) return '0s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
const istDay = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

/** The four series the chart can draw — the GSC-style toggle cards. */
type ChartKey = 'users' | 'sessions' | 'views' | 'revenue';
const CHART_METRICS: Array<{
  key: ChartKey;
  label: string;
  colour: string;
  axis: 'left' | 'right';
  value: (m: MetricSet) => number;
  format: (n: number) => string;
  hint: string;
}> = [
  { key: 'users', label: 'Visitors', colour: '#a01818', axis: 'left', value: (m) => m.users, format: int,
    hint: 'unique people' },
  { key: 'sessions', label: 'Visits', colour: '#0369a1', axis: 'left', value: (m) => m.sessions, format: int,
    hint: 'a visit ends after 30 min idle' },
  { key: 'views', label: 'Page views', colour: '#7c3aed', axis: 'left', value: (m) => m.views, format: int,
    hint: 'pages opened' },
  { key: 'revenue', label: 'Revenue', colour: '#047857', axis: 'right', value: (m) => m.revenue, format: inr,
    hint: 'paid orders only' },
];

/** Change vs the previous window. Null when there is no base to compare to. */
function delta(now: number, before: number): { pct: number; up: boolean } | null {
  if (!before) return null;
  const change = (now - before) / before;
  if (!Number.isFinite(change)) return null;
  return { pct: change, up: change >= 0 };
}

function Delta({ now, before, invert = false }: { now: number; before: number; invert?: boolean }) {
  const d = delta(now, before);
  if (!d) return <span className="text-xs text-slate-400">no earlier data</span>;
  // For "bad when it rises" metrics (bounce, abandonment) green means down.
  const good = invert ? !d.up : d.up;
  const cls = Math.abs(d.pct) < 0.005 ? 'text-slate-500' : good ? 'text-emerald-600' : 'text-red-600';
  return (
    <span className={`text-xs font-medium ${cls}`}>
      {d.up ? '▲' : '▼'} {Math.abs(d.pct * 100).toFixed(1)}%
    </span>
  );
}

export function Overview({ days }: { days: number }) {
  const [hideStaff, setHideStaff] = useState(true);
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ChartKey[]>(['users', 'sessions']);

  useEffect(() => {
    setData(null);
    setError('');
    api<Metrics>(`/api/analytics/metrics?days=${days}&staff=${hideStaff ? '0' : '1'}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load analytics'));
  }, [days, hideStaff]);

  const chartData = useMemo(
    () => (data?.series ?? []).map((p) => ({ ...p, label: istDay(p.day) })),
    [data],
  );

  if (error) return <div className="notice-red">{error}</div>;
  if (!data) return <div className="card p-10 text-center text-slate-400">Loading…</div>;

  const c = data.current;
  const p = data.previous;
  const toggle = (k: ChartKey) =>
    setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  return (
    <div className="space-y-5">
      <Notices data={data} hideStaff={hideStaff} onToggleStaff={setHideStaff} />

      {/* ---------- GSC-style toggle cards + one shared chart ---------- */}
      <section className="card overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-slate-200 border-b border-slate-200">
          {CHART_METRICS.map((m) => {
            const on = selected.includes(m.key);
            return (
              <button
                key={m.key}
                onClick={() => toggle(m.key)}
                className={`relative px-4 py-3 text-left transition-colors ${on ? 'bg-white' : 'bg-slate-50 hover:bg-white'}`}
                aria-pressed={on}
              >
                <span
                  className="absolute inset-x-0 top-0 h-1 transition-opacity"
                  style={{ background: m.colour, opacity: on ? 1 : 0 }}
                />
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: on ? m.colour : '#cbd5e1' }}
                  />
                  {m.label}
                </div>
                <div className={`mt-1 text-2xl font-semibold ${on ? 'text-slate-900' : 'text-slate-500'}`}>
                  {m.format(m.value(c))}
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <Delta now={m.value(c)} before={m.value(p)} />
                  <span className="text-xs text-slate-400">{m.hint}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="p-4">
          {selected.length === 0 ? (
            <div className="h-72 grid place-items-center text-sm text-slate-400">
              Pick a metric above to chart it.
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="label" fontSize={12} stroke="#94a3b8" tickMargin={8} minTickGap={16} />
                  <YAxis yAxisId="left" fontSize={12} stroke="#94a3b8" allowDecimals={false} width={44} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    fontSize={12}
                    stroke="#94a3b8"
                    width={52}
                    tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                  />
                  <Tooltip
                    formatter={(v: number, name: string) =>
                      name === 'Revenue' ? inr(v) : int(v)
                    }
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {CHART_METRICS.filter((m) => selected.includes(m.key)).map((m) => (
                    <Line
                      key={m.key}
                      yAxisId={m.axis}
                      type="monotone"
                      dataKey={m.key}
                      name={m.label}
                      stroke={m.colour}
                      strokeWidth={2}
                      dot={chartData.length <= 14 ? { r: 3 } : false}
                      activeDot={{ r: 5 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>

      {/* ---------- GA4-style engagement + money snapshot ---------- */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat label="Engagement rate" value={pct1(c.engagementRate)}
          delta={<Delta now={c.engagementRate} before={p.engagementRate} />}
          hint="visits that lasted 10s+, saw 2+ pages, or reached checkout" />
        <Stat label="Avg engagement time" value={fmtDur(c.avgEngagementMs)}
          delta={<Delta now={c.avgEngagementMs} before={p.avgEngagementMs} />}
          hint="per visit, screen time only" />
        <Stat label="Pages per visit" value={c.viewsPerSession.toFixed(2)}
          delta={<Delta now={c.viewsPerSession} before={p.viewsPerSession} />} />
        <Stat label="Visits per visitor" value={c.sessionsPerUser.toFixed(2)}
          delta={<Delta now={c.sessionsPerUser} before={p.sessionsPerUser} />}
          hint="above 1.0 means people come back" />

        <Stat label="New vs returning" value={`${int(c.newUsers)} / ${int(c.returningUsers)}`}
          hint={c.users ? `${pct1(c.newUsers / c.users)} first-time` : undefined} />
        <Stat label="Bounce rate" value={pct1(c.bounceRate)}
          delta={<Delta now={c.bounceRate} before={p.bounceRate} invert />}
          hint="the opposite of engagement rate" />
        <Stat label="Conversion rate" value={pct1(c.conversionRate)}
          delta={<Delta now={c.conversionRate} before={p.conversionRate} />}
          hint="visits that ended in a PAID order" />
        <Stat label="Revenue per visit" value={inr(Math.round(c.revenuePerSession))}
          hint="paid revenue ÷ visits" />

        <Stat label="Paid orders" value={int(c.orders)}
          delta={<Delta now={c.orders} before={p.orders} />}
          hint="whole store, not only tracked visits" />
        <Stat label="Average order value" value={inr(Math.round(c.aov))}
          delta={<Delta now={c.aov} before={p.aov} />} />
        <Stat label="Added to cart" value={int(c.cartSessions)}
          hint={c.productViewSessions ? `${pct1(c.cartRate)} of visits that saw a product` : undefined} />
        <Stat label="Checkout abandonment" value={c.checkoutSessions ? pct1(c.checkoutAbandonRate) : '—'}
          hint={`${int(c.checkoutSessions)} visit(s) reached checkout`} />
      </div>

      <Funnel c={c} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Breakdowns b={data.breakdowns} />
        <div className="space-y-5">
          <Realtime rt={data.realtime} />
          <Hours hours={data.breakdowns.hours} />
        </div>
      </div>
    </div>
  );
}

function Notices({
  data, hideStaff, onToggleStaff,
}: { data: Metrics; hideStaff: boolean; onToggleStaff: (v: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {data.partialWindow && data.trackingSince && (
        <div className="notice-amber flex-1 min-w-[280px]">
          Visitor tracking only starts{' '}
          {new Date(data.trackingSince).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
          })}
          , so visitor figures cover part of this range. Orders and revenue are complete.
        </div>
      )}
      <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={hideStaff} onChange={(e) => onToggleStaff(e.target.checked)} />
        Hide our own test visits
        {hideStaff && data.excludedSessions > 0 && (
          <span className="pill-gray">{data.excludedSessions} hidden</span>
        )}
      </label>
    </div>
  );
}

function Stat({
  label, value, delta, hint,
}: { label: string; value: string; delta?: React.ReactNode; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold text-slate-900">{value}</span>
        {delta}
      </div>
      {hint && <div className="mt-1 text-xs leading-snug text-slate-400">{hint}</div>}
    </div>
  );
}

/** The path to a sale, each step as a share of visits. */
function Funnel({ c }: { c: MetricSet }) {
  const steps = [
    { label: 'Visited the site', n: c.sessions },
    { label: 'Viewed a product', n: c.productViewSessions },
    { label: 'Added to cart', n: c.cartSessions },
    { label: 'Reached checkout', n: c.checkoutSessions },
    { label: 'Opened payment', n: c.paymentSessions },
    { label: 'Paid', n: c.convertedSessions },
  ];
  const top = steps[0].n || 0;
  return (
    <section className="card p-5">
      <h2 className="font-semibold">Path to a sale</h2>
      <p className="mb-4 mt-0.5 text-xs text-slate-500">
        Visits reaching each step. &ldquo;Paid&rdquo; is checked against the orders table, not a browser
        event — a payment confirmed later still counts.
      </p>
      <div className="space-y-2.5">
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1].n : s.n;
          const drop = i > 0 ? prev - s.n : 0;
          return (
            <div key={s.label} className="grid grid-cols-[150px_1fr_150px] items-center gap-3 text-sm">
              <div className="text-slate-700">{s.label}</div>
              <div className="h-7 overflow-hidden rounded bg-slate-100">
                <div
                  className="h-full rounded bg-brand/80"
                  style={{ width: top ? `${Math.max(1.5, (s.n / top) * 100)}%` : '0%' }}
                />
              </div>
              <div className="text-right tabular-nums">
                <span className="font-semibold">{int(s.n)}</span>
                <span className="text-slate-500"> · {top ? pct1(s.n / top) : '—'}</span>
                {drop > 0 && <span className="ml-2 text-red-600">−{int(drop)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

type BreakTab = 'landing' | 'sources' | 'devices' | 'depth' | 'exits';
const BREAK_TABS: Array<{ v: BreakTab; label: string }> = [
  { v: 'landing', label: 'Landing pages' },
  { v: 'sources', label: 'Sources' },
  { v: 'devices', label: 'Devices' },
  { v: 'depth', label: 'Read depth' },
  { v: 'exits', label: 'Exit pages' },
];

/** One table per dimension, each row carrying a share-of-total bar. */
function Breakdowns({ b }: { b: Metrics['breakdowns'] }) {
  const [tab, setTab] = useState<BreakTab>('landing');

  const rows: Array<{ key: string; label: React.ReactNode; value: number; extra?: React.ReactNode }> =
    tab === 'landing'
      ? b.landingPages.map((l) => ({
          key: l.path,
          label: <PathLink path={l.path} />,
          value: l.sessions,
          extra: (
            <span className="text-slate-500">
              {l.sessions ? pct1(l.engagedSessions / l.sessions) : '—'} engaged
              {l.conversions > 0 && <span className="ml-2 text-emerald-700">{l.conversions} sold</span>}
            </span>
          ),
        }))
      : tab === 'sources'
        ? b.referrers.map((r) => ({
            key: `${r.source}|${r.medium}|${r.campaign}`,
            label: <span className="text-slate-800">{r.source}</span>,
            value: r.sessions,
            extra: r.campaign ? <span className="text-slate-500">{r.campaign}</span> : undefined,
          }))
        : tab === 'devices'
          ? b.devices.map((d) => ({
              key: `${d.device}|${d.screen}`,
              label: <span className="capitalize text-slate-800">{d.device}</span>,
              value: d.sessions,
              extra: <span className="text-slate-400">{d.screen}</span>,
            }))
          : tab === 'depth'
            ? b.scrollDepth.map((d) => ({
                key: d.path,
                label: <PathLink path={d.path} />,
                value: Math.round(d.avgScroll),
                extra: (
                  <span className="text-slate-500">
                    {int(d.views)} views · {fmtDur(d.avgMs)}
                  </span>
                ),
              }))
            : b.exitPages.map((e) => ({
                key: e.path,
                label: <PathLink path={e.path} />,
                value: e.exits,
              }));

  const max = Math.max(1, ...rows.map((r) => r.value));
  const isPctValue = tab === 'depth';

  return (
    <section className="card">
      <div className="flex flex-wrap gap-1 border-b border-slate-200 px-3 pt-3">
        {BREAK_TABS.map((t) => (
          <button
            key={t.v}
            onClick={() => setTab(t.v)}
            className={`tab-pill ${tab === t.v ? 'tab-pill-active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'depth' && (
        <p className="px-4 pt-3 text-xs text-slate-500">
          How far down the page people actually get, and how long they stay. A low number on a long
          product page means the detail below is never seen.
        </p>
      )}
      <div className="divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.key} className="px-4 py-2.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <div className="min-w-0 flex-1 truncate">{r.label}</div>
              <div className="tabular-nums font-medium text-slate-900">
                {isPctValue ? `${r.value}%` : int(r.value)}
              </div>
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-slate-100">
                <div className="h-full rounded bg-brand/60" style={{ width: `${(r.value / max) * 100}%` }} />
              </div>
              {r.extra && <div className="whitespace-nowrap text-xs">{r.extra}</div>}
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="p-8 text-center text-slate-400">Nothing in this range.</div>}
      </div>
    </section>
  );
}

function PathLink({ path }: { path: string }) {
  return (
    <a href={STORE + path} target="_blank" rel="noreferrer" className="text-slate-800 hover:text-brand">
      {path}
    </a>
  );
}

function Realtime({ rt }: { rt: Metrics['realtime'] }) {
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        <h2 className="font-semibold">Right now</h2>
        <span className="text-xs text-slate-500">last 30 minutes</span>
      </div>
      <div className="mt-3 flex gap-6">
        <div>
          <div className="text-2xl font-semibold text-slate-900">{int(rt.users)}</div>
          <div className="text-xs text-slate-500">visitors</div>
        </div>
        <div>
          <div className="text-2xl font-semibold text-slate-900">{int(rt.views)}</div>
          <div className="text-xs text-slate-500">page views</div>
        </div>
      </div>
      <div className="mt-3 space-y-1">
        {rt.pages.map((p) => (
          <div key={p.path} className="flex justify-between gap-3 text-sm">
            <PathLink path={p.path} />
            <span className="tabular-nums text-slate-500">{p.views}</span>
          </div>
        ))}
        {rt.pages.length === 0 && <div className="text-sm text-slate-400">Nobody on the site right now.</div>}
      </div>
    </section>
  );
}

/** When India shops — drives when to post, call and run offers. */
function Hours({ hours }: { hours: Array<{ hour: number; sessions: number }> }) {
  const max = Math.max(1, ...hours.map((h) => h.sessions));
  const busiest = hours.reduce((a, b) => (b.sessions > a.sessions ? b : a), hours[0]);
  return (
    <section className="card p-5">
      <h2 className="font-semibold">Busiest time of day</h2>
      <p className="mb-3 mt-0.5 text-xs text-slate-500">
        Visits by hour, IST{busiest?.sessions ? ` · peak around ${String(busiest.hour).padStart(2, '0')}:00` : ''}
      </p>
      <div className="flex h-24 items-end gap-[3px]">
        {hours.map((h) => (
          <div key={h.hour} className="group relative flex-1" title={`${String(h.hour).padStart(2, '0')}:00 — ${h.sessions} visit(s)`}>
            <div
              className="w-full rounded-t bg-brand/70 transition-colors group-hover:bg-brand"
              style={{ height: `${Math.max(2, (h.sessions / max) * 96)}px` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>
    </section>
  );
}
