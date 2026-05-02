'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, inr, dateShort } from '@/lib/fetch';

interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  companyName: string | null;
  customerType: string;
  creditLimit: number;
  creditUsed: number;
  isActive: boolean;
  signupSource: string;
  createdAt: string;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [source, setSource] = useState('');

  async function load() {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (search) q.set('search', search);
      if (type) q.set('type', type);
      if (source) q.set('source', source);
      const data = await api<{ customers: Customer[] }>('/api/customers?' + q);
      setCustomers(data.customers);
    } finally { setLoading(false); }
  }

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [search, type, source]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Customers</h1>
        <Link href="/dashboard/customers/new" className="btn-primary">+ New customer</Link>
      </div>

      <div className="card p-4 flex flex-wrap gap-3">
        <input className="input max-w-xs" placeholder="Search name / email / company" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input max-w-xs" value={type} onChange={e => setType(e.target.value)}>
          <option value="">All types</option>
          <option value="retail">Retail</option>
          <option value="b2b">B2B</option>
          <option value="corporate">Corporate</option>
        </select>
        <select className="input max-w-xs" value={source} onChange={e => setSource(e.target.value)}>
          <option value="">All sources</option>
          <option value="web">Web signup</option>
          <option value="admin">Admin entry</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th>Name</Th><Th>Company</Th><Th>Type</Th><Th>Source</Th>
              <Th>Email</Th><Th>Phone</Th>
              <Th align="right">Credit used</Th><Th>Joined</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={8} className="p-8 text-center text-slate-400">Loading…</td></tr>}
            {!loading && customers.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-slate-400">No customers yet.</td></tr>}
            {customers.map(c => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-2"><Link href={`/dashboard/customers/${c.id}`} className="font-medium text-slate-900 hover:text-brand">{c.name}</Link></td>
                <td className="px-4 py-2 text-slate-600">{c.companyName || '—'}</td>
                <td className="px-4 py-2"><span className={c.customerType === 'b2b' ? 'pill-blue' : c.customerType === 'corporate' ? 'pill-green' : 'pill-gray'}>{c.customerType}</span></td>
                <td className="px-4 py-2"><span className={c.signupSource === 'web' ? 'pill-blue' : 'pill-gray'}>{c.signupSource === 'web' ? 'Web' : 'Admin'}</span></td>
                <td className="px-4 py-2 text-slate-600">{c.email}</td>
                <td className="px-4 py-2 text-slate-600">{c.phone || '—'}</td>
                <td className="px-4 py-2 text-right">{inr(c.creditUsed)} / {inr(c.creditLimit)}</td>
                <td className="px-4 py-2 text-slate-500">{dateShort(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-4 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-${align}`}>{children}</th>;
}
