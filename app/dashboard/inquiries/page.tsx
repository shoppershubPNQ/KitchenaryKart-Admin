'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, dateShort } from '@/lib/fetch';

interface InquiryItem { sku: string; quantity: number }
interface Inquiry {
  id: number;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  companyName: string | null;
  items: InquiryItem[] | null;
  message: string | null;
  status: 'new' | 'contacted' | 'quoted' | 'converted' | 'rejected';
  quotedAmount: number | null;
  createdAt: string;
}

function InquiriesList() {
  const params = useSearchParams();
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(params.get('status') || '');

  async function load() {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (status) q.set('status', status);
      const data = await api<{ inquiries: Inquiry[] }>('/api/inquiries?' + q);
      setInquiries(data.inquiries);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  async function setInquiryStatus(id: number, s: string) {
    await api(`/api/inquiries/${id}`, { method: 'PATCH', body: JSON.stringify({ status: s }) });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Inquiries</h1>
        <select className="input max-w-xs" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="quoted">Quoted</option>
          <option value="converted">Converted</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="space-y-3">
        {loading && <div className="card p-8 text-center text-slate-400">Loading…</div>}
        {!loading && inquiries.length === 0 && <div className="card p-8 text-center text-slate-400">No inquiries.</div>}
        {inquiries.map(i => (
          <div key={i.id} className="card p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold">{i.customerName || 'Anonymous'}{i.companyName && <span className="text-slate-500 font-normal"> · {i.companyName}</span>}</div>
                <div className="text-sm text-slate-500">{i.customerEmail} {i.customerPhone && `· ${i.customerPhone}`}</div>
                <div className="text-xs text-slate-400 mt-0.5">{dateShort(i.createdAt)}</div>
              </div>
              <select className="input max-w-[180px]" value={i.status} onChange={e => setInquiryStatus(i.id, e.target.value)}>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="quoted">Quoted</option>
                <option value="converted">Converted</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>

            {i.items && i.items.length > 0 && (
              <div className="mt-3">
                <div className="text-xs uppercase font-medium text-slate-500">Items</div>
                <ul className="mt-1 text-sm space-y-0.5">
                  {i.items.map((it, idx) => (
                    <li key={idx} className="font-mono text-xs">{it.sku} × {it.quantity}</li>
                  ))}
                </ul>
              </div>
            )}

            {i.message && (
              <div className="mt-3">
                <div className="text-xs uppercase font-medium text-slate-500">Message</div>
                <div className="mt-1 text-sm whitespace-pre-line">{i.message}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function InquiriesPage() {
  return <Suspense fallback={<div className="p-6 text-slate-400">Loading…</div>}><InquiriesList /></Suspense>;
}
