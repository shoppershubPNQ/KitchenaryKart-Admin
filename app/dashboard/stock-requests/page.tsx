'use client';

import { useEffect, useState } from 'react';
import { api, dateShort } from '@/lib/fetch';

interface Item {
  sku: string;
  name: string;
  stock: number;
  waiting: number;
  notified: number;
  lastRequestedAt: string;
  emails: string[];
  contacts: { email: string; phone: string }[];
}

/**
 * Back-in-stock demand — what customers asked for while it was sold out.
 * Sorted most-wanted first so it doubles as a restocking priority list.
 */
export default function StockRequestsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [totals, setTotals] = useState({ totalRequests: 0, totalWaiting: 0 });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api<{ items: Item[]; totalRequests: number; totalWaiting: number }>(
          '/api/stock-requests',
        );
        setItems(data.items);
        setTotals({ totalRequests: data.totalRequests, totalWaiting: data.totalWaiting });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-ink">Stock requests</h1>
      <p className="text-sm text-muted mt-1">
        Products customers asked to be notified about when they were sold out. Most-wanted first —
        use it to decide what to restock. Customers are emailed automatically once a SKU is back in
        stock (hourly check).
      </p>

      <div className="flex gap-3 mt-4">
        <div className="rounded-lg border border-line px-4 py-2.5">
          <div className="text-[11px] uppercase tracking-wide text-muted">Products requested</div>
          <div className="text-lg font-bold text-ink">{items.length}</div>
        </div>
        <div className="rounded-lg border border-line px-4 py-2.5">
          <div className="text-[11px] uppercase tracking-wide text-muted">Still waiting</div>
          <div className="text-lg font-bold text-ink">{totals.totalWaiting}</div>
        </div>
        <div className="rounded-lg border border-line px-4 py-2.5">
          <div className="text-[11px] uppercase tracking-wide text-muted">Total requests</div>
          <div className="text-lg font-bold text-ink">{totals.totalRequests}</div>
        </div>
      </div>

      {loading ? (
        <div className="mt-6 text-sm text-muted">Loading…</div>
      ) : items.length === 0 ? (
        <div className="mt-6 rounded-lg border border-line p-6 text-sm text-muted">
          No stock requests yet. They appear here as soon as a customer uses “Notify me when
          available” on a sold-out product.
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-bg-soft">
              <tr className="text-left">
                <th className="px-3 py-2.5 font-semibold">Product</th>
                <th className="px-3 py-2.5 font-semibold">SKU</th>
                <th className="px-3 py-2.5 font-semibold text-right">Waiting</th>
                <th className="px-3 py-2.5 font-semibold text-right">Notified</th>
                <th className="px-3 py-2.5 font-semibold text-right">Stock now</th>
                <th className="px-3 py-2.5 font-semibold">Last asked</th>
                <th className="px-3 py-2.5 font-semibold">Contacts</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.sku} className="border-t border-line align-top">
                  <td className="px-3 py-2.5">{it.name}</td>
                  <td className="px-3 py-2.5 font-mono text-[12.5px]">{it.sku}</td>
                  <td className="px-3 py-2.5 text-right font-bold">{it.waiting}</td>
                  <td className="px-3 py-2.5 text-right text-muted">{it.notified}</td>
                  <td className="px-3 py-2.5 text-right">
                    {it.stock > 0 ? (
                      <span className="text-success font-semibold">{it.stock}</span>
                    ) : (
                      <span className="text-brand font-semibold">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{dateShort(it.lastRequestedAt)}</td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      className="text-brand hover:underline text-[13px]"
                      onClick={() => setOpen(open === it.sku ? null : it.sku)}
                    >
                      {open === it.sku ? 'Hide' : `Show (${it.emails.length})`}
                    </button>
                    {open === it.sku && (
                      <div className="mt-1.5 text-[12.5px] text-ink-soft space-y-1">
                        {/* Numbers first — a call converts a bulk enquiry far
                            better than waiting on an email. */}
                        {it.contacts.length > 0 && (
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {it.contacts.map((c) => (
                              <a
                                key={c.phone + c.email}
                                href={`tel:+91${c.phone}`}
                                className="text-brand font-semibold whitespace-nowrap"
                                title={c.email}
                              >
                                📞 +91 {c.phone}
                              </a>
                            ))}
                          </div>
                        )}
                        <div className="break-all">{it.emails.join(', ')}</div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
