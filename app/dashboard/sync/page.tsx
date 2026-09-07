'use client';

/**
 * Sync — both halves of the KitchenaryKart ↔ Hotelic Essentials link.
 *
 *   Publish  what we expose over /api/sync/* and the keys that open it.
 *   Import   what the partner exposes, reviewed here before anything is written.
 *
 * Listings imported from the partner are withheld from our own feed, so a
 * product cannot bounce between the two panels forever. Each panel lives in
 * components/sync/; this page only lays out the tabs.
 */

import { useState } from 'react';
import ImportPanel from '@/components/sync/ImportPanel';
import PublishPanel from '@/components/sync/PublishPanel';

type Tab = 'publish' | 'import';

const TABS: [Tab, string][] = [
  ['publish', 'Publish to partners'],
  ['import', 'Import from Hotelic Essentials'],
];

export default function SyncPage() {
  const [tab, setTab] = useState<Tab>('publish');

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Sync</h1>
        <p className="mt-1 text-sm text-slate-500">
          Share the catalogue with Hotelic Essentials in both directions. Matching is always by SKU, so a product
          already in either system is recognised instead of duplicated.
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`tab-line ${tab === key ? 'tab-line-active' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'publish' ? <PublishPanel /> : <ImportPanel />}
    </div>
  );
}
