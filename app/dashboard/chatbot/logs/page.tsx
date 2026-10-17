'use client';

/**
 * Dashboard -> Chatbot -> Chat logs: every website chat, newest activity
 * first, and one chat's transcript (?session=<id>). Admin only.
 *
 * Text is always rendered as plain React text - never dangerouslySetInnerHTML -
 * because both the customer's and the bot's words are untrusted.
 */
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/fetch';

type Filter = 'all' | 'leads' | 'errors' | 'refusals';

interface SessionListRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  userMessageCount: number;
  costUsd: number;
  leadInquiryId: number | null;
  handoffShown: boolean;
  startPath: string | null;
  lastError: string | null;
  firstMessage: string | null;
}
interface SessionDetail extends SessionListRow {
  ipHash: string | null;
  userAgent: string | null;
  trackingSessionId: string | null;
  orderLookups: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}
interface LogMessage {
  id: number;
  role: 'user' | 'assistant';
  kind: 'customer' | 'tool_call' | 'tool_result' | 'reply' | 'guard';
  replay: boolean;
  text: string | null;
  toolCalls: unknown;
  model: string | null;
  stopReason: string | null;
  costUsd: number;
  createdAt: string;
  /** A customer photo (metadata only; the image comes from the admin-only photo route). */
  photo: { mediaType: string; bytes: number; width: number; height: number; hints: string[] } | null;
}

const PAGE = 50;

/** Admin-only route (withAuth, cookie) - there is no public URL for chat photos. */
const photoUrl = (sessionId: string, messageId: number) =>
  `/api/chatbot/sessions/${encodeURIComponent(sessionId)}/photos/${messageId}`;
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'leads', label: 'With leads' },
  { id: 'errors', label: 'With errors' },
  { id: 'refusals', label: 'Refusals' },
];

