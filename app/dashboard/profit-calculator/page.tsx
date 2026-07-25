'use client';

/**
 * Profit Calculator — pick a product (or type values) and see the true net
 * profit after GST, Razorpay fees, logistics and cost price.
 *
 * Selling price is GST-INCLUSIVE (the store's convention), so the GST shown is
 * the tax component already inside the price — it's remitted to the govt, not
 * kept. Profit = (price − GST) − cost − Razorpay fee − logistics.
 */
import { useEffect, useRef, useState } from 'react';
import { api, inr } from '@/lib/fetch';

interface ProdHit {
  id: number;
  sku: string;
  name: string;
  price: number | string;
  costPrice: number | string | null;
  taxPercent: number | string | null;
}

const num = (v: string | number | null | undefined) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export default function ProfitCalculatorPage() {
  // Product picker
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ProdHit[]>([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<ProdHit | null>(null);
  const token = useRef(0);

  // Editable inputs (kept as strings so the fields can be cleared while typing)
  const [sellingPrice, setSellingPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [gstPct, setGstPct] = useState('18');
  const [logistics, setLogistics] = useState('0');
  const [rzpPct, setRzpPct] = useState('2');

  // Debounced product search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits([]); return; }
    const my = ++token.current;
    const t = setTimeout(async () => {
      try {
        const res = await api<{ products: ProdHit[] }>(`/api/products?search=${encodeURIComponent(q)}&limit=12`);
        if (my === token.current) setHits(res.products || []);
      } catch { if (my === token.current) setHits([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  function pick(p: ProdHit) {
    setPicked(p);
    setQuery(`${p.name}`);
    setOpen(false);
    setSellingPrice(String(num(p.price)));
    setCostPrice(p.costPrice == null ? '' : String(num(p.costPrice)));
    setGstPct(p.taxPercent == null ? '18' : String(num(p.taxPercent)));
  }

  // ── Calculations ──────────────────────────────────────────────
  const SP = num(sellingPrice);       // GST-inclusive selling price
  const CP = num(costPrice);          // your purchase / manufacturing cost
  const gst = num(gstPct);
  const rzp = num(rzpPct);
  const logi = num(logistics);

  const gstAmt = SP > 0 && gst > 0 ? (SP * gst) / (100 + gst) : 0; // GST inside SP
  const netSale = SP - gstAmt;                                     // revenue excl GST
  const rzpFee = (SP * rzp) / 100;                                 // payment gateway fee
  const profit = netSale - CP - rzpFee - logi;
  const marginSP = SP > 0 ? (profit / SP) * 100 : 0;               // margin on selling price
  const marginCP = CP > 0 ? (profit / CP) * 100 : 0;               // markup on cost

  const rows: { label: string; value: number; sign: '+' | '-'; strong?: boolean; hint?: string }[] = [
    { label: 'Selling Price (incl. GST)', value: SP, sign: '+' },
    { label: `GST @ ${gst || 0}% (inside price)`, value: gstAmt, sign: '-', hint: 'remitted to govt' },
    { label: 'Net Sale (excl. GST)', value: netSale, sign: '+', strong: true },
    { label: 'Cost Price', value: CP, sign: '-' },
    { label: `Razorpay fee @ ${rzp || 0}%`, value: rzpFee, sign: '-' },
    { label: 'Logistics / Shipping', value: logi, sign: '-' },
  ];

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">Profit Calculator</h1>
        <p className="text-sm text-slate-500 mt-1">
          Pick a product (or type values) to see true net profit after GST, Razorpay fees, logistics and cost price.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* ── Inputs ── */}
        <div className="card p-6 space-y-4">
          {/* Product search */}
          <div className="relative">
            <label className="label">Fetch product</label>
            <input
              className="input"
              placeholder="Search by name or SKU…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); setPicked(null); }}
              onFocus={() => setOpen(true)}
            />
            {open && hits.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
                {hits.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pick(p)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                  >
                    <div className="text-sm font-medium text-slate-800 truncate">{p.name}</div>
                    <div className="text-xs text-slate-500 flex gap-3">
                      <span>{p.sku}</span>
                      <span>SP {inr(num(p.price))}</span>
                      <span>{p.costPrice == null ? 'no cost' : `cost ${inr(num(p.costPrice))}`}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {picked && (
              <p className="text-xs text-emerald-600 mt-1">
                Loaded: {picked.sku}{picked.costPrice == null ? ' · ⚠ cost price not set for this product' : ''}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Selling Price (incl. GST) ₹" value={sellingPrice} onChange={setSellingPrice} />
            <Field label="Cost Price ₹" value={costPrice} onChange={setCostPrice} />
            <Field label="GST %" value={gstPct} onChange={setGstPct} />
            <Field label="Razorpay fee %" value={rzpPct} onChange={setRzpPct} />
            <Field label="Logistics / Shipping ₹" value={logistics} onChange={setLogistics} />
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Tip: Razorpay charges ~2% + 18% GST on the fee ≈ <b>2.36%</b> — adjust if needed. Cost price is treated as your
            net cost; if it includes GST you can claim, actual profit is a little higher (input-tax credit).
          </p>
        </div>

        {/* ── Result ── */}
        <div className="card p-6">
          <div className="space-y-2.5">
            {rows.map((r, i) => (
              <div
                key={i}
                className={`flex items-center justify-between text-sm ${r.strong ? 'font-semibold text-slate-800 border-y border-slate-100 py-2 my-1' : 'text-slate-600'}`}
              >
                <span>
                  {r.label}
                  {r.hint && <span className="text-[11px] text-slate-400 ml-1.5">({r.hint})</span>}
                </span>
                <span className={r.sign === '-' && !r.strong ? 'text-slate-500' : ''}>
                  {r.sign === '-' && r.value > 0 ? '− ' : ''}{inr(r.value)}
                </span>
              </div>
            ))}
          </div>

          {/* Net profit */}
          <div className={`mt-5 rounded-xl p-5 ${profit >= 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-700">Net Profit</span>
              <span className={`font-head text-2xl font-extrabold ${profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                {inr(profit)}
              </span>
            </div>
            <div className="mt-2 flex gap-4 text-xs text-slate-500">
              <span>Margin on price: <b className={profit >= 0 ? 'text-emerald-700' : 'text-red-600'}>{marginSP.toFixed(1)}%</b></span>
              {CP > 0 && <span>Markup on cost: <b className={profit >= 0 ? 'text-emerald-700' : 'text-red-600'}>{marginCP.toFixed(1)}%</b></span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
        placeholder="0"
      />
    </div>
  );
}
