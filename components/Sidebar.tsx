'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdminRole } from '@prisma/client';

interface NavLeaf {
  type?: 'leaf';
  href: string;
  label: string;
  icon: string;
  roles?: AdminRole[];
}
interface NavGroup {
  type: 'group';
  label: string;
  icon: string;
  /** Any pathname starting with one of these toggles the group "active". */
  matches: string[];
  children: { href: string; label: string }[];
  roles?: AdminRole[];
}
type NavItem = NavLeaf | NavGroup;

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Overview', icon: '📊' },
  { href: '/dashboard/products', label: 'Products', icon: '📦' },
  { href: '/dashboard/collections', label: 'Collections', icon: '🗂️' },
  { href: '/dashboard/orders', label: 'Orders', icon: '🛒' },
  { href: '/dashboard/customers', label: 'Customers', icon: '👥' },
  { href: '/dashboard/inventory', label: 'Inventory', icon: '📈' },
  { href: '/dashboard/inquiries', label: 'Inquiries', icon: '💬' },
  {
    type: 'group',
    label: 'Banners',
    icon: '🖼️',
    matches: ['/dashboard/banners', '/dashboard/banners-2'],
    children: [
      { href: '/dashboard/banners',   label: 'Banner 1' },
      { href: '/dashboard/banners-2', label: 'Banner 2' },
    ],
  },
  { href: '/dashboard/reels', label: 'Reels', icon: '🎬' },
  { href: '/dashboard/reviews', label: 'Reviews', icon: '⭐' },
  { href: '/dashboard/policies', label: 'Policies', icon: '📄' },
  { href: '/dashboard/social', label: 'Social links', icon: '🔗', roles: ['admin'] },
  { href: '/dashboard/analytics', label: 'Analytics', icon: '📉' },
  { href: '/dashboard/gst-reports', label: 'GST Reports', icon: '📑', roles: ['admin', 'accounts'] },
  { href: '/dashboard/users', label: 'Admin users', icon: '🔐', roles: ['admin'] },
  { href: '/dashboard/settings', label: 'Settings', icon: '⚙️', roles: ['admin'] },
];

function visible(item: NavItem, role: AdminRole): boolean {
  if (!item.roles) return true;
  return item.roles.includes(role);
}

export function Sidebar({ role }: { role: AdminRole }) {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex flex-col w-60 bg-ink text-sand border-r border-slate-800">
      <div className="p-5 border-b border-slate-700 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-brand flex items-center justify-center font-bold text-white">K</div>
        <div>
          <div className="font-semibold text-white text-sm">KitchenaryKart</div>
          <div className="text-[11px] text-sand/70 uppercase tracking-wide">Admin</div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {NAV.filter((n) => visible(n, role)).map((n) =>
          n.type === 'group' ? (
            <NavGroupItem key={n.label} group={n} pathname={pathname} />
          ) : (
            <NavLeafItem key={n.href} item={n} pathname={pathname} />
          ),
        )}
      </nav>

      <div className="p-3 border-t border-slate-700 text-[11px] text-sand/60">
        v1.0 · {process.env.NODE_ENV}
      </div>
    </aside>
  );
}

function NavLeafItem({ item, pathname }: { item: NavLeaf; pathname: string }) {
  const active =
    pathname === item.href ||
    (item.href !== '/dashboard' && pathname.startsWith(item.href));
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
        active ? 'bg-brand text-white' : 'text-sand/90 hover:bg-slate-700/50 hover:text-white'
      }`}
    >
      <span className="text-base">{item.icon}</span>
      <span>{item.label}</span>
    </Link>
  );
}

function NavGroupItem({
  group,
  pathname,
}: {
  group: NavGroup;
  pathname: string;
}) {
  const isInGroup = group.matches.some((m) => pathname.startsWith(m));
  const [open, setOpen] = useState(isInGroup);

  // Auto-open when navigating into the group from elsewhere.
  useEffect(() => {
    if (isInGroup) setOpen(true);
  }, [isInGroup]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
          isInGroup ? 'bg-brand text-white' : 'text-sand/90 hover:bg-slate-700/50 hover:text-white'
        }`}
        aria-expanded={open}
      >
        <span className="text-base">{group.icon}</span>
        <span className="flex-1 text-left">{group.label}</span>
        <svg
          viewBox="0 0 12 12"
          width="10"
          height="10"
          className={`transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 2l4 4-4 4" />
        </svg>
      </button>
      {open && (
        <div className="mt-0.5 ml-7 space-y-0.5 border-l border-slate-700 pl-2">
          {group.children.map((c) => {
            const active = pathname === c.href || pathname.startsWith(c.href + '/');
            return (
              <Link
                key={c.href}
                href={c.href}
                className={`block px-3 py-1.5 rounded-md text-[13px] transition-colors ${
                  active
                    ? 'bg-brand/80 text-white'
                    : 'text-sand/85 hover:bg-slate-700/50 hover:text-white'
                }`}
              >
                {c.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
