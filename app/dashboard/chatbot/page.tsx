'use client';

/**
 * Dashboard -> Chatbot: the website chat assistant's Claude API key (masked,
 * never shown again after saving), its settings and approximate usage.
 * Admin only (the API returns 403 to other roles).
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/fetch';
import { MODEL_LABELS, SETTING_LABELS, SETTING_RANGES, type ChatModel, type KeyState, type KeyStatus } from '@/lib/chatbot/models';

interface KeyInfo {
  state: KeyState;
  masked: string | null;
  status: KeyStatus | null;
  setAt: string | null;
  setBy: string | null;
  checkedAt: string | null;
  lastError: string | null;
}
interface Settings {
  enabled: boolean;
  model: ChatModel;
  dailyCap: number;
  sessionCap: number;
  ipLimit: number;
  dailyCostCapUsd: number;
  greeting: string;
}
interface UsageBlock {
  messages: number;
  sessions: number;
  leads: number;
  distinctIps?: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}
interface Status {
  encryptionAvailable: boolean;
  key: KeyInfo;
  settings: Settings;
  models: Array<{ id: ChatModel; label: string; note: string }>;
  limits: {
    maxMessageChars: number;
    maxToolRounds: number;
    ipWindowMinutes: number;
    globalPerMinute: number;
    sessionIdleHours: number;
    maxOrderLookupsPerChat: number;
    maxLeadsPerChat: number;
    visitorIpSigned: boolean;
    maxPhotosPerChat: number;
    maxPhotosPerIpPerHour: number;
    maxPhotosPerDay: number;
    /** False when the last key Test found the model takes no photos. */
    photosEnabled: boolean;
  };
  usage: { today: UsageBlock; last7Days: UsageBlock } | null;
  usageError: string | null;
  /** Database space of the chat log (photos included), or null. */
  chatLogBytes: number | null;
  promptVersion: string;
}

/** Above this the usage card suggests a clean-up of old chat photos. */
const CHAT_LOG_NOTICE_BYTES = 500 * 1024 * 1024;
interface TestResult {
  ok: boolean;
  status: string;
  detail: string;
  /** With ok: whether the model accepts customer photos. */
  photos?: boolean;
}

/** IST date + time for the key timestamps. */
function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function KeyPill({ k }: { k: KeyInfo }) {
  if (k.state === 'unreadable') return <span className="pill-red">Cannot decrypt - re-enter</span>;
  if (k.state === 'none') return <span className="pill-gray">Not set up</span>;
  switch (k.status) {
    case 'ok':
      return <span className="pill-green">Connected</span>;
    case 'invalid':
      return <span className="pill-red">Key rejected</span>;
    case 'billing':
      return <span className="pill-red">Billing problem</span>;
    case 'error':
      return <span className="pill-yellow">Error</span>;
    default:
      return <span className="pill-yellow">Saved, not verified</span>;
  }
}

