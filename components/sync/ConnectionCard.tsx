'use client';

import { useState } from 'react';
import { api } from '@/lib/fetch';

/** The inbound connection: the Hotelic Essentials feed URL and the key it issued. */
export default function ConnectionCard({ conn, onChanged }: { conn: any; onChanged: () => void }) {
  const [baseUrl, setBaseUrl] = useState(conn.base_url ?? '');
  const [apiKey, setApiKey] = useState('');
  const [open, setOpen] = useState(!conn.configured);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await api<any>('/api/sync/connection', {
        method: 'PUT',
        body: JSON.stringify({ baseUrl, apiKey }),
      });
      setTest(res.test);
      setApiKey('');
      onChanged();
    } catch (e: any) {
      setTest({ ok: false, message: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setBusy(true);
    try {
      setTest(
        await api('/api/sync/connection/test', {
          method: 'POST',
          body: JSON.stringify({ baseUrl, apiKey }),
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Hotelic Essentials connection</h2>
          {conn.configured ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <span className="pill-green">Connected</span>
              <span className="font-mono text-xs">{conn.base_url}</span>
              <span className="text-xs text-slate-400">key {conn.api_key_masked}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-500">Paste the sync URL and API key from the Hotelic Essentials admin.</p>
          )}
        </div>
        {conn.configured && (
          <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : 'Change'}
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Sync URL</label>
              <input
                className="input"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.hotelicessentials.com/api/v1/partner/sync"
              />
            </div>
            <div>
              <label className="label">API key</label>
              <input
                className="input"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={conn.configured ? 'Leave blank to keep the current key' : 'he_live_…'}
              />
            </div>
          </div>

          {test && <div className={test.ok ? 'notice-green' : 'notice-red'}>{test.message}</div>}

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={save} disabled={busy || !baseUrl.trim()}>
              {busy ? 'Saving…' : 'Save connection'}
            </button>
            <button type="button" className="btn-outline" disabled={busy || !baseUrl.trim()} onClick={check}>
              Test connection
            </button>
            {conn.configured && (
              <button
                type="button"
                className="text-sm text-red-600 hover:underline"
                onClick={async () => {
                  if (!confirm('Disconnect? Imported products and history are kept.')) return;
                  await api('/api/sync/connection', { method: 'DELETE' });
                  onChanged();
                }}
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
