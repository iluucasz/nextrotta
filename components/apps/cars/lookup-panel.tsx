'use client';

import { Panel } from '@/components/management-ui';
import { automationState, describeRun } from '@/lib/vehicles/status';
import type { FinesData } from './fines';

/** A short card for the Multas tab: where the automation stands and the last lookup, with the way to the History tab. */
export function LookupSummary({ lookup, onOpenHistory }: { lookup: FinesData['lookup']; onOpenHistory: () => void }) {
  const state = automationState(lookup);
  const last = lookup.runs[0] ? describeRun(lookup.runs[0]) : null;
  return (
    <Panel title="Verificação das multas" help="Todo domingo o sistema consulta as multas das placas cadastradas e registra as novas. O histórico completo, o botão Verificar agora e o interruptor ficam na aba Histórico.">
      <p className="cr-auto-line">
        <span className={`cr-run-dot is-${state.tone}`} aria-hidden="true" />
        <strong>{state.headline}</strong>
      </p>
      <p className="cr-muted cr-auto-detail">{state.detail}</p>
      {last ? (
        <div className="cr-last-run">
          <span className="cr-muted">Última verificação</span>
          <strong>{last.title}</strong>
          <span className="cr-muted">{last.detail}</span>
        </div>
      ) : null}
      <button type="button" className="mg-button cr-side-button" onClick={onOpenHistory}>
        Ver histórico
      </button>
    </Panel>
  );
}
