'use client';

/**
 * Profit Calculator — pick a product (or type values) and see true net profit
 * after GST, Razorpay fees, logistics, packaging and cost price.
 *
 * Selling price is GST-INCLUSIVE (the store's convention). Cost price can be
 * entered GST-inclusive (then the GST portion is claimable as Input Tax Credit)
 * or GST-exclusive (net cost). Profit = Net Sale − Net Cost − fees − logistics
 * − packaging, and Net GST to govt = GST collected − ITC on the cost.
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
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ProdHit[]>([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<ProdHit | null>(null);
  const token = useRef(0);

  const [sellingPrice, setSellingPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [costInclGst, setCostInclGst] = useState(true); // cost entered incl. GST?
  const [gstPct, setGstPct] = useState('18');
  const [logistics, setLogistics] = useState('0');
  const [packaging, setPackaging] = useState('0');
  const [rzpPct, setRzpPct] = useState('2');
  const [qty, setQty] = useState('1');

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
    setQuery(p.name);
    setOpen(false);
    setSellingPrice(String(num(p.price)));
    setCostPrice(p.costPrice == null ? '' : String(num(p.costPrice)));
    setGstPct(p.taxPercent == null ? '18' : String(num(p.taxPercent)));
  }

  // ── Calculations ──────────────────────────────────────────────
  const SP = num(sellingPrice);
  const CPraw = num(costPrice);
  const gst = num(gstPct);
  const rzp = num(rzpPct);
  const logi = num(logistics);
  const pack = num(packaging);
  const q = Math.max(1, Math.round(num(qty)) || 1);

  const gstCollected = SP > 0 && gst > 0 ? (SP * gst) / (100 + gst) : 0; // GST inside SP
  const netSale = SP - gstCollected;                                     // revenue excl GST

  const netCost = costInclGst && gst > 0 ? (CPraw * 100) / (100 + gst) : CPraw; // COGS excl GST
  const itc = costInclGst ? CPraw - netCost : 0;                               // input tax credit
  const netGstPayable = gstCollected - itc;                                    // to govt

  const rzpFee = (SP * rzp) / 100;
  const profit = netSale - netCost - rzpFee - logi - pack; // per unit
  const totalProfit = profit * q;
  const marginSP = SP > 0 ? (profit / SP) * 100 : 0;
  const markupCost = netCost > 0 ? (profit / netCost) * 100 : 0;

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">Profit Calculator</h1>
        <p className="text-sm text-slate-500 mt-1">
          Fetch a product (or type values) to see true net profit after GST, Input Tax Credit, Razorpay fees, logistics and packaging.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* ── Inputs ── */}
        <div className="card p-6 space-y-4">
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
            <Field label="GST %" value={gstPct} onChange={setGstPct} />
          </div>

          {/* Cost price + incl/excl GST toggle */}
          <div>
            <div className="flex items-center justify-between">
              <label className="label mb-0">Cost Price ₹</label>
              <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setCostInclGst(true)}
                  className={`px-2.5 py-1 transition ${costInclGst ? 'bg-brand text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                >
                  Incl. GST
                </button>
                <button
                  type="button"
                  onClick={() => setCostInclGst(false)}
                  className={`px-2.5 py-1 transition ${!costInclGst ? 'bg-brand text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                >
                  Excl. GST
                </button>
              </div>
            </div>
            <input
              className="input mt-1"
              inputMode="decimal"
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              {costInclGst
                ? `GST-inclusive purchase cost — the GST inside it is claimed back as Input Tax Credit. Net cost: ${inr(netCost)}`
                : 'Net cost, GST already excluded (no input credit shown).'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Razorpay fee %" value={rzpPct} onChange={setRzpPct} />
            <Field label="Quantity" value={qty} onChange={setQty} />
            <Field label="Logistics / Shipping ₹" value={logistics} onChange={setLogistics} />
            <Field label="Packaging ₹" value={packaging} onChange={setPackaging} />
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Razorpay ~2% + 18% GST on fee ≈ <b>2.36%</b>. Logistics &amp; packaging are per unit.
          </p>
        </div>

        {/* ── Result ── */}
        <div className="card p-6">
          <Section title="Sale">
            <Row label="Selling Price (incl. GST)" value={SP} />
            <Row label={`GST collected @ ${gst || 0}%`} value={gstCollected} muted hint="inside price" />
            <Row label="Net Sale (excl. GST)" value={netSale} strong />
          </Section>

          <Section title="Costs (per unit)">
            <Row label={`Cost Price (${costInclGst ? 'incl.' : 'excl.'} GST)`} value={CPraw} sub />
            <Row label="Net Cost (COGS, excl. GST)" value={netCost} muted />
            <Row label="Razorpay fee" value={rzpFee} sub />
            <Row label="Logistics" value={logi} sub />
            <Row label="Packaging" value={pack} sub />
          </Section>

          <Section title="GST to Government">
            <Row label="GST collected" value={gstCollected} muted />
            <Row label="− Input Tax Credit (on cost)" value={itc} muted />
            <Row label="Net GST payable" value={netGstPayable} strong />
          </Section>

          {/* Net profit */}
          <div className={`mt-4 rounded-xl p-5 ${profit >= 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-700">Net Profit / unit</span>
              <span className={`font-head text-2xl font-extrabold ${profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                {inr(profit)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>Margin on price: <b className={profit >= 0 ? 'text-emerald-700' : 'text-red-600'}>{marginSP.toFixed(1)}%</b></span>
              {netCost > 0 && <span>Markup on cost: <b className={profit >= 0 ? 'text-emerald-700' : 'text-red-600'}>{markupCost.toFixed(1)}%</b></span>}
            </div>
            {q > 1 && (
              <div className="mt-3 pt-3 border-t border-emerald-200/60 flex items-center justify-between">
                <span className="font-semibold text-slate-600">Total for {q} units</span>
                <span className={`font-head text-lg font-bold ${totalProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {inr(totalProfit)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-400 mb-1.5">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value, muted, strong, sub, hint }: {
  label: string; value: number; muted?: boolean; strong?: boolean; sub?: boolean; hint?: string;
}) {
  return (
    <div className={`flex items-center justify-between text-sm ${
      strong ? 'font-semibold text-slate-800 border-t border-slate-100 pt-1.5' : muted ? 'text-slate-400' : 'text-slate-600'
    }`}>
      <span>
        {label}
        {hint && <span className="text-[11px] text-slate-400 ml-1.5">({hint})</span>}
      </span>
      <span>{sub && value > 0 ? '− ' : ''}{inr(value)}</span>
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
