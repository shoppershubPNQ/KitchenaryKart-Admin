'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, inr } from '@/lib/fetch';

interface Product { id: number; sku: string; name: string; price: number }
interface Line { productId: number; sku: string; name: string; unitPrice: number; quantity: number }
interface Quote {
  summary: {
    netPrice: number; discountPct: number; discountAmount: number; netValue: number;
    gstAmount: number; gstRateLabel: string; shipping: number; roundOff: number; netPayable: number;
  };
  shipping: {
    cost: number; auto: boolean; zone: string | null; grams: number | null;
    state: string | null; rate: number; gst: number;
  };
}
interface CustomerHit {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  shippingAddress: string | null;
  billingAddress: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  gstNumber: string | null;
}

export default function NewOrderPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [customer, setCustomer] = useState({ name: '', email: '', phone: '', address: '' });
  // Freight is calculated (zone x weight) exactly as the website would quote it.
  // Blank = automatic; type a number only to deliberately override it.
  const [shipOverride, setShipOverride] = useState('');
  const [discount, setDiscount] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Live breakdown from the server, using the SAME helper that prices the
  // order on save — so what the operator sees is what the customer pays.
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);

  // Existing-customer picker. Selecting one fills the fields below AND links
  // the order to that customer id, so the order shows up in their history
  // instead of creating a duplicate customer record.
  const [custQuery, setCustQuery] = useState('');
  const [custHits, setCustHits] = useState<CustomerHit[]>([]);
  const [picked, setPicked] = useState<CustomerHit | null>(null);
  const [gstin, setGstin] = useState('');

  // Payment link, created after the order exists (it needs the order total).
  const [payLink, setPayLink] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<{ id: number; orderNumber: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      if (query.length < 2) { setProducts([]); return; }
      api<{ products: Product[] }>('/api/products?search=' + encodeURIComponent(query) + '&limit=15').then(d => setProducts(d.products));
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (custQuery.trim().length < 2) { setCustHits([]); return; }
      api<{ customers: CustomerHit[] }>('/api/customers?search=' + encodeURIComponent(custQuery.trim()) + '&limit=8')
        .then(d => setCustHits(d.customers))
        .catch(() => setCustHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [custQuery]);

  // Re-price whenever anything that affects the money changes. Debounced so
  // typing an address or a quantity doesn't fire a request per keystroke.
  useEffect(() => {
    if (!lines.length) { setQuote(null); setQuoteErr(null); return; }
    const t = setTimeout(() => {
      setQuoting(true);
      const ship = shipOverride.trim();
      const disc = discount.trim();
      api<Quote>('/api/orders/quote', {
        method: 'POST',
        body: JSON.stringify({
          shippingAddress: customer.address || undefined,
          shippingCost: ship === '' ? undefined : Math.max(0, parseFloat(ship) || 0),
          discountAmount: disc === '' ? undefined : Math.max(0, parseFloat(disc) || 0),
          items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })),
        }),
      })
        .then((q) => { setQuote(q); setQuoteErr(null); })
        .catch((e: any) => { setQuote(null); setQuoteErr(e?.message || 'Could not price this order'); })
        .finally(() => setQuoting(false));
    }, 350);
    return () => clearTimeout(t);
  }, [lines, customer.address, shipOverride, discount]);

  function pickCustomer(c: CustomerHit) {
    setPicked(c);
    setCustomer({
      name: c.name || '',
      email: c.email || '',
      phone: c.phone || '',
      // Prefer the shipping address; fall back to billing, then compose from
      // the city/state/pin we hold so the field is not left empty.
      address:
        c.shippingAddress ||
        c.billingAddress ||
        [c.city, c.state, c.postalCode].filter(Boolean).join(', '),
    });
    setGstin(c.gstNumber || '');
    setCustQuery('');
    setCustHits([]);
  }

  function clearCustomer() {
    setPicked(null);
    setCustomer({ name: '', email: '', phone: '', address: '' });
    setGstin('');
  }

  async function makePaymentLink(orderId: number) {
    setLinking(true);
    setErr(null);
    try {
      const res = await api<{ url: string; reused: boolean }>(`/api/orders/${orderId}/payment-link`, { method: 'POST' });
      setPayLink(res.url);
    } catch (e: any) {
      setErr(e?.message || 'Could not create the payment link');
    } finally {
      setLinking(false);
    }
  }

  function addLine(p: Product) {
    setLines(prev => {
      const existing = prev.find(l => l.productId === p.id);
      if (existing) return prev.map(l => l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l);
      return [...prev, { productId: p.id, sku: p.sku, name: p.name, unitPrice: Number(p.price), quantity: 1 }];
    });
    setQuery('');
    setProducts([]);
  }
  function setQty(id: number, q: number) {
    setLines(prev => prev.map(l => l.productId === id ? { ...l, quantity: Math.max(1, q) } : l));
  }
  function removeLine(id: number) { setLines(prev => prev.filter(l => l.productId !== id)); }

  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!lines.length) { setErr('Add at least one item'); return; }
    setErr(null);
    setSaving(true);
    try {
      const payload = {
        // Linking the id keeps the order in the customer's history rather than
        // silently creating a second record with the same email.
        customerId: picked?.id,
        customerName: customer.name,
        customerEmail: customer.email || undefined,
        customerPhone: customer.phone,
        customerGstin: gstin || undefined,
        shippingAddress: customer.address,
        // Omitted = the server calculates zone x weight freight itself. Only
        // send a figure when the operator deliberately overrode it.
        shippingCost: shipOverride.trim() === '' ? undefined : Math.max(0, parseFloat(shipOverride) || 0),
        discountAmount: discount.trim() === '' ? undefined : Math.max(0, parseFloat(discount) || 0),
        items: lines.map(l => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })),
      };
      const { order } = await api<{ order: { id: number; orderNumber: string } }>(
        '/api/orders', { method: 'POST', body: JSON.stringify(payload) },
      );
      // Stay on the page so the payment link can be created and copied; the
      // order page is one click away.
      setCreatedOrder({ id: order.id, orderNumber: order.orderNumber });
      await makePaymentLink(order.id);
    } catch (e: any) {
      setErr(e.message);
    } finally { setSaving(false); }
  }

  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Manual order</h1>
      <p className="text-sm text-slate-500 -mt-2">
        Raise an order for a customer who ordered by phone or WhatsApp, then send them a
        payment link. Search an existing customer to fill their saved details.
      </p>

      {/* Order placed — show the payment link to share. Kept above the form so
          it is the first thing seen after saving. */}
      {createdOrder && (
        <div className="card p-4 border-l-4 border-emerald-500 bg-emerald-50 space-y-3">
          <div className="text-sm text-emerald-900">
            <span className="font-semibold">Order {createdOrder.orderNumber} created.</span>{' '}
            It stays unpaid until the customer pays this link.
          </div>

          {linking && <div className="text-xs text-slate-500">Creating payment link…</div>}

          {payLink && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <input readOnly value={payLink} className="input input-sm flex-1 min-w-[260px] font-mono text-xs" />
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(payLink)}
                  className="btn-secondary text-sm"
                >
                  Copy
                </button>
                {customer.phone && (
                  <a
                    className="btn-secondary text-sm"
                    target="_blank"
                    rel="noreferrer"
                    href={`https://wa.me/91${customer.phone.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(
                      `Namaste ${customer.name}, your KitchenaryKart order ${createdOrder.orderNumber} is ready. Pay here: ${payLink}`,
                    )}`}
                  >
                    Send on WhatsApp
                  </a>
                )}
                <a className="btn-primary text-sm" href={`/dashboard/orders/${createdOrder.id}`}>
                  Open order →
                </a>
              </div>
              <p className="text-[11px] text-emerald-800">
                The link is valid for 7 days and is NOT sent automatically — share it yourself.
                Once paid, the order is marked complete and the invoice + confirmation email go out.
              </p>
            </>
          )}

          {!linking && !payLink && (
            <button type="button" onClick={() => makePaymentLink(createdOrder.id)} className="btn-secondary text-sm">
              Retry payment link
            </button>
          )}
        </div>
      )}

      <form onSubmit={submit} className="card p-6 space-y-6">
        {/* Existing-customer picker */}
        <div>
          <label className="label">Find an existing customer</label>
          {picked ? (
            <div className="flex items-center gap-3 text-sm bg-slate-50 border border-slate-200 rounded px-3 py-2">
              <span className="font-medium text-slate-800">{picked.name}</span>
              <span className="text-slate-500">{picked.email}</span>
              {picked.phone && <span className="text-slate-500">· {picked.phone}</span>}
              <span className="text-[11px] text-slate-400">#{picked.id}</span>
              <button type="button" onClick={clearCustomer} className="ml-auto text-xs text-red-600 hover:text-red-700">
                Clear
              </button>
            </div>
          ) : (
            <>
              <input
                className="input"
                placeholder="Search by name, email or phone (min 2 characters)…"
                value={custQuery}
                onChange={(e) => setCustQuery(e.target.value)}
              />
              {custHits.length > 0 && (
                <div className="border border-slate-200 rounded mt-1 max-h-56 overflow-y-auto">
                  {custHits.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pickCustomer(c)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 border-b border-slate-100 last:border-0"
                    >
                      <span className="font-medium text-slate-800">{c.name}</span>
                      <span className="text-slate-500 ml-2">{c.email}</span>
                      {c.phone && <span className="text-slate-400 ml-2">· {c.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-slate-400 mt-1">
                Or just type the details below for a new customer.
              </p>
            </>
          )}
        </div>

        <fieldset className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <legend className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2 col-span-full">Customer</legend>
          <div><label className="label">Name</label><input className="input" value={customer.name} onChange={e => setCustomer(c => ({ ...c, name: e.target.value }))} required /></div>
          <div><label className="label">Email</label><input type="email" className="input" value={customer.email} onChange={e => setCustomer(c => ({ ...c, email: e.target.value }))} /></div>
          <div><label className="label">Phone</label><input className="input" value={customer.phone} onChange={e => setCustomer(c => ({ ...c, phone: e.target.value }))} /></div>
          <div>
            <label className="label">Discount (₹, incl. GST)</label>
            <input type="number" step="0.01" min="0" className="input" placeholder="0.00"
              value={discount} onChange={e => setDiscount(e.target.value)} />
          </div>
          <div className="md:col-span-2"><label className="label">Shipping address</label><textarea className="input" rows={2} value={customer.address} onChange={e => setCustomer(c => ({ ...c, address: e.target.value }))} /></div>
          <div className="md:col-span-2">
            <label className="label">Shipping cost</label>
            <div className="flex items-center gap-2">
              <input
                type="number" step="0.01" min="0" className="input w-40"
                placeholder={quote ? `Auto: ${quote.shipping.cost.toFixed(2)}` : 'Auto'}
                value={shipOverride}
                onChange={e => setShipOverride(e.target.value)}
              />
              {shipOverride.trim() !== '' && (
                <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setShipOverride('')}>
                  Use calculated
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Leave blank and the delivery charge is calculated from the destination and the
              order weight — the same figure the website quotes. Enter ex-GST; GST is added on top.
            </p>
          </div>
        </fieldset>

        <div>
          <label className="label">Add product</label>
          <input className="input" placeholder="Type SKU or name…" value={query} onChange={e => setQuery(e.target.value)} />
          {products.length > 0 && (
            <ul className="mt-1 border border-slate-200 rounded-md shadow-sm bg-white max-h-64 overflow-y-auto">
              {products.map(p => (
                <li key={p.id}>
                  <button type="button" className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm" onClick={() => addLine(p)}>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-slate-500 font-mono">{p.sku} · {inr(p.price)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {lines.length > 0 && (
          <div>
            <div className="label">Line items</div>
            <table className="w-full text-sm border border-slate-200 rounded-md">
              <thead className="bg-slate-50 text-xs">
                <tr><th className="text-left px-3 py-2">Item</th><th className="text-right px-3 py-2">Unit</th><th className="px-3 py-2">Qty</th><th className="text-right px-3 py-2">Total</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map(l => (
                  <tr key={l.productId}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{l.name}</div>
                      <div className="font-mono text-xs text-slate-500">{l.sku}</div>
                    </td>
                    <td className="px-3 py-2 text-right">{inr(l.unitPrice)}</td>
                    <td className="px-3 py-2 text-center">
                      <input type="number" min={1} className="input w-20 text-center" value={l.quantity} onChange={e => setQty(l.productId, parseInt(e.target.value))} />
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{inr(l.unitPrice * l.quantity)}</td>
                    <td className="px-3 py-2 text-right"><button type="button" onClick={() => removeLine(l.productId)} className="text-red-600 text-xs hover:underline">Remove</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 text-sm">
                <tr><td colSpan={3} className="px-3 py-2 text-right text-slate-500">Subtotal (incl. GST)</td><td className="px-3 py-2 text-right font-semibold">{inr(subtotal)}</td><td></td></tr>
              </tfoot>
            </table>

            {/* The binding breakdown, priced by the server with the same helper
                the invoice and the GST report use. Shown BEFORE saving so a
                payment link is never raised for a number nobody checked. */}
            <div className="mt-3 border border-slate-200 rounded-md overflow-hidden">
              <div className="bg-slate-100 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-600 flex items-center gap-2">
                Breakdown
                {quoting && <span className="text-[10px] normal-case font-normal text-slate-400">calculating…</span>}
              </div>

              {quoteErr && (
                <div className="px-3 py-2 text-sm text-red-700 bg-red-50">{quoteErr}</div>
              )}

              {quote && !quoteErr && (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="px-3 py-1.5 text-slate-500">Net price (ex-GST)</td>
                      <td className="px-3 py-1.5 text-right">{inr(quote.summary.netPrice)}</td>
                    </tr>
                    {quote.summary.discountAmount > 0 && (
                      <tr className="text-emerald-700">
                        <td className="px-3 py-1.5">Discount ({quote.summary.discountPct.toFixed(1)}%)</td>
                        <td className="px-3 py-1.5 text-right">− {inr(quote.summary.discountAmount)}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="px-3 py-1.5 text-slate-500">Net value (GST base)</td>
                      <td className="px-3 py-1.5 text-right">{inr(quote.summary.netValue)}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-1.5 text-slate-500">
                        GST {quote.summary.gstRateLabel || '(mixed rates)'}
                        <span className="text-[11px] text-slate-400 ml-1">incl. {inr(quote.shipping.gst)} on freight</span>
                      </td>
                      <td className="px-3 py-1.5 text-right">{inr(quote.summary.gstAmount)}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-1.5 text-slate-500">
                        Shipping (ex-GST)
                        {quote.shipping.auto ? (
                          <span className="text-[11px] text-slate-400 ml-1">
                            auto · {quote.shipping.zone} zone · {quote.shipping.grams}g
                            {quote.shipping.state ? ` · ${quote.shipping.state}` : ''}
                          </span>
                        ) : (
                          <span className="text-[11px] text-amber-600 ml-1">manual override</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right">{inr(quote.shipping.cost)}</td>
                    </tr>
                    {Math.abs(quote.summary.roundOff) >= 0.005 && (
                      <tr>
                        <td className="px-3 py-1.5 text-slate-500">Round off</td>
                        <td className="px-3 py-1.5 text-right">{inr(quote.summary.roundOff)}</td>
                      </tr>
                    )}
                    <tr className="bg-slate-50 font-semibold text-slate-900">
                      <td className="px-3 py-2">Total payable</td>
                      <td className="px-3 py-2 text-right text-base">{inr(quote.summary.netPayable)}</td>
                    </tr>
                  </tbody>
                </table>
              )}

              {!quote && !quoteErr && !quoting && (
                <div className="px-3 py-2 text-xs text-slate-400">Add an item to see the breakdown.</div>
              )}
            </div>

            {/* Zone falls back to West when no state can be read out of the
                address — silently the wrong freight for a far-away customer. */}
            {quote?.shipping.auto && !quote.shipping.state && (
              <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                No state could be read from the shipping address, so the default zone was used
                ({quote.shipping.zone}). Add the state to the address for the correct delivery charge.
              </div>
            )}

            <p className="text-xs text-slate-500 mt-2">
              Prices are GST-inclusive — the GST above is backed out of them, not added on top.
              This is the exact amount the payment link will ask for.
            </p>
          </div>
        )}

        {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create order'}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
