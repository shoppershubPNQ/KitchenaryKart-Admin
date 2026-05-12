'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function BulkImportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ inserted: number; updated: number; failed: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setErr(null);
    setUploading(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/products/bulk-import', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setResult(data);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Bulk import products</h1>
      <p className="text-sm text-slate-500">
        CSV or XLSX. Required columns: <code className="bg-slate-100 px-1 rounded">sku, name, price</code>.
        Optional: category, subcategory, description, mrp, tax_percent, hsn_code, stock, reorder_point,
        dimensions, power, capacity, weight, material, color, status, is_bestseller, is_new_arrival,
        meta_keywords, image_url.
      </p>

      <div className="card p-4 bg-amber-50 border border-amber-200 text-sm space-y-2">
        <div className="font-medium text-slate-900">How import works</div>
        <ul className="list-disc pl-5 space-y-1 text-slate-700">
          <li><strong>Same SKU</strong> as an existing product → that product is <strong>updated</strong> with the new values.</li>
          <li><strong>New SKU</strong> → a new product is <strong>created</strong>.</li>
          <li>Products in the database but <strong>not in the file are left alone</strong> — bulk-import never deletes. Use the UI to delete.</li>
        </ul>
        <div className="flex gap-3 pt-2 flex-wrap">
          <a href="/api/products/template" className="btn-outline text-sm" download>
            📥 Download sample template
          </a>
          <a href="/api/products/export" className="btn-outline text-sm" download>
            📤 Export current catalog (.xlsx)
          </a>
        </div>
      </div>

      <form onSubmit={submit} className="card p-6 space-y-4">
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={e => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm"
          required
        />
        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={!file || uploading}>
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>

      {err && <div className="card p-4 text-sm text-red-600">{err}</div>}
      {result && (
        <div className="card p-4 text-sm space-y-1">
          <div className="font-medium text-slate-900">Import complete</div>
          <div>Inserted: <b>{result.inserted}</b></div>
          <div>Updated: <b>{result.updated}</b></div>
          <div>Failed: <b className="text-red-600">{result.failed}</b></div>
          <div className="text-slate-500">Total rows: {result.total}</div>
        </div>
      )}
    </div>
  );
}
