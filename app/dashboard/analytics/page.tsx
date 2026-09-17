'use client';

/**
 * Analytics — what visitors do on the storefront, not just what sold.
 *
 * Overview: totals, the checkout funnel with drop-offs, sources, cities,
 * top pages, searches and key taps. Visitors: every visit with its full
 * step-by-step timeline. Products: interest vs sales per product. Sales: the
 * revenue chart and top sellers that used to be the whole page.
 *
 * Visitor data comes from first-party tracking (web/lib/track.ts); it starts
 * from the deploy that added it, so older periods show sales only.
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, inr } from '@/lib/fetch';
import { SalesChart } from '@/components/SalesChart';
import { Overview } from '@/components/analytics/Overview';

type Tab = 'overview' | 'visitors' | 'products' | 'sales';
const TABS: Array<{ v: Tab; label: string }> = [
  { v: 'overview', label: 'Overview' },
  { v: 'visitors', label: 'Visitors' },
  { v: 'products', label: 'Products' },
  { v: 'sales', label: 'Sales' },
];
// 28 days is GA4's default month; 365 is there because sales history goes back
// far further than visitor tracking does.
const RANGES = [
  { v: 1, label: 'Today' },
  { v: 7, label: '7 days' },
  { v: 28, label: '28 days' },
  { v: 90, label: '90 days' },
  { v: 365, label: '12 months' },
];
const FILTERS = [
  { v: 'all', label: 'All visits' },
  { v: 'engaged', label: '2+ pages' },
  { v: 'cart', label: 'Added to cart' },
  { v: 'checkout', label: 'Reached checkout' },
  { v: 'payment', label: 'Opened payment' },
  { v: 'buyers', label: 'Bought' },
  { v: 'known', label: 'Known customers' },
];
const STORE = 'https://kitchenarykart.com';

const STEPS: Record<string, { label: string; cls: string }> = {
  paid: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-800' },
  payment_failed: { label: 'Payment failed', cls: 'bg-red-100 text-red-800' },
  payment: { label: 'Opened payment', cls: 'bg-orange-100 text-orange-800' },
  details: { label: 'Filled details', cls: 'bg-amber-100 text-amber-800' },
  checkout: { label: 'Opened checkout', cls: 'bg-yellow-100 text-yellow-800' },
  cart: { label: 'Added to cart', cls: 'bg-sky-100 text-sky-800' },
  viewed: { label: 'Viewed products', cls: 'bg-slate-100 text-slate-700' },
  browsed: { label: 'Browsed', cls: 'bg-slate-50 text-slate-500' },
};

interface Traffic {
  days: number;
  trackingSince: string | null;
  totals: { visitors: number; sessions: number; pageviews: number; avgActiveMs: number; bounceRate: number; pagesPerSession: number };
  funnel: Array<{ key: string; label: string; n: number }>;
  devices: Array<{ device: string; n: number }>;
  sources: Array<{ source: string; sessions: number; carts: number; buyers: number }>;
  cities: Array<{ city: string | null; region: string | null; country: string | null; n: number }>;
  pages: Array<{ path: string; views: number; visitors: number; avgMs: number }>;
  products: Array<{ sku: string; name: string | null; viewers: number; views: number; carted: number; sold: number }>;
  searches: Array<{ q: string; n: number }>;
  actions: Record<string, number>;
}
interface SessionRow {
  sessionId: string;
  visitorId: string | null;
  started: string;
  pages: number;
  products: number;
  viewed: string[];
  activeMs: number;
  step: string;
  orderNumber: string | null;
  source: string;
  device: string | null;
  city: string | null;
  region: string | null;
  landing: string | null;
  person: { name: string | null; phone: string | null; email: string | null; paidOrders: number; internal: boolean } | null;
}
interface TimelineEvent {
  type: string;
  at: string;
  offsetMs: number;
  path: string | null;
  sku: string | null;
  orderNumber: string | null;
  durationMs: number | null;
  scroll: number | null;
  data: Record<string, unknown>;
}
interface SessionDetail {
  sessionId: string;
  visitor: {
    sessions: number;
    firstSeen: string | null;
    orders: Array<{ orderNumber: string; customerName: string | null; customerPhone: string | null; paymentStatus: string; totalAmount: number }>;
  } | null;
  timeline: TimelineEvent[];
}
interface TopProduct { id: number; sku: string; name: string; category: string | null; unitsSold: number; totalRevenue: number; ordersCount: number }

function fmtDur(ms: number | null | undefined): string {
  if (!ms) return '—';
  if (ms < 1000) return '<1s';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h) return `${h}h ${m % 60}m`;
  if (m) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const ist = (d: string) =>
  new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const clock = (d: string) =>
  new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const money = (v: unknown) => (typeof v === 'number' ? inr(v) : '');

export default function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [days, setDays] = useState(7);

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Analytics</h1>
        <div className="flex flex-wrap items-center gap-2">
          {tab !== 'sales' && (
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
              {RANGES.map((r) => (
                <button
                  key={r.v}
                  onClick={() => setDays(r.v)}
                  className={`px-3 py-1.5 text-sm rounded-md ${days === r.v ? 'bg-white shadow text-slate-900 font-medium' : 'text-slate-600'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
          {/* Everything on this dashboard for the chosen range as one Excel
              workbook, for the owner's own analysis (lib/analytics-export.ts).
              Staff test visits are left out, same as the default view. */}
          <a
            href={`/api/analytics/export?days=${days}`}
            className="btn-outline gap-1.5 text-sm"
            download
            title={`Summary, daily, every visit, paid orders, products and breakdowns — last ${RANGES.find((r) => r.v === days)?.label ?? `${days} days`}`}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export to Excel
          </a>
        </div>
      </div>

      <div className="flex gap-6 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.v}
            onClick={() => setTab(t.v)}
            className={`pb-2 -mb-px text-sm font-medium border-b-2 ${tab === t.v ? 'border-red-700 text-red-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview days={days} />}
      {tab === 'visitors' && <Visitors days={days} />}
      {tab === 'products' && <Products days={days} />}
      {tab === 'sales' && <Sales />}
    </div>
  );
}

function useTraffic(days: number) {
  const [data, setData] = useState<Traffic | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setData(null);
    setError('');
    api<Traffic>(`/api/analytics/traffic?days=${days}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load analytics'));
  }, [days]);
  return { data, error };
}

