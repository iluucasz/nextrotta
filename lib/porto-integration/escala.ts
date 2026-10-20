import type { Frame, Page } from 'playwright-core';
import { openPortalFrame } from './navigation';
import { PortoLayoutError } from '../porto-layout';

export type PortoEscalaDay = {
  /** Day of month, 1-31. */
  day: number;
  startTime: string | null;
  endTime: string | null;
  /**
   * True only when the day's indisponibilidade entries cover the whole shift (a real day off —
   * férias, folga, doença, etc). A day with just a partial entry (e.g. a lunch break) is NOT
   * unavailable — the technician still works the rest of the shift normally. See the "full vs
   * partial" logic below.
   */
  unavailable: boolean;
  /** Comma-joined reason(s) from the indisponibilidade entries covering this day, when any. */
  reason: string | null;
};

type IndisponibilidadeEntry = { start: string; end: string; reason: string };

const SOCORRISTAS_MENU_ID = 'PDP-00192';
const SOCORRISTAS_URL = 'https://wwws.portoseguro.com.br/integracoesportaldeprestadores/click/ConSocor.xhtml?portal=2';
// Default share of the shift an indisponibilidade needs to cover before the day counts as fully
// off, rather than a partial break within a normal working day — slack for entries that don't land
// exactly on the shift boundary (e.g. FOLGA 08:00-20:00 over a 08:00-18:00 shift, confirmed live).
// Configurações → "Folga integral a partir de" overrides it (option fullDayOffPercent).
const DEFAULT_FULL_DAY_OFF_PERCENT = 90;

function timeToMinutes(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes of [entryStart, entryEnd] that fall within [shiftStart, shiftEnd]. */
function overlapMinutes(entryStart: number, entryEnd: number, shiftStart: number, shiftEnd: number): number {
  const start = Math.max(entryStart, shiftStart);
  const end = Math.min(entryEnd, shiftEnd);
  return Math.max(0, end - start);
}

/**
 * Opens a fresh navigation to the technician's escala page (same as getEscalaForMonth's own
 * navigation) and returns the resulting detail frame — kept separate so callers can request a
 * brand-new, un-mutated copy of the page on demand.
 */
async function openTechnicianEscalaFrame(page: Page, qra: string, monthOffset = 0): Promise<Frame | null> {
  const listFrame = await openPortalFrame(page, SOCORRISTAS_MENU_ID, SOCORRISTAS_URL);
  const link = listFrame.locator(`a[href*="numeroQRA=${qra}"]`).first();

  if (!(await link.count())) {
    return null;
  }

  await Promise.all([
    listFrame.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => null),
    link.click(),
  ]);

  const detailFrame = page.frames().find((f) => f.url().includes('ConDetSocor')) ?? listFrame;

  // The calendar is a RichFaces component whose own nextMonth() swaps the grid to the following
  // month — validated live (06/10/2026): October → November, with its shift times and
  // indisponibilidade icons, no extra navigation needed.
  for (let step = 0; step < monthOffset; step++) {
    await detailFrame.evaluate(() => (document.getElementById('organizer') as unknown as { component: { nextMonth(): void } }).component.nextMonth());
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(1000);
  }

  return detailFrame;
}

/**
 * Opens one day's detail popup on a freshly-navigated page (same click RichFaces' calendar widget
 * binds at the framework level, not a plain onclick attribute — confirmed live, no inline handler
 * on the day span itself does this) and reads its indisponibilidade entries from the results table
 * (stable id `resultadoIndispsSocorrista`, confirmed live: Data/Início/Fim/Indisponibilidade
 * columns, e.g. "01/08/2026 | 16:20 | 17:20 | ALMOCO").
 *
 * Takes a fresh (page, qra) pair and re-navigates from scratch rather than reusing/closing a
 * shared frame across multiple days — confirmed live this is necessary, not just cheap insurance:
 * closing the popup via `Richfaces.hideModalPanel` and clicking a second day on the SAME page
 * reliably left the results table empty or stale (retries with extra waits didn't help, so this
 * isn't a timing race — something about the widget's internal state breaks after the first
 * open/close cycle). Same "re-run from scratch" trade-off already accepted in servicos.ts's
 * getServicoDetail for the same class of problem (clicking a result navigates the frame away, so
 * a fresh reload is the only reliable way back) — costs one extra navigation per exception day,
 * not per day of the month, so it stays bounded (a technician typically has under 10 a month).
 */
