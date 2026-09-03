'use client';

import { useEffect, useState } from 'react';
import { api, dateShort } from '@/lib/fetch';

interface Integration {
  provider: 'shiprocket' | 'delhivery';
  configured: boolean;
  unreadable: boolean;
  isActive: boolean;
  fields: Record<string, string>;
  lastVerifiedAt: string | null;
  lastError: string | null;
  webhookUrl: string;
  webhookSecret: string | null;
  tokenExpiresAt: string | null;
}

const LABELS: Record<string, string> = {
  email: 'Login email',
  password: 'Password',
  apiToken: 'API token',
  clientName: 'Client name',
  pickupLocation: 'Pickup location name',
  channelId: 'Channel ID (optional)',
};

/** Which fields each courier needs, in the order they should be entered. */
const FIELDS: Record<string, string[]> = {
  shiprocket: ['email', 'password', 'pickupLocation', 'channelId'],
  delhivery: ['apiToken', 'clientName', 'pickupLocation'],
};

const HELP: Record<string, string> = {
  shiprocket:
    'Your Shiprocket panel login. The pickup location must match one already registered in Shiprocket — the API rejects an unknown name.',
  delhivery:
    'The API token from Delhivery One (Settings → API). Client name is the registered client, and the pickup location must already exist in your Delhivery account.',
};

export default function IntegrationsPage() {
  const [rows, setRows] = useState<Integration[]>([]);
  const [encAvailable, setEncAvailable] = useState(true);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const d = await api<{ integrations: Integration[]; encryptionAvailable: boolean }>(
        '/api/integrations',
      );
      setRows(d.integrations);
      setEncAvailable(d.encryptionAvailable);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Integrations</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Courier accounts used by order processing. Credentials are encrypted before they are stored.
        </p>
      </div>

      {/* Only shows when the deployment has no usable secret at all. Normally
          the key is derived from JWT_SECRET, so there is nothing to set up. */}
      {!encAvailable && (
        <div className="card p-4 border-l-4 border-red-500 bg-red-50 text-sm text-red-900">
          <div className="font-semibold">Cannot encrypt credentials on this deployment</div>
          <p className="mt-1">
            Courier keys are encrypted before they are stored, and the encryption key is derived
            from this app&apos;s <code className="font-mono text-xs">JWT_SECRET</code> — which is
            missing here, or still the development placeholder.
          </p>
          <p className="mt-2 text-[12px]">
            It is set in production, so this normally only appears when running locally. The key
            itself is never written to the database: keeping it beside the data it opens would
            make the encryption pointless.
          </p>
        </div>
      )}

      {loading && <div className="card p-10 text-center text-slate-400">Loading…</div>}

      {!loading && rows.map((row) => (
        <ProviderCard key={row.provider} row={row} onSaved={load} disabled={!encAvailable} />
      ))}
    </div>
  );
}

