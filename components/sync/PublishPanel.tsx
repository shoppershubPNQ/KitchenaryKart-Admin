'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/fetch';
import { ErrorBar, timeAgo } from './bits';

/**
 * The outbound half: the sync URL a partner panel pastes in, and the keys
 * that open /api/sync/*. One key per panel, so a single connection can be
 * cut without disturbing the others.
 */

interface SyncKey {
  id: number;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  last_used_ip: string | null;
  request_count: number;
  active: boolean;
}

export default function PublishPanel() {
  const [keys, setKeys] = useState<SyncKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [issued, setIssued] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const syncBaseUrl = useMemo(() => (origin ? `${origin}/api/sync` : ''), [origin]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setKeys((await api<{ keys: SyncKey[] }>('/api/sync/keys')).keys);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  function copy(value: string, label: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 2000);
    });
  }

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const data = await api<{ key: string }>('/api/sync/keys', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      setIssued(data.key);
      setName('');
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function revoke(key: SyncKey) {
    if (!confirm(`Revoke "${key.name}"?\n\nAny panel using it stops syncing immediately.`)) return;
    try {
      await api(`/api/sync/keys/${key.id}`, { method: 'DELETE' });
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="space-y-5">
      {err && <ErrorBar message={err} />}

      <div className="card space-y-3 p-6">
        <h2 className="font-semibold text-slate-900">Step 1 — the sync URL</h2>
        <p className="text-sm text-slate-500">
          Paste this into the partner panel. It is derived from the domain you are on, so it is already correct for
          this deployment.
        </p>
        <div className="flex items-center gap-2">
          <input className="input font-mono text-sm" readOnly value={syncBaseUrl} />
          <button type="button" className="btn-outline whitespace-nowrap" onClick={() => copy(syncBaseUrl, 'url')}>
            {copied === 'url' ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="text-xs text-slate-400">
          Read-only endpoints: <code>/ping</code>, <code>/manifest</code>, <code>/products</code> and <code>/stock</code>.
          Hotelic Essentials pulls <strong>stock</strong> from <code>/stock</code> and <strong>pictures</strong> from{' '}
          <code>/products</code> — a picture uploaded or replaced here is what its “Pictures differ” view and its
          mirror pull pick up. Names and prices never go back.
        </p>
      </div>

      <div className="card space-y-4 p-6">
        <h2 className="font-semibold text-slate-900">Step 2 — issue an API key</h2>
        <form onSubmit={issue} className="flex flex-col gap-2 sm:flex-row">
          <input
            className="input"
            placeholder="e.g. Hotelic Essentials — production"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
          />
          <button className="btn-primary whitespace-nowrap" type="submit">
            Issue key
          </button>
        </form>

        {issued && (
          <div className="notice-amber p-4">
            <div className="text-sm font-medium">Copy this key now — it cannot be shown again.</div>
            <div className="mt-3 flex items-center gap-2">
              <input className="input bg-white font-mono text-sm" readOnly value={issued} />
              <button type="button" className="btn-outline whitespace-nowrap" onClick={() => copy(issued, 'key')}>
                {copied === 'key' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="font-semibold text-slate-900">Issued keys</h2>
        </div>
        <table className="table-mini">
          <thead>
            <tr>
              <th>Name</th>
              <th>Key</th>
              <th>Pulls</th>
              <th>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && keys.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-400">
                  No keys yet.
                </td>
              </tr>
            )}
            {keys.map((k) => (
              <tr key={k.id} className={k.active ? '' : 'opacity-50'}>
                <td className="font-medium">{k.name}</td>
                <td className="mono text-slate-500">{k.key_prefix}…</td>
                <td>{k.request_count}</td>
                <td className="text-slate-500">{timeAgo(k.last_used_at)}</td>
                <td className="text-right">
                  {k.active && (
                    <button type="button" className="link-danger" onClick={() => revoke(k)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
