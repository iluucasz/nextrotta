'use client';

import { useState } from 'react';
import { AlertTriangle, Boxes, CircleDollarSign, Clock, Package, Truck, Wallet } from 'lucide-react';
import { MetricCard } from '@/components/metric-card';
import { DataPanel } from '@/components/data-panel';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/formatters';
import type { AccountSummaryRow } from '@/lib/parts/account';
import { formatMonthLabel } from '@/lib/parts/types';
import { Alert, currentMonthKey, inputClassName, Spinner, useParts, inputClass } from '../shared';

interface Overview {
  month: string;
  centralUnits: number;
  centralCost: number;
  technicianUnits: number;
  technicianCost: number;
  technicianValue: number;
  salesCount: number;
  salesTotal: number;
  salesOwed: number;
  salesCost: number;
  salesMargin: number;
  balanceDue: number;
  paidInMonth: number;
  lowStockParts: number;
  awaitingPayment: number;
}

export function OverviewTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [month, setMonth] = useState(currentMonthKey());
  const { data, error } = useParts<{ overview: Overview }>(`/api/parts/overview?month=${month}`);
  const accounts = useParts<{ summary: AccountSummaryRow[] }>(`/api/parts/account?month=${month}`);
  const overview = data?.overview;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Resumo de {formatMonthLabel(month)}</p>
        <input type="month" className={inputClass('w-auto')} value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} aria-label="Mês" />
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {!overview ? (
        <Spinner />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            <MetricCard title="Vendido pelos técnicos" value={formatCurrency(overview.salesTotal)} hint={`${overview.salesCount} venda(s) no mês`} icon={CircleDollarSign} />
            <MetricCard
              title="A receber dos técnicos (mês)"
              value={formatCurrency(overview.salesOwed)}
              hint={`Sua margem sobre o custo: ${formatCurrency(overview.salesMargin)}`}
              icon={Wallet}
              tone="success"
            />
            <MetricCard
              title="Saldo em aberto"
              value={formatCurrency(overview.balanceDue)}
              hint={`Pago no mês: ${formatCurrency(overview.paidInMonth)}`}
              icon={Clock}
              tone={overview.balanceDue > 0 ? 'warning' : 'default'}
            />
            <MetricCard
              title="Com os técnicos"
              value={`${overview.technicianUnits} un.`}
              hint={`${formatCurrency(overview.technicianValue)} a preço de técnico · custo ${formatCurrency(overview.technicianCost)}`}
              icon={Truck}
            />
            <MetricCard title="Estoque central" value={`${overview.centralUnits} un.`} hint={`Custo ${formatCurrency(overview.centralCost)}`} icon={Boxes} />
            <MetricCard
              title="Peças para repor"
              value={overview.lowStockParts}
              hint="No estoque mínimo ou abaixo"
              icon={Package}
              tone={overview.lowStockParts ? 'warning' : 'default'}
            />
            <MetricCard
              title="Aguardando pagamento"
              value={overview.awaitingPayment}
              hint="Vendas sem pagamento confirmado"
              icon={AlertTriangle}
              tone={overview.awaitingPayment ? 'warning' : 'default'}
            />
          </div>

          <DataPanel
            title="Técnicos"
            description="Peças no carro e saldo a acertar de cada um."
            action={
              <Button variant="outline" size="sm" onClick={() => onNavigate('account')}>
                Ir para o acerto
              </Button>
            }
          >
            {!accounts.data ? (
              <Spinner />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2 pr-3 font-medium">Técnico</th>
                      <th className="py-2 pr-3 text-right font-medium">No carro</th>
                      <th className="py-2 pr-3 text-right font-medium">Vendas no mês</th>
                      <th className="py-2 pr-3 text-right font-medium">Pago no mês</th>
                      <th className="py-2 text-right font-medium">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.data.summary.map((row) => (
                      <tr key={row.technicianId} className="border-b last:border-0">
                        <td className="py-2 pr-3">{row.technicianName}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {row.stockUnits} un. · {formatCurrency(row.stockValue)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(row.salesInMonth)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(row.paidInMonth)}</td>
                        <td className={`py-2 text-right font-medium tabular-nums ${row.balanceDue > 0 ? 'text-amber-700' : ''}`}>{formatCurrency(row.balanceDue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DataPanel>
        </>
      )}
    </div>
  );
}
