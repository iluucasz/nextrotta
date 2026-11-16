// The paid provider that looks fines up in the Detrans (Infosimples). Everything that depends on the provider's API lives HERE:
// the endpoints, the parameters and the field names of each answer. Relative imports only: the worker compiles this file.
//
// NOT CONFIRMED AGAINST THE REAL API YET (its documentation is behind the customer login): the endpoint format
// (/api/v2/consultas/<path>), the token and the envelope ({ code, code_message, data: [...] }) follow the provider's usual pattern, and the
// field names come from the "Dados retornados" list of each query's public page. The first real call (the free R$ 100 credit) decides:
// adjust only this file (and fines-provider tests) if something differs.
import { parseAmount } from './fines-rules';

/** A fine as the provider reports it, already in our terms. */
export type ExternalFine = {
  ait: string;
  /** ISO instant, or null when the answer had no date we could read. */
  infractionAt: string | null;
  description: string;
  amount: number;
  points: number | null;
  location: string | null;
  authority: string;
  paymentDue: string | null;
};

export type CarToLookUp = { plate: string; renavam: string; state: string };

export type FineSource = {
  /** Stable key, kept in logs and messages. */
  key: string;
  label: string;
  /** Path after /api/v2/consultas/ . */
  path: string;
  params: (car: CarToLookUp) => Record<string, string>;
  /** Turns the answer's data into fines (an empty list means "no fines"). */
  parse: (data: Record<string, unknown>) => ExternalFine[];
};

const API_BASE = 'https://api.infosimples.com/api/v2/consultas';

const text = (value: unknown): string => String(value ?? '').trim();
const textOrNull = (value: unknown): string | null => text(value) || null;
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);

/** "16/11/2026 14:30", "16/11/2026", "2026-11-16 14:30:00" or an ISO instant -> ISO instant (Brasília time when none is given); null if unreadable. */
export function parseProviderDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})(?:\D+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(raw);
  let date: string;
  if (br) date = `${br[3]}-${br[2]}-${br[1]}T${br[4] ?? '12'}:${br[5] ?? '00'}:${br[6] ?? '00'}-03:00`;
  else if (iso) date = `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4] ?? '12'}:${iso[5] ?? '00'}:${iso[6] ?? '00'}${iso[7] ? (iso[7] === 'Z' ? 'Z' : iso[7].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')) : '-03:00'}`;
  else return null;
  const time = Date.parse(date);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

const dateOnly = (value: unknown): string | null => {
  const moment = parseProviderDate(value);
  if (!moment) return null;
  // The day in Brasília, not in UTC.
  return new Date(Date.parse(moment) - 3 * 3_600_000).toISOString().slice(0, 10);
};

function amountOf(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value * 100) / 100;
    const parsed = parseAmount(value);
    if (parsed !== null) return parsed;
  }
  return 0;
}

function pointsOf(value: unknown): number | null {
  const points = Number(text(value));
  return Number.isInteger(points) && points >= 0 && points <= 20 ? points : null;
}

/** The Detran of Mato Grosso do Sul: by plate and Renavam. */
const DETRAN_MS: FineSource = {
  key: 'detran-ms',
  label: 'Detran-MS',
  path: 'detran/ms/multas',
  params: (car) => ({ placa: car.plate, renavam: car.renavam }),
  parse: (data) =>
    list(data.multas).flatMap((row) => {
      const ait = text(row.auto);
      if (!ait) return [];
      return [
        {
          ait: ait.toUpperCase(),
          infractionAt: parseProviderDate(row.normalizado_datahora) ?? parseProviderDate(row.datahora),
          description: text(row.descricao_infracao) || 'Infração de trânsito',
          amount: amountOf(row.normalizado_valor, row.valor),
          points: pointsOf(row.pontos),
          location: [textOrNull(row.local), textOrNull(row.municipio)].filter(Boolean).join(' - ') || null,
          authority: 'Detran-MS',
          paymentDue: null,
        },
      ];
    }),
};

/** The Polícia Rodoviária Federal: fines on federal highways, in any state, by plate and Renavam. */
const PRF: FineSource = {
  key: 'prf',
  label: 'PRF (rodovias federais)',
  path: 'prf/infracoes',
  params: (car) => ({ placa: car.plate, renavam: car.renavam }),
  parse: (data) =>
    list(data.infracoes).flatMap((row) => {
      const ait = text(row.ait) || text(row.numero_notificacao);
      if (!ait) return [];
      return [
        {
          ait: ait.toUpperCase(),
          infractionAt: parseProviderDate(row.datahora),
          description: text(row.descricao) || 'Infração de trânsito',
          amount: amountOf(row.valor_devido, row.valor),
          points: pointsOf(row.pontos),
          location: textOrNull(row.local),
          authority: 'PRF',
          paymentDue: dateOnly(row.boleto_vencimento),
        },
      ];
    }),
};

/** Detrans we already read, by UF. Adding a state is adding an entry here (and its test). */
const DETRAN_BY_STATE: Record<string, FineSource> = { MS: DETRAN_MS };

/** Where to look for a car of this state: its Detran when we have it, and always the federal highways. */
export function sourcesFor(state: string): { sources: FineSource[]; detranCovered: boolean } {
  const detran = DETRAN_BY_STATE[state.toUpperCase()];
  return { sources: detran ? [detran, PRF] : [PRF], detranCovered: Boolean(detran) };
}

export type LookupResult = { ok: true; fines: ExternalFine[] } | { ok: false; message: string };

/** One query: asks the provider and reads the answer. Never throws; a failure comes back as a message (the token is never put in it). */
export type Fetcher = (source: FineSource, car: CarToLookUp) => Promise<LookupResult>;

export function providerToken(): string | null {
  return process.env.INFOSIMPLES_TOKEN?.trim() || null;
}

/** The real fetcher: the provider's API with the platform's token. */
export function createProviderFetcher(token: string, fetchImpl: typeof fetch = fetch): Fetcher {
  return async (source, car) => {
    try {
      const response = await fetchImpl(`${API_BASE}/${source.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, timeout: '120', ...source.params(car) }),
        signal: AbortSignal.timeout(150_000),
      });
      const body = (await response.json().catch(() => null)) as { code?: number; code_message?: string; errors?: unknown; data?: unknown } | null;
      if (!body || typeof body.code !== 'number') return { ok: false, message: `${source.label}: resposta inesperada do provedor (HTTP ${response.status}).` };
      if (body.code !== 200) {
        const detail = text(body.code_message) || (Array.isArray(body.errors) ? text(body.errors[0]) : '');
        return { ok: false, message: `${source.label}: ${detail || 'o provedor não conseguiu consultar'} (código ${body.code}).` };
      }
      const data = Array.isArray(body.data) ? body.data[0] : body.data;
      return { ok: true, fines: data && typeof data === 'object' ? source.parse(data as Record<string, unknown>) : [] };
    } catch (error) {
      return { ok: false, message: `${source.label}: ${error instanceof Error && error.name === 'TimeoutError' ? 'o provedor demorou demais' : 'não foi possível falar com o provedor'}.` };
    }
  };
}
