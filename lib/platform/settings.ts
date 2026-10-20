// Relative imports only: also compiled into the VPS worker (worker/tsconfig.json).
import { recordAudit } from '../audit';
import type { StorageLotSettings } from './storage-containers';
import { sql } from '../db';
import { PlatformError, type Actor } from './errors';

export interface PlatformSettings {
  /** Grace days given to new subscriptions before a past-due organization is suspended. */
  defaultGraceDays: number;
  /** Days a suspended/canceled organization can still view its data before only downloading it. */
  readOnlyDays: number;
  /** Extra subdomains no organization may take (the fixed ones are in lib/tenant-host.ts). */
  reservedSubdomains: string[];
  /** Shown to every organization's users while on. */
  maintenance: { enabled: boolean; message: string };
  /** What the AI provider charges (R$ per million tokens) and how many credits one question costs. */
  /**
   * lowBalanceAlert: warn the owner when the DeepSeek balance goes under it (provider currency); null = only when it runs out.
   * targetMarginPercent: share of what the customer pays for credits that stays with the owner; sets the minimum price per credit.
   */
  ai: {
    inputCostPerMillion: number;
    outputCostPerMillion: number;
    creditsPerUse: number;
    lowBalanceAlert: number | null;
    targetMarginPercent: number | null;
  };
  /** Porto robot on the shared VPS: how many browsers may run at once across all organizations. */
  porto: { maxBrowsers: number };
  /**
   * Platform alerts to the owner (Porto screens changed, stuck run, late night queue, VPS):
   * WhatsApp number and the platform's own Evolution instance (lib/platform/alerts.ts).
   */
  alerts: { phone: string; instanceName: string };
  /**
   * VPS maintenance: the daily automatic cleanup by the VPS agent (lib/platform/vps.ts). Off until
   * the owner compared its preview with what the old cleanup script did.
   */
  vps: { autoCleanup: boolean };
  /**
   * What the platform has to hand out, for Operação → Capacidade (lib/platform/capacity.ts). The
   * quotas contracted outside the VPS can't be read automatically, so the owner informs them (null =
   * not informed). The two estimates size the Porto night and the VPS memory peak.
   */
  capacity: {
    /** A fixed ceiling for file storage (Vercel Blob), in GB; null = lots / the Vercel plan decide. */
    storageGb: number | null;
    /** Size and reserve of the storage containers opened automatically (lib/platform/storage-containers.ts); null = none. */
    storageLot: StorageLotSettings | null;
    /** Database plan (Neon), in GB. */
    databaseGb: number | null;
    /** What the owner accepts to spend on the AI provider per month, in R$. */
    aiMonthlyBudget: number | null;
    /**
     * Browser minutes per night assumed for an organization with the Porto and no history yet:
     * base + per technician. Measured live on 2026-10-05 (12 technicians): the hours job takes ~2 min
     * per day and reprocesses 2 days; the schedule job opens each technician for ~68 s.
     */
    portoBaseMinutes: number;
    portoMinutesPerTechnician: number;
    /** Memory one Porto browser takes while it runs, in MB. */
    browserMemoryMb: number;
    /**
     * Totals the owner distributes among organizations (Operação → Capacidade → Distribuir recursos),
     * besides storage (storageGb). null = no total: allocations aren't capped.
     */
    pools: { whatsappMessagesMonth: number | null; portoRunsMonth: number | null; maxUsers: number | null };
  };
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  defaultGraceDays: 7,
  readOnlyDays: 90,
  reservedSubdomains: [],
  maintenance: { enabled: false, message: '' },
  ai: { inputCostPerMillion: 0, outputCostPerMillion: 0, creditsPerUse: 1, lowBalanceAlert: null, targetMarginPercent: null },
  porto: { maxBrowsers: 2 },
  alerts: { phone: '', instanceName: '' },
  vps: { autoCleanup: false },
  capacity: { storageGb: null, storageLot: null, databaseGb: null, aiMonthlyBudget: null, portoBaseMinutes: 4, portoMinutesPerTechnician: 1.2, browserMemoryMb: 800, pools: { whatsappMessagesMonth: null, portoRunsMonth: null, maxUsers: null } },
};

/** Measured on the VPS (2 cores, 12 GB, no swap): more browsers at once risk the memory and Porto blocking the IP. */
export const MAX_PORTO_BROWSERS = 4;

