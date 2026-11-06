'use client';

import { useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { CASE_ORIGIN_LABELS, CASE_PRIORITY_LABELS, CASE_STATUS_LABELS, formatCaseNumber, type CaseStatus } from '@/lib/cases/rules';
import type { SupportCase } from '@/lib/cases/store';
import { useResource } from './api';
import { CaseWorkspace, CreateCaseDialog, statusTone } from './case-workspace';
import { Badge, DataTable, ErrorState, Loading, Panel } from './ui';

type Scope = 'me' | 'none' | 'all';

/** Reports → Casos: the cases of the team, as a list to work through (mine, unassigned, all) and a page for each. */
export function Cases({ initialId = null }: { initialId?: string | null }) {
  const [scope, setScope] = useState<Scope>('me');
  const [status, setStatus] = useState<'open' | 'all' | CaseStatus>('open');
  const [selected, setSelected] = useState<string | null>(initialId);
  const [creating, setCreating] = useState(false);
  const list = useResource<{ cases: SupportCase[] }>(selected ? null : `/cases?status=${status}&owner=${scope}`);

  if (selected) {
    return (
      <div className="cs-page">
        <button className="nr-btn" onClick={() => setSelected(null)}>
          <ArrowLeft size={16} />
          Voltar aos casos
        </button>
        <Panel>
          <div className="nr-pad">
            <CaseWorkspace caseId={selected} />
          </div>
        </Panel>
      </div>
    );
  }

  const rows = (list.data?.cases ?? []).map((item) => ({
    ...item,
    statusText: CASE_STATUS_LABELS[item.status],
    priorityText: CASE_PRIORITY_LABELS[item.priority],
    originText: CASE_ORIGIN_LABELS[item.origin],
    ownerText: item.ownerName ?? 'Sem responsável',
    who: item.organizationName ?? item.contactName ?? '—',
    numberText: formatCaseNumber(item.number),
  }));

  return (
    <div className="cs-page">
      <div className="cs-toolbar">
        <div className="lc-filters" role="tablist" aria-label="Quais casos">
          {([['me', 'Meus casos'], ['none', 'Sem responsável'], ['all', 'Todos']] as const).map(([value, label]) => (
            <button key={value} role="tab" aria-selected={scope === value} onClick={() => setScope(value)}>{label}</button>
          ))}
        </div>
        <select aria-label="Situação" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
          <option value="open">Abertos</option>
          <option value="all">Todos os status</option>
          {(['new', 'working', 'waiting', 'resolved'] as const).map((value) => (
            <option key={value} value={value}>{CASE_STATUS_LABELS[value]}</option>
          ))}
        </select>
        <button className="nr-btn primary cs-new" onClick={() => setCreating(true)}>
          <Plus size={16} />
          Novo caso
        </button>
      </div>
      <Panel>
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : (
          <DataTable
            rows={rows}
            defaultSort="updatedAt"
            defaultDescending
            emptyText={scope === 'me' ? 'Nenhum caso seu em aberto. Transforme uma conversa do Livechat em caso para acompanhá-la aqui.' : 'Nenhum caso por aqui.'}
            filters={[{ key: 'priorityText', label: 'Prioridade', options: Object.values(CASE_PRIORITY_LABELS) }]}
            columns={[
              { key: 'numberText', label: 'Caso', render: (row) => <button className="cs-link" onClick={() => setSelected(row.id)}>{row.numberText}</button> },
              { key: 'subject', label: 'Assunto', render: (row) => <button className="cs-link cs-subject-link" onClick={() => setSelected(row.id)}>{row.subject}</button> },
              { key: 'who', label: 'Contato', render: (row) => <span>{row.who}{row.contactName && row.organizationName ? <small className="block">{row.contactName}</small> : null}</span> },
              { key: 'statusText', label: 'Status', render: (row) => <Badge tone={statusTone(row.status)}>{row.statusText}</Badge> },
              { key: 'priorityText', label: 'Prioridade' },
              { key: 'ownerText', label: 'Responsável' },
              { key: 'originText', label: 'Origem' },
              { key: 'updatedAt', label: 'Atualizado', render: (row) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(row.updatedAt)) },
            ]}
          />
        )}
      </Panel>
      {creating ? (
        <CreateCaseDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setSelected(id);
          }}
        />
      ) : null}
    </div>
  );
}
