'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/fetch';
import { ErrorBar, ImageStrip } from './bits';

/**
 * Field-by-field, one listing: what is here against what Hotelic Essentials
 * publishes, pulled live. Both galleries are shown in full, because a count
 * of 3 against 3 says nothing about a cover that was replaced.
 */
export default function DiffModal({ sku, onClose }: { sku: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<any>(`/api/sync/diff/${encodeURIComponent(sku)}`)
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [sku]);

  const imagesDiffer = data?.fields?.find((f: any) => f.field === 'images')?.differs === true;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="mt-10 w-full max-w-3xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="font-semibold text-slate-900">Compare — {sku}</h3>
          <button type="button" className="text-slate-400 hover:text-slate-700" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="space-y-4 p-5">
          {err && <ErrorBar message={err} />}
          {!data && !err && <p className="text-center text-slate-400">Loading…</p>}
          {data && (
            <>
              <p className="text-sm text-slate-500">
                {data.exists_here
                  ? `${data.changed_fields} field(s) differ. Importing replaces "Here" with "Hotelic Essentials".`
                  : 'Not in this catalogue yet — importing creates it with these values.'}
              </p>
              <table className="table-mini">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Here</th>
                    <th>Hotelic Essentials</th>
                  </tr>
                </thead>
                <tbody>
                  {data.fields.map((f: any) => (
                    <tr key={f.field} className={f.differs ? 'row-warn' : ''}>
                      <td className="font-medium text-slate-700">
                        {f.label}
                        {f.note && <span className="block text-xs font-normal text-slate-400">{f.note}</span>}
                      </td>
                      <td className="text-slate-500">{f.ours ?? '—'}</td>
                      <td className={f.differs ? 'font-medium text-slate-900' : 'text-slate-500'}>{f.theirs ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className={`rounded-lg border p-3 ${imagesDiffer ? 'border-amber-300' : 'border-slate-200'}`}>
                <p className="mb-2 text-sm font-semibold text-slate-900">
                  Pictures{' '}
                  <span className={imagesDiffer ? 'pill-yellow' : 'pill-green'}>{imagesDiffer ? 'differ' : 'same'}</span>
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ImageStrip label="Here" urls={data.images_here ?? []} />
                  <ImageStrip label="Hotelic Essentials" urls={data.remote?.images ?? []} />
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Importing with “Images” ticked replaces the gallery here with theirs, in their order; the first becomes
                  the cover.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
