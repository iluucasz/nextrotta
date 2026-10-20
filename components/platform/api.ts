'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Real data for the platform panel: thin helpers over /api/platform/*. Errors carry the API's
 * message (already in Portuguese) so screens can show it as is.
 */
export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`/api/platform${path}`, {
    method: init?.method ?? (init?.body === undefined ? 'GET' : 'POST'),
    headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => null);

  // The owner's session expired: back to the login instead of a broken screen.
  if (response.status === 401) {
    window.location.assign('/login');
    throw new ApiError('Sessão expirada. Entre novamente.', 401);
  }
  if (!response.ok) throw new ApiError(data?.error || 'Não foi possível concluir a ação.', response.status);
  return data as T;
}

/** GET with loading/error state and a reload function. */
export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) return;
    let active = true;
    setLoading(true);
    api<T>(path)
      .then((value) => {
        if (!active) return;
        setData(value);
        setError('');
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { data, error, loading, reload };
}

export type OrganizationStatusKey = 'provisioning' | 'active' | 'past_due' | 'suspended' | 'canceled';

export const ORGANIZATION_STATUS_LABELS: Record<OrganizationStatusKey, string> = {
  provisioning: 'Provisionando',
  active: 'Ativa',
  past_due: 'Em atraso',
  suspended: 'Suspensa',
  canceled: 'Cancelada',
};

export const CYCLE_LABELS: Record<string, string> = { monthly: 'Mensal', annual: 'Anual' };

export const ROLE_LABELS: Record<string, string> = { admin: 'Administrador', technician: 'Técnico' };

export const CHARGE_KIND_LABELS: Record<string, string> = {
  subscription: 'Mensalidade',
  setup: 'Implantação',
  one_off: 'Avulsa',
  credits: 'Créditos de IA',
};

/** Asaas payment status → the panel's vocabulary. */
export function chargeStatusLabel(status: string) {
  if (['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(status)) return 'Paga';
  if (status === 'OVERDUE') return 'Vencida';
  if (status === 'PENDING') return 'Pendente';
  if (status.startsWith('REFUND')) return 'Estornada';
  return 'Cancelada';
}

/**
 * Builds an organization's address on the domain the panel is served from (nextrotta.com.br, or
 * nextrotta.localhost:3000 in development). Read after mount: there's no window while rendering
 * on the server.
 */
export function useOrganizationHost() {
  const [rootHost, setRootHost] = useState('nextrotta.com.br');
  useEffect(() => setRootHost(window.location.host), []);
  return useCallback((slug: string) => `${slug}.${rootHost}`, [rootHost]);
}

export function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : 'Não foi possível concluir a ação.';
}

export const money = (value: number | string | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value ?? 0));

/** For fractions of a cent (price per credit, cost per answer): up to 4 decimals. */
export const preciseMoney = (value: number | string | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(value ?? 0));

/** "YYYY-MM-DD" or an ISO timestamp → dd/mm/aaaa (with time when asked), in Brasília. */
export function date(value: unknown, time = false) {
  if (!value || typeof value !== 'string') return '—';
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00-03:00` : value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    ...(time ? { timeStyle: 'short' as const } : {}),
  }).format(parsed);
}

export const slugify = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63);

export const AUDIT_LABELS: Record<string, string> = {
  'organization.created': 'Organização criada',
  'organization.updated': 'Dados da empresa alterados',
  'organization.suspend': 'Organização suspensa',
  'organization.reactivate': 'Organização reativada',
  'organization.cancel': 'Organização cancelada',
  'organization.provisioned': 'Provisionamento concluído',
  'organization.provisioning_failed': 'Falha no provisionamento',
  'organization.past_due': 'Pagamento em atraso',
  'organization.suspended_for_nonpayment': 'Suspensa por inadimplência',
  'organization.billing_regularized': 'Pagamento regularizado',
  'organization_settings.updated': 'Configurações da empresa alteradas',
  'user.created': 'Usuário criado',
  'user.updated': 'Usuário alterado',
  'subscription.created': 'Assinatura criada',
  'subscription.updated': 'Assinatura alterada',
  'billing.activated': 'Cobrança ativada no Asaas',
  'billing.canceled': 'Cobrança cancelada no Asaas',
  'impersonation.started': 'Dono entrou na conta',
  'impersonation.request': 'Ação do dono dentro da conta',
  'impersonation.ended': 'Dono saiu da conta',
  'plan.created': 'Plano criado',
  'plan.updated': 'Plano alterado',
};

export const auditLabel = (action: string) => AUDIT_LABELS[action] ?? action;
Object.assign(AUDIT_LABELS, {
  'account.password_changed': 'Senha do dono alterada',
  'account.updated': 'Dados do dono alterados',
  'platform_settings.updated': 'Configurações da plataforma alteradas',
  'coupon.created': 'Cupom criado',
  'coupon.updated': 'Cupom alterado',
  'coupon.archived': 'Cupom arquivado',
  'coupon.restored': 'Cupom restaurado',
  'coupon.applied': 'Cupom aplicado',
  'coupon.removed': 'Cupom removido',
  'coupon.expired': 'Cupom encerrado (fim dos ciclos)',
  'feature.created': 'Recurso criado',
  'feature.updated': 'Recurso alterado',
  'feature.archived': 'Recurso arquivado',
  'feature.restored': 'Recurso restaurado',
  'feature.granted': 'Recurso liberado',
  'feature.revoked': 'Recurso retirado',
  'feature.promoted': 'Recurso promovido a geral',
  'ai_package.created': 'Pacote de créditos criado',
  'ai_package.updated': 'Pacote de créditos alterado',
  'ai_package.archived': 'Pacote de créditos arquivado',
  'ai_package.restored': 'Pacote de créditos restaurado',
  'ai_credits.adjusted': 'Créditos de IA ajustados',
  'ai_credits.purchase_requested': 'Compra de créditos solicitada',
  'bug.updated': 'Relato de bug atualizado',
  'news.created': 'Novidade criada',
  'news.updated': 'Novidade alterada',
  'news.published': 'Novidade publicada',
  'news.archived': 'Novidade arquivada',
  'news.restored': 'Novidade restaurada',
  'site.draft_saved': 'Rascunho do site salvo',
  'site.published': 'Site publicado',
  'data.exported': 'Dados exportados',
  'data.restored': 'Registro restaurado da lixeira',
  'storage_container.created': 'Container de armazenamento criado',
  'storage_container.updated': 'Container de armazenamento alterado',
  'storage_container.archived': 'Container de armazenamento arquivado',
  'storage_container.assigned': 'Empresa colocada em container de armazenamento',
});
