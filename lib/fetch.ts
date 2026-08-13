export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export function inr(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/**
 * Rupees WITH paise. Use wherever the parts have to visibly add up —
 * `inr()` drops the paise, so a ₹66 variant at 5% renders as "₹62 + ₹3",
 * which reads as a missing rupee even though the arithmetic is right.
 * Keep `inr()` for headline figures where whole rupees are easier to scan.
 */
export function inrExact(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '—';
  return (
    '₹' +
    Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

export function dateShort(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
