import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';

export default async function Home() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  if (user.role === 'platform_owner') {
    redirect('/plataforma');
  }

  redirect(user.role === 'admin' ? '/admin' : '/dashboard');
}
