'use client';

import { useState } from 'react';
import { ChevronDown, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HelpDot, MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS } from '@/components/modal-kit';
import { cn } from '@/lib/utils';

/** The technical part, out of the way: simulate a job for a chosen period without writing anything. */
export function Advanced({ busy, onSimulate }: { busy: boolean; onSimulate: (job: 'hours' | 'schedule', range?: { start: string; end: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  return (
    <section className="po-advanced">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Ferramentas avançadas
        <ChevronDown size={15} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="po-advanced-body">
          <p className="po-adv-title">
            Simular sem gravar
            <HelpDot label="Simular" text={'Mostra o que o robô faria, sem gravar nada. Não conta no limite do plano.\nPara as horas, escolha o período; em branco é o mês inteiro até hoje.'} />
          </p>
          <div className="po-range">
            <label>
              De
              <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
            </label>
            <label>
              Até
              <input type="date" value={end} min={start || undefined} disabled={!start} onChange={(event) => setEnd(event.target.value)} />
            </label>
            {start ? (
              <button type="button" className="po-link" onClick={() => (setStart(''), setEnd(''))}>
                Limpar
              </button>
            ) : null}
          </div>
          <div className="po-actions">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onSimulate('hours', start ? { start, end: end || start } : undefined)}>
              <FlaskConical className="h-4 w-4" />
              Simular horas
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onSimulate('schedule')}>
              <FlaskConical className="h-4 w-4" />
              Simular escala
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Going live writes hours and escala for real: say it, and say that nothing done by hand is overwritten. */
export function LiveConfirm({ saving, onCancel, onConfirm }: { saving: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <DialogTitle className={MODAL_TITLE_CLASS}>Gravar de verdade?</DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>A partir de agora o robô grava as horas e a escala no seu sistema, todo dia.</DialogDescription>
        </DialogHeader>
        <div className={cn(MODAL_BODY_CLASS, 'space-y-2 text-sm text-muted-foreground')}>
          <p>Os dias que você lançou à mão não são sobrescritos.</p>
          <p>Você pode voltar para o modo Teste ou desligar quando quiser.</p>
        </div>
        <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'flex-col-reverse sm:flex-row sm:justify-end')}>
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Voltar
          </Button>
          <Button type="button" onClick={onConfirm} disabled={saving}>
            {saving ? 'Ligando…' : 'Sim, gravar de verdade'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
