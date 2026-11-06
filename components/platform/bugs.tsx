'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, date, errorMessage, useResource } from './api';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { renderAutoMessage, ticketVariable, type ResolvedAutoMessage } from '@/lib/livechat/auto-messages';
import { caseClosingMessage } from '@/lib/livechat/rules';
import { AutoMessages } from './auto-messages';
import { CreateCaseDialog, useAssignees } from './case-workspace';
import { useIsOwner } from './role';
import { Livechat } from './livechat';
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

export type BugStatus = 'new' | 'investigating' | 'waiting' | 'resolved' | 'not_reproduced';
export type BugPriority = 'low' | 'medium' | 'high' | 'critical';

export type BugRow = {
  id: string;
  type: ReportType;
  ticketNumber: number | null;
  supportCategory: SupportCategory | null;
  /** 'case' = written support; 'chat' = a live chat, worked in the Livechat. */
  channel?: 'case' | 'chat';
  /** 'portal' = opened by the customer in their system; the others are the team's own (internal) cases. */
  origin?: 'portal' | 'livechat' | 'whatsapp' | 'manual';
  contactName?: string | null;
  contactPhone?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  organizationId: string | null;
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
  waiting: 'Aguardando cliente',
  resolved: 'Resolvido',
  not_reproduced: 'Não reproduzido',
};

export const BUG_PRIORITY_LABELS: Record<BugPriority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  critical: 'Crítica',
};

const OPEN_STATES = 'Em aberto';

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
    organization: bug.organizationName ?? bug.contactName ?? '—',
    ownerText: bug.ownerName ?? 'Sem responsável',
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
          // Open first: what still needs an answer (new or being handled), whatever the type of the report.
          defaultValue: OPEN_STATES,
          match: (row, value) => (value === OPEN_STATES ? row.status === 'new' || row.status === 'investigating' || row.status === 'waiting' : row.statusText === value),
          options: [
            OPEN_STATES,
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
          render: (row) => row.userName ?? row.contactName ?? '—',
        },
        { key: 'ownerText', label: 'Responsável' },
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
      emptyText="Nenhum caso por aqui. Os clientes abrem casos pelo botão “Reports” do sistema, e a equipe transforma conversas do Livechat em casos."
    />
  );
}

/** The closing of a written case as set in Mensagens automáticas, ready to edit ("" when the owner turned it off). */
async function casePrefill(ticketNumber: number | null): Promise<string> {
  try {
    const data = await api<{ messages: ResolvedAutoMessage[] }>('/livechat/auto-messages');
    const entry = data.messages.find((message) => message.key === 'case_closing');
    if (!entry) return caseClosingMessage(ticketNumber);
    return entry.enabled ? renderAutoMessage(entry.text, { chamado: ticketVariable(ticketNumber) }) : '';
  } catch {
    return caseClosingMessage(ticketNumber);
  }
}

