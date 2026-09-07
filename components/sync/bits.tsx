'use client';

import { dateShort } from '@/lib/fetch';

/** The small shared pieces of the Sync page. */

export function timeAgo(value: string | null): string {
  if (!value) return 'never';
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} d ago`;
  return dateShort(value);
}

export function ErrorBar({ message }: { message: string }) {
  return <div className="notice-red">{message}</div>;
}

export function NoteBar({ message }: { message: string }) {
  return <div className="notice-green">{message}</div>;
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** A strip of thumbnails, the first labelled as the cover. */
export function ImageStrip({ label, urls }: { label: string; urls: string[] }) {
  return (
    <div>
      <p className="kicker mb-1">
        {label} · {urls.length}
      </p>
      {urls.length === 0 ? (
        <p className="text-sm text-slate-400">No images</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {urls.slice(0, 12).map((url, index) => (
            <span key={url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" loading="lazy" className="thumb-lg" title={url} />
              {index === 0 && (
                <span className="absolute left-0.5 top-0.5 rounded bg-white/90 px-1 text-[10px] text-slate-600">cover</span>
              )}
            </span>
          ))}
          {urls.length > 12 && <span className="self-center text-xs text-slate-400">+{urls.length - 12} more</span>}
        </div>
      )}
    </div>
  );
}