function ist(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const errorText = (e: any) => (e?.message === 'Forbidden' ? 'Admins only.' : e?.message || 'Could not load.');

function ChatLogs() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const sessionParam = params.get('session');

  const [filter, setFilter] = useState<Filter>('all');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<SessionListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<{ total: number; sessions: SessionListRow[] }>(`/api/chatbot/sessions?offset=${offset}&limit=${PAGE}&filter=${filter}`)
      .then((d) => {
        if (cancelled) return;
        setRows(d.sessions);
        setTotal(d.total);
      })
      .catch((e) => !cancelled && setError(errorText(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filter, offset]);

  const openSession = useCallback(
    (id: string | null) => {
      const q = new URLSearchParams(params.toString());
      if (id) q.set('session', id);
      else q.delete('session');
      router.replace(`${pathname}${q.toString() ? `?${q}` : ''}`);
    },
    [params, pathname, router],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Chat logs</h1>
          <p className="text-sm text-slate-500 mt-0.5">Website chatbot conversations, newest activity first. Times are IST.</p>
        </div>
        <Link href="/dashboard/chatbot" className="link text-sm mt-1">
          ← Chatbot settings
        </Link>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`tab-pill ${filter === f.id ? 'tab-pill-active' : ''}`}
            onClick={() => {
              setFilter(f.id);
              setOffset(0);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <div className="notice-red">{error}</div>}

      <div className={`grid gap-4 ${sessionParam ? 'xl:grid-cols-[minmax(0,1fr)_460px]' : ''}`}>
        <div className="card overflow-x-auto">
          <table className="table-mini">
            <thead>
              <tr>
                <th>Started</th>
                <th>Last activity</th>
                <th className="text-right">Messages</th>
                <th>Model</th>
                <th className="text-right">Cost ≈ $</th>
                <th>Lead</th>
                <th>Start page</th>
                <th>First message</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="text-center text-slate-400 py-8">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-slate-400 py-8">
                    No chats.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => openSession(s.id)}
                    className={`cursor-pointer hover:bg-slate-50 ${sessionParam === s.id ? 'bg-amber-50' : ''}`}
                  >
                    <td className="whitespace-nowrap">{ist(s.createdAt)}</td>
                    <td className="whitespace-nowrap">{ist(s.updatedAt)}</td>
                    <td className="text-right tabular-nums">{s.userMessageCount}</td>
                    <td className="mono">{s.model.replace(/^claude-/, '')}</td>
                    <td className="text-right tabular-nums">{s.costUsd.toFixed(4)}</td>
                    <td>
                      {s.leadInquiryId ? (
                        <Link href="/dashboard/inquiries" className="link" onClick={(e) => e.stopPropagation()}>
                          Lead #{s.leadInquiryId}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="max-w-[160px] truncate" title={s.startPath ?? ''}>
                      {s.startPath ?? '—'}
                    </td>
                    <td className="max-w-[280px]">
                      <span className="line-clamp-2">{s.firstMessage ?? '—'}</span>
                      {s.lastError && <span className="pill-red ml-1 mt-0.5">error</span>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 text-xs text-slate-500">
            <span>
              {total === 0 ? '0' : `${offset + 1}–${Math.min(offset + PAGE, total)}`} of {total}
            </span>
            <span className="flex gap-2">
              <button className="btn-outline px-3 py-1 text-xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                Prev
              </button>
              <button className="btn-outline px-3 py-1 text-xs" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
                Next
              </button>
            </span>
          </div>
        </div>

        {sessionParam && <Transcript id={sessionParam} onClose={() => openSession(null)} />}
      </div>
    </div>
  );
}

/** "Refused (cyber)", "Error (upstream_busy)", "Not shown (price check)". */
function hiddenLabel(stopReason: string | null): string {
  if (!stopReason) return 'Not sent to the bot again';
  if (stopReason.startsWith('refusal:')) return `Refused (${stopReason.slice(8)})`;
  if (stopReason.startsWith('error:')) return `Error (${stopReason.slice(6)})`;
  if (stopReason === 'guard_rejected') return 'Not shown (price check)';
  return 'Not sent to the bot again';
}

function toolLines(m: LogMessage): string[] {
  const list = Array.isArray(m.toolCalls) ? (m.toolCalls as Array<Record<string, unknown>>) : [];
  if (m.kind === 'tool_call') {
    return list.map((t) => `Tool: ${String(t.name ?? '?')} ${JSON.stringify(t.input ?? {})}`);
  }
  if (list.length) return list.map((t) => `Result: ${String(t.summary ?? '')}`);
  return m.text ? [`Result: ${m.text}`] : [];
}

/** Thumbnail box size for the stored photo's own aspect ratio (no layout jump while it loads). */
function thumbSize(w: number, h: number): { width: number; height: number } | null {
  if (!(w > 0 && h > 0)) return null;
  const s = Math.min(1, 180 / w, 180 / h);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

function Transcript({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<{ session: SessionDetail; messages: LogMessage[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Photos the admin photo route could not serve (e.g. a 404). */
  const [badPhotos, setBadPhotos] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setBadPhotos(new Set());
    api<{ session: SessionDetail; messages: LogMessage[] }>(`/api/chatbot/sessions/${encodeURIComponent(id)}`)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="card p-4 space-y-3 self-start">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs text-slate-500 break-all">
          Chat <span className="font-mono text-slate-700">{id}</span>
        </div>
        <button className="btn-outline px-2 py-1 text-xs" onClick={onClose} aria-label="Close transcript">
          Close
        </button>
      </div>
      {error && <div className="notice-red">{error}</div>}
      {!data && !error && <div className="text-sm text-slate-400">Loading…</div>}
      {data && (
        <>
          <div className="text-xs text-slate-600 space-y-0.5">
            <div>
              Model <span className="font-mono">{data.session.model}</span> · {data.session.userMessageCount} messages · cost ≈ $
              {data.session.costUsd.toFixed(4)}
            </div>
            <div>
              Tokens in {data.session.inputTokens.toLocaleString('en-IN')} · out {data.session.outputTokens.toLocaleString('en-IN')} ·
              cache read {data.session.cacheReadTokens.toLocaleString('en-IN')} · cache write{' '}
              {data.session.cacheWriteTokens.toLocaleString('en-IN')}
            </div>
            <div>
              Lead:{' '}
              {data.session.leadInquiryId ? (
                <Link href="/dashboard/inquiries" className="link">
                  Lead #{data.session.leadInquiryId}
                </Link>
              ) : (
                'none'
              )}{' '}
              · Handoff shown: {data.session.handoffShown ? 'yes' : 'no'} · Order look-ups: {data.session.orderLookups}
            </div>
            <div>Started {ist(data.session.createdAt)} on {data.session.startPath ?? '—'}</div>
            {data.session.userAgent && <div className="truncate" title={data.session.userAgent}>Browser: {data.session.userAgent}</div>}
            {data.session.lastError && <div className="text-red-700 break-words">Last error: {data.session.lastError}</div>}
          </div>

          <div className="space-y-2 border-t border-slate-100 pt-3 max-h-[70vh] overflow-y-auto">
            {data.messages.map((m) => {
              const hidden = !m.replay || m.stopReason === 'guard_rejected';
              const tag = hidden ? (
                <div className="text-[10px] uppercase tracking-wide text-slate-400 mt-0.5">{hiddenLabel(m.stopReason)}</div>
              ) : null;
              if (m.kind === 'customer') {
                const showText = !(m.photo && m.text === '(photo)');
                const size = m.photo ? thumbSize(m.photo.width, m.photo.height) : null;
                return (
                  <div key={m.id} className={`flex flex-col items-end ${!m.replay ? 'opacity-50' : ''}`}>
                    {m.photo && (
                      <div className="flex flex-col items-end mb-1">
                        {badPhotos.has(m.id) ? (
                          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                            Photo unavailable
                          </div>
                        ) : (
                          <a href={photoUrl(id, m.id)} target="_blank" rel="noopener noreferrer" title="Open the customer's photo">
                            <img
                              src={photoUrl(id, m.id)}
                              alt="Customer photo"
                              loading="lazy"
                              {...(size ? { width: size.width, height: size.height } : {})}
                              style={size ? { aspectRatio: `${size.width} / ${size.height}` } : undefined}
                              onError={() => setBadPhotos((s) => new Set(s).add(m.id))}
                              className="max-w-[180px] max-h-[180px] rounded-lg border border-slate-200 bg-slate-50 object-contain"
                            />
                          </a>
                        )}
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Photo {m.photo.width}×{m.photo.height} · {Math.max(1, Math.round(m.photo.bytes / 1024))} KB
                        </div>
                        <div className="text-[10px] text-slate-500 max-w-[260px] text-right break-words">
                          {m.photo.hints.length ? `Photo-search hints: ${m.photo.hints.join(', ')}` : 'No photo-search hints'}
                        </div>
                      </div>
                    )}
                    {showText && (
                      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-slate-200 px-3 py-2 text-sm text-slate-900 whitespace-pre-wrap break-words">
                        {m.text}
                      </div>
                    )}
                    <div className="text-[10px] text-slate-400 mt-0.5">{ist(m.createdAt)}</div>
                    {tag}
                  </div>
                );
              }
              if (m.kind === 'reply') {
                return (
                  <div key={m.id} className={`flex flex-col items-start ${hidden ? 'opacity-50' : ''}`}>
                    <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 whitespace-pre-wrap break-words">
                      {m.text}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {m.model ? `${m.model} · ` : ''}${m.costUsd.toFixed(4)}
                    </div>
                    {tag}
                  </div>
                );
              }
              if (m.kind === 'guard') {
                return (
                  <div key={m.id} className={`text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 ${!m.replay ? 'opacity-50' : ''}`}>
                    Price check asked the bot to rewrite.
                  </div>
                );
              }
              return (
                <div key={m.id} className={`text-[11px] text-slate-500 font-mono break-words ${!m.replay ? 'opacity-50' : ''}`}>
                  {toolLines(m).map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function ChatLogsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-400">Loading…</div>}>
      <ChatLogs />
    </Suspense>
  );
}
