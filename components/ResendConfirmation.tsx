'use client';
/**
 * "Resend confirmation email" — sends the paid order's confirmation again, to the
 * customer email currently on the order (e.g. after it was corrected post-payment).
 */
import { useState } from 'react';
import { api } from '@/lib/fetch';

export function ResendConfirmation({ orderId, customerEmail }: { orderId: number; customerEmail: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send() {
    if (!window.confirm(`Send the order confirmation email to ${customerEmail}?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ sentTo: string }>(`/api/orders/${orderId}/resend-confirmation`, { method: 'POST' });
      setMsg(`Sent to ${r.sentTo}`);
    } catch (e) {
      setMsg((e as Error).message || 'Could not send');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <button type="button" className="btn-outline text-xs" onClick={send} disabled={busy}>
        {busy ? 'Sending…' : 'Resend confirmation email'}
      </button>
      {msg && <div className="text-[11px] text-slate-500 mt-1">{msg}</div>}
    </div>
  );
}
