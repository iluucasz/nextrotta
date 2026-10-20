import { asaasEnvironment, getBalance } from '../billing/asaas';
import { sql } from '../db';
import { mercadoPagoMissingConfig } from '../mercadopago/config';
import { getPlatformSettings } from './settings';

/** The worker beats every minute; three missed beats and it's shown offline. */
const OFFLINE_AFTER_MS = 3 * 60 * 1000;

function iso(value: unknown) {
  return value ? new Date(value as string).toISOString() : null;
}

/** Worker health, recent job runs, WhatsApp/automation/storage per organization and database size. */
export async function getOperations() {
  const [heartbeats, runs, organizations, database, settings] = await Promise.all([
    sql`SELECT * FROM worker_heartbeats ORDER BY last_seen_at DESC`,
    sql`
      SELECT * FROM (
        SELECT l.id::text, ('porto_' || l.job_type) AS job, l.organization_id, o.name AS organization_name,
               l.started_at, l.finished_at, l.status, l.error_message AS error
        FROM porto_sync_log l JOIN organizations o ON o.id = l.organization_id
        UNION ALL
        SELECT r.id::text, r.job, r.organization_id, o.name, r.started_at, r.finished_at, r.status, r.error
        FROM worker_runs r LEFT JOIN organizations o ON o.id = r.organization_id
      ) runs
      ORDER BY started_at DESC
      LIMIT 200
    `,
    sql`
      SELECT o.id, o.name, o.slug, o.status,
        COALESCE(w.enabled, FALSE) AS whatsapp_enabled,
        w.instance_name AS whatsapp_instance, w.connection_state AS whatsapp_state, w.connected_number AS whatsapp_number,
        COALESCE(p.automation_enabled, FALSE) AS porto_enabled,
        (p.cpf IS NOT NULL AND p.encrypted_password IS NOT NULL) AS porto_configured,
        p.last_error AS porto_last_error,
        (SELECT COUNT(*)::int FROM whatsapp_messages m
          WHERE m.organization_id = o.id AND m.status = 'sent'
            AND m.created_at >= date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS whatsapp_month,
        (SELECT COALESCE(SUM(d.bytes), 0)::float / (1024 * 1024) FROM organization_files d WHERE d.organization_id = o.id) AS storage_mb
      FROM organizations o
      LEFT JOIN whatsapp_config w ON w.organization_id = o.id
      LEFT JOIN porto_config p ON p.organization_id = o.id
      WHERE o.deleted_at IS NULL
      ORDER BY o.name
    `,
    sql`SELECT pg_database_size(current_database())::float AS bytes`,
    getPlatformSettings(),
  ]);

  const now = Date.now();
  const workers = heartbeats.map((row) => ({
    id: String(row.worker_id),
    version: (row.version as string | null) ?? null,
    startedAt: iso(row.started_at)!,
    lastSeenAt: iso(row.last_seen_at)!,
    online: now - new Date(row.last_seen_at).getTime() < OFFLINE_AFTER_MS,
  }));

  return {
    workers,
    runs: runs.map((row) => ({
      id: String(row.id),
      job: String(row.job),
      organizationId: (row.organization_id as string | null) ?? null,
      organizationName: (row.organization_name as string | null) ?? null,
      startedAt: iso(row.started_at)!,
      finishedAt: iso(row.finished_at),
      durationSeconds: row.finished_at ? Math.round((new Date(row.finished_at).getTime() - new Date(row.started_at).getTime()) / 1000) : null,
      status: String(row.status),
      error: (row.error as string | null) ?? null,
    })),
    organizations: organizations.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      status: String(row.status),
      whatsappEnabled: Boolean(row.whatsapp_enabled),
      whatsappInstance: (row.whatsapp_instance as string | null) ?? null,
      whatsappState: (row.whatsapp_state as string | null) ?? null,
      whatsappNumber: (row.whatsapp_number as string | null) ?? null,
      whatsappMonth: Number(row.whatsapp_month),
      portoEnabled: Boolean(row.porto_enabled),
      portoConfigured: Boolean(row.porto_configured),
      portoLastError: (row.porto_last_error as string | null) ?? null,
      storageMb: Math.round(Number(row.storage_mb) * 10) / 10,
    })),
    databaseMb: Math.round((Number(database[0].bytes) / (1024 * 1024)) * 10) / 10,
    maintenance: settings.maintenance,
    // Backups need external storage (phase of the backup routine); until it's configured there are none.
    backupsConfigured: Boolean(process.env.BACKUP_STORAGE_URL),
  };
}

type IntegrationStatus = { name: string; state: 'ok' | 'error' | 'missing'; detail: string };

