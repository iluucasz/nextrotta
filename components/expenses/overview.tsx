'use client';

import { useMemo } from 'react';
import { ArrowRight, CalendarCheck, Wallet } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { ChartEmpty, chartAxis, chartTooltipStyle, compactCurrency, Delta, Legend, Panel } from '@/components/management-ui';
import {
  agingOfOverdue,
  budgetProgress,
  cashForecast,
  cents,
  dueLabel,
  groupByUrgency,
  openWithin,
  paidInMonth,
  remainingOf,
  shiftMonth,
  spendingByCategory,
  type ExpenseEntry,
} from '@/lib/expenses';
import { formatCurrency } from '@/lib/formatters';
import { CHART_COLORS as COLORS } from '@/lib/chart-theme';
import { cn } from '@/lib/utils';
import { monthLabel, monthName, payVerb, shortDate } from './ui';
import type { Budget } from './use-expenses';

const LIMIT = 6;

/** "A pagar R$ 100,00 · A receber R$ 50,00": what is owed and what is coming in are never added together. */
function groupTotals(entries: ExpenseEntry[]) {
  const sum = (type: 'payable' | 'receivable') => cents(entries.filter((entry) => entry.type === type).reduce((total, entry) => total + remainingOf(entry), 0));
  const payable = sum('payable');
  const receivable = sum('receivable');
  return [payable ? `A pagar ${formatCurrency(payable)}` : '', receivable ? `A receber ${formatCurrency(receivable)}` : ''].filter(Boolean).join(' · ');
}

function BillRow({ entry, today, onOpen, onPay }: { entry: ExpenseEntry; today: string; onOpen: (entry: ExpenseEntry) => void; onPay: (entry: ExpenseEntry) => void }) {
  const late = entry.due_date < today;
  return (
    <div className="ex-row">
      <button type="button" className="ex-row-main" onClick={() => onOpen(entry)}>
        <strong>{entry.description}</strong>
        <small className={late ? 'late' : ''}>
          {dueLabel(entry.due_date, today)} · {shortDate(entry.due_date)}
          {entry.supplier ? ` · ${entry.supplier}` : ` · ${entry.category}`}
        </small>
      </button>
      <span className={cn('ex-amount', entry.type === 'receivable' && 'receivable')}>
        {entry.type === 'receivable' ? '+ ' : ''}
        {formatCurrency(remainingOf(entry))}
        {entry.paid_amount > 0 ? <small>de {formatCurrency(entry.amount)}</small> : null}
      </span>
      <Button type="button" size="sm" onClick={() => onPay(entry)}>
        {payVerb(entry.type)}
      </Button>
    </div>
  );
}

/**
 * The first screen: what needs doing today (late, due today, this week), the next eight weeks as cash coming and
 * going, where the month's money went and how the budget is holding. Built from the same list as the other tabs.
 */
