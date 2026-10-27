import { sql } from '../db';
import { effectiveLimits, PLAN_FEATURES, type PlanLimits } from '../plans';
import { getPlatformSettings } from './settings';
import { getBlobUsage } from './blob-usage';
import { getDatabaseCapacity } from './database-plan';
import { formatMb, getStorageCapacity } from './vercel-plan';

/**
 * Operação → Capacidade: what the platform has against what the plans promised each organization,
 * so the owner never sells more than the infrastructure can deliver.
 *
 * - Data (files, database) is held for every organization that isn't deleted: suspended and canceled
 *   ones keep their data in read-only mode.
 * - Automations (Porto, WhatsApp, AI) only run for active or past-due organizations.
 * - An organization without a subscription has no limits (as in lib/billing/entitlements.ts).
 */

/** Night window of the Porto queue (23:00–06:00 Brasília), as in getNightCapacity(). */
const NIGHT_WINDOW_MINUTES = 7 * 60;
const MONTH_START = `date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`;
const MB = 1024 * 1024;

export type ResourceUnit = 'minutes' | 'mb' | 'messages' | 'money';

export interface CapacityResource {
  key: 'porto_night' | 'vps_memory' | 'storage' | 'database' | 'whatsapp' | 'ai';
  label: string;
  unit: ResourceUnit;
  /** What the platform has; null = unknown (not informed) or no shared ceiling. */
  capacity: number | null;
  /** Sum of the finite promises (or the projected need, for resources plans don't limit). */
  committed: number | null;
  /** Organizations promised "unlimited": their share can't be added up. */
  unlimited: number;
  /** Real usage now (this month for the monthly ones). */
  used: number;
  /** How the numbers were reached, shown under the resource. */
  note: string;
  /** Replaces the usual verdict (a blocked store, storage lots, a known reason for having no number). */
  status?: { tone: 'neutral' | 'warn' | 'bad'; text: string } | null;
}

export interface CapacityOrganization {
  id: string;
  name: string;
  slug: string;
  status: string;
  planName: string | null;
  runsAutomations: boolean;
  storage: { usedMb: number; limitMb: number | null };
  users: { active: number; limit: number | null };
  technicians: { active: number; included: number | null };
  whatsapp: { feature: boolean; connected: boolean; sentMonth: number; limitMonth: number | null };
  porto: {
    feature: boolean;
    automationEnabled: boolean;
    runsMonth: number;
    limitMonth: number | null;
    /** Measured average of the last 14 nights; null without history. */
    minutesPerNight: number | null;
    nightsMeasured: number;
    /** Estimate from the technicians (Configurações de capacidade), used while there's no history. */
    estimatedMinutes: number;
  };
  ai: { feature: boolean; monthlyCredits: number; creditsUsedMonth: number; costMonth: number };
}

