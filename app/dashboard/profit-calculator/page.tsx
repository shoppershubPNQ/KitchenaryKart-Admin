'use client';

/**
 * Profit Calculator — mirrors the owner's manual sheet.
 *
 *   COST:  base cost + GST (the GST is reclaimed as Input Tax Credit).
 *   SALE:  unit price − discount = basic; basic + GST = net price (customer pays).
 *   EXP:   logistics + packaging + Razorpay% (of net price) + net GST payable
 *          (GST collected − ITC).
 *   PROFIT = net price − total expenses − total cost (incl GST).
 *   Profit % is on the total cost (incl GST), matching the sheet's 32%.
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
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

export default function ProfitCalculatorPage() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ProdHit[]>([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<ProdHit | null>(null);
  const token = useRef(0);

  // Cost
  const [costPrice, setCostPrice] = useState(''); // base, excl GST
  const [claimItc, setClaimItc] = useState(true);  // supplier GST-registered?
  // Sale
  const [unitPrice, setUnitPrice] = useState('');  // excl GST list price
  const [discPct, setDiscPct] = useState('0');
  const [gstPct, setGstPct] = useState('18');
  // Expenses
  const [rzpPct, setRzpPct] = useState('2.36');
  const [logistics, setLogistics] = useState('0');
  const [packaging, setPackaging] = useState('0');
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
    const g = p.taxPercent == null ? 18 : num(p.taxPercent);
    setGstPct(String(g));
    setCostPrice(p.costPrice == null ? '' : String(num(p.costPrice)));
    // product.price is the GST-inclusive selling price → back out the excl-GST
    // basic as the unit price, with 0 extra discount (price is already final).
    const basic = num(p.price) / (1 + g / 100);
    setUnitPrice(basic ? basic.toFixed(2) : '');
    setDiscPct('0');
  }

  // ── Calculations (mirror the sheet) ───────────────────────────
  const gst = num(gstPct);
  const cost = num(costPrice);
  const unit = num(unitPrice);
  const disc = num(discPct);
  const rzp = num(rzpPct);
  const logi = num(logistics);
  const pack = num(packaging);
  const q = Math.max(1, Math.round(num(qty)) || 1);

  // Cost side
  const gstOnCost = claimItc ? (cost * gst) / 100 : 0;
  const totalCost = cost + gstOnCost; // incl GST
  const itc = gstOnCost;

  // Sale side
  const discAmt = (unit * disc) / 100;
  const basic = unit - discAmt;
  const gstCollected = (basic * gst) / 100;
  const netPrice = basic + gstCollected; // customer pays

  // Expenses
  const rzpFee = (netPrice * rzp) / 100;
  const netGstPaid = gstCollected - itc;
  const totalExpense = logi + pack + rzpFee + netGstPaid;

  // Profit
  const profit = netPrice - totalExpense - totalCost;
  const profitPct = pct(profit, totalCost);   // 32% — headline (return on cost incl GST)
  const marginSale = pct(profit, basic);      // net margin on ex-GST sale
  const markupCost = pct(profit, cost);       // markup on net cost
  const totalProfit = profit * q;

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">Profit Calculator</h1>
        <p className="text-sm text-slate-500 mt-1">
          Fetch a product (or type values) — computes true net profit after GST, Input Tax Credit, Razorpay fee, logistics and packaging.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* ── Inputs ── */}
        <div className="card p-6 space-y-5">
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
                  <button key={p.id} type="button" onClick={() => pick(p)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{p.name}</div>
                    <div className="text-xs text-slate-500 flex gap-3">
                      <span>{p.sku}</span><span>SP {inr(num(p.price))}</span>
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

          {/* COST */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-400">Cost</span>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer">
                <input type="checkbox" checked={claimItc} onChange={(e) => setClaimItc(e.target.checked)} />
                Claim GST input credit (ITC)
              </label>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Cost Price (excl. GST) ₹" value={costPrice} onChange={setCostPrice} />
              <Field label="GST %" value={gstPct} onChange={setGstPct} />
            </div>
          </div>

          {/* SALE */}
          <div>
            <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-400">Selling</span>
            <div className="grid grid-cols-2 gap-4 mt-1">
              <Field label="Unit Price (excl. GST) ₹" value={unitPrice} onChange={setUnitPrice} />
              <Field label="Discount %" value={discPct} onChange={setDiscPct} />
            </div>
          </div>

          {/* EXPENSES */}
          <div>
            <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-400">Expenses</span>
            <div className="grid grid-cols-2 gap-4 mt-1">
              <Field label="Razorpay fee %" value={rzpPct} onChange={setRzpPct} />
              <Field label="Quantity" value={qty} onChange={setQty} />
              <Field label="Logistics / Shipping ₹" value={logistics} onChange={setLogistics} />
              <Field label="Packaging ₹" value={packaging} onChange={setPackaging} />
            </div>
          </div>
        </div>

        {/* ── Result ── */}
        <div className="card p-6">
          <Section title="Cost">
            <Row label="Cost Price" value={cost} />
            <Row label={`+ GST @ ${gst || 0}%`} value={gstOnCost} muted hint="= ITC" />
            <Row label="Total Cost (incl. GST)" value={totalCost} strong />
          </Section>

          <Section title="Selling">
            <Row label="Unit Price (excl. GST)" value={unit} />
            <Row label={`− Discount ${disc || 0}%`} value={discAmt} muted sub />
            <Row label="Basic Price (excl. GST)" value={basic} />
            <Row label={`+ GST @ ${gst || 0}%`} value={gstCollected} muted />
            <Row label="Net Price (incl. GST)" value={netPrice} strong />
          </Section>

          <Section title="Expenses">
            <Row label="Logistics" value={logi} sub />
            <Row label="Packaging" value={pack} sub />
            <Row label={`Razorpay @ ${rzp || 0}%`} value={rzpFee} sub />
            <Row label="GST paid (collected − ITC)" value={netGstPaid} sub />
            <Row label="Total Expense" value={totalExpense} strong />
          </Section>

          {/* Net profit */}
          <div className={`mt-4 rounded-xl p-5 ${profit >= 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-500">Net Profit</div>
                <div className={`font-head text-2xl font-extrabold ${profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{inr(profit)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-500">Profit Margin</div>
                <div className={`font-head text-3xl font-extrabold ${profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{profitPct.toFixed(0)}%</div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
              <span>On cost (incl GST): <b className={profit >= 0 ? 'text-emerald-700' : 'text-red-600'}>{profitPct.toFixed(1)}%</b></span>
              <span>On sale (ex-GST): <b>{marginSale.toFixed(1)}%</b></span>
              <span>Markup on cost: <b>{markupCost.toFixed(1)}%</b></span>
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
        {hint && <span className="text-[11px] text-slate-400 ml-1.5">{hint}</span>}
      </span>
      <span>{inr(value)}</span>
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
