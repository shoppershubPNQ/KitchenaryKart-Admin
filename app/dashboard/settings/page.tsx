'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/fetch';

interface Setting { id: number; key: string; value: string; dataType: string | null }

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const d = await api<{ settings: Setting[] }>('/api/settings');
      setSettings(d.settings);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function save(s: Setting) {
    setSaving(s.key);
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ key: s.key, value: s.value, dataType: s.dataType }) });
    } finally { setSaving(null); }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
      <p className="text-sm text-slate-500">Store configuration. Changes save per-row.</p>

      {loading ? (
        <div className="card p-8 text-center text-slate-400">Loading…</div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {settings.map(s => (
            <div key={s.id} className="p-4 flex items-center gap-4">
              <div className="w-48 shrink-0">
                <div className="text-sm font-medium text-slate-900">{s.key}</div>
                <div className="text-xs text-slate-500">{s.dataType || 'string'}</div>
              </div>
              <input
                className="input flex-1"
                value={s.value || ''}
                onChange={e => setSettings(prev => prev.map(x => x.id === s.id ? { ...x, value: e.target.value } : x))}
              />
              <button className="btn-primary" onClick={() => save(s)} disabled={saving === s.key}>
                {saving === s.key ? 'Saving…' : 'Save'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