function merge(stored: Partial<PlatformSettings> | null | undefined): PlatformSettings {
  const data = stored ?? {};
  return {
    defaultGraceDays: data.defaultGraceDays ?? DEFAULT_PLATFORM_SETTINGS.defaultGraceDays,
    readOnlyDays: data.readOnlyDays ?? DEFAULT_PLATFORM_SETTINGS.readOnlyDays,
    reservedSubdomains: Array.isArray(data.reservedSubdomains) ? data.reservedSubdomains : [],
    maintenance: { ...DEFAULT_PLATFORM_SETTINGS.maintenance, ...(data.maintenance ?? {}) },
    ai: { ...DEFAULT_PLATFORM_SETTINGS.ai, ...(data.ai ?? {}) },
    porto: { ...DEFAULT_PLATFORM_SETTINGS.porto, ...(data.porto ?? {}) },
    alerts: { ...DEFAULT_PLATFORM_SETTINGS.alerts, ...(data.alerts ?? {}) },
    vps: { ...DEFAULT_PLATFORM_SETTINGS.vps, ...(data.vps ?? {}) },
    capacity: {
      ...DEFAULT_PLATFORM_SETTINGS.capacity,
      ...(data.capacity ?? {}),
      pools: { ...DEFAULT_PLATFORM_SETTINGS.capacity.pools, ...(data.capacity?.pools ?? {}) },
    },
  };
}

export async function getPlatformSettings(): Promise<PlatformSettings & { updatedAt: string | null }> {
  const rows = await sql`SELECT data, updated_at FROM platform_settings WHERE id`;
  return { ...merge(rows[0]?.data as Partial<PlatformSettings>), updatedAt: rows[0] ? new Date(rows[0].updated_at).toISOString() : null };
}

function nonNegative(value: unknown, label: string, integer = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed))) {
    throw new PlatformError(`${label}: informe ${integer ? 'um número inteiro' : 'um número'} maior ou igual a zero.`);
  }
  return parsed;
}