export function Bugs({ id }: { id?: string }) {
  const bugs = useResource<{ bugs: BugRow[] }>(id ? null : '/bugs');
  // The automatic messages are the admins' to edit; a support user only works the inbox.
  const isOwner = useIsOwner();
  const [type, setType] = useState<ReportType | 'all' | 'livechat' | 'auto'>('all');
  // Whose cases the list shows: everyone's, mine, or the ones nobody has taken yet.
  const [scope, setScope] = useState<'all' | 'me' | 'none'>('all');
  const [creating, setCreating] = useState(false);
  const people = useAssignees();
  // Messages waiting in the live chat: shown on the tab from any other tab of Reports.
  const [chatUnread, setChatUnread] = useState(0);
  // ?chat=<id> (from a ticket) opens the Livechat with that conversation selected.
  const [chatId, setChatId] = useState<string | null>(null);
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('chat');
    if (wanted) {
      setChatId(wanted);
      setType('livechat');
    }
  }, []);
  useEffect(() => {
    if (id) return;
    let active = true;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      api<{ unread: { messages: number } }>('/livechat?status=open')
        .then((data) => active && setChatUnread(data.unread.messages))
        .catch(() => undefined);
    };
    check();
    const timer = setInterval(check, 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id]);
  if (id) return <BugDetail id={id} />;
  if (bugs.loading && !bugs.data) return <Loading />;
  if (bugs.error)
    return <ErrorState message={bugs.error} onRetry={bugs.reload} />;

  const meId = people.data?.meId ?? '';
  const list = bugs.data!.bugs.filter(
    (report) =>
      (type === 'all' || type === 'livechat' || type === 'auto' || (report.type ?? 'bug') === type) &&
      (scope === 'all' || (scope === 'me' ? report.ownerId === meId : !report.ownerId)),
  );
  // Four numbers: what is new, being worked, waiting for the customer, and done (resolved or closed without a fix).
  const counts = [
    ['Novos', list.filter((bug) => bug.status === 'new').length],
    ['Em andamento', list.filter((bug) => bug.status === 'investigating').length],
    ['Aguardando cliente', list.filter((bug) => bug.status === 'waiting').length],
    ['Concluídos', list.filter((bug) => bug.status === 'resolved' || bug.status === 'not_reproduced').length],
  ] as const;
  return (
    <>
      <Title
        title="Casos"
        description="Suporte, bugs e sugestões: tudo é caso, com tipo, status, responsável, anotações e histórico."
        action={
          <button className="nr-btn primary" onClick={() => setCreating(true)}>
            Novo caso
          </button>
        }
      />
      <div className="nr-tabs" role="tablist" aria-label="Tipo de caso">
        {(isOwner ? (['all', 'support', 'bug', 'suggestion', 'livechat', 'auto'] as const) : (['all', 'support', 'bug', 'suggestion', 'livechat'] as const)).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={type === value}
            onClick={() => setType(value)}
          >
            {value === 'all' ? 'Todos' : value === 'support' ? 'Suporte' : value === 'bug' ? 'Bugs' : value === 'suggestion' ? 'Sugestões' : value === 'auto' ? 'Mensagens automáticas' : 'Livechat'}
            {value === 'livechat' && chatUnread ? <b className="lc-tab-badge">{chatUnread}</b> : null}
          </button>
        ))}
      </div>
      {type === 'auto' ? <AutoMessages /> : type === 'livechat' ? <Livechat key={chatId ?? 'inbox'} initialId={chatId} /> : (
        <>
      <div className="nr-metrics">
        {counts.map(([label, value]) => (
          <Metric key={label} label={label} value={value} detail="casos" />
        ))}
      </div>
      <Panel
        title={
          type === 'all'
            ? 'Todos os casos'
            : type === 'support'
              ? 'Casos de suporte'
              : type === 'bug'
                ? 'Bugs'
                : 'Sugestões'
        }
        action={
          <div className="lc-filters" role="tablist" aria-label="De quem">
            {([['all', 'Todos'], ['me', 'Meus casos'], ['none', 'Sem responsável']] as const).map(([value, label]) => (
              <button key={value} role="tab" aria-selected={scope === value} onClick={() => setScope(value)}>
                {label}
              </button>
            ))}
          </div>
        }
      >
        <BugTable key={`${type}-${scope}`} bugs={list} />
      </Panel>
        </>
      )}
      {creating ? (
        <CreateCaseDialog
          onClose={() => setCreating(false)}
          onCreated={(createdId) => window.location.assign(`/plataforma/reports/${createdId}`)}
        />
      ) : null}
    </>
  );
}

