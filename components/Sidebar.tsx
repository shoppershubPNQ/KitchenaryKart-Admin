'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdminRole } from '@prisma/client';
import { Icon, IconName } from './Icons';

interface NavLeaf {
  type?: 'leaf';
  href: string;
  label: string;
  icon: IconName;
  roles?: AdminRole[];
}
interface NavGroup {
  type: 'group';
  label: string;
  icon: IconName;
  /** Any pathname starting with one of these toggles the group "active". */
  matches: string[];
  children: { href: string; label: string }[];
  roles?: AdminRole[];
}
type NavItem = NavLeaf | NavGroup;

/** Nav grouped into labelled sections for quicker scanning. */
interface NavSection {
  title?: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    items: [{ href: '/dashboard', label: 'Dashboard', icon: 'overview' }],
  },
  {
    title: 'Catalog',
    items: [
      { href: '/dashboard/products', label: 'Products', icon: 'products' },
      { href: '/dashboard/collections', label: 'Collections', icon: 'collections' },
      { href: '/dashboard/inventory', label: 'Inventory', icon: 'inventory' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { href: '/dashboard/orders', label: 'Orders', icon: 'orders' },
      { href: '/dashboard/abandoned-carts', label: 'Abandoned carts', icon: 'abandoned' },
      { href: '/dashboard/coupons', label: 'Coupons', icon: 'coupons' },
      { href: '/dashboard/customers', label: 'Customers', icon: 'customers' },
      { href: '/dashboard/inquiries', label: 'Inquiries', icon: 'inquiries' },
    ],
  },
  {
    title: 'Content',
    items: [
      {
        type: 'group',
        label: 'Banners',
        icon: 'banners',
        matches: ['/dashboard/banners', '/dashboard/banners-2'],
        children: [
          { href: '/dashboard/banners', label: 'Banner 1' },
          { href: '/dashboard/banners-2', label: 'Banner 2' },
        ],
      },
      { href: '/dashboard/reels', label: 'Reels', icon: 'reels' },
      { href: '/dashboard/spotlight', label: 'Featured Spotlight', icon: 'spotlight' },
      { href: '/dashboard/reviews', label: 'Reviews', icon: 'reviews' },
      { href: '/dashboard/policies', label: 'Policies', icon: 'policies' },
      { href: '/dashboard/social', label: 'Social links', icon: 'social', roles: ['admin'] },
    ],
  },
  {
    title: 'Insights',
    items: [
      { href: '/dashboard/analytics', label: 'Analytics', icon: 'analytics' },
      { href: '/dashboard/gst-reports', label: 'GST Reports', icon: 'gst', roles: ['admin', 'accounts'] },
    ],
  },
  {
    title: 'System',
    items: [
      { href: '/dashboard/users', label: 'Admin users', icon: 'users', roles: ['admin'] },
      { href: '/dashboard/settings', label: 'Settings', icon: 'settings', roles: ['admin'] },
    ],
  },
];

function visible(item: NavItem, role: AdminRole): boolean {
  if (!item.roles) return true;
  return item.roles.includes(role);
}

export function Sidebar({ role }: { role: AdminRole }) {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex flex-col w-64 bg-ink text-sand/90 border-r border-black/30">
      {/* Brand */}
      <div className="px-5 h-16 flex items-center gap-3 border-b border-white/10">
        <div className="w-9 h-9 rounded-lg bg-brand flex items-center justify-center font-bold text-white shadow-sm">
          K
        </div>
        <div className="leading-tight">
          <div className="font-semibold text-white text-sm">KitchenaryKart</div>
          <div className="text-[10px] text-sand/60 uppercase tracking-[0.15em]">Admin Panel</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4 space-y-5">
        {SECTIONS.map((section, i) => {
          const items = section.items.filter((n) => visible(n, role));
          if (items.length === 0) return null;
          return (
            <div key={section.title ?? i} className="space-y-0.5">
              {section.title && (
                <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.13em] text-sand/40">
                  {section.title}
                </div>
              )}
              {items.map((n) =>
                n.type === 'group' ? (
                  <NavGroupItem key={n.label} group={n} pathname={pathname} />
                ) : (
                  <NavLeafItem key={n.href} item={n} pathname={pathname} />
                ),
              )}
            </div>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-white/10 text-[11px] text-sand/50 flex items-center justify-between">
        <span>v1.0</span>
        <span className="uppercase tracking-wide">{process.env.NODE_ENV}</span>
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
      className={`group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
        active
          ? 'bg-brand text-white font-medium shadow-sm'
          : 'text-sand/80 hover:bg-white/5 hover:text-white'
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r bg-gold" />
      )}
      <Icon
        name={item.icon}
        className={`w-[18px] h-[18px] shrink-0 ${active ? 'text-white' : 'text-sand/60 group-hover:text-white'}`}
      />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function NavGroupItem({ group, pathname }: { group: NavGroup; pathname: string }) {
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
        className={`group w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
          isInGroup ? 'text-white font-medium bg-white/5' : 'text-sand/80 hover:bg-white/5 hover:text-white'
        }`}
        aria-expanded={open}
      >
        <Icon
          name={group.icon}
          className={`w-[18px] h-[18px] shrink-0 ${isInGroup ? 'text-white' : 'text-sand/60 group-hover:text-white'}`}
        />
        <span className="flex-1 text-left truncate">{group.label}</span>
        <Icon
          name="chevron"
          className={`w-3.5 h-3.5 text-sand/50 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {open && (
        <div className="mt-0.5 ml-[22px] space-y-0.5 border-l border-white/10 pl-3">
          {group.children.map((c) => {
            const active = pathname === c.href || pathname.startsWith(c.href + '/');
            return (
              <Link
                key={c.href}
                href={c.href}
                className={`block px-3 py-1.5 rounded-md text-[13px] transition-colors ${
                  active ? 'bg-brand text-white font-medium' : 'text-sand/70 hover:bg-white/5 hover:text-white'
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
