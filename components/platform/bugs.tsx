'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, date, errorMessage, useResource } from './api';
import { useNotify } from './notice';
import {
  formatTicketNumber,
  REPORT_TYPE_LABELS,
  reportStatusLabels,
  SUPPORT_CATEGORY_LABELS,
  type ReportType,
  type SupportCategory,
} from '@/lib/reports';
import {
  Badge,
  DataTable,
  Empty,
  ErrorState,
  Loading,
  Metric,
  Panel,
  Title,
} from './ui';

export type BugStatus = 'new' | 'investigating' | 'resolved' | 'not_reproduced';
export type BugPriority = 'low' | 'medium' | 'high' | 'critical';

export type BugRow = {
  id: string;
  type: ReportType;
  ticketNumber: number | null;
  supportCategory: SupportCategory | null;
  organizationId: string;
  organizationName: string | null;
  userName: string | null;
  userEmail: string | null;
  title: string;
  description: string;
  pageUrl: string | null;
  userAgent: string | null;
  appVersion: string | null;
  hasScreenshot: boolean;
  status: BugStatus;
  priority: BugPriority;
  messagesCount: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

type BugMessage = {
  id: string;
  authorName: string;
  fromOwner: boolean;
  internal: boolean;
  text: string;
  createdAt: string;
};

export const BUG_STATUS_LABELS: Record<BugStatus, string> = {
  new: 'Novo',
  investigating: 'Em análise',
  resolved: 'Resolvido',
  not_reproduced: 'Não reproduzido',
};

export const BUG_PRIORITY_LABELS: Record<BugPriority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  critical: 'Crítica',
};

/** Inbox table, also used inside an organization's detail page. */
export function BugTable({
  bugs,
  showOrganization = true,
}: {
  bugs: BugRow[];
  showOrganization?: boolean;
}) {
  const rows = bugs.map((bug) => ({
    ...bug,
    typeText: REPORT_TYPE_LABELS[bug.type ?? 'bug'],
    number: bug.ticketNumber ?? 0,
    categoryText: bug.supportCategory ? SUPPORT_CATEGORY_LABELS[bug.supportCategory] : '',
    statusText: reportStatusLabels(bug.type ?? 'bug')[bug.status],
    priorityText: BUG_PRIORITY_LABELS[bug.priority],
    organization: bug.organizationName ?? '—',
  }));
  return (
    <DataTable
      rows={rows}
      defaultSort="createdAt"
      defaultDescending
      filters={[
        {
          key: 'typeText',
          label: 'Tipo',
          options: Object.values(REPORT_TYPE_LABELS),
        },
        {
          key: 'statusText',
          label: 'Estado',
          options: [
            ...new Set([
              ...Object.values(BUG_STATUS_LABELS),
              ...Object.values(reportStatusLabels('suggestion')),
              ...Object.values(reportStatusLabels('support')),
            ]),
          ],
        },
        {
          key: 'priorityText',
          label: 'Prioridade',
          options: Object.values(BUG_PRIORITY_LABELS),
        },
        ...(showOrganization
          ? [
              {
                key: 'organization',
                label: 'Organização',
                options: [...new Set(rows.map((row) => row.organization))],
              },
            ]
          : []),
      ]}
      columns={[
        {
          key: 'number',
          label: 'Nº',
          render: (row) => (
            <Link href={`/plataforma/reports/${row.id}`} className="font-mono">
              {formatTicketNumber(row.ticketNumber)}
            </Link>
          ),
        },
        {
          key: 'title',
          label: 'Report',
          render: (row) => (
            <Link href={`/plataforma/reports/${row.id}`}>{row.title}</Link>
          ),
        },
        {
          key: 'typeText',
          label: 'Tipo',
          render: (row) => (
            <span>
              <Badge>{row.typeText}</Badge>
              {row.categoryText ? <small className="block text-muted-foreground">{row.categoryText}</small> : null}
            </span>
          ),
        },
        ...(showOrganization
          ? [{ key: 'organization', label: 'Organização' }]
          : []),
        {
          key: 'userName',
          label: 'Usuário',
          render: (row) => row.userName ?? '—',
        },
        {
          key: 'pageUrl',
          label: 'Página',
          render: (row) => (
            <span className="block max-w-56 truncate">
              {row.pageUrl ? new URL(row.pageUrl, 'https://x').pathname : '—'}
            </span>
          ),
        },
        {
          key: 'createdAt',
          label: 'Recebido em',
          render: (row) => date(row.createdAt, true),
        },
        {
          key: 'priorityText',
          label: 'Prioridade',
          render: (row) => <Badge>{row.priorityText}</Badge>,
        },
        {
          key: 'statusText',
          label: 'Estado',
          render: (row) => <Badge>{row.statusText}</Badge>,
        },
      ]}
      actions={(row) => (
        <Link href={`/plataforma/reports/${row.id}`}>Abrir</Link>
      )}
      emptyText="Nenhum report recebido. Os clientes podem enviar bugs e sugestões pelo botão “Reports” no sistema."
    />
  );
}

