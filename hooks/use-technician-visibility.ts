'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createDefaultVisibility,
  normalizeVisibility,
  type HideableTechnicianPage,
  type TechnicianVisibility,
} from '@/lib/technician-visibility';

// Module scope so the shell and the page share one request per page load, and client-side
// navigation between technician screens doesn't refetch. Saving from the admin modal does a full
// reload, which is what picks up new settings.
let cachedVisibility: TechnicianVisibility | null = null;
let pendingVisibility: Promise<TechnicianVisibility> | null = null;

function fetchVisibility() {
  if (!pendingVisibility) {
    pendingVisibility = fetch('/api/technician-visibility')
      .then(async (response) => {
        if (!response.ok) throw new Error(`visibility_fetch_${response.status}`);
        const data = await response.json();
        cachedVisibility = normalizeVisibility(data?.settings);
        return cachedVisibility;
      })
      .catch((error) => {
        console.error('[technician-visibility] load error:', error);
        // Not cached, so the next screen retries. Meanwhile show everything: these settings only
        // declutter the technician's view, and a blank app would be the worse failure.
        pendingVisibility = null;
        return createDefaultVisibility();
      });
  }

  return pendingVisibility;
}

/** Call on logout: the next person to sign in on this tab must not inherit these settings. */
export function resetTechnicianVisibilityCache() {
  cachedVisibility = null;
  pendingVisibility = null;
}

interface UseTechnicianVisibilityOptions {
  /** When set and that page is hidden for this technician, redirects to /dashboard. */
  page?: HideableTechnicianPage;
  /** Skip the request entirely (e.g. admin screens that render the shared shell). */
  enabled?: boolean;
}

export function useTechnicianVisibility({ page, enabled = true }: UseTechnicianVisibilityOptions = {}) {
  const router = useRouter();
  const [visibility, setVisibility] = useState<TechnicianVisibility | null>(cachedVisibility);

  useEffect(() => {
    if (!enabled || visibility) return;

    let mounted = true;
    fetchVisibility().then((value) => {
      if (mounted) setVisibility(value);
    });

    return () => {
      mounted = false;
    };
  }, [enabled, visibility]);

  const blocked = Boolean(page && visibility && !visibility[page].visible);

  useEffect(() => {
    if (blocked) router.replace('/dashboard');
  }, [blocked, router]);

  return {
    visibility: visibility ?? createDefaultVisibility(),
    loading: enabled && !visibility,
    blocked,
  };
}