/** Real status of each external service the platform depends on. */
export async function getIntegrationsStatus(): Promise<IntegrationStatus[]> {
  const result: IntegrationStatus[] = [];

  if (!process.env.ASAAS_API_KEY) {
    result.push({ name: 'Gateway Asaas', state: 'missing', detail: 'Falta ASAAS_API_KEY no ambiente.' });
  } else {
    try {
      await getBalance();
      result.push({ name: 'Gateway Asaas', state: 'ok', detail: asaasEnvironment() === 'production' ? 'Produção' : 'Sandbox (teste)' });
    } catch (error) {
      result.push({ name: 'Gateway Asaas', state: 'error', detail: error instanceof Error ? error.message : 'Falha ao consultar o Asaas.' });
    }
  }

  const lastWebhook = (await sql`SELECT MAX(received_at) AS last FROM billing_webhook_events`)[0]?.last;
  result.push(
    !process.env.ASAAS_WEBHOOK_TOKEN
      ? { name: 'Webhook de cobrança', state: 'missing', detail: 'Falta ASAAS_WEBHOOK_TOKEN no ambiente.' }
      : {
          name: 'Webhook de cobrança',
          state: lastWebhook ? 'ok' : 'error',
          detail: lastWebhook
            ? `Último evento: ${new Date(lastWebhook).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
            : 'Nenhum evento recebido ainda. Cadastre a URL no painel do Asaas.',
        },
  );

  const aiBalance = process.env.DEEPSEEK_API_KEY
    ? (
        await sql`
          SELECT currency, total_balance, is_available, collected_at FROM ai_provider_balances
          WHERE provider = 'deepseek' ORDER BY collected_at DESC LIMIT 1
        `
      )[0]
    : null;
  result.push(
    !process.env.DEEPSEEK_API_KEY
      ? { name: 'Provedor de IA (DeepSeek)', state: 'missing', detail: 'Falta DEEPSEEK_API_KEY no ambiente.' }
      : !aiBalance
        ? { name: 'Provedor de IA (DeepSeek)', state: 'ok', detail: 'Chave configurada. Saldo ainda não lido (veja Créditos de IA).' }
        : {
            name: 'Provedor de IA (DeepSeek)',
            state: aiBalance.is_available ? 'ok' : 'error',
            detail:
              `${aiBalance.is_available ? 'Saldo' : 'Sem saldo — o assistente parou'}: ${aiBalance.currency} ` +
              `${Number(aiBalance.total_balance).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ` +
              `(lido em ${new Date(aiBalance.collected_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}).`,
          },
  );

  result.push(
    process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY
      ? { name: 'Servidor WhatsApp (Evolution)', state: 'ok', detail: process.env.EVOLUTION_API_URL }
      : { name: 'Servidor WhatsApp (Evolution)', state: 'missing', detail: 'Faltam EVOLUTION_API_URL e EVOLUTION_API_KEY no ambiente.' },
  );

  // Mercado Pago: the platform's application, which each technician authorizes on their own account.
  const mercadoPagoMissing = mercadoPagoMissingConfig();
  const mercadoPago = (
    await sql`
      SELECT
        (SELECT COUNT(*)::int FROM mercadopago_accounts WHERE disconnected_at IS NULL) AS accounts,
        (SELECT MAX(received_at) FROM mercadopago_webhook_events) AS last_webhook
    `
  )[0];
  result.push(
    mercadoPagoMissing.length
      ? { name: 'Mercado Pago (Controle de Peças)', state: 'missing', detail: `Falta ${mercadoPagoMissing.join(', ')} no ambiente.` }
      : {
          name: 'Mercado Pago (Controle de Peças)',
          state: 'ok',
          detail:
            `${mercadoPago.accounts} conta(s) de técnico conectada(s). ` +
            (mercadoPago.last_webhook
              ? `Último aviso: ${new Date(mercadoPago.last_webhook).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`
              : 'Nenhum aviso (webhook) recebido ainda.'),
        },
  );

  const heartbeat = (await sql`SELECT MAX(last_seen_at) AS last FROM worker_heartbeats`)[0]?.last;
  result.push(
    !process.env.PORTO_WORKER_URL
      ? { name: 'Worker de automações', state: 'missing', detail: 'Falta PORTO_WORKER_URL no ambiente.' }
      : heartbeat && Date.now() - new Date(heartbeat).getTime() < OFFLINE_AFTER_MS
        ? { name: 'Worker de automações', state: 'ok', detail: 'Online.' }
        : { name: 'Worker de automações', state: 'error', detail: heartbeat ? 'Sem sinal de vida há mais de 3 minutos.' : 'Nunca se comunicou.' },
  );

  return result;
}
