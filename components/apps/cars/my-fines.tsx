'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { HelpDot, ModalNotice } from '@/components/modal-kit';
import { STANCE_LABELS } from '@/lib/vehicles/fines-rules';
import { formatPlate } from '@/lib/vehicles/rules';
import type { MyFine } from '@/lib/vehicles/fines-store';
import { brDate, brDateTime, call, money } from './call';
import './cars.css';

function FineCard({ fine, onAnswered }: { fine: MyFine; onAnswered: () => Promise<void> }) {
  const [disputing, setDisputing] = useState(false);
  const [changing, setChanging] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function answer(stance: 'agrees' | 'disputes') {
    setBusy(true);
    setError('');
    try {
      await call(`/api/my-fines/${fine.id}`, { method: 'POST', body: JSON.stringify({ stance, note }) });
      setDisputing(false);
      setChanging(false);
      await onAnswered();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível enviar sua resposta.');
    } finally {
      setBusy(false);
    }
  }

  const answered = fine.status !== 'to_answer';
  const askAgain = !answered || changing;

  return (
    <article className={`cr-fine-card${fine.status === 'to_answer' ? ' is-pending' : ''}`}>
      <header className="cr-fine-head">
        <span className="cr-plate">{formatPlate(fine.plate)}</span>
        <span className={`cr-stage ${fine.status === 'closed' ? 'is-resolved' : fine.status === 'to_answer' ? 'is-to_indicate' : 'is-appeal'}`}>
          {fine.status === 'closed' ? 'Resolvida' : fine.status === 'to_answer' ? 'Responda a empresa' : 'Respondida'}
        </span>
      </header>
      <strong>{fine.description}</strong>
      <dl className="cr-fine-facts">
        <div>
          <dt>Data da infração</dt>
          <dd>{brDateTime(fine.infractionAt)}</dd>
        </div>
        <div>
          <dt>Valor</dt>
          <dd>{money(fine.amount)}</dd>
        </div>
        {fine.points !== null ? (
          <div>
            <dt>Pontos</dt>
            <dd>{fine.points}</dd>
          </div>
        ) : null}
        {fine.location ? (
          <div>
            <dt>Local</dt>
            <dd>{fine.location}</dd>
          </div>
        ) : null}
        {fine.aitNumber ? (
          <div>
            <dt>Auto de infração</dt>
            <dd>{fine.aitNumber}</dd>
          </div>
        ) : null}
        {fine.indicationDeadline ? (
          <div>
            <dt>Prazo da empresa para indicar o condutor</dt>
            <dd>{brDate(fine.indicationDeadline)}</dd>
          </div>
        ) : null}
      </dl>

      {answered && !changing ? (
        <p className="cr-muted">
          Você respondeu em {fine.acknowledgedAt ? brDateTime(fine.acknowledgedAt) : ''}: <strong>{fine.driverStance ? STANCE_LABELS[fine.driverStance] : 'ciente'}</strong>
          {fine.driverNote ? ` — “${fine.driverNote}”` : ''}.{' '}
          {fine.status !== 'closed' ? (
            <button type="button" className="cr-link" onClick={() => setChanging(true)}>
              Mudar resposta
            </button>
          ) : null}
        </p>
      ) : null}

      {askAgain && fine.status !== 'closed' ? (
        <div className="space-y-3">
          {disputing ? (
            <>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-[15px]"
                rows={3}
                value={note}
                maxLength={500}
                placeholder="Conte por que você não concorda (por exemplo, não era você dirigindo)"
                onChange={(event) => setNote(event.target.value)}
                aria-label="Por que você não concorda"
              />
              <div className="cr-fine-answer">
                <button type="button" className="mg-button" disabled={busy} onClick={() => setDisputing(false)}>
                  Voltar
                </button>
                <button type="button" className="mg-button mg-button-dark" disabled={busy} onClick={() => void answer('disputes')}>
                  {busy ? <Loader2 size={16} className="animate-spin" /> : null} Enviar
                </button>
              </div>
            </>
          ) : (
            <div className="cr-fine-answer">
              <button type="button" className="mg-button mg-button-dark" disabled={busy} onClick={() => void answer('agrees')}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : null} Estou ciente e concordo
              </button>
              <button type="button" className="mg-button" disabled={busy} onClick={() => setDisputing(true)}>
                Estou ciente, mas não concordo
              </button>
            </div>
          )}
          {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}
        </div>
      ) : null}
    </article>
  );
}

/** /dashboard/multas: the fines the company told this technician about, and his answer to each. */
export function MyFines() {
  const [fines, setFines] = useState<MyFine[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setFines((await call<{ fines: MyFine[] }>('/api/my-fines')).fines);
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível carregar suas multas.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mg-dashboard cr">
      <div className="cr-toolbar">
        <HelpDot
          label="Minhas multas"
          text="Quando um carro que estava com você recebe uma multa, a empresa avisa aqui. Confirme que está ciente e diga se concorda. Se não era você dirigindo, explique: a empresa avalia antes de indicar o condutor."
        />
      </div>
      {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}
      {!fines ? (
        error ? null : <p className="cr-muted">Carregando…</p>
      ) : fines.length === 0 ? (
        <div className="cr-empty">
          <p>Nenhuma multa para você.</p>
        </div>
      ) : (
        <div className="cr-mine">
          {fines.map((fine) => (
            <FineCard key={fine.id} fine={fine} onAnswered={load} />
          ))}
        </div>
      )}
    </div>
  );
}
