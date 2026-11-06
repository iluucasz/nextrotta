'use client';

import { useState } from 'react';
import { LoaderCircle, Zap } from 'lucide-react';
import { firstName, renderAutoMessage, ticketVariable, type ResolvedAutoMessage } from '@/lib/livechat/auto-messages';
import { api, errorMessage } from './api';
import { useNotify } from './notice';

type Payload = { messages: ResolvedAutoMessage[]; hoursText: string };

const GROUPS: Array<{ id: ResolvedAutoMessage['group']; title: string }> = [
  { id: 'chat', title: 'Chat ao vivo' },
  { id: 'whatsapp', title: 'WhatsApp' },
  { id: 'case', title: 'Chamado' },
];

/**
 * The lightning button of the reply box: the automatic messages, ready to put in the box (with the customer's name and the ticket
 * filled in) so the attendant can edit them and send. Nothing is sent from here.
 */
export function QuickReplies({ conversation, disabled, onPick }: { conversation: { userName: string | null; contactName: string | null; ticketNumber: number | null }; disabled?: boolean; onPick: (text: string) => void }) {
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (data || loading) return;
    setLoading(true);
    try {
      setData(await api<Payload>('/livechat/auto-messages'));
    } catch (reason) {
      notify(errorMessage(reason));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  const fill = (message: ResolvedAutoMessage) =>
    renderAutoMessage(message.text, { nome: firstName(conversation.userName ?? conversation.contactName), chamado: ticketVariable(conversation.ticketNumber), horario: data?.hoursText ?? '' });

  return (
    <span className="lc-quick">
      <button type="button" className="lc-attach-btn" aria-label="Escolher uma mensagem automática" aria-expanded={open} title="Mensagens automáticas" disabled={disabled} onClick={() => void toggle()}>
        <Zap size={20} />
      </button>
      {open ? (
        <>
          <button type="button" className="lc-quick-backdrop" aria-label="Fechar" tabIndex={-1} onClick={() => setOpen(false)} />
          <div className="lc-quick-menu" role="menu" aria-label="Mensagens automáticas">
            {loading || !data ? (
              <p className="lc-quick-empty"><LoaderCircle size={16} className="animate-spin" /></p>
            ) : (
              GROUPS.map((group) => {
                const items = data.messages.filter((message) => message.group === group.id);
                return items.length ? (
                  <div key={group.id}>
                    <h4>{group.title}</h4>
                    {items.map((message) => (
                      <button
                        key={message.key}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onPick(fill(message));
                          setOpen(false);
                        }}
                      >
                        <strong>{message.label}</strong>
                        <small>{fill(message)}</small>
                      </button>
                    ))}
                  </div>
                ) : null;
              })
            )}
          </div>
        </>
      ) : null}
    </span>
  );
}
