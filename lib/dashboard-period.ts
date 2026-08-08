/**
 * Date ranges for the dashboard period filter.
 *
 * Every period also resolves the PRECEDING equivalent range, so the headline
 * card can show growth against a like-for-like window rather than against a
 * fixed "last month" that means nothing when you are looking at a year.
 *
 * Indian financial years (Apr-Mar) are offered alongside calendar years because
 * that is the window the books and the GST returns are kept in.
 *
 * Bounds are [start, end) — end exclusive — and built with local Date
 * constructors to match the rest of the admin's date handling.
 */
export const PERIOD_KEYS = [
  'today',
  'this-month',
  'last-month',
  'last-3-months',
  'this-year',
  'last-year',
  'this-fy',
  'last-fy',
  'all',
] as const;

export type PeriodKey = (typeof PERIOD_KEYS)[number];

export interface ResolvedPeriod {
  key: PeriodKey;
  label: string;
  /** null for "all" — no lower bound. */
  start: Date | null;
  end: Date;
  /** Preceding equivalent window, for the growth comparison. Null when there
   *  is nothing sensible to compare against (all-time). */
  prevStart: Date | null;
  prevEnd: Date | null;
  /** What the growth figure is measured against, e.g. "vs last month". */
  compareLabel: string | null;
}

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: 'Today',
  'this-month': 'This month',
  'last-month': 'Last month',
  'last-3-months': 'Last 3 months',
  'this-year': 'This year',
  'last-year': 'Last year',
  'this-fy': 'This financial year',
  'last-fy': 'Last financial year',
  all: 'All time',
};

export function isPeriodKey(v: unknown): v is PeriodKey {
  return typeof v === 'string' && (PERIOD_KEYS as readonly string[]).includes(v);
}

/** April 1st of the FY that `d` falls in. Jan-Mar belong to the PREVIOUS year's FY. */
function fyStartFor(d: Date): Date {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(y, 3, 1);
}

export function resolvePeriod(key: PeriodKey, now = new Date()): ResolvedPeriod {
  const label = PERIOD_LABELS[key];
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  switch (key) {
    case 'today': {
      const start = startOfToday;
      const prevStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      return { key, label, start, end: now, prevStart, prevEnd: start, compareLabel: 'vs yesterday' };
    }
    case 'this-month': {
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return {
        key, label, start: startOfMonth, end: now,
        prevStart, prevEnd: startOfMonth, compareLabel: 'vs last month',
      };
    }
    case 'last-month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      return { key, label, start, end: startOfMonth, prevStart, prevEnd: start, compareLabel: 'vs the month before' };
    }
    case 'last-3-months': {
      const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      return { key, label, start, end: now, prevStart, prevEnd: start, compareLabel: 'vs the 3 months before' };
    }
    case 'this-year': {
      const prevStart = new Date(now.getFullYear() - 1, 0, 1);
      return { key, label, start: startOfYear, end: now, prevStart, prevEnd: startOfYear, compareLabel: 'vs last year' };
    }
    case 'last-year': {
      const start = new Date(now.getFullYear() - 1, 0, 1);
      const prevStart = new Date(now.getFullYear() - 2, 0, 1);
      return { key, label, start, end: startOfYear, prevStart, prevEnd: start, compareLabel: 'vs the year before' };
    }
    case 'this-fy': {
      const start = fyStartFor(now);
      const prevStart = new Date(start.getFullYear() - 1, 3, 1);
      return { key, label, start, end: now, prevStart, prevEnd: start, compareLabel: 'vs last FY' };
    }
    case 'last-fy': {
      const thisFy = fyStartFor(now);
      const start = new Date(thisFy.getFullYear() - 1, 3, 1);
      const prevStart = new Date(thisFy.getFullYear() - 2, 3, 1);
      return { key, label, start, end: thisFy, prevStart, prevEnd: start, compareLabel: 'vs the FY before' };
    }
    case 'all':
    default:
      return { key: 'all', label: PERIOD_LABELS.all, start: null, end: now, prevStart: null, prevEnd: null, compareLabel: null };
  }
}

/** Human range for the header, e.g. "1 Apr 2026 — 8 Aug 2026". */
export function formatRange(p: ResolvedPeriod): string {
  const f = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  if (!p.start) return 'Everything to date';
  return `${f(p.start)} — ${f(p.end)}`;
}
