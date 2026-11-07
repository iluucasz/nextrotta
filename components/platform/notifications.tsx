'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api, date, useResource } from './api';
import { NoticeInbox } from './notice-inbox';
import { useIsOwner } from './role';
import { useNotify } from './notice';
import { Badge, Confirm, DataTable, Editor, ErrorState, Loading, Panel, Title, type Field } from './ui';

type PlatformNotification = {
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  severity: 'info' | 'success' | 'warning' | 'critical';
  title: string;
  body: string;
  href: string | null;
  audience: 'admins' | 'everyone';
  createdAt: string;
  expiresAt: string | null;
  archived: boolean;
  reads: number;
};

const SEVERITY_LABELS = { info: 'Informação', success: 'Boa notícia', warning: 'Atenção', critical: 'Urgente' };

/** The team's notifications: the inbox of what is happening in the companies, and (for admins) the notices published to the customers. */
export function Notifications() {
  const owner = useIsOwner();
  const [tab, setTab] = useState<'inbox' | 'clients'>('inbox');
  return (
    <>
      <Title
        title="Notificações"
        description={owner ? 'O que está acontecendo nas empresas e na plataforma, e os avisos que você publica para os clientes.' : 'O que está acontecendo no atendimento.'}
      />
      {owner && (
        <div className="nr-tabs" role="tablist" aria-label="Tipo de notificação">
          <button role="tab" aria-selected={tab === 'inbox'} onClick={() => setTab('inbox')}>
            Alertas da equipe
          </button>
          <button role="tab" aria-selected={tab === 'clients'} onClick={() => setTab('clients')}>
            Avisos aos clientes
          </button>
        </div>
      )}
      {owner && tab === 'clients' ? <ClientNotices /> : <NoticeInbox />}
    </>
  );
}

function ClientNotices() {
  const notify = useNotify();
  const list = useResource<{ notifications: PlatformNotification[] }>('/notifications');
  const organizations = useResource<{ organizations: { id: string; name: string }[] }>('/organizations');
  const [creating, setCreating] = useState(false);
  const [retracting, setRetracting] = useState<PlatformNotification | null>(null);

  if ((list.loading && !list.data) || (organizations.loading && !organizations.data)) return <Loading />;
  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />;

  const fields: Field[] = [
    {
      key: 'organizationId',
      label: 'Para quem',
      type: 'select',
      options: (organizations.data?.organizations ?? []).map((item) => ({ value: item.id, label: item.name })),
      hint: 'Deixe em branco para avisar todas as empresas.',
    },
    { key: 'title', label: 'Título', required: true, hint: 'Até 140 caracteres. Diga o que aconteceu ou o que a pessoa precisa fazer.' },
    { key: 'body', label: 'Texto (opcional)', type: 'textarea' },
    {
      key: 'severity',
      label: 'Importância',
      type: 'select',
      required: true,
      options: Object.entries(SEVERITY_LABELS).map(([value, label]) => ({ value, label })),
    },
    { key: 'href', label: 'Link dentro do sistema (opcional)', hint: 'Por exemplo: /admin/assinatura' },
    { key: 'expiresOn', label: 'Mostrar até (opcional)', type: 'date' },
  ];

  const rows = (list.data?.notifications ?? []).map((item) => ({
    ...item,
    toText: item.organizationName ?? 'Todas as empresas',
    severityText: SEVERITY_LABELS[item.severity],
    stateText: item.archived ? 'Retirada' : item.expiresAt && new Date(item.expiresAt) < new Date() ? 'Expirada' : 'No ar',
  }));

  return (
    <>
      <Panel
        title="Avisos publicados"
        description="Aparecem no sino do sistema das empresas: para todas, ou só para uma. As notificações automáticas de cada empresa (cobranças, chamados, robô do Porto) saem sozinhas."
        action={
          <button className="nr-btn primary" onClick={() => setCreating(true)}>
            <Plus size={15} />
            Nova notificação
          </button>
        }
      >
        <DataTable
          rows={rows}
          defaultSort="createdAt"
          defaultDescending
          filters={[
            { key: 'stateText', label: 'Estado', options: ['No ar', 'Expirada', 'Retirada'] },
            { key: 'severityText', label: 'Importância', options: Object.values(SEVERITY_LABELS) },
          ]}
          columns={[
            { key: 'title', label: 'Aviso' },
            { key: 'toText', label: 'Para' },
            { key: 'severityText', label: 'Importância', render: (row) => <Badge>{row.severityText}</Badge> },
            { key: 'createdAt', label: 'Publicado', render: (row) => date(row.createdAt, true) },
            { key: 'reads', label: 'Lidas', render: (row) => `${row.reads}` },
            { key: 'stateText', label: 'Estado', render: (row) => <Badge>{row.stateText}</Badge> },
          ]}
          actions={(row) => (!row.archived ? <button onClick={() => setRetracting(row)}>Retirar</button> : null)}
          emptyText="Nenhum aviso publicado ainda."
        />
      </Panel>

      {creating && (
        <Editor
          title="Nova notificação"
          description="Ela aparece no sino de cada administrador. Quem já tem a empresa criada vê; empresas novas não veem avisos antigos."
          fields={fields}
          initial={{ organizationId: '', title: '', body: '', severity: 'info', href: '', expiresOn: '' }}
          submit="Publicar"
          onClose={() => setCreating(false)}
          onSave={async (values) => {
            await api('/notifications', { body: values });
            notify('Notificação publicada.');
            list.reload();
          }}
        />
      )}

      {retracting && (
        <Confirm
          title={`Retirar “${retracting.title}”?`}
          description="Ela sai do sino de todas as empresas. Nada é apagado: fica registrada na auditoria."
          onClose={() => setRetracting(null)}
          onConfirm={async () => {
            await api(`/notifications/${retracting.id}`, { method: 'DELETE' });
            notify('Notificação retirada.');
            list.reload();
          }}
        />
      )}
    </>
  );
}
