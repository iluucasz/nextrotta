'use client';

import { Panel } from '@/components/management-ui';
import { describeRun } from '@/lib/vehicles/status';
import { brDate } from './call';
import type { FinesData } from './fines';

const WEEKDAY = 'domingo';

/** The weekly automatic lookup of the fines: when it runs, whether today's manual one is spent, and what each lookup found. */
export function LookupPanel({ lookup }: { lookup: FinesData['lookup'] }) {
  if (!lookup.enabled) {
    return (
      <Panel
        title="Verificação das multas"
        help="Com a consulta automática ligada, todo domingo o sistema consulta as multas das placas cadastradas e registra as novas sozinho; e dá para verificar na hora, uma vez por dia. Peça ao suporte do NextRotta para ligar na sua empresa. Até lá, o sino lembra toda semana de consultar à mão."
      >
        <p className="cr-empty-line">Consulta automática desligada. As multas são registradas à mão.</p>
      </Panel>
    );
  }

  const running = lookup.runs[0]?.status === 'running';
  return (
    <Panel
      title="Verificação das multas"
      help="Todo domingo o sistema consulta as multas de todas as placas cadastradas (com Renavam e estado) e registra as novas. Se o sistema estava fora do ar no domingo, ele faz na segunda. O botão Verificar agora pode ser usado uma vez por dia."
    >
      <dl className="cr-kv">
        <div>
          <dt>Automática</dt>
          <dd>Todo {WEEKDAY}</dd>
        </div>
        <div>
          <dt>Próxima</dt>
          <dd>
            {WEEKDAY}, {brDate(lookup.nextAutomatic).slice(0, 5)}
          </dd>
        </div>
      </dl>
      {!lookup.configured ? <p className="cr-note is-warning">Ainda não foi configurada pelo NextRotta.</p> : null}
      {lookup.lockedToday && !running ? <p className="cr-note">Você já verificou hoje. Libera amanhã.</p> : null}

      <h4 className="cr-group-title">Histórico</h4>
      {lookup.runs.length === 0 ? (
        <p className="cr-empty-line">Nenhuma verificação ainda.</p>
      ) : (
        <ul className="cr-runs">
          {lookup.runs.map((run) => {
            const line = describeRun(run);
            return (
              <li key={run.id} className={`cr-run is-${line.tone}`}>
                <span className="cr-run-dot" aria-hidden="true" />
                <div>
                  <strong>{line.title}</strong>
                  <span>{line.detail}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
