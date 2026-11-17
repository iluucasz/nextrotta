'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CarFront, History as HistoryIcon, Pencil, Plus, TriangleAlert } from 'lucide-react';
import { ModalNotice, SegmentedControl } from '@/components/modal-kit';
import { Panel } from '@/components/management-ui';
import { formatPlate, VEHICLE_STATUS_LABELS } from '@/lib/vehicles/rules';
import { carsStatus, finesStatus, fleetProblems, lastLookup, nextDues, type StatusAction, type StatusCard } from '@/lib/vehicles/status';
import type { VehicleRow } from '@/lib/vehicles/store';
import { AlertsTab } from './alerts-tab';
import { CarDetail } from './car-detail';
import { CarDialog } from './car-dialog';
import { brDate, brDay, call, money } from './call';
import { FineDialog, FinesList, useFinesLookup, type FinesData } from './fines';
import { carName, Dues, type Technician } from './kit';
import { HistoryTab } from './history-tab';
import { LookupSummary } from './lookup-panel';
import { StatusHero } from './status';
import { BigTabs } from './tabs';
import './cars.css';

type Fleet = { today: string; vehicles: VehicleRow[]; technicians: Technician[] };
type Tab = 'cars' | 'fines' | 'alerts' | 'history';
type View = 'technicians' | 'cars';

/** A button for one car: its plate, its name and its paper dates. */
function CarChip({ car, today, onOpen }: { car: VehicleRow; today: string; onOpen: (car: VehicleRow) => void }) {
  return (
    <button type="button" className="cr-car" onClick={() => onOpen(car)}>
      <span className="cr-plate">{formatPlate(car.plate)}</span>
      {carName(car) ? <span className="cr-muted">{carName(car)}</span> : null}
      <Dues car={car} today={today} />
    </button>
  );
}

