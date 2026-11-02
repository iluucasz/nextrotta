'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, date, errorMessage, useResource } from './api';
import { useNotify } from './notice';
import { Badge, DataTable, ErrorState, Loading, Metric, Panel, Title } from './ui';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

type RequestStatus = 'received' | 'in_progress' | 'answered' | 'rejected';

type PrivacyRequest = {
  id: string;
  name: string;
  email: string;
  organizationHint: string | null;
  organizationId: string | null;
  organizationName: string | null;
  kind: string;
  kindLabel: string;
  message: string | null;
  status: RequestStatus;
  receivedAt: string;
  dueAt: string;
  answeredAt: string | null;
  responseNote: string | null;
  overdue: boolean;
};

const STATUS_LABELS: Record<RequestStatus, string> = {
  received: 'Novo',
  in_progress: 'Em andamento',
  answered: 'Respondido',
  rejected: 'Recusado',
};

/** Requests from the people the data is about (LGPD art. 18). The legal deadline is 15 days. */
export function PrivacyRequests() {
  const requests = useResource<{ requests: PrivacyRequest[] }>('/privacy-requests');
  const [open, setOpen] = useState<string | null>(null);

  if (requests.loading && !requests.data) return <Loading />;
  if (requests.error) return <ErrorState message={requests.error} onRetry={requests.reload} />;

  const rows = requests.data!.requests.map((item) => ({
    ...item,
    statusText: item.overdue ? 'Atrasado' : STATUS_LABELS[item.status],
    company: item.organizationName ?? item.organizationHint ?? '—',
  }));
  const openRows = rows.filter((row) => row.status === 'received' || row.status === 'in_progress');

  return (
    <>
      <Title title="Privacidade" description="Pedidos de titulares de dados (LGPD). Prazo de resposta: 15 dias." />
      <div className="nr-metrics">
        <Metric label="Em aberto" value={openRows.length} detail="pedidos" />
        <Metric label="Atrasados" value={rows.filter((row) => row.overdue).length} detail="passaram do prazo" />
        <Metric label="Respondidos" value={rows.filter((row) => row.status === 'answered').length} detail="pedidos" />
      </div>
      <Panel title="Pedidos recebidos">
        <DataTable
          rows={rows}
          defaultSort="dueAt"
          filters={[{ key: 'statusText', label: 'Estado', options: ['Novo', 'Em andamento', 'Atrasado', 'Respondido', 'Recusado'] }]}
          columns={[
            { key: 'receivedAt', label: 'Recebido em', render: (row) => date(row.receivedAt, true) },
            { key: 'name', label: 'Titular', render: (row) => <span>{row.name}<small className="block text-muted-foreground">{row.email}</small></span> },
            { key: 'kindLabel', label: 'Pedido' },
            { key: 'company', label: 'Empresa' },
            { key: 'dueAt', label: 'Responder até', render: (row) => date(row.dueAt, false) },
            { key: 'statusText', label: 'Estado', render: (row) => <Badge>{row.statusText}</Badge> },
          ]}
          actions={(row) => <button onClick={() => setOpen(row.id)}>Abrir</button>}
          emptyText="Nenhum pedido ainda. A página “Privacidade e seus direitos” do site envia para cá."
        />
      </Panel>
      {open && <RequestDialog item={rows.find((row) => row.id === open)!} onClose={() => setOpen(null)} onChanged={requests.reload} />}
    </>
  );
}

function RequestDialog({ item, onClose, onChanged }: { item: PrivacyRequest; onClose: () => void; onChanged: () => void }) {
  const notify = useNotify();
  const [note, setNote] = useState(item.responseNote ?? '');
  const [saving, setSaving] = useState(false);
  const closed = item.status === 'answered' || item.status === 'rejected';

  async function patch(body: Record<string, unknown>, message: string) {
    setSaving(true);
    try {
      await api(`/privacy-requests/${item.id}`, { method: 'PATCH', body });
      notify(message);
      onChanged();
      onClose();
    } catch (reason) {
      notify(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="nr-dialog sm:max-w-2xl">
        <DialogTitle>{item.kindLabel}</DialogTitle>
        <DialogDescription>{`${item.name} · recebido em ${date(item.receivedAt, true)} · responder até ${date(item.dueAt, false)}`}</DialogDescription>
        <div className="flex flex-col gap-4">
          <div className="nr-info-grid">
            {[
              ['E-mail', item.email],
              ['Empresa informada', item.organizationHint ?? '—'],
              ['Estado', STATUS_LABELS[item.status]],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </div>
          {item.message && <div className="nr-note">{item.message}</div>}
          {item.organizationId && (
            <Link className="nr-btn" href={`/plataforma/organizacoes/${item.organizationId}`}>
              Abrir {item.organizationName ?? 'a organização'}
            </Link>
          )}
          <label className="nr-field">
            O que foi respondido ao titular
            <textarea value={note} disabled={closed} onChange={(event) => setNote(event.target.value)} />
          </label>
          {!closed && (
            <div className="nr-dialog-actions">
              {item.status === 'received' && (
                <button className="nr-btn" disabled={saving} onClick={() => void patch({ status: 'in_progress' }, 'Pedido em andamento.')}>
                  Marcar em andamento
                </button>
              )}
              <button className="nr-btn" disabled={saving || !note.trim()} onClick={() => void patch({ status: 'rejected', responseNote: note }, 'Pedido recusado e registrado.')}>
                Recusar com justificativa
              </button>
              <button className="nr-btn primary" disabled={saving || !note.trim()} onClick={() => void patch({ status: 'answered', responseNote: note }, 'Resposta registrada.')}>
                Registrar resposta
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
