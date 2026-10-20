'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { IMPERSONATION_FLAG_COOKIE, PREVIEW_FLAG_COOKIE } from '@/lib/preview-mode';
import { TECHNICIAN_PAGE_PATHS, type HideableTechnicianPage } from '@/lib/technician-visibility';
import { resetTechnicianVisibilityCache, useTechnicianVisibility } from '@/hooks/use-technician-visibility';
import { resetOrganizationSettingsCache } from '@/hooks/use-organization-settings';
import { TechnicianVisibilityDialog } from '@/components/technician-visibility-dialog';
import { MaintenanceBanner, ModuleStatusBanner, SupportActions } from '@/components/organization-support';
import { BrandLogo, BrandMark } from '@/components/brand-logo';
import { AssistantWidget } from '@/components/assistant/widget';
import {
  BookOpen,
  ChartNoAxesCombined,
  CreditCard,
  CalendarDays,
  Clock3,
  Landmark,
  LayoutDashboard,
  Eye,
  LogOut,
  Menu,
  MessageCircle,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Users,
  WalletCards,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'app-sidebar-collapsed';

// Module scope, so it outlives the AppShell instances that come and go with each client-side
// navigation — see the comment where it's read in AppShell.
let cachedCollapsed = false;
let cachedCollapsedKnown = false;

type Role = 'admin' | 'technician';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface AppShellProps {
  children: React.ReactNode;
  role: Role;
  userName?: string;
}

const adminLinks: NavItem[] = [
  { href: '/admin', label: 'Operação', icon: LayoutDashboard },
  { href: '/admin/dashboard-gerencial', label: 'Dashboard Gerencial', icon: ChartNoAxesCombined },
  { href: '/admin/assistente', label: 'Assistente IA', icon: Sparkles },
  { href: '/admin/technicians', label: 'Técnicos', icon: Users },
  { href: '/admin/services', label: 'Serviços', icon: Wrench },
  { href: '/admin/schedule', label: 'Escala', icon: CalendarDays },
  { href: '/admin/payroll', label: 'Folha', icon: WalletCards },
  { href: '/admin/pecas', label: 'Controle de Peças', icon: Package },
  { href: '/admin/faturamento', label: 'Faturamento', icon: TrendingUp },
  { href: '/admin/financeiro', label: 'Controle de Despesas', icon: Landmark },
  { href: '/admin/library', label: 'Biblioteca', icon: BookOpen },
  { href: '/admin/whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { href: '/admin/config-porto', label: 'Config. Porto', icon: ShieldCheck },
  { href: '/admin/configuracoes', label: 'Configurações', icon: Settings },
  { href: '/admin/assinatura', label: 'Assinatura', icon: CreditCard },
];

/** Menu entries that only exist when the organization's plan includes the feature. */
const LINK_FEATURES: Record<string, string> = {
  '/admin/dashboard-gerencial': 'management_dashboard',
  '/admin/assistente': 'ai',
  '/admin/faturamento': 'billing_report',
  '/admin/financeiro': 'finance',
  '/admin/library': 'library',
  '/admin/whatsapp': 'whatsapp',
  '/admin/config-porto': 'porto',
  '/dashboard/library': 'library',
  '/admin/pecas': 'parts',
  '/dashboard/pecas': 'parts',
};

type OrganizationStatusInfo = {
  readOnly: boolean;
  pastDue: boolean;
  /** null = no plan yet, nothing restricted. */
  features: string[] | null;
  /** The platform's maintenance notice, when on. */
  maintenance: string | null;
  /** Read-only organizations: last day they can still view everything (then download only). */
  readOnlyUntil: string | null;
  /** Subscribed on the site and still being set up by the team: browsing only. */
  preparing?: boolean;
};

let cachedOrganizationStatus: Promise<OrganizationStatusInfo | null> | null = null;

/** Fetched once per page load; drives the plan-aware menu and the billing banners. */
function loadOrganizationStatus() {
  if (!cachedOrganizationStatus) {
    cachedOrganizationStatus = fetch('/api/organization/status', { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<OrganizationStatusInfo>) : null))
      .catch(() => null);
  }
  return cachedOrganizationStatus;
}

function BillingBanner({ readOnly, readOnlyUntil }: { readOnly: boolean; readOnlyUntil: string | null }) {
  return (
    <div
      className={`border-b px-4 py-2 text-sm ${
        readOnly ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-amber-300 bg-amber-50 text-amber-950'
      }`}
      role="status"
    >
      {readOnly ? (
        <>
          <strong className="font-semibold">Acesso pausado.</strong> O sistema está em modo somente leitura: nada foi apagado e
          os dados podem ser consultados e exportados (em Assinatura)
          {readOnlyUntil
            ? ` até ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'long' }).format(new Date(readOnlyUntil))}. Depois disso, só será possível baixar os dados.`
            : '.'}{' '}
          Regularize para voltar a usar normalmente.
        </>
      ) : (
        <>
          <strong className="font-semibold">Pagamento da assinatura em atraso.</strong> Regularize para evitar que o acesso
          seja pausado.
        </>
      )}
    </div>
  );
}

function PreparingBanner() {
  return (
    <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-950" role="status">
      <strong className="font-semibold">Sua plataforma está em preparação.</strong> Nossa equipe vai entrar em contato para
      configurar tudo com você. Enquanto isso, fique à vontade para dar uma olhada: as alterações ficam liberadas quando a
      configuração terminar.{' '}
      <a href="/boas-vindas" className="font-medium underline underline-offset-2">
        Ver andamento
      </a>
    </div>
  );
}

const technicianLinks: NavItem[] = [
  { href: '/dashboard', label: 'Minha visão', icon: LayoutDashboard },
  { href: '/dashboard/hours', label: 'Banco de horas', icon: Clock3 },
  { href: '/dashboard/schedule', label: 'Agenda', icon: CalendarDays },
  { href: '/dashboard/payroll', label: 'Pagamento', icon: WalletCards },
  { href: '/dashboard/pecas', label: 'Minhas peças', icon: Package },
  { href: '/dashboard/library', label: 'Biblioteca', icon: BookOpen },
];

interface PreviewBannerProps {
  userName?: string;
}

/** The platform owner acting inside this organization ("entrar na conta"); every change is audited. */
function ImpersonationBanner() {
  const [isExiting, setIsExiting] = useState(false);
  const [error, setError] = useState('');

  const handleExit = async () => {
    setIsExiting(true);
    setError('');

    try {
      const response = await fetch('/api/auth/impersonation/exit', { method: 'POST' });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.redirectTo) {
        setError(data?.error || 'Não foi possível sair.');
        setIsExiting(false);
        return;
      }

      // Back to the platform panel on the root domain.
      window.location.assign(data.redirectTo);
    } catch {
      setError('Não foi possível sair.');
      setIsExiting(false);
    }
  };

  return (
    <div className="sticky top-0 z-50 flex h-(--preview-banner-height) items-center justify-between gap-3 border-b border-rose-300 bg-rose-100 px-4 text-rose-950">
      <p className="flex min-w-0 items-center gap-2 text-sm">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">
          <strong className="font-semibold">Você está acessando como dono da plataforma</strong>
          <span className="hidden sm:inline"> — tudo o que for alterado fica registrado na auditoria</span>
        </span>
      </p>
      <div className="flex items-center gap-3">
        {error ? <span className="text-xs font-medium text-rose-700">{error}</span> : null}
        <button
          type="button"
          onClick={handleExit}
          disabled={isExiting}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-3 text-sm font-medium text-rose-900 transition-colors hover:bg-rose-200 disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" />
          {isExiting ? 'Saindo...' : 'Sair'}
        </button>
      </div>
    </div>
  );
}

function PreviewBanner({ userName }: PreviewBannerProps) {
  const [isExiting, setIsExiting] = useState(false);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleExit = async () => {
    setIsExiting(true);
    setError('');

    try {
      const response = await fetch('/api/auth/preview/exit', { method: 'POST' });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error || 'Não foi possível sair do modo preview.');
        setIsExiting(false);
        return;
      }

      // Full reload rather than a client-side push: the identity behind every cached page and
      // fetch just changed, so nothing from the technician session should be reused.
      window.location.href = '/admin/technicians';
    } catch {
      setError('Não foi possível sair do modo preview.');
      setIsExiting(false);
    }
  };

  return (
    // Spans the full width above the shell (not just the content column) so it can't collide with
    // the sidebar's collapse toggle, which deliberately overhangs the panel's right edge. Height is
    // fixed and shared with design-system.css, which offsets the sidebar by exactly this much.
    <div className="sticky top-0 z-50 flex h-(--preview-banner-height) items-center justify-between gap-3 border-b border-amber-300 bg-amber-100 px-4 text-amber-950">
      <p className="flex min-w-0 items-center gap-2 text-sm">
        <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">
          <strong className="font-semibold">Modo preview</strong>
          {userName ? <span> — visualizando como {userName}</span> : null}
          <span className="hidden sm:inline"> (somente leitura)</span>
        </span>
      </p>
      <div className="flex items-center gap-3">
        {error ? <span className="text-xs font-medium text-rose-700">{error}</span> : null}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-300 bg-amber-50 text-amber-900 transition-colors hover:bg-amber-200"
          aria-label="Configurar o que o técnico visualiza"
          title="Configurar o que o técnico visualiza"
        >
          <Settings className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleExit}
          disabled={isExiting}
          className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md bg-amber-900 px-3 text-xs font-semibold text-amber-50 transition-colors hover:bg-amber-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <LogOut className="h-3.5 w-3.5" />
          {isExiting ? 'Saindo...' : 'Sair do modo preview'}
        </button>
      </div>
      <TechnicianVisibilityDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

function getInitials(value?: string) {
  return (value ?? 'Usuário')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

interface ProfileSummaryProps {
  role: Role;
  userName?: string;
}

function ProfileSummary({ role, userName }: ProfileSummaryProps) {
  const initials = getInitials(userName);
  const accessLabel = role === 'admin' ? 'Acesso administrativo' : 'Área do colaborador';

  return (
    <div className="app-profile flex min-w-0 items-center gap-3 text-left">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">
        {initials || 'U'}
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-medium">{userName ?? 'Sem usuário'}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{accessLabel}</span>
      </span>
    </div>
  );
}

interface LogoutButtonProps {
  isLoggingOut: boolean;
  onLogout: () => void;
}

function LogoutButton({ isLoggingOut, onLogout }: LogoutButtonProps) {
  return (
    <button
      type="button"
      onClick={onLogout}
      disabled={isLoggingOut}
      aria-label={isLoggingOut ? 'Saindo da conta' : 'Sair da conta'}
      className="app-logout inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
    >
      <LogOut className="h-4 w-4" />
      {isLoggingOut ? 'Saindo...' : 'Sair'}
    </button>
  );
}

export function AppShell({ children, role, userName }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Seeded from the module cache, not from localStorage: every page renders its own AppShell, so
  // this component remounts on each navigation. Starting from `false` there made the sidebar snap
  // open and animate shut again on every route change; starting from localStorage directly would
  // disagree with the server-rendered markup and break hydration. The cache is only ever written
  // after mount, so the first render still matches the server.
  const [collapsed, setCollapsed] = useState(cachedCollapsed);
  const [animated, setAnimated] = useState(cachedCollapsedKnown);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [impersonationMode, setImpersonationMode] = useState(false);
  const [organizationStatus, setOrganizationStatus] = useState<OrganizationStatusInfo | null>(null);

  useEffect(() => {
    let active = true;
    loadOrganizationStatus().then((value) => {
      if (active) setOrganizationStatus(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const allowedByPlan = (link: NavItem) => {
    const feature = LINK_FEATURES[link.href];
    const features = organizationStatus?.features;
    return !feature || !features || features.includes(feature);
  };
  const { visibility, loading: visibilityLoading } = useTechnicianVisibility({ enabled: role === 'technician' });
  // Pages the admin hid for this technician drop out of the menu; the pages themselves also
  // redirect, in case someone reaches them by URL. Until the settings arrive, the hideable entries
  // stay out too — briefly showing a link that then vanishes would reveal it was hidden.
  const links = (
    role === 'admin'
      ? adminLinks
      : technicianLinks.filter((link) => {
          const page = (Object.keys(TECHNICIAN_PAGE_PATHS) as HideableTechnicianPage[]).find(
            (key) => TECHNICIAN_PAGE_PATHS[key] === link.href,
          );
          return !page || (!visibilityLoading && visibility[page].visible);
        })
  ).filter(allowedByPlan);

  // Read from the client-visible marker cookie rather than refetching the session: it's only
  // deciding whether to render a banner, and the server-side cookies remain the source of truth
  // for anything the banner's exit button actually does.
  useEffect(() => {
    const cookies = document.cookie.split('; ');
    setPreviewMode(cookies.includes(`${PREVIEW_FLAG_COOKIE}=1`));
    setImpersonationMode(cookies.includes(`${IMPERSONATION_FLAG_COOKIE}=1`));
  }, [pathname]);

  useEffect(() => {
    if (cachedCollapsedKnown) {
      return;
    }

    cachedCollapsed = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
    cachedCollapsedKnown = true;
    setCollapsed(cachedCollapsed);
    // Transitions stay off until the stored preference has actually been applied, so the one-time
    // correction on a cold load lands instantly instead of animating open-then-shut.
    const frame = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value;
      cachedCollapsed = next;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  };

  const motion = animated ? 'transition-all duration-300 ease-in-out' : '';
  const rootHref = role === 'admin' ? '/admin' : '/dashboard';
  const activeLink = links.find((link) =>
    link.href === rootHref ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`),
  );

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      resetTechnicianVisibilityCache();
      resetOrganizationSettingsCache();
      // Full navigation: on an organization subdomain /login redirects to the root domain.
      window.location.assign('/login');
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <>
      {/* A preview opened while impersonating shows its own banner: leaving it comes first. */}
      {previewMode ? <PreviewBanner userName={userName} /> : impersonationMode ? <ImpersonationBanner /> : null}
      {organizationStatus?.maintenance ? <MaintenanceBanner message={organizationStatus.maintenance} /> : null}
      {organizationStatus?.preparing ? <PreparingBanner /> : null}
      {organizationStatus?.readOnly || organizationStatus?.pastDue ? (
        <BillingBanner readOnly={organizationStatus.readOnly} readOnlyUntil={organizationStatus.readOnlyUntil} />
      ) : null}
      <div
        className="app-shell relative min-h-screen bg-background text-foreground lg:flex"
        data-collapsed={collapsed ? 'true' : undefined}
        data-preview={previewMode || impersonationMode ? 'true' : undefined}
      >
      <div className="app-mobile-header sticky top-0 z-40 flex h-12 items-center justify-between border-b border-border bg-card px-3 lg:hidden">
        <div className="min-w-0 flex-1 pr-2">
          <ProfileSummary role={role} userName={userName} />
        </div>
        <div className="flex items-center gap-2">
          {previewMode ? null : <SupportActions compact basePath={role === 'admin' ? '/admin/suporte' : '/dashboard/suporte'} />}
          {/* Hidden during preview: it sits next to the banner's "Sair do modo preview" and reads
              almost the same, but logs the admin out entirely instead of handing their session
              back. Exiting the preview is the only sign-out that makes sense from here. */}
          {previewMode ? null : <LogoutButton isLoggingOut={isLoggingOut} onLogout={handleLogout} />}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background"
            aria-label="Abrir navegação"
            aria-expanded={open}
            aria-controls="app-navigation"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <aside
        id="app-navigation"
        className={`app-sidebar ${open ? 'block' : 'hidden'} ${motion} fixed inset-x-0 top-12 z-30 border-b border-border bg-card lg:sticky lg:top-0 lg:block lg:h-screen lg:shrink-0 lg:border-b-0 lg:border-r`}
      >
        {/*
          Anchored to the sidebar's own right edge (and hanging half outside it), so it travels
          with the width instead of animating its own `left` — two separate animations racing to
          stay aligned is what made the icon look like it lagged behind the panel. `.app-sidebar`
          is `fixed`/`sticky`, so it's already a containing block for this; design-system.css drops
          its overflow clipping at lg so the overhang isn't cut off.
        */}
        <button
          type="button"
          onClick={toggleCollapsed}
          className="absolute -right-3.5 top-[calc(var(--app-header-height)/2)] z-30 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-[0_2px_6px_#25233733] transition-colors hover:bg-secondary hover:text-foreground lg:flex"
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
        </button>

        <div className="flex h-full flex-col">
          {/*
            The `collapsed` preference only ever applies at the lg breakpoint (the mobile drawer
            below lg is always shown expanded, regardless of the stored preference — collapsing a
            fixed-width sidebar makes no sense on a full-width overlay drawer). Every conditional
            class below is `lg:`-scoped for that reason, and both the full brand block and the
            compact badge stay in the DOM (toggled via CSS, not unmounted) so this works with plain
            responsive classes instead of needing a second, viewport-aware piece of state.

            The actual width is set in design-system.css via `.app-shell[data-collapsed='true']
            .app-sidebar` — a plain `lg:w-*` Tailwind utility here loses to that file's existing
            `.app-sidebar` width rule at the lg breakpoint (equal specificity, later in the
            cascade), so the override has to win on specificity instead (an extra class+attribute
            selector), not by trying to load after it.
          */}
          <div
            className={`app-brand flex h-16 items-center overflow-hidden border-b border-border px-5 ${motion} ${collapsed ? 'lg:justify-center lg:px-2' : ''}`}
          >
            {/*
              Both the full text and the compact badge stay mounted always — collapsing/expanding
              fades and shrinks one while growing the other via max-width + opacity (both
              transition-friendly), instead of a hidden/flex swap, which can't animate at all
              (display changes are a hard cut, never a transition).
            */}
            <div className={`max-w-50 overflow-hidden opacity-100 ${motion} ${collapsed ? 'lg:max-w-0 lg:opacity-0' : ''}`}>
              <BrandLogo className="h-12 w-auto text-[#f5f4ff]" accent="#a99af8" />
            </div>
            <span
              className={`flex h-9 w-0 shrink-0 items-center justify-center overflow-hidden opacity-0 ${motion} ${collapsed ? 'lg:w-9 lg:opacity-100' : ''}`}
              aria-hidden="true"
            >
              <BrandMark className="h-9 w-9" accent="#7161ef" />
            </span>
          </div>

          <nav className="app-navigation flex-1 space-y-1.5 px-3 py-4">
            {links.map((link) => {
              const Icon = link.icon;
              const isActive = activeLink?.href === link.href;

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive ? 'page' : undefined}
                  title={collapsed ? link.label : undefined}
                  className={`flex min-h-10 items-center gap-2.5 rounded-md px-3.5 text-sm font-medium ${motion || 'transition-colors'} ${
                    collapsed ? 'lg:justify-center' : ''
                  } ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span
                    className={`inline-block max-w-40 overflow-hidden whitespace-nowrap opacity-100 ${motion} ${collapsed ? 'lg:max-w-0 lg:opacity-0' : ''}`}
                  >
                    {link.label}
                  </span>
                </Link>
              );
            })}
          </nav>

        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="app-topbar sticky top-0 z-20 hidden h-16 items-center justify-between border-b border-border bg-card/95 px-4 backdrop-blur lg:flex">
          <div className="app-breadcrumb min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{activeLink?.label ?? (pathname.includes('/suporte') ? 'Suporte' : 'Painel')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{role === 'admin' ? 'Painel administrativo' : 'Painel do técnico'}</p>
          </div>
          <div className="flex items-center gap-3">
            {previewMode ? null : <SupportActions basePath={role === 'admin' ? '/admin/suporte' : '/dashboard/suporte'} />}
            <ProfileSummary role={role} userName={userName} />
            {previewMode ? null : <LogoutButton isLoggingOut={isLoggingOut} onLogout={handleLogout} />}
          </div>
        </header>
        <div className="app-content">
          {role === 'admin' && !previewMode ? <ModuleStatusBanner /> : null}
          {children}
        </div>
      </main>
      {role === 'admin' && !previewMode ? <AssistantWidget /> : null}
      </div>
    </>
  );
}
