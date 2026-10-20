import { sql } from '../db';
import { sendOwnerAlert } from '../platform/alerts';
import { getPlatformSettings } from '../platform/settings';

/**
 * The DeepSeek account balance (GET /user/balance). DeepSeek has no spending history, so the
 * platform keeps readings (ai_provider_balances) and measures what it really charged as the drop
 * between consecutive readings; a rise is a top-up. Readings come after assistant answers, hourly
 * from the worker and when the owner opens the panel, never more often than `maxAgeMs`.
 */

const BASE_URL = 'https://api.deepseek.com';
const PROVIDER = 'deepseek';

export type BalanceReading = {
  currency: string;
  total: number;
  granted: number | null;
  toppedUp: number | null;
  isAvailable: boolean;
  collectedAt: string;
};

export function isBalanceConfigured() {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

async function fetchBalance() {
  const response = await fetch(`${BASE_URL}/user/balance`, {
    headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || `DeepSeek respondeu ${response.status}.`);
  const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : [];
  return {
    isAvailable: Boolean(data?.is_available),
    balances: infos.map((info: Record<string, unknown>) => ({
      currency: String(info.currency ?? '?'),
      total: Number(info.total_balance ?? 0),
      granted: info.granted_balance === undefined ? null : Number(info.granted_balance),
      toppedUp: info.topped_up_balance === undefined ? null : Number(info.topped_up_balance),
    })),
  };
}

function readingFromRow(row: Record<string, unknown>): BalanceReading {
  return {
    currency: String(row.currency),
    total: Number(row.total_balance),
    granted: row.granted_balance === null ? null : Number(row.granted_balance),
    toppedUp: row.topped_up_balance === null ? null : Number(row.topped_up_balance),
    isAvailable: Boolean(row.is_available),
    collectedAt: new Date(row.collected_at as string).toISOString(),
  };
}

/** The latest reading of each currency. */
async function latestReadings() {
  const rows = await sql`
    SELECT DISTINCT ON (currency) currency, total_balance, granted_balance, topped_up_balance, is_available, collected_at
    FROM ai_provider_balances
    WHERE provider = ${PROVIDER}
    ORDER BY currency, collected_at DESC
  `;
  return rows.map(readingFromRow);
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function formatAmount(value: number, currency: string) {
  return `${currency} ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Warns the owner (once a day while it lasts) when the balance ran out or went under the threshold. */
async function alertIfLow(readings: BalanceReading[], isAvailable: boolean) {
  const { ai } = await getPlatformSettings();
  const summary = readings.map((reading) => formatAmount(reading.total, reading.currency)).join(' · ') || 'sem saldo';
  if (!isAvailable) {
    await sendOwnerAlert({
      key: `ai_balance_empty:${today()}`,
      kind: 'ai_balance',
      title: 'Saldo da DeepSeek acabou',
      lines: [`Saldo: ${summary}.`, 'O assistente de IA parou de responder em todas as empresas até você recarregar a conta da DeepSeek.'],
    });
    return;
  }
  const threshold = ai.lowBalanceAlert;
  if (threshold !== null && readings.some((reading) => reading.total < threshold)) {
    await sendOwnerAlert({
      key: `ai_balance_low:${today()}`,
      kind: 'ai_balance',
      title: 'Saldo da DeepSeek baixo',
      lines: [`Saldo: ${summary} (aviso abaixo de ${threshold.toLocaleString('pt-BR')}).`, 'Recarregue a conta da DeepSeek para o assistente não parar.'],
    });
  }
}

/**
 * Reads the balance unless the last reading is newer than `maxAgeMs`, stores it and checks the
 * alert. Never throws: returns the error instead.
 */
export async function recordBalance(maxAgeMs = 5 * 60 * 1000): Promise<{ readings: BalanceReading[]; error: string | null }> {
  if (!isBalanceConfigured()) return { readings: [], error: null };
  try {
    const latest = await latestReadings();
    const newest = latest.reduce((max, reading) => Math.max(max, Date.parse(reading.collectedAt)), 0);
    if (latest.length && Date.now() - newest < maxAgeMs) return { readings: latest, error: null };

    const { isAvailable, balances } = await fetchBalance();
    for (const balance of balances) {
      await sql`
        INSERT INTO ai_provider_balances (provider, currency, total_balance, granted_balance, topped_up_balance, is_available)
        VALUES (${PROVIDER}, ${balance.currency}, ${balance.total}, ${balance.granted}, ${balance.toppedUp}, ${isAvailable})
      `;
    }
    const readings = await latestReadings();
    await alertIfLow(readings, isAvailable);
    return { readings, error: null };
  } catch (error) {
    console.error('[ai-balance] reading failed:', error);
    return { readings: await latestReadings().catch(() => []), error: error instanceof Error ? error.message : String(error) };
  }
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return { start: `${month}-01`, next: monthNumber === 12 ? `${year + 1}-01-01` : `${year}-${String(monthNumber + 1).padStart(2, '0')}-01` };
}

/** Owner panel: balance now, what DeepSeek charged and what was topped up in the month. */
export async function getAiBalance(month: string) {
  const { start, next } = monthBounds(month);
  const [{ readings, error }, settings] = await Promise.all([recordBalance(), getPlatformSettings()]);
  const [movements, calculated, history] = await Promise.all([
    // Each reading against the one before it (also the last one of the previous month).
    sql`
      WITH ordered AS (
        SELECT currency, collected_at, total_balance,
               LAG(total_balance) OVER (PARTITION BY currency ORDER BY collected_at) AS previous
        FROM ai_provider_balances
        WHERE provider = ${PROVIDER} AND collected_at < (${next}::date AT TIME ZONE 'America/Sao_Paulo')
      )
      SELECT currency,
             COALESCE(SUM(GREATEST(previous - total_balance, 0)), 0)::float AS spent,
             COALESCE(SUM(GREATEST(total_balance - previous, 0)), 0)::float AS topped_up,
             MIN(collected_at) AS since,
             COUNT(*)::int AS readings
      FROM ordered
      WHERE collected_at >= (${start}::date AT TIME ZONE 'America/Sao_Paulo')
      GROUP BY currency
    `,
    // What the platform calculated from tokens × the prices in the conversion settings (R$), for
    // every answer — the owner's ones inside an account too, which spend no credits but are charged.
    sql`
      SELECT COALESCE(SUM(cost), 0)::float AS cost
      FROM ai_messages
      WHERE role = 'assistant'
        AND created_at >= (${start}::date AT TIME ZONE 'America/Sao_Paulo')
        AND created_at < (${next}::date AT TIME ZONE 'America/Sao_Paulo')
    `,
    // Last reading of each day of the month, for the balance line.
    sql`
      SELECT DISTINCT ON (currency, day) currency, day, total_balance
      FROM (
        SELECT currency, total_balance, collected_at, to_char((collected_at AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS day
        FROM ai_provider_balances
        WHERE provider = ${PROVIDER}
          AND collected_at >= (${start}::date AT TIME ZONE 'America/Sao_Paulo')
          AND collected_at < (${next}::date AT TIME ZONE 'America/Sao_Paulo')
      ) daily
      ORDER BY currency, day, collected_at DESC
    `,
  ]);
  return {
    configured: isBalanceConfigured(),
    error,
    balances: readings,
    month,
    movements: movements.map((row) => ({
      currency: String(row.currency),
      spent: Math.round(Number(row.spent) * 10000) / 10000,
      toppedUp: Math.round(Number(row.topped_up) * 10000) / 10000,
      since: row.since ? new Date(row.since).toISOString() : null,
      readings: Number(row.readings),
    })),
    daily: history.map((row) => ({ currency: String(row.currency), day: String(row.day), total: Number(row.total_balance) })),
    calculatedCost: Math.round(Number(calculated[0]?.cost ?? 0) * 100) / 100,
    lowBalanceAlert: settings.ai.lowBalanceAlert,
  };
}
