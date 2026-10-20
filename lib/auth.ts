import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'
import { recordAudit } from './audit'
import { sql } from './db'
import type { User, UserRole } from './types'

// No fallback: a shared default secret would let tokens from one deployment validate in another.
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set')
}

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET)

const COOKIE_NAME = 'auth-token'

export type TokenPayload = {
  userId: string
  email: string
  role: UserRole
  /** Null only for the platform owner, who sits above every organization. */
  organizationId: string | null
  /** Subdomain the token is valid on — middleware rejects it on any other host. */
  organizationSlug: string | null
  /** Set only on tokens minted by the admin preview flow. Such sessions are read-only. */
  preview?: boolean
  /** Which admin opened the preview — kept for auditing/debugging. */
  previewBy?: string
  /**
   * Set when the platform owner is acting inside an organization ("entrar na conta"). userId is
   * then the owner's id and role is `admin`; the token is only honored while that session is open.
   */
  impersonationId?: string
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword)
}

export async function createToken(payload: TokenPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET)
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as TokenPayload
  } catch {
    return null
  }
}

export async function setAuthCookie(token: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  })
}

export async function removeAuthCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}

export async function getAuthToken(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(COOKIE_NAME)?.value || null
}

type SessionRow = {
  id: string
  email: string
  name: string
  role: UserRole
  organization_id: string | null
  organization_slug: string | null
  technician_id: string | null
}

/**
 * Re-checks a token against the database: the user must still exist and be active, still belong to
 * the organization the token was minted for, and that organization must be past provisioning.
 * Technicians additionally need an active technician record.
 */
/** The owner inside an organization: valid only while the impersonation session is open and unexpired. */
async function loadImpersonatedSession(payload: TokenPayload): Promise<SessionRow | null> {
  const rows = await sql`
    SELECT u.id, u.email, u.name, i.organization_id, o.slug AS organization_slug
    FROM impersonation_sessions i
    JOIN users u ON u.id = i.owner_id
    JOIN organizations o ON o.id = i.organization_id
    WHERE i.id = ${payload.impersonationId}
      AND i.owner_id = ${payload.userId}
      AND i.organization_id = ${payload.organizationId}
      AND i.ended_at IS NULL
      AND (i.expires_at IS NULL OR i.expires_at > NOW())
      AND u.role = 'platform_owner'
      AND u.status = 'active'
      AND u.deleted_at IS NULL
      AND o.deleted_at IS NULL
    LIMIT 1
  `

  const row = rows[0]
  if (!row) return null

  return {
    id: row.id,
    email: row.email,
    name: `${row.name} (dono da plataforma)`,
    role: 'admin',
    organization_id: row.organization_id,
    organization_slug: row.organization_slug,
    technician_id: null,
  }
}

async function loadSessionUser(payload: TokenPayload): Promise<SessionRow | null> {
  if (payload.impersonationId) return loadImpersonatedSession(payload)

  const rows = await sql`
    SELECT
      u.id,
      u.email,
      CASE
        WHEN u.role = 'technician' THEN COALESCE(NULLIF(t.name, ''), u.name)
        ELSE u.name
      END AS name,
      u.role,
      u.organization_id,
      o.slug AS organization_slug,
      o.status AS organization_status,
      t.id AS technician_id,
      t.status AS technician_status
    FROM users u
    LEFT JOIN organizations o ON o.id = u.organization_id AND o.deleted_at IS NULL
    LEFT JOIN technicians t ON t.user_id = u.id AND t.deleted_at IS NULL
    WHERE u.id = ${payload.userId}
      AND u.deleted_at IS NULL
      AND u.status = 'active'
    LIMIT 1
  `

  const row = rows[0]
  if (!row) return null
  if (row.role !== payload.role) return null
  if ((row.organization_id ?? null) !== (payload.organizationId ?? null)) return null

  if (row.role !== 'platform_owner') {
    if (!row.organization_slug || row.organization_status === 'provisioning') return null
  }

  if (row.role === 'technician' && (!row.technician_id || row.technician_status !== 'active')) {
    return null
  }

  return row as SessionRow
}

export async function getCurrentUser(): Promise<User | null> {
  const token = await getAuthToken()
  if (!token) return null

  const payload = await verifyToken(token)
  if (!payload) return null

  try {
    const row = await loadSessionUser(payload)
    if (!row) return null

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      technician_id: row.technician_id ?? undefined,
      organization_id: row.organization_id,
      organization_slug: row.organization_slug,
    }
  } catch {
    return null
  }
}

export async function requireAuth(): Promise<User> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error('Unauthorized')
  }
  return user
}

export async function requireAdmin(): Promise<User> {
  const user = await requireAuth()
  if (user.role !== 'admin') {
    throw new Error('Forbidden')
  }
  return user
}

export async function requirePlatformOwner(): Promise<User> {
  const user = await requireAuth()
  if (user.role !== 'platform_owner') {
    throw new Error('Forbidden')
  }
  return user
}

/** Reads the preview flag straight off the token, so callers don't have to re-parse the cookie. */
export async function getPreviewContext(): Promise<{ preview: boolean; previewBy?: string; impersonating: boolean }> {
  const token = await getAuthToken()
  const payload = token ? await verifyToken(token) : null

  return {
    preview: payload?.preview === true,
    previewBy: payload?.previewBy,
    impersonating: Boolean(payload?.impersonationId),
  }
}

export type OrganizationAuth = TokenPayload & {
  organizationId: string
  organizationSlug: string
  technicianId?: string
}

/**
 * verifyAuth for routes that act on an organization's data: the session must belong to one
 * (never the platform owner's). Every query in such a route filters by `organizationId`.
 */
export async function verifyOrganizationAuth(request: Request): Promise<OrganizationAuth | null> {
  const auth = await verifyAuth(request)
  if (!auth || !auth.organizationId || !auth.organizationSlug) return null
  return auth as OrganizationAuth
}

/** Routes of the platform owner panel (/api/platform/*). */
export async function verifyPlatformOwner(request: Request): Promise<TokenPayload | null> {
  const auth = await verifyAuth(request)
  return auth?.role === 'platform_owner' && !auth.impersonationId ? auth : null
}

export async function verifyAuth(
  request: Request,
): Promise<(TokenPayload & { technicianId?: string }) | null> {
  const token = request.headers.get('cookie')?.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))?.[1]
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null

  try {
    const row = await loadSessionUser(payload)
    if (!row) return null

    // Every change the owner makes inside an organization lands in its audit trail. Recorded here
    // because every organization route authenticates through this function.
    if (payload.impersonationId && request.method !== 'GET' && request.method !== 'HEAD') {
      await recordAudit({
        organizationId: payload.organizationId,
        actorId: payload.userId,
        actorRole: 'platform_owner',
        impersonationId: payload.impersonationId,
        action: 'impersonation.request',
        details: { method: request.method, path: new URL(request.url).pathname },
      })
    }

    return row.technician_id && payload.role === 'technician'
      ? { ...payload, technicianId: row.technician_id }
      : payload
  } catch {
    return null
  }
}
