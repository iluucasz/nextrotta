'use client';

import { AlertTriangle, CheckCircle2, Loader2, PlugZap } from 'lucide-react';
import { Panel } from '@/components/management-ui';
import { formatPlate } from '@/lib/vehicles/rules';
import { automationState, carLookupSituation, RUN_STATUS_LABEL, shortDateTime } from '@/lib/vehicles/status';
import type { VehicleRow } from '@/lib/vehicles/store';
import type { FinesData } from './fines';
import { cn } from '@/lib/utils';

const TONE_ICON = { neutral: PlugZap, success: CheckCircle2, warning: AlertTriangle, danger: AlertTriangle } as const;

/** The state of the weekly lookup, with the switch to keep it on and the manual button. Shared by the History tab and the Multas side card. */
export function AutomationCard({
  lookup,
  running,
  busy,
  onRun,
}: {
  lookup: FinesData['lookup'];
  running: boolean;
  busy: boolean;
  onRun: () => void;
}) {
  const state = automationState(lookup);
  const Icon = TONE_ICON[state.tone];
  const usable = lookup.enabled && lookup.configured;
  const locked = lookup.lockedToday;

  return (
    <section className={cn('cr-hero', state.tone)}>
      <span className="cr-hero-icon" aria-hidden="true">
        <Icon size={26} />
      </span>
      <div className="cr-hero-text">
        <h2>{state.headline}</h2>
        <p>{state.detail}</p>
      </div>
      {usable ? (
        <div className="cr-auto-controls">
          <button type="button" className="mg-button" disabled={busy || running || locked} title={locked ? 'Você já verificou hoje. Libera amanhã.' : undefined} onClick={onRun}>
            {busy || running ? <Loader2 size={16} className="animate-spin" /> : null}
            {busy || running ? 'Verificando…' : locked ? 'Verificado hoje' : 'Verificar agora'}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** The History tab: how the automation is, every lookup that happened (weekly and manual) and how each car stands. */
export function HistoryTab({
  lookup,
  cars,
  running,
  busy,
  onRun,
  onOpenCar,
}: {
  lookup: FinesData['lookup'];
  cars: VehicleRow[];
  running: boolean;
  busy: boolean;
  onRun: () => void;
  onOpenCar: (car: VehicleRow) => void;
}) {
  return (
    <>
      <AutomationCard lookup={lookup} running={running} busy={busy} onRun={onRun} />
      {lookup.enabled && lookup.lockedToday && !running ? <p className="cr-note">Você já verificou hoje. A verificação manual volta amanhã; a automática roda todo domingo.</p> : null}

      <div className="cr-layout">
        <Panel
          title="Verificações"
          help="Cada vez que o sistema consulta as multas dos carros aparece aqui: a automática de domingo e as que você pediu. Mostra quantos carros foram consultados e quantas multas novas apareceram."
        >
          {lookup.runs.length === 0 ? (
            <p className="cr-empty-line">{lookup.enabled ? 'Nenhuma verificação ainda. A primeira sai no próximo domingo.' : 'Nenhuma verificação: a consulta automática está desligada.'}</p>
          ) : (
            <div className="cr-table-wrap">
              <table className="cr-table cr-runs-table">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Tipo</th>
                    <th>Carros</th>
                    <th>Multas novas</th>
                    <th>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {lookup.runs.map((run) => (
                    <tr key={run.id}>
                      <td className="cr-nowrap">{shortDateTime(run.startedAt)}</td>
                      <td>{run.kind === 'weekly' ? 'Automática' : 'Manual'}</td>
                      <td className="cr-num">{run.status === 'running' ? '—' : run.cars}</td>
                      <td className="cr-num">{run.status === 'running' ? '—' : run.created}</td>
                      <td>
                        <span className={`cr-run-status is-${run.status}`}>{RUN_STATUS_LABEL[run.status]}</span>
                        {run.message ? <div className="cr-muted cr-run-message">{run.message}</div> : null}
                        {run.status === 'partial' && !run.message ? <div className="cr-muted cr-run-message">{run.failed} sem resposta</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Situação de cada carro" help="O resultado da última consulta de cada carro. Falta Renavam ou estado? Abra o carro e preencha; ele entra na próxima verificação.">
          <ul className="cr-car-status">
            {cars.map((car) => {
              const situation = carLookupSituation(car, lookup.enabled);
              return (
                <li key={car.id}>
                  <button type="button" className="cr-car-status-row" onClick={() => onOpenCar(car)}>
                    <span className="cr-plate">{formatPlate(car.plate)}</span>
                    <span className={`cr-run-dot is-${situation.tone}`} aria-hidden="true" />
                    <span className="cr-car-status-text">{situation.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </>
  );
}
