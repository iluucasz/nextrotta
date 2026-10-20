import type { Frame, Page } from 'playwright-core';
import { openPortalFrame } from './navigation';
import { PortoLayoutError } from '../porto-layout';

export type PortoServiceRow = {
  numeroServico: string;
  anoServico: string;
  technicianNameFragment: string;
  /** "dd/mm/aaaa" as shown in the results table — the scheduled/programmed date, not necessarily the actual completion date (see getServicoDetail). */
  dataProgramada: string;
  /**
   * "HH:mm" from the results table's "Hora Prevista" column (`cap_horaAtendimento`) — confirmed
   * live with the product owner (2026-08-29) as the real time the technician actually started
   * that service, unlike the neighboring "Hora Comb." column (`cap_horaProgramadaAtendimento`,
   * a generic/static programmed slot — always the same value like 08:00 regardless of what
   * actually happened, which is what falsely made every technician's recorded start time show as
   * 08:00 before this was found). Re-validated 05/10/2026: matches the portal's "HORA PREV."
   * column, and equals the detail timeline's "Em Execução" time (6054881/26: 16:23). Empty string
   * if the column wasn't present/parseable.
   */
  horaAtendimento: string;
  /**
   * The results table's STATUS column, e.g. "Concluído com Sucesso", "Concluído sem Sucesso",
   * "Cancelado", "Aceite" (accepted, never executed). Empty string if it couldn't be read.
   */
  status: string;
};

/**
 * State of the laudo-digital magnifier ("lupa") under "SENHA DE ATENDIMENTO" on a service's
 * detail page. Porto only enables it when the technician filled in the digital report correctly.
 * - `available`: enabled and the laudo page was read.
 * - `unavailable`: found but disabled — the technician didn't fill in the laudo (warning case).
 * - `not_found`: no magnifier could be identified at all — a selector problem on our side, never
 *   treated as the technician's fault.
 * - `failed`: enabled, but opening/reading the laudo page failed.
 */
export type PortoLaudoState = 'available' | 'unavailable' | 'not_found' | 'failed';

export type PortoServiceEndTime = {
  situacaoAtual: string;
  /** "HH:mm" end of the technician's work on this service, or null when nothing usable was found. */
  endTime: string | null;
  /** "dd/mm/aaaa" of `endTime` — the service day, or the next day for a service that crossed midnight. */
  endDate: string | null;
  /** Which timestamp `endTime` came from. */
  endSource: 'laudo_assinatura' | 'laudo_conclusao' | 'concluido' | null;
  laudo: PortoLaudoState;
  laudoError?: string;
  /**
   * "HH:mm" the work on this service began per its status timeline ("Em Execução", else "Em
   * Deslocamento"), on the service day — used as the day's start when "Hora Prev." can't be (it's
   * a forecast and can even fall after the service's end). Null when the timeline has neither
   * (cancelled services have an empty timeline).
   */
  timelineStart: string | null;
};

export type PortoDateRange = { startDateKey: string; endDateKey: string };

const SEARCH_MENU_ID = 'PDP-00089';
const SEARCH_URL = 'https://wwws.portoseguro.com.br/integracoesportaldeprestadores/click/ConServCons.xhtml?portal=2';
const MAX_RANGE_DAYS = 15; // matches the site's own client-side cap (see runServiceSearch)

function toBrDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-');
  return `${day}/${month}/${year}`;
}