export function Overview({
  entries,
  budgets,
  today,
  month,
  onOpen,
  onPay,
  onPayAll,
  onGo,
}: {
  entries: ExpenseEntry[];
  budgets: Budget[];
  today: string;
  month: string;
  onOpen: (entry: ExpenseEntry) => void;
  onPay: (entry: ExpenseEntry) => void;
  onPayAll: (entries: ExpenseEntry[]) => void;
  onGo: (tab: 'contas' | 'calendario' | 'orcamento', filter?: 'overdue') => void;
}) {
  const previousMonth = shiftMonth(month, -1);

  const data = useMemo(() => {
    const payables = entries.filter((entry) => entry.type === 'payable');
    const urgency = groupByUrgency(entries, today, 30);
    const aging = agingOfOverdue(entries, today);
    const overdueTotal = cents(aging.reduce((total, bucket) => total + bucket.total, 0));
    const overdueCount = aging.reduce((total, bucket) => total + bucket.count, 0);
    const week = [...urgency.today, ...urgency.week].filter((entry) => entry.type === 'payable');
    const weekTotal = cents(week.reduce((total, entry) => total + remainingOf(entry), 0));
    const payable30 = openWithin(entries, 'payable', today, 30);
    const receivable30 = openWithin(entries, 'receivable', today, 30);
    const forecast = cashForecast(entries, today, 8);
    const spending = spendingByCategory(entries, month);
    const spendingBefore = spendingByCategory(entries, previousMonth);
    const spentTotal = cents(spending.reduce((total, row) => total + row.total, 0));
    const spentBefore = cents(spendingBefore.reduce((total, row) => total + row.total, 0));
    const fixed = cents(spending.reduce((total, row) => total + row.fixed, 0));
    return {
      payables,
      urgency,
      aging,
      overdueTotal,
      overdueCount,
      weekTotal,
      weekCount: week.length,
      balance30: cents(receivable30.total - payable30.total),
      payable30,
      receivable30,
      forecast,
      spending,
      spentTotal,
      spentBefore,
      fixed,
      paidNow: paidInMonth(entries, 'payable', month),
      paidBefore: paidInMonth(entries, 'payable', previousMonth),
      budgetRows: budgetProgress(budgets, spending).filter((row) => row.budget > 0),
    };
  }, [budgets, entries, month, previousMonth, today]);

  const chart = data.forecast.weeks.map((week) => ({
    label: shortDate(week.start),
    pagar: -week.payable,
    receber: week.receivable,
    saldo: week.balance,
  }));
  const hasForecast = chart.some((week) => week.pagar || week.receber) || data.forecast.overdue.payable || data.forecast.overdue.receivable;
  const nothingOpen = !data.urgency.overdue.length && !data.urgency.today.length && !data.urgency.week.length && !data.urgency.later.length;

  const groups: Array<{ key: string; title: string; entries: ExpenseEntry[]; tone?: 'danger' }> = [
    { key: 'overdue', title: 'Atrasadas', entries: data.urgency.overdue, tone: 'danger' },
    { key: 'today', title: 'Vencem hoje', entries: data.urgency.today },
    { key: 'week', title: 'Nos próximos 7 dias', entries: data.urgency.week },
    { key: 'later', title: 'Até 30 dias', entries: data.urgency.later },
  ];
  let remainingSlots = LIMIT;

  return (
    <>
      <section className="mg-section">
        <div className="mg-section-heading">
          <div>
            <span className="mg-section-number">01</span>
            <h2>O que precisa da sua atenção</h2>
          </div>
          <span className="mg-comparison">Hoje, {today.split('-').reverse().join('/')}</span>
        </div>

        <div className="ex-stats">
          <article className={cn('ex-stat', data.overdueCount > 0 && 'danger')}>
            <span>Vencidas</span>
            <strong>{formatCurrency(data.overdueTotal)}</strong>
            <small>{data.overdueCount ? `${data.overdueCount} conta(s) atrasada(s)` : 'Nenhuma conta atrasada'}</small>
          </article>
          <article className="ex-stat">
            <span>Vencem em 7 dias</span>
            <strong>{formatCurrency(data.weekTotal)}</strong>
            <small>{data.weekCount ? `${data.weekCount} conta(s) a pagar` : 'Nada a pagar nessa semana'}</small>
          </article>
          <article className="ex-stat">
            <span>Pago em {monthName(month)}</span>
            <strong>{formatCurrency(data.paidNow)}</strong>
            <small>
              <Delta current={data.paidNow} previous={data.paidBefore} reverse />
              <span>vs. {monthName(previousMonth)}</span>
            </small>
          </article>
          <article className={cn('ex-stat', data.balance30 < 0 ? 'bad' : data.balance30 > 0 ? 'good' : '')}>
            <span>Saldo previsto em 30 dias</span>
            <strong>{formatCurrency(data.balance30)}</strong>
            <small>
              A receber {formatCurrency(data.receivable30.total)} − a pagar {formatCurrency(data.payable30.total)}
            </small>
          </article>
        </div>

        {data.overdueCount > 0 ? (
          <div className="ex-aging" aria-label="Contas atrasadas por tempo de atraso">
            {data.aging.map((bucket) => (
              <div key={bucket.key} className={bucket.count ? '' : 'empty'}>
                {bucket.label}
                <strong>{formatCurrency(bucket.total)}</strong>
                {bucket.count ? `${bucket.count} conta(s)` : '—'}
              </div>
            ))}
          </div>
        ) : null}

        <div className="mg-grid-finance" style={{ marginTop: 20 }}>
          <Panel
            title="Para resolver agora"
            description="Em ordem de vencimento. Pague daqui mesmo."
            badge={
              data.urgency.overdue.length + data.urgency.today.length > 1 ? (
                <Button type="button" size="sm" variant="outline" onClick={() => onPayAll([...data.urgency.overdue, ...data.urgency.today].filter((entry) => entry.type === 'payable'))}>
                  Baixar atrasadas e de hoje
                </Button>
              ) : undefined
            }
          >
            {nothingOpen ? (
              <div className="mg-chart-empty">
                <CalendarCheck size={26} />
                <p>Tudo em dia</p>
                <span>Nenhuma conta atrasada ou vencendo nos próximos 30 dias.</span>
              </div>
            ) : (
              <div>
                {groups.map((group) => {
                  if (!group.entries.length || remainingSlots <= 0) return null;
                  const shown = group.entries.slice(0, remainingSlots);
                  remainingSlots -= shown.length;
                  return (
                    <div key={group.key}>
                      <div className={cn('ex-group-title', group.tone)}>
                        <span>{group.title}</span>
                        <span>{groupTotals(group.entries)}</span>
                      </div>
                      {shown.map((entry) => (
                        <BillRow key={entry.id} entry={entry} today={today} onOpen={onOpen} onPay={onPay} />
                      ))}
                    </div>
                  );
                })}
                {data.urgency.overdue.length + data.urgency.today.length + data.urgency.week.length + data.urgency.later.length > LIMIT ? (
                  <button type="button" className="ex-more" onClick={() => onGo('contas')}>
                    Ver todas as contas em aberto <ArrowRight size={14} style={{ display: 'inline', verticalAlign: '-2px' }} />
                  </button>
                ) : null}
              </div>
            )}
          </Panel>

          <Panel title="Próximas 8 semanas" description="O que sai e o que entra, e o saldo se tudo for pago e recebido.">
            <Legend
              items={[
                { color: COLORS[2], label: 'A pagar' },
                { color: '#2f9e6e', label: 'A receber' },
                { color: COLORS[0], label: 'Saldo acumulado' },
              ]}
            />
            {hasForecast ? (
              <div className="mg-chart" role="img" aria-label="Contas a pagar e a receber nas próximas oito semanas e o saldo acumulado.">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart} margin={{ top: 12, right: 8, left: 0, bottom: 5 }} stackOffset="sign" accessibilityLayer>
                    <CartesianGrid stroke="#eeedf4" strokeDasharray="4 5" vertical={false} />
                    <XAxis dataKey="label" {...chartAxis} dy={8} />
                    <YAxis {...chartAxis} tickFormatter={compactCurrency} width={70} />
                    <Tooltip contentStyle={chartTooltipStyle} formatter={(value) => formatCurrency(Math.abs(Number(value)))} labelFormatter={(label) => `Semana de ${label}`} />
                    <ReferenceLine y={0} stroke="#cedbd2" />
                    <Bar dataKey="pagar" name="A pagar" fill={COLORS[2]} radius={[0, 0, 4, 4]} maxBarSize={26} stackId="week" isAnimationActive={false} />
                    <Bar dataKey="receber" name="A receber" fill="#2f9e6e" radius={[4, 4, 0, 0]} maxBarSize={26} stackId="week" isAnimationActive={false} />
                    <Line type="monotone" dataKey="saldo" name="Saldo acumulado" stroke={COLORS[0]} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <ChartEmpty message="Nada a pagar nem a receber nas próximas semanas." />
            )}
            {data.forecast.overdue.payable > 0 ? (
              <p className="mg-card-footnote">O saldo já desconta {formatCurrency(data.forecast.overdue.payable)} de contas atrasadas, que são devidas hoje.</p>
            ) : null}
          </Panel>
        </div>
      </section>

      <section className="mg-section">
        <div className="mg-section-heading">
          <div>
            <span className="mg-section-number">02</span>
            <h2>Para onde vai o dinheiro</h2>
          </div>
          <span className="mg-comparison">{monthLabel(month)}</span>
        </div>

        <div className="ex-stats three">
          <article className="ex-stat">
            <span>Despesas do mês</span>
            <strong>{formatCurrency(data.spentTotal)}</strong>
            <small>
              <Delta current={data.spentTotal} previous={data.spentBefore} reverse />
              <span>vs. {monthName(previousMonth)} ({formatCurrency(data.spentBefore)})</span>
            </small>
          </article>
          <article className="ex-stat">
            <span>Custos fixos</span>
            <strong>{formatCurrency(data.fixed)}</strong>
            <small>{data.spentTotal > 0 ? `${Math.round((data.fixed / data.spentTotal) * 100)}% do que foi lançado` : 'Nada lançado no mês'}</small>
          </article>
          <article className="ex-stat">
            <span>Custos variáveis</span>
            <strong>{formatCurrency(cents(data.spentTotal - data.fixed))}</strong>
            <small>O que muda com a operação</small>
          </article>
        </div>

        <div className="mg-grid-two" style={{ marginTop: 20 }}>
          <Panel title="Por categoria" description="Lançado na competência do mês, com o que é fixo e o que é variável.">
            {data.spending.length ? (
              <div className="ex-bars">
                {data.spending.slice(0, 8).map((row) => (
                  <div key={row.category}>
                    <header>
                      <span>{row.category}</span>
                      <span>
                        <strong>{formatCurrency(row.total)}</strong> <small>{Math.round((row.total / data.spentTotal) * 100)}%</small>
                      </span>
                    </header>
                    <div className="ex-track split" title={`Fixo ${formatCurrency(row.fixed)} · Variável ${formatCurrency(row.variable)}`}>
                      <i className="fixed" style={{ width: `${(row.fixed / data.spentTotal) * 100}%` }} />
                      <i className="variable" style={{ width: `${(row.variable / data.spentTotal) * 100}%` }} />
                    </div>
                  </div>
                ))}
                <Legend
                  items={[
                    { color: '#6d5ef7', label: 'Fixo' },
                    { color: '#bdb6fb', label: 'Variável' },
                  ]}
                />
              </div>
            ) : (
              <ChartEmpty message="Nenhuma despesa lançada neste mês." />
            )}
          </Panel>

          <Panel
            title="Orçamento do mês"
            description="O limite que você definiu para cada categoria."
            badge={
              <Button type="button" size="sm" variant="outline" onClick={() => onGo('orcamento')}>
                {data.budgetRows.length ? 'Ajustar' : 'Definir limites'}
              </Button>
            }
          >
            {data.budgetRows.length ? (
              <div className="ex-bars">
                {data.budgetRows.slice(0, 6).map((row) => (
                  <div key={row.category}>
                    <header>
                      <span>{row.category}</span>
                      <small>
                        {formatCurrency(row.spent)} de {formatCurrency(row.budget)}
                      </small>
                    </header>
                    <div className={cn('ex-track', row.status)}>
                      <i style={{ width: `${Math.min(100, row.share * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mg-chart-empty">
                <Wallet size={26} />
                <p>Sem limites definidos</p>
                <span>Defina quanto pode gastar por categoria e avisamos quando passar.</span>
              </div>
            )}
          </Panel>
        </div>
      </section>
    </>
  );
}
