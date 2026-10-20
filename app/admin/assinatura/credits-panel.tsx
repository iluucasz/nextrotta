'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink, Sparkles } from 'lucide-react';
import { DataPanel } from '@/components/data-panel';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatDate } from '@/lib/formatters';

type Credits = {
  balance: number;
  monthlyCredits: number;
  planIncludesAi: boolean | null;
  entries: Array<{ id: string; kind: string; kindLabel: string; quantity: number; description: string | null; createdAt: string }>;
  packages: Array<{ id: string; name: string; credits: number; price: number }>;
};

/** AI credits: balance, statement and packages the admin can buy (paid through the gateway). */
export function AiCreditsPanel() {
  const [credits, setCredits] = useState<Credits | null>(null);
  const [error, setError] = useState('');
  const [buying, setBuying] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/organization/credits', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || 'Não foi possível carregar os créditos.');
        setCredits(data);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os créditos.'));
  }, []);
  useEffect(load, [load]);

  async function buy(packageId: string) {
    setBuying(packageId);
    setError('');
    setInvoice(null);
    try {
      const response = await fetch('/api/organization/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível gerar a cobrança.');
      setInvoice(data.invoiceUrl ?? null);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível gerar a cobrança.');
    } finally {
      setBuying(null);
    }
  }

  if (!credits) {
    return error ? <p className="text-sm text-rose-700">{error}</p> : null;
  }

  return (
    <DataPanel
      title="Créditos de IA"
      description={
        credits.planIncludesAi
          ? `O plano inclui ${credits.monthlyCredits.toLocaleString('pt-BR')} créditos por mês (a cota renova todo mês e não acumula). Créditos comprados não expiram.`
          : 'O assistente de IA faz parte do plano Pro. Créditos comprados ficam disponíveis quando a IA estiver no seu plano.'
      }
    >
      <div className="flex items-center gap-3">
        <Sparkles className="h-5 w-5 text-primary" />
        <p className="text-2xl font-semibold">{credits.balance.toLocaleString('pt-BR')}</p>
        <p className="text-sm text-muted-foreground">créditos disponíveis</p>
      </div>

      {credits.packages.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {credits.packages.map((item) => (
            <div key={item.id} className="rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">{item.name}</p>
              <p className="text-xs text-muted-foreground">
                {item.credits.toLocaleString('pt-BR')} créditos · {formatCurrency(item.price)}
              </p>
              <Button type="button" size="sm" variant="outline" className="mt-3 w-full" disabled={buying !== null} onClick={() => void buy(item.id)}>
                {buying === item.id ? 'Gerando cobrança…' : 'Comprar'}
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {invoice ? (
        <p className="mt-3 text-sm">
          Cobrança gerada. Os créditos entram assim que o pagamento for confirmado.{' '}
          <a href={invoice} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            Pagar agora <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}

      {credits.entries.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Data</th>
                <th className="py-2 pr-3 font-medium">Movimento</th>
                <th className="py-2 pr-3 font-medium">Créditos</th>
              </tr>
            </thead>
            <tbody>
              {credits.entries.slice(0, 20).map((entry) => (
                <tr key={entry.id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3">{formatDate(entry.createdAt)}</td>
                  <td className="py-2 pr-3">{entry.description ?? entry.kindLabel}</td>
                  <td className={`py-2 pr-3 font-medium ${entry.quantity > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {entry.quantity > 0 ? '+' : ''}
                    {entry.quantity.toLocaleString('pt-BR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </DataPanel>
  );
}

/** Everything the organization has, as a JSON file — available even while suspended. */
export function ExportPanel() {
  return (
    <DataPanel
      title="Seus dados"
      description="Baixe todos os registros da empresa (técnicos, OS, horas, escala, folhas, financeiro, documentos e histórico) num arquivo. Disponível a qualquer momento, inclusive com o acesso pausado."
      action={
        <Button asChild variant="outline" size="sm">
          <a href="/api/organization/export">
            <Download className="h-4 w-4" />
            Exportar dados
          </a>
        </Button>
      }
    >
      <p className="text-xs text-muted-foreground">Senhas e credenciais de integrações não entram no arquivo.</p>
    </DataPanel>
  );
}
