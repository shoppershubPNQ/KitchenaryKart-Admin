'use client';

/**
 * "Payment received outside Razorpay" — for money that arrives by bank transfer,
 * UPI straight to our account, cash or cheque.
 *
 * Use this, not the Payment status dropdown. The dropdown only flips a label; a
 * real payment also records a Payment row, allocates the GST invoice number,
 * counts the coupon, moves the order into fulfilment and emails the customer and
 * the team. This goes through the same finalizePaidOrder as a Razorpay payment.
 */
import { useState } from 'react';
import { api, inr } from '@/lib/fetch';

const METHODS = [
  { v: 'bank_transfer', label: 'Bank transfer (NEFT / IMPS / RTGS)', ref: 'UTR / reference number', placeholder: 'e.g. 626016511395' },
  { v: 'upi_direct', label: 'UPI to our account', ref: 'UPI transaction ID', placeholder: 'UPI ref from the payment screen' },
  { v: 'cash', label: 'Cash', ref: 'Receipt number (optional)', placeholder: '' },
  { v: 'cheque', label: 'Cheque', ref: 'Cheque number', placeholder: '' },
] as const;

export function MarkPaidOffline({
  orderId,
  orderNumber,
  total,
  customerEmail,
  onDone,
}: {
  orderId: number;
  orderNumber: string;
  total: number;
  customerEmail: string | null;
  onDone: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<(typeof METHODS)[number]['v']>('bank_transfer');
  const [reference, setReference] = useState('');
  const [sendEmails, setSendEmails] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const m = METHODS.find((x) => x.v === method)!;

  async function submit() {
    setErr(null);
    const ref = reference.trim();
    const confirmed = window.confirm(
      `Mark ${orderNumber} as PAID?\n\n` +
        `${inr(total)} by ${m.label}${ref ? `\nReference: ${ref}` : '\n(no reference)'}\n\n` +
        'This allocates the GST invoice number and moves the order into fulfilment.\n' +
        (sendEmails
          ? `The customer${customerEmail ? ` (${customerEmail})` : ''} and the team will be emailed.\n\n`
          : 'No emails will be sent.\n\n') +
        'Only continue if the money is in our account — check the bank, not a screenshot.',
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await api(`/api/orders/${orderId}/mark-paid-offline`, {
        method: 'POST',
        body: JSON.stringify({ method, reference: ref || null, amount: total, sendEmails }),
      });
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not record the payment');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="card flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50/60 p-4">
        <div className="text-sm text-slate-700">
          <span className="font-medium text-slate-900">Paid outside Razorpay?</span>{' '}
          Bank transfer, UPI to our account, cash or cheque — record it here so the invoice and emails go out.
        </div>
        <button type="button" className="btn-primary text-sm" onClick={() => setOpen(true)}>
          Record payment
        </button>
      </div>
    );
  }

  return (
    <div className="card space-y-4 border-amber-200 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Record a payment received outside Razorpay</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Does everything a Razorpay payment does: payment record, GST invoice number, coupon count, order into
            fulfilment, and the emails below.
          </p>
        </div>
        <button type="button" className="text-sm text-slate-500 hover:text-slate-800" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="label">How it was paid</label>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value as typeof method)} disabled={busy}>
            {METHODS.map((x) => (
              <option key={x.v} value={x.v}>{x.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{m.ref}</label>
          <input
            className="input font-mono"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={m.placeholder}
            disabled={busy}
          />
        </div>
        <div>
          <label className="label">Amount received</label>
          <input className="input bg-slate-50 font-semibold" value={inr(total)} readOnly disabled />
          <p className="mt-1 text-[11px] text-slate-500">Must equal the order total. Different amount? Fix the order first.</p>
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5" checked={sendEmails} onChange={(e) => setSendEmails(e.target.checked)} disabled={busy} />
        <span>
          Email the customer an order confirmation{customerEmail ? ` (${customerEmail})` : ' (no email on this order)'} and alert the team
        </span>
      </label>

      {err && <div className="notice-red">{err}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'Recording…' : `Mark as paid — ${inr(total)}`}
        </button>
        <span className="text-xs text-amber-800">Check the money is actually in the bank before you confirm.</span>
      </div>
    </div>
  );
}
