'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { SectionPanel } from '@/components/settings/kit';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HelpDot } from '@/components/modal-kit';
import { formatCurrency } from '@/lib/formatters';

type Charge = { kind: string; status: string; value: number };

const PAID = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];

/**
 * Setup-fee instalments (how many are paid, the trial) and the self-service cancellation: after it nothing
 * more is charged and the data stays available to download.
 */
export function CancelPanel({
  setupFee,
  setupInstallments,
  charges,
}: {
  setupFee: number;
  setupInstallments: number;
  charges: Charge[];
}) {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setupCharges = charges.filter((charge) => charge.kind === 'setup' && charge.status !== 'DELETED');
  const paidParcels = setupCharges.filter((charge) => PAID.includes(charge.status)).length;
  const paidMonthly = charges.filter((charge) => charge.kind === 'subscription' && PAID.includes(charge.status)).length;
  const trial = setupInstallments > 1 && paidParcels === 1 && paidMonthly === 0;
  const owed = charges
    .filter((charge) => charge.status === 'OVERDUE' && ['setup', 'subscription'].includes(charge.kind))
    .reduce((total, charge) => total + charge.value, 0);

  async function cancel() {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/organization/billing/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: word.trim().toUpperCase() }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível cancelar agora.');
      window.location.assign('/acesso-encerrado');
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Não foi possível cancelar agora.');
      setSaving(false);
    }
  }

  return (
    <SectionPanel title="Implantação e cancelamento">
      <div className="flex flex-col gap-4">
        {setupInstallments > 1 && setupFee > 0 ? (
          <p className="text-sm">
            Implantação de {formatCurrency(setupFee)} em {setupInstallments}x:{' '}
            <strong>
              {paidParcels} de {setupInstallments} pagas
            </strong>
            {trial ? ' · você está no período de teste' : ''}.{' '}
            <HelpDot
              label="Sobre as parcelas"
              text="A 1ª parcela é o teste. Se continuar, as outras vencem junto com a mensalidade; você pode adiantar qualquer uma pelo link em Cobranças."
            />
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            Cancelar assinatura
          </Button>
          <HelpDot
            label="Sobre o cancelamento"
            text="Você pode cancelar quando quiser. A mensalidade e as parcelas que ainda não venceram deixam de ser cobradas, e você baixa seus dados. Cobranças já vencidas continuam em aberto."
          />
        </div>
      </div>

      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cancelar a assinatura?</DialogTitle>
            <DialogDescription>
              O acesso passa a ser só de consulta e download dos seus dados. Nenhuma cobrança nova é gerada e as que ainda não venceram são canceladas.
              {owed > 0 ? ` Você tem ${formatCurrency(owed)} vencidos, que continuam em aberto.` : ''}
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5 text-sm">
            Digite <strong>CANCELAR</strong> para confirmar
            <input
              value={word}
              onChange={(event) => setWord(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3"
              autoComplete="off"
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button type="button" variant="destructive" disabled={saving || word.trim().toUpperCase() !== 'CANCELAR'} onClick={cancel}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Cancelar assinatura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionPanel>
  );
}
