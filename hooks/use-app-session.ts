'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSessionUser, type SessionUser } from '@/lib/client-auth';

const SESSION_RETRIES = 2;
const SESSION_RETRY_DELAY_MS = 1000;

export function useAppSession() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      try {
        // A dropped connection is not a sign-out: retry before sending the person to the login.
        let currentUser: SessionUser | null = null;
        for (let attempt = 0; ; attempt++) {
          try {
            currentUser = await getSessionUser();
            break;
          } catch (error) {
            if (!mounted) return;
            if (attempt >= SESSION_RETRIES) throw error;
            await new Promise((resolve) => setTimeout(resolve, SESSION_RETRY_DELAY_MS));
          }
        }

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
