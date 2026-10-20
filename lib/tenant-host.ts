/**
 * Resolves which surface a request is for from its Host header: the root domain (marketing site,
 * login, platform owner panel) or an organization's subdomain. Dependency-free so middleware (edge
 * runtime) can use it.
 */

/** Subdomains that can never be an organization slug. Keep in sync with scripts/create-organization.mjs. */
export const RESERVED_SUBDOMAINS = new Set([
  'www', 'app', 'api', 'admin', 'painel', 'plataforma', 'login', 'suporte', 'status', 'blog', 'docs', 'mail', 'nextrotta-alertas',
]);

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export type HostContext = { kind: 'root' } | { kind: 'organization'; slug: string };

/**
 * Root domain including the port in development, e.g. "nextrotta.com.br". The development default is
 * a *.localhost name (browsers resolve those to loopback) rather than plain "localhost": the dev
 * server sees every request as localhost, so redirects to that origin get rewritten as relative
 * paths and would loop on the organization subdomain.
 */
export function getRootDomain(): string {
  const configured = process.env.ROOT_DOMAIN?.trim().toLowerCase();
  if (configured) return configured;
  if (process.env.NODE_ENV !== 'production') return 'nextrotta.localhost:3000';
  throw new Error('ROOT_DOMAIN is not set');
}

export function isValidOrganizationSlug(slug: string) {
  return SLUG_PATTERN.test(slug) && !RESERVED_SUBDOMAINS.has(slug);
}

/** Unknown hosts (e.g. deployment preview URLs) are treated as the root domain. */
export function resolveHost(host: string | null): HostContext {
  const normalized = (host ?? '').trim().toLowerCase();
  const root = getRootDomain();
  const suffix = `.${root}`;

  if (normalized.endsWith(suffix)) {
    const slug = normalized.slice(0, -suffix.length);
    if (isValidOrganizationSlug(slug)) return { kind: 'organization', slug };
  }

  return { kind: 'root' };
}

type RequestLike = { headers: Headers; url: string };

/** Behind a proxy (Vercel) the original scheme arrives in x-forwarded-proto. */
function requestProtocol(request: RequestLike) {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  return forwarded ? `${forwarded}:` : new URL(request.url).protocol;
}

/**
 * Absolute URL on the host the request came in on. Built from the Host header because request.url
 * doesn't carry the subdomain in development.
 */
export function sameHostUrl(path: string, request: RequestLike) {
  return `${requestProtocol(request)}//${request.headers.get('host')}${path}`;
}

/** Absolute URL on the root domain. */
export function rootUrl(path: string, request: RequestLike) {
  return `${requestProtocol(request)}//${getRootDomain()}${path}`;
}

/** Absolute URL on an organization's subdomain. */
export function organizationUrl(slug: string, path: string, request: RequestLike) {
  return `${requestProtocol(request)}//${slug}.${getRootDomain()}${path}`;
}

/**
 * Public address of an organization's system (used inside messages, e.g. WhatsApp links). https in
 * production; http on the local *.localhost development domain. Empty when the domain isn't known.
 */
export function organizationPublicUrl(slug: string) {
  try {
    const root = getRootDomain();
    return `${root.includes('localhost') ? 'http' : 'https'}://${slug}.${root}`;
  } catch {
    return '';
  }
}
