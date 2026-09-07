'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, inr } from '@/lib/fetch';
import { ErrorBar, NoteBar } from './bits';

/**
 * The re-pricing rule, with a worked example under it.
 *
 * The percentage and the GST handling used to be constants in the source. They
 * are settings now — a trade markup is a commercial decision, not a deployment
 * — and the preview is here because a signed percentage plus a tax step is easy
 * to get backwards. Seeing ₹1,000 become a real number beats any label text.
 */
export default function PricingCard() {
  const [rule, setRule] = useState<{ percent: number; gstMode: string } | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [percent, setPercent] = useState('');
  const [gstMode, setGstMode] = useState('none');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<any>('/api/sync/pricing');
      setRule(d.rule);
      setPreview(d.preview);
      setPercent(String(d.rule.percent));
      setGstMode(d.rule.gstMode);
      setDirty(false);
    } catch (e: any) {
      setErr(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const numeric = Number(percent);
  const valid = Number.isFinite(numeric) && numeric >= -95 && numeric <= 500;

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const d = await api<any>('/api/sync/pricing', {
        method: 'PUT',
        body: JSON.stringify({ percent: numeric, gstMode }),
      });
      setRule(d.rule);
      setPreview(d.preview);
      setNote(d.message);
      setDirty(false);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!rule) return null;

  return (
    <div className="card space-y-4 p-6">
      <div>
        <h2 className="font-semibold text-slate-900">Import pricing</h2>
        <p className="mt-1 text-sm text-slate-500">
          Applied to every price and MRP that comes in, including variants. The Compare view shows the result before
          anything is written.
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Hotelic Essentials publishes its prices <strong>with GST already included</strong>. For &ldquo;their price
          plus 30%&rdquo; set <strong>+30</strong> and <strong>Leave tax alone</strong> — &ldquo;Add GST&rdquo; on top
          would charge the tax twice.
        </p>
      </div>

      {err && <ErrorBar message={err} />}
      {note && <NoteBar message={note} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Price adjustment</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.5"
              className="input"
              value={percent}
              onChange={(e) => {
                setPercent(e.target.value);
                setDirty(true);
              }}
            />
            <span className="text-sm text-slate-500">%</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Positive adds money, negative takes it off. +30 means you sell 30% above their price.
          </p>
        </div>

        <div>
          <label className="label">GST handling</label>
          <select
            className="input"
            value={gstMode}
            onChange={(e) => {
              setGstMode(e.target.value);
              setDirty(true);
            }}
          >
            <option value="none">Leave tax alone — their price already includes GST (Hotelic Essentials)</option>
            <option value="add">Add GST — only for a partner whose prices exclude it</option>
            <option value="remove">Remove GST — their price includes it, ours should not</option>
          </select>
          <p className="mt-1 text-xs text-slate-400">Uses each listing&apos;s own rate — 18%, 5%, or 0% for zero-rated goods.</p>
        </div>
      </div>

      {preview && (
        <div className="notice-muted">
          <p className="kicker">Worked example</p>
          <p className="mt-1 text-sm text-slate-800">
            A listing at <span className="font-semibold">{inr(preview.sample)}</span> with {preview.tax_percent}% GST is
            stored as <span className="font-semibold text-brand">{inr(preview.result)}</span>.
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{preview.note}</p>
          {dirty && <p className="mt-1.5 text-xs font-medium text-amber-700">Unsaved — the example still shows the saved rule.</p>}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="button" className="btn-primary" onClick={save} disabled={busy || !valid || !dirty}>
          {busy ? 'Saving…' : 'Save pricing rule'}
        </button>
        {!valid && <span className="text-xs text-red-600">Enter a percentage between −95 and 500.</span>}
      </div>
    </div>
  );
}
