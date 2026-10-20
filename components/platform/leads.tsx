'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, CYCLE_LABELS, date, errorMessage, useResource } from './api';
import { useNotify } from './notice';
import { Badge, DataTable, ErrorState, Loading, Metric, Panel, Title } from './ui';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

type LeadStatus = 'new' | 'contacted' | 'proposal' | 'won' | 'lost';

type LeadRow = {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string | null;
  technicians: number | null;
  planName: string | null;
  cycle: string | null;
  origin: 'contratar' | 'sob_medida' | 'contato';
  status: LeadStatus;
  organizationId: string | null;
  createdAt: string;
  notesCount: number;
};

type LeadDetail = LeadRow & { message: string | null; notes: Array<{ id: string; text: string; createdAt: string; authorName: string }> };

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'Novo',
  contacted: 'Em contato',
  proposal: 'Proposta enviada',
  won: 'Ganho',
  lost: 'Perdido',
};

const ORIGIN_LABELS: Record<LeadRow['origin'], string> = {
  contratar: 'Contratar',
  sob_medida: 'Sob medida',
  contato: 'Contato',
};

export function Leads() {
  const leads = useResource<{ leads: LeadRow[] }>('/leads');
  const [open, setOpen] = useState<string | null>(null);

  if (leads.loading && !leads.data) return <Loading />;
  if (leads.error) return <ErrorState message={leads.error} onRetry={leads.reload} />;

  const rows = leads.data!.leads.map((lead) => ({
    ...lead,
    statusText: LEAD_STATUS_LABELS[lead.status],
    originText: ORIGIN_LABELS[lead.origin],
    plan: lead.planName ?? (lead.origin === 'sob_medida' ? 'Sob medida' : '—'),
  }));

  return (
    <>
      <Title title="Leads" description="Quem entrou em contato pelo site. Converta em organização quando fechar." />
      <div className="nr-metrics">
        {(['new', 'contacted', 'proposal', 'won'] as LeadStatus[]).map((status) => (
          <Metric key={status} label={LEAD_STATUS_LABELS[status]} value={rows.filter((row) => row.status === status).length} detail="leads" />
        ))}
      </div>
      <Panel title="Contatos recebidos">
        <DataTable
          rows={rows}
          defaultSort="createdAt"
          defaultDescending
          filters={[
            { key: 'statusText', label: 'Estado', options: Object.values(LEAD_STATUS_LABELS) },
            { key: 'originText', label: 'Origem', options: Object.values(ORIGIN_LABELS) },
          ]}
          columns={[
            { key: 'createdAt', label: 'Recebido em', render: (row) => date(row.createdAt, true) },
            { key: 'company', label: 'Empresa', render: (row) => <span>{row.company}<small className="block text-muted-foreground">{row.name}</small></span> },
            { key: 'email', label: 'Contato', render: (row) => <span>{row.email}<small className="block text-muted-foreground">{row.phone ?? ''}</small></span> },
            { key: 'technicians', label: 'Técnicos', render: (row) => String(row.technicians ?? '—') },
            { key: 'plan', label: 'Interesse', render: (row) => `${row.plan}${row.cycle ? ` · ${CYCLE_LABELS[row.cycle]}` : ''}` },
            { key: 'originText', label: 'Origem' },
            { key: 'statusText', label: 'Estado', render: (row) => <Badge>{row.statusText}</Badge> },
          ]}
          actions={(row) => <button onClick={() => setOpen(row.id)}>Abrir</button>}
          emptyText="Nenhum contato ainda. Os formulários do site enviam para cá."
        />
      </Panel>
      {open && <LeadDialog leadId={open} onClose={() => setOpen(null)} onChanged={leads.reload} />}
    </>
  );
}

function LeadDialog({ leadId, onClose, onChanged }: { leadId: string; onClose: () => void; onChanged: () => void }) {
  const notify = useNotify();
  const lead = useResource<{ lead: LeadDetail }>(`/leads/${leadId}`);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function patch(body: Record<string, unknown>, message: string) {
    setSaving(true);
    try {
      await api(`/leads/${leadId}`, { method: 'PATCH', body });
      notify(message);
      lead.reload();
      onChanged();
    } catch (reason) {
      notify(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  const data = lead.data?.lead;

  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="nr-dialog sm:max-w-2xl">
        <DialogTitle>{data ? data.company : 'Lead'}</DialogTitle>
        <DialogDescription>{data ? `${data.name} · recebido em ${date(data.createdAt, true)}` : 'Carregando…'}</DialogDescription>
        {lead.error ? (
          <ErrorState message={lead.error} onRetry={lead.reload} />
        ) : !data ? (
          <Loading />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="nr-info-grid">
              {[
                ['E-mail', data.email],
                ['WhatsApp', data.phone ?? '—'],
                ['Técnicos', data.technicians ?? '—'],
                ['Interesse', `${data.planName ?? (data.origin === 'sob_medida' ? 'Sob medida' : '—')}${data.cycle ? ` · ${CYCLE_LABELS[data.cycle]}` : ''}`],
                ['Origem', ORIGIN_LABELS[data.origin]],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </div>
            {data.message && <div className="nr-note">{data.message}</div>}
            <label className="nr-field">
              Estado
              <select value={data.status} disabled={saving} onChange={(event) => void patch({ status: event.target.value }, 'Estado do lead atualizado.')}>
                {Object.entries(LEAD_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div>
              {data.notes.map((item) => (
                <div className="nr-note" key={item.id}>
                  {item.text}
                  <small>
                    {date(item.createdAt, true)} · {item.authorName}
                  </small>
                </div>
              ))}
              <label className="nr-field">
                Nova anotação
                <textarea value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
              <button
                className="nr-btn mt-2"
                disabled={!note.trim() || saving}
                onClick={async () => {
                  await patch({ note }, 'Anotação salva.');
                  setNote('');
                }}
              >
                Salvar anotação
              </button>
            </div>
            <div className="nr-dialog-actions">
              {data.organizationId ? (
                <Link className="nr-btn primary" href={`/plataforma/organizacoes/${data.organizationId}`}>
                  Abrir organização
                </Link>
              ) : (
                <Link className="nr-btn primary" href={`/plataforma/organizacoes/nova?lead=${data.id}`}>
                  Converter em organização
                </Link>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
