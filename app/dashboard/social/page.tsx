'use client';

/**
 * Social Links — admin can paste a URL for each supported platform. Empty
 * values hide the corresponding icon in the storefront footer.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/fetch';

type Links = {
  instagram: string;
  youtube: string;
  twitter: string;
  facebook: string;
  whatsapp: string;
  linkedin: string;
};

const FIELDS: { key: keyof Links; label: string; placeholder: string; help: string }[] = [
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/your-handle', help: 'Profile URL.' },
  { key: 'youtube',   label: 'YouTube',   placeholder: 'https://youtube.com/@your-channel', help: 'Channel URL.' },
  { key: 'twitter',   label: 'Twitter / X', placeholder: 'https://x.com/your-handle', help: 'Profile URL.' },
  { key: 'facebook',  label: 'Facebook',  placeholder: 'https://facebook.com/your-page', help: 'Page URL.' },
  { key: 'whatsapp',  label: 'WhatsApp',  placeholder: 'https://wa.me/919890352455', help: 'Click-to-chat link (use https://wa.me/<number>).' },
  { key: 'linkedin',  label: 'LinkedIn',  placeholder: 'https://linkedin.com/company/your-page', help: 'Company or profile URL.' },
];

const EMPTY: Links = {
  instagram: '', youtube: '', twitter: '', facebook: '', whatsapp: '', linkedin: '',
};

export default function SocialLinksPage() {
  const [form, setForm] = useState<Links>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const d = await api<{ links: Links }>('/api/social');
      setForm({ ...EMPTY, ...d.links });
    } catch (e: any) {
      setErr(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function update<K extends keyof Links>(k: K, v: Links[K]) {
    setForm((p) => ({ ...p, [k]: v }));
    setOk(false);
  }

  async function save() {
    setErr(null);
    setOk(false);
    setSaving(true);
    try {
      // Basic URL sanity-check on non-empty values.
      for (const f of FIELDS) {
        const v = (form[f.key] || '').trim();
        if (v && !/^https?:\/\//i.test(v)) {
          throw new Error(`${f.label} must start with http:// or https://`);
        }
      }
      await api('/api/social', { method: 'PUT', body: JSON.stringify(form) });
      setOk(true);
    } catch (e: any) {
      setErr(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Social links</h1>
        <p className="text-sm text-slate-500">
          Paste the URL for each platform. Empty fields hide the icon in the storefront footer.
        </p>
      </div>

      {loading ? (
        <div className="card p-8 text-center text-slate-400">Loading…</div>
      ) : (
        <div className="card p-6 space-y-5">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="label">{f.label}</label>
              <input
                type="url"
                className="input"
                value={form[f.key]}
                onChange={(e) => update(f.key, e.target.value)}
                placeholder={f.placeholder}
              />
              <p className="text-xs text-slate-500 mt-1">{f.help}</p>
            </div>
          ))}

          {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
          {ok && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">Saved. The storefront footer updates within seconds.</div>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" onClick={load} className="btn-outline" disabled={saving}>
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
