export function formatCurrency(value: number | string | null | undefined): string {
  const numericValue = Number(value ?? 0);

  return numericValue.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function formatNumber(value: number | string | null | undefined): string {
  return Number(value ?? 0).toLocaleString('pt-BR');
}

export function formatPercent(value: number | string | null | undefined): string {
  return `${Number(value ?? 0).toLocaleString('pt-BR', {
    maximumFractionDigits: 2,
  })}%`;
}

export function formatHours(value: number | string | null | undefined): string {
  return `${Number(value ?? 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}h`;
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '-';

  const normalized = String(value).trim();
  const directMatch = normalized.match(/(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?/);

  if (directMatch) {
    const [, hours, minutes] = directMatch;
    return `${hours.padStart(2, '0')}H${minutes}`;
  }

  return normalized;
}

export function formatTimeRange(startTime: string | null | undefined, endTime: string | null | undefined): string {
  if (!startTime) return '-';
  if (!endTime) return formatTime(startTime);
  return `${formatTime(startTime)} - ${formatTime(endTime)}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-';

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('pt-BR');
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString('pt-BR');
}

export function parseMoney(value: unknown): number {
  if (typeof value === 'number') return value;

  const normalized = String(value ?? '0')
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .toLowerCase();
}

export function yearFromCompetence(competence: string | null | undefined): string {
  const match = String(competence ?? '').match(/20\d{2}/);
  return match?.[0] ?? 'Sem ano';
}

export function monthKeyFromDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 7);
}

const competenceMonthAliases: Record<string, string> = {
  jan: '01',
  janeiro: '01',
  fev: '02',
  fevereiro: '02',
  mar: '03',
  marco: '03',
  abr: '04',
  abril: '04',
  mai: '05',
  maio: '05',
  jun: '06',
  junho: '06',
  jul: '07',
  julho: '07',
  ago: '08',
  agosto: '08',
  set: '09',
  setembro: '09',
  out: '10',
  outubro: '10',
  nov: '11',
  novembro: '11',
  dez: '12',
  dezembro: '12',
};

export function normalizeCompetenceMonth(value: unknown): string {
  const normalizedValue = String(value ?? '').trim();
  if (!normalizedValue) return '';

  const yearMonthMatch = normalizedValue.match(/^(20\d{2})-(\d{2})/);
  if (yearMonthMatch) {
    return `${yearMonthMatch[1]}-${yearMonthMatch[2]}`;
  }

  const monthYearMatch = normalizedValue.match(/^(\d{2})[/.\-](20\d{2})/);
  if (monthYearMatch) {
    return `${monthYearMatch[2]}-${monthYearMatch[1]}`;
  }

  const namedMonthMatch = normalizedValue.match(/^([A-Za-zÀ-ÿ]{3,12})[^\d]*(20\d{2})/);
  if (namedMonthMatch) {
    const monthAlias = competenceMonthAliases[normalizeText(namedMonthMatch[1])];
    if (monthAlias) {
      return `${namedMonthMatch[2]}-${monthAlias}`;
    }
  }

  return '';
}

export function resolveCompetenceMonth(competenceValue: unknown, fallbackDate?: string | Date | null): string {
  return normalizeCompetenceMonth(competenceValue) || monthKeyFromDate(fallbackDate);
}

export function compactName(value: string | null | undefined): string {
  const parts = String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length <= 2) return parts.join(' ');
  return `${parts[0]} ${parts[parts.length - 1]}`;
}
