// No dependencies: used by the server (notices, checks), the panel and the tests.

/** What a notice for the NextRotta's own people is about. One place for the labels (the inbox, the filters and the bell). */
export const NOTICE_CATEGORIES = ['billing', 'limits', 'automation', 'whatsapp', 'backup', 'ai', 'support', 'growth', 'security', 'system'] as const;
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number];

export const NOTICE_CATEGORY_LABELS: Record<NoticeCategory, string> = {
  billing: 'Pagamentos',
  limits: 'Limites',
  automation: 'Robô do Porto',
  whatsapp: 'WhatsApp',
  backup: 'Backups',
  ai: 'Créditos de IA',
  support: 'Atendimento',
  growth: 'Clientes e vendas',
  security: 'Privacidade',
  system: 'Plataforma',
};

export const NOTICE_SEVERITIES = ['critical', 'warning', 'success', 'info'] as const;
export type NoticeSeverity = (typeof NOTICE_SEVERITIES)[number];

/** Same four levels the companies' bell uses. */
export const NOTICE_SEVERITY_LABELS: Record<NoticeSeverity, string> = {
  critical: 'Crítico',
  warning: 'Atenção',
  success: 'Concluído',
  info: 'Aviso',
};

/** 'owner' = the admins only (money, platform health); 'staff' = the admins and the support users too. */
export type NoticeAudience = 'owner' | 'staff';

export function isNoticeCategory(value: unknown): value is NoticeCategory {
  return NOTICE_CATEGORIES.includes(value as NoticeCategory);
}

export function isNoticeSeverity(value: unknown): value is NoticeSeverity {
  return NOTICE_SEVERITIES.includes(value as NoticeSeverity);
}

/** Support users only ever see what is about attending customers. Everything else is the admins'. */
export function defaultAudience(category: NoticeCategory): NoticeAudience {
  return category === 'support' ? 'staff' : 'owner';
}

/**
 * Which of a company's own notifications also reach the NextRotta's people, and as what. Only what needs a person to look:
 * a payment that came in or is late, credits running out, the robot failing. What is the customer's own business (payroll,
 * expenses, parts, the escala) never leaves the company; limits, WhatsApp and modules are covered by the platform checks
 * (they run even when nobody opens the company's system), so mirroring them would warn twice.
 */
export function mirrorRule(kind: string, severity: string): { category: NoticeCategory; severity: NoticeSeverity } | null {
  if (!isNoticeSeverity(severity)) return null;
  switch (kind) {
    case 'billing':
      // A new charge (info) is routine; a paid one, a late one and a regularized account are what the owner follows.
      return severity === 'info' ? null : { category: 'billing', severity };
    case 'credits':
      return severity === 'warning' || severity === 'critical' ? { category: 'ai', severity } : null;
    case 'porto':
      return severity === 'warning' || severity === 'critical' ? { category: 'automation', severity } : null;
    default:
      return null;
  }
}

/** The owner's WhatsApp alerts (platform_alerts) also land in the inbox: what each kind is. */
export function noticeForAlertKind(kind: string): { category: NoticeCategory; severity: NoticeSeverity; audience: NoticeAudience } {
  switch (kind) {
    case 'porto_layout':
      return { category: 'automation', severity: 'critical', audience: 'owner' };
    case 'porto_stuck':
      return { category: 'automation', severity: 'critical', audience: 'owner' };
    case 'porto_queue_late':
      return { category: 'automation', severity: 'warning', audience: 'owner' };
    case 'ai_balance':
      return { category: 'ai', severity: 'critical', audience: 'owner' };
    case 'privacy_request':
      return { category: 'security', severity: 'warning', audience: 'owner' };
    case 'livechat':
      return { category: 'support', severity: 'warning', audience: 'staff' };
    case 'worker':
      return { category: 'system', severity: 'critical', audience: 'owner' };
    default:
      return { category: 'system', severity: 'warning', audience: 'owner' };
  }
}

/** Share of a plan limit used (0 to 1+), or null when the limit is unlimited or zero. */
export function limitShare(used: number, limit: number | null): number | null {
  if (limit === null || !(limit > 0)) return null;
  return used / limit;
}

/** The usage level that is worth a notice: 'full' at 100%, 'near' from 90%. */
export function limitLevel(share: number | null): 'full' | 'near' | null {
  if (share === null) return null;
  if (share >= 1) return 'full';
  if (share >= 0.9) return 'near';
  return null;
}