function nextDayKey(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Opens the service search page and runs a search for the given date range. Validated live: the
 * date fields start out hidden inside a `display:none` div until "TIPO DE BUSCA" is set to
 * "Combinada com Cliente" (value "1") — selecting that first is required, otherwise the date
 * inputs are unreachable (an earlier attempt at posting the form directly, bypassing this UI
 * step, failed with a 500 from the server).
 *
 * The site's own JS keeps the period at a fixed 15-day window rather than the dates typed in
 * (validated live 05/10/2026: asking 01/10–05/10 searched 01/10–16/10, asking 01/09–15/09
 * searched 31/08–15/09), so results routinely include days outside the requested range — callers
 * must filter by date. Occasionally the typed dates don't take at all and the site falls back to
 * its default "last 15 days" (seen live: a 01/10–05/10 request returned 20/09–05/10). The period
 * actually used is read back after searching; if it doesn't cover the request, the search is
 * retried once and then fails loudly instead of returning the wrong days.
 */
async function runServiceSearch(page: Page, range: PortoDateRange): Promise<Frame> {
  const brStart = toBrDate(range.startDateKey);
  const brEnd = toBrDate(clampRangeEnd(range));
  let used = { start: '', end: '' };

  for (let attempt = 1; attempt <= 2; attempt++) {
    const frame = await openPortalFrame(page, SEARCH_MENU_ID, SEARCH_URL);
    await dismissBlockingModal(frame);

    await frame.selectOption('#tipoData', '1');
    await frame.fill('input[name="dataInicialInputDate"]', brStart);
    await frame.fill('input[name="dataFinalInputDate"]', brEnd);

    await Promise.all([
      frame.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => null),
      frame.locator('input[name="pesquisar"]').click(),
    ]);

    used = await frame.evaluate(() => ({
      start: (document.querySelector('input[name="dataInicialInputDate"]') as HTMLInputElement | null)?.value ?? '',
      end: (document.querySelector('input[name="dataFinalInputDate"]') as HTMLInputElement | null)?.value ?? '',
    }));
    const usedStart = brDateToKey(used.start);
    const usedEnd = brDateToKey(used.end);
    if (usedStart && usedEnd && usedStart <= range.startDateKey && usedEnd >= clampRangeEnd(range)) {
      return frame;
    }
  }

  throw new PortoLayoutError(`A busca de serviços do Porto não respeitou o período ${brStart}–${brEnd} (usou ${used.start || '?'}–${used.end || '?'}).`);
}

