'use client';

/**
 * Policy editor — title + multi-line body. The body is plain text with line
 * breaks; storefront wraps each blank-line-separated chunk in a <p>.
 *
 * Live preview on the right shows roughly how the public page will look.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/fetch';

interface Draft {
  slug: string;
  title: string;
  body: string;
  isActive: boolean;
  position: number;
}

export function PolicyEditor({ initial }: { initial: Draft }) {
  const router = useRouter();
  const [form, setForm] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function update<K extends keyof Draft>(k: K, v: Draft[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
    setOk(false);
  }

  async function save() {
    setSaving(true);
    setErr(null);
    setOk(false);
    try {
      await api(`/api/policies/${initial.slug}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: form.title,
          body: form.body,
          isActive: form.isActive,
          position: form.position,
        }),
      });
      setOk(true);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Editor */}
      <div className="card p-5 space-y-4">
        <div>
          <label className="label">Title</label>
          <input
            className="input"
            value={form.title}
            onChange={(e) => update('title', e.target.value)}
          />
        </div>

        <div>
          <label className="label">Body</label>
          <textarea
            className="input font-mono text-[13px] leading-relaxed"
            rows={20}
            placeholder="Write your policy here. Separate paragraphs with a blank line."
            value={form.body}
            onChange={(e) => update('body', e.target.value)}
          />
          <p className="text-xs text-slate-500 mt-1">
            Plain text. Blank lines start a new paragraph. {form.body.length.toLocaleString('en-IN')} characters.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Footer order (lower = first)</label>
            <input
              type="number"
              className="input"
              value={form.position}
              onChange={(e) => update('position', parseInt(e.target.value) || 0)}
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => update('isActive', e.target.checked)}
              />
              <span>Show in footer & on public page</span>
            </label>
          </div>
        </div>

        {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
        {ok && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">Saved.</div>}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="btn-outline"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Preview */}
      <div className="card p-5">
        <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">Preview</div>
        <h2 className="font-bold text-2xl text-slate-900 mb-4">
          {form.title || <em className="text-slate-400">Untitled</em>}
        </h2>
        <div className="prose prose-sm max-w-none">
          {form.body
            .split(/\n{2,}/)
            .filter((p) => p.trim().length > 0)
            .map((p, i) => (
              <p key={i} className="whitespace-pre-line text-slate-700 leading-relaxed">
                {p}
              </p>
            ))}
          {!form.body.trim() && (
            <p className="text-slate-400 italic">No body yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