async function getIndisponibilidadeEntriesForDay(page: Page, qra: string, cellIndex: number, dateBr: string, monthOffset: number): Promise<IndisponibilidadeEntry[]> {
  const detailFrame = await openTechnicianEscalaFrame(page, qra, monthOffset);
  if (!detailFrame) return [];

  const cell = detailFrame.locator('.organizerDayCell').nth(cellIndex);
  const daySpan = cell.locator('span').first();
  await daySpan.click({ timeout: 5000 });

  // The popup's own title ("Escala Socorrista em DD/MM/YYYY") confirms it actually finished
  // rendering for THIS day before reading the table.
  await detailFrame
    .waitForFunction(
      (dateBr) => {
        const title = document.querySelector('#modalInserirIndisponibilidadeContainer .pv-modal-padrao .title');
        return Boolean(title && title.textContent && title.textContent.includes(dateBr));
      },
      dateBr,
      { timeout: 5000 },
    )
    .catch(() => null);

  return detailFrame.evaluate((dateBr) => {
    const table = document.getElementById('resultadoIndispsSocorrista');
    if (!table) return [];
    return Array.from(table.querySelectorAll('tbody tr'))
      .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim() ?? ''))
      .filter((cells) => cells[0] === dateBr && cells[1] && cells[2])
      .map((cells) => ({ start: cells[1], end: cells[2], reason: cells[3] || '' }));
  }, dateBr);
}

/**
 * Reads the current month's schedule for one technician (identified by QRA).
 *
 * Validated live against a real field technician (not the account owner — the owner's own QRA
 * has an empty schedule and looks misleadingly like the cells carry no data at all). Each day
 * cell (`.organizerDayCell`) contains the time range as plain text, e.g. "08:00 - 18:00", and an
 * `<img src=".../indisponibilidade.png">` on days with an exception — confirmed present on 9 of
 * 42 cells for a real technician's August 2026 calendar.
 *
 * The month view is a fixed 6x7 grid, so it always shows some leading/trailing days from the
 * adjacent months to fill whole weeks (e.g. August 2026 starts on a Saturday, so the grid also
 * shows July 26-31 up front and September 1-5 at the end — confirmed live: 42 total cells for a
 * 31-day month). Those padding cells have empty `span[title="Escala"]` text but the SAME day
 * numbers as real days later/earlier in the target month (July 26-31 vs August 26-31, September
 * 1-5 vs August 1-5) — without filtering them out, every consumer of this array either silently
 * shadows the real day when doing `.find(d => d.day === n)` (the padding entry comes first for
 * the leading case) or, worse, writes a second bogus 00:00 schedule row per date on top of the
 * correct one (confirmed live in the `schedule` table: every technician had two rows for
 * 2026-08-01/02/29/30/31, one correct, one from padding). Fixed by only keeping the contiguous
 * 1..daysInMonth run in document order, which is exactly and only the real month's days
 * regardless of which weekday the month starts/ends on.
 *
 * Navigation: detail pages reject direct URL access ("Acesso proibido"), so this opens the
 * socorristas list through its portal wrapper and clicks the technician's own link, exactly like
 * a real user would, rather than constructing the ConDetSocor.xhtml URL directly.
 */