export function Bugs({ id }: { id?: string }) {
  const bugs = useResource<{ bugs: BugRow[] }>(id ? null : '/bugs');
  const [type, setType] = useState<ReportType | 'all'>('all');
  if (id) return <BugDetail id={id} />;
  if (bugs.loading && !bugs.data) return <Loading />;
  if (bugs.error)
    return <ErrorState message={bugs.error} onRetry={bugs.reload} />;

  const list = bugs.data!.bugs.filter(
    (report) => type === 'all' || (report.type ?? 'bug') === type,
  );
  const labels =
    type === 'suggestion' || type === 'support'
      ? reportStatusLabels(type)
      : type === 'all'
        ? {
            new: 'Recebidos',
            investigating: 'Em análise',
            resolved: 'Concluídos',
            not_reproduced: 'Encerrados',
          }
        : BUG_STATUS_LABELS;
  return (
    <>
      <Title
        title="Reports"
        description="Chamados de suporte, bugs e sugestões dos clientes, com acompanhamento e conversa em um só lugar."
      />
      <div className="nr-tabs" role="tablist" aria-label="Tipo de report">
        {(['all', 'support', 'bug', 'suggestion'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={type === value}
            onClick={() => setType(value)}
          >
            {value === 'all' ? 'Todos' : value === 'support' ? 'Suporte' : value === 'bug' ? 'Bugs' : 'Sugestões'}
          </button>
        ))}
      </div>
      <div className="nr-metrics">
        {(
          ['new', 'investigating', 'resolved', 'not_reproduced'] as BugStatus[]
        ).map((status) => (
          <Metric
            key={status}
            label={labels[status]}
            value={list.filter((bug) => bug.status === status).length}
            detail="reports"
          />
        ))}
      </div>
      <Panel
        title={
          type === 'all'
            ? 'Todos os reports'
            : type === 'support'
              ? 'Chamados de suporte'
              : type === 'bug'
                ? 'Bugs reportados'
                : 'Sugestões recebidas'
        }
      >
        <BugTable key={type} bugs={list} />
      </Panel>
    </>
  );
}