const SLUG_LIKE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Partial update: only the sections present in `input` change. */
export async function updatePlatformSettings(input: Record<string, unknown>, actor: Actor) {
  const current = await getPlatformSettings();
  const next: PlatformSettings = {
    defaultGraceDays: current.defaultGraceDays,
    readOnlyDays: current.readOnlyDays,
    reservedSubdomains: current.reservedSubdomains,
    maintenance: current.maintenance,
    ai: current.ai,
    porto: current.porto,
    alerts: current.alerts,
    vps: current.vps,
    capacity: current.capacity,
  };

  if ('defaultGraceDays' in input) next.defaultGraceDays = nonNegative(input.defaultGraceDays, 'Carência padrão', true);
  if ('readOnlyDays' in input) next.readOnlyDays = nonNegative(input.readOnlyDays, 'Dias de consulta após suspensão', true);

  if ('reservedSubdomains' in input) {
    const raw = Array.isArray(input.reservedSubdomains) ? input.reservedSubdomains : String(input.reservedSubdomains ?? '').split(/[,\s]+/);
    const list = Array.from(new Set(raw.map((item) => String(item).trim().toLowerCase()).filter(Boolean)));
    const invalid = list.find((item) => !SLUG_LIKE.test(item));
    if (invalid) throw new PlatformError(`“${invalid}” não é um subdomínio válido.`);
    next.reservedSubdomains = list;
  }

  if ('maintenance' in input) {
    const maintenance = (input.maintenance ?? {}) as Record<string, unknown>;
    const enabled = Boolean(maintenance.enabled);
    const message = String(maintenance.message ?? '').trim();
    if (enabled && !message) throw new PlatformError('Escreva a mensagem que os clientes verão durante a manutenção.');
    next.maintenance = { enabled, message };
  }

  if ('ai' in input) {
    const ai = (input.ai ?? {}) as Record<string, unknown>;
    const creditsPerUse = nonNegative(ai.creditsPerUse, 'Créditos por uso', true);
    if (creditsPerUse < 1) throw new PlatformError('Créditos por uso: pelo menos 1.');
    next.ai = {
      inputCostPerMillion: nonNegative(ai.inputCostPerMillion, 'Custo de entrada'),
      outputCostPerMillion: nonNegative(ai.outputCostPerMillion, 'Custo de saída'),
      creditsPerUse,
      lowBalanceAlert:
        'lowBalanceAlert' in ai
          ? ai.lowBalanceAlert === null || ai.lowBalanceAlert === '' || ai.lowBalanceAlert === undefined
            ? null
            : nonNegative(ai.lowBalanceAlert, 'Aviso de saldo baixo')
          : current.ai.lowBalanceAlert,
      targetMarginPercent: (() => {
        if (!('targetMarginPercent' in ai)) return current.ai.targetMarginPercent;
        if (ai.targetMarginPercent === null || ai.targetMarginPercent === '' || ai.targetMarginPercent === undefined) return null;
        const margin = nonNegative(ai.targetMarginPercent, 'Margem desejada');
        if (margin >= 95) throw new PlatformError('Margem desejada: menos de 95%.');
        return margin;
      })(),
    };
  }

  if ('porto' in input) {
    const porto = (input.porto ?? {}) as Record<string, unknown>;
    const maxBrowsers = nonNegative(porto.maxBrowsers, 'Navegadores do Porto ao mesmo tempo', true);
    if (maxBrowsers < 1 || maxBrowsers > MAX_PORTO_BROWSERS) {
      throw new PlatformError(`Navegadores do Porto ao mesmo tempo: de 1 a ${MAX_PORTO_BROWSERS}.`);
    }
    next.porto = { maxBrowsers };
  }

  if ('alerts' in input) {
    const alerts = (input.alerts ?? {}) as Record<string, unknown>;
    const phone = String(alerts.phone ?? '').replace(/\D/g, '');
    if (phone && (phone.length < 10 || phone.length > 13)) {
      throw new PlatformError('WhatsApp para alertas da plataforma: informe DDD e número (ou deixe vazio).');
    }
    // The instance itself is created from the alerts WhatsApp card (lib/platform/alerts.ts); only its
    // number is edited here, the name is kept.
    next.alerts = { phone, instanceName: current.alerts.instanceName };
  }

  if ('vps' in input) {
    const vps = (input.vps ?? {}) as Record<string, unknown>;
    next.vps = { autoCleanup: vps.autoCleanup === true };
  }

  if ('capacity' in input) {
    const capacity = (input.capacity ?? {}) as Record<string, unknown>;
    const optional = (value: unknown, label: string, integer = false) =>
      value === null || value === undefined || value === '' ? null : nonNegative(value, label, integer);
    const pools = (capacity.pools ?? current.capacity.pools) as Record<string, unknown>;
    const portoBase = nonNegative(capacity.portoBaseMinutes, 'Minutos do Porto por empresa');
    const portoPerTechnician = nonNegative(capacity.portoMinutesPerTechnician, 'Minutos do Porto por técnico');
    const browserMemory = nonNegative(capacity.browserMemoryMb, 'Memória por navegador', true);
    if (portoBase + portoPerTechnician <= 0) throw new PlatformError('Informe quanto tempo do Porto uma empresa leva por noite.');
    if (browserMemory < 100) throw new PlatformError('Memória por navegador: pelo menos 100 MB.');
    let storageLot = current.capacity.storageLot;
    if ('storageLot' in capacity) {
      const lot = (capacity.storageLot ?? null) as Record<string, unknown> | null;
      const sizeGb = lot ? optional(lot.sizeGb, 'Tamanho do lote') : null;
      if (sizeGb === null) storageLot = null;
      else {
        const reservePercent = optional(lot?.reservePercent, 'Folga do lote') ?? 0;
        if (sizeGb < 1) throw new PlatformError('Tamanho do lote: pelo menos 1 GB.');
        if (reservePercent >= 50) throw new PlatformError('Folga do lote: menos de 50%.');
        storageLot = { sizeGb, reservePercent };
      }
    }
    next.capacity = {
      storageGb: optional(capacity.storageGb, 'Armazenamento contratado'),
      storageLot,
      databaseGb: optional(capacity.databaseGb, 'Banco de dados contratado'),
      aiMonthlyBudget: optional(capacity.aiMonthlyBudget, 'Orçamento mensal de IA'),
      portoBaseMinutes: portoBase,
      portoMinutesPerTechnician: portoPerTechnician,
      browserMemoryMb: browserMemory,
      pools: {
        whatsappMessagesMonth: optional(pools.whatsappMessagesMonth, 'Total de mensagens de WhatsApp por mês', true),
        portoRunsMonth: optional(pools.portoRunsMonth, 'Total de execuções do Porto por mês', true),
        maxUsers: optional(pools.maxUsers, 'Total de usuários', true),
      },
    };
  }

  await sql`
    UPDATE platform_settings
    SET data = ${JSON.stringify(next)}::jsonb, updated_at = NOW(), updated_by = ${actor.id}
    WHERE id
  `;

  const before = {
    defaultGraceDays: current.defaultGraceDays,
    readOnlyDays: current.readOnlyDays,
    reservedSubdomains: current.reservedSubdomains,
    maintenance: current.maintenance,
    ai: current.ai,
    porto: current.porto,
    alerts: current.alerts,
    vps: current.vps,
    capacity: current.capacity,
  };
  await recordAudit({
    organizationId: null,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'platform_settings.updated',
    targetType: 'platform_settings',
    targetId: null,
    details: { before, after: next, reason: typeof input.reason === 'string' ? input.reason : null },
  });

  return getPlatformSettings();
}

/** The maintenance notice organizations see, or null. */
export async function getMaintenanceNotice() {
  const settings = await getPlatformSettings();
  return settings.maintenance.enabled ? settings.maintenance.message : null;
}
