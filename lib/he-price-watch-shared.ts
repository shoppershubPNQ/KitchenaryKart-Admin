/**
 * The HE price-rise pieces the browser needs too: roles, the page link, the row shape and two formatters.
 * No server imports here, so the Sidebar, the pop-up and the page can share it without pulling in Prisma.
 */
import type { AdminRole } from '@prisma/client';

/** Who gets the pop-up, the page and the Sidebar link. Same as the Sync page, where the HE link lives. */
export const HE_WATCH_ROLES: AdminRole[] = ['admin'];

export const FULL_LIST_HREF = '/dashboard/he-price-watch';

/** One rise as the API sends it (lib/he-price-watch.ts HeIncrease, plus isNew). */
export interface HeRise {
  sku: string;
  listingSku: string;
  productId: number;
  name: string;
  size: string | null;
  category: string;
  ours: number;
  heIncl: number;
  heTax: number;
  target: number;
  diff: number;
  pct: number | null;
  heUpdatedAt: string | null;
  big: boolean;
  /** Not in what this user last marked "Seen". */
  isNew?: boolean;
}

export function istDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return (
    d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) + ' IST'
  );
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
