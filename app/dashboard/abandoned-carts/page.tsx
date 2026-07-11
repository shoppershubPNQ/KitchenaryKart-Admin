'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, inr } from '@/lib/fetch';

interface AbandonedItem {
  id: number;
  sku: string | null;
  name: string | null;
  quantity: number;
  unitPrice: number | null;
}
interface AbandonedOrder {
  id: number;
  orderNumber: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  shippingAddress: string | null;
  totalAmount: number | null;
  subtotal: number | null;
  createdAt: string;
  contactedAt: string | null;
  items: AbandonedItem[];
}

const STORE_URL =
  process.env.NEXT_PUBLIC_STORE_URL || 'https://kitchenarykart.com';
const SUPPORT_PHONE = '+91 98903 52455';

const CUTOFF_OPTIONS = [
  { v: 15, label: '15 minutes' },
  { v: 30, label: '30 minutes' },
  { v: 60, label: '1 hour' },
  { v: 180, label: '3 hours' },
  { v: 1440, label: '24 hours' },
];

function firstName(full: string | null): string {
  if (!full) return 'there';
  return full.trim().split(/\s+/)[0] || 'there';
}

function ageString(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h ago`;
}

/**
 * Build the WhatsApp deep link for a single abandoned cart. Strips
 * any non-digit characters from the phone number (the Order row
 * stores them in messy formats like "+91 98903 52455" or "9890352455").
 * Prepends "91" if the buyer left off the country code.
 */
function buildWhatsAppHref(order: AbandonedOrder): string | null {
  const raw = (order.customerPhone || '').replace(/\D/g, '');
  if (!raw) return null;
  const phone = raw.length === 10 ? `91${raw}` : raw;

  const itemsLines = order.items
    .map((it) => `• ${it.name || it.sku} × ${it.quantity}`)
    .join('\n');
  const recoveryItem = order.items[0];
  const recoveryUrl =
    recoveryItem?.sku
      ? `${STORE_URL}/product/${encodeURIComponent(recoveryItem.sku)}`
      : `${STORE_URL}/shop`;

  const lines = [
    `Hi ${firstName(order.customerName)} 👋`,
    '',
    `This is the team from Kitchenary Kart.`,
    `Saw you started an order with us — wanted to make sure everything's OK on your end!`,
    '',
    `Your cart:`,
    itemsLines,
    `Total: ${order.totalAmount ? inr(order.totalAmount) : '—'}`,
    '',
    `If there was anything that stopped you — pricing, specs, delivery questions — just reply here and we'll sort it out. We can also:`,
    `✅ Offer bulk pricing if you need multiple units`,
    `✅ Walk you through the order over WhatsApp`,
    `✅ Send a custom GST invoice for B2B`,
    '',
    `You can pick up where you left off here:`,
    recoveryUrl,
    '',
    `— Team Kitchenary Kart`,
    SUPPORT_PHONE,
  ];

  return `https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}`;
}

/* --- Inline stroke icons (replace emoji glyphs; recolour via currentColor) --- */
function WhatsAppIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.06L2 22l5.05-1.32A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.18-1.14l-.3-.18-3 .78.8-2.92-.2-.31A8.2 8.2 0 1 1 12 20.2z" />
      <path d="M17.47 14.38c-.29-.15-1.7-.84-1.96-.93-.26-.1-.45-.15-.64.14-.19.29-.74.93-.9 1.12-.17.19-.33.22-.62.07-.29-.15-1.22-.45-2.32-1.43-.86-.77-1.44-1.72-1.6-2-.17-.29-.02-.45.13-.59.13-.13.29-.34.44-.51.15-.17.19-.29.29-.48.1-.19.05-.36-.02-.51-.07-.15-.64-1.55-.88-2.12-.23-.55-.47-.48-.64-.49h-.55c-.19 0-.51.07-.77.36-.26.29-1.01.99-1.01 2.42 0 1.43 1.04 2.81 1.18 3 .15.19 2.05 3.13 4.97 4.39.69.3 1.23.48 1.65.61.69.22 1.33.19 1.83.12.56-.08 1.7-.7 1.94-1.37.24-.67.24-1.25.17-1.37-.07-.12-.26-.19-.55-.34z" />
    </svg>
  );
}
const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};
function CheckIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} {...strokeProps}><path d="M20 6 9 17l-5-5" /></svg>;
}
function ClockIcon({ className = 'w-3 h-3' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} {...strokeProps}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
}
function UndoIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} {...strokeProps}><path d="M3 7v6h6" /><path d="M3.51 13a9 9 0 1 0 2.13-9.36L3 7" /></svg>;
}
function XIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} {...strokeProps}><path d="M18 6 6 18M6 6l12 12" /></svg>;
}
function CheckCircleIcon({ className = 'w-12 h-12' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} {...strokeProps}><circle cx="12" cy="12" r="10" /><path d="m8.5 12 2.5 2.5 4.5-4.5" /></svg>;
}

