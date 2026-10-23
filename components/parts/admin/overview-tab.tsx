'use client';

import { useState } from 'react';
import { AlertTriangle, Boxes, ChevronRight, CircleDollarSign, Clock, Package, Truck, Wallet } from 'lucide-react';
import { MetricCard } from '@/components/metric-card';
import { DataPanel } from '@/components/data-panel';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/formatters';
import type { AccountSummaryRow } from '@/lib/parts/account';
import { formatMonthLabel } from '@/lib/parts/types';
import { Alert, currentMonthKey, Spinner, useParts, inputClass } from '../shared';

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;
}

function AttentionLink({ onClick, icon: Icon, children }: { onClick: () => void; icon: typeof AlertTriangle; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm font-medium text-amber-950 transition hover:bg-amber-100"
    >
      <span className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-amber-700" />
        {children}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-amber-700" />
    </button>
  );
}

/** Zero is noise in a table of mostly idle technicians. */
function amountOrDash(value: number) {
  return value ? formatCurrency(value) : <span className="text-muted-foreground">—</span>;
}

export function OverviewTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [month, setMonth] = useState(currentMonthKey());
  const [showAll, setShowAll] = useState(false);
  const { data, error } = useParts<{ overview: Overview }>(`/api/parts/overview?month=${month}`);
  const accounts = useParts<{ summary: AccountSummaryRow[] }>(`/api/parts/account?month=${month}`);
  const overview = data?.overview;

  const rows = [...(accounts.data?.summary ?? [])].sort((a, b) => b.balanceDue - a.balanceDue);
  const withMovement = rows.filter((row) => row.stockUnits > 0 || row.salesInMonth !== 0 || row.paidInMonth !== 0 || row.balanceDue !== 0);
  const shown = showAll ? rows : withMovement;
  const hidden = rows.length - withMovement.length;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">{formatMonthLabel(month)}</p>
        <input type="month" className={inputClass('w-auto')} value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} aria-label="Mês" />
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {!overview ? (
        <Spinner />
      ) : (
        <>
          {overview.awaitingPayment > 0 || overview.lowStockParts > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {overview.awaitingPayment > 0 ? (
                <AttentionLink icon={AlertTriangle} onClick={() => onNavigate('sales')}>
                  {overview.awaitingPayment} venda(s) aguardando pagamento
                </AttentionLink>
              ) : null}
              {overview.lowStockParts > 0 ? (
                <AttentionLink icon={Package} onClick={() => onNavigate('catalog')}>
                  {overview.lowStockParts} peça(s) para repor
                </AttentionLink>
              ) : null}
            </div>
          ) : null}

          <section className="grid gap-3">
            <SectionLabel>Financeiro</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard title="Vendido pelos técnicos" value={formatCurrency(overview.salesTotal)} hint={`${overview.salesCount} venda(s)`} icon={CircleDollarSign} />
              <MetricCard
                title="A receber dos técnicos"
                value={formatCurrency(overview.salesOwed)}
                hint={`Margem sobre o custo: ${formatCurrency(overview.salesMargin)}`}
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
            </div>
          </section>

          <section className="grid gap-3">
            <SectionLabel>Estoque</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard title="Com os técnicos" value={`${overview.technicianUnits} un.`} hint={`${formatCurrency(overview.technicianValue)} a preço de técnico`} icon={Truck} />
              <MetricCard title="Estoque central" value={`${overview.centralUnits} un.`} hint={`Custo ${formatCurrency(overview.centralCost)}`} icon={Boxes} />
            </div>
          </section>

          <section className="grid gap-3">
            <DataPanel
              title="Saldo por técnico"
              action={
                <Button variant="outline" size="lg" onClick={() => onNavigate('account')}>
                  Ver acerto
                </Button>
              }
            >
              {!accounts.data ? (
                <Spinner />
              ) : !shown.length ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Nenhum técnico com peças ou movimento neste mês.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-130 text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr className="border-b">
                        <th className="py-2 pr-3 font-medium">Técnico</th>
                        <th className="py-2 pr-3 text-right font-medium">No carro</th>
                        <th className="py-2 pr-3 text-right font-medium">Vendas</th>
                        <th className="py-2 pr-3 text-right font-medium">Pago</th>
                        <th className="py-2 text-right font-medium">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((row) => (
                        <tr key={row.technicianId} className="border-b last:border-0">
                          <td className="py-2.5 pr-3 font-medium">{row.technicianName}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">
                            {row.stockUnits ? (
                              <>
                                {row.stockUnits} un. <span className="text-muted-foreground">· {formatCurrency(row.stockValue)}</span>
                              </>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">{amountOrDash(row.salesInMonth)}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">{amountOrDash(row.paidInMonth)}</td>
                          <td className={`py-2.5 text-right font-semibold tabular-nums ${row.balanceDue > 0 ? 'text-amber-700' : ''}`}>{amountOrDash(row.balanceDue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {hidden > 0 || showAll ? (
                <button type="button" className="mt-3 text-xs font-medium text-primary hover:underline" onClick={() => setShowAll((value) => !value)}>
                  {showAll ? 'Mostrar só quem tem movimento' : `Mostrar também ${hidden} técnico(s) sem movimento`}
                </button>
              ) : null}
            </DataPanel>
          </section>
        </>
      )}
    </div>
  );
}
