/** fetch for the Carros screens: JSON in and out, and a failure becomes an Error with the message the API gave. */
export async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Não foi possível concluir. Tente de novo.');
  return data as T;
}

export const brDate = (value: string | null) => (value ? value.split('-').reverse().join('/') : '—');

const MONEY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (value: number) => MONEY.format(value);

export const brDateTime = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

export const brDay = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));

/** An ISO instant -> the "YYYY-MM-DDTHH:mm" a datetime-local input wants, in Brasília time. */
export function toLocalInput(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