export default function AbandonedCartsPage() {
  const [orders, setOrders] = useState<AbandonedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [cutoff, setCutoff] = useState(30);
  const [includeContacted, setIncludeContacted] = useState(false);
  const [busy, setBusy] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        olderThanMinutes: String(cutoff),
        includeContacted: String(includeContacted),
        limit: '200',
      });
      const data = await api<{ orders: AbandonedOrder[] }>(
        `/api/orders/abandoned?${qs.toString()}`,
      );
      setOrders(data.orders);
    } finally {
      setLoading(false);
    }
  }, [cutoff, includeContacted]);

  useEffect(() => {
    load();
  }, [load]);

  async function markContacted(id: number, contacted: boolean) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await api(`/api/orders/${id}/contacted`, {
        method: contacted ? 'POST' : 'DELETE',
      });
      await load();
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  async function markCancelled(id: number) {
    if (
      !confirm(
        'Mark this abandoned order as Cancelled? This removes it from the queue and prevents accidental fulfilment.',
      )
    ) {
      return;
    }
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await api(`/api/orders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ orderStatus: 'cancelled' }),
      });
      await load();
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  function openWhatsApp(order: AbandonedOrder) {
    const href = buildWhatsAppHref(order);
    if (!href) {
      alert('This order has no valid phone number to message.');
      return;
    }
    // Open WhatsApp FIRST so the popup isn't blocked, then mark
    // contacted in the background (fire-and-forget).
    window.open(href, '_blank', 'noopener,noreferrer');
    markContacted(order.id, true).catch(() => {
      /* non-blocking */
    });
  }

  const totalAbandonedValue = useMemo(
    () => orders.reduce((s, o) => s + (o.totalAmount ?? 0), 0),
    [orders],
  );

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Abandoned carts
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Pending orders where the buyer entered an address but never completed
          payment. Click <strong>WhatsApp Recovery</strong> to message them with
          a pre-filled cart summary. Average D2C recovery rate: 15–30% with
          personal WhatsApp follow-up.
        </p>
      </div>

      {/* Filter bar */}
      <div className="card p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="label">Wait threshold</label>
          <select
            className="input"
            value={cutoff}
            onChange={(e) => setCutoff(parseInt(e.target.value, 10))}
          >
            {CUTOFF_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>
                Older than {o.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 pb-2">
          <input
            type="checkbox"
            checked={includeContacted}
            onChange={(e) => setIncludeContacted(e.target.checked)}
            className="w-4 h-4"
          />
          Show already-contacted carts
        </label>
        <div className="ml-auto text-right">
          <div className="text-xs text-slate-500">Recoverable value</div>
          <div className="font-head text-2xl font-bold text-ink">
            {inr(totalAbandonedValue)}
          </div>
        </div>
      </div>

      {/* List */}
      <div className="card overflow-hidden">
        {loading && (
          <div className="p-12 text-center text-slate-400">Loading…</div>
        )}
        {!loading && orders.length === 0 && (
          <div className="p-16 text-center">
            <CheckCircleIcon className="w-12 h-12 mx-auto mb-3 text-emerald-500" />
            <h3 className="text-ink font-bold mb-1">No abandoned carts</h3>
            <p className="text-sm text-slate-500">
              Either everyone's completing checkout, or you've contacted all the
              pending ones. Nice.
            </p>
          </div>
        )}
        {!loading && orders.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {orders.map((o) => {
              const whatsAppHref = buildWhatsAppHref(o);
              const isBusy = !!busy[o.id];
              return (
                <li key={o.id} className="p-5">
                  <div className="flex items-start gap-4 flex-wrap">
                    {/* Left: customer + address */}
                    <div className="min-w-[200px] flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-bold text-slate-900">
                          {o.customerName || '(no name)'}
                        </span>
                        {o.contactedAt ? (
                          <span className="pill-blue inline-flex items-center gap-1">
                            <CheckIcon className="w-3 h-3" /> Contacted {ageString(o.contactedAt)}
                          </span>
                        ) : (
                          <span className="pill-yellow inline-flex items-center gap-1">
                            <ClockIcon className="w-3 h-3" /> New
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        {o.customerPhone || '(no phone)'}
                        {o.customerEmail && ` · ${o.customerEmail}`}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        {o.orderNumber} · started {ageString(o.createdAt)}
                      </div>
                      {o.shippingAddress && (
                        <div className="text-[11px] text-slate-500 mt-2 whitespace-pre-line line-clamp-2">
                          {o.shippingAddress}
                        </div>
                      )}
                    </div>

                    {/* Middle: items */}
                    <div className="min-w-[240px] flex-1">
                      <ul className="text-sm text-slate-700 space-y-1">
                        {o.items.map((it) => (
                          <li key={it.id} className="flex justify-between gap-3">
                            <span className="truncate">
                              {it.name || it.sku}{' '}
                              <span className="text-slate-400">
                                × {it.quantity}
                              </span>
                            </span>
                            <span className="font-mono text-xs text-slate-500 shrink-0">
                              {it.unitPrice ? inr(it.unitPrice) : '—'}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between text-sm">
                        <span className="text-slate-500">Total</span>
                        <span className="font-bold text-ink">
                          {o.totalAmount ? inr(o.totalAmount) : '—'}
                        </span>
                      </div>
                    </div>

                    {/* Right: actions */}
                    <div className="flex flex-col gap-2 min-w-[160px]">
                      <button
                        type="button"
                        onClick={() => openWhatsApp(o)}
                        disabled={isBusy || !whatsAppHref}
                        className="btn-primary gap-1.5 !bg-[#25D366] !border-[#25D366] hover:!bg-[#1eb558] !py-2 !text-sm whitespace-nowrap"
                        title={
                          whatsAppHref
                            ? 'Open WhatsApp with a pre-filled recovery message'
                            : 'No phone number on this order'
                        }
                      >
                        <WhatsAppIcon className="w-4 h-4" /> WhatsApp Recovery
                      </button>
                      {o.contactedAt ? (
                        <button
                          type="button"
                          onClick={() => markContacted(o.id, false)}
                          disabled={isBusy}
                          className="btn-outline btn-small gap-1.5 !text-xs"
                        >
                          <UndoIcon className="w-3.5 h-3.5" /> Mark not contacted
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => markContacted(o.id, true)}
                          disabled={isBusy}
                          className="btn-outline btn-small gap-1.5 !text-xs"
                        >
                          <CheckIcon className="w-3.5 h-3.5" /> Mark contacted (silent)
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => markCancelled(o.id)}
                        disabled={isBusy}
                        className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-700 px-2 py-1.5"
                      >
                        <XIcon className="w-3.5 h-3.5" /> Mark cancelled
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer note */}
      <p className="text-xs text-slate-400 italic">
        Tip: clicking <strong>WhatsApp Recovery</strong> auto-marks the cart as
        contacted, so you won't message the same buyer twice. The message
        includes their cart items, total, and a link back to the first product
        — they can resume from there.
      </p>
    </div>
  );
}
