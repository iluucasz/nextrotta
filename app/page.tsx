import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { SUPPORT_HOME } from '@/lib/platform-access';

export default async function Home() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  if (user.role === 'platform_owner') {
    redirect('/plataforma');
  }
  if (user.role === 'platform_support') {
    redirect(SUPPORT_HOME);
  }

  redirect(user.role === 'admin' ? '/admin' : '/dashboard');
}
