// The paid provider that looks fines up in the Detrans (Infosimples). Everything that depends on the provider's API lives HERE:
// the endpoints, the parameters and the field names of each answer. Relative imports only: the worker compiles this file.
//
// CONFIRMED with real calls (16/11/2026): the endpoint (/api/v2/consultas/<path>, POST with the token), the envelope ({ code,
// code_message, errors, header: { billable, price }, data: [...] }), code 603 (query not enabled on the account: each query is
// enabled by a form on the provider's site) and 607 (invalid parameter, e.g. a Renavam with a wrong check digit; it IS charged).
// NOT CONFIRMED yet: the fields of a real list of fines. They come from the "Dados retornados" list of each query's public page,
// and need a real car with fines to be checked. Adjust only this file (and its tests) if something differs.
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
  /** How long the provider may wait for this agency's site; PROVIDER_TIMEOUT_SECONDS when absent. */
  timeoutSeconds?: number;
  /** Turns the answer's data into fines (an empty list means "no fines"). */
  parse: (data: Record<string, unknown>) => ExternalFine[];
};

const API_BASE = 'https://api.infosimples.com/api/v2/consultas';

/**
 * How long the provider may wait for the agency's site before giving up (code 605). MEASURED on 17/11/2026 with real cars: asked ONE AT A
 * TIME the PRF answers in 3 to 13 s; asked several at once, some never answer (605 at 120 s), and waiting longer does not help (240 s
 * got HTTP 502 from the provider's gateway). So the fix is not a longer wait but one call at a time per agency (`serializePerSource` in
 * fines-sync.ts); the wait only has to cover a slow answer, and a momentary failure is asked once more (`MAX_ATTEMPTS`).
 */
export const PROVIDER_TIMEOUT_SECONDS = 45;
export const MAX_ATTEMPTS = 3;

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

/**
 * The platform's gov.br login (CPF and password), from the environment. The Detran-SP query needs one: without it the provider answers 606
 * (and charges). CONFIRMED with real calls (18/11/2026): the login is registered once in the provider's panel ("Autenticação em Duas
 * Etapas do gov.br") and the gov.br account must have authorised the Detran-SP service once by hand (otherwise code 620). It is the
 * platform's, never a company's, and it is never put in a message or a log.
 */
export function govbrLogin(): { cpf: string; password: string } | null {
  const cpf = (process.env.INFOSIMPLES_SP_CPF ?? '').replace(/\D/g, '');
  const password = process.env.INFOSIMPLES_SP_SENHA ?? '';
  return cpf.length === 11 && password ? { cpf, password } : null;
}

/** Joins "10/11/2026" and "23:53:00" the way parseProviderDate reads them; the day alone when there is no time. */
const dayAndTime = (day: unknown, time: unknown): string => [text(day), text(time)].filter(Boolean).join(' ');

/**
 * The Detran of São Paulo: debts and restrictions by plate and Renavam, through the platform's gov.br login. Slow (18 to 42 s measured) and
 * charged on every answer, including some errors; the provider warns about a daily limit per login, so a batch is spread over days by the
 * weekly rule and the manual lookup skips cars checked recently. Only the fines (`debitos_multas`) are read here; IPVA, licensing and the
 * restrictions of the same answer are not used yet. Fields CONFIRMED on a real car WITHOUT fines (empty lists) and on the provider's
 * example; the shape of an item with a real fine is the example's and still needs a real car that has one.
 */
const DETRAN_SP: FineSource = {
  key: 'detran-sp',
  label: 'Detran-SP',
  path: 'detran/sp/debitos',
  timeoutSeconds: 90,
  params: (car) => {
    const login = govbrLogin();
    return { placa: car.plate, renavam: car.renavam, ...(login ? { login_cpf: login.cpf, login_senha: login.password } : {}) };
  },
  parse: (data) =>
    list(data.debitos_multas).flatMap((row) => {
      const ait = text(row.auto_infracao);
      if (!ait) return [];
      const authority = row.orgao_autuador && typeof row.orgao_autuador === 'object' ? textOrNull((row.orgao_autuador as Record<string, unknown>).nome) : null;
      return [
        {
          ait: ait.toUpperCase(),
          infractionAt: parseProviderDate(dayAndTime(row.data_infracao, row.hora_infracao)),
          description: text(row.descricao) || 'Infração de trânsito',
          amount: amountOf(row.valor),
          points: null,
          location: [textOrNull(row.local), textOrNull(row.municipio)].filter(Boolean).join(' - ') || null,
          authority: authority ?? 'Detran-SP',
          paymentDue: dateOnly(row.data_vencimento),
        },
      ];
    }),
};

/** Detrans we already read, by UF. Adding a state is adding an entry here (and its test). */
const DETRAN_BY_STATE: Record<string, { source: FineSource; ready?: () => boolean }> = {
  MS: { source: DETRAN_MS },
  // São Paulo only counts when the platform's gov.br login is in the environment: without it the query cannot work.
  SP: { source: DETRAN_SP, ready: () => govbrLogin() !== null },
};

/** Where to look for a car of this state: its Detran when we have it, and always the federal highways. */
export function sourcesFor(state: string): { sources: FineSource[]; detranCovered: boolean } {
  const entry = DETRAN_BY_STATE[state.toUpperCase()];
  const detran = entry && (!entry.ready || entry.ready()) ? entry.source : null;
  return { sources: detran ? [detran, PRF] : [PRF], detranCovered: Boolean(detran) };
}

