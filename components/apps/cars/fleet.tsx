'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Car, Loader2, Pencil, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HelpDot, ModalNotice, ModalSection, SegmentedControl, SummaryBand } from '@/components/modal-kit';
import { MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS } from '@/components/modal-kit';
import { dueState, formatPlate, VEHICLE_STATUS_LABELS, VEHICLE_STATUSES, type DueState } from '@/lib/vehicles/rules';
import type { AssignmentRow, VehicleRow } from '@/lib/vehicles/store';
import './cars.css';

type Technician = { id: string; name: string };
type Fleet = { today: string; vehicles: VehicleRow[]; technicians: Technician[] };

const FIELD = 'h-10 w-full rounded-md border border-input bg-background px-3 text-[15px]';

const brDate = (value: string | null) => (value ? value.split('-').reverse().join('/') : '—');
const brDateTime = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
const carName = (car: VehicleRow) => [car.brand, car.model, car.year].filter(Boolean).join(' ');

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Não foi possível concluir. Tente de novo.');
  return data as T;
}

function DueBadge({ label, state, date }: { label: string; state: DueState; date: string | null }) {
  if (state === 'none') return null;
  const text = state === 'overdue' ? 'vencido' : state === 'soon' ? 'vence em breve' : 'em dia';
  return (
    <span className={`cr-due is-${state}`} title={`${label}: ${brDate(date)} (${text})`}>
      {label} {brDate(date)}
    </span>
  );
}

function Dues({ car, today }: { car: VehicleRow; today: string }) {
  const licensing = dueState(car.licensingDue, today);
  const insurance = dueState(car.insuranceDue, today);
  if (licensing === 'none' && insurance === 'none') return <span className="cr-muted">—</span>;
  return (
    <span className="cr-dues">
      <DueBadge label="Licenc." state={licensing} date={car.licensingDue} />
      <DueBadge label="Seguro" state={insurance} date={car.insuranceDue} />
    </span>
  );
}

type Form = {
  plate: string;
  brand: string;
  model: string;
  year: string;
  color: string;
  fuel: string;
  odometer: string;
  renavam: string;
  chassis: string;
  licensingDue: string;
  insuranceDue: string;
  status: string;
  technicianId: string;
  notes: string;
};

const emptyForm: Form = {
  plate: '', brand: '', model: '', year: '', color: '', fuel: '', odometer: '', renavam: '', chassis: '',
  licensingDue: '', insuranceDue: '', status: 'active', technicianId: '', notes: '',
};

