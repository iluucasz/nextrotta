'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Check, Loader2, Plus } from 'lucide-react';
import { SectionPanel } from '@/components/settings/kit';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency, formatDate } from '@/lib/formatters';

type Offer = { key: string; name: string; description: string | null; price: number; setupFee: number };
type Data = { available: boolean; cycle: 'monthly' | 'annual'; modules: Offer[]; current: string[]; effectiveFrom: string | null };
type Result = { module: { key: string; name: string }; price: number; setupFee: number; effectiveFrom: string | null; invoiceUrl: string | null; ticket: { id: string; ticketNumber: number | null } };

const GREEN = 'var(--primary)';

/** "Adicionar módulo": only for a company on "Monte o seu" (a package moves to another package in "Mude de plano"). */
export function ModulesPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [choice, setChoice] = useState<Offer | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    fetch('/api/organization/billing/modules', { cache: 'no-store' })
      .then(async (response) => (response.ok ? setData(await response.json()) : null))
      .catch(() => undefined);
  }, []);

  async function confirm() {
    if (!choice) return;
    setSaving(true);
    setSaveError('');
    try {
      const response = await fetch('/api/organization/billing/modules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: choice.key }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Não foi possível adicionar o módulo agora.');
      setChoice(null);
      setResult(body);
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : 'Não foi possível adicionar o módulo agora.');
    } finally {
      setSaving(false);
    }
  }

  if (!data || !data.available) return null;
  const per = data.cycle === 'annual' ? 'ano' : 'mês';

  return (
    <>
      <SectionPanel
        title="Adicionar módulo"
        description="Cada módulo é liberado na hora. A mensalidade dele entra na sua cobrança do mês seguinte; a implantação do módulo é uma cobrança avulsa, gerada agora."
      >
        {data.modules.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.modules.map((offer) => (
              <li key={offer.key} className="flex items-center justify-between gap-3 rounded-xl border border-border p-4">
                <div className="min-w-0">
                  <p className="font-medium">{offer.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatCurrency(offer.price)}/{per}
                    {offer.setupFee > 0 ? ` · implantação ${formatCurrency(offer.setupFee)}` : ''}
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setChoice(offer)}>
                  <Plus className="h-4 w-4" />
                  Adicionar
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">Você já tem todos os módulos.</p>
        )}
      </SectionPanel>

      <Dialog open={Boolean(choice)} onOpenChange={(open) => !open && !saving && setChoice(null)}>
        <DialogContent className="sm:max-w-lg">
          {choice ? (
            <>
              <DialogHeader>
                <DialogTitle>Adicionar {choice.name}</DialogTitle>
                <DialogDescription>Confira como fica antes de confirmar.</DialogDescription>
              </DialogHeader>
              <dl className="grid gap-3 text-sm">
                <div className="flex justify-between gap-4 rounded-lg border border-border p-3">
                  <dt className="text-muted-foreground">Hoje</dt>
                  <dd className="font-medium">{choice.setupFee > 0 ? `Implantação ${formatCurrency(choice.setupFee)}` : 'Nada a pagar'}</dd>
                </div>
                <div className="flex justify-between gap-4 rounded-lg border border-border p-3">
                  <dt className="text-muted-foreground">{choice.name}</dt>
                  <dd className="font-medium">Liberado na hora</dd>
                </div>
                <div className="flex justify-between gap-4 rounded-lg border border-border p-3">
                  <dt className="text-muted-foreground">Soma na {data.cycle === 'annual' ? 'anuidade' : 'mensalidade'}</dt>
                  <dd className="text-right font-medium">
                    + {formatCurrency(choice.price)}/{per}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {data.effectiveFrom ? `a partir da cobrança de ${formatDate(data.effectiveFrom)}` : 'a partir da próxima cobrança'}
                    </span>
                  </dd>
                </div>
              </dl>
              {saveError ? <p className="text-sm text-rose-700">{saveError}</p> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setChoice(null)} disabled={saving}>
                  Agora não
                </Button>
                <Button type="button" className="text-white hover:opacity-90" style={{ background: GREEN }} onClick={() => void confirm()} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Confirmar
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(result)} onOpenChange={(open) => !open && window.location.reload()}>
        <DialogContent className="sm:max-w-md">
          {result ? (
            <>
              <DialogHeader>
                <DialogTitle>{result.module.name} liberado</DialogTitle>
                <DialogDescription>
                  Já pode usar. Nossa equipe entra em contato para configurar
                  {result.ticket.ticketNumber ? (
                    <>
                      {' '}
                      pelo{' '}
                      <Link href={`/admin/suporte/${result.ticket.id}`} className="font-medium underline underline-offset-2">
                        chamado #{result.ticket.ticketNumber}
                      </Link>
                    </>
                  ) : null}
                  .
                </DialogDescription>
              </DialogHeader>
              {result.invoiceUrl ? (
                <p className="text-sm">
                  Implantação de {formatCurrency(result.setupFee)}:{' '}
                  <a href={result.invoiceUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                    pagar agora
                  </a>
                </p>
              ) : null}
              <DialogFooter>
                <Button type="button" className="text-white hover:opacity-90" style={{ background: GREEN }} onClick={() => window.location.reload()}>
                  Começar a usar
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
