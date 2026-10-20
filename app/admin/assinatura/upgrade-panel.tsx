'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Check, Loader2, PartyPopper, Rocket, Sparkles, TrendingUp } from 'lucide-react';
import { DataPanel } from '@/components/data-panel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency, formatDate } from '@/lib/formatters';

type Improvement = { label: string; from: string; to: string };
type NewFeature = { key: string; name: string; description: string };

type UpgradeOption = {
  key: string;
  name: string;
  description: string | null;
  basePrice: number;
  value: number;
  newFeatures: NewFeature[];
  improvements: Improvement[];
};

type UpgradeData = {
  current: { key: string; name: string; cycle: 'monthly' | 'annual'; value: number };
  options: UpgradeOption[];
  available: boolean;
  effectiveFrom: string | null;
};

type UpgradeResult = {
  previousPlan: string;
  plan: { key: string; name: string };
  cycle: 'monthly' | 'annual';
  value: number;
  effectiveFrom: string | null;
  newFeatures: NewFeature[];
  improvements: Improvement[];
  ticket: { id: string; ticketNumber: number | null };
};

const GREEN = 'var(--primary)';

function Gains({ option, wide }: { option: Pick<UpgradeOption, 'newFeatures' | 'improvements'>; wide?: boolean }) {
  return (
    <ul className={`grid gap-2 text-sm ${wide ? 'sm:grid-cols-2' : ''}`}>
      {option.newFeatures.map((feature) => (
        <li key={feature.key} className="flex gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: GREEN }} />
          <span>{feature.name}</span>
        </li>
      ))}
      {option.improvements.map((item) => (
        <li key={item.label} className="flex gap-2">
          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0" style={{ color: GREEN }} />
          <span>
            {item.label}:{' '}
            {item.from !== '—' ? <span className="text-muted-foreground line-through">{item.from}</span> : null} <strong>{item.to}</strong>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "Mude de plano": upgrade options, confirmation and the welcome to the new plan. */
export function UpgradePanel() {
  const [data, setData] = useState<UpgradeData | null>(null);
  const [error, setError] = useState('');
  const [choice, setChoice] = useState<UpgradeOption | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [result, setResult] = useState<UpgradeResult | null>(null);

  useEffect(() => {
    fetch('/api/organization/billing/upgrade', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error || 'Não foi possível carregar os planos.');
        setData(body);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os planos.'));
  }, []);

  async function confirm() {
    if (!choice) return;
    setSaving(true);
    setSaveError('');
    try {
      const response = await fetch('/api/organization/billing/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: choice.key }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Não foi possível fazer o upgrade agora.');
      setChoice(null);
      setResult(body);
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : 'Não foi possível fazer o upgrade agora.');
    } finally {
      setSaving(false);
    }
  }

  if (error) return null;
  if (!data || !data.available) return null;

  const per = data.current.cycle === 'annual' ? 'ano' : 'mês';
  const cycleWord = data.current.cycle === 'annual' ? 'anuidade' : 'mensalidade';

  return (
    <>
      <DataPanel
        title="Mude de plano"
        description="Os recursos novos são liberados na hora. O novo valor só entra na cobrança do mês seguinte."
      >
        {data.options.length ? (
          <div className={`grid gap-4 ${data.options.length > 1 ? 'md:grid-cols-2' : ''}`}>
            {data.options.map((option) => (
              <article key={option.key} className="flex flex-col rounded-xl border border-border p-5" style={{ background: '#f7fbf8' }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: GREEN }}>
                      Upgrade
                    </p>
                    <h3 className="mt-1 text-lg font-semibold">Plano {option.name}</h3>
                    {option.description ? <p className="mt-1 text-sm text-muted-foreground">{option.description}</p> : null}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold">{formatCurrency(option.value)}</p>
                    <p className="text-xs text-muted-foreground">/{per}</p>
                  </div>
                </div>
                <p className="mb-2 mt-4 text-sm font-medium">O que você ganha</p>
                <Gains option={option} wide={data.options.length === 1} />
                <div className="mt-auto pt-5">
                  <Button type="button" className="w-full text-white hover:opacity-90" style={{ background: GREEN }} onClick={() => setChoice(option)}>
                    <Rocket className="h-4 w-4" />
                    Fazer upgrade para o {option.name}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            Você já está no plano mais completo. Precisa de algo feito para a sua operação?{' '}
            <Link href="/admin/suporte" className="font-medium text-primary hover:underline">
              Fale com a gente
            </Link>{' '}
            sobre o plano Sob medida.
          </p>
        )}
      </DataPanel>

      <Dialog open={Boolean(choice)} onOpenChange={(open) => !open && !saving && setChoice(null)}>
        <DialogContent className="sm:max-w-lg">
          {choice ? (
            <>
              <DialogHeader>
                <DialogTitle>Upgrade para o plano {choice.name}</DialogTitle>
                <DialogDescription>Confira como fica antes de confirmar.</DialogDescription>
              </DialogHeader>
              <dl className="grid gap-3 text-sm">
                <div className="flex justify-between gap-4 rounded-lg border border-border p-3">
                  <dt className="text-muted-foreground">Hoje</dt>
                  <dd className="font-medium">Nada a pagar</dd>
                </div>
                <div className="flex justify-between gap-4 rounded-lg border border-border p-3">
                  <dt className="text-muted-foreground">Recursos do {choice.name}</dt>
                  <dd className="font-medium">Liberados na hora</dd>
                </div>
                <div className="flex justify-between gap-4 rounded-lg border border-border p-3">
                  <dt className="text-muted-foreground">Nova {cycleWord}</dt>
                  <dd className="text-right font-medium">
                    {formatCurrency(choice.value)}/{per}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {data.effectiveFrom ? `a partir da cobrança de ${formatDate(data.effectiveFrom)}` : 'a partir da próxima cobrança'}
                    </span>
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                Até essa data, nada muda na sua cobrança: o valor atual ({formatCurrency(data.current.value)}/{per}) segue valendo.
              </p>
              {saveError ? <p className="text-sm text-rose-700">{saveError}</p> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setChoice(null)} disabled={saving}>
                  Agora não
                </Button>
                <Button type="button" className="text-white hover:opacity-90" style={{ background: GREEN }} onClick={() => void confirm()} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  Confirmar upgrade
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(result)} onOpenChange={(open) => !open && window.location.reload()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          {result ? (
            <>
              <div className="flex flex-col items-center pt-2 text-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: 'var(--secondary)', color: GREEN }}>
                  <PartyPopper className="h-8 w-8" />
                </span>
                <DialogTitle className="mt-4 text-2xl">Bem-vindo ao plano {result.plan.name}!</DialogTitle>
                <DialogDescription className="mt-2 text-base leading-relaxed">
                  Que decisão! Sua operação acaba de ganhar mais força, mais automação e mais clareza para crescer. Tudo o que o{' '}
                  {result.plan.name} oferece já está liberado para a sua equipe.
                </DialogDescription>
              </div>

              <div className="rounded-xl border border-border p-4">
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="h-4 w-4" style={{ color: GREEN }} />
                  O que chegou para você
                </p>
                <ul className="grid gap-3 text-sm">
                  {result.newFeatures.map((feature) => (
                    <li key={feature.key} className="flex gap-3">
                      <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: GREEN }} />
                      <span>
                        <strong className="font-medium">{feature.name}</strong>
                        {feature.description ? <span className="block text-muted-foreground">{feature.description}</span> : null}
                      </span>
                    </li>
                  ))}
                  {result.improvements.map((item) => (
                    <li key={item.label} className="flex gap-3">
                      <TrendingUp className="mt-0.5 h-4 w-4 shrink-0" style={{ color: GREEN }} />
                      <span>
                        <strong className="font-medium">{item.label}</strong>
                        <span className="block text-muted-foreground">
                          {item.from === '—' ? item.to : `de ${item.from} para ${item.to}`}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl p-4 text-sm leading-relaxed" style={{ background: 'var(--secondary)', color: 'var(--secondary-foreground)' }}>
                <strong>Nossa equipe vai entrar em contato</strong> para configurar as novidades junto com você e deixar tudo funcionando do seu
                jeito.{' '}
                {result.ticket.ticketNumber ? (
                  <>
                    Acompanhe pelo{' '}
                    <Link href={`/admin/suporte/${result.ticket.id}`} className="font-medium underline underline-offset-2">
                      chamado #{result.ticket.ticketNumber}
                    </Link>
                    .
                  </>
                ) : null}
              </div>

              <p className="text-center text-xs text-muted-foreground">
                Hoje você não paga nada. A nova {result.cycle === 'annual' ? 'anuidade' : 'mensalidade'} de {formatCurrency(result.value)}{' '}
                começa {result.effectiveFrom ? `na cobrança de ${formatDate(result.effectiveFrom)}` : 'na próxima cobrança'}.
              </p>

              <DialogFooter className="sm:justify-center">
                <Button type="button" size="lg" className="text-white hover:opacity-90" style={{ background: GREEN }} onClick={() => window.location.reload()}>
                  Começar a usar
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
