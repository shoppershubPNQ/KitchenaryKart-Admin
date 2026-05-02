'use client';

import { useEffect, useState } from 'react';
import { api, dateShort } from '@/lib/fetch';

interface User { id: number; name: string; email: string; role: string; phone: string | null; isActive: boolean; lastLogin: string | null; createdAt: string }

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ name: '', email: '', password: '', role: 'staff', phone: '' });
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const d = await api<{ users: User[] }>('/api/admin-users');
      setUsers(d.users);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api('/api/admin-users', { method: 'POST', body: JSON.stringify(draft) });
      setDraft({ name: '', email: '', password: '', role: 'staff', phone: '' });
      setShowForm(false);
      load();
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Admin users</h1>
        <button className="btn-primary" onClick={() => setShowForm(s => !s)}>{showForm ? 'Cancel' : '+ New user'}</button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="card p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="label">Name</label><input className="input" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} required /></div>
            <div><label className="label">Email</label><input type="email" className="input" value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} required /></div>
            <div><label className="label">Password</label><input type="password" className="input" value={draft.password} onChange={e => setDraft({ ...draft, password: e.target.value })} minLength={6} required /></div>
            <div><label className="label">Role</label>
              <select className="input" value={draft.role} onChange={e => setDraft({ ...draft, role: e.target.value })}>
                <option value="admin">Admin</option><option value="sales">Sales</option><option value="staff">Staff</option><option value="accounts">Accounts</option>
              </select>
            </div>
            <div><label className="label">Phone</label><input className="input" value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} /></div>
          </div>
          {err && <div className="text-sm text-red-600">{err}</div>}
          <button className="btn-primary" type="submit">Create user</button>
        </form>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr><th className="px-4 py-2 text-left">Name</th><th className="px-4 py-2 text-left">Email</th><th className="px-4 py-2 text-left">Role</th><th className="px-4 py-2 text-left">Last login</th><th className="px-4 py-2 text-left">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={5} className="p-8 text-center text-slate-400">Loading…</td></tr>}
            {!loading && users.map(u => (
              <tr key={u.id}>
                <td className="px-4 py-2 font-medium">{u.name}</td>
                <td className="px-4 py-2 text-slate-600">{u.email}</td>
                <td className="px-4 py-2"><span className="pill-gray uppercase text-[10px]">{u.role}</span></td>
                <td className="px-4 py-2 text-slate-500">{u.lastLogin ? dateShort(u.lastLogin) : '—'}</td>
                <td className="px-4 py-2"><span className={u.isActive ? 'pill-green' : 'pill-red'}>{u.isActive ? 'active' : 'inactive'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