/** /admin/apps/carros: who has each car, what is about to expire, and the fines. */
export function FleetApp() {
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [fines, setFines] = useState<FinesData | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('cars');
  const [view, setView] = useState<View>('technicians');
  const [carDialog, setCarDialog] = useState<{ car: VehicleRow | null } | null>(null);
  const [detailCar, setDetailCar] = useState<VehicleRow | null>(null);
  const [fineDialog, setFineDialog] = useState<{ fineId: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cars, list] = await Promise.all([call<Fleet>('/api/vehicles'), call<FinesData>('/api/vehicles/fines')]);
      setFleet(cars);
      setFines(list);
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível carregar os carros.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // The bell links straight to the fines (?tab=multas).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'multas') setTab('fines');
  }, []);

  const lookup = useFinesLookup(load);
  // A lookup runs in the background: while the history says "consultando", ask again every few seconds.
  const running = fines?.lookup.runs[0]?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [running, load]);

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

  async function markChecked() {
    try {
      await call('/api/vehicles/fines/checked', { method: 'POST' });
      setChecked(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível concluir.');
    }
  }

  const cars = useMemo(() => fleet?.vehicles ?? [], [fleet]);
  const today = fleet?.today ?? '';
  const lookupEnabled = Boolean(fines?.lookup.enabled);

  const problems = useMemo(
    () => (fleet && fines ? fleetProblems({ cars, fines: fines.fines, today: fleet.today, lookupEnabled }) : []),
    [fleet, fines, cars, lookupEnabled],
  );
  const fineProblems = useMemo(() => problems.filter((problem) => problem.group === 'deadlines'), [problems]);
  // The status cards only sum things up; the rows live in the Avisos tab, so the first screen stays quiet.
  const withAlerts = (card: StatusCard, count: number): StatusCard =>
    count > 0 && !card.cta ? { ...card, cta: { label: `Ver avisos (${count})`, action: { kind: 'alerts' } } } : card;

  /** A button on the status card or on a problem row: open the car or the fine, or move to the other tab. */
  function act(action: StatusAction) {
    switch (action.kind) {
      case 'add-car':
        setCarDialog({ car: null });
        break;
      case 'add-fine':
        // A fine belongs to a car: with none yet, the first thing to do is add one.
        if (cars.length === 0) setCarDialog({ car: null });
        else {
          setTab('fines');
          setFineDialog({ fineId: null });
        }
        break;
      case 'car': {
        const car = cars.find((item) => item.id === action.carId);
        if (car) setCarDialog({ car });
        break;
      }
      case 'fine':
        setTab('fines');
        setFineDialog({ fineId: action.fineId });
        break;
      case 'fines':
        setTab('fines');
        break;
      case 'cars':
        setTab('cars');
        setView('cars');
        break;
      case 'alerts':
        setTab('alerts');
        break;
    }
  }

  // Cars grouped by who has them (a technician who was deactivated still shows, with his cars), the yard apart.
  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; cars: VehicleRow[] }>();
    for (const car of cars) {
      if (!car.technicianId) continue;
      const known = fleet?.technicians.find((technician) => technician.id === car.technicianId);
      const entry = map.get(car.technicianId) ?? { id: car.technicianId, name: known ? known.name : `${car.technicianName ?? 'Técnico'} (inativo)`, cars: [] };
      entry.cars.push(car);
      map.set(car.technicianId, entry);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [cars, fleet]);
  const yard = cars.filter((car) => !car.technicianId);
  const withoutCar = (fleet?.technicians ?? []).filter((technician) => !cars.some((car) => car.technicianId === technician.id));

  const carsCard = useMemo(() => withAlerts(carsStatus(cars, problems), problems.length), [cars, problems]);
  const finesCard = useMemo(() => (fines && fleet ? withAlerts(finesStatus(fines.fines, fleet.today, lookupEnabled), fineProblems.length) : null), [fines, fleet, lookupEnabled, fineProblems]);
  const dues = useMemo(() => nextDues(cars, today, 5), [cars, today]);
  const lastChecked = lastLookup(cars);
  const ready = Boolean(fleet && fines);

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
          <p>Quem está com cada carro e as multas da frota.</p>
        </div>
        <div className="mg-header-actions cr-header-actions">
          {ready && fines?.lookup.enabled && fines.lookup.configured ? (
            <button
              type="button"
              className="mg-button"
              disabled={lookup.busy || running || fines.lookup.lockedToday}
              title={fines.lookup.lockedToday ? 'Você já verificou hoje. Libera amanhã.' : undefined}
              onClick={() => void lookup.run()}
            >
              {lookup.busy || running ? 'Verificando…' : fines.lookup.lockedToday ? 'Verificado hoje' : 'Verificar agora'}
            </button>
          ) : tab === 'fines' && ready ? (
            <button type="button" className="mg-button" disabled={checked} onClick={() => void markChecked()}>
              {checked ? 'Consulta da semana feita' : 'Já consultei esta semana'}
            </button>
          ) : null}
          {tab === 'cars' ? (
            <button type="button" className="mg-button mg-button-dark" onClick={() => act({ kind: 'add-car' })}>
              <Plus size={16} /> Adicionar carro
            </button>
          ) : tab === 'fines' ? (
            <button type="button" className="mg-button mg-button-dark" onClick={() => act({ kind: 'add-fine' })}>
              <Plus size={16} /> Registrar multa
            </button>
          ) : null}
        </div>
      </header>

      <div className="cr-tabs">
        <BigTabs
          label="Áreas dos carros"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'cars', label: 'Carros', icon: CarFront, badge: cars.length },
            { value: 'fines', label: 'Multas', icon: TriangleAlert, badge: fines?.summary.open ?? 0, urgent: Boolean(fines?.summary.urgent) },
            { value: 'alerts', label: 'Avisos', icon: Bell, badge: problems.length, urgent: problems.some((problem) => problem.tone === 'danger') },
            { value: 'history', label: 'Histórico', icon: HistoryIcon },
          ]}
        />
      </div>

      {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}
      {lookup.note ? <ModalNotice tone={lookup.note.tone}>{lookup.note.text}</ModalNotice> : null}

      {!ready ? (
        error ? null : <p className="cr-muted">Carregando…</p>
      ) : tab === 'alerts' ? (
        <AlertsTab problems={problems} onAction={act} />
      ) : tab === 'history' ? (
        <HistoryTab
          lookup={fines!.lookup}
          cars={cars}
          running={running}
          onOpenCar={(car) => setDetailCar(car)}
        />
      ) : tab === 'fines' ? (
        <>
          {finesCard ? <StatusHero card={finesCard} onAction={act} /> : null}
          {cars.length === 0 ? null : (
            <div className="cr-layout">
              <Panel
                title="Multas"
                help={
                  lookupEnabled
                    ? 'Toda semana o sistema consulta as multas dos carros que têm Renavam e estado preenchidos e registra as novas sozinho: ele sugere quem estava com o carro e avisa você no sino. Confira o prazo na notificação e avise o prestador. A indicação do condutor continua sendo feita no site oficial.'
                    : 'Uma vez por semana o sino lembra de consultar as multas dos carros no Detran ou na Carteira Digital de Trânsito. Quando achar uma, registre aqui: o sistema sugere quem estava com o carro, avisa o prestador e conta o prazo para indicar o condutor.'
                }
              >
                <FinesList data={fines!} cars={cars} technicians={fleet!.technicians} onOpen={(fineId) => setFineDialog({ fineId })} />
              </Panel>
              <div className="cr-side">
                <LookupSummary lookup={fines!.lookup} onOpenHistory={() => setTab('history')} />
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <StatusHero card={carsCard} onAction={act} />

          {cars.length > 0 ? (
            <div className="cr-layout">
              <Panel
                title="Carros"
                help="Em 'Por técnico' você vê quem está com cada carro e entrega um carro do pátio. Em 'Todos' dá para trocar o técnico direto na lista. Clique em um carro para editar os dados e ver o histórico."
                badge={
                  <SegmentedControl
                    label="Ver por"
                    value={view}
                    onChange={setView}
                    options={[
                      { value: 'technicians', label: 'Por técnico' },
                      { value: 'cars', label: 'Todos' },
                    ]}
                  />
                }
              >
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
                        {cars.map((car) => (
                          <tr key={car.id} className="cr-row-click" onClick={() => setDetailCar(car)}>
                            <td>
                              <button type="button" className="cr-plate-button" aria-label={`Ver a situação do carro ${formatPlate(car.plate)}`} onClick={() => setDetailCar(car)}>
                                <span className="cr-plate">{formatPlate(car.plate)}</span>
                              </button>
                            </td>
                            <td>{carName(car) || <span className="cr-muted">—</span>}</td>
                            <td onClick={(event) => event.stopPropagation()}>
                              <select
                                className="cr-inline-select"
                                value={car.technicianId ?? ''}
                                disabled={busy === car.id}
                                aria-label={`Técnico do carro ${formatPlate(car.plate)}`}
                                onChange={(event) => void give(car, event.target.value)}
                              >
                                <option value="">No pátio</option>
                                {fleet!.technicians.map((technician) => (
                                  <option key={technician.id} value={technician.id}>
                                    {technician.name}
                                  </option>
                                ))}
                                {car.technicianId && !fleet!.technicians.some((technician) => technician.id === car.technicianId) ? (
                                  <option value={car.technicianId}>{car.technicianName} (inativo)</option>
                                ) : null}
                              </select>
                            </td>
                            <td className="cr-num">{car.odometer === null ? '—' : car.odometer.toLocaleString('pt-BR')}</td>
                            <td>
                              <Dues car={car} today={today} empty />
                            </td>
                            <td>
                              <span className={`cr-status is-${car.status}`}>{VEHICLE_STATUS_LABELS[car.status as keyof typeof VEHICLE_STATUS_LABELS] ?? car.status}</span>
                            </td>
                            <td>
                              <button type="button" className="mg-button mg-button-icon" aria-label={`Editar ${formatPlate(car.plate)}`} onClick={(event) => {
                                  event.stopPropagation();
                                  setCarDialog({ car });
                                }}>
                                <Pencil size={15} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="cr-groups">
                    <ul className="cr-rows">
                      {groups.map((group) => (
                        <li
                          key={group.id}
                          className={group.cars.length === 1 ? 'cr-row cr-row-click' : 'cr-row'}
                          onClick={group.cars.length === 1 ? () => setDetailCar(group.cars[0]) : undefined}
                        >
                          <span className="cr-row-name">{group.name}</span>
                          <div className="cr-row-cars">
                            {group.cars.map((car) => (
                              <CarChip key={car.id} car={car} today={today} onOpen={(item) => setDetailCar(item)} />
                            ))}
                          </div>
                        </li>
                      ))}
                      {yard.length ? (
                        <li className="cr-row is-yard">
                          <span className="cr-row-name">No pátio</span>
                          <div className="cr-row-cars">
                            {yard.map((car) => (
                              <CarChip key={car.id} car={car} today={today} onOpen={(item) => setDetailCar(item)} />
                            ))}
                          </div>
                        </li>
                      ) : null}
                    </ul>

                    {withoutCar.length ? (
                      <>
                        <h4 className="cr-group-title">Sem carro</h4>
                        <ul className="cr-rows">
                          {withoutCar.map((technician) => (
                            <li key={technician.id} className="cr-row is-quiet">
                              <span className="cr-row-name">{technician.name}</span>
                              {yard.length ? (
                                <select
                                  className="cr-inline-select"
                                  value=""
                                  aria-label={`Dar um carro do pátio a ${technician.name}`}
                                  onChange={(event) => {
                                    const car = yard.find((item) => item.id === event.target.value);
                                    if (car) void give(car, technician.id);
                                  }}
                                >
                                  <option value="">Dar um carro…</option>
                                  {yard.map((car) => (
                                    <option key={car.id} value={car.id}>
                                      {formatPlate(car.plate)}
                                      {car.model ? ` · ${car.model}` : ''}
                                    </option>
                                  ))}
                                </select>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </div>
                )}
              </Panel>

              <div className="cr-side">
                <Panel title="Multas">
                  <dl className="cr-kv">
                    <div>
                      <dt>Em aberto</dt>
                      <dd>{fines!.summary.open}</dd>
                    </div>
                    <div>
                      <dt>Prazo perto de vencer</dt>
                      <dd className={fines!.summary.urgent ? 'is-bad' : undefined}>{fines!.summary.urgent}</dd>
                    </div>
                    <div>
                      <dt>A pagar</dt>
                      <dd>{fines!.summary.toPay ? money(fines!.summary.toPayAmount) : '—'}</dd>
                    </div>
                    {lookupEnabled ? (
                      <div>
                        <dt>Última consulta</dt>
                        <dd>{lastChecked ? brDay(lastChecked) : 'ainda não'}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <button type="button" className="mg-button cr-side-button" onClick={() => act({ kind: 'fines' })}>
                    Ver multas
                  </button>
                </Panel>

                <Panel title="Próximos vencimentos" help="Informe o vencimento do licenciamento e do seguro dentro de cada carro. Quando faltar 30 dias, o sino avisa.">
                  {dues.length === 0 ? (
                    <p className="cr-empty-line">Nenhum vencimento informado.</p>
                  ) : (
                    <ul className="cr-dues-list">
                      {dues.map((item) => {
                        const car = cars.find((candidate) => candidate.id === item.carId);
                        return (
                          <li key={`${item.carId}:${item.label}`}>
                            <button type="button" className="cr-due-row" onClick={() => car && setCarDialog({ car })}>
                              <span className="cr-plate">{formatPlate(item.plate)}</span>
                              <span className="cr-due-label">{item.label}</span>
                              <span className={`cr-due is-${item.state}`}>{brDate(item.date)}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Panel>
              </div>
            </div>
          ) : null}
        </>
      )}

      {detailCar && fleet && fines ? (
        <CarDetail
          key={detailCar.id}
          car={cars.find((item) => item.id === detailCar.id) ?? detailCar}
          today={fleet.today}
          fines={fines.fines.filter((fine) => fine.vehicleId === detailCar.id)}
          lookupEnabled={lookupEnabled}
          onClose={() => setDetailCar(null)}
          onEdit={(car) => {
            setDetailCar(null);
            setCarDialog({ car });
          }}
          onOpenFine={(fineId) => {
            setDetailCar(null);
            setTab('fines');
            setFineDialog({ fineId });
          }}
        />
      ) : null}

      {carDialog && fleet ? (
        <CarDialog
          car={carDialog.car}
          technicians={fleet.technicians}
          onClose={() => setCarDialog(null)}
          onSaved={() => {
            setCarDialog(null);
            void load();
          }}
        />
      ) : null}

      {fineDialog && fleet && fines ? (
        <FineDialog
          key={fineDialog.fineId ?? 'new'}
          fineId={fineDialog.fineId}
          data={fines}
          cars={cars}
          technicians={fleet.technicians}
          onClose={() => setFineDialog(null)}
          onChanged={load}
          onCreated={(id) => setFineDialog({ fineId: id })}
        />
      ) : null}
    </div>
  );
}
