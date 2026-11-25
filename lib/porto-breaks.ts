/**
 * The partial indisponibilidades Porto lists on a technician's day (lunch, "parada autorizada", personal
 * matters...). They are shown on the escala as information only: the reason and the times are kept exactly as
 * Porto returns them, nothing here classifies them, and nothing in payroll or hours reads them.
 * Pure functions, no dependencies.
 */

export interface PortoBreak {
  start: string;
  end: string;
  /** The text Porto returned for the indisponibilidade, unchanged. */
  reason: string;
}

const TIME = /^(\d{1,2}):(\d{2})$/;

function pad(value: string) {
  const match = TIME.exec(value.trim());
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
}

/** Reads what was stored (or just read from Porto) into a clean, ordered list; anything malformed is dropped. */
export function normalizePortoBreaks(value: unknown): PortoBreak[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: PortoBreak[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const { start, end, reason } = item as Record<string, unknown>;
    const from = typeof start === 'string' ? pad(start) : null;
    const to = typeof end === 'string' ? pad(end) : null;
    if (!from || !to) continue;
    const text = typeof reason === 'string' ? reason.trim() : '';
    const key = `${from}|${to}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ start: from, end: to, reason: text });
  }
  return result.sort((left, right) => left.start.localeCompare(right.start) || left.end.localeCompare(right.end));
}

/** One line for the screen: "ALMOCO 12:30–13:30 · PARADA AUTORIZADA PELO GESTOR 16:00–20:00" (empty when there is none). */
export function describePortoBreaks(value: unknown): string {
  return normalizePortoBreaks(value)
    .map((item) => `${item.reason || 'Indisponível'} ${item.start}–${item.end}`)
    .join(' · ');
}
