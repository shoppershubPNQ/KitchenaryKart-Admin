import { getServerSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = getServerSession();
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen flex bg-slate-100">
      <Sidebar role={user.role} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar user={user} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
