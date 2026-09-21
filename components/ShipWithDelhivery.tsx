'use client';

/**
 * "Ship with Delhivery" on the order page.
 *
 *   1. Confirm the address (pre-filled from the checkout blob — CHECK it; the
 *      blob sometimes has no state) and the packed weight / box size.
 *   2. Check pincode → Delhivery serviceability, fills city/state.
 *   3. Get rate → Delhivery's own estimate of what it will charge us.
 *   4. Book → AWB. This DEBITS THE DELHIVERY WALLET, so it asks first. The
 *      order moves to Shipped and the customer gets the tracking email.
 *   5. Label, pickup, refresh, cancel (cancel only before pickup).
 *
 * After booking, scans arrive by themselves every hour.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, inr, dateShort } from '@/lib/fetch';

type To = { name: string; phone: string; address: string; city: string; state: string; pincode: string };
type Ev = { status: string; mapped: string | null; detail: string | null; location: string | null; at: string };
type Ship = {
  id: number; status: string; awb: string | null; courierOrderId: string | null; labelUrl: string | null;
  trackingUrl: string | null; weightGrams: number | null; declaredValue: number | null;
  pickupScheduledAt: string | null; cancelledAt: string | null; lastError: string | null; createdAt: string;
  to: string; events: Ev[];
};
type Panel = {
  configured: boolean;
  canBook: string | null;
  defaults: { to: To; weightGrams: number | null; itemsMissingWeight: number; declaredValue: number; ewaybillRequired: boolean };
  shipments: Ship[];
};
type Quote = { charge: number; etaDays: number | null; chargeableWeightGrams: number | null; serviceable: boolean; note: string | null };

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', created: 'Created', awb_assigned: 'AWB assigned', pickup_scheduled: 'Pickup scheduled',
  in_transit: 'In transit', out_for_delivery: 'Out for delivery', delivered: 'Delivered',
  rto: 'Returning (RTO)', cancelled: 'Cancelled', failed: 'Booking failed',
};
const STATUS_TONE: Record<string, string> = {
  delivered: 'bg-emerald-100 text-emerald-800', rto: 'bg-red-100 text-red-800', failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-slate-200 text-slate-700', out_for_delivery: 'bg-blue-100 text-blue-800', in_transit: 'bg-blue-100 text-blue-800',
};
const OPEN = ['awb_assigned', 'pickup_scheduled', 'created', 'in_transit', 'out_for_delivery'];

/** Tomorrow 11:00, local — a sensible first pickup slot. */
function defaultPickup(): string {
  const d = new Date();
  d.setDate(d.getDate() + (d.getHours() >= 14 ? 1 : 0));
  d.setHours(d.getHours() >= 14 ? 11 : Math.max(d.getHours() + 2, 11), 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`;
}

export function ShipWithDelhivery({ orderId, orderNumber, onChanged }: {
  orderId: number; orderNumber: string; onChanged: () => void | Promise<void>;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<To | null>(null);
  const [kg, setKg] = useState('');
  const [dims, setDims] = useState({ l: '', b: '', h: '' });
  const [fragile, setFragile] = useState(false);
  const [ewb, setEwb] = useState('');
  const [pin, setPin] = useState<{ ok: boolean; text: string } | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    try {
      const p = await api<Panel>(`/api/orders/${orderId}/shipments`);
      setPanel(p);
      setTo((cur) => cur ?? p.defaults.to);
      setKg((cur) => cur || (p.defaults.weightGrams ? String(Math.round(p.defaults.weightGrams / 100) / 10) : ''));
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Could not load shipping');
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [orderId]);

  if (loadErr) return <div className="card p-4 text-sm text-red-700">Shipping: {loadErr}</div>;
  if (!panel || !to) return <div className="card p-4 text-sm text-slate-400">Loading shipping…</div>;

  const grams = Math.round(parseFloat(kg || '0') * 1000);
  const body = () => ({
    to,
    pkg: {
      weightGrams: grams,
      lengthCm: dims.l ? Number(dims.l) : null,
      breadthCm: dims.b ? Number(dims.b) : null,
      heightCm: dims.h ? Number(dims.h) : null,
    },
    ewaybill: ewb.trim() || null,
    fragile,
  });
  const set = (k: keyof To) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setTo({ ...to, [k]: e.target.value });
    if (k === 'pincode') { setPin(null); setQuote(null); }
  };

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label); setErr(null); setMsg(null);
    try { return await fn(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); return undefined; }
    finally { setBusy(null); }
  }

  async function checkPin() {
    await run('pin', async () => {
      const r = await api<{ serviceable: boolean; district: string | null; stateCode: string | null; stateName: string | null; note: string | null }>(
        `/api/shipments/pincode?pin=${encodeURIComponent(to!.pincode)}`,
      );
      if (r.serviceable) {
        setPin({ ok: true, text: `Delhivery delivers here — ${[r.district, r.stateName ?? r.stateCode].filter(Boolean).join(', ')}` });
        // The pincode decides the state, so Delhivery's answer replaces whatever
        // the address text said (real orders have no state, or a city in it).
        // The city is only filled when blank — the text is usually right there.
        setTo((t) => t && {
          ...t,
          city: t.city || (r.district ? titleCase(r.district) : ''),
          state: r.stateName ?? t.state,
        });
      } else {
        setPin({ ok: false, text: r.note || 'Not serviceable by Delhivery' });
      }
    });
  }

  async function getRate() {
    await run('quote', async () => {
      const r = await api<{ quotes: Quote[] }>(`/api/orders/${orderId}/shipments`, {
        method: 'POST', body: JSON.stringify({ action: 'quote', ...body() }),
      });
      setQuote(r.quotes[0] ?? null);
    });
  }

  async function book() {
    const d = panel!.defaults;
    const ok = window.confirm(
      `Book Delhivery shipment for ${orderNumber}?\n\n` +
      `To: ${to!.name}, ${to!.city} ${to!.pincode}\n` +
      `Weight: ${kg} kg${dims.l && dims.b && dims.h ? ` · Box ${dims.l}×${dims.b}×${dims.h} cm` : ''}\n` +
      `Declared value: ${inr(d.declaredValue)}${ewb ? ` · E-way bill ${ewb}` : ''}\n` +
      (quote?.serviceable ? `Estimated charge: ${inr(quote.charge)} (Delhivery estimate)\n` : '') +
      '\nThis DEBITS YOUR DELHIVERY WALLET, marks the order Shipped and emails the customer the tracking number.',
    );
    if (!ok) return;
    const r = await run('book', () => api<{ awb: string; emailSent: boolean }>(`/api/orders/${orderId}/shipments`, {
      method: 'POST', body: JSON.stringify({ action: 'book', ...body() }),
    }));
    if (r) {
      setMsg(`Booked — AWB ${r.awb}.${r.emailSent ? ' Tracking email sent to the customer.' : ''} Next: download the label and request a pickup.`);
      setOpen(false);
      await load();
      await onChanged();
    } else {
      await load(); // a failed booking is recorded; show it
    }
  }

  async function act(s: Ship, action: 'label' | 'pickup' | 'cancel' | 'refresh', extra: Record<string, unknown> = {}) {
    if (action === 'cancel' && !window.confirm(`Cancel AWB ${s.awb} with Delhivery?\n\nOnly works before pickup. The order goes back to Processing and loses the tracking number (the customer is NOT emailed).`)) return;
    const r = await run(`${action}-${s.id}`, () => api<any>(`/api/shipments/${s.id}`, {
      method: 'POST', body: JSON.stringify({ action, ...extra }),
    }));
    if (r === undefined) return;
    if (action === 'label' && r.url) window.open(r.url, '_blank', 'noopener');
    if (action === 'pickup') setMsg(`Pickup requested${r.pickupId ? ` (id ${r.pickupId})` : ''}.`);
    if (action === 'refresh') setMsg(r.recorded ? `${r.recorded} new scan(s).` : 'No new scans.');
    await load();
    if (action !== 'label') await onChanged();
  }

  const d = panel.defaults;
  const active = panel.shipments.find((s) => OPEN.includes(s.status));

  return (
    <div className="card p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-900">Delhivery shipping</div>
          <div className="text-xs text-slate-500">Book, print the label, request pickup. Status updates arrive by themselves every hour.</div>
        </div>
        {!panel.configured && (
          <Link href="/dashboard/integrations" className="btn-outline text-sm">Connect Delhivery</Link>
        )}
      </div>

      {!panel.configured && (
        <div className="notice-amber text-sm">
          Delhivery is not connected yet. Add the API token, client name and pickup location in <b>Integrations</b>, then press Test connection.
        </div>
      )}

      {msg && <div className="notice-green text-sm">{msg}</div>}
      {err && <div className="notice-red text-sm">{err}</div>}

      {panel.shipments.map((s) => (
        <div key={s.id} className="rounded-lg border border-slate-200 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[s.status] ?? 'bg-amber-100 text-amber-800'}`}>
              {STATUS_LABEL[s.status] ?? s.status}
            </span>
            {s.awb ? <span className="font-mono text-sm font-semibold">AWB {s.awb}</span> : <span className="text-sm text-slate-500">No AWB</span>}
            {s.courierOrderId && s.courierOrderId !== orderNumber && <span className="text-xs text-slate-500">ref {s.courierOrderId}</span>}
            <span className="text-xs text-slate-400">· {dateShort(s.createdAt)}</span>
            {s.trackingUrl && <a className="text-xs text-blue-700 underline" href={s.trackingUrl} target="_blank" rel="noopener">Track on Delhivery</a>}
          </div>
          {s.to && <div className="text-xs text-slate-500">To: {s.to}{s.weightGrams ? ` · ${(s.weightGrams / 1000).toFixed(2)} kg` : ''}</div>}
          {s.pickupScheduledAt && <div className="text-xs text-slate-600">Pickup requested for {new Date(s.pickupScheduledAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>}
          {s.lastError && <div className="text-xs text-red-700">{s.status === 'failed' ? 'Delhivery said: ' : 'Last check: '}{s.lastError}</div>}

          {s.awb && OPEN.includes(s.status) && (
            <PickupRow s={s} busy={busy} onAct={act} />
          )}

          {s.events.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-600">Scan history ({s.events.length})</summary>
              <ol className="mt-2 space-y-1 border-l border-slate-200 pl-3">
                {s.events.map((e, i) => (
                  <li key={i}>
                    <span className="text-slate-400">{new Date(e.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>{' '}
                    <b className="text-slate-800">{e.status}</b>
                    {e.location && <span className="text-slate-500"> · {e.location}</span>}
                    {e.detail && <div className="text-slate-500">{e.detail}</div>}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      ))}

      {panel.configured && !active && (
        panel.canBook ? (
          <div className="text-sm text-slate-500">{panel.canBook}</div>
        ) : !open ? (
          <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
            {panel.shipments.length ? 'Book a new Delhivery shipment' : 'Ship with Delhivery'}
          </button>
        ) : (
          <div className="space-y-4 rounded-lg border border-slate-200 p-4">
            <div className="text-sm font-medium text-slate-900">Check the address — it was read from the order and may be incomplete.</div>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Receiver name"><input className="input" value={to.name} onChange={set('name')} /></Field>
              <Field label="Mobile (10 digits)"><input className="input font-mono" value={to.phone} onChange={set('phone')} /></Field>
              <Field label="Pincode">
                <div className="flex gap-2">
                  <input className="input font-mono" value={to.pincode} onChange={set('pincode')} maxLength={6} />
                  <button type="button" className="btn-outline text-sm whitespace-nowrap" onClick={checkPin} disabled={!!busy || !/^\d{6}$/.test(to.pincode)}>
                    {busy === 'pin' ? '…' : 'Check'}
                  </button>
                </div>
              </Field>
              <div className="md:col-span-3">
                <Field label="Address (house, street, area, landmark)">
                  <textarea className="input" rows={2} value={to.address} onChange={set('address')} />
                </Field>
              </div>
              <Field label="City"><input className="input" value={to.city} onChange={set('city')} /></Field>
              <Field label="State"><input className="input" value={to.state} onChange={set('state')} /></Field>
            </div>
            {pin && <div className={pin.ok ? 'notice-green text-sm' : 'notice-red text-sm'}>{pin.text}</div>}

            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Packed weight (kg)">
                <input className="input" type="number" step="0.1" min="0.05" value={kg} onChange={(e) => { setKg(e.target.value); setQuote(null); }} />
              </Field>
              <Field label="Length (cm)"><input className="input" type="number" min="1" value={dims.l} onChange={(e) => { setDims({ ...dims, l: e.target.value }); setQuote(null); }} /></Field>
              <Field label="Breadth (cm)"><input className="input" type="number" min="1" value={dims.b} onChange={(e) => { setDims({ ...dims, b: e.target.value }); setQuote(null); }} /></Field>
              <Field label="Height (cm)"><input className="input" type="number" min="1" value={dims.h} onChange={(e) => { setDims({ ...dims, h: e.target.value }); setQuote(null); }} /></Field>
            </div>
            <p className="text-[11px] text-slate-500">
              Weigh the packed carton. Catalogue weight {d.weightGrams ? `was ${(d.weightGrams / 1000).toFixed(2)} kg` : 'is not set'}
              {d.itemsMissingWeight ? ` (${d.itemsMissingWeight} item${d.itemsMissingWeight > 1 ? 's have' : ' has'} no weight — it is an underestimate)` : ''}.
              Delhivery bills on the greater of actual and box weight (L×B×H ÷ 5000), so enter the box size for an accurate rate.
            </p>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label={d.ewaybillRequired ? `E-way bill number (required — value ${inr(d.declaredValue)})` : 'E-way bill number (only above ₹50,000)'}>
                <input className="input font-mono" value={ewb} onChange={(e) => setEwb(e.target.value)} placeholder={d.ewaybillRequired ? '12-digit EWB number' : 'Not needed'} />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
                <input type="checkbox" checked={fragile} onChange={(e) => setFragile(e.target.checked)} />
                Fragile (glass, display counters, sneeze guards)
              </label>
            </div>

            {quote && (
              quote.serviceable ? (
                <div className="notice-green text-sm">
                  Delhivery estimate: <b>{inr(quote.charge)}</b>
                  {quote.chargeableWeightGrams ? ` on ${(quote.chargeableWeightGrams / 1000).toFixed(2)} kg chargeable` : ''}
                  {quote.etaDays ? ` · about ${quote.etaDays} day${quote.etaDays > 1 ? 's' : ''}` : ''}
                  {quote.note ? ` · ${quote.note}` : ''}
                </div>
              ) : (
                <div className="notice-red text-sm">{quote.note || 'Delhivery does not deliver to this pincode'}</div>
              )
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-outline" onClick={getRate} disabled={!!busy || !grams}>
                {busy === 'quote' ? 'Asking Delhivery…' : 'Get rate'}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={book}
                disabled={!!busy || !grams || (d.ewaybillRequired && !ewb.trim()) || quote?.serviceable === false}
              >
                {busy === 'book' ? 'Booking…' : 'Book shipment'}
              </button>
              <button type="button" className="text-sm text-slate-500 hover:text-slate-800" onClick={() => setOpen(false)} disabled={!!busy}>Close</button>
              <span className="text-xs text-amber-800">Booking debits the Delhivery wallet.</span>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function PickupRow({ s, busy, onAct }: {
  s: Ship; busy: string | null;
  onAct: (s: Ship, a: 'label' | 'pickup' | 'cancel' | 'refresh', extra?: Record<string, unknown>) => Promise<void>;
}) {
  const [when, setWhen] = useState(defaultPickup());
  const canCancel = ['awb_assigned', 'pickup_scheduled', 'created'].includes(s.status);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <button type="button" className="btn-outline text-sm" onClick={() => onAct(s, 'label')} disabled={!!busy}>
        {busy === `label-${s.id}` ? '…' : 'Download label'}
      </button>
      {canCancel && (
        <>
          <input type="datetime-local" className="input w-auto text-sm" value={when} onChange={(e) => setWhen(e.target.value)} />
          <button
            type="button"
            className="btn-outline text-sm"
            onClick={() => onAct(s, 'pickup', { when: new Date(when).toISOString() })}
            disabled={!!busy || !when}
          >
            {busy === `pickup-${s.id}` ? '…' : s.pickupScheduledAt ? 'Request pickup again' : 'Request pickup'}
          </button>
        </>
      )}
      <button type="button" className="btn-outline text-sm" onClick={() => onAct(s, 'refresh')} disabled={!!busy}>
        {busy === `refresh-${s.id}` ? '…' : 'Refresh status'}
      </button>
      {canCancel && (
        <button type="button" className="text-sm text-red-700 hover:underline" onClick={() => onAct(s, 'cancel')} disabled={!!busy}>
          Cancel shipment
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