const ALL_FEATURES = Object.keys(PLAN_FEATURES);

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export async function getCapacity() {
  const settings = await getPlatformSettings();
  const { capacity } = settings;
  // Technicians the organization has, or the ones its plan includes while it hasn't registered them.
  const estimateMinutes = (technicians: number) => round(capacity.portoBaseMinutes + capacity.portoMinutesPerTechnician * technicians);
  const [organizations, nights, memory, databaseCapacity, aiHistory, blob, storageCapacity] = await Promise.all([
    sql.query(`
      SELECT o.id, o.name, o.slug, o.status,
             (SELECT c.id FROM storage_containers c WHERE c.id = o.storage_container_id AND c.archived_at IS NULL) AS storage_container_id,
             s.organization_id IS NOT NULL AS subscribed, s.limit_overrides, s.included_technicians,
             p.name AS plan_name, p.features AS plan_features, s.modules AS plan_modules, p.max_users, p.storage_mb,
             p.whatsapp_messages_month, p.porto_runs_month, p.ai_monthly_credits,
             (SELECT COALESCE(array_agg(g.feature_key), '{}') FROM organization_features g
               WHERE g.organization_id = o.id AND g.revoked_at IS NULL) AS granted,
             (SELECT COUNT(*)::int FROM users u
               WHERE u.organization_id = o.id AND u.deleted_at IS NULL AND u.status = 'active') AS active_users,
             (SELECT COUNT(*)::int FROM technicians t
               WHERE t.organization_id = o.id AND t.deleted_at IS NULL AND t.status = 'active') AS active_technicians,
             (SELECT COALESCE(SUM(d.bytes), 0)::float FROM organization_files d
               WHERE d.organization_id = o.id) AS storage_bytes,
             (SELECT COUNT(*)::int FROM whatsapp_messages m
               WHERE m.organization_id = o.id AND m.status = 'sent' AND m.created_at >= ${MONTH_START}) AS whatsapp_month,
             (SELECT COUNT(*)::int FROM porto_sync_log l
               WHERE l.organization_id = o.id AND l.status NOT IN ('skipped', 'dry_run') AND l.started_at >= ${MONTH_START}) AS porto_runs_month_used,
             (SELECT COALESCE(-SUM(a.quantity), 0)::int FROM ai_credit_ledger a
               WHERE a.organization_id = o.id AND a.kind = 'consumption' AND a.created_at >= ${MONTH_START}) AS ai_credits_used,
             (SELECT COALESCE(SUM(a.cost), 0)::float FROM ai_credit_ledger a
               WHERE a.organization_id = o.id AND a.kind = 'consumption' AND a.created_at >= ${MONTH_START}) AS ai_cost_month,
             w.instance_name IS NOT NULL AND w.connection_state = 'connected' AS whatsapp_connected,
             COALESCE(pc.automation_enabled, false) AS porto_automation
      FROM organizations o
      LEFT JOIN subscriptions s ON s.organization_id = o.id AND s.canceled_at IS NULL
      LEFT JOIN plans p ON p.id = s.plan_id
      LEFT JOIN whatsapp_config w ON w.organization_id = o.id
      LEFT JOIN porto_config pc ON pc.organization_id = o.id
      WHERE o.deleted_at IS NULL
      ORDER BY o.name
    `),
    // Automatic runs of the last 14 nights; a night runs from 07:00 to 07:00 so 23:00–06:00 stays together.
    sql`
      SELECT organization_id,
             SUM(duration_ms)::float / 60000 / COUNT(DISTINCT night) AS minutes_per_night,
             COUNT(DISTINCT night)::int AS nights
      FROM (
        SELECT organization_id, duration_ms,
               (started_at AT TIME ZONE 'America/Sao_Paulo' - INTERVAL '7 hours')::date AS night
        FROM porto_sync_log
        WHERE COALESCE(run_trigger, 'auto') = 'auto' AND duration_ms IS NOT NULL
          AND started_at > NOW() - INTERVAL '14 days'
      ) runs
      GROUP BY organization_id
    `,
    // Typical memory in use over the last day (the median, so one heavy moment doesn't skew it).
    sql`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY memory_total_bytes - memory_available_bytes)::float AS used,
             MAX(memory_total_bytes)::float AS total
      FROM vps_metrics
      WHERE collected_at > NOW() - INTERVAL '24 hours'
    `,
    getDatabaseCapacity(),
    // What one AI credit really costs, from the last 90 days of answers.
    sql`
      SELECT COALESCE(SUM(cost), 0)::float AS cost, COALESCE(-SUM(quantity), 0)::float AS credits
      FROM ai_credit_ledger
      WHERE kind = 'consumption' AND created_at > NOW() - INTERVAL '90 days'
    `,
    getBlobUsage(),
    getStorageCapacity(),
  ]);

  const nightByOrganization = new Map(
    nights.map((row) => [String(row.organization_id), { minutes: Number(row.minutes_per_night), nights: Number(row.nights) }]),
  );

  const assigned = new Set(organizations.filter((row) => row.storage_container_id).map((row) => String(row.id)));

  const rows: CapacityOrganization[] = organizations.map((row) => {
    const id = String(row.id);
    const subscribed = Boolean(row.subscribed);
    const granted = (Array.isArray(row.granted) ? row.granted : []).map(String);
    const planFeatures = [
      ...(Array.isArray(row.plan_features) ? row.plan_features : []).map(String),
      ...(Array.isArray(row.plan_modules) ? row.plan_modules : []).map((module: { key?: unknown }) => String(module.key)),
    ];
    const features = new Set(subscribed ? [...planFeatures, ...granted] : [...ALL_FEATURES, ...granted]);
    const planLimits: PlanLimits = {
      maxUsers: row.max_users === null ? null : Number(row.max_users),
      storageMb: row.storage_mb === null ? null : Number(row.storage_mb),
      whatsappMessagesMonth: row.whatsapp_messages_month === null ? null : Number(row.whatsapp_messages_month),
      portoRunsMonth: row.porto_runs_month === null ? null : Number(row.porto_runs_month),
    };
    const limits = subscribed
      ? effectiveLimits(planLimits, row.limit_overrides as Partial<PlanLimits>)
      : { maxUsers: null, storageMb: null, whatsappMessagesMonth: null, portoRunsMonth: null };
    const night = nightByOrganization.get(id) ?? null;
    const technicians = Math.max(Number(row.active_technicians), subscribed ? Number(row.included_technicians ?? 0) : 0);
    return {
      id,
      name: String(row.name),
      slug: String(row.slug),
      status: String(row.status),
      planName: subscribed ? String(row.plan_name) : null,
      runsAutomations: row.status === 'active' || row.status === 'past_due',
      storage: { usedMb: round(Number(row.storage_bytes) / MB), limitMb: limits.storageMb },
      users: { active: Number(row.active_users), limit: limits.maxUsers },
      technicians: { active: Number(row.active_technicians), included: subscribed ? Number(row.included_technicians) : null },
      whatsapp: {
        feature: features.has('whatsapp'),
        connected: Boolean(row.whatsapp_connected),
        sentMonth: Number(row.whatsapp_month),
        limitMonth: limits.whatsappMessagesMonth,
      },
      porto: {
        feature: features.has('porto'),
        automationEnabled: Boolean(row.porto_automation),
        runsMonth: Number(row.porto_runs_month_used),
        limitMonth: limits.portoRunsMonth,
        minutesPerNight: night ? round(night.minutes) : null,
        nightsMeasured: night?.nights ?? 0,
        estimatedMinutes: estimateMinutes(technicians),
      },
      ai: {
        feature: features.has('ai'),
        monthlyCredits: features.has('ai') && subscribed ? Number(row.ai_monthly_credits ?? 0) : 0,
        creditsUsedMonth: Number(row.ai_credits_used),
        costMonth: round(Number(row.ai_cost_month), 2),
      },
    };
  });

  const active = rows.filter((row) => row.runsAutomations);

  // Porto: every active organization with the feature takes its measured minutes (or the estimate).
  const portoOrganizations = active.filter((row) => row.porto.feature);
  const portoCommitted = portoOrganizations.reduce((sum, row) => sum + (row.porto.minutesPerNight ?? row.porto.estimatedMinutes), 0);
  const portoUsed = active.reduce((sum, row) => sum + (row.porto.minutesPerNight ?? 0), 0);
  const portoCapacity = NIGHT_WINDOW_MINUTES * settings.porto.maxBrowsers;
  const portoMeasured = portoOrganizations.filter((row) => row.porto.minutesPerNight !== null).length;
  // Room for more: at the average of today's organizations (or one with 10 technicians, when there's none).
  const typicalMinutes = portoOrganizations.length ? portoCommitted / portoOrganizations.length : estimateMinutes(10);
  const portoRoom = typicalMinutes > 0 ? Math.max(0, Math.floor((portoCapacity - portoCommitted) / typicalMinutes)) : 0;

  // VPS memory: the typical use plus every Porto browser open at once at night.
  const memoryTotal = Number(memory[0]?.total ?? 0);
  const memoryUsed = Number(memory[0]?.used ?? 0);
  const browsersPeak = settings.porto.maxBrowsers * capacity.browserMemoryMb;

  // Files: what the plans promise (finite part) against the contracted storage.
  const storagePromised = rows.reduce((sum, row) => sum + (row.storage.limitMb ?? 0), 0);
  const storageUnlimited = rows.filter((row) => row.storage.limitMb === null).length;
  // In use: measured in the Blob store itself when possible (it holds every file, archived ones too);
  // otherwise the sizes recorded in the library.
  const storageMeasured = blob.configured && blob.ok;
  const storageUsed = storageMeasured ? blob.bytes / MB : rows.reduce((sum, row) => sum + row.storage.usedMb, 0);
  const containers = await sql`
    SELECT COUNT(*)::int AS count, COALESCE(SUM(size_mb), 0)::float AS size_mb,
           COALESCE(SUM(floor(size_mb * (1 - reserve_percent / 100))), 0)::float AS usable_mb
    FROM storage_containers WHERE archived_at IS NULL
  `;
  const containerCount = Number(containers[0]?.count ?? 0);
  const containerSizeMb = Number(containers[0]?.size_mb ?? 0);
  const containerUsableMb = Number(containers[0]?.usable_mb ?? 0);
  const outsideContainers = rows.filter((row) => !assigned.has(row.id)).length;

  // The total: the owner's fixed value, else the lots (what the owner planned), else the Hobby allowance.
  const hobby = storageCapacity.hobby;
  const storageTotal = storageCapacity.ownerMb ?? (containerCount ? containerSizeMb : null) ?? hobby?.roomMb ?? null;
  const storagePeak = Math.max(storagePromised, storageUsed);
  const storageStatus: CapacityResource['status'] = storageCapacity.blocked
    ? { tone: 'bad', text: 'Blob bloqueado pela Vercel' }
    : hobby && storageTotal !== hobby.roomMb
      ? { tone: storagePeak > hobby.roomMb ? 'bad' : 'warn', text: `Vercel Hobby: teto real de ${formatMb(hobby.roomMb)}` }
      : storageCapacity.ownerMb === null && containerCount
        ? { tone: 'neutral', text: `${containerCount} container(s) · ${formatMb(containerSizeMb)}` }
        : storageTotal === null && storageCapacity.plan === 'pro'
          ? { tone: 'neutral', text: 'Sem teto (Pro, cobrado por uso)' }
          : null;

  const storageNotes: string[] = [];
  if (storageCapacity.ownerMb !== null) storageNotes.push(`Teto fixo informado por você: ${formatMb(storageCapacity.ownerMb)}.`);
  if (containerCount) {
    storageNotes.push(
      `${containerCount} container(s) de armazenamento: ${formatMb(containerSizeMb)}, ${formatMb(containerUsableMb)} para as empresas (o resto é folga). ` +
        (outsideContainers ? `${outsideContainers} empresa(s) sem container. ` : '') +
        'Detalhes e transferências em Operação → Armazenamento.',
    );
  } else {
    storageNotes.push('Nenhum container de armazenamento: crie em Operação → Armazenamento.');
  }
  if (storageCapacity.blocked) storageNotes.push(`Blob bloqueado: ${storageCapacity.blocked}; os envios de arquivo não funcionam.`);
  if (hobby) {
    storageNotes.push(
      `A conta da Vercel está no Hobby: 1 GB para a conta inteira` +
        (hobby.othersCount ? `, e outros ${hobby.othersCount} projeto(s) já usam ${formatMb(hobby.othersMb)}` : '') +
        `. Sobram ${formatMb(hobby.roomMb)}; passando de 1 GB, o Blob para em todos os projetos por 30 dias.` +
        (storageTotal !== hobby.roomMb ? ' Passe a conta para o Pro para valer o total acima.' : ''),
    );
  } else if (storageCapacity.plan === 'pro') {
    storageNotes.push('Conta da Vercel no Pro: sem teto, cobrado pelo uso.');
  } else if (storageCapacity.plan === 'enterprise') {
    storageNotes.push('Conta da Vercel no Enterprise: informe o contratado em "Definir capacidades".');
  }
  if (storageCapacity.error) storageNotes.push(`Não foi possível ler a conta da Vercel (${storageCapacity.error}).`);
  if (storageTotal === null && !storageCapacity.plan) {
    storageNotes.push('Defina lotes ou um teto em "Definir capacidades" (ou configure VERCEL_API_TOKEN para ler o plano da Vercel).');
  }
  if (storageCapacity.farRegion) storageNotes.push(`A loja está na região ${storageCapacity.farRegion}, longe do Brasil (gru1 é São Paulo).`);
  storageNotes.push(
    !blob.configured
      ? 'BLOB_READ_WRITE_TOKEN não configurado: a biblioteca não recebe arquivos.'
      : storageMeasured
        ? `Em uso medido no Vercel Blob (${blob.files.toLocaleString('pt-BR')} arquivo(s)).`
        : 'Em uso pela soma registrada na biblioteca (o Vercel Blob não respondeu).',
  );

  // Database: plans don't limit it; the projection is the average per organization times all of them.
  const databaseMb = databaseCapacity.usedMb;
  const databaseAverage = rows.length ? databaseMb / rows.length : 0;
  const databaseRoom =
    databaseCapacity.limitMb !== null && databaseAverage > 0 ? Math.max(0, Math.floor((databaseCapacity.limitMb - databaseMb) / databaseAverage)) : null;
  const databaseSource =
    databaseCapacity.source === 'owner'
      ? 'Limite informado por você em "Definir capacidades".'
      : databaseCapacity.source === 'neon'
        ? `Limite lido do próprio Neon${databaseCapacity.planName ? ` (plano ${databaseCapacity.planName}, pela Vercel` + (databaseCapacity.computeTime ? `; computação: ${databaseCapacity.computeTime}` : '') + ')' : ''}.`
        : 'O Neon não informou o limite: informe-o em "Definir capacidades".';

  const whatsappOrganizations = active.filter((row) => row.whatsapp.feature);

  const aiOrganizations = active.filter((row) => row.ai.feature);
  const aiPromisedCredits = aiOrganizations.reduce((sum, row) => sum + row.ai.monthlyCredits, 0);
  const historyCredits = Number(aiHistory[0]?.credits ?? 0);
  const costPerCredit = historyCredits > 0 ? Number(aiHistory[0].cost) / historyCredits : null;
  const aiCostMonth = rows.reduce((sum, row) => sum + row.ai.costMonth, 0);
  const aiCreditsUsed = rows.reduce((sum, row) => sum + row.ai.creditsUsedMonth, 0);

  const resources: CapacityResource[] = [
    {
      key: 'porto_night',
      label: 'Janela noturna do Porto',
      unit: 'minutes',
      capacity: portoCapacity,
      committed: round(portoCommitted),
      unlimited: 0,
      used: round(portoUsed),
      note:
        `${settings.porto.maxBrowsers} navegador(es) × 7 h (23:00–06:00). ${portoOrganizations.length} empresa(s) com o Porto no plano: ` +
        `${portoMeasured} com tempo medido nas últimas 14 noites; as demais pela estimativa de ${capacity.portoBaseMinutes} min + ` +
        `${capacity.portoMinutesPerTechnician.toLocaleString('pt-BR')} min por técnico. Cabem mais ~${portoRoom} empresa(s) do tamanho médio de hoje ` +
        `(${round(typicalMinutes).toLocaleString('pt-BR')} min por noite).`,
    },
    {
      key: 'vps_memory',
      label: 'Memória da VPS no pico da noite',
      unit: 'mb',
      capacity: memoryTotal ? round(memoryTotal / MB, 0) : null,
      committed: memoryTotal ? round((memoryUsed / MB) + browsersPeak, 0) : null,
      unlimited: 0,
      used: round(memoryUsed / MB, 0),
      note: memoryTotal
        ? `Uso típico das últimas 24 h (WhatsApp, workers, agente) + ${settings.porto.maxBrowsers} navegador(es) do Porto × ${capacity.browserMemoryMb} MB. O cache de disco não conta: o sistema o devolve quando precisa.`
        : 'Sem métricas da VPS nas últimas 24 h (o worker grava a cada 5 min).',
    },
    {
      key: 'storage',
      label: 'Armazenamento de arquivos',
      unit: 'mb',
      capacity: storageTotal,
      status: storageStatus,
      committed: round(storagePromised),
      unlimited: storageUnlimited,
      used: round(storageUsed),
      note: storageNotes.join(' '),
    },
    {
      key: 'database',
      label: 'Banco de dados',
      unit: 'mb',
      capacity: databaseCapacity.limitMb,
      status: databaseCapacity.quotaExceeded ? { tone: 'bad', text: 'Neon: cota excedida' } : null,
      committed: null,
      unlimited: 0,
      used: round(databaseMb),
      note:
        `Os planos não limitam o banco. Hoje: ${round(databaseAverage).toLocaleString('pt-BR')} MB em média por empresa` +
        (databaseRoom !== null ? ` (cabem ~${databaseRoom.toLocaleString('pt-BR')} empresa(s) a mais nesse ritmo). ` : '. ') +
        databaseSource,
    },
    {
      key: 'whatsapp',
      label: 'Mensagens de WhatsApp no mês',
      unit: 'messages',
      capacity: null,
      status: { tone: 'neutral', text: 'Ilimitado em todos os planos' },
      committed: null,
      unlimited: 0,
      used: rows.reduce((sum, row) => sum + row.whatsapp.sentMonth, 0),
      note:
        `Cada empresa envia pelo próprio número, sem limite de mensagens. ${whatsappOrganizations.length} empresa(s) com WhatsApp no plano, ` +
        `${rows.filter((row) => row.whatsapp.connected).length} número(s) conectado(s). A plataforma banca a memória do Evolution, já dentro da memória da VPS.`,
    },
    {
      key: 'ai',
      label: 'Gasto com IA no mês',
      unit: 'money',
      capacity: capacity.aiMonthlyBudget,
      committed: costPerCredit === null ? null : round(aiPromisedCredits * costPerCredit, 2),
      unlimited: 0,
      used: round(aiCostMonth, 2),
      note:
        `${aiPromisedCredits.toLocaleString('pt-BR')} crédito(s) por mês prometidos pelos planos a ${aiOrganizations.length} empresa(s); ` +
        `${aiCreditsUsed.toLocaleString('pt-BR')} usados neste mês. ` +
        (costPerCredit === null
          ? 'O custo previsto aparece quando houver respostas nos últimos 90 dias.'
          : `Previsto pelo custo real de cada crédito nos últimos 90 dias (R$ ${costPerCredit.toFixed(4).replace('.', ',')}).`) +
        (capacity.aiMonthlyBudget === null ? ' Informe o orçamento mensal em "Definir capacidades".' : ''),
    },
  ];

  return {
    resources,
    organizations: rows,
    totals: {
      organizations: rows.length,
      runningAutomations: active.length,
      withPorto: portoOrganizations.length,
      portoRoom,
    },
    settings: capacity,
    maxBrowsers: settings.porto.maxBrowsers,
  };
}