export async function getEscalaForMonth(
  page: Page,
  qra: string,
  options: {
    /**
     * Opens each indisponibilidade-marked day to tell a full day off from a partial break (3 page
     * loads per such day). Callers that only need the shift times (the hours job's "previsto")
     * pass false and get the month grid alone — `unavailable` then just mirrors the icon.
     */
    resolveUnavailability?: boolean;
    /** 0 = current month (default), 1 = next month — the calendar is advanced with its own nextMonth(). */
    monthOffset?: number;
    /** % of the shift an indisponibilidade must cover for a full day off (default 90). */
    fullDayOffPercent?: number;
  } = {},
): Promise<PortoEscalaDay[]> {
  const monthOffset = options.monthOffset ?? 0;
  const detailFrame = await openTechnicianEscalaFrame(page, qra, monthOffset);
  if (!detailFrame) {
    return [];
  }

  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const year = target.getFullYear();
  const month = target.getMonth() + 1;
  const daysInMonth = new Date(year, month, 0).getDate();

  // Never read one month's grid as another's: the calendar must be showing the requested month.
  const shownMonth = await detailFrame
    .evaluate(() => {
      const component = (document.getElementById('organizer') as unknown as { component?: { getCurrentYear(): number; getCurrentMonth(): number } } | null)?.component;
      return component ? `${component.getCurrentYear()}-${component.getCurrentMonth() + 1}` : null;
    })
    .catch(() => null);
  if (shownMonth && shownMonth !== `${year}-${month}`) {
    throw new PortoLayoutError(`O calendário do Porto mostrou ${shownMonth} em vez de ${year}-${month}.`);
  }

  const parsed = await detailFrame.evaluate((daysInMonth) => {
    const cells = Array.from(document.querySelectorAll('.organizerDayCell'));

    const withIndex = cells
      .map((cell, cellIndex) => {
        // Day number and time range live in separate elements — read them independently rather
        // than the whole cell's concatenated textContent, which merges them with no separator
        // (e.g. day "1" + "08:00 - 18:00" reads as "108:00 - 18:00", making a naive /^\d{1,2}/
        // match misread day 1 as day 10). The day span has no stable class, but it's reliably the
        // first element with only digits as content within the cell.
        const dayCandidate = Array.from(cell.querySelectorAll('span')).find((span) => /^\d{1,2}$/.test(span.textContent?.trim() ?? ''));
        if (!dayCandidate) return null;

        const timeCandidate = cell.querySelector('span[title="Escala"]')?.textContent ?? '';
        const timeMatch = timeCandidate.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
        const hasUnavailabilityIcon = Boolean(cell.querySelector('img[src*="indisponibilidade"]'));

        return {
          cellIndex,
          day: Number(dayCandidate.textContent!.trim()),
          startTime: timeMatch ? timeMatch[1] : null,
          endTime: timeMatch ? timeMatch[2] : null,
          unavailable: hasUnavailabilityIcon,
          reason: null as string | null,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    // Keep only the contiguous 1..daysInMonth run — drops leading/trailing adjacent-month padding
    // regardless of which weekday the month starts or ends on (see doc comment above).
    const realMonthDays: typeof withIndex = [];
    let expected = 1;
    for (const entry of withIndex) {
      if (entry.day === expected) {
        realMonthDays.push(entry);
        expected++;
        if (expected > daysInMonth) break;
      }
    }

    return realMonthDays;
  }, daysInMonth);

  // For each day flagged with an indisponibilidade icon, open it to find out whether the
  // indisponibilidade actually covers the whole shift (a real day off) or just part of it (e.g. a
  // lunch break — still a normal working day). The month-view icon alone can't tell these apart
  // (confirmed live: the icon is identical either way), and every technician has several such days
  // a month, so getting this wrong silently zeroed out real work days.
  const result: PortoEscalaDay[] = [];
  for (const entry of parsed) {
    const { cellIndex, ...day } = entry;
    if (!day.unavailable || options.resolveUnavailability === false) {
      result.push(day);
      continue;
    }

    const dateBr = `${String(day.day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
    try {
      const indispEntries = await getIndisponibilidadeEntriesForDay(page, qra, cellIndex, dateBr, monthOffset);
      const shiftStart = day.startTime ? timeToMinutes(day.startTime) : null;
      const shiftEnd = day.endTime ? timeToMinutes(day.endTime) : null;

      if (shiftStart === null || shiftEnd === null || shiftEnd <= shiftStart || !indispEntries.length) {
        // No usable shift window to compare against, or the icon didn't correspond to any listed
        // entry for this exact date (stale render) — fall back to the old conservative behavior.
        result.push(day);
        continue;
      }

      const shiftMinutes = shiftEnd - shiftStart;
      const coveredMinutes = indispEntries.reduce((total, indisp) => {
        const start = timeToMinutes(indisp.start);
        const end = timeToMinutes(indisp.end);
        if (start === null || end === null) return total;
        return total + overlapMinutes(start, end, shiftStart, shiftEnd);
      }, 0);

      const isFullDayOff = coveredMinutes >= (shiftMinutes * (options.fullDayOffPercent ?? DEFAULT_FULL_DAY_OFF_PERCENT)) / 100;
      result.push({
        ...day,
        unavailable: isFullDayOff,
        reason: indispEntries.map((e) => e.reason).filter(Boolean).join(', ') || null,
      });
    } catch {
      // Couldn't inspect this day (navigation hiccup) — keep the conservative "unavailable" flag
      // from the icon rather than silently treating an unknown day as a normal work day.
      result.push(day);
    }
  }

  return result;
}
