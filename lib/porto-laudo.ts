// Dependency-free helpers of the laudo grace period (Configurações → prazo para preencher o laudo),
// kept apart from the hours job so they can be tested without a browser or a database.

/** "DD/MM/YYYY" + "HH:MM" read on Porto (Brasília, no DST since 2019) as an instant. */
export function brasiliaInstant(brDate: string, time: string): Date {
  const [day, month, year] = brDate.split('/');
  return new Date(`${year}-${month}-${day}T${time.slice(0, 5).padStart(5, '0')}:00-03:00`);
}

export function formatBrasiliaDateTime(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

/**
 * When the technician's time to fill in the laudo ends (`graceHours` after the service's "Concluído")
 * and whether it is still running at `now`. A run inside the window records "LAUDO PENDENTE" and
 * recomputes the day next time; after it, a missing laudo becomes the warning, which is never undone.
 */
export function laudoGraceWindow(input: { endDate: string; workEnd: string; graceHours: number; now?: number }) {
  const graceEndsAt = new Date(brasiliaInstant(input.endDate, input.workEnd).getTime() + input.graceHours * 3_600_000);
  return { graceEndsAt, pending: (input.now ?? Date.now()) < graceEndsAt.getTime() };
}
