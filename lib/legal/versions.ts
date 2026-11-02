// The legal documents and their current version. Dependency-free (read by the screens, the API and the tests).
//
// The version is a date: change it when the text of that document changes in a way that needs a new agreement. Every
// organization is then asked to accept again (the admin sees a window until they do), and the acceptance is recorded
// per version, with who, when and from where. The texts themselves live in docs/legal/ (and, for the public ones, on the site).

export type LegalDocument = 'terms' | 'privacy' | 'dpa' | 'ai_transfer';

export const LEGAL_DOCUMENTS: Record<LegalDocument, { title: string; path: string; version: string }> = {
  terms: { title: 'Termos de uso e contrato', path: '/termos', version: '2026-11-01' },
  privacy: { title: 'Política de privacidade', path: '/privacidade', version: '2026-11-01' },
  dpa: { title: 'Acordo de tratamento de dados (DPA)', path: '/dpa', version: '2026-11-01' },
  ai_transfer: { title: 'Envio de dados ao provedor de IA', path: '/privacidade#ia', version: '2026-11-01' },
};

/** What the company accepts to have an account (the AI notice is accepted only by who wants to use the assistant). */
export const ACCOUNT_DOCUMENTS: LegalDocument[] = ['terms', 'privacy', 'dpa'];

export const isLegalDocument = (value: unknown): value is LegalDocument => typeof value === 'string' && Object.prototype.hasOwnProperty.call(LEGAL_DOCUMENTS, value);

export type Acceptance = { document: LegalDocument; version: string };

/** The documents (among `required`) whose current version has not been accepted yet. */
export function pendingDocuments(accepted: Acceptance[], required: LegalDocument[] = ACCOUNT_DOCUMENTS): LegalDocument[] {
  return required.filter((document) => !accepted.some((item) => item.document === document && item.version === LEGAL_DOCUMENTS[document].version));
}