/**
 * `deferred`: not asked at all because the time budget of this lookup ran out; the next lookup does it.
 * `refused`: the agency refused the plate or the Renavam (code 608): asking again is useless and billed, so it waits for the data to be edited.
 */
/**
 * `unavailable`: the query is not set up on the platform's side yet (not enabled on the provider's account, or the gov.br login is not
 * ready). Nothing the company can fix, so it is never shown as a problem; and within one lookup it is not asked again.
 */
export type LookupResult =
  | { ok: true; fines: ExternalFine[] }
  | { ok: false; message: string; deferred?: boolean; refused?: boolean; unavailable?: boolean };

/** One query: asks the provider and reads the answer. Never throws; a failure comes back as a message (the token is never put in it). */
export type Fetcher = (source: FineSource, car: CarToLookUp) => Promise<LookupResult>;

export function providerToken(): string | null {
  return process.env.INFOSIMPLES_TOKEN?.trim() || null;
}

/** The real fetcher: the provider's API with the platform's token. */
type Attempt = { result: LookupResult; transient: boolean };

/** One call to the provider. `transient`: the agency or the provider's gateway failed for a moment, so asking again may work. */
async function attempt(token: string, source: FineSource, car: CarToLookUp, fetchImpl: typeof fetch): Promise<Attempt> {
  try {
    const timeout = source.timeoutSeconds ?? PROVIDER_TIMEOUT_SECONDS;
    const response = await fetchImpl(`${API_BASE}/${source.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, timeout: String(timeout), ...source.params(car) }),
      signal: AbortSignal.timeout((timeout + 25) * 1000),
    });
    const body = (await response.json().catch(() => null)) as { code?: number; code_message?: string; errors?: unknown; data?: unknown } | null;
    if (!body || typeof body.code !== 'number') {
      // HTTP 502/503/504 with no JSON: the provider's gateway (or the agency behind it) did not answer in time. Worth asking again.
      if (response.status >= 500) {
        return { transient: true, result: { ok: false, message: `${source.label}: o provedor não respondeu (erro ${response.status}). O sistema tenta de novo na próxima verificação.` } };
      }
      return { transient: false, result: { ok: false, message: `${source.label}: resposta inesperada do provedor (HTTP ${response.status}).` } };
    }
    if (body.code !== 200) {
      const first = Array.isArray(body.errors) ? text(body.errors[0]) : '';
      // 603: this query is not enabled on the platform's provider account (or the token lost its access): the company can do
      // nothing about it, and the text of the provider carries the platform's own account details, so it goes to the log only.
      if (body.code === 603) {
        console.error(`[carros] ${source.key}: o provedor recusou o acesso (603): ${first || text(body.code_message)}`);
        return { transient: false, result: { ok: false, unavailable: true, message: `${source.label}: a consulta ainda não foi habilitada pelo NextRotta.` } };
      }
      // 606 / 620 about the gov.br login (missing, or not yet authorised by hand on the Detran's page): the platform's setup, not the
      // company's. The provider's text names the platform's account and a link, so it goes to the log only.
      if ((body.code === 606 || body.code === 620) && /gov\.?br/i.test(`${first} ${text(body.code_message)}`)) {
        console.error(`[carros] ${source.key}: o login do gov.br da plataforma não está pronto (${body.code}): ${first || text(body.code_message)}`);
        return { transient: false, result: { ok: false, unavailable: true, message: `${source.label}: a consulta ainda não está pronta no NextRotta.` } };
      }
      // 608: the agency's site refused the data we sent: the plate and the Renavam do not match a car there. Nothing to ask again.
      if (body.code === 608) {
        const why = (first || text(body.code_message)).replace(/\.$/, '');
        return { transient: false, result: { ok: false, refused: true, message: `${source.label}: o órgão recusou os dados deste carro (${why}). Confira a placa e o Renavam no documento.` } };
      }
      // 605: the agency took too long to answer. Nothing is wrong with the car or the data; worth asking again.
      if (body.code === 605) {
        return { transient: true, result: { ok: false, message: `${source.label}: o órgão demorou para responder. O sistema tenta de novo na próxima verificação.` } };
      }
      const detail = [text(body.code_message), first].filter((part, index, all) => part && !all.slice(0, index).some((other) => other.includes(part))).join(' ');
      return { transient: false, result: { ok: false, message: `${source.label}: ${detail || 'o provedor não conseguiu consultar'} (código ${body.code}).` } };
    }
    const data = Array.isArray(body.data) ? body.data[0] : body.data;
    return { transient: false, result: { ok: true, fines: data && typeof data === 'object' ? source.parse(data as Record<string, unknown>) : [] } };
  } catch (error) {
    const slow = error instanceof Error && error.name === 'TimeoutError';
    return { transient: true, result: { ok: false, message: `${source.label}: ${slow ? 'o provedor demorou demais' : 'não foi possível falar com o provedor'}.` } };
  }
}

/** The real fetcher: the provider's API with the platform's token. A momentary failure is asked again once; the last message is the one kept. */
export function createProviderFetcher(token: string, fetchImpl: typeof fetch = fetch, options: { attempts?: number } = {}): Fetcher {
  const attempts = options.attempts ?? MAX_ATTEMPTS;
  return async (source, car) => {
    let last: Attempt | null = null;
    for (let tries = 1; tries <= attempts; tries += 1) {
      last = await attempt(token, source, car, fetchImpl);
      if (last.result.ok || !last.transient) break;
    }
    return (last as Attempt).result;
  };
}
