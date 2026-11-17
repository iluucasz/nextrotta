'use client';

import { CheckCircle2 } from 'lucide-react';
import { Panel } from '@/components/management-ui';
import { PROBLEM_GROUP_LABEL, type Problem, type ProblemGroup, type StatusAction } from '@/lib/vehicles/status';
import { Problems } from './status';

const ORDER: ProblemGroup[] = ['deadlines', 'papers', 'lookup'];

/** The Avisos tab: everything that needs a look, by subject, so the first screen can stay quiet. */
export function AlertsTab({ problems, onAction }: { problems: Problem[]; onAction: (action: StatusAction) => void }) {
  if (problems.length === 0) {
    return (
      <div className="cr-empty">
        <CheckCircle2 size={28} aria-hidden />
        <p>Nenhum aviso. Está tudo em dia.</p>
      </div>
    );
  }

  return (
    <div className="cr-alert-groups">
      {ORDER.map((group) => {
        const list = problems.filter((problem) => problem.group === group);
        if (!list.length) return null;
        return (
          <Panel key={group} title={`${PROBLEM_GROUP_LABEL[group]} (${list.length})`}>
            <Problems problems={list} onAction={onAction} />
          </Panel>
        );
      })}
    </div>
  );
}