export default function ChatbotPage() {
  const [data, setData] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setData(await api<Status>('/api/chatbot'));
    } catch (e: any) {
      setLoadError(e?.message === 'Forbidden' ? 'Admins only.' : e?.message || 'Could not load the chatbot settings.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Website chatbot</h1>
          <p className="text-sm text-slate-500 mt-0.5">Claude-powered sales assistant in the website chat bubble.</p>
        </div>
        <Link href="/dashboard/chatbot/logs" className="link text-sm mt-1">
          View chat logs →
        </Link>
      </div>

      {loading && !data && <div className="card p-10 text-center text-slate-400">Loading…</div>}
      {loadError && <div className="notice-red">{loadError}</div>}

      {data && (
        <>
          {!data.encryptionAvailable && (
            <div className="card p-4 border-l-4 border-red-500 bg-red-50 text-sm text-red-900">
              <div className="font-semibold">Cannot store the API key on this deployment</div>
              <p className="mt-1">
                Encryption is not configured on the server, so the API key cannot be saved. Ask the developer to check
                JWT_SECRET on Vercel.
              </p>
            </div>
          )}
          <KeyCard status={data} onChange={setData} />
          <SettingsCard status={data} onSaved={setData} />
          <UsageCard status={data} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- key card

function KeyCard({ status, onChange }: { status: Status; onChange: (s: Status) => void }) {
  const k = status.key;
  const configured = k.state !== 'none';
  // Never prefilled: the saved key is never sent to the browser.
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState<'set' | 'test' | 'clear' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function act(action: 'set' | 'test' | 'clear') {
    setBusy(action);
    setResult(null);
    try {
      const body: Record<string, string> = { action };
      if (action === 'set') body.apiKey = keyInput;
      const r = await api<{ key: KeyInfo; test?: TestResult }>('/api/chatbot/key', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      onChange({
        ...status,
        key: r.key,
        settings: action === 'clear' ? { ...status.settings, enabled: false } : status.settings,
        limits:
          r.test?.ok && typeof r.test.photos === 'boolean' ? { ...status.limits, photosEnabled: r.test.photos } : status.limits,
      });
      if (r.test) setResult({ ok: r.test.ok, detail: r.test.detail });
      else if (action === 'clear') setResult({ ok: true, detail: 'The key was deleted and the chatbot is switched off.' });
    } catch (e: any) {
      setResult({ ok: false, detail: e?.message === 'Forbidden' ? 'Admins only.' : e?.message || 'Request failed' });
    } finally {
      // The pasted key never stays in page state, success or failure.
      if (action === 'set') setKeyInput('');
      setBusy(null);
      setConfirmRemove(false);
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Claude API key</h2>
          <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
            Create a key in the Anthropic Console → API keys. It is stored encrypted and is never shown again - only the
            last 4 characters. A new key is tested before it is saved: if the test fails, the current key stays in use.
            Test makes one tiny API request (a fraction of a cent).
          </p>
        </div>
        <KeyPill k={k} />
      </div>

      {configured && (
        <div className="text-sm space-y-1">
          {k.masked && <div className="font-mono text-slate-800">{k.masked}</div>}
          <div className="text-xs text-slate-500">
            Saved {when(k.setAt)}
            {k.setBy ? ` by ${k.setBy}` : ''}
            {' · '}Last checked {when(k.checkedAt)}
          </div>
          {k.lastError && <div className="text-xs text-red-700">{k.lastError}</div>}
          {k.state === 'unreadable' && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              The saved key cannot be read with this deployment&apos;s encryption key. Paste the key again to replace it.
            </div>
          )}
        </div>
      )}

      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <label className="label" htmlFor="kk-anthropic-key">
            {configured ? 'Replace key' : 'API key'}
          </label>
          <input
            id="kk-anthropic-key"
            className="input font-mono"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            name="kk-anthropic-key"
            placeholder={configured ? 'Paste a new key to replace' : 'sk-ant-...'}
            value={keyInput}
            disabled={!status.encryptionAvailable || busy !== null}
            onChange={(e) => setKeyInput(e.target.value)}
          />
        </div>
        <button
          className="btn-primary"
          disabled={!keyInput.trim() || busy !== null || !status.encryptionAvailable}
          onClick={() => act('set')}
        >
          {busy === 'set' ? 'Saving…' : configured ? 'Replace key' : 'Save key'}
        </button>
        <button className="btn-outline disabled:opacity-40" disabled={!configured || busy !== null} onClick={() => act('test')}>
          {busy === 'test' ? 'Testing…' : 'Test'}
        </button>
        {configured &&
          (confirmRemove ? (
            <>
              <button className="btn-danger" disabled={busy !== null} onClick={() => act('clear')}>
                {busy === 'clear' ? 'Removing…' : 'Confirm remove'}
              </button>
              <button className="btn-outline" disabled={busy !== null} onClick={() => setConfirmRemove(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn-outline text-red-700" disabled={busy !== null} onClick={() => setConfirmRemove(true)}>
              Remove key
            </button>
          ))}
      </div>
      {confirmRemove && <p className="text-xs text-red-700">This deletes the saved key and switches the chatbot off.</p>}

      {result && <div className={result.ok ? 'notice-green' : 'notice-red'}>{result.detail}</div>}
    </div>
  );
}

// ----------------------------------------------------------- settings card

type NumField = 'dailyCap' | 'sessionCap' | 'ipLimit' | 'dailyCostCapUsd';
const NUM_FIELDS: Array<{ key: NumField; id: string; whole: boolean; step?: string; hint?: string }> = [
  { key: 'dailyCap', id: 'kk-chat-daily-cap', whole: true, hint: 'Customer messages per day (IST), whole website.' },
  { key: 'sessionCap', id: 'kk-chat-session-cap', whole: true },
  {
    key: 'ipLimit',
    id: 'kk-chat-ip-limit',
    whole: true,
    hint: 'Per visitor network (home / office / mobile connection). Always on.',
  },
  {
    key: 'dailyCostCapUsd',
    id: 'kk-chat-cost-cap',
    whole: false,
    step: '0.5',
    hint: "The chatbot stops for the day once today's approximate spend reaches this.",
  },
];

/** Owner wording for a number outside its range, or null when fine. */
function numError(key: NumField, v: number): string | null {
  const r = SETTING_RANGES[key];
  const whole = key !== 'dailyCostCapUsd';
  if (!Number.isFinite(v) || v < r.min || v > r.max || (whole && !Number.isInteger(v))) {
    return `${SETTING_LABELS[key]} must be ${whole ? 'a whole number' : 'a number'} between ${r.min} and ${r.max}.`;
  }
  return null;
}

/** Whether the chat bubble is showing on the website right now, and why not. */
function liveState(status: Status): { live: boolean; reason: string | null } {
  const k = status.key;
  if (!status.settings.enabled) return { live: false, reason: 'the chatbot is switched off below' };
  if (k.state === 'none') return { live: false, reason: 'no API key - add one above' };
  if (k.state === 'unreadable') return { live: false, reason: 'the saved key cannot be read - paste it again above' };
  if (k.status === 'invalid') return { live: false, reason: 'the key was rejected - replace it above' };
  if (k.status === 'billing') return { live: false, reason: 'billing problem on the Anthropic account - add credits, then Test above' };
  return { live: true, reason: null };
}

function SettingsCard({ status, onSaved }: { status: Status; onSaved: (s: Status) => void }) {
  const [form, setForm] = useState<Settings>(status.settings);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchResult, setSwitchResult] = useState<{ ok: boolean; detail: string } | null>(null);

  useEffect(() => {
    setForm(status.settings);
  }, [status.settings]);

  const keyOk = status.key.state === 'present' && status.key.status === 'ok';
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm((f) => ({ ...f, [k]: v }));

  // The on/off switch saves on its own (below); Save settings covers the rest.
  const changed: Partial<Settings> = {};
  (Object.keys(form) as Array<keyof Settings>).forEach((k) => {
    if (k !== 'enabled' && form[k] !== status.settings[k]) (changed as Record<string, unknown>)[k] = form[k];
  });
  const dirty = Object.keys(changed).length > 0;
  const errors: Partial<Record<NumField, string>> = {};
  for (const f of NUM_FIELDS) {
    const e = numError(f.key, form[f.key]);
    if (e) errors[f.key] = e;
  }
  const greetingEmpty = !form.greeting.trim();
  const invalid = Object.keys(errors).length > 0 || greetingEmpty;

  // Warn before leaving the page with unsaved settings.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  async function toggle(enabled: boolean) {
    setSwitching(true);
    setSwitchResult(null);
    try {
      const s = await api<Status>('/api/chatbot', { method: 'PUT', body: JSON.stringify({ enabled }) });
      onSaved(s);
      setSwitchResult({ ok: true, detail: enabled ? 'Switched on - the chat bubble shows on the website within a few minutes.' : 'Switched off.' });
    } catch (e: any) {
      setSwitchResult({ ok: false, detail: e?.message === 'Forbidden' ? 'Admins only.' : e?.message || 'Could not switch' });
    } finally {
      setSwitching(false);
    }
  }

  async function save() {
    if (invalid) return;
    setSaving(true);
    setResult(null);
    try {
      const s = await api<Status>('/api/chatbot', { method: 'PUT', body: JSON.stringify(changed) });
      onSaved(s);
      setResult({ ok: true, detail: 'Saved.' });
    } catch (e: any) {
      setResult({ ok: false, detail: e?.message === 'Forbidden' ? 'Admins only.' : e?.message || 'Could not save' });
    } finally {
      setSaving(false);
    }
  }

  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
  const enabled = status.settings.enabled;
  const live = liveState(status);
  const today = status.usage?.today ?? null;
  const capsReached =
    !!today && (today.messages >= status.settings.dailyCap || today.costUsd >= status.settings.dailyCostCapUsd);

  return (
    <div className="card p-5 space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">Settings</h2>

      <div className={live.live ? 'notice-green' : 'notice-amber'}>
        <div className="font-medium">
          Live on website: {live.live ? 'Yes' : 'No'}
          {live.reason ? ` - ${live.reason}` : ''}
        </div>
        {today && (
          <div className="text-xs mt-0.5">
            Today: {today.messages.toLocaleString('en-IN')} of {status.settings.dailyCap.toLocaleString('en-IN')} messages · $
            {today.costUsd.toFixed(2)} of ${status.settings.dailyCostCapUsd.toFixed(2)}
            {capsReached ? ' · Paused until midnight IST (a daily cap is reached)' : ''}
          </div>
        )}
      </div>

      <div>
        <label className="flex items-center gap-3 text-sm text-slate-800 w-fit">
          <span className="relative inline-flex items-center">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={enabled}
              disabled={switching || (!keyOk && !enabled)}
              onChange={(e) => toggle(e.target.checked)}
            />
            <span className="block h-6 w-11 rounded-full bg-slate-300 transition-colors peer-checked:bg-green-600 peer-disabled:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-brand" />
            <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
          </span>
          <span className="font-medium">
            {switching ? 'Saving…' : enabled ? 'Chatbot is ON - visible on the website' : 'Chatbot is OFF'}
          </span>
          {!keyOk && !enabled && <span className="text-xs text-slate-500">Save and test the key first</span>}
        </label>
        <p className="text-[11px] text-slate-400 mt-1">The switch saves straight away.</p>
        {switchResult && <div className={`mt-2 ${switchResult.ok ? 'notice-green' : 'notice-red'}`}>{switchResult.detail}</div>}
      </div>

      <div>
        <label className="label" htmlFor="kk-chat-model">
          Model
        </label>
        <select
          id="kk-chat-model"
          className="input max-w-md"
          value={form.model}
          onChange={(e) => set('model', e.target.value as ChatModel)}
        >
          {status.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
          {status.models.map((m) => (
            <li key={m.id} className={m.id === form.model ? 'text-slate-800' : ''}>
              <b>{MODEL_LABELS[m.id]?.label ?? m.label}:</b> {m.note}
            </li>
          ))}
        </ul>
        {form.model !== status.settings.model && (
          <p className="text-[11px] text-amber-700 mt-1">
            Saving tests the key with the new model first. Chats already open keep their model; new chats use the new one.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {NUM_FIELDS.map((f) => (
          <div key={f.key}>
            <label className="label" htmlFor={f.id}>
              {SETTING_LABELS[f.key]}
            </label>
            <input
              id={f.id}
              className="input"
              type="number"
              step={f.step}
              min={SETTING_RANGES[f.key].min}
              max={SETTING_RANGES[f.key].max}
              aria-invalid={errors[f.key] ? true : undefined}
              aria-describedby={errors[f.key] ? `${f.id}-err` : undefined}
              value={Number.isNaN(form[f.key]) ? '' : form[f.key]}
              onChange={(e) => set(f.key, num(e.target.value))}
            />
            {errors[f.key] ? (
              <p id={`${f.id}-err`} className="text-[11px] text-red-700 mt-1">
                {errors[f.key]}
              </p>
            ) : (
              f.hint && <p className="text-[11px] text-slate-400 mt-1">{f.hint}</p>
            )}
          </div>
        ))}
      </div>

      <div>
        <label className="label" htmlFor="kk-chat-greeting">
          Greeting
        </label>
        <textarea
          id="kk-chat-greeting"
          className="input"
          rows={3}
          maxLength={SETTING_RANGES.greetingMaxChars}
          value={form.greeting}
          onChange={(e) => set('greeting', e.target.value)}
        />
        <div className="flex justify-between text-[11px] mt-1">
          <span className="text-red-700">{greetingEmpty ? 'Greeting cannot be empty.' : ''}</span>
          <span className="text-slate-400">
            {form.greeting.length}/{SETTING_RANGES.greetingMaxChars}
          </span>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Max message length {status.limits.maxMessageChars.toLocaleString('en-IN')} characters · up to{' '}
        {status.limits.maxToolRounds} tool steps per reply · one lead per chat · {status.limits.maxOrderLookupsPerChat} order
        look-ups per chat · chats idle for {status.limits.sessionIdleHours} hours start fresh ·{' '}
        {status.limits.photosEnabled
          ? `customers can send up to ${status.limits.maxPhotosPerChat} photos per chat (${status.limits.maxPhotosPerIpPerHour} per visitor network per hour, ${status.limits.maxPhotosPerDay} per day in all).`
          : 'customer photos are OFF: the last Test found that this model does not accept photos.'}
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn-primary" disabled={!dirty || saving || invalid} onClick={save}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {dirty && !saving && (
          <button className="btn-outline" onClick={() => setForm({ ...status.settings })}>
            Discard changes
          </button>
        )}
        {dirty && !saving && <span className="text-xs text-amber-700">Not saved yet - press Save settings.</span>}
      </div>
      {result && <div className={result.ok ? 'notice-green' : 'notice-red'}>{result.detail}</div>}
    </div>
  );
}

// -------------------------------------------------------------- usage card

function UsageCard({ status }: { status: Status }) {
  const u = status.usage;
  const n = (v: number) => v.toLocaleString('en-IN');
  const rows: Array<[string, (b: UsageBlock) => string]> = [
    ['Customer messages', (b) => n(b.messages)],
    ['Chats', (b) => n(b.sessions)],
    ['Leads saved', (b) => n(b.leads)],
    ['Cost (USD, approx.)', (b) => `$${b.costUsd.toFixed(4)}`],
  ];
  const technical: Array<[string, (b: UsageBlock) => string]> = [
    ['Input tokens', (b) => n(b.inputTokens)],
    ['Output tokens', (b) => n(b.outputTokens)],
    ['Cache read tokens', (b) => n(b.cacheReadTokens)],
    ['Cache write tokens', (b) => n(b.cacheWriteTokens)],
  ];
  const oneNetwork = !!u && u.today.sessions >= 10 && (u.today.distinctIps ?? 0) <= 2;
  const logMb = status.chatLogBytes === null ? null : status.chatLogBytes / (1024 * 1024);

  const table = (list: Array<[string, (b: UsageBlock) => string]>) =>
    u && (
      <div className="overflow-x-auto">
        <table className="table-mini">
          <thead>
            <tr>
              <th />
              <th className="text-right">Today</th>
              <th className="text-right">Last 7 days</th>
            </tr>
          </thead>
          <tbody>
            {list.map(([label, f]) => (
              <tr key={label}>
                <td className="text-slate-600">{label}</td>
                <td className="text-right tabular-nums">{f(u.today)}</td>
                <td className="text-right tabular-nums">{f(u.last7Days)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <div className="card p-5 space-y-3">
      <h2 className="text-lg font-semibold text-slate-900">Usage (approx.)</h2>
      {!u && <div className="notice-muted">{status.usageError || 'No usage yet.'}</div>}
      {u && (
        <>
          {oneNetwork && (
            <div className="notice-amber">
              Today&apos;s chats seem to come from only {u.today.distinctIps ?? 0} network address
              {(u.today.distinctIps ?? 0) === 1 ? '' : 'es'}, so the per-visitor limit may be counting all customers as one.
              Tell the developer (CHATBOT_PROXY_SECRET), and meanwhile raise &quot;{SETTING_LABELS.ipLimit}&quot;.
            </div>
          )}
          {status.chatLogBytes !== null && status.chatLogBytes >= CHAT_LOG_NOTICE_BYTES && (
            <div className="notice-amber">
              The chat log now uses about {Math.round(logMb ?? 0).toLocaleString('en-IN')} MB of database space (customer photos
              are the largest part). Ask the developer about clearing photos from old chats.
            </div>
          )}
          {table(rows)}
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-500 text-xs">Technical details</summary>
            <div className="mt-2 space-y-2">
              {table(technical)}
              <p className="text-[11px] text-slate-400">
                Today: {n(u.today.distinctIps ?? 0)} distinct visitor networks across {n(u.today.sessions)} chats. Visitor IP{' '}
                {status.limits.visitorIpSigned ? 'signed by the website (CHATBOT_PROXY_SECRET set)' : 'taken from proxy headers'}.
                Prompt version {status.promptVersion}.
                {logMb !== null && ` Chat log in the database: ${logMb < 10 ? logMb.toFixed(1) : Math.round(logMb).toLocaleString('en-IN')} MB (photos included).`}
              </p>
            </div>
          </details>
          <p className="text-[11px] text-slate-400">Costs are estimates from published per-token prices.</p>
        </>
      )}
    </div>
  );
}
