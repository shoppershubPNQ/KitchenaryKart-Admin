'use client';

import { useRouter } from 'next/navigation';
import { SessionUser } from '@/lib/auth';

export function Topbar({ user }: { user: SessionUser }) {
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6">
      <div className="text-sm text-slate-500">
        Signed in as <span className="font-medium text-slate-900">{user.name}</span>
        <span className="ml-2 pill pill-gray uppercase text-[10px]">{user.role}</span>
      </div>
      <div className="flex items-center gap-3">
        <a
          href={process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:5500'}
          target="_blank"
          rel="noopener"
          className="text-sm text-slate-600 hover:text-brand"
        >
          View site ↗
        </a>
        <button onClick={logout} className="text-sm text-slate-600 hover:text-red-600">Sign out</button>
      </div>
    </header>
  );
}