function brDateToKey(brDate: string): string | null {
  const match = brDate.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/**
 * Porto's RichFaces app occasionally leaves an error modal open after a flaky request (session
 * hiccup, server-side validation error, etc). Confirmed live: a Playwright click failed with
 * `locator.click: Timeout 30000ms exceeded`, whose log showed the click target correctly resolved
 * but blocked by `#form-erro-modal\:modal-erroDiv` (a RichFaces modal mask) "intercepting pointer
 * events" — and since nothing ever dismissed it, every subsequent click for the rest of that run
 * failed the same way. Force-hides any such leftover modal defensively before interacting with the
 * page, so one glitch doesn't cascade into blocking everything downstream.
 */
async function dismissBlockingModal(frame: Frame): Promise<void> {
  await frame
    .evaluate(() => {
      document.querySelectorAll('[id*="modal-erro"]').forEach((el) => {
        (el as HTMLElement).style.display = 'none';
      });
    })
    .catch(() => {});
}

function clampRangeEnd(range: PortoDateRange): string {
  const start = new Date(`${range.startDateKey}T00:00:00Z`);
  const end = new Date(`${range.endDateKey}T00:00:00Z`);
  const maxEnd = new Date(start.getTime() + MAX_RANGE_DAYS * 86400000);
  return end.getTime() > maxEnd.getTime() ? maxEnd.toISOString().slice(0, 10) : range.endDateKey;
}

/**
 * Searches every service attended within a date range in one page load (the search form natively
 * supports a period, not just a single day — used here to sweep "start of month through today" in
 * one call instead of one search per day). Validated live: the resulting table lists service order
 * codes as visible "NNNNNNN/AA" text inside `<a onclick="changeUrlAW(this, ano, numero, ...)">`
 * links — the same NNNNNNN/AA text is used here to extract numeroServico/anoServico per row, along
 * with each row's own programmed date so callers can group results by day.
 */
export async function searchServicosByDateRange(page: Page, range: PortoDateRange): Promise<PortoServiceRow[]> {
  const frame = await runServiceSearch(page, range);
  const html = await frame.content();
  return parseServiceRowsFromHtml(html);
}

const ONCLICK_CODE_PATTERN = /onclick="changeUrlAW\(this,\s*(\d+),\s*(\d+)/i;
const NAME_CELL_PATTERN = /<!--\s*Nome Tratamento\s*-->\s*<td[^>]*>([\s\S]*?)<\/td>/i;
const DATE_SPAN_PATTERN = /cap_dataProgramadaAtendimento"[^>]*>([\s\S]*?)<\/span>/i;
// "Hora Prevista" column — cap_horaAtendimento is the real per-service start time (see
// PortoServiceRow.horaAtendimento doc comment); not to be confused with the neighboring
// cap_horaProgramadaAtendimento ("Hora Comb.") column, a static scheduled slot.
const HORA_ATENDIMENTO_PATTERN = /cap_horaAtendimento"[^>]*>([\s\S]*?)<\/span>/i;
// STATUS has no comment anchor — validated live, it's the plain cell right after "Hora Prevista":
// `<!--Hora Prevista --><td><span id="...cap_horaAtendimento">08:00</span></td><td width="4%">Concluído com Sucesso</td>`.
const STATUS_AFTER_HORA_PATTERN = /cap_horaAtendimento"[^>]*>[\s\S]*?<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i;

/**
 * Validated live against a real 15-day range result (402 rows): the row's other all-caps cells
 * (Sigla Empresa like "SERVICOS"/"PORTO SEGURO", Tipo Serviço) also match a naive "all-caps text
 * cell" heuristic and were being picked up ahead of the real technician name — silently breaking
 * every name-based match. The table's own HTML comments (`<!-- Nome Tratamento -->` etc) are
 * reliable, stable anchors for each column instead of guessing by content shape; the service code
 * itself is read from the `onclick="changeUrlAW(this, ano, numero, ...)"` attribute, not the cell
 * text, for the same reason.
 */
function parseServiceRowsFromHtml(html: string): PortoServiceRow[] {
  const rows: PortoServiceRow[] = [];
  const rowMatches = html.split(/<tr[\s>]/i).slice(1);

  for (const rawRow of rowMatches) {
    const codeMatch = rawRow.match(ONCLICK_CODE_PATTERN);
    if (!codeMatch) continue;

    const [, anoServico, numeroServico] = codeMatch;

    const nameMatch = rawRow.match(NAME_CELL_PATTERN);
    const technicianNameFragment = nameMatch
      ? nameMatch[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
      : '';

    const dateMatch = rawRow.match(DATE_SPAN_PATTERN);
    const dataProgramada = dateMatch ? dateMatch[1].trim() : '';

    const horaMatch = rawRow.match(HORA_ATENDIMENTO_PATTERN);
    const horaAtendimento = horaMatch ? horaMatch[1].replace(/&nbsp;/g, ' ').trim() : '';

    const statusMatch = rawRow.match(STATUS_AFTER_HORA_PATTERN);
    const status = statusMatch ? statusMatch[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : '';

    if (!technicianNameFragment) continue;

    rows.push({ numeroServico, anoServico, technicianNameFragment, dataProgramada, horaAtendimento, status });
  }

  return rows;
}

// "Data da assinatura:\n05/10/2026 - 16:08:38" on the laudo page (porto-socorro-app-portal.web.app).
const LAUDO_ASSINATURA_PATTERN = /Data da assinatura:?\s*(\d{2}\/\d{2}\/\d{4})\s*-?\s*(\d{2}:\d{2})/i;
const LAUDO_CONCLUSAO_PATTERN = /Data de conclus[ãa]o do laudo:?\s*(\d{2}\/\d{2}\/\d{4})\s*-?\s*(\d{2}:\d{2})/i;
const LAUDO_LOAD_TIMEOUT_MS = 20000;

type LaudoLink = { state: 'enabled'; url: string } | { state: 'disabled' | 'not_found' };

/**
 * Reads the laudo-digital icon ("lupa") under "SENHA DE ATENDIMENTO". Validated live (05/10/2026):
 * - enabled (5999501/26): `<a onclick="abreLink('https://porto-socorro-app-portal.web.app/laudo/<id>?token=...')">
 *   <img id="imgLaudo" src=".../laudo.png">` — the laudo URL (with a short-lived token) is right
 *   there, so it's opened directly instead of clicking and waiting for a popup.
 * - disabled (6054881/26): `<a href="javascript:void(0);"><img id="imgLaudo" src=".../laudo_disable.png">`.
 * Anything else (icon missing, or no URL without the `_disable` image) is `not_found` — never
 * treated as the technician's fault.
 */
async function readLaudoLink(frame: Frame): Promise<LaudoLink> {
  const link = await frame.evaluate(() => {
    const img = document.getElementById('imgLaudo');
    if (!img) return { state: 'not_found', url: null };
    const url = img.closest('a')?.getAttribute('onclick')?.match(/abreLink\('(https?:\/\/[^']+)'\)/)?.[1] ?? null;
    if (url) return { state: 'enabled', url };
    return { state: /_disable\./i.test(img.getAttribute('src') ?? '') ? 'disabled' : 'not_found', url: null };
  });
  return link.state === 'enabled' && link.url ? { state: 'enabled', url: link.url } : { state: link.state === 'disabled' ? 'disabled' : 'not_found' };
}

// The status timeline is a table: labels (Aceito | Em Deslocamento | Em Execução | Concluído) in
// one row, their timestamps in the next, each cell anchored by an HTML comment — validated live:
// `<!-- BT Concluir --><td ...><span ...><span class="pv-campo-padrao">05/10/2026 18:21</span>`.
const CONCLUIR_CELL_PATTERN = /<!--\s*BT Concluir\s*-->\s*<td[^>]*>([\s\S]*?)<\/td>/i;
const EXECUCAO_CELL_PATTERN = /<!--\s*BT Em Execu[çc][ãa]o\s*-->\s*<td[^>]*>([\s\S]*?)<\/td>/i;
const DESLOCAMENTO_CELL_PATTERN = /<!--\s*BT Em Deslocamento\s*-->\s*<td[^>]*>([\s\S]*?)<\/td>/i;
const TIMESTAMP_PATTERN = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/;

/**
 * Reads the "Concluído" step time from the detail page's status timeline. Falls back to the
 * latest timestamp of the service day (or the day after) on the whole page — the original
 * behavior, which also lands on the Concluído time.
 */
function readConcluidoTimestamp(html: string, acceptedBrDates: string[]): { date: string; time: string } | null {
  const cell = html.match(CONCLUIR_CELL_PATTERN)?.[1] ?? '';
  const fromTimeline = cell.match(TIMESTAMP_PATTERN);
  if (fromTimeline && acceptedBrDates.includes(fromTimeline[1])) {
    return { date: fromTimeline[1], time: fromTimeline[2] };
  }

  let latest: { date: string; time: string } | null = null;
  for (const match of html.matchAll(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/g)) {
    const [, date, time] = match;
    const rank = acceptedBrDates.indexOf(date);
    if (rank === -1) continue;
    const latestRank = latest ? acceptedBrDates.indexOf(latest.date) : -1;
    if (!latest || rank > latestRank || (rank === latestRank && time > latest.time)) {
      latest = { date, time };
    }
  }
  return latest;
}

/**
 * Opens the laudo (a separate single-page app, porto-socorro-app-portal.web.app) in its own tab and
 * reads "Data da assinatura", falling back to "Data de conclusão do laudo". Validated live with
 * 5999501/26: "Data da assinatura: 05/10/2026 - 16:08:38". The tab is always closed afterwards.
 */
async function readLaudoEndTime(
  page: Page,
  laudoUrl: string,
  acceptedBrDates: string[],
  useLaudoConclusion: boolean,
): Promise<{ date: string; time: string; source: 'laudo_assinatura' | 'laudo_conclusao' } | null> {
  const target = await page.context().newPage();
  try {
    await target.goto(laudoUrl, { waitUntil: 'domcontentloaded', timeout: LAUDO_LOAD_TIMEOUT_MS });
    await target
      .waitForFunction(() => /Data da assinatura|Data de conclus[ãa]o do laudo/i.test(document.body?.innerText ?? ''), undefined, {
        timeout: LAUDO_LOAD_TIMEOUT_MS,
      })
      .catch(() => null);

    const text = await target.evaluate(() => document.body?.innerText ?? '');
    const sources = [
      [LAUDO_ASSINATURA_PATTERN, 'laudo_assinatura'],
      [LAUDO_CONCLUSAO_PATTERN, 'laudo_conclusao'],
    ] as const;
    // Configurações can rule out the laudo's conclusion date, leaving only the signature.
    for (const [pattern, source] of useLaudoConclusion ? sources : sources.slice(0, 1)) {
      const match = text.match(pattern);
      if (match && acceptedBrDates.includes(match[1])) {
        return { date: match[1], time: match[2], source };
      }
    }
    return null;
  } finally {
    await target.close().catch(() => {});
  }
}

/**
 * Determines when the technician finished working on one service (in practice: the day's last
 * service, by "Hora Prevista" — see run-hours-job.ts). Rule confirmed by the product owner
 * (2026-10-05):
 * - Magnifier enabled → the laudo's "Data da assinatura" is the real end of work.
 * - Magnifier disabled (laudo not filled in on Porto) → the timeline's "Concluído" time, and the
 *   caller flags the day for a warning (`laudo: 'unavailable'`).
 * - Laudo failed to open or its magnifier couldn't be identified → "Concluído" time, but no
 *   warning, since that's not something the technician did wrong.
 *
 * Navigation: re-runs the day's search and clicks the result whose `onclick="changeUrlAW(this,
 * anoServico, numeroServico, ...)"` matches — detail pages reject direct URL navigation with
 * "Acesso proibido" (validated live with 5167437/26: timeline 06:13, 09:17, 10:25, 10:58).
 * Timestamps on the day after the service day are accepted, so a service that crosses midnight
 * still gets its real end time.
 */
export async function getServicoEndTime(
  page: Page,
  serviceDateKey: string,
  params: { anoServico: string; numeroServico: string },
  options: { useLaudoConclusion?: boolean } = {},
): Promise<PortoServiceEndTime> {
  const frame = await runServiceSearch(page, { startDateKey: serviceDateKey, endDateKey: serviceDateKey });
  await dismissBlockingModal(frame);
  const link = frame.locator(`a[onclick*="changeUrlAW(this, ${params.anoServico}, ${params.numeroServico}"]`).first();

  if (!(await link.count())) {
    return { situacaoAtual: '', endTime: null, endDate: null, endSource: null, laudo: 'not_found', laudoError: 'Serviço não encontrado na busca do dia.', timelineStart: null };
  }

  await Promise.all([
    frame.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => null),
    link.click(),
  ]);
  await dismissBlockingModal(frame);

  const acceptedBrDates = [toBrDate(serviceDateKey), toBrDate(nextDayKey(serviceDateKey))];
  const html = await frame.content();
  const situacaoAtual = html.match(/Situa[çc][ãa]o Atual[\s\S]{0,200}?pv-campo-padrao">([^<]*)</i)?.[1]?.trim() ?? '';
  const concluido = readConcluidoTimestamp(html, acceptedBrDates);
  const timelineStart =
    [EXECUCAO_CELL_PATTERN, DESLOCAMENTO_CELL_PATTERN]
      .map((pattern) => (html.match(pattern)?.[1] ?? '').match(TIMESTAMP_PATTERN))
      .find((match) => match && match[1] === acceptedBrDates[0])?.[2] ?? null;
  const fromConcluido = (laudo: PortoLaudoState, laudoError?: string): PortoServiceEndTime => ({
    situacaoAtual,
    endTime: concluido?.time ?? null,
    endDate: concluido?.date ?? null,
    endSource: concluido ? 'concluido' : null,
    laudo,
    laudoError,
    timelineStart,
  });

  const laudoLink = await readLaudoLink(frame);
  if (laudoLink.state !== 'enabled') {
    return fromConcluido(laudoLink.state === 'disabled' ? 'unavailable' : 'not_found');
  }

  try {
    const laudo = await readLaudoEndTime(page, laudoLink.url, acceptedBrDates, options.useLaudoConclusion ?? true);
    if (!laudo) {
      return fromConcluido('failed', 'Laudo aberto, mas sem "Data da assinatura" do dia do serviço.');
    }
    return { situacaoAtual, endTime: laudo.time, endDate: laudo.date, endSource: laudo.source, laudo: 'available', timelineStart };
  } catch (error) {
    return fromConcluido('failed', error instanceof Error ? error.message.slice(0, 300) : String(error));
  }
}