const toForm = (car: VehicleRow): Form => ({
  plate: formatPlate(car.plate), brand: car.brand ?? '', model: car.model, year: car.year ? String(car.year) : '', color: car.color ?? '',
  fuel: car.fuel ?? '', odometer: car.odometer === null ? '' : String(car.odometer), renavam: car.renavam ?? '', chassis: car.chassis ?? '',
  licensingDue: car.licensingDue ?? '', insuranceDue: car.insuranceDue ?? '', status: car.status, technicianId: car.technicianId ?? '', notes: car.notes ?? '',
});

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`cr-field${wide ? ' is-wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Add (car = null) or edit a car: its data, who has it, and its history. */
function CarDialog({
  car,
  technicians,
  onClose,
  onSaved,
}: {
  car: VehicleRow | null;
  technicians: Technician[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Form>(car ? toForm(car) : emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [history, setHistory] = useState<AssignmentRow[] | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const set = (key: keyof Form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  // The confirmation sits at the end of a scrolling dialog: bring it into view when it opens.
  useEffect(() => {
    if (confirmRemove) confirmRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [confirmRemove]);

  useEffect(() => {
    if (!car) return;
    let active = true;
    call<{ history: AssignmentRow[] }>(`/api/vehicles/${car.id}`)
      .then((data) => active && setHistory(data.history))
      .catch(() => active && setHistory([]));
    return () => {
      active = false;
    };
  }, [car]);

  async function run(action: () => Promise<unknown>) {
    setSaving(true);
    setError('');
    try {
      await action();
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível concluir.');
      setSaving(false);
    }
  }

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    void run(() =>
      call(car ? `/api/vehicles/${car.id}` : '/api/vehicles', { method: car ? 'PATCH' : 'POST', body: JSON.stringify(form) }),
    );
  };

  // The technician who has the car now may have been deactivated since: keep him in the list so the select is not blank.
  const options = car?.technicianId && !technicians.some((technician) => technician.id === car.technicianId)
    ? [...technicians, { id: car.technicianId, name: `${car.technicianName ?? 'Técnico'} (inativo)` }]
    : technicians;

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <DialogTitle className={MODAL_TITLE_CLASS}>{car ? `Carro ${formatPlate(car.plate)}` : 'Adicionar carro'}</DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>{car ? carName(car) : 'Dados do carro e com qual técnico ele fica.'}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
          <div className={`${MODAL_BODY_CLASS} space-y-7`}>
            <ModalSection title="Carro">
              <div className="cr-grid">
                <Field label="Placa">
                  <input className={FIELD} value={form.plate} onChange={set('plate')} placeholder="ABC-1D23" autoCapitalize="characters" required />
                </Field>
                <Field label="Modelo">
                  <input className={FIELD} value={form.model} onChange={set('model')} placeholder="Strada" required />
                </Field>
                <Field label="Marca">
                  <input className={FIELD} value={form.brand} onChange={set('brand')} placeholder="Fiat" />
                </Field>
                <Field label="Ano">
                  <input className={FIELD} value={form.year} onChange={set('year')} inputMode="numeric" placeholder="2023" />
                </Field>
                <Field label="Cor">
                  <input className={FIELD} value={form.color} onChange={set('color')} />
                </Field>
                <Field label="Combustível">
                  <input className={FIELD} value={form.fuel} onChange={set('fuel')} placeholder="Flex" />
                </Field>
                <Field label="Quilometragem">
                  <input className={FIELD} value={form.odometer} onChange={set('odometer')} inputMode="numeric" placeholder="0" />
                </Field>
                <Field label="Situação">
                  <select className={FIELD} value={form.status} onChange={set('status')}>
                    {VEHICLE_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {VEHICLE_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </ModalSection>

            <ModalSection title="Com o técnico" help="Escolha quem está com o carro. Ao trocar, o histórico guarda quem ficou com ele e por quanto tempo.">
              <select className={FIELD} value={form.technicianId} onChange={set('technicianId')} aria-label="Técnico">
                <option value="">Sem técnico (no pátio)</option>
                {options.map((technician) => (
                  <option key={technician.id} value={technician.id}>
                    {technician.name}
                  </option>
                ))}
              </select>
            </ModalSection>

            <ModalSection title="Documentos" help="Renavam e chassi são opcionais. Com as datas preenchidas, o carro avisa quando o licenciamento ou o seguro estão perto de vencer.">
              <div className="cr-grid">
                <Field label="Renavam">
                  <input className={FIELD} value={form.renavam} onChange={set('renavam')} inputMode="numeric" />
                </Field>
                <Field label="Chassi">
                  <input className={FIELD} value={form.chassis} onChange={set('chassis')} autoCapitalize="characters" />
                </Field>
                <Field label="Licenciamento vence em">
                  <input className={FIELD} type="date" value={form.licensingDue} onChange={set('licensingDue')} />
                </Field>
                <Field label="Seguro vence em">
                  <input className={FIELD} type="date" value={form.insuranceDue} onChange={set('insuranceDue')} />
                </Field>
                <Field label="Observações" wide>
                  <textarea className={`${FIELD} h-20 py-2`} value={form.notes} onChange={set('notes')} maxLength={1000} />
                </Field>
              </div>
            </ModalSection>

            {car ? (
              <ModalSection title="Histórico">
                {history === null ? (
                  <p className="cr-muted">Carregando…</p>
                ) : history.length === 0 ? (
                  <p className="cr-muted">Ainda não ficou com nenhum técnico.</p>
                ) : (
                  <ul className="cr-history">
                    {history.map((row) => (
                      <li key={row.id}>
                        <strong>{row.technicianName ?? 'Técnico removido'}</strong>
                        <span>
                          {brDateTime(row.assignedAt)} → {row.releasedAt ? brDateTime(row.releasedAt) : 'até hoje'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </ModalSection>
            ) : null}

            {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}
            {confirmRemove && car ? (
              <div ref={confirmRef}>
              <ModalNotice tone="warning">
                Remover o carro {formatPlate(car.plate)}? Ele sai da lista e a placa fica livre; o histórico é mantido.
                <span className="cr-confirm">
                  <button type="button" className="mg-button" disabled={saving} onClick={() => setConfirmRemove(false)}>
                    Voltar
                  </button>
                  <button type="button" className="mg-button mg-button-dark" disabled={saving} onClick={() => void run(() => call(`/api/vehicles/${car.id}`, { method: 'DELETE' }))}>
                    Remover
                  </button>
                </span>
              </ModalNotice>
              </div>
            ) : null}
          </div>
          <DialogFooter className={MODAL_FOOTER_CLASS}>
            {car && !confirmRemove ? (
              <button type="button" className="mg-button cr-remove" disabled={saving} onClick={() => setConfirmRemove(true)}>
                Remover carro
              </button>
            ) : null}
            <button type="button" className="mg-button" disabled={saving} onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="mg-button mg-button-dark" disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : null} {car ? 'Salvar' : 'Adicionar'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** /admin/apps/carros: the cars, who has each one, and their paperwork dates. */
export function FleetApp() {
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'technicians' | 'cars'>('technicians');
  const [dialog, setDialog] = useState<{ car: VehicleRow | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFleet(await call<Fleet>('/api/vehicles'));
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível carregar os carros.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function give(car: VehicleRow, technicianId: string) {
    setBusy(car.id);
    setError('');
    try {
      await call(`/api/vehicles/${car.id}`, { method: 'PATCH', body: JSON.stringify({ technicianId }) });
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível trocar o técnico.');
    } finally {
      setBusy(null);
    }
  }

  const summary = useMemo(() => {
    if (!fleet) return null;
    const withTechnician = fleet.vehicles.filter((car) => car.technicianId).length;
    const attention = fleet.vehicles.filter((car) => [dueState(car.licensingDue, fleet.today), dueState(car.insuranceDue, fleet.today)].some((state) => state === 'overdue' || state === 'soon')).length;
    return { total: fleet.vehicles.length, withTechnician, free: fleet.vehicles.length - withTechnician, attention };
  }, [fleet]);

  const freeCars = fleet?.vehicles.filter((car) => !car.technicianId) ?? [];

  return (
    <div className="mg-dashboard cr">
      <header className="mg-page-heading">
        <div>
          <div className="mg-eyebrow">
            <span /> APPS <span className="mg-eyebrow-divider">/</span> CARROS
          </div>
          <h1>
            Carros<span>.</span>
          </h1>
          <p>Quem está com cada carro da empresa.</p>
        </div>
        <div className="mg-header-actions">
          <button type="button" className="mg-button mg-button-dark" onClick={() => setDialog({ car: null })}>
            <Plus size={16} /> Adicionar carro
          </button>
        </div>
      </header>

      {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}

      {!fleet ? (
        error ? null : <p className="cr-muted">Carregando…</p>
      ) : fleet.vehicles.length === 0 ? (
        <div className="cr-empty">
          <Car size={28} aria-hidden />
          <p>Nenhum carro cadastrado.</p>
          <button type="button" className="mg-button mg-button-dark" onClick={() => setDialog({ car: null })}>
            <Plus size={16} /> Adicionar o primeiro carro
          </button>
        </div>
      ) : (
        <>
          {summary ? (
            <SummaryBand
              items={[
                { label: 'Carros', value: summary.total },
                { label: 'Com técnico', value: summary.withTechnician },
                { label: 'No pátio', value: summary.free },
                { label: 'Documentos a vencer', value: summary.attention, tone: summary.attention ? 'bad' : 'default' },
              ]}
            />
          ) : null}

          <div className="cr-toolbar">
            <SegmentedControl
              label="Ver por"
              value={view}
              onChange={setView}
              options={[
                { value: 'technicians', label: 'Por técnico' },
                { value: 'cars', label: 'Todos os carros' },
              ]}
            />
            <HelpDot label="Carros" text="Em 'Por técnico' você vê quem está com cada carro e entrega um carro do pátio. Em 'Todos os carros' dá para trocar o técnico direto na lista. Clique no lápis para editar os dados e ver o histórico." />
          </div>

          {view === 'cars' ? (
            <div className="cr-table-wrap">
              <table className="cr-table">
                <thead>
                  <tr>
                    <th>Placa</th>
                    <th>Carro</th>
                    <th>Técnico</th>
                    <th>Km</th>
                    <th>Documentos</th>
                    <th>Situação</th>
                    <th aria-label="Editar" />
                  </tr>
                </thead>
                <tbody>
                  {fleet.vehicles.map((car) => (
                    <tr key={car.id}>
                      <td>
                        <span className="cr-plate">{formatPlate(car.plate)}</span>
                      </td>
                      <td>{carName(car)}</td>
                      <td>
                        <select
                          className="cr-inline-select"
                          value={car.technicianId ?? ''}
                          disabled={busy === car.id}
                          aria-label={`Técnico do carro ${formatPlate(car.plate)}`}
                          onChange={(event) => void give(car, event.target.value)}
                        >
                          <option value="">No pátio</option>
                          {fleet.technicians.map((technician) => (
                            <option key={technician.id} value={technician.id}>
                              {technician.name}
                            </option>
                          ))}
                          {car.technicianId && !fleet.technicians.some((technician) => technician.id === car.technicianId) ? (
                            <option value={car.technicianId}>{car.technicianName} (inativo)</option>
                          ) : null}
                        </select>
                      </td>
                      <td className="cr-num">{car.odometer === null ? '—' : car.odometer.toLocaleString('pt-BR')}</td>
                      <td>
                        <Dues car={car} today={fleet.today} />
                      </td>
                      <td>
                        <span className={`cr-status is-${car.status}`}>{VEHICLE_STATUS_LABELS[car.status as keyof typeof VEHICLE_STATUS_LABELS] ?? car.status}</span>
                      </td>
                      <td>
                        <button type="button" className="mg-button mg-button-icon" aria-label={`Editar ${formatPlate(car.plate)}`} onClick={() => setDialog({ car })}>
                          <Pencil size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="cr-people">
              {fleet.technicians.map((technician) => {
                const cars = fleet.vehicles.filter((car) => car.technicianId === technician.id);
                return (
                  <section key={technician.id} className="cr-person">
                    <header>
                      <h3>{technician.name}</h3>
                      {freeCars.length ? (
                        <select
                          className="cr-inline-select"
                          value=""
                          aria-label={`Dar um carro do pátio a ${technician.name}`}
                          onChange={(event) => {
                            const car = freeCars.find((item) => item.id === event.target.value);
                            if (car) void give(car, technician.id);
                          }}
                        >
                          <option value="">Dar um carro…</option>
                          {freeCars.map((car) => (
                            <option key={car.id} value={car.id}>
                              {formatPlate(car.plate)} · {car.model}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </header>
                    {cars.length === 0 ? (
                      <p className="cr-muted">Sem carro.</p>
                    ) : (
                      <ul>
                        {cars.map((car) => (
                          <li key={car.id}>
                            <button type="button" className="cr-car" onClick={() => setDialog({ car })}>
                              <span className="cr-plate">{formatPlate(car.plate)}</span>
                              <span>{carName(car)}</span>
                              <Dues car={car} today={fleet.today} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
              {freeCars.length ? (
                <section className="cr-person is-yard">
                  <header>
                    <h3>No pátio (sem técnico)</h3>
                  </header>
                  <ul>
                    {freeCars.map((car) => (
                      <li key={car.id}>
                        <button type="button" className="cr-car" onClick={() => setDialog({ car })}>
                          <span className="cr-plate">{formatPlate(car.plate)}</span>
                          <span>{carName(car)}</span>
                          <Dues car={car} today={fleet.today} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </>
      )}

      {dialog && fleet ? (
        <CarDialog
          car={dialog.car}
          technicians={fleet.technicians}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
