'use client';

/**
 * Sync — the outbound side of the KitchenaryKart ↔ Hotelic Essentials link.
 *
 * KitchenaryKart is the SOURCE: this catalogue is published read-only over
 * /api/sync/*, and the partner panel pulls from it. Nothing is pushed and
 * nothing here can be written by a partner, so this page is entirely about
 * the connection: the URL to hand over, and the keys that open it.
 */

import { useEffect, useMemo, useState } from 'react';
import { api, dateShort } from '@/lib/fetch';

interface SyncKey {
  id: number;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  last_used_ip: string | null;
  request_count: number;
  revoked_at: string | null;
  active: boolean;
  created_at: string;
  created_by: string | null;
}

function timeAgo(value: string | null): string {
  if (!value) return 'never';
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} d ago`;
  return dateShort(value);
}

export default function SyncPage() {
  const [keys, setKeys] = useState<SyncKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // The origin the partner must point at. Read from the browser so it is always
  // the real deployed domain — nothing to keep in sync with an env file.
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const syncBaseUrl = useMemo(() => (origin ? `${origin}/api/sync` : ''), [origin]);

  async function load() {
    setLoading(true);
    try {
      const data = await api<{ keys: SyncKey[] }>('/api/sync/keys');
      setKeys(data.keys);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setIssued(null);
    setIssuing(true);
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
    } finally {
      setIssuing(false);
    }
  }

  async function revoke(key: SyncKey) {
    if (
      !confirm(
        `Revoke "${key.name}"?\n\nAny panel using this key stops syncing immediately. This cannot be undone — you would have to issue a new key and paste it into the partner panel.`,
      )
    ) {
      return;
    }
    setErr(null);
    try {
      await api(`/api/sync/keys/${key.id}`, { method: 'DELETE' });
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  function copy(value: string, label: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 2000);
    });
  }

  const activeKeys = keys.filter((k) => k.active);
  const totalPulls = keys.reduce((sum, k) => sum + k.request_count, 0);
  const lastPull = keys
    .map((k) => k.last_used_at)
    .filter((v): v is string => !!v)
    .sort()
    .pop();

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Sync</h1>
        <p className="mt-1 text-sm text-slate-500">
          Publish this catalogue to a partner admin panel. KitchenaryKart is the source — the
          partner pulls listings from here and chooses what to import. Nothing in this panel is
          changed by a sync.
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {/* ------------------------------------------------------- status */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">Connected panels</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{activeKeys.length}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">Total pulls</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{totalPulls}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">Last pull</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{timeAgo(lastPull ?? null)}</div>
        </div>
      </div>

      {/* ---------------------------------------------------- the URL */}
      <div className="card p-6 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-900">Step 1 — the sync URL</h2>
          <p className="mt-1 text-sm text-slate-500">
            Paste this into the partner panel&apos;s Sync settings. It is derived from the domain
            you are on right now, so it is already the correct one for this deployment.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input className="input font-mono text-sm" readOnly value={syncBaseUrl} />
          <button
            type="button"
            className="btn-outline whitespace-nowrap"
            onClick={() => copy(syncBaseUrl, 'url')}
            disabled={!syncBaseUrl}
          >
            {copied === 'url' ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="text-xs text-slate-400">
          Read-only endpoints: <code>/ping</code>, <code>/manifest</code>, <code>/products</code>.
        </p>
      </div>

      {/* ------------------------------------------------- issue a key */}
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-slate-900">Step 2 — issue an API key</h2>
          <p className="mt-1 text-sm text-slate-500">
            One key per partner panel, so you can revoke a single connection without disturbing the
            others.
          </p>
        </div>

        <form onSubmit={issue} className="flex flex-col gap-2 sm:flex-row">
          <input
            className="input"
            placeholder="e.g. Hotelic Essentials — production"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
          />
          <button className="btn-primary whitespace-nowrap" type="submit" disabled={issuing}>
            {issuing ? 'Issuing…' : 'Issue key'}
          </button>
        </form>

        {issued && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <div className="text-sm font-medium text-amber-900">
              Copy this key now — it cannot be shown again.
            </div>
            <p className="mt-1 text-xs text-amber-800">
              Only a hash is stored here. If you lose it, revoke the key and issue a new one.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <input className="input bg-white font-mono text-sm" readOnly value={issued} />
              <button
                type="button"
                className="btn-outline whitespace-nowrap"
                onClick={() => copy(issued, 'key')}
              >
                {copied === 'key' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <button
              type="button"
              className="mt-3 text-xs text-amber-900 underline"
              onClick={() => setIssued(null)}
            >
              I&apos;ve saved it — hide
            </button>
          </div>
        )}
      </div>

      {/* --------------------------------------------------- key list */}
      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="font-semibold text-slate-900">Issued keys</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Key</th>
                <th className="px-4 py-2 text-left">Pulls</th>
                <th className="px-4 py-2 text-left">Last used</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && keys.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    No keys yet. Issue one above to connect a partner panel.
                  </td>
                </tr>
              )}
              {!loading &&
                keys.map((key) => (
                  <tr key={key.id} className={key.active ? '' : 'opacity-50'}>
                    <td className="px-4 py-2 font-medium">{key.name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">
                      {key.key_prefix}…
                    </td>
                    <td className="px-4 py-2 text-slate-600">{key.request_count}</td>
                    <td className="px-4 py-2 text-slate-500">
                      {timeAgo(key.last_used_at)}
                      {key.last_used_ip && (
                        <span className="ml-1 text-xs text-slate-400">({key.last_used_ip})</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className={key.active ? 'pill-green' : 'pill-red'}>
                        {key.active ? 'active' : 'revoked'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {key.active && (
                        <button
                          type="button"
                          className="text-xs text-red-600 hover:underline"
                          onClick={() => revoke(key)}
                        >
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
    </div>
  );
}
