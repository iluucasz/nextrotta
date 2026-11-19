'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ModalNotice, ModalSection, SummaryBand } from '@/components/modal-kit';
import { MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS } from '@/components/modal-kit';
import { formatPlate } from '@/lib/vehicles/rules';
import { carsWithoutLookup, describeSource, RUN_STATUS_LABEL, runHighlights, shortDateTime, visibleSources, type RunDetails } from '@/lib/vehicles/status';
import type { LookupRun } from '@/lib/vehicles/fines-sync';
import { call, money } from './call';

type Loaded = LookupRun & { details: RunDetails | null };

const duration = (run: Loaded) => {
  if (!run.finishedAt) return null;
  const seconds = Math.max(0, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
};

/** One lookup of the History tab: whether it worked, what each agency said about each car and which fines were new. */
export function RunDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [run, setRun] = useState<Loaded | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    call<{ run: Loaded }>(`/api/vehicles/fines/runs/${runId}`)
      .then((data) => active && setRun(data.run))
      .catch((failure) => active && setError(failure instanceof Error ? failure.message : 'Não foi possível abrir a verificação.'));
    return () => {
      active = false;
    };
  }, [runId]);

  const details = run?.details ?? null;
  const highlights = details ? runHighlights(details) : null;
  const newFines = details ? details.cars.flatMap((car) => visibleSources(car).flatMap((source) => source.created.map((fine) => ({ plate: car.plate, label: source.label, ...fine })))) : [];
  const idle = details ? carsWithoutLookup(details) : [];
  const looked = details ? details.cars.filter((car) => visibleSources(car).length > 0) : [];
  const took = run ? duration(run) : null;

  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <DialogTitle className={MODAL_TITLE_CLASS}>Verificação de {run ? shortDateTime(run.startedAt) : '…'}</DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>{run ? (run.kind === 'weekly' ? 'Automática (domingo)' : 'Pedida por você') : 'Carregando…'}</DialogDescription>
        </DialogHeader>
        <div className={`${MODAL_BODY_CLASS} space-y-7`}>
          {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}
          {!run && !error ? <p className="cr-muted">Carregando…</p> : null}
          {run ? (
            <>
              <SummaryBand
                items={[
                  { label: 'Resultado', value: RUN_STATUS_LABEL[run.status] },
                  { label: 'Carros consultados', value: run.status === 'running' ? '—' : run.cars },
                  { label: 'Multas novas', value: run.status === 'running' ? '—' : run.created, tone: run.created ? 'bad' : 'default' },
                  ...(took ? [{ label: 'Duração', value: took }] : []),
                ]}
              />
              {run.message ? <ModalNotice tone={run.status === 'error' ? 'error' : 'warning'}>{run.message}</ModalNotice> : null}

              {!details ? (
                <p className="cr-empty-line">{run.status === 'running' ? 'Consultando… o detalhe aparece quando terminar.' : 'Esta verificação é anterior ao detalhamento: só o resumo foi guardado.'}</p>
              ) : (
                <>
                  <ModalSection title={`Multas novas (${newFines.length})`}>
                    {newFines.length === 0 ? (
                      <p className="cr-empty-line">{looked.length ? 'Nenhuma multa nova nesta verificação.' : 'Nenhum carro foi consultado.'}</p>
                    ) : (
                      <ul className="cr-run-new-fines">
                        {newFines.map((fine) => (
                          <li key={`${fine.plate}:${fine.ait}`}>
                            <span>
                              <strong className="cr-plate">{formatPlate(fine.plate)}</strong> {fine.description}
                            </span>
                            <span className="cr-muted">
                              {fine.label} · AIT {fine.ait}
                              {fine.amount ? ` · ${money(fine.amount)}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </ModalSection>

                  <ModalSection title={`Carro por carro (${looked.length})`}>
                    {looked.length === 0 ? (
                      <p className="cr-empty-line">Nenhum carro foi consultado.</p>
                    ) : (
                      <ul className="cr-run-cars">
                        {looked.map((car) => (
                          <li key={car.plate} className="cr-run-car">
                            <span className="cr-plate">{formatPlate(car.plate)}</span>
                            <ul className="cr-run-car-sources">
                              {visibleSources(car).map((source) => {
                                const line = describeSource(source);
                                return (
                                  <li key={source.label}>
                                    <span className={`cr-run-dot is-${line.tone}`} aria-hidden="true" />
                                    <span>
                                      <strong>{source.label}</strong> <span className="cr-muted">{line.text}</span>
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    )}
                    {highlights && (highlights.withFailures > 0 || idle.length > 0) ? (
                      <p className="cr-muted">
                        {[
                          highlights.withFailures ? `${highlights.withFailures} ${highlights.withFailures === 1 ? 'carro com órgão sem resposta' : 'carros com órgão sem resposta'}: o sistema tenta de novo na próxima verificação.` : '',
                          idle.length ? `${idle.map((car) => formatPlate(car.plate)).join(', ')}: ainda sem consulta de multas disponível.` : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      </p>
                    ) : null}
                  </ModalSection>
                </>
              )}
            </>
          ) : null}
        </div>
        <DialogFooter className={MODAL_FOOTER_CLASS}>
          <button type="button" className="mg-button" onClick={onClose}>
            Fechar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