function NoTrackingYet({ since }: { since: string | null }) {
  if (since) {
    return <p className="text-xs text-slate-500">Visitor tracking since {ist(since)}.</p>;
  }
  return (
    <div className="card p-4 text-sm text-amber-800 bg-amber-50 border-amber-200">
      No visitor data yet. Tracking starts once the storefront update is live; visits appear here within a minute.
    </div>
  );
}

function Visitors({ days }: { days: number }) {
  const [filter, setFilter] = useState('all');
  const [hideStaff, setHideStaff] = useState(true);
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    setRows(null);
    setError('');
    api<{ sessions: SessionRow[] }>(`/api/analytics/sessions?days=${days}&filter=${filter}&hideStaff=${hideStaff ? 1 : 0}`)
      .then((d) => setRows(d.sessions))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load visits'));
  }, [days, filter, hideStaff]);
  useEffect(load, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.v}
            onClick={() => setFilter(f.v)}
            className={`px-3 py-1.5 text-sm rounded-full border ${filter === f.v ? 'bg-red-700 text-white border-red-700' : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'}`}
          >
            {f.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={hideStaff} onChange={(e) => setHideStaff(e.target.checked)} />
          Hide staff test visits
        </label>
      </div>

      <section className="card overflow-x-auto">
        {error && <div className="p-6 text-red-700">{error}</div>}
        {!rows && !error && <div className="p-8 text-center text-slate-400">Loading…</div>}
        {rows && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Who</th>
                <th className="px-3 py-2 text-left">From</th>
                <th className="px-3 py-2 text-right">Pages</th>
                <th className="px-3 py-2 text-left">Products looked at</th>
                <th className="px-3 py-2 text-right">Time</th>
                <th className="px-3 py-2 text-left">Got to</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const step = STEPS[r.step] ?? STEPS.browsed;
                return (
                  <Fragment key={r.sessionId}>
                    <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(open === r.sessionId ? null : r.sessionId)}>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">{ist(r.started)}</td>
                      <td className="px-3 py-2">
                        {r.person ? (
                          <div>
                            <div className="font-medium text-slate-900">{r.person.name || 'Customer'}{r.person.internal && <span className="ml-1 text-xs text-slate-400">(staff)</span>}</div>
                            <div className="text-xs text-slate-500">{r.person.phone}{r.person.paidOrders > 0 && ` · ${r.person.paidOrders} paid order${r.person.paidOrders === 1 ? '' : 's'}`}</div>
                          </div>
                        ) : (
                          <span className="text-slate-500">Visitor {r.visitorId?.slice(0, 6)}</span>
                        )}
                        <div className="text-xs text-slate-400">{[r.city, r.device].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{r.source}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.pages}</td>
                      <td className="px-3 py-2 text-slate-700 max-w-[320px]">
                        <div className="truncate">{r.viewed.join(', ') || '—'}</div>
                        {r.products > r.viewed.length && <div className="text-xs text-slate-400">+{r.products - r.viewed.length} more</div>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtDur(r.activeMs)}</td>
                      <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs font-medium ${step.cls}`}>{step.label}</span></td>
                    </tr>
                    {open === r.sessionId && (
                      <tr>
                        <td colSpan={7} className="bg-slate-50 px-4 py-4"><SessionTimeline id={r.sessionId} /></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-400">No visits match.</td></tr>}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function describe(e: TimelineEvent): { title: string; detail?: string; tone?: string } {
  const d = e.data;
  switch (e.type) {
    case 'session_start': {
      const where = [str(d.city), str(d.region)].filter(Boolean).join(', ');
      return { title: `Arrived from ${str(d.src) || 'direct'}`, detail: [str(d.device), where, str(d.campaign) && `campaign ${str(d.campaign)}`].filter(Boolean).join(' · ') };
    }
    case 'page_view':
      return { title: e.path || '/', detail: `${fmtDur(e.durationMs)} on page${e.scroll ? ` · scrolled ${e.scroll}%` : ''}` };
    case 'product_view':
      return { title: `Looked at ${str(d.name) || e.sku}`, detail: money(d.price) };
    case 'add_to_cart':
      return { title: `Added to cart: ${str(d.name) || e.sku}`, detail: `${money(d.price)} × ${str(d.qty) || 1}`, tone: 'text-sky-800' };
    case 'remove_from_cart':
      return { title: `Removed from cart: ${e.sku}` };
    case 'begin_checkout':
      return { title: 'Clicked Checkout', detail: `${money(d.total)} · ${str(d.items)} item(s)`, tone: 'text-amber-800' };
    case 'checkout_submitted':
      return { title: `Filled address — order ${e.orderNumber} created`, detail: money(d.total), tone: 'text-amber-800' };
    case 'payment_opened':
      return { title: 'Opened Razorpay payment', tone: 'text-orange-800' };
    case 'payment_failed':
      return { title: 'Payment failed', detail: str(d.reason), tone: 'text-red-700' };
    case 'payment_dismissed':
      return { title: 'Closed the payment window', tone: 'text-red-700' };
    case 'purchase':
      return { title: `PAID — order ${e.orderNumber}`, detail: money(d.total), tone: 'text-emerald-700 font-semibold' };
    case 'whatsapp_click':
      return { title: 'Tapped WhatsApp', tone: 'text-emerald-700' };
    case 'call_click':
      return { title: 'Tapped Call', tone: 'text-emerald-700' };
    case 'click':
      return { title: `Clicked ${str(d.name)}` };
    default:
      return { title: e.type };
  }
}

function SessionTimeline({ id }: { id: string }) {
  const [data, setData] = useState<SessionDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<SessionDetail>(`/api/analytics/sessions/${id}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load visit'));
  }, [id]);
  if (error) return <div className="text-red-700 text-sm">{error}</div>;
  if (!data) return <div className="text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-3">
      {data.visitor && (
        <div className="text-xs text-slate-600">
          This visitor: {data.visitor.sessions} visit{data.visitor.sessions === 1 ? '' : 's'}
          {data.visitor.firstSeen && `, first seen ${ist(data.visitor.firstSeen)}`}
          {data.visitor.orders.length > 0 && (
            <> · orders: {data.visitor.orders.map((o) => `${o.orderNumber} (${o.customerName ?? ''}, ${inr(o.totalAmount)}, ${o.paymentStatus})`).join('; ')}</>
          )}
        </div>
      )}
      <ol className="relative border-l-2 border-slate-200 ml-2 space-y-2">
        {data.timeline.map((e, i) => {
          const x = describe(e);
          return (
            <li key={i} className="ml-4">
              <span className="absolute -left-[5px] mt-1.5 h-2 w-2 rounded-full bg-slate-400" />
              <div className="flex flex-wrap gap-x-3 text-sm">
                <span className="text-slate-400 tabular-nums w-16">{clock(e.at)}</span>
                <span className="text-slate-400 tabular-nums w-14">+{fmtDur(e.offsetMs) === '—' ? '0s' : fmtDur(e.offsetMs)}</span>
                <span className={x.tone ?? 'text-slate-800'}>
                  {e.type === 'page_view' && e.path ? (
                    <a href={STORE + e.path} target="_blank" rel="noreferrer" className="hover:underline break-all">{x.title}</a>
                  ) : (
                    x.title
                  )}
                </span>
                {x.detail && <span className="text-slate-500">{x.detail}</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Products({ days }: { days: number }) {
  const { data, error } = useTraffic(days);
  if (error) return <div className="card p-6 text-red-700">{error}</div>;
  if (!data) return <div className="card p-8 text-center text-slate-400">Loading…</div>;
  return (
    <div className="space-y-3">
      <NoTrackingYet since={data.trackingSince} />
      <section className="card overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-200">
          <div className="font-semibold">Product interest</div>
          <div className="text-xs text-slate-500">Most looked-at products, how many visitors added them to cart, and how many were actually sold (paid orders) in the same period.</div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-2 text-left">Product</th>
              <th className="px-4 py-2 text-right">Visitors viewed</th>
              <th className="px-4 py-2 text-right">Views</th>
              <th className="px-4 py-2 text-right">Added to cart</th>
              <th className="px-4 py-2 text-right">Cart rate</th>
              <th className="px-4 py-2 text-right">Sold (units)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.products.map((p) => (
              <tr key={p.sku}>
                <td className="px-4 py-2">
                  <a href={`${STORE}/product/${encodeURIComponent(p.sku)}`} target="_blank" rel="noreferrer" className="text-slate-900 hover:text-red-700">{p.name || p.sku}</a>
                  <div className="font-mono text-xs text-slate-400">{p.sku}</div>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{p.viewers}</td>
                <td className="px-4 py-2 text-right tabular-nums">{p.views}</td>
                <td className="px-4 py-2 text-right tabular-nums">{p.carted}</td>
                <td className="px-4 py-2 text-right tabular-nums">{pct(p.carted, p.viewers)}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium">{p.sold}</td>
              </tr>
            ))}
            {data.products.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400">No product views yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Sales() {
  const [products, setProducts] = useState<TopProduct[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<{ products: TopProduct[] }>('/api/analytics/top-products')
      .then((d) => setProducts(d.products))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div className="space-y-6">
      <section className="card p-6">
        <h2 className="font-semibold mb-3">Sales trend · last 60 days</h2>
        <SalesChart />
      </section>
      <section className="card">
        <div className="px-4 py-3 border-b border-slate-200 font-semibold">Top products by revenue</div>
        {loading && <div className="p-8 text-center text-slate-400">Loading…</div>}
        {!loading && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">SKU</th>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Category</th>
                <th className="px-4 py-2 text-right">Orders</th>
                <th className="px-4 py-2 text-right">Units</th>
                <th className="px-4 py-2 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-2">{p.name}</td>
                  <td className="px-4 py-2 text-slate-600">{p.category || '—'}</td>
                  <td className="px-4 py-2 text-right">{p.ordersCount}</td>
                  <td className="px-4 py-2 text-right">{p.unitsSold}</td>
                  <td className="px-4 py-2 text-right font-medium">{inr(p.totalRevenue)}</td>
                </tr>
              ))}
              {products.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400">No sales data yet.</td></tr>}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