function BugDetail({ id }: { id: string }) {
  const notify = useNotify();
  const detail = useResource<{ report: BugRow; messages: BugMessage[] }>(
    `/bugs/${id}`,
  );
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  if (detail.loading && !detail.data) return <Loading />;
  if (detail.error)
    return <ErrorState message={detail.error} onRetry={detail.reload} />;

  const { report, messages } = detail.data!;
  const labels = reportStatusLabels(report.type ?? 'bug');

  async function run(action: () => Promise<unknown>, message: string) {
    setSaving(true);
    try {
      await action();
      notify(message);
      detail.reload();
    } catch (reason) {
      notify(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Title
        title={report.title}
        description={`${formatTicketNumber(report.ticketNumber)} · ${REPORT_TYPE_LABELS[report.type ?? 'bug']}${report.supportCategory ? ` · ${SUPPORT_CATEGORY_LABELS[report.supportCategory]}` : ''} · ${report.organizationName ?? ''} · ${report.userName ?? ''} · ${date(report.createdAt, true)}`}
        action={
          <div className="nr-actions">
            <Link className="nr-btn" href="/plataforma/reports">
              Voltar à lista
            </Link>
            <Link
              className="nr-btn"
              href={`/plataforma/organizacoes/${report.organizationId}`}
            >
              Abrir organização
            </Link>
          </div>
        }
      />
      <div className="nr-grid-2">
        <Panel title="Relato e dados técnicos">
          <div className="nr-pad">
            <p className="whitespace-pre-wrap">{report.description}</p>
            <p className="mt-4 text-xs text-muted-foreground">
              Página: {report.pageUrl ?? '—'}
              <br />
              Navegador: {report.userAgent ?? '—'}
              <br />
              Versão do sistema: {report.appVersion ?? '—'}
              <br />
              Usuário: {report.userName ?? '—'}{' '}
              {report.userEmail ? `(${report.userEmail})` : ''}
            </p>
            {report.hasScreenshot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="mt-4 max-h-96 rounded-lg border"
                src={`/api/platform/bugs/${report.id}/screenshot`}
                alt="Captura de tela enviada pelo usuário"
              />
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">
                Nenhuma captura de tela anexada a este relato.
              </p>
            )}
          </div>
        </Panel>
        <Panel title="Andamento">
          <div className="nr-pad flex flex-col gap-4">
            <label className="nr-field">
              Estado
              <select
                value={report.status}
                disabled={saving}
                onChange={(event) =>
                  void run(
                    () =>
                      api(`/bugs/${id}`, {
                        method: 'PATCH',
                        body: { status: event.target.value },
                      }),
                    'Estado atualizado.',
                  )
                }
              >
                {Object.entries(labels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="nr-field">
              Prioridade
              <select
                value={report.priority}
                disabled={saving}
                onChange={(event) =>
                  void run(
                    () =>
                      api(`/bugs/${id}`, {
                        method: 'PATCH',
                        body: { priority: event.target.value },
                      }),
                    'Prioridade atualizada.',
                  )
                }
              >
                {Object.entries(BUG_PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-muted-foreground">
              Concluído em: {date(report.resolvedAt, true)}
            </p>
          </div>
        </Panel>
      </div>
      <Panel
        title="Conversa e anotações"
        description="As respostas aparecem para o usuário no sistema da empresa; as notas internas, só para você."
      >
        <div className="nr-pad">
          {messages.length ? (
            messages.map((message) => (
              <div className="nr-note" key={message.id}>
                <span className="whitespace-pre-wrap">{message.text}</span>
                <small>
                  {date(message.createdAt, true)} · {message.authorName} ·{' '}
                  {message.internal
                    ? 'Nota interna · apenas o dono'
                    : message.fromOwner
                      ? 'Resposta ao usuário'
                      : 'Mensagem do usuário'}
                </small>
              </div>
            ))
          ) : (
            <Empty
              title="Sem mensagens ainda"
              text="Responda ao usuário ou registre uma nota interna."
            />
          )}
          <label className="nr-field">
            Escrever mensagem
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div className="nr-actions mt-4">
            <button
              className="nr-btn primary"
              disabled={!text.trim() || saving}
              onClick={() =>
                void run(async () => {
                  await api(`/bugs/${id}`, { body: { text } });
                  setText('');
                }, 'Resposta enviada ao usuário.')
              }
            >
              Responder ao usuário
            </button>
            <button
              className="nr-btn"
              disabled={!text.trim() || saving}
              onClick={() =>
                void run(async () => {
                  await api(`/bugs/${id}`, { body: { text, internal: true } });
                  setText('');
                }, 'Nota interna salva.')
              }
            >
              Salvar nota interna
            </button>
          </div>
        </div>
      </Panel>
    </>
  );
}
