import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { getAccessBySlug, type OrganizationAccess } from '@/lib/organization-access';
import { isValidOrganizationSlug, organizationUrl, resolveHost, rootUrl, sameHostUrl } from '@/lib/tenant-host';

// No fallback: a shared default secret would let tokens from one deployment validate in another.
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set');
}

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

const COOKIE_NAME = 'auth-token';

/**
 * Set on the root domain at login (organization users only): which organization the person last
 * signed in to. Just the subdomain — no token — so the root login page can send them back there
 * instead of asking for the password again while their session on the subdomain is still valid.
 */
const LAST_ORGANIZATION_COOKIE = 'last-organization';
/** ?sair=1 (signed out) or ?sessao=expirada (session gone): show the login form, no redirect. */
const LOGIN_STAY_PARAMS = ['sair', 'sessao'];

const publicRoutes = ['/login', '/api/auth/login', '/api/auth/logout', '/api/auth/register', '/api/auth/me', '/api/auth/handoff'];

/**
 * Called by third parties, authenticated by their own shared token instead of a session. The
 * Mercado Pago OAuth return lands on the root domain without the subdomain's session: its single-use
 * state says who started it.
 */
const webhookRoutes = ['/api/webhooks/asaas', '/api/webhooks/mercadopago', '/api/mercadopago/oauth/callback'];

/** Endpoints the public marketing site calls (plans, contact forms). */
const PUBLIC_API_PREFIX = '/api/public/';
const adminRoutes = ['/admin'];
const technicianRoutes = ['/dashboard'];
const hiddenTechnicianRoutes = ['/dashboard/services'];
const platformRoutes = ['/plataforma'];

/**
 * Public marketing site on the root domain. Its pages live under app/site/ and are served at these
 * addresses through a rewrite — `/` on an organization subdomain is the organization's own system,
 * so the two can't share app/page.tsx.
 */
const SITE_DIRECTORY = '/site';
const marketingRoutes = ['/', '/planos', '/contato', '/contratar', '/sob-medida', '/termos', '/privacidade'];
const marketingPrefixes = ['/novidades'];

function isMarketingPath(path: string) {
  return marketingRoutes.includes(path) || marketingPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** API endpoints the platform owner can reach on the root domain. Organization APIs need an organization. */
const platformApiRoutes = ['/api/auth/', '/api/platform/'];

/** Endpoints that must stay reachable while previewing, so the admin can always get back out. */
const previewEscapeRoutes = ['/api/auth/preview/exit', '/api/auth/logout'];

/**
 * Admin tools used from inside a preview. Their writes act as the admin, not as the previewed
 * technician — each route re-verifies the parked admin token itself before changing anything.
 */
const previewAdminRoutes = ['/api/technician-visibility'];

/** Writes still allowed while the organization is read-only (suspended or canceled). */
const readOnlyAllowedRoutes = ['/api/auth/logout', '/api/auth/impersonation/exit', '/api/auth/preview/exit'];
// Reporting a problem (and talking about it) stays possible while the organization is read-only.
const readOnlyAllowedPrefixes = ['/api/bug-reports'];
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * After the read-only period, a suspended/canceled organization only reaches the download page,
 * the export itself and the sign-in/out endpoints.
 */
const EXPORT_ONLY_PAGE = '/acesso-encerrado';
const exportOnlyAllowedRoutes = [EXPORT_ONLY_PAGE, '/api/organization/access', '/api/organization/export'];

/**
 * A company that subscribed on the site: until the setup fee is paid it only reaches the welcome
 * page; once paid (team preparing the platform) it can look around the whole system, but nothing
 * can be changed until the platform owner releases it.
 */
const ONBOARDING_PAGE = '/boas-vindas';
const onboardingAllowedRoutes = [ONBOARDING_PAGE, '/api/organization/onboarding'];

// The access level is read on every request of an organization: cache it briefly per slug.
const ACCESS_CACHE_MS = 30_000;
const accessCache = new Map<string, { at: number; access: OrganizationAccess | null }>();

async function organizationAccess(slug: string) {
  const cached = accessCache.get(slug);
  if (cached && Date.now() - cached.at < ACCESS_CACHE_MS) return cached.access;
  const access = await getAccessBySlug(slug);
  // Not cached while onboarding: the release must open the system on the very next request.
  if (access?.onboarding) accessCache.delete(slug);
  else accessCache.set(slug, { at: Date.now(), access });
  return access;
}

type MiddlewareAuth = {
  userId: string;
  email: string;
  role: string;
  organizationSlug: string | null;
  preview?: boolean;
  impersonationId?: string;
};

async function verifyAuthMiddleware(request: NextRequest): Promise<MiddlewareAuth | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as MiddlewareAuth;
  } catch {
    return null;
  }
}

function startsWithAny(path: string, prefixes: string[]) {
  return prefixes.some((prefix) => path.startsWith(prefix));
}

/** APIs answer 401 JSON; pages go to the login on the root domain. Optionally drops the cookie. */
function rejectSession(request: NextRequest, { clearCookie }: { clearCookie: boolean }) {
  const response = request.nextUrl.pathname.startsWith('/api/')
    ? NextResponse.json({ error: 'Sessão inválida. Entre novamente.' }, { status: 401 })
    : NextResponse.redirect(rootUrl('/login?sessao=expirada', request));

  if (clearCookie) response.cookies.delete(COOKIE_NAME);
  return response;
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Allow static files
  if (path.startsWith('/_next') || path.startsWith('/favicon') || path.includes('.')) {
    return NextResponse.next();
  }

  const host = resolveHost(request.headers.get('host'));

  // app/site/ is only reachable through the rewrite below, never by its internal path.
  if (path === SITE_DIRECTORY || path.startsWith(`${SITE_DIRECTORY}/`)) {
    return new NextResponse(null, { status: 404 });
  }

  // Coming from a plan (old links, bookmarks): that's a purchase, so it goes to the checkout.
  if (host.kind === 'root' && path === '/contato' && request.nextUrl.searchParams.has('plano')) {
    return NextResponse.redirect(sameHostUrl(`/contratar${request.nextUrl.search}`, request));
  }

  if (host.kind === 'root' && isMarketingPath(path)) {
    return NextResponse.rewrite(new URL(path === '/' ? SITE_DIRECTORY : `${SITE_DIRECTORY}${path}`, request.url));
  }

  // Login is centralized on the root domain; the e-mail decides which subdomain comes next.
  // Reaching it from inside an organization means signing out: no automatic redirect back.
  if (host.kind === 'organization' && path === '/login') {
    return NextResponse.redirect(rootUrl('/login?sair=1', request));
  }

  // Already signed in? Skip the form: the owner goes to the panel; an organization user goes back to
  // the subdomain they last used, whose own session decides (an expired one returns here with
  // ?sessao=expirada, which shows the form and forgets the organization — no redirect loop).
  if (host.kind === 'root' && path === '/login') {
    const stay = LOGIN_STAY_PARAMS.some((param) => request.nextUrl.searchParams.has(param));
    const auth = await verifyAuthMiddleware(request);
    if (auth?.role === 'platform_owner') return NextResponse.redirect(sameHostUrl('/plataforma', request));

    const lastOrganization = request.cookies.get(LAST_ORGANIZATION_COOKIE)?.value ?? '';
    if (stay) {
      const response = NextResponse.next();
      if (lastOrganization) response.cookies.delete(LAST_ORGANIZATION_COOKIE);
      return response;
    }
    if (lastOrganization && isValidOrganizationSlug(lastOrganization)) {
      return NextResponse.redirect(organizationUrl(lastOrganization, '/', request));
    }
  }

  if (publicRoutes.includes(path) || webhookRoutes.includes(path) || path.startsWith(PUBLIC_API_PREFIX)) {
    return NextResponse.next();
  }

  const auth = await verifyAuthMiddleware(request);

  if (!auth) {
    return rejectSession(request, { clearCookie: false });
  }

  if (host.kind === 'root') {
    // Only the platform owner has a session on the root domain.
    if (auth.role !== 'platform_owner') {
      return rejectSession(request, { clearCookie: true });
    }

    if (path.startsWith('/api/')) {
      return startsWithAny(path, platformApiRoutes)
        ? NextResponse.next()
        : NextResponse.json({ error: 'Rota disponível apenas dentro de uma organização.' }, { status: 403 });
    }

    if (!startsWithAny(path, platformRoutes)) {
      return NextResponse.redirect(sameHostUrl('/plataforma', request));
    }

    return NextResponse.next();
  }

  // Organization subdomain: the token must have been minted for this exact organization.
  if (auth.organizationSlug !== host.slug) {
    return rejectSession(request, { clearCookie: true });
  }

  if (startsWithAny(path, platformRoutes)) {
    return NextResponse.redirect(sameHostUrl('/', request));
  }

  // Suspended or canceled: read-only for a while (can view and export), then only the download
  // page. Checked here so no route can forget it. The platform owner, acting inside the
  // organization, is exempt so support can still see and fix everything.
  if (!auth.impersonationId) {
    const access = await organizationAccess(host.slug);
    const level = access?.level ?? 'full';

    if (access?.onboarding === 'awaiting_payment') {
      if (onboardingAllowedRoutes.includes(path) || path.startsWith('/api/auth/')) return NextResponse.next();
      return path.startsWith('/api/')
        ? NextResponse.json({ error: 'Conclua o pagamento da implantação para acessar a plataforma.', onboarding: true }, { status: 403 })
        : NextResponse.redirect(sameHostUrl(ONBOARDING_PAGE, request));
    }
    if (
      access?.onboarding === 'setup' &&
      !SAFE_METHODS.includes(request.method) &&
      !onboardingAllowedRoutes.includes(path) &&
      // Upgrading the plan is a purchase, allowed while the team prepares the platform.
      path !== '/api/organization/billing/upgrade' &&
      !path.startsWith('/api/auth/') &&
      !readOnlyAllowedPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
    ) {
      return NextResponse.json(
        {
          error: 'Sua plataforma está em preparação: por enquanto dá para olhar tudo, mas as alterações ficam liberadas quando a configuração terminar.',
          onboarding: true,
        },
        { status: 403 },
      );
    }
    if (path === ONBOARDING_PAGE && !access?.onboarding) return NextResponse.redirect(sameHostUrl('/', request));

    if (level === 'export_only' && !exportOnlyAllowedRoutes.includes(path) && !path.startsWith('/api/auth/')) {
      return path.startsWith('/api/')
        ? NextResponse.json(
            { error: 'O acesso a esta empresa foi encerrado. O administrador ainda pode baixar todos os dados.', exportOnly: true },
            { status: 403 },
          )
        : NextResponse.redirect(sameHostUrl(EXPORT_ONLY_PAGE, request));
    }

    if (
      level === 'read_only' &&
      !SAFE_METHODS.includes(request.method) &&
      !readOnlyAllowedRoutes.includes(path) &&
      !readOnlyAllowedPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
    ) {
      return NextResponse.json(
        {
          error: 'Acesso pausado por pendência na assinatura: o sistema está em modo somente leitura. O administrador pode regularizar e exportar os dados.',
          readOnly: true,
        },
        { status: 403 },
      );
    }

    if (path === EXPORT_ONLY_PAGE && level !== 'export_only') {
      return NextResponse.redirect(sameHostUrl('/', request));
    }
  }

  // A preview session is strictly read-only. Enforcing it here rather than per-route means a new
  // endpoint can't accidentally become writable while impersonating someone.
  if (
    auth.preview &&
    request.method !== 'GET' &&
    !previewEscapeRoutes.includes(path) &&
    !previewAdminRoutes.includes(path)
  ) {
    return NextResponse.json(
      { error: 'Ação bloqueada: o modo preview é somente leitura.' },
      { status: 403 },
    );
  }

  if (hiddenTechnicianRoutes.some(route => path.startsWith(route))) {
    if (auth.role === 'admin') {
      return NextResponse.redirect(sameHostUrl('/admin/services', request));
    }

    return NextResponse.redirect(sameHostUrl('/dashboard', request));
  }

  // Check admin routes
  if (adminRoutes.some(route => path.startsWith(route))) {
    if (auth.role !== 'admin') {
      return NextResponse.redirect(sameHostUrl('/dashboard', request));
    }
  }

  // Check technician routes
  if (technicianRoutes.some(route => path.startsWith(route))) {
    if (auth.role !== 'technician' && auth.role !== 'admin') {
      return NextResponse.redirect(sameHostUrl('/admin', request));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon|apple-icon).*)'],
};
