'use client';

/**
 * Offer ticker — edit the scrolling red offer strip shown under the hero on
 * the storefront home page. Each offer is a short line, optionally a link.
 * The preview below uses the same look and motion as the live strip.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/fetch';

type Speed = 'slow' | 'normal' | 'fast';
interface Item { text: string; href: string | null }
interface Ticker { enabled: boolean; speed: Speed; items: Item[] }

const EMPTY: Ticker = { enabled: false, speed: 'normal', items: [] };
const SPEEDS: Array<{ v: Speed; label: string }> = [
  { v: 'slow', label: 'Slow' },
  { v: 'normal', label: 'Normal' },
  { v: 'fast', label: 'Fast' },
];
// Same numbers as the storefront (web/components/OfferTicker.tsx).
const PX_PER_SEC: Record<Speed, number> = { slow: 40, normal: 60, fast: 90 };
const PX_PER_CHAR = 9;
const MIN_ROW_CHARS = 220;

export default function OfferTickerPage() {
  const [form, setForm] = useState<Ticker>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const d = await api<{ ticker: Ticker }>('/api/offer-ticker');
      setForm({ ...EMPTY, ...d.ticker });
    } catch (e: any) {
      setErr(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function change(next: Partial<Ticker>) {
    setForm((p) => ({ ...p, ...next }));
    setOk(false);
  }
  function setItem(i: number, patch: Partial<Item>) {
    change({ items: form.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= form.items.length) return;
    const items = [...form.items];
    [items[i], items[j]] = [items[j], items[i]];
    change({ items });
  }

  async function save() {
    setErr(null);
    setOk(false);
    setSaving(true);
    try {
      const items = form.items
        .map((it) => ({ text: it.text.trim(), href: it.href?.trim() || null }))
        .filter((it) => it.text);
      if (form.enabled && items.length === 0) throw new Error('Add at least one offer, or switch the ticker off.');
      const d = await api<{ ticker: Ticker }>('/api/offer-ticker', {
        method: 'PUT',
        body: JSON.stringify({ ...form, items }),
      });
      setForm(d.ticker);
      setOk(true);
    } catch (e: any) {
      setErr(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const liveItems = form.items.filter((it) => it.text.trim());

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Offer ticker</h1>
        <p className="text-sm text-slate-500">
          The red scrolling offer line under the banner on the home page. It loops continuously and pauses when a
          visitor hovers over it.
        </p>
      </div>

      {loading ? (
        <div className="card p-8 text-center text-slate-400">Loading…</div>
      ) : (
        <div className="card p-6 space-y-6">
          <label className="flex items-center gap-3 text-sm font-medium text-slate-800">
            <input type="checkbox" checked={form.enabled} onChange={(e) => change({ enabled: e.target.checked })} />
            Show the ticker on the home page
          </label>

          <div>
            <div className="label">Offers</div>
            <p className="text-xs text-slate-500 mb-3">
              One short line each (max 140 characters). Add a link to make it clickable — a page on the site like{' '}
              <code>/shop</code> or a full https:// address.
            </p>
            <div className="space-y-3">
              {form.items.map((it, i) => (
                <div key={i} className="rounded-md border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-5">{i + 1}.</span>
                    <input
                      className="input flex-1"
                      value={it.text}
                      maxLength={140}
                      placeholder="e.g. Free pan-India delivery on orders above ₹5,000"
                      onChange={(e) => setItem(i, { text: e.target.value })}
                    />
                    <button type="button" className="btn-outline px-2 text-xs" onClick={() => move(i, -1)} disabled={i === 0} title="Move up">↑</button>
                    <button type="button" className="btn-outline px-2 text-xs" onClick={() => move(i, 1)} disabled={i === form.items.length - 1} title="Move down">↓</button>
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline px-1"
                      onClick={() => change({ items: form.items.filter((_, j) => j !== i) })}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="flex items-center gap-2 pl-7">
                    <input
                      className="input input-sm flex-1"
                      value={it.href ?? ''}
                      placeholder="Link (optional) — /shop or https://…"
                      onChange={(e) => setItem(i, { href: e.target.value })}
                    />
                    <span className="text-[11px] text-slate-400 w-16 text-right">{it.text.length}/140</span>
                  </div>
                </div>
              ))}
              {form.items.length === 0 && <div className="text-sm text-slate-400">No offers yet.</div>}
            </div>
            <button
              type="button"
              className="mt-3 text-sm text-indigo-600 hover:underline disabled:opacity-40"
              disabled={form.items.length >= 12}
              onClick={() => change({ items: [...form.items, { text: '', href: null }] })}
            >
              + Add offer
            </button>
          </div>

          <div>
            <div className="label">Speed</div>
            <div className="flex gap-2">
              {SPEEDS.map((s) => (
                <button
                  key={s.v}
                  type="button"
                  onClick={() => change({ speed: s.v })}
                  className={`px-3 py-1.5 text-sm rounded-md border ${form.speed === s.v ? 'bg-red-700 text-white border-red-700' : 'bg-white text-slate-700 border-slate-300'}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="label">Preview</div>
            {liveItems.length ? (
              <TickerPreview items={liveItems} speed={form.speed} />
            ) : (
              <div className="text-sm text-slate-400">Add an offer to see the preview.</div>
            )}
            {!form.enabled && liveItems.length > 0 && (
              <p className="text-xs text-amber-700 mt-2">The ticker is switched off — it will not show on the site.</p>
            )}
          </div>

          {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
          {ok && (
            <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
              Saved. The home page updates within a few seconds.
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" onClick={load} className="btn-outline" disabled={saving}>
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Same look and motion as the storefront strip, with inline styles (the
 *  admin's Tailwind theme has no storefront colours). */
