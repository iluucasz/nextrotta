// No dependencies: used by the middleware, the panel and the tests.

/** The people of the NextRotta itself (they belong to no company). */
export type PlatformRole = 'platform_owner' | 'platform_support';

export const PLATFORM_ROLES: PlatformRole[] = ['platform_owner', 'platform_support'];

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = { platform_owner: 'Admin', platform_support: 'Atendente' };

export const isPlatformRole = (role: unknown): role is PlatformRole => role === 'platform_owner' || role === 'platform_support';

/** Where a support user lands: the owner's home (overview) has the money in it. */
export const SUPPORT_HOME = '/plataforma/reports';

/** The parts of the panel a support user may open, by the first segment after /plataforma. */
export const SUPPORT_SECTIONS = ['reports', 'bugs', 'notificacoes', 'organizacoes', 'configuracoes'] as const;

/** The segments after /plataforma ("/plataforma/organizacoes/abc" -> ["organizacoes", "abc"]). */
export function panelSegments(pathname: string): string[] {
  const path = pathname.split('?')[0].replace(/\/+$/, '');
  if (path !== '/plataforma' && !path.startsWith('/plataforma/')) return [];
  return path.slice('/plataforma'.length).split('/').filter(Boolean);
}

/**
 * May this role open this page of the panel? The owner opens everything. A support user opens Reports (and the Livechat inside it),
 * the list and the page of a company (never the wizard to create one or its provisioning), and their own account.
 */
export function mayOpenPanelPath(role: unknown, pathname: string): boolean {
  if (role === 'platform_owner') return true;
  if (role !== 'platform_support') return false;
  const [section, second, third] = panelSegments(pathname);
  if (!section) return false;
  if (!(SUPPORT_SECTIONS as readonly string[]).includes(section)) return false;
  if (section === 'organizacoes') return second !== 'nova' && third === undefined;
  return true;
}
