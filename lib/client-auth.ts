export interface SessionUser {
  userId: string;
  email: string;
  name: string;
  role: 'platform_owner' | 'admin' | 'technician';
  technicianId?: string;
  /** Null only for the platform owner. */
  organizationSlug: string | null;
  /** True when an admin is viewing this session through the read-only preview mode. */
  preview?: boolean;
  /** True when the platform owner is acting inside the organization. */
  impersonating?: boolean;
}

export async function getSessionUser(): Promise<SessionUser | null> {
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