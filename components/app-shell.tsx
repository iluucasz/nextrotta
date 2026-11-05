'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IMPERSONATION_FLAG_COOKIE, PREVIEW_FLAG_COOKIE } from '@/lib/preview-mode';
import { TECHNICIAN_PAGE_PATHS, type HideableTechnicianPage } from '@/lib/technician-visibility';
import { resetTechnicianVisibilityCache, useTechnicianVisibility } from '@/hooks/use-technician-visibility';
import { resetOrganizationSettingsCache } from '@/hooks/use-organization-settings';
import { TechnicianVisibilityDialog } from '@/components/technician-visibility-dialog';
import { MaintenanceBanner, SupportActions } from '@/components/organization-support';
import { NotificationsBell } from '@/components/notifications-bell';
import { BrandLogo, BrandMark } from '@/components/brand-logo';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AssistantWidget } from '@/components/assistant/widget';
import { LegalGate } from '@/components/legal-gate';
import { PasswordGate } from '@/components/password-gate';
import {
  Banknote,
  Bell,
  BookOpen,
  Bot,
  ChartNoAxesCombined,
  CreditCard,
  DatabaseBackup,
  CalendarDays,
  ChevronDown,
  Clock3,
  History,
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
  Tags,
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

// Every page renders its own AppShell, so the menu is rebuilt on each click. What the person did to it
// (how far it was scrolled, which titles they folded) has to live here, outside the component.
let cachedNavScroll = 0;
let cachedClosedSections: Record<string, boolean> = {};
let cachedClosedSectionsKnown = false;
const SIDEBAR_SECTIONS_STORAGE_KEY = 'app-sidebar-closed-sections';

type Role = 'admin' | 'technician';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Pages that live under this one: shown indented below it, open while you are inside the section. */
  children?: NavItem[];
}

interface AppShellProps {
  children: React.ReactNode;
  role: Role;
  userName?: string;
}

/** A titled group of menu entries. The first one has no title: it is the way back to the start. */
interface NavSection {
  label?: string;
  items: NavItem[];
}

// Grouped by what the admin is doing: the day-to-day, the money, the extra tools, the company itself.
const adminSections: NavSection[] = [
  { items: [{ href: '/admin', label: 'Operação', icon: LayoutDashboard }] },
  {
    label: 'Rotina',
    items: [
      { href: '/admin/technicians', label: 'Técnicos', icon: Users },
      { href: '/admin/services', label: 'Serviços', icon: Wrench },
      {
        href: '/admin/schedule',
        label: 'Escala',
        icon: CalendarDays,
        children: [{ href: '/admin/schedule/registros', label: 'Registros da escala', icon: History }],
      },
      { href: '/admin/payroll', label: 'Folha', icon: WalletCards },
      { href: '/admin/pecas', label: 'Venda de Peças', icon: Package },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      { href: '/admin/dashboard-gerencial', label: 'Dashboard Gerencial', icon: ChartNoAxesCombined },
      { href: '/admin/faturamento', label: 'Faturamento', icon: TrendingUp },
      { href: '/admin/despesas', label: 'Despesas', icon: Landmark },
    ],
  },
  {
    label: 'Ferramentas',
    items: [
      { href: '/admin/assistente', label: 'Assistente IA', icon: Sparkles },
      { href: '/admin/library', label: 'Biblioteca', icon: BookOpen },
      { href: '/admin/whatsapp', label: 'WhatsApp', icon: MessageCircle },
      { href: '/admin/config-porto', label: 'Config. Porto', icon: ShieldCheck },
    ],
  },
  {
    label: 'Empresa',
    items: [
      { href: '/admin/notificacoes', label: 'Notificações', icon: Bell },
      {
        href: '/admin/configuracoes',
        label: 'Configurações',
        icon: Settings,
        children: [
          { href: '/admin/configuracoes/pagamento', label: 'Pagamento', icon: Banknote },
          { href: '/admin/configuracoes/jornada', label: 'Jornada e horas', icon: Clock3 },
          { href: '/admin/configuracoes/porto', label: 'Robô do Porto', icon: Bot },
          { href: '/admin/configuracoes/financeiro', label: 'Financeiro', icon: Tags },
          { href: '/admin/configuracoes/backups', label: 'Backups', icon: DatabaseBackup },
          { href: '/admin/assinatura', label: 'Assinatura', icon: CreditCard },
        ],
      },
    ],
  },
];

/** Menu entries that only exist when the organization's plan includes the feature. */
const LINK_FEATURES: Record<string, string> = {
  '/admin/dashboard-gerencial': 'management_dashboard',
  '/admin/assistente': 'ai',
  '/admin/faturamento': 'billing_report',
  '/admin/despesas': 'finance',
  '/admin/library': 'library',
  '/admin/whatsapp': 'whatsapp',
  '/admin/config-porto': 'porto',
  '/admin/configuracoes/porto': 'porto',
  '/admin/configuracoes/financeiro': 'finance',
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

/** "Lucas Santos (dono da plataforma)" → the name, and the part in parentheses as the role line. */
function splitAccountName(value?: string) {
  const name = (value ?? 'Usuário').trim();
  const match = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!match || !match[1]) return { name, tag: '' };

  const tag = match[2].trim();
  return { name: match[1].trim(), tag: tag.charAt(0).toUpperCase() + tag.slice(1) };
}

interface AccountMenuProps {
  role: Role;
  userName?: string;
  /** Preview mode: the account is shown but there is nothing to open (the banner above has the exit). */
  readOnly: boolean;
  isLoggingOut: boolean;
  onLogout: () => void;
}

/** The person's account in the top bar: avatar, name and role in one piece; signing out lives in its menu. */
function AccountMenu({ role, userName, readOnly, isLoggingOut, onLogout }: AccountMenuProps) {
  const { name, tag } = splitAccountName(userName);
  const roleLabel = tag || (role === 'admin' ? 'Acesso administrativo' : 'Área do colaborador');
  const content = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground ring-2 ring-secondary">
        {getInitials(name) || 'U'}
      </span>
      <span className="min-w-0 text-left leading-tight">
        <span className="block max-w-56 truncate text-[15px] font-semibold text-foreground">{name}</span>
        <span className={`mt-0.5 block max-w-56 truncate text-[13px] ${tag ? 'font-medium text-primary' : 'text-muted-foreground'}`}>{roleLabel}</span>
      </span>
    </>
  );

  if (readOnly) {
    return <div className="flex items-center gap-3 rounded-xl py-1.5 pl-1.5 pr-3">{content}</div>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group flex items-center gap-3 rounded-xl py-1.5 pl-1.5 pr-2.5 outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-secondary"
          aria-label={`Conta de ${name}`}
        >
          {content}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem disabled={isLoggingOut} onSelect={onLogout} className="cursor-pointer gap-2.5 py-2.5 text-sm">
          <LogOut className="h-4 w-4" />
          {isLoggingOut ? 'Saindo...' : 'Sair da conta'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const [legalResolved, setLegalResolved] = useState(false);
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

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [closedSections, setClosedSections] = useState<Record<string, boolean>>(cachedClosedSections);
  const navRef = useRef<HTMLElement>(null);

  const allowedByPlan = (link: NavItem) => {
    const feature = LINK_FEATURES[link.href];
    const features = organizationStatus?.features;
    return !feature || !features || features.includes(feature);
  };
  const { visibility, loading: visibilityLoading } = useTechnicianVisibility({ enabled: role === 'technician' });
  // Pages the admin hid for this technician drop out of the menu; the pages themselves also
  // redirect, in case someone reaches them by URL. Until the settings arrive, the hideable entries
  // stay out too — briefly showing a link that then vanishes would reveal it was hidden.
  const technicianItems = technicianLinks.filter((link) => {
    const page = (Object.keys(TECHNICIAN_PAGE_PATHS) as HideableTechnicianPage[]).find((key) => TECHNICIAN_PAGE_PATHS[key] === link.href);
    return !page || (!visibilityLoading && visibility[page].visible);
  });
  // A group whose entries the plan (or the technician settings) all took away does not show its title either.
  const sections = (role === 'admin' ? adminSections : [{ items: technicianItems }])
    .map((section) => ({
      ...section,
      items: section.items.filter(allowedByPlan).map((link) => (link.children ? { ...link, children: link.children.filter(allowedByPlan) } : link)),
    }))
    .filter((section) => section.items.length > 0);
  const links = sections.flatMap((section) => section.items);

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

  useEffect(() => {
    if (cachedClosedSectionsKnown) return;
    cachedClosedSectionsKnown = true;
    try {
      const stored = JSON.parse(window.localStorage.getItem(SIDEBAR_SECTIONS_STORAGE_KEY) ?? '{}');
      if (stored && typeof stored === 'object') {
        cachedClosedSections = stored;
        setClosedSections(stored);
      }
    } catch {
      // A blocked or broken storage only means the folded titles are not remembered.
    }
  }, []);

  const toggleSection = (label: string) => {
    setClosedSections((current) => {
      const next = { ...current, [label]: !current[label] };
      cachedClosedSections = next;
      try {
        window.localStorage.setItem(SIDEBAR_SECTIONS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // see above
      }
      return next;
    });
  };

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
  // The most specific page wins: /admin/schedule/registros is the child, not the Escala page above it.
  const activeLink = links
    .flatMap((link) => [link, ...(link.children ?? [])])
    .filter((link) => (link.href === rootHref ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`)))
    .sort((left, right) => right.href.length - left.href.length)[0];

  // The menu is rebuilt on every page: put it back where it was, then make sure the page you are on is in view.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    nav.scrollTop = cachedNavScroll;
    const active = nav.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!active) return;
    const navBox = nav.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    if (box.top < navBox.top + 8) nav.scrollTop -= navBox.top + 8 - box.top;
    else if (box.bottom > navBox.bottom - 8) nav.scrollTop += box.bottom - (navBox.bottom - 8);
    cachedNavScroll = nav.scrollTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLink?.href, sections.length, organizationStatus?.features?.length]);

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
          {previewMode || role !== 'admin' ? null : <NotificationsBell />}
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

          <nav ref={navRef} onScroll={(event) => (cachedNavScroll = event.currentTarget.scrollTop)} className="app-navigation flex-1 overflow-y-auto px-3 py-3" aria-label="Menu principal">
            {sections.map((section) => {
              const hasActive = section.items.some((link) => link.href === activeLink?.href || link.children?.some((child) => child.href === activeLink?.href));
              // Folding only applies to the full menu, and the group you are in never folds away.
              const folded = Boolean(section.label && closedSections[section.label] && !hasActive && !collapsed);
              return (
              <div key={section.label ?? 'start'} className="app-nav-section">
                {section.label ? (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleSection(section.label!)}
                      aria-expanded={!folded}
                      className={`app-nav-title ${collapsed ? 'lg:hidden' : ''}`}
                    >
                      <span>{section.label}</span>
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${folded ? '-rotate-90' : ''}`} />
                    </button>
                    {/* Collapsed, the title has no room: a thin line keeps the groups apart. */}
                    <div className={`mx-2 mt-2 hidden border-t border-border ${collapsed ? 'lg:block' : ''}`} aria-hidden="true" />
                  </>
                ) : null}
                {folded ? null : section.items.map((link) => {
              const Icon = link.icon;
              const isActive = activeLink?.href === link.href;
              const children = link.children ?? [];
              const inSection = children.some((child) => child.href === activeLink?.href);
              const isExpanded = children.length > 0 && (expandedGroups[link.href] ?? inSection);

              return (
                <div key={link.href}>
                  <div className="relative">
                    <Link
                      href={link.href}
                      onClick={() => setOpen(false)}
                      aria-current={isActive ? 'page' : undefined}
                      title={collapsed ? link.label : undefined}
                      className={`flex min-h-9 items-center gap-2.5 rounded-md px-3.5 text-sm font-medium ${motion || 'transition-colors'} ${
                        collapsed ? 'lg:justify-center' : ''
                      } ${
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : inSection
                            ? 'app-nav-open text-foreground'
                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                      } ${children.length ? (collapsed ? 'lg:pr-3.5 pr-10' : 'pr-10') : ''}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span
                        className={`inline-block max-w-40 overflow-hidden whitespace-nowrap opacity-100 ${motion} ${collapsed ? 'lg:max-w-0 lg:opacity-0' : ''}`}
                      >
                        {link.label}
                      </span>
                    </Link>
                    {children.length ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedGroups(() => {
                            // One submenu open at a time keeps the menu short: the others close.
                            const next: Record<string, boolean> = {};
                            for (const other of links) if (other.children?.length) next[other.href] = false;
                            next[link.href] = !isExpanded;
                            return next;
                          })
                        }
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Recolher' : 'Expandir'} ${link.label}`}
                        className={`absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md ${
                          isActive ? 'text-primary-foreground hover:bg-white/15' : 'text-muted-foreground hover:bg-background hover:text-foreground'
                        } ${collapsed ? 'lg:hidden' : ''}`}
                      >
                        <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </button>
                    ) : null}
                  </div>

                  {isExpanded ? (
                    <div className={`app-nav-children ${collapsed ? 'lg:hidden' : ''}`}>
                      {children.map((child) => {
                        const ChildIcon = child.icon;
                        const isChildActive = activeLink?.href === child.href;

                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={() => setOpen(false)}
                            aria-current={isChildActive ? 'page' : undefined}
                            className={`app-nav-child flex items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors ${
                              isChildActive
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                            }`}
                          >
                            <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{child.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
                })}
              </div>
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
          <div className="flex items-center gap-1.5">
            {previewMode ? null : (
              <>
                {role === 'admin' ? <NotificationsBell /> : null}
                <SupportActions quiet basePath={role === 'admin' ? '/admin/suporte' : '/dashboard/suporte'} />
                <span className="mx-2.5 h-8 w-px bg-border" aria-hidden="true" />
              </>
            )}
            <AccountMenu role={role} userName={userName} readOnly={previewMode} isLoggingOut={isLoggingOut} onLogout={handleLogout} />
          </div>
        </header>
        <div className="app-content">
          {children}
        </div>
      </main>
      {role === 'admin' && !previewMode ? <AssistantWidget /> : null}
      <LegalGate enabled={role === 'admin' && !previewMode && !impersonationMode} onResolved={() => setLegalResolved(true)} />
      {/* Only after the terms window (admins) is out of the way. */}
      <PasswordGate enabled={!previewMode && !impersonationMode && (role !== 'admin' || legalResolved)} />
      </div>
    </>
  );
}
