import { sql } from '../db';
import { ACCOUNT_DOCUMENTS, LEGAL_DOCUMENTS, pendingDocuments, type Acceptance, type LegalDocument } from './versions';

/** What the organization has accepted (by any of its admins): the company is the party of the agreement. */
export async function acceptancesOf(organizationId: string): Promise<Array<Acceptance & { acceptedAt: string }>> {
  const rows = await sql`
    SELECT DISTINCT ON (document, version) document, version, accepted_at
    FROM legal_acceptances
    WHERE organization_id = ${organizationId}
    ORDER BY document, version, accepted_at DESC
  `;
  return rows.map((row) => ({ document: row.document as LegalDocument, version: String(row.version), acceptedAt: new Date(row.accepted_at as string).toISOString() }));
}

export async function pendingFor(organizationId: string, required: LegalDocument[] = ACCOUNT_DOCUMENTS): Promise<LegalDocument[]> {
  return pendingDocuments(await acceptancesOf(organizationId), required);
}

export async function hasAccepted(organizationId: string, document: LegalDocument): Promise<boolean> {
  return (await pendingFor(organizationId, [document])).length === 0;
}

/** Records the acceptance of the CURRENT version of each document, with who, from where and when. */
export async function recordAcceptances(input: {
  organizationId: string;
  userId: string | null;
  documents: LegalDocument[];
  ip: string | null;
  userAgent: string | null;
  source: 'signup' | 'app' | 'owner';
}): Promise<void> {
  for (const document of input.documents) {
    await sql`
      INSERT INTO legal_acceptances (organization_id, user_id, document, version, ip, user_agent, source)
      VALUES (${input.organizationId}, ${input.userId}, ${document}, ${LEGAL_DOCUMENTS[document].version}, ${input.ip}, ${(input.userAgent ?? '').slice(0, 300) || null}, ${input.source})
    `;
  }
}