function ProviderCard({
  row, onSaved, disabled,
}: { row: Integration; onSaved: () => void; disabled: boolean }) {
  const [fields, setFields] = useState<Record<string, string>>(row.fields);
  const [isActive, setIsActive] = useState(row.isActive);
  const [useStaging, setUseStaging] = useState(row.fields.useStaging === 'true');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);

  useEffect(() => {
    setFields(row.fields);
    setIsActive(row.isActive);
    setUseStaging(row.fields.useStaging === 'true');
  }, [row]);

  const name = row.provider === 'shiprocket' ? 'Shiprocket' : 'Delhivery';

  async function save() {
    setBusy(true);
    setResult(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const k of FIELDS[row.provider]) if (fields[k]) payload[k] = fields[k];
      if (row.provider === 'delhivery') payload.useStaging = useStaging;
      await api('/api/integrations', {
        method: 'PUT',
        body: JSON.stringify({ provider: row.provider, isActive, fields: payload }),
      });
      onSaved();
      setResult({ ok: true, detail: 'Saved. Run Test connection to confirm the account works.' });
    } catch (e: any) {
      setResult({ ok: false, detail: e?.message || 'Could not save' });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      const r = await api<{ ok: boolean; detail: string }>('/api/integrations/test', {
        method: 'POST',
        body: JSON.stringify({ provider: row.provider }),
      });
      setResult(r);
      onSaved();
    } catch (e: any) {
      setResult({ ok: false, detail: e?.message || 'Test failed' });
    } finally {
      setTesting(false);
    }
  }

  const connected = !!row.lastVerifiedAt && !row.lastError;

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{name}</h2>
          <p className="text-xs text-slate-500 mt-0.5 max-w-xl">{HELP[row.provider]}</p>
        </div>
        <div className="flex items-center gap-2">
          {row.unreadable ? (
            <span className="pill-red">Cannot decrypt — re-enter</span>
          ) : connected ? (
            <span className="pill-green">Connected</span>
          ) : row.configured ? (
            <span className="pill-yellow">Saved, not verified</span>
          ) : (
            <span className="pill-gray">Not set up</span>
          )}
        </div>
      </div>

      {/* A blob that will not decrypt means the encryption key changed. Saying
          "configured" there would be a lie. */}
      {row.unreadable && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Stored credentials cannot be read with the current INTEGRATION_ENC_KEY. Enter them again
          to re-encrypt with the key this deployment holds.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {FIELDS[row.provider].map((key) => (
          <div key={key} className={key === 'pickupLocation' ? 'md:col-span-2' : ''}>
            <label className="label">{LABELS[key] ?? key}</label>
            <input
              className="input"
              type={key === 'password' || key === 'apiToken' ? 'text' : 'text'}
              value={fields[key] ?? ''}
              disabled={disabled}
              placeholder={key === 'pickupLocation' ? 'Exactly as registered with the courier' : ''}
              onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
            />
            {/* The mask is what the API returns; retyping is only needed to
                change it. Say so, or it looks like the value was lost. */}
            {(key === 'password' || key === 'apiToken') && (fields[key] ?? '').startsWith('••••') && (
              <p className="text-[11px] text-slate-400 mt-1">
                Stored. Leave as is to keep it, or type a new value to replace it.
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={isActive} disabled={disabled}
            onChange={(e) => setIsActive(e.target.checked)} />
          Enabled
        </label>
        {row.provider === 'delhivery' && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={useStaging} disabled={disabled}
              onChange={(e) => setUseStaging(e.target.checked)} />
            Use staging (rehearsal — no real shipments)
          </label>
        )}
        <div className="flex-1" />
        <button onClick={save} disabled={busy || disabled} className="btn-primary text-sm">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={test} disabled={testing || !row.configured} className="btn-outline text-sm">
          {testing ? 'Testing…' : 'Test connection'}
        </button>
      </div>

      {result && (
        <div className={`text-sm rounded px-3 py-2 border ${
          result.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-800'}`}>
          {result.detail}
        </div>
      )}

      {(row.lastVerifiedAt || row.lastError) && !result && (
        <div className="text-xs text-slate-500">
          {row.lastError
            ? <span className="text-red-700">Last attempt failed: {row.lastError}</span>
            : <>Last verified {dateShort(row.lastVerifiedAt)}</>}
        </div>
      )}

      {/* Neither courier signs its payloads, so this shared secret IS the
          authentication on an incoming scan. It is shown once configured so it
          can be pasted into the courier's webhook screen. */}
      {row.configured && row.webhookSecret && (
        <div className="border-t border-slate-100 pt-3 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Status webhook
          </div>
          <p className="text-[11px] text-slate-500">
            Add this in the {name} panel so shipment status flows back automatically.
            {row.provider === 'shiprocket'
              ? ' Send the secret as the x-api-key header.'
              : ' Give Delhivery this URL and ask them to send the secret as the x-webhook-secret header.'}
          </p>
          <div className="grid grid-cols-1 gap-2">
            <CopyRow label="URL" value={row.webhookUrl} />
            <CopyRow label="Secret" value={row.webhookSecret} />
          </div>
        </div>
      )}
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-slate-400 w-12 shrink-0">{label}</span>
      <input readOnly value={value} className="input input-sm flex-1 font-mono text-[11px]" />
      <button
        type="button"
        className="btn-secondary text-xs shrink-0"
        onClick={() => {
          navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
