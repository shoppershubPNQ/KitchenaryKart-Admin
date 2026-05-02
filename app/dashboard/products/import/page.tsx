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
      <p className="text-sm text-slate-500">CSV or XLSX. Required columns: <code className="bg-slate-100 px-1 rounded">sku, name, price</code>. Optional: category, subcategory, mrp, tax_percent, dimensions, power, capacity, weight, stock, hsn_code.</p>

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