function TickerPreview({ items, speed }: { items: Item[]; speed: Speed }) {
  const { row, seconds } = useMemo(() => {
    const chars = items.reduce((n, i) => n + i.text.length + 6, 0) || 1;
    const repeat = Math.max(1, Math.ceil(MIN_ROW_CHARS / chars));
    const row = Array.from({ length: repeat }, () => items).flat();
    const seconds = Math.max(12, Math.round((chars * repeat * PX_PER_CHAR) / PX_PER_SEC[speed]));
    return { row, seconds };
  }, [items, speed]);

  const list = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} style={{ display: 'flex', alignItems: 'center', flexShrink: 0, margin: 0, padding: 0, listStyle: 'none' }}>
      {row.map((it, i) => (
        <li key={i} style={{ display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
          <span style={{ textDecoration: it.href ? 'underline' : 'none', textUnderlineOffset: 4 }}>{it.text}</span>
          <span style={{ color: '#D4A574', margin: '0 28px' }}>✦</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className="kk-ticker-preview"
      style={{
        overflow: 'hidden',
        background: 'linear-gradient(90deg, #7A1212, #A01818 50%, #7A1212)',
        color: '#fff',
        borderTop: '1px solid rgba(212,165,116,.45)',
        borderBottom: '1px solid rgba(212,165,116,.45)',
        borderRadius: 6,
        padding: '10px 0',
        fontWeight: 600,
        fontSize: 13.5,
        letterSpacing: '.04em',
        textTransform: 'uppercase',
      }}
    >
      <style>{`@keyframes kk-ticker-admin{from{transform:translateX(0)}to{transform:translateX(-50%)}}
        .kk-ticker-preview:hover .kk-ticker-admin-track{animation-play-state:paused}`}</style>
      <div
        className="kk-ticker-admin-track"
        style={{ display: 'flex', width: 'max-content', animation: `kk-ticker-admin ${seconds}s linear infinite` }}
      >
        {list(false)}
        {list(true)}
      </div>
    </div>
  );
}
