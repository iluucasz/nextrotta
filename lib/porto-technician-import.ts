/**
 * Rules for creating technicians from the socorristas the Porto portal lists. Pure on purpose (no
 * database, no browser): the route feeds it what the admin picked and the QRAs already taken.
 *
 * Porto gives a QRA, a name (usually UPPERCASE) and a status — no e-mail, so an imported technician
 * starts without a login; the admin completes it with "Editar" (e-mail + password) when they want
 * the person to enter the system.
 */

export type PortoCandidate = { qra?: unknown; name?: unknown; status?: unknown };

export type PlannedTechnician = {
  qra: string;
  name: string;
  /** Name exactly as Porto writes it: the robot links a service to a technician by this prefix. */
  portoName: string;
  status: 'active' | 'inactive';
};

export type SkipReason = 'invalid' | 'duplicate_in_request' | 'already_registered';

export type SkippedCandidate = { qra: string; name: string; reason: SkipReason };

export const MAX_PORTO_IMPORT = 200;

const LOWERCASE_WORDS = new Set(['da', 'de', 'di', 'do', 'das', 'dos', 'du', 'e']);

/** "JOÃO DA SILVA" → "João da Silva". Names that already mix cases are left as typed. */
export function tidyPortoName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name !== name.toUpperCase()) return name;

  return name
    .toLowerCase()
    .split(' ')
    .map((word, index) => (index > 0 && LOWERCASE_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

/** Porto marks the ones who left as "INATIVO"/"BLOQUEADO"…; only an explicit "ATIVO" counts as active. */
export function portoStatusIsActive(status: unknown): boolean {
  return /^ativ/i.test(String(status ?? '').trim());
}

export function planPortoImport(
  candidates: PortoCandidate[],
  activeQras: ReadonlySet<string>,
): { toCreate: PlannedTechnician[]; skipped: SkippedCandidate[] } {
  const toCreate: PlannedTechnician[] = [];
  const skipped: SkippedCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const qra = String(candidate.qra ?? '').trim();
    const portoName = String(candidate.name ?? '').replace(/\s+/g, ' ').trim();

    // Same shape listSocorristas accepts: a QRA is 4 to 10 digits.
    if (!/^\d{4,10}$/.test(qra) || !portoName || portoName.length > 120) {
      skipped.push({ qra, name: portoName, reason: 'invalid' });
      continue;
    }
    if (seen.has(qra)) {
      skipped.push({ qra, name: portoName, reason: 'duplicate_in_request' });
      continue;
    }
    seen.add(qra);

    if (activeQras.has(qra)) {
      skipped.push({ qra, name: portoName, reason: 'already_registered' });
      continue;
    }

    toCreate.push({
      qra,
      portoName,
      name: tidyPortoName(portoName),
      status: portoStatusIsActive(candidate.status) ? 'active' : 'inactive',
    });
  }

  return { toCreate, skipped };
}
