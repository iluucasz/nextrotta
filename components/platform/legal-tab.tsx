'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { api, date, errorMessage, useResource } from './api';
import { useNotify } from './notice';
import { Badge, DataTable, Empty, ErrorState, Loading, Panel } from './ui';

type Acceptance = { key: string; document: string; version: string; acceptedAt: string; source: string; ip: string | null; who: string | null; email: string | null };
type Certificate = { id: string; title: string; createdAt: string; size: number | null; fileName: string | null };
type LegalData = { acceptances: Acceptance[]; certificates: Certificate[]; complete: boolean };

const DOCUMENT_LABEL: Record<string, string> = {
  terms: 'Termos de Uso',
  privacy: 'Política de Privacidade',
  dpa: 'Acordo de Tratamento de Dados (DPA)',
  ai_transfer: 'Envio de dados ao assistente de IA',
};
const SOURCE_LABEL: Record<string, string> = { app: 'No sistema', signup: 'No cadastro pelo site', owner: 'Pelo dono' };

const kilobytes = (size: number | null) => (size == null ? '—' : `${Math.max(1, Math.round(size / 1024))} KB`);

/** Organization detail → Termos: what the company accepted and the certificate of acceptance (made by itself, kept in its Biblioteca). */
export function LegalTab({ organizationId }: { organizationId: string }) {
  const notify = useNotify();
  const data = useResource<LegalData>(`/organizations/${organizationId}/legal`);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      await api(`/organizations/${organizationId}/legal`, { method: 'POST', body: {} });
      notify('Comprovante gerado e guardado na Biblioteca da empresa.');
      data.reload();
    } catch (reason) {
      notify(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;
  const { acceptances, certificates, complete } = data.data!;
  const rows = acceptances.map((row) => ({ ...row, id: row.key }));

  return (
    <div className="space-y-6">
      <Panel
        title="Comprovante de aceite"
        description="Gerado sozinho quando a empresa aceita os termos, a privacidade e o DPA. Fica na Biblioteca da empresa (só para administradores)."
        action={
          <button className="nr-btn primary" disabled={!complete || busy} onClick={() => void generate()}>
            {certificates.length ? 'Gerar de novo' : 'Gerar comprovante'}
          </button>
        }
      >
        {!complete ? (
          <Empty title="Ainda sem comprovante" text="A empresa precisa aceitar os três documentos (termos, privacidade e DPA) para o comprovante existir." />
        ) : certificates.length === 0 ? (
          <Empty title="Nenhum comprovante gerado ainda" text="A empresa já aceitou os três documentos. Use o botão acima para gerar o comprovante." />
        ) : (
          <DataTable
            rows={certificates}
            columns={[
              { key: 'title', label: 'Documento' },
              { key: 'createdAt', label: 'Gerado em', render: (row) => date(row.createdAt, true) },
              { key: 'size', label: 'Tamanho', render: (row) => kilobytes(row.size) },
            ]}
            actions={(row) => (
              <a className="nr-btn" href={`/api/platform/organizations/${organizationId}/legal/${row.id}/file`}>
                <Download size={15} /> Baixar
              </a>
            )}
          />
        )}
      </Panel>

      <Panel title="Aceites registrados" description="Cada aceite guarda a versão do texto, o momento, quem aceitou e o endereço IP.">
        <DataTable
          rows={rows}
          defaultSort="acceptedAt"
          defaultDescending
          emptyText="A empresa ainda não aceitou nenhum documento."
          columns={[
            { key: 'document', label: 'Documento', render: (row) => DOCUMENT_LABEL[row.document] ?? row.document },
            { key: 'version', label: 'Versão', render: (row) => <Badge tone="neutral">{row.version}</Badge> },
            { key: 'acceptedAt', label: 'Quando', render: (row) => date(row.acceptedAt, true) },
            { key: 'who', label: 'Quem aceitou', render: (row) => (row.who ? `${row.who}${row.email ? ` · ${row.email}` : ''}` : '—') },
            { key: 'source', label: 'Onde', render: (row) => SOURCE_LABEL[row.source] ?? row.source },
            { key: 'ip', label: 'IP' },
          ]}
        />
      </Panel>
    </div>
  );
}
