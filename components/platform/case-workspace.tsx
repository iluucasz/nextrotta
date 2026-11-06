'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FolderPlus, LoaderCircle, MessageCircle, Phone, StickyNote } from 'lucide-react';
import { CASE_ORIGIN_LABELS, CASE_PRIORITIES, CASE_PRIORITY_LABELS, CASE_STATUSES, caseStatusLabel, formatCaseNumber, MAX_NOTE_LENGTH, suggestedSubject, type CasePriority, type CaseStatus } from '@/lib/cases/rules';
import { REPORT_TYPE_LABELS, REPORT_TYPES, type ReportType } from '@/lib/reports';
import type { SupportCase } from '@/lib/cases/store';
import { api, date, errorMessage, useResource } from './api';
import { useNotify } from './notice';
import { Badge, ErrorState, Loading } from './ui';

export type CaseEvent = { id: string; kind: string; body: string; authorName: string | null; createdAt: string };
type CaseConversation = { id: string; channel: 'web' | 'whatsapp'; status: 'open' | 'closed'; contactPhone: string | null; createdAt: string; lastMessageAt: string; preview: string | null };
type Detail = { case: SupportCase; events: CaseEvent[]; conversations: CaseConversation[] };
type Assignees = { assignees: Array<{ id: string; name: string; role: string }>; meId: string };

export const statusTone = (status: CaseStatus) => (status === 'resolved' || status === 'not_reproduced' ? 'good' : status === 'new' ? 'warn' : 'neutral');

const phoneLabel = (digits: string | null) => {
  if (!digits) return '';
  const local = digits.startsWith('55') ? digits.slice(2) : digits;
  return local.length === 11 ? `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}` : `+${digits}`;
};

/** The people a case can be given to, and who is looking (for "Assumir"). */
export function useAssignees() {
  return useResource<Assignees>('/cases/assignees');
}

/**
 * A case worked in the way of a service console: status, priority, owner, the conversations gathered in it ("atendimentos"),
 * internal notes and the history. `compact` is the narrow rail beside a conversation in the Livechat; otherwise it is the page.
 */
