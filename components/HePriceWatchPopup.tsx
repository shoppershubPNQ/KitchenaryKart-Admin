'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Component, ReactNode, useEffect, useRef, useState } from 'react';
import { api, inrExact } from '@/lib/fetch';
import { FULL_LIST_HREF, HeRise, istDateTime, plural } from '@/lib/he-price-watch-shared';

/**
 * Pop-up when Hotelic Essentials has raised prices above what we charge
 * (owner, 16 Oct 2026: "only notify me", in the admin). It only tells — it
 * never changes a price. Once "Seen", it comes back only for a new rise, or
 * when the daily check has stopped working.
 * Any failure keeps it hidden: a missing alert must never break the dashboard.
 */

interface WatchData {
  checked: boolean;
  checkedAt?: string;
  stale?: boolean;
  total: number;
  products?: number;
  newCount: number;
  seen: boolean;
  items: HeRise[];
}

/** Worth interrupting for: unseen rises, or a check that has stopped. A malformed reply shows nothing. */
function worthShowing(d: WatchData | null | undefined): d is WatchData {
  if (!d?.checked || !Array.isArray(d.items)) return false;
  return !!d.stale || (d.total > 0 && !d.seen && d.items.length > 0);
}

/** Anything unexpected in the alert renders nothing rather than taking the dashboard down with it. */
class QuietBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn('[he-price-watch popup]', e);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function HePriceWatchPopup() {
  return (
    <QuietBoundary>
      <WatchPopup />
    </QuietBoundary>
  );
}

function WatchPopup() {
  const pathname = usePathname();
  const onFullList = pathname.startsWith(FULL_LIST_HREF);
  const onFullListRef = useRef(onFullList);
  onFullListRef.current = onFullList;
  const [data, setData] = useState<WatchData | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const seenRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    api<WatchData>('/api/he-price-watch')
      .then((d) => {
        // The full list page already shows all of this.
        if (cancelled || onFullListRef.current || !worthShowing(d)) return;
        setData(d);
        setOpen(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Opening the full list counts as having looked, for this session — so a pop-up
  // fetched earlier cannot come back later with an out-of-date list.
  useEffect(() => {
    if (onFullList) setOpen(false);
  }, [onFullList]);

  const visible = open && !!data && !onFullList;

  // Focus goes into the dialog and stays there; Escape closes; focus returns on close.
  useEffect(() => {
    if (!visible) return;
    const prev = document.activeElement as HTMLElement | null;
    seenRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      const panel = panelRef.current;
      if (e.key !== 'Tab' || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [visible]);

  if (!visible || !data) return null;

  async function markSeen() {
    if (!data) return;
    setSaving(true);
    try {
      const r = await api<{ changed?: boolean }>('/api/he-price-watch', {
        method: 'POST',
        body: JSON.stringify({ action: 'seen', checkedAt: data.checkedAt }),
      });
      if (r?.changed) {
        // HE was checked again while this was open — show the new list instead of hiding it unseen.
        const fresh = await api<WatchData>('/api/he-price-watch');
        if (worthShowing(fresh)) {
          setData(fresh);
          setRefreshed(true);
          return;
        }
      }
      setOpen(false);
    } catch {
      // Not saved means it shows again next time — better than a stuck dialog.
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const products = data.products ?? data.total;
  const more = data.total - data.items.length;
  const title =
    data.total > 0
      ? `HE has raised prices on ${plural(products, 'product')}${products !== data.total ? ` (${plural(data.total, 'size')})` : ''}`
      : 'The HE price check needs a look';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="he-watch-title"
        className="mt-10 w-full max-w-4xl rounded-lg bg-white shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 id="he-watch-title" className="font-semibold text-slate-900">
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Checked {istDateTime(data.checkedAt)}
              {data.newCount > 0 && data.newCount < data.total && <> · {data.newCount} new since you last looked</>}
            </p>
          </div>
          <button type="button" className="text-slate-400 hover:text-slate-700" onClick={() => setOpen(false)} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="space-y-3 p-5">
          {data.stale && (
            <div className="notice-amber">
              The daily HE price check has not worked since {istDateTime(data.checkedAt)}. Open the full list and
              click “Check now”.
            </div>
          )}
          {refreshed && <div className="notice-muted">HE prices were checked again while this was open. This is the new list.</div>}

          {data.items.length > 0 && (
            <>
              <p className="text-sm text-slate-600">Our price is now below HE price × 1.30 + GST for these sizes.</p>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="table-mini">
                  <thead>
                    <tr>
                      <th className="min-w-[12rem]">Product</th>
                      <th>Size</th>
                      <th className="text-right">Our price</th>
                      <th className="text-right">New price (HE × 1.30 + GST)</th>
                      <th className="text-right">Increase</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((r) => (
                      <tr key={`${r.productId}-${r.sku}`} className={r.big ? 'row-warn' : ''}>
                        <td className="min-w-[12rem]">
                          <Link href={`/dashboard/products/${r.productId}`} className="link" onClick={() => setOpen(false)}>
                            {r.name}
                          </Link>
                          {r.isNew && <span className="pill-green ml-1">New</span>}
                          <span className="block font-mono text-[11px] text-slate-400">{r.sku}</span>
                          {r.big && <span className="pill-yellow mt-1">Check with HE first</span>}
                        </td>
                        <td className="text-slate-600">{r.size ?? '—'}</td>
                        <td className="whitespace-nowrap text-right text-slate-600">{inrExact(r.ours)}</td>
                        <td className="whitespace-nowrap text-right font-medium text-slate-900">{inrExact(r.target)}</td>
                        <td className="whitespace-nowrap text-right font-medium text-red-700">
                          +{inrExact(r.diff)}
                          <span className="block text-xs font-normal text-slate-500">{r.pct == null ? '—' : `+${r.pct}%`}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {more > 0 && (
                <p className="text-sm text-slate-500">
                  + {more} more —{' '}
                  <Link href={FULL_LIST_HREF} className="link" onClick={() => setOpen(false)}>
                    see the full list
                  </Link>
                </p>
              )}
            </>
          )}

          <div className="notice-muted">
            Prices on the website are not changed. Tell Claude or update them from the product page.
          </div>

          <div className="flex flex-wrap justify-end gap-3 pt-1">
            <Link href={FULL_LIST_HREF} className="btn-outline" onClick={() => setOpen(false)}>
              Open full list
            </Link>
            <button ref={seenRef} type="button" className="btn-primary disabled:opacity-50" onClick={markSeen} disabled={saving}>
              {saving ? 'Saving…' : 'Seen'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
