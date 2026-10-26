'use client';

/**
 * "Create replacement" — when an item or a part of a paid order arrived broken, send it again free of charge.
 *
 * Makes a linked ₹0 order (e.g. KKMVETUXB3-R1, lib/replacement.ts) that is ready to ship from its own page: book
 * Delhivery/Shiprocket there as usual. It prints a Delivery Challan (no GST invoice number), sends no sale emails
 * or review request, and is left out of sales reports. Stock comes down when it is marked delivered (catalogue
 * items only — a part we do not sell on its own has no stock).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, inr } from '@/lib/fetch';

interface Item { id: number; productName: string; productSku: string; quantity: number; unitPrice: number }
type SkuRow = { sku: string; qty: string };
type TextRow = { name: string; qty: string; value: string };

const int = (s: string) => (/^\d+$/.test(s.trim()) ? parseInt(s, 10) : NaN);
const money = (s: string) => { const n = parseFloat(s.replace(/,/g, '')); return Number.isFinite(n) ? n : NaN; };

export function CreateReplacement({ orderId, orderNumber, items }: { orderId: number; orderNumber: string; items: Item[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [parts, setParts] = useState<TextRow[]>([]);
  const [reason, setReason] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function buildLines() {
    const lines: Array<Record<string, unknown>> = [];
    for (const it of items) {
      if (picked[it.id] === undefined) continue;
      const q = int(picked[it.id]);
      if (!(q >= 1 && q <= it.quantity)) throw new Error(`${it.productName}: quantity must be 1 to ${it.quantity}`);
      lines.push({ kind: 'item', orderItemId: it.id, quantity: q });
    }
    for (const r of skus) {
      if (!r.sku.trim()) continue;
      const q = int(r.qty);
      if (!(q >= 1)) throw new Error(`SKU ${r.sku}: enter a quantity`);
      lines.push({ kind: 'sku', sku: r.sku.trim(), quantity: q });
    }
    for (const r of parts) {
      if (!r.name.trim()) continue;
      const q = int(r.qty);
      const v = money(r.value);
      if (!(q >= 1)) throw new Error(`${r.name}: enter a quantity`);
      if (!(v > 0)) throw new Error(`${r.name}: enter its value per piece (₹) — the courier and the challan need it`);
      lines.push({ kind: 'text', name: r.name.trim(), quantity: q, unitValue: v });
    }
    if (!lines.length) throw new Error('Tick an item, or add a spare / part to send');
    return lines;
  }

  async function submit() {
    setErr(null);
    let lines;
    try { lines = buildLines(); } catch (e) { setErr((e as Error).message); return; }
    if (reason.trim().length < 3) { setErr('Write the reason — what arrived broken'); return; }
    if (!window.confirm(
      `Create a FREE replacement for ${orderNumber}?\n\n` +
      'A new ₹0 order will be made, ready to ship. Nothing is charged, no tax invoice is made (it prints a Delivery Challan), ' +
      'and it is not counted as a sale.',
    )) return;
    setBusy(true);
    try {
      const res = await api<{ order: { id: number; orderNumber: string } }>(`/api/orders/${orderId}/replacement`, {
        method: 'POST',
        body: JSON.stringify({ lines, reason: reason.trim(), shippingAddress: address.trim() || null }),
      });
      router.push(`/dashboard/orders/${res.order.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the replacement');
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="text-sm text-slate-700">
          <span className="font-medium text-slate-900">Something arrived broken?</span>{' '}
          Send the item or part again free — a linked ₹0 order you can ship from its own page.
        </div>
        <button type="button" className="btn-outline text-sm" onClick={() => setOpen(true)}>Create replacement</button>
      </div>
    );
  }

  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Create a free replacement for {orderNumber}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Same customer and address. Nothing is charged; it prints a Delivery Challan, not a tax invoice, and is not
            counted as a sale. Book the courier from the new order&apos;s page.
          </p>
        </div>
        <button type="button" className="text-sm text-slate-500 hover:text-slate-800" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
      </div>

      <div>
        <div className="label">Send again from this order</div>
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {items.map((it) => {
            const on = picked[it.id] !== undefined;
            return (
              <label key={it.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <input type="checkbox" checked={on} disabled={busy}
                  onChange={(e) => setPicked((m) => { const n = { ...m }; if (e.target.checked) n[it.id] = '1'; else delete n[it.id]; return n; })} />
                <span className="flex-1">
                  {it.productName} <span className="font-mono text-[11px] text-slate-400">{it.productSku}</span>
                  <span className="ml-1 text-[11px] text-slate-400">· ordered {it.quantity} · {inr(it.unitPrice)} each</span>
                </span>
                {on && (
                  <input className="input !py-1 w-20" inputMode="numeric" value={picked[it.id]} disabled={busy}
                    onChange={(e) => setPicked((m) => ({ ...m, [it.id]: e.target.value.replace(/[^0-9]/g, '') }))} />
                )}
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <div className="label">Or only a spare part we sell (by SKU)</div>
        {skus.map((r, i) => (
          <div key={i} className="mb-2 flex gap-2">
            <input className="input font-mono" placeholder="e.g. KKSP0250-OS09" value={r.sku} disabled={busy}
              onChange={(e) => setSkus((a) => a.map((x, j) => (j === i ? { ...x, sku: e.target.value } : x)))} />
            <input className="input w-24" inputMode="numeric" placeholder="Qty" value={r.qty} disabled={busy}
              onChange={(e) => setSkus((a) => a.map((x, j) => (j === i ? { ...x, qty: e.target.value.replace(/[^0-9]/g, '') } : x)))} />
            <button type="button" className="text-sm text-slate-400 hover:text-red-600" onClick={() => setSkus((a) => a.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" className="text-sm text-brand" disabled={busy} onClick={() => setSkus((a) => [...a, { sku: '', qty: '1' }])}>+ Add spare by SKU</button>
      </div>

      <div>
        <div className="label">Or a part we don&apos;t sell on its own <span className="font-normal text-slate-400">(e.g. a lid — no stock change)</span></div>
        {parts.map((r, i) => (
          <div key={i} className="mb-2 flex gap-2">
            <input className="input" placeholder="e.g. Transparent front cover (lid) for SS bread box" value={r.name} disabled={busy}
              onChange={(e) => setParts((a) => a.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input className="input w-20" inputMode="numeric" placeholder="Qty" value={r.qty} disabled={busy}
              onChange={(e) => setParts((a) => a.map((x, j) => (j === i ? { ...x, qty: e.target.value.replace(/[^0-9]/g, '') } : x)))} />
            <input className="input w-32" inputMode="decimal" placeholder="Value ₹/pc" value={r.value} disabled={busy}
              onChange={(e) => setParts((a) => a.map((x, j) => (j === i ? { ...x, value: e.target.value.replace(/[^0-9.]/g, '') } : x)))} />
            <button type="button" className="text-sm text-slate-400 hover:text-red-600" onClick={() => setParts((a) => a.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" className="text-sm text-brand" disabled={busy} onClick={() => setParts((a) => [...a, { name: '', qty: '1', value: '' }])}>+ Add part</button>
      </div>

      <div>
        <label className="label">Reason (printed on the challan)</label>
        <input className="input" placeholder="e.g. Bulb broken in transit" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div>
        <label className="label">Different delivery address? <span className="font-normal text-slate-400">(leave empty to use the order&apos;s)</span></label>
        <textarea className="input" rows={2} value={address} disabled={busy} onChange={(e) => setAddress(e.target.value)} />
      </div>

      {err && <div className="notice-red">{err}</div>}
      <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
        {busy ? 'Creating…' : 'Create free replacement'}
      </button>
    </div>
  );
}
