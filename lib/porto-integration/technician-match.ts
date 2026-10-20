import { sql } from '../db';
import type { Technician } from '../types';

/**
 * Resolves an internal technician by Porto's QRA code. Porto gives an exact, stable identifier
 * (unlike the truncated names in some of its listings), so this is a direct lookup rather than
 * the fuzzy name-matching used for spreadsheet imports elsewhere in the app.
 */
export async function resolveTechnicianByQra(organizationId: string, qra: string): Promise<Technician | null> {
  if (!qra) return null;

  const rows = await sql`
    SELECT *
    FROM technicians
    WHERE organization_id = ${organizationId}
      AND qra = ${qra}
      AND status = 'active'
      AND deleted_at IS NULL
    LIMIT 1
  `;

  return (rows[0] as Technician | undefined) ?? null;
}
