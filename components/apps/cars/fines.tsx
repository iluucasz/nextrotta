'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleCheck, Loader2, Pencil, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HelpDot, ModalNotice, ModalSection, SegmentedControl, SummaryBand } from '@/components/modal-kit';
import { MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS } from '@/components/modal-kit';
import {
  addDaysToKey,
  APPEAL_LABELS,
  APPEAL_STATUSES,
  DEFAULT_INDICATION_DAYS,
  FINE_STAGE_LABELS,
  FINE_STAGES,
  indicationState,
  STANCE_LABELS,
  suggestDriver,
  type AppealStatus,
  type FineStage,
} from '@/lib/vehicles/fines-rules';
import { formatPlate } from '@/lib/vehicles/rules';
import type { FineRow } from '@/lib/vehicles/fines-store';
import type { AssignmentRow, VehicleRow } from '@/lib/vehicles/store';
import { brDate, brDateTime, call, money, toLocalInput } from './call';

type Technician = { id: string; name: string };
type FinesData = {
  today: string;
  fines: FineRow[];
  summary: { open: number; urgent: number; toPay: number; toPayAmount: number };
  /** The weekly automatic lookup: granted to this company, and the platform has its provider set up. */
  lookup: { enabled: boolean; configured: boolean };
};

const FIELD = 'h-10 w-full rounded-md border border-input bg-background px-3 text-[15px]';
const AREA = 'w-full rounded-md border border-input bg-background px-3 py-2 text-[15px]';

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`cr-field${wide ? ' is-wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

type Form = {
  vehicleId: string;
  infractionAt: string;
  description: string;
  amount: string;
  aitNumber: string;
  authority: string;
  location: string;
  points: string;
  technicianId: string;
  receivedOn: string;
  indicationDeadline: string;
  paymentDue: string;
  notes: string;
};

const emptyForm: Form = {
  vehicleId: '',
  infractionAt: '',
  description: '',
  amount: '',
  aitNumber: '',
  authority: '',
  location: '',
  points: '',
  technicianId: '',
  receivedOn: '',
  indicationDeadline: '',
  paymentDue: '',
  notes: '',
};

const toForm = (fine: FineRow): Form => ({
  vehicleId: fine.vehicleId,
  infractionAt: toLocalInput(fine.infractionAt),
  description: fine.description,
  amount: String(fine.amount).replace('.', ','),
  aitNumber: fine.aitNumber ?? '',
  authority: fine.authority ?? '',
  location: fine.location ?? '',
  points: fine.points === null ? '' : String(fine.points),
  technicianId: fine.technicianId ?? '',
  receivedOn: fine.receivedOn ?? '',
  indicationDeadline: fine.indicationDeadline ?? '',
  paymentDue: fine.paymentDue ?? '',
  notes: fine.notes ?? '',
});

function Step({ done, title, children }: { done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className={`cr-step${done ? ' is-done' : ''}`}>
      <span className="cr-step-mark" aria-hidden>
        {done ? <CircleCheck size={18} /> : <span className="cr-step-dot" />}
      </span>
      <div className="cr-step-body">
        <strong>{title}</strong>
        <div className="cr-step-actions">{children}</div>
      </div>
    </li>
  );
}

/** Register (fineId = null) or follow a fine: its data, the driver, the deadlines and each step until it is resolved. */
function FineDialog({
  fineId,
  data,
  cars,
  technicians,
  onClose,
  onChanged,
  onCreated,
}: {
  fineId: string | null;
  data: FinesData;
  cars: VehicleRow[];
  technicians: Technician[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onCreated: (id: string) => void;
}) {
  const fine = fineId ? (data.fines.find((item) => item.id === fineId) ?? null) : null;
  const [form, setForm] = useState<Form>(fine ? toForm(fine) : emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [history, setHistory] = useState<AssignmentRow[] | null>(null);
  const [driverTouched, setDriverTouched] = useState(Boolean(fine));
  const [deadlineTouched, setDeadlineTouched] = useState(Boolean(fine));
  const confirmRef = useRef<HTMLDivElement>(null);
  const set = (key: keyof Form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  useEffect(() => {
    if (confirmRemove) confirmRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [confirmRemove]);

  // Who had the car then: the car's history says it, so the driver is suggested instead of asked.
  useEffect(() => {
    if (!form.vehicleId) {
      setHistory(null);
      return;
    }
    let active = true;
    call<{ history: AssignmentRow[] }>(`/api/vehicles/${form.vehicleId}`)
      .then((result) => active && setHistory(result.history))
      .catch(() => active && setHistory([]));
    return () => {
      active = false;
    };
  }, [form.vehicleId]);

  const suggestedId = useMemo(() => {
    if (!history || !form.infractionAt) return null;
    return suggestDriver(
      history.map((row) => ({ technicianId: row.technicianId, assignedAt: row.assignedAt, releasedAt: row.releasedAt })),
      `${form.infractionAt}:00-03:00`,
    );
  }, [history, form.infractionAt]);
  const suggestedName = suggestedId ? (technicians.find((item) => item.id === suggestedId)?.name ?? history?.find((row) => row.technicianId === suggestedId)?.technicianName ?? null) : null;

  // A new fine takes the suggested driver on its own, until someone picks another one.
  useEffect(() => {
    if (!fine && !driverTouched && suggestedId) setForm((current) => ({ ...current, technicianId: suggestedId }));
  }, [fine, driverTouched, suggestedId]);

  const onReceived = (event: React.ChangeEvent<HTMLInputElement>) => {
    const receivedOn = event.target.value;
    setForm((current) => ({
      ...current,
      receivedOn,
      indicationDeadline: !deadlineTouched && receivedOn ? addDaysToKey(receivedOn, DEFAULT_INDICATION_DAYS) : current.indicationDeadline,
    }));
  };

  async function run(action: () => Promise<unknown>, after: 'close' | 'stay' = 'stay'): Promise<boolean> {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await onChanged();
      if (after === 'close') onClose();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível concluir.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const payload = () => ({ ...form, technicianId: form.technicianId || null });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (fine) {
      await run(() => call(`/api/vehicles/fines/${fine.id}`, { method: 'PATCH', body: JSON.stringify(payload()) }), 'close');
      return;
    }
    // A new fine stays open after saving: the next thing to do is usually to tell the driver.
    let createdId: string | null = null;
    const saved = await run(async () => {
      createdId = (await call<{ id: string }>('/api/vehicles/fines', { method: 'POST', body: JSON.stringify(payload()) })).id;
    });
    if (saved && createdId) onCreated(createdId);
  };

  const step = (patch: Record<string, unknown>) => run(() => call(`/api/vehicles/fines/${fine?.id}`, { method: 'PATCH', body: JSON.stringify(patch) }));

  const notify = () =>
    run(async () => {
      // What is typed and not saved yet (the driver, mostly) goes first, so the notice goes to the right person.
      await call(`/api/vehicles/fines/${fine?.id}`, { method: 'PATCH', body: JSON.stringify({ technicianId: form.technicianId || null }) });
      const result = await call<{ outcome: string; error: string | null }>(`/api/vehicles/fines/${fine?.id}/notify`, { method: 'POST' });
      setNotice(
        result.outcome === 'sent'
          ? 'Prestador avisado por WhatsApp. A multa também aparece em "Minhas multas" para ele.'
          : result.outcome === 'off'
            ? 'A multa já aparece em "Minhas multas" para o prestador. Para avisar também por WhatsApp, ligue "Multa do carro" em WhatsApp → Notificações.'
            : `A multa já aparece em "Minhas multas" para o prestador, mas o WhatsApp não saiu${result.error ? `: ${result.error}` : '.'}`,
      );
    });

  const cardDriver = fine?.technicianName ?? 'Sem condutor';

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <DialogTitle className={MODAL_TITLE_CLASS}>{fine ? `Multa do ${formatPlate(fine.plate)}` : 'Registrar multa'}</DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>
            {fine ? `${cardDriver} · ${money(fine.amount)}` : 'Os dados estão na notificação da multa.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
          <div className={`${MODAL_BODY_CLASS} space-y-7`}>
            {fine ? (
              <ModalSection title="Andamento" help="Cada etapa se marca aqui. A indicação do condutor é feita fora, na Carteira Digital de Trânsito ou no site do Detran: depois de indicar, marque aqui.">
                <ol className="cr-steps">
                  <Step done={Boolean(fine.technicianId)} title="Condutor definido">
                    <span className="cr-muted">{fine.technicianName ?? 'Escolha o condutor abaixo e salve.'}</span>
                  </Step>
                  <Step done={Boolean(fine.notifiedAt)} title="Prestador avisado">
                    <span className="cr-muted">{fine.notifiedAt ? brDateTime(fine.notifiedAt) : 'Ainda não avisado.'}</span>
                    <button type="button" className="mg-button" disabled={busy || !form.technicianId} onClick={() => void notify()}>
                      {fine.notifiedAt ? 'Avisar de novo' : 'Avisar o prestador'}
                    </button>
                  </Step>
                  <Step done={Boolean(fine.acknowledgedAt)} title="Prestador ciente">
                    {fine.acknowledgedAt ? (
                      <span className="cr-muted">
                        {brDateTime(fine.acknowledgedAt)} · {fine.acknowledgedBy === 'technician' ? 'pelo próprio prestador' : 'marcado por você'}
                        {fine.driverStance ? ` · ${STANCE_LABELS[fine.driverStance]}` : ''}
                        {fine.driverNote ? ` — “${fine.driverNote}”` : ''}
                      </span>
                    ) : (
                      <>
                        <span className="cr-muted">Esperando.</span>
                        <button type="button" className="mg-button" disabled={busy || !fine.technicianId} onClick={() => void step({ acknowledged: true })}>
                          Marcar como ciente
                        </button>
                      </>
                    )}
                  </Step>
                  <Step done={Boolean(fine.indicatedAt)} title="Condutor indicado no órgão">
                    <span className="cr-muted">{fine.indicatedAt ? brDateTime(fine.indicatedAt) : `Prazo: ${brDate(fine.indicationDeadline)}`}</span>
                    <button type="button" className="mg-button" disabled={busy} onClick={() => void step({ indicated: !fine.indicatedAt })}>
                      {fine.indicatedAt ? 'Desmarcar' : 'Marcar como indicado'}
                    </button>
                  </Step>
                  <Step done={fine.appealStatus === 'won'} title="Recurso">
                    <select
                      className="cr-inline-select"
                      value={fine.appealStatus}
                      disabled={busy}
                      aria-label="Situação do recurso"
                      onChange={(event) => void step({ appealStatus: event.target.value as AppealStatus })}
                    >
                      {APPEAL_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {APPEAL_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </Step>
                  <Step done={Boolean(fine.paidAt) || fine.appealStatus === 'won'} title="Pagamento">
                    <span className="cr-muted">{fine.paidAt ? `Paga em ${brDate(fine.paidAt)}` : fine.appealStatus === 'won' ? 'Não precisa pagar.' : `Vence em ${brDate(fine.paymentDue)}`}</span>
                    {fine.appealStatus !== 'won' ? (
                      <button type="button" className="mg-button" disabled={busy} onClick={() => void step({ paid: !fine.paidAt })}>
                        {fine.paidAt ? 'Desmarcar' : 'Marcar como paga'}
                      </button>
                    ) : null}
                  </Step>
                </ol>
              </ModalSection>
            ) : null}

            <ModalSection title="Multa">
              <div className="cr-grid">
                <Field label="Carro" wide>
                  <select className={FIELD} value={form.vehicleId} onChange={set('vehicleId')} required>
                    <option value="">Escolha o carro</option>
                    {cars.map((car) => (
                      <option key={car.id} value={car.id}>
                        {formatPlate(car.plate)}
                        {car.model ? ` · ${car.model}` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Data e hora da infração">
                  <input className={FIELD} type="datetime-local" value={form.infractionAt} onChange={set('infractionAt')} required />
                </Field>
                <Field label="Valor (R$)">
                  <input className={FIELD} inputMode="decimal" value={form.amount} onChange={set('amount')} placeholder="130,16" required />
                </Field>
                <Field label="Infração" wide>
                  <input className={FIELD} value={form.description} onChange={set('description')} placeholder="Excesso de velocidade até 20%" required />
                </Field>
                <Field label="Auto de infração (AIT)">
                  <input className={FIELD} value={form.aitNumber} onChange={set('aitNumber')} autoCapitalize="characters" />
                </Field>
                <Field label="Órgão">
                  <input className={FIELD} value={form.authority} onChange={set('authority')} placeholder="Detran-RJ, PRF…" />
                </Field>
                <Field label="Local">
                  <input className={FIELD} value={form.location} onChange={set('location')} />
                </Field>
                <Field label="Pontos">
                  <input className={FIELD} inputMode="numeric" value={form.points} onChange={set('points')} />
                </Field>
              </div>
            </ModalSection>

            <ModalSection title="Condutor" help="O sistema olha o histórico do carro e sugere quem estava com ele na hora da infração. Confirme ou escolha outra pessoa.">
              <select
                className={FIELD}
                value={form.technicianId}
                aria-label="Condutor"
                onChange={(event) => {
                  setDriverTouched(true);
                  set('technicianId')(event);
                }}
              >
                <option value="">Sem condutor definido</option>
                {technicians.map((technician) => (
                  <option key={technician.id} value={technician.id}>
                    {technician.name}
                  </option>
                ))}
                {fine?.technicianId && !technicians.some((technician) => technician.id === fine.technicianId) ? (
                  <option value={fine.technicianId}>{fine.technicianName} (inativo)</option>
                ) : null}
              </select>
              {form.vehicleId && form.infractionAt ? (
                <p className="cr-muted">
                  {suggestedName
                    ? `Pelo histórico, o carro estava com ${suggestedName}.`
                    : history === null
                      ? 'Procurando no histórico…'
                      : 'Nenhum técnico estava com o carro nessa data.'}
                  {suggestedId && form.technicianId !== suggestedId ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cr-link"
                        onClick={() => {
                          setDriverTouched(true);
                          setForm((current) => ({ ...current, technicianId: suggestedId }));
                        }}
                      >
                        Usar
                      </button>
                    </>
                  ) : null}
                </p>
              ) : null}
            </ModalSection>

            <ModalSection
              title="Prazos"
              help={`O prazo para indicar o condutor corre da data em que a empresa recebeu a notificação. Usamos ${DEFAULT_INDICATION_DAYS} dias, mas confira o prazo escrito na notificação e ajuste aqui se for diferente (ou se a empresa quiser um prazo interno menor, por causa do correio).`}
            >
              <div className="cr-grid">
                <Field label="Notificação recebida em">
                  <input className={FIELD} type="date" value={form.receivedOn} onChange={onReceived} />
                </Field>
                <Field label="Prazo para indicar o condutor">
                  <input
                    className={FIELD}
                    type="date"
                    value={form.indicationDeadline}
                    onChange={(event) => {
                      setDeadlineTouched(true);
                      set('indicationDeadline')(event);
                    }}
                  />
                </Field>
                <Field label="Vencimento da multa">
                  <input className={FIELD} type="date" value={form.paymentDue} onChange={set('paymentDue')} />
                </Field>
              </div>
            </ModalSection>

            <ModalSection title="Observações">
              <textarea className={AREA} rows={3} value={form.notes} onChange={set('notes')} aria-label="Observações" />
            </ModalSection>

            {notice ? <ModalNotice tone="success">{notice}</ModalNotice> : null}
            {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}
            {confirmRemove && fine ? (
              <div ref={confirmRef}>
                <ModalNotice tone="warning">
                  Remover esta multa da lista? Ela some das telas; nada é apagado do histórico.
                  <span className="cr-confirm">
                    <button type="button" className="mg-button" disabled={busy} onClick={() => setConfirmRemove(false)}>
                      Voltar
                    </button>
                    <button type="button" className="mg-button mg-button-dark" disabled={busy} onClick={() => void run(() => call(`/api/vehicles/fines/${fine.id}`, { method: 'DELETE' }), 'close')}>
                      Remover
                    </button>
                  </span>
                </ModalNotice>
              </div>
            ) : null}
          </div>
          <DialogFooter className={MODAL_FOOTER_CLASS}>
            {fine && !confirmRemove ? (
              <button type="button" className="mg-button cr-remove" disabled={busy} onClick={() => setConfirmRemove(true)}>
                Remover multa
              </button>
            ) : null}
            <button type="button" className="mg-button" disabled={busy} onClick={onClose}>
              {fine ? 'Fechar' : 'Cancelar'}
            </button>
            <button type="submit" className="mg-button mg-button-dark" disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : null} {fine ? 'Salvar' : 'Registrar'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** What a fine needs from the admin now, as a badge. */
function StageBadge({ stage }: { stage: FineStage }) {
  return <span className={`cr-stage is-${stage}`}>{FINE_STAGE_LABELS[stage]}</span>;
}

function DeadlineBadge({ fine, today }: { fine: FineRow; today: string }) {
  const state = indicationState(fine, today);
  if (state === 'none' || state === 'ok') return <span className="cr-muted">{fine.indicatedAt ? '—' : brDate(fine.indicationDeadline)}</span>;
  return <span className={`cr-due is-${state}`}>{state === 'overdue' ? 'Vencido ' : 'Até '}{brDate(fine.indicationDeadline)}</span>;
}

type Scope = 'open' | 'resolved' | 'all';

/** The Multas tab of Carros: every fine, who drove, and what is left to do on each. */
export function FinesPanel({ cars, technicians, onCarsChanged }: { cars: VehicleRow[]; technicians: Technician[]; onCarsChanged: () => Promise<void> }) {
  const [data, setData] = useState<FinesData | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupNote, setLookupNote] = useState('');
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<{ fineId: string | null } | null>(null);
  const [scope, setScope] = useState<Scope>('open');
  const [stage, setStage] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [checked, setChecked] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await call<FinesData>('/api/vehicles/fines'));
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível carregar as multas.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.fines.filter((fine) => {
      if (scope === 'open' && fine.stage === 'resolved') return false;
      if (scope === 'resolved' && fine.stage !== 'resolved') return false;
      if (stage && fine.stage !== stage) return false;
      if (technicianId && fine.technicianId !== technicianId) return false;
      if (vehicleId && fine.vehicleId !== vehicleId) return false;
      return true;
    });
  }, [data, scope, stage, technicianId, vehicleId]);

  async function lookupNow() {
    setLookingUp(true);
    setError('');
    setLookupNote('');
    try {
      const result = await call<{ cars: number; skipped: number; created: number; failed: number; limited: boolean }>('/api/vehicles/fines/lookup', { method: 'POST' });
      setLookupNote(
        result.cars === 0
          ? 'Nada a consultar agora: os carros foram consultados há pouco ou faltam Renavam e estado.'
          : `${result.cars} carro(s) consultado(s): ${result.created === 0 ? 'nenhuma multa nova' : `${result.created} multa(s) nova(s) registrada(s)`}${result.failed ? `, ${result.failed} com falha` : ''}.${result.limited ? ' Ainda há carros esperando: clique de novo.' : ''}`,
      );
      await onCarsChanged();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível consultar agora.');
    } finally {
      setLookingUp(false);
    }
  }

  async function markChecked() {
    try {
      await call('/api/vehicles/fines/checked', { method: 'POST' });
      setChecked(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível concluir.');
    }
  }

  if (cars.length === 0) {
    return <p className="cr-muted">Cadastre um carro na aba Carros para registrar multas.</p>;
  }
  if (!data) return error ? <ModalNotice tone="error">{error}</ModalNotice> : <p className="cr-muted">Carregando…</p>;

  const summary = data.summary;

  return (
    <>
      <div className="cr-toolbar cr-toolbar-wide">
        <button type="button" className="mg-button mg-button-dark" onClick={() => setDialog({ fineId: null })}>
          <Plus size={16} /> Registrar multa
        </button>
        {data.lookup.enabled && data.lookup.configured ? (
          <button type="button" className="mg-button" disabled={lookingUp} onClick={() => void lookupNow()}>
            {lookingUp ? <Loader2 size={16} className="animate-spin" /> : null} Consultar agora
          </button>
        ) : (
          <button type="button" className="mg-button" disabled={checked} onClick={() => void markChecked()}>
            {checked ? 'Consulta da semana feita' : 'Já consultei as multas esta semana'}
          </button>
        )}
        <HelpDot
          label="Multas"
          text={
            data.lookup.enabled
              ? 'Toda semana o sistema consulta as multas dos carros que têm Renavam e estado preenchidos e registra as novas sozinho: ele sugere quem estava com o carro e avisa você no sino. Confira o prazo na notificação e avise o prestador. A indicação do condutor continua sendo feita no site oficial.'
              : 'Uma vez por semana o sino lembra de consultar as multas dos carros no Detran ou na Carteira Digital de Trânsito. Quando achar uma, registre aqui: o sistema sugere quem estava com o carro, avisa o prestador e conta o prazo para indicar o condutor.'
          }
        />
      </div>

      {data.lookup.enabled && !data.lookup.configured ? (
        <ModalNotice tone="warning">A consulta automática ainda não foi configurada pelo NextRotta. Até lá, consulte à mão e registre aqui.</ModalNotice>
      ) : null}
      {lookupNote ? <ModalNotice tone="success">{lookupNote}</ModalNotice> : null}
      {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}
      {data.lookup.enabled
        ? (() => {
            const problems = cars.filter((car) => car.finesCheckStatus && car.finesCheckStatus !== 'ok');
            return problems.length ? (
              <div className="cr-lookup-issues">
                <strong>Carros que a consulta automática não alcançou por completo</strong>
                <ul>
                  {problems.map((car) => (
                    <li key={car.id}>
                      <span className="cr-plate">{formatPlate(car.plate)}</span> <span className="cr-muted">{car.finesCheckMessage}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null;
          })()
        : null}

      <SummaryBand
        items={[
          { label: 'Em aberto', value: summary.open },
          { label: 'Prazo perto de vencer', value: summary.urgent, tone: summary.urgent ? 'bad' : 'default' },
          { label: 'A pagar', value: summary.toPay ? `${summary.toPay} · ${money(summary.toPayAmount)}` : '0' },
        ]}
      />

      <div className="cr-toolbar cr-filters">
        <SegmentedControl
          label="Mostrar"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'open', label: 'Em aberto' },
            { value: 'resolved', label: 'Resolvidas' },
            { value: 'all', label: 'Todas' },
          ]}
        />
        <select className="cr-inline-select" value={stage} onChange={(event) => setStage(event.target.value)} aria-label="Etapa">
          <option value="">Qualquer etapa</option>
          {FINE_STAGES.filter((item) => item !== 'resolved').map((item) => (
            <option key={item} value={item}>
              {FINE_STAGE_LABELS[item]}
            </option>
          ))}
        </select>
        <select className="cr-inline-select" value={technicianId} onChange={(event) => setTechnicianId(event.target.value)} aria-label="Condutor">
          <option value="">Todos os condutores</option>
          {technicians.map((technician) => (
            <option key={technician.id} value={technician.id}>
              {technician.name}
            </option>
          ))}
        </select>
        <select className="cr-inline-select" value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} aria-label="Carro">
          <option value="">Todos os carros</option>
          {cars.map((car) => (
            <option key={car.id} value={car.id}>
              {formatPlate(car.plate)}
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="cr-empty">
          <p>{data.fines.length === 0 ? 'Nenhuma multa registrada.' : 'Nenhuma multa com esses filtros.'}</p>
        </div>
      ) : (
        <div className="cr-table-wrap">
          <table className="cr-table cr-fines-table">
            <thead>
              <tr>
                <th>Carro</th>
                <th>Condutor</th>
                <th>Infração</th>
                <th>Valor</th>
                <th>Próximo passo</th>
                <th>Prazo p/ indicar</th>
                <th aria-label="Abrir" />
              </tr>
            </thead>
            <tbody>
              {rows.map((fine) => (
                <tr key={fine.id}>
                  <td>
                    <span className="cr-plate">{formatPlate(fine.plate)}</span>
                  </td>
                  <td>{fine.technicianName ?? <span className="cr-muted">—</span>}</td>
                  <td>
                    <div className="cr-fine-what">
                      {fine.description}
                      {fine.source === 'auto' ? <span className="cr-auto-tag">Automática</span> : null}
                    </div>
                    <div className="cr-muted">{brDateTime(fine.infractionAt)}</div>
                  </td>
                  <td className="cr-num">{money(fine.amount)}</td>
                  <td>
                    <StageBadge stage={fine.stage} />
                    {fine.driverStance === 'disputes' && fine.stage !== 'resolved' ? <span className="cr-flag">Prestador não concorda</span> : null}
                  </td>
                  <td>{fine.stage === 'resolved' ? <span className="cr-muted">—</span> : <DeadlineBadge fine={fine} today={data.today} />}</td>
                  <td>
                    <button type="button" className="mg-button mg-button-icon" aria-label={`Abrir a multa do ${formatPlate(fine.plate)}`} onClick={() => setDialog({ fineId: fine.id })}>
                      <Pencil size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog ? (
        <FineDialog
          key={dialog.fineId ?? 'new'}
          fineId={dialog.fineId}
          data={data}
          cars={cars}
          technicians={technicians}
          onClose={() => setDialog(null)}
          onChanged={load}
          onCreated={(id) => setDialog({ fineId: id })}
        />
      ) : null}
    </>
  );
}