function BugDetail({ id }: { id: string }) {
  const notify = useNotify();
  const detail = useResource<{
    report: BugRow;
    chat: { id: string; status: 'open' | 'closed'; unread: number } | null;
    messages: BugMessage[];
    conversations: Array<{ id: string; channel: 'web' | 'whatsapp'; status: 'open' | 'closed'; createdAt: string; preview: string | null }>;
    events: Array<{ id: string; body: string; authorName: string | null; createdAt: string }>;
  }>(`/bugs/${id}`);
  const people = useAssignees();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  // Concluding a written case asks for the goodbye message (the status waiting for that answer).
  const [closing, setClosing] = useState<BugStatus | null>(null);
  const [closingText, setClosingText] = useState('');

  if (detail.loading && !detail.data) return <Loading />;
  if (detail.error)
    return <ErrorState message={detail.error} onRetry={detail.reload} />;

  const { report, messages, chat, conversations, events } = detail.data!;
  // A case the team opened itself has no customer to answer: only notes.
  const internal = report.origin !== undefined && report.origin !== 'portal';
  const meId = people.data?.meId ?? '';
  const labels = reportStatusLabels(report.type ?? 'bug');
  const isChat = report.channel === 'chat';

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
        description={[
          `Caso ${formatTicketNumber(report.ticketNumber)}`,
          REPORT_TYPE_LABELS[report.type ?? 'bug'],
          report.supportCategory ? SUPPORT_CATEGORY_LABELS[report.supportCategory] : '',
          report.organizationName ?? '',
          report.userName ?? report.contactName ?? '',
          date(report.createdAt, true),
        ]
          .filter(Boolean)
          .join(' · ')}
        action={
          <div className="nr-actions">
            {chat ? (
              <Link className="nr-btn primary" href={`/plataforma/reports?chat=${chat.id}`}>
                Abrir no Livechat{chat.unread ? ` (${chat.unread})` : ''}
              </Link>
            ) : null}
            <Link className="nr-btn" href="/plataforma/reports">
              Voltar à lista
            </Link>
            {report.organizationId ? (
              <Link className="nr-btn" href={`/plataforma/organizacoes/${report.organizationId}`}>
                Abrir organização
              </Link>
            ) : null}
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
              {internal ? 'Contato' : 'Usuário'}: {report.userName ?? report.contactName ?? '—'}{' '}
              {report.userEmail ? `(${report.userEmail})` : ''}
              {internal && report.contactPhone ? ` · ${report.contactPhone}` : ''}
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
            {isChat ? (
              <p className="text-sm text-muted-foreground">
                Este atendimento é um chat ao vivo: o andamento e o encerramento acontecem no Livechat.
              </p>
            ) : (
              <label className="nr-field">
                Estado
                <select
                  value={report.status}
                  disabled={saving}
                  onChange={(event) => {
                    const value = event.target.value as BugStatus;
                    const concluding = (value === 'resolved' || value === 'not_reproduced') && report.status !== value;
                    if (concluding && !internal) {
                      setClosingText('');
                      setClosing(value);
                      void casePrefill(report.ticketNumber).then(setClosingText);
                      return;
                    }
                    void run(() => api(`/bugs/${id}`, { method: 'PATCH', body: { status: value } }), 'Estado atualizado.');
                  }}
                >
                  {Object.entries(labels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="nr-field">
              Responsável
              <span className="cs-owner">
                <select
                  value={report.ownerId ?? ''}
                  disabled={saving}
                  onChange={(event) => void run(() => api(`/bugs/${id}`, { method: 'PATCH', body: { ownerId: event.target.value || null } }), 'Responsável atualizado.')}
                >
                  <option value="">Sem responsável</option>
                  {people.data?.assignees.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                      {person.id === meId ? ' (você)' : ''}
                    </option>
                  ))}
                </select>
                {meId && report.ownerId !== meId ? (
                  <button type="button" className="nr-btn" disabled={saving} onClick={() => void run(() => api(`/bugs/${id}`, { method: 'PATCH', body: { ownerId: meId } }), 'Você assumiu o caso.')}>
                    Assumir
                  </button>
                ) : null}
              </span>
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
      {isChat ? (
        <Panel title="Chat ao vivo" description="A conversa, as respostas e o encerramento acontecem no Livechat.">
          <div className="nr-pad">
            <Link className="nr-btn primary" href={`/plataforma/reports?chat=${chat?.id ?? ''}`}>
              Abrir no Livechat
            </Link>
          </div>
        </Panel>
      ) : (
      <Panel
        title={internal ? 'Anotações' : 'Conversa e anotações'}
        description={internal ? 'Caso aberto pela equipe: as anotações são só da equipe.' : 'As respostas aparecem para o usuário no sistema da empresa; as notas internas, só para a equipe.'}
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
              text={internal ? 'Registre uma anotação.' : 'Responda ao usuário ou registre uma nota interna.'}
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
            {internal ? null : (
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
            )}
            <button
              className={internal ? 'nr-btn primary' : 'nr-btn'}
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
      )}
      <div className="nr-grid-2">
        <Panel title="Atendimentos" description="As conversas do Livechat ligadas a este caso.">
          <div className="nr-pad">
            {conversations.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma conversa ligada a este caso.</p> : null}
            {conversations.map((conversation) => (
              <div className="nr-detail-row" key={conversation.id}>
                <span>
                  {conversation.channel === 'whatsapp' ? 'WhatsApp' : 'Chat do chamado'} · {conversation.status === 'open' ? 'aberta' : 'encerrada'}
                  <small>
                    {date(conversation.createdAt, true)}
                    {conversation.preview ? ` · ${conversation.preview}` : ''}
                  </small>
                </span>
                <Link href={`/plataforma/reports?chat=${conversation.id}`}>Abrir no Livechat</Link>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Histórico" description="O que mudou no caso e quem mudou.">
          <div className="nr-pad">
            {events.length === 0 ? <p className="text-sm text-muted-foreground">Nada mudou ainda.</p> : null}
            {events.map((event) => (
              <div className="nr-note" key={event.id}>
                <span>{event.body}</span>
                <small>
                  {date(event.createdAt, true)} · {event.authorName ?? 'Sistema'}
                </small>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      {closing ? (
        <Dialog open onOpenChange={(open) => !open && !saving && setClosing(null)}>
          <DialogContent className="nr-dialog sm:max-w-xl">
            <DialogTitle>Concluir o chamado</DialogTitle>
            <DialogDescription>
              O usuário recebe esta mensagem no chamado e um aviso no sistema. Edite se quiser, ou conclua sem mensagem.
            </DialogDescription>
            <label className="nr-field">
              Mensagem de encerramento
              <textarea rows={5} value={closingText} onChange={(event) => setClosingText(event.target.value)} />
            </label>
            <div className="nr-dialog-actions">
              <button className="nr-btn" disabled={saving} onClick={() => setClosing(null)}>
                Voltar
              </button>
              <button
                className="nr-btn"
                disabled={saving}
                onClick={() => void run(async () => { await api(`/bugs/${id}`, { method: 'PATCH', body: { status: closing, closingMessage: '' } }); setClosing(null); }, 'Chamado concluído.')}
              >
                Concluir sem mensagem
              </button>
              <button
                className="nr-btn primary"
                disabled={saving || !closingText.trim()}
                onClick={() => void run(async () => { await api(`/bugs/${id}`, { method: 'PATCH', body: { status: closing, closingMessage: closingText } }); setClosing(null); }, 'Chamado concluído e mensagem enviada.')}
              >
                Concluir e enviar mensagem
              </button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
