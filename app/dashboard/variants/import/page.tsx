'use client';

/**
 * Bulk variant importer — drop a .csv or .xlsx with one row per variant.
 * Existing products are matched by SKU; unknown SKUs are skipped and
 * reported back in the result summary.
 */
import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/fetch';

interface Result {
  inserted: number;
  failed: number;
  total: number;
  errors?: { row: number; reason: string }[];
}

const TEMPLATE_CSV =
  'sku,variant_type,variant_value,sku_suffix,price_modifier,stock\n' +
  'EXAMPLE-3D9T,Size,Small,-S,0,10\n' +
  'EXAMPLE-3D9T,Size,Medium,-M,500,15\n' +
  'EXAMPLE-3D9T,Size,Large,-L,1000,8\n' +
  'EXAMPLE-3D9T,Color,Red,-RED,0,5\n';

function downloadTemplate() {
  const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'variants-template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function VariantsImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/variants/bulk-import', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Import failed');
      setResult(data);
    } catch (e: any) {
      setError(e?.message || 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <Link href="/dashboard/products" className="text-xs text-slate-500 hover:text-brand">
          ← Back to products
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">Bulk import variants</h1>
        <p className="text-sm text-slate-500">
          Add multiple variants at once for any number of products. The file
          should contain one row per variant.
        </p>
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Expected columns</h3>
          <ul className="text-sm text-slate-700 space-y-1">
            <li><code className="bg-slate-100 px-1 rounded">sku</code> — required, must match an existing product</li>
            <li><code className="bg-slate-100 px-1 rounded">variant_type</code> — required, e.g. <em>Size</em>, <em>Color</em>, <em>Power</em></li>
            <li><code className="bg-slate-100 px-1 rounded">variant_value</code> — required, e.g. <em>Small</em>, <em>Red</em>, <em>1500W</em></li>
            <li><code className="bg-slate-100 px-1 rounded">sku_suffix</code> — optional, appended to the parent SKU</li>
            <li><code className="bg-slate-100 px-1 rounded">price_modifier</code> — optional number; added to base price (negative = discount)</li>
            <li><code className="bg-slate-100 px-1 rounded">stock</code> — optional integer; defaults to 0</li>
          </ul>
          <div className="flex gap-3 flex-wrap mt-3">
            <button
              type="button"
              onClick={downloadTemplate}
              className="text-sm text-brand hover:underline"
            >
              ⬇ Download .csv template
            </button>
            <a
              href="/api/variants/template"
              className="text-sm text-brand hover:underline"
              download
            >
              ⬇ Download .xlsx template (with README)
            </a>
            <a
              href="/api/variants/export"
              className="text-sm text-brand hover:underline"
              download
            >
              📤 Export all current variants
            </a>
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <label className="label">Upload .csv or .xlsx</label>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
            className="block text-sm"
          />
          {file && (
            <div className="text-xs text-slate-500 mt-1">
              {file.name} · {(file.size / 1024).toFixed(1)} KB
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={!file || busy}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Importing…' : 'Import variants'}
          </button>
          {file && (
            <button
              type="button"
              onClick={() => { setFile(null); setResult(null); setError(null); }}
              className="btn-outline"
              disabled={busy}
            >
              Clear
            </button>
          )}
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
        )}

        {result && (
          <div className="bg-slate-50 border border-slate-200 rounded p-4 space-y-2">
            <div className="text-sm">
              <strong className="text-emerald-700">{result.inserted}</strong> created
              {' · '}
              <strong className="text-red-600">{result.failed}</strong> failed
              {' · '}
              <span className="text-slate-500">{result.total} total rows</span>
            </div>
            {result.errors && result.errors.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-slate-700 mt-2 mb-1">First {result.errors.length} errors</div>
                <ul className="text-xs text-slate-600 space-y-0.5 max-h-48 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      <span className="font-mono text-slate-400">row {e.row}:</span> {e.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
