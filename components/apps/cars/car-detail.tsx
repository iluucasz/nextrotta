'use client';

import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ModalSection } from '@/components/modal-kit';
import { MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS } from '@/components/modal-kit';
import { VEHICLE_STATUS_LABELS, formatPlate } from '@/lib/vehicles/rules';
import { carLookupSituation, shortDateTime } from '@/lib/vehicles/status';
import type { FineRow } from '@/lib/vehicles/fines-store';
import type { AssignmentRow, VehicleRow } from '@/lib/vehicles/store';
import { brDate, brDay, call, money } from './call';
import { StageBadge } from './fines';
import { carName, DueBadge } from './kit';
import { dueState } from '@/lib/vehicles/rules';

/** The page of one car: who has it, its papers, how the automatic lookup is doing for it, its fines and its history. */
export function CarDetail({
  car,
  today,
  fines,
  lookupEnabled,
  onClose,
  onEdit,
  onOpenFine,
}: {
  car: VehicleRow;
  today: string;
  /** The fines of this car. */
  fines: FineRow[];
  lookupEnabled: boolean;
  onClose: () => void;
  onEdit: (car: VehicleRow) => void;
  onOpenFine: (fineId: string) => void;
}) {
  const [history, setHistory] = useState<AssignmentRow[] | null>(null);
  useEffect(() => {
    let active = true;
    call<{ history: AssignmentRow[] }>(`/api/vehicles/${car.id}`)
      .then((data) => active && setHistory(data.history))
      .catch(() => active && setHistory([]));
    return () => {
      active = false;
    };
  }, [car.id]);

  const situation = carLookupSituation(car, lookupEnabled);
  const open = fines.filter((fine) => fine.stage !== 'resolved');
  const licensing = dueState(car.licensingDue, today);
  const insurance = dueState(car.insuranceDue, today);

  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <DialogTitle className={MODAL_TITLE_CLASS}>Carro {formatPlate(car.plate)}</DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>{carName(car) || 'Situação do carro'}</DialogDescription>
        </DialogHeader>
        <div className={`${MODAL_BODY_CLASS} space-y-7`}>
          <ModalSection title="Situação">
            <dl className="cr-kv">
              <div>
                <dt>Com o técnico</dt>
                <dd>{car.technicianName ?? 'No pátio'}{car.technicianId && car.assignedAt ? <span className="cr-muted"> desde {brDay(car.assignedAt)}</span> : null}</dd>
              </div>
              <div>
                <dt>Situação</dt>
                <dd>{VEHICLE_STATUS_LABELS[car.status as keyof typeof VEHICLE_STATUS_LABELS] ?? car.status}</dd>
              </div>
              <div>
                <dt>Licenciamento</dt>
                <dd>{car.licensingDue ? <DueBadge label="" state={licensing} date={car.licensingDue} /> : <span className="cr-muted">Sem data</span>}</dd>
              </div>
              <div>
                <dt>Seguro</dt>
                <dd>{car.insuranceDue ? <DueBadge label="" state={insurance} date={car.insuranceDue} /> : <span className="cr-muted">Sem data</span>}</dd>
              </div>
            </dl>
            <div className="cr-car-lookup">
              <span className={`cr-run-dot is-${situation.tone}`} aria-hidden="true" />
              <div>
                <strong>Consulta de multas</strong>
                <span className="cr-muted">{situation.text}</span>
                {car.finesCheckedAt ? <span className="cr-muted">Última: {shortDateTime(car.finesCheckedAt)}</span> : null}
              </div>
            </div>
          </ModalSection>

          <ModalSection title={`Multas (${fines.length})`}>
            {fines.length === 0 ? (
              <p className="cr-empty-line">Nenhuma multa neste carro.</p>
            ) : (
              <ul className="cr-car-fines">
                {fines.map((fine) => (
                  <li key={fine.id}>
                    <button type="button" className="cr-car-fine" onClick={() => onOpenFine(fine.id)}>
                      <span>
                        <strong>{fine.description}</strong>
                        <span className="cr-muted">
                          {brDay(fine.infractionAt)} · {fine.technicianName ?? 'sem condutor'}
                        </span>
                      </span>
                      <span className="cr-car-fine-end">
                        <span className="cr-num">{money(fine.amount)}</span>
                        <StageBadge stage={fine.stage} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {open.length ? <p className="cr-muted">{open.length === 1 ? '1 em aberto.' : `${open.length} em aberto.`}</p> : null}
          </ModalSection>

          <ModalSection title="Quem já ficou com o carro">
            {history === null ? (
              <p className="cr-muted">Carregando…</p>
            ) : history.length === 0 ? (
              <p className="cr-empty-line">Ainda não ficou com nenhum técnico.</p>
            ) : (
              <ul className="cr-history">
                {history.map((row) => (
                  <li key={row.id}>
                    <strong>{row.technicianName ?? 'Técnico removido'}</strong>
                    <span>
                      {brDay(row.assignedAt)} → {row.releasedAt ? brDay(row.releasedAt) : 'até hoje'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ModalSection>
        </div>
        <DialogFooter className={MODAL_FOOTER_CLASS}>
          <button type="button" className="mg-button" onClick={onClose}>
            Fechar
          </button>
          <button type="button" className="mg-button mg-button-dark" onClick={() => onEdit(car)}>
            <Pencil size={15} /> Editar dados
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
