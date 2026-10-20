'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSessionUser, type SessionUser } from '@/lib/client-auth';

export function useAppSession() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      try {
        const currentUser = await getSessionUser();
        if (!currentUser) {
          router.replace('/login');
          return;
        }

        if (mounted) {
          setUser(currentUser);
        }
      } catch (error) {
        console.error('[app] session error:', error);
        router.replace('/login');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadSession();

    return () => {
      mounted = false;
    };
  }, [router]);

  return { user, loading };
}
