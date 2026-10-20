'use client';

import { useState } from 'react';
import { auditLabel, date, useResource } from './api';
import { Badge, DataTable, ErrorState, Loading, Panel, Title } from './ui';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export type AuditEvent = {
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  impersonationId: string | null;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
};

const ACTOR_ROLE_LABELS: Record<string, string> = {
  platform_owner: 'Dono da plataforma',
  admin: 'Administrador',
  technician: 'Técnico',
  system: 'Sistema',
};

/** Audit trail rows, newest first; a row opens its full details (before/after). */
export function AuditTable({ organizationId, showOrganization = false }: { organizationId?: string; showOrganization?: boolean }) {
  const query = organizationId ? `?organizationId=${organizationId}&limit=200` : '?limit=200';
  const { data, error, loading, reload } = useResource<{ events: AuditEvent[] }>(`/audit${query}`);
  const [open, setOpen] = useState<AuditEvent | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const rows = (data?.events ?? []).map((event) => ({
    ...event,
    label: auditLabel(event.action),
    actor: event.actorName ?? ACTOR_ROLE_LABELS[event.actorRole ?? ''] ?? '—',
    role: ACTOR_ROLE_LABELS[event.actorRole ?? ''] ?? event.actorRole ?? '—',
  }));

  return (
    <>
      <DataTable
        rows={rows}
        defaultSort="createdAt"
        defaultDescending
        filters={[{ key: 'role', label: 'Quem', options: [...new Set(rows.map((row) => row.role))] }]}
        columns={[
          { key: 'createdAt', label: 'Quando', render: (row) => date(row.createdAt, true) },
          { key: 'label', label: 'Ação', render: (row) => (row.impersonationId ? <span>{row.label} <Badge>Dono na conta</Badge></span> : row.label) },
          ...(showOrganization ? [{ key: 'organizationName', label: 'Organização', render: (row: (typeof rows)[number]) => row.organizationName ?? 'Plataforma' }] : []),
          { key: 'actor', label: 'Quem' },
        ]}
        actions={(row) => <button onClick={() => setOpen(row)}>Detalhes</button>}
        emptyText="Nenhum evento registrado ainda."
      />
      {open && (
        <Dialog open onOpenChange={(value) => !value && setOpen(null)}>
          <DialogContent className="nr-dialog sm:max-w-2xl">
            <DialogTitle>{auditLabel(open.action)}</DialogTitle>
            <DialogDescription>
              {date(open.createdAt, true)} · {open.actorName ?? ACTOR_ROLE_LABELS[open.actorRole ?? ''] ?? '—'}
            </DialogDescription>
            <pre className="nr-code max-h-96 overflow-auto whitespace-pre-wrap text-xs">
              {open.details ? JSON.stringify(open.details, null, 2) : 'Sem detalhes adicionais.'}
            </pre>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export function AuditScreen() {
  return (
    <>
      <Title title="Auditoria" description="Tudo o que foi feito na plataforma e dentro das organizações, do mais recente ao mais antigo." />
      <Panel title="Eventos">
        <AuditTable showOrganization />
      </Panel>
    </>
  );
}
