'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Loader2, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS, ModalNotice } from '@/components/modal-kit';
import { countWarnings } from '@/lib/porto-status';
import { formatDetailExtra, jobDetailActionLabel, type PortoJobResult } from '@/lib/porto-ui-helpers';
import { formatDate } from '@/lib/formatters';
import { cn } from '@/lib/utils';

const WARNING_NOTE = 'Atenção';

function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * What one run did, in plain words: the verdict first, then the numbers, then what the robot found (grouped, with the
 * things worth a look first) and, if the person wants, technician by technician.
 */
export function JobDialog({ job, result, running, onClose }: { job: 'hours' | 'schedule'; result: PortoJobResult | null; running: boolean; onClose: () => void }) {
  const [showAll, setShowAll] = useState(false);
  const title = job === 'hours' ? 'Horas trabalhadas' : 'Escala';
  const dry = result?.status === 'dry_run';
  const details = useMemo(() => (result?.details ?? []).filter((detail) => detail.qra), [result]);
  const warnings = countWarnings(result?.details);

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const detail of result?.details ?? []) {
      const action = typeof detail.action === 'string' ? detail.action : 'unknown';
      counts.set(action, (counts.get(action) ?? 0) + 1);
    }
    return [...counts.entries()].map(([action, count]) => ({ action, count, label: jobDetailActionLabel(action) }));
  }, [result]);

  const isWarning = (action: string | undefined) => countWarnings([{ action }]) > 0;
  const rows = showAll ? details : details.filter((detail) => isWarning(detail.action));

  const failed = result?.status === 'error' || result?.status === 'skipped';

  const verdict =
    result?.status === 'error'
      ? { tone: 'error' as const, icon: XCircle, text: 'A importação falhou.', extra: result.error }
      : result?.status === 'skipped'
        ? { tone: 'warning' as const, icon: Clock3, text: 'Não rodou: a importação estava desligada.', extra: undefined }
        : dry
          ? { tone: 'warning' as const, icon: CheckCircle2, text: 'Teste concluído. Nada foi gravado.', extra: warnings ? `${warnings} ponto(s) para olhar abaixo.` : 'Tudo o que o robô viu parece certo.' }
          : result?.status === 'partial' || warnings
            ? { tone: 'warning' as const, icon: CheckCircle2, text: 'Importação concluída, com avisos.', extra: `${warnings} ponto(s) para olhar abaixo.` }
            : { tone: 'success' as const, icon: CheckCircle2, text: 'Importação concluída. Tudo certo.', extra: undefined };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)] sm:max-w-3xl">
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <DialogTitle className={MODAL_TITLE_CLASS}>{running ? `Simulando: ${title}` : title}</DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>
            {running || dry ? 'O robô entra no Portal do Prestador de verdade, mas não grava nada no seu sistema.' : 'Este é o resultado registrado desta importação.'}
          </DialogDescription>
        </DialogHeader>

        <div className={cn(MODAL_BODY_CLASS, 'space-y-5')}>
          {running || !result ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="max-w-md">Entrando no Porto, buscando os serviços e calculando. Um mês inteiro pode levar vários minutos. Pode fechar esta janela: o robô continua e o resultado fica em &ldquo;Atividade&rdquo;.</p>
            </div>
          ) : (
            <>
              <ModalNotice tone={verdict.tone}>
                <span className="flex items-start gap-2">
                  <verdict.icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>{verdict.text}</strong>
                    {verdict.extra ? <span className="block">{verdict.extra}</span> : null}
                  </span>
                </span>
              </ModalNotice>

              {failed ? null : (
              <dl className="grid grid-cols-3 gap-4 rounded-xl bg-secondary/40 px-5 py-4">
                <Figure label="Técnicos" value={result.technicians_processed ?? '—'} />
                <Figure label={dry ? 'Dias que seriam gravados' : job === 'hours' ? 'Dias gravados' : 'Dias de escala'} value={result.would_write ?? result.rows_written ?? '—'} />
                <Figure label="Período" value={result.range ? (result.range.start === result.range.end ? formatDate(result.range.start) : `${formatDate(result.range.start)} a ${formatDate(result.range.end)}`) : 'Mês atual'} />
              </dl>
              )}

              {groups.length ? (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">O que o robô encontrou</h3>
                  <ul className="flex flex-wrap gap-2">
                    {groups.map((group) => (
                      <li key={group.action} className={cn('rounded-lg border px-3 py-1.5 text-sm', isWarning(group.action) ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-border bg-background')}>
                        <strong className="tabular-nums">{group.count}</strong> {group.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {details.length ? (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">{showAll ? 'Técnico por técnico' : `${WARNING_NOTE}: o que merece um olhar`}</h3>
                    <button type="button" onClick={() => setShowAll((value) => !value)} className="text-sm font-medium text-primary hover:underline">
                      {showAll ? 'Mostrar só os avisos' : `Ver todos (${details.length})`}
                    </button>
                  </div>
                  {rows.length ? (
                    <div className="overflow-hidden rounded-xl border border-border">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-secondary/50 text-xs text-muted-foreground">
                          <tr>
                            <th className="px-4 py-2 font-medium">Técnico</th>
                            <th className="px-4 py-2 font-medium">O que aconteceu</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((detail, index) => (
                            <tr key={`${detail.qra}-${index}`} className="border-t border-border align-top">
                              <td className="px-4 py-2">
                                {detail.technician_name || (detail.porto_name ? `${detail.porto_name} (no Porto)` : '—')}
                                <small className="block text-muted-foreground">QRA {detail.qra}</small>
                              </td>
                              <td className="px-4 py-2">
                                {jobDetailActionLabel(detail.action)}
                                {formatDetailExtra(detail) !== '-' ? <small className="block break-words text-muted-foreground">{formatDetailExtra(detail)}</small> : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nada fora do esperado.</p>
                  )}
                </div>
              ) : result?.status === 'skipped' ? null : failed ? (
                <p className="text-sm text-muted-foreground">Tente de novo em alguns minutos. Se repetir, confira o login na conta do Porto.</p>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum técnico foi processado.</p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