export function CaseWorkspace({ caseId, compact = false, currentConversationId = null, onChanged }: { caseId: string; compact?: boolean; currentConversationId?: string | null; onChanged?: () => void }) {
  const notify = useNotify();
  const detail = useResource<Detail>(`/cases/${caseId}`);
  const people = useAssignees();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const reload = detail.reload;

  // The case is worked by several people: refresh while it is open and visible.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, 12_000);
    return () => clearInterval(timer);
  }, [reload]);

  if (detail.loading && !detail.data) return <Loading />;
  if (detail.error || !detail.data) return <ErrorState message={detail.error || 'Não foi possível carregar o caso.'} onRetry={reload} />;
  const { case: current, events, conversations } = detail.data;
  const meId = people.data?.meId ?? '';

  async function change(body: Record<string, unknown>, message: string) {
    setBusy(true);
    try {
      await api(`/cases/${caseId}`, { method: 'PATCH', body });
      notify(message);
      reload();
      onChanged?.();
    } catch (reason) {
      notify(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api(`/cases/${caseId}/notes`, { body: { text: note } });
      setNote('');
      reload();
    } catch (reason) {
      notify(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  const subjectValue = subject ?? current.subject;
  const descriptionValue = description ?? current.description;

  return (
    <div className={`cs-root ${compact ? 'compact' : ''}`}>
      <header className="cs-head">
        <div>
          <small>
            Caso {formatCaseNumber(current.number)} · {REPORT_TYPE_LABELS[current.type]} · {CASE_ORIGIN_LABELS[current.origin]}
            {compact ? (
              <>
                {' · '}
                <Link href={`/plataforma/reports/${current.id}`}>Abrir caso completo</Link>
              </>
            ) : null}
          </small>
          <textarea
            className="cs-subject"
            rows={compact ? 3 : 2}
            value={subjectValue}
            maxLength={140}
            readOnly={!current.internal}
            aria-label="Assunto do caso"
            onChange={(event) => setSubject(event.target.value)}
            onBlur={() => {
              if (current.internal && subject !== null && subject.trim() && subject.trim() !== current.subject) void change({ subject }, 'Assunto salvo.');
              setSubject(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                (event.target as HTMLTextAreaElement).blur();
              }
            }}
          />
        </div>
        <Badge tone={statusTone(current.status)}>{caseStatusLabel(current.type, current.status)}</Badge>
      </header>

      <div className="cs-fields">
        <label>
          Status
          <select value={current.status} disabled={busy} onChange={(event) => void change({ status: event.target.value }, 'Status atualizado.')}>
            {CASE_STATUSES.map((value) => (
              <option key={value} value={value}>{caseStatusLabel(current.type, value)}</option>
            ))}
          </select>
        </label>
        <label>
          Prioridade
          <select value={current.priority} disabled={busy} onChange={(event) => void change({ priority: event.target.value as CasePriority }, 'Prioridade atualizada.')}>
            {CASE_PRIORITIES.map((value) => (
              <option key={value} value={value}>{CASE_PRIORITY_LABELS[value]}</option>
            ))}
          </select>
        </label>
        <label className="wide">
          Responsável
          <span className="cs-owner">
            <select value={current.ownerId ?? ''} disabled={busy} onChange={(event) => void change({ ownerId: event.target.value || null }, 'Responsável atualizado.')}>
              <option value="">Sem responsável</option>
              {people.data?.assignees.map((person) => (
                <option key={person.id} value={person.id}>{person.name}{person.id === meId ? ' (você)' : ''}</option>
              ))}
            </select>
            {meId && current.ownerId !== meId ? (
              <button type="button" className="nr-btn" disabled={busy} onClick={() => void change({ ownerId: meId }, 'Você assumiu o caso.')}>Assumir</button>
            ) : null}
          </span>
        </label>
      </div>

      <dl className="cs-contact">
        {current.contactName ? <div><dt>Contato</dt><dd>{current.contactName}</dd></div> : null}
        {current.contactPhone ? <div><dt><Phone size={13} /> WhatsApp</dt><dd>{phoneLabel(current.contactPhone)}</dd></div> : null}
        {current.organizationName ? <div><dt>Empresa</dt><dd><Link href={`/plataforma/organizacoes/${current.organizationId}`}>{current.organizationName}</Link></dd></div> : null}
        <div><dt>Aberto</dt><dd>{date(current.createdAt, true)}</dd></div>
        {current.resolvedAt ? <div><dt>Resolvido</dt><dd>{date(current.resolvedAt, true)}</dd></div> : null}
      </dl>

      <details className="cs-section" open={!compact}>
        <summary>{current.internal ? 'Descrição' : 'Relato do cliente'}</summary>
        <textarea
          rows={compact ? 4 : 6}
          value={descriptionValue}
          maxLength={4000}
          readOnly={!current.internal}
          placeholder="O que aconteceu e o que precisa ser feito"
          aria-label="Descrição do caso"
          onChange={(event) => setDescription(event.target.value)}
        />
        {description !== null && description.trim() !== current.description ? (
          <button
            type="button"
            className="nr-btn"
            disabled={busy}
            onClick={async () => {
              await change({ description }, 'Descrição salva.');
              setDescription(null);
            }}
          >
            Salvar descrição
          </button>
        ) : null}
      </details>

      <section className="cs-section">
        <h3>Atendimentos <b>{conversations.length}</b></h3>
        {conversations.length === 0 ? <p className="cs-empty">Nenhuma conversa ligada a este caso.</p> : null}
        <ul className="cs-conversations">
          {conversations.map((conversation) => (
            <li key={conversation.id} className={conversation.id === currentConversationId ? 'current' : ''}>
              <MessageCircle size={15} />
              <span>
                <strong>{conversation.channel === 'whatsapp' ? 'WhatsApp' : 'Chat do chamado'} · {conversation.status === 'open' ? 'aberta' : 'encerrada'}</strong>
                <small>{date(conversation.createdAt, true)}{conversation.preview ? ` · ${conversation.preview}` : ''}</small>
              </span>
              {conversation.id !== currentConversationId ? (
                <Link href={`/plataforma/reports?chat=${conversation.id}`} aria-label="Abrir no Livechat" title="Abrir no Livechat"><ExternalLink size={15} /></Link>
              ) : (
                <small className="cs-here">nesta tela</small>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="cs-section">
        <h3><StickyNote size={15} /> Anotações e histórico</h3>
        <form
          className="cs-note"
          onSubmit={(event) => {
            event.preventDefault();
            void addNote();
          }}
        >
          <textarea
            rows={2}
            value={note}
            maxLength={MAX_NOTE_LENGTH}
            placeholder="Anotação interna: só a equipe vê"
            aria-label="Nova anotação"
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void addNote();
              }
            }}
          />
          <button className="nr-btn primary" disabled={busy || !note.trim()}>
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : null}
            Adicionar anotação
          </button>
        </form>
        <ol className="cs-timeline">
          {events.map((event) => (
            <li key={event.id} className={event.kind === 'note' ? 'note' : ''}>
              <p>{event.body}</p>
              <small>{event.authorName ?? 'Sistema'} · {date(event.createdAt, true)}</small>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- create

export type CaseSource = {
  id: string;
  ticketTitle: string | null;
  firstCustomerMessage: string | null;
  contactName: string | null;
  organizationName: string | null;
  urgent: boolean;
  channel: 'web' | 'whatsapp';
};

/** "Transformar em caso" (from a conversation) or "Novo caso" (by hand, with the company and the contact typed). */
export function CreateCaseDialog({ conversation, onClose, onCreated }: { conversation?: CaseSource; onClose: () => void; onCreated: (caseId: string) => void }) {
  const notify = useNotify();
  const people = useAssignees();
  const orgs = useResource<{ organizations: Array<{ id: string; name: string }> }>(conversation ? null : '/organizations');
  const [subject, setSubject] = useState(
    conversation ? suggestedSubject({ ticketTitle: conversation.ticketTitle, firstCustomerMessage: conversation.firstCustomerMessage, contactName: conversation.contactName, organizationName: conversation.organizationName }) : '',
  );
  const [type, setType] = useState<ReportType>('support');
  const [priority, setPriority] = useState<CasePriority>(conversation?.urgent ? 'high' : 'medium');
  const [status, setStatus] = useState<Exclude<CaseStatus, 'resolved' | 'not_reproduced'>>('new');
  const [ownerId, setOwnerId] = useState<string | null>(null); // null until chosen: the server gives it to who creates it
  const [organizationId, setOrganizationId] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  async function create() {
    setSaving(true);
    setError('');
    try {
      const result = await api<{ case: SupportCase }>('/cases', {
        body: {
          ...(conversation ? { conversationId: conversation.id } : { organizationId: organizationId || undefined, contactName, contactPhone }),
          subject,
          type,
          priority,
          status,
          ...(ownerId !== null ? { ownerId: ownerId || null } : {}),
          note: note || undefined,
        },
      });
      notify(`Caso ${formatCaseNumber(result.case.number)} criado.`);
      onCreated(result.case.id);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  const meId = people.data?.meId ?? '';
  return (
    <div className="cs-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <form
        className="cs-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={conversation ? 'Transformar em caso' : 'Novo caso'}
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <h2><FolderPlus size={20} /> {conversation ? 'Transformar em caso' : 'Novo caso'}</h2>
        {conversation ? <p className="cs-hint">A conversa fica ligada ao caso, com o contato, a empresa e o final da conversa como descrição. Quem escrever de novo no WhatsApp enquanto o caso estiver aberto cai nele.</p> : null}
        <label>
          Assunto *
          <input ref={first} value={subject} maxLength={140} required onChange={(event) => setSubject(event.target.value)} />
        </label>
        {!conversation ? (
          <>
            <label>
              Empresa
              <select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
                <option value="">Sem empresa</option>
                {orgs.data?.organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>{organization.name}</option>
                ))}
              </select>
            </label>
            <div className="cs-row">
              <label>
                Contato
                <input value={contactName} onChange={(event) => setContactName(event.target.value)} />
              </label>
              <label>
                WhatsApp
                <input value={contactPhone} inputMode="tel" placeholder="(21) 99999-9999" onChange={(event) => setContactPhone(event.target.value)} />
              </label>
            </div>
          </>
        ) : null}
        <div className="cs-row">
          <label>
            Tipo
            <select value={type} onChange={(event) => setType(event.target.value as ReportType)}>
              {REPORT_TYPES.map((value) => (
                <option key={value} value={value}>{REPORT_TYPE_LABELS[value]}</option>
              ))}
            </select>
          </label>
          <label>
            Prioridade
            <select value={priority} onChange={(event) => setPriority(event.target.value as CasePriority)}>
              {CASE_PRIORITIES.map((value) => (
                <option key={value} value={value}>{CASE_PRIORITY_LABELS[value]}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value as Exclude<CaseStatus, 'resolved' | 'not_reproduced'>)}>
              {CASE_STATUSES.filter((value) => value !== 'resolved' && value !== 'not_reproduced').map((value) => (
                <option key={value} value={value}>{caseStatusLabel(type, value)}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Responsável
          <select value={ownerId ?? meId} onChange={(event) => setOwnerId(event.target.value)}>
            <option value="">Sem responsável</option>
            {people.data?.assignees.map((person) => (
              <option key={person.id} value={person.id}>{person.name}{person.id === meId ? ' (você)' : ''}</option>
            ))}
          </select>
        </label>
        <label>
          Anotação inicial
          <textarea rows={3} value={note} maxLength={MAX_NOTE_LENGTH} placeholder="Opcional: o que já foi feito ou combinado" onChange={(event) => setNote(event.target.value)} />
        </label>
        {error ? <p className="cs-error" role="alert">{error}</p> : null}
        <div className="cs-actions">
          <button type="button" className="nr-btn" disabled={saving} onClick={onClose}>Voltar</button>
          <button className="nr-btn primary" disabled={saving || !subject.trim()}>{saving ? 'Criando…' : 'Criar caso'}</button>
        </div>
      </form>
    </div>
  );
}
