import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/auth';

export default function Home() {
  const user = getServerSession();
  redirect(user ? '/dashboard' : '/login');
}
