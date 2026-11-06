'use client';

import { useRef, useState } from 'react';
import { CircleHelp, RotateCcw } from 'lucide-react';
import { describeHours, renderAutoMessage, VARIABLE_HELP, type AutoVariable, type BusinessHours, type ResolvedAutoMessage } from '@/lib/livechat/auto-messages';
import { api, errorMessage, useResource } from './api';
import { useNotify } from './notice';
import { ErrorState, Loading } from './ui';

type Payload = { messages: ResolvedAutoMessage[]; hours: BusinessHours; hoursText: string };

const GROUPS: Array<{ id: ResolvedAutoMessage['group']; title: string }> = [
  { id: 'chat', title: 'Chat ao vivo' },
  { id: 'case', title: 'Chamado por escrito' },
  { id: 'whatsapp', title: 'Quando alguém escreve no WhatsApp oficial' },
];

const DAY_LETTERS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Reports → Mensagens automáticas (admins): what the team says on its own, each one with a switch, a text and a preview. */
export function AutoMessages() {
  const data = useResource<Payload>('/livechat/auto-messages');
  const [version, setVersion] = useState(0);
  if (data.loading && !data.data) return <Loading />;
  if (data.error || !data.data) return <ErrorState message={data.error || 'Não foi possível carregar.'} onRetry={data.reload} />;
  const { messages, hours } = data.data;

  return (
    <div className="am-root">
      {GROUPS.map((group) => (
        <section key={group.id} className="am-group">
          <h2>{group.title}</h2>
          <div className="am-cards">
            {messages
              .filter((message) => message.group === group.id)
              .map((message) => (
                <AutoCard
                  key={`${message.key}-${version}`}
                  item={message}
                  hours={hours}
                  onSaved={(remount) => {
                    // A saved text starts the card over from the stored one; a switch must not throw away what is being typed.
                    if (remount) setVersion((value) => value + 1);
                    data.reload();
                  }}
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function AutoCard({ item, hours, onSaved }: { item: ResolvedAutoMessage; hours: BusinessHours; onSaved: (remount: boolean) => void }) {
  const notify = useNotify();
  const [text, setText] = useState(item.text);
  const [enabled, setEnabled] = useState(item.enabled);
  const [schedule, setSchedule] = useState<BusinessHours>(hours);
  const [showHelp, setShowHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  const isAway = item.key === 'whatsapp_away';
  const hoursChanged = isAway && JSON.stringify(schedule) !== JSON.stringify(hours);
  const dirty = text.trim() !== item.text.trim() || hoursChanged;

  async function save(body: Record<string, unknown>, message: string, remount = true) {
    setBusy(true);
    try {
      await api(`/livechat/auto-messages/${item.key}`, { method: 'PUT', body });
      notify(message);
      onSaved(remount);
    } catch (reason) {
      notify(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function insert(variable: AutoVariable) {
    const field = area.current;
    const token = `{${variable}}`;
    if (!field) return setText((value) => `${value} ${token}`);
    const start = field.selectionStart ?? text.length;
    const end = field.selectionEnd ?? text.length;
    setText(`${text.slice(0, start)}${token}${text.slice(end)}`);
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const preview = renderAutoMessage(text, { nome: 'Maria', chamado: '#123', horario: describeHours(schedule) });

  return (
    <article className={`am-card ${enabled ? '' : 'off'}`}>
      <header>
        <div className="am-title">
          <strong>{item.label}</strong>
          <button type="button" className="am-help" aria-label={`Como funciona: ${item.label}`} aria-expanded={showHelp} onClick={() => setShowHelp((value) => !value)}>
            <CircleHelp size={16} />
          </button>
        </div>
        <label className="am-switch">
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            disabled={busy}
            onChange={(event) => {
              setEnabled(event.target.checked);
              void save({ enabled: event.target.checked }, event.target.checked ? 'Mensagem ligada.' : 'Mensagem desligada.', false);
            }}
          />
          <span>{enabled ? 'Ligada' : 'Desligada'}</span>
        </label>
      </header>
      {showHelp ? <p className="am-helptext">{item.help}</p> : null}

      <div className="am-body">
        <div className="am-edit">
          <textarea ref={area} rows={5} value={text} maxLength={1000} onChange={(event) => setText(event.target.value)} aria-label={`Texto: ${item.label}`} />
          <div className="am-vars">
            {item.variables.map((variable) => (
              <button key={variable} type="button" title={VARIABLE_HELP[variable]} onClick={() => insert(variable)}>
                {`{${variable}}`}
              </button>
            ))}
          </div>
        </div>
        <div className="am-preview" aria-label="Como o cliente vê">
          <small>Como o cliente vê</small>
          <div className="am-bubble">{preview || '—'}</div>
        </div>
      </div>

      {isAway ? (
        <div className="am-hours">
          <span>Horário de atendimento</span>
          <div className="am-days" role="group" aria-label="Dias de atendimento">
            {DAY_LETTERS.map((letter, day) => (
              <button
                key={day}
                type="button"
                aria-pressed={schedule.days.includes(day)}
                title={DAY_NAMES[day]}
                aria-label={DAY_NAMES[day]}
                onClick={() => setSchedule((current) => ({ ...current, days: current.days.includes(day) ? current.days.filter((value) => value !== day) : [...current.days, day].sort() }))}
              >
                {letter}
              </button>
            ))}
          </div>
          <label>
            das
            <input type="time" value={schedule.start} onChange={(event) => setSchedule({ ...schedule, start: event.target.value })} />
          </label>
          <label>
            às
            <input type="time" value={schedule.end} onChange={(event) => setSchedule({ ...schedule, end: event.target.value })} />
          </label>
          <small>Horário de Brasília</small>
        </div>
      ) : null}

      <footer>
        <button
          type="button"
          className="nr-btn primary"
          disabled={busy || !dirty || !text.trim()}
          onClick={() => void save({ body: text, ...(isAway ? { hours: schedule } : {}) }, 'Mensagem salva.')}
        >
          Salvar
        </button>
        {item.customized ? (
          <button type="button" className="nr-btn" disabled={busy} onClick={() => void save({ reset: true }, 'Voltou ao padrão.')}>
            <RotateCcw size={15} />
            Restaurar padrão
          </button>
        ) : null}
      </footer>
    </article>
  );
}
