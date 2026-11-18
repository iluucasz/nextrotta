export interface SessionUser {
  userId: string;
  email: string;
  name: string;
  role: 'platform_owner' | 'platform_support' | 'admin' | 'technician';
  technicianId?: string;
  /** Null only for the platform owner. */
  organizationSlug: string | null;
  /** True when an admin is viewing this session through the read-only preview mode. */
  preview?: boolean;
  /** True when the platform owner is acting inside the organization. */
  impersonating?: boolean;
}

/**
 * Every screen asks "who is logged in?" when it opens, and each ask costs a trip to the server plus a
 * database lookup. Moving between screens inside the app reuses the answer for a short while instead.
 * Anything that changes who is logged in (login, logout, preview, leaving an owner session) ends in a
 * full page load, which starts this cache over; every data route re-checks the session on its own, so
 * a stale answer here can only show a screen briefly, never expose data.
 */
const SESSION_CACHE_MS = 30_000;

let cachedSession: { user: SessionUser; at: number } | null = null;
let pendingSession: Promise<SessionUser | null> | null = null;

/** The session answered less than 30 seconds ago, if any. Browser only: the server never keeps one. */
export function peekSessionUser(): SessionUser | null {
  if (typeof window === 'undefined' || !cachedSession) return null;
  return Date.now() - cachedSession.at < SESSION_CACHE_MS ? cachedSession.user : null;
}

export function clearSessionCache() {
  cachedSession = null;
  pendingSession = null;
}

async function fetchSessionUser(): Promise<SessionUser | null> {
  const response = await fetch('/api/auth/me', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return null;
  }

  const data = await response.json();
  return data.user ?? null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const fresh = peekSessionUser();
  if (fresh) return fresh;

  // Two components asking at the same moment share one request.
  if (!pendingSession) {
    pendingSession = fetchSessionUser()
      .then((user) => {
        // Only a confirmed login is remembered: a sign-out or a failure must be asked again.
        cachedSession = user ? { user, at: Date.now() } : null;
        return user;
      })
      .finally(() => {
        pendingSession = null;
      });
  }

  return pendingSession;
}
