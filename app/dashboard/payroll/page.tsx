'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock3, CreditCard, WalletCards } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { EmptyState } from '@/components/empty-state';
import { LoadingShell } from '@/components/page-skeleton';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { formatCurrency, formatHours, monthKeyFromDate, normalizeCompetenceMonth, resolveCompetenceMonth } from '@/lib/formatters';
import type { Payroll, Service, WorkHours } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';
import { useTechnicianVisibility } from '@/hooks/use-technician-visibility';
import { resolveAllowedMonth } from '@/lib/technician-visibility';

function formatCompetence(value: string | null | undefined) {
  const normalized = normalizeCompetenceMonth(value);
  if (!normalized) return 'Sem competência';

  const [year, month] = normalized.split('-');
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));

  return date.toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function moneyValue(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function getBenefitsTotal(payroll: Payroll | null | undefined) {
  return moneyValue(payroll?.va_deduction) + moneyValue(payroll?.vr_deduction);
}

function getPayrollTotal(payroll: Payroll | null | undefined) {
  return moneyValue(payroll?.net_total) + getBenefitsTotal(payroll);
}

export default function TechnicianPayrollPage() {
  const { user, loading } = useAppSession();
  const { visibility, loading: visibilityLoading, blocked } = useTechnicianVisibility({ page: 'payroll' });
  const allowedMonth = resolveAllowedMonth(visibility.payroll.month);
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [workHours, setWorkHours] = useState<WorkHours[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');

  useEffect(() => {
    async function loadPayroll() {
      if (!user) return;

      setIsDataLoading(true);
      setDataError('');

      const technicianId = user.technicianId ?? user.userId;
      try {
        const [payrollResponse, servicesResponse, workHoursResponse] = await Promise.allSettled([
          fetch(`/api/payroll?technicianId=${technicianId}`),
          fetch(`/api/services?technicianId=${technicianId}`),
          fetch(`/api/work-hours?technicianId=${technicianId}`),
        ]);

        const errors: string[] = [];

        if (payrollResponse.status === 'fulfilled' && payrollResponse.value.ok) {
          const payrollData = await payrollResponse.value.json();
          setPayroll(Array.isArray(payrollData.payrolls) ? payrollData.payrolls : []);
        } else {
          setPayroll([]);
          errors.push('folha');
        }

        if (servicesResponse.status === 'fulfilled' && servicesResponse.value.ok) {
          const servicesData = await servicesResponse.value.json();
          setServices(Array.isArray(servicesData.services) ? servicesData.services : []);
        } else {
          setServices([]);
          errors.push('OS');
        }

        if (workHoursResponse.status === 'fulfilled' && workHoursResponse.value.ok) {
          const workHoursData = await workHoursResponse.value.json();
          setWorkHours(Array.isArray(workHoursData.workHours) ? workHoursData.workHours : []);
        } else {
          setWorkHours([]);
          errors.push('banco de horas');
        }

        setDataError(errors.length ? `Não foi possível carregar dados reais de ${errors.join(' e ')}.` : '');
      } catch {
        setPayroll([]);
        setServices([]);
        setWorkHours([]);
        setDataError('Não foi possível carregar os fechamentos reais desta tela.');
      } finally {
        setIsDataLoading(false);
      }
    }

    loadPayroll();
  }, [user]);

  // A pinned month narrows both the current closing and the history to that single competence.
  const visiblePayroll = useMemo(
    () =>
      payroll
        .filter((item) => !allowedMonth || normalizeCompetenceMonth(item.competence_month) === allowedMonth)
        .sort((left, right) => String(right.competence_month ?? '').localeCompare(String(left.competence_month ?? ''))),
    [allowedMonth, payroll],
  );
  const currentPayroll = visiblePayroll[0];
  const currentCompetenceMonth = normalizeCompetenceMonth(currentPayroll?.competence_month);
  const hourBankBalance = moneyValue(currentPayroll?.hour_bank_balance);
  const hourBankHint = hourBankBalance < 0 ? 'Colaborador devendo horas' : hourBankBalance > 0 ? 'Empresa devendo horas' : 'Saldo zerado';
  const baseSalary = moneyValue(currentPayroll?.base_salary);
  const vaTotal = moneyValue(currentPayroll?.va_deduction);
  const vrTotal = moneyValue(currentPayroll?.vr_deduction);
  const benefitsTotal = getBenefitsTotal(currentPayroll);
  const cashNetTotal = moneyValue(currentPayroll?.net_total);
  const payrollTotal = getPayrollTotal(currentPayroll);

  if (loading || isDataLoading || visibilityLoading || blocked || !user) {
    return <LoadingShell role="technician" />;
  }

  const earningsItems = [
    { label: 'Salário base', value: currentPayroll?.base_salary ?? 0 },
    { label: 'Comissão / DSR', value: currentPayroll?.commission_value ?? 0 },
    { label: 'Horas extras', value: currentPayroll?.extra_hours_value ?? 0 },
    { label: 'Premiação extraordinária', value: currentPayroll?.extraordinary_award_value ?? 0 },
  ];
  const deductionItems = [
    { label: 'Descontos de folha', value: currentPayroll?.discounts_total ?? 0 },
    { label: 'Adiantamentos', value: currentPayroll?.advances_total ?? 0 },
  ];
  const summaryCardClass = 'rounded-md border border-border bg-background p-3 shadow-sm';
  const detailRowClass = 'grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 border-b border-border pb-3 last:border-0 last:pb-0';
  const detailValueClass = 'text-right text-sm font-semibold tabular-nums text-foreground whitespace-nowrap';
  const historyHeaderClass = 'py-3 pr-4 text-right font-medium';
  const historyValueClass = 'py-3 pr-4 text-right font-medium tabular-nums whitespace-nowrap';
  const competenceLabel = formatCompetence(currentPayroll?.competence_month);
  const workedHoursTotal = workHours
    .filter((item) => monthKeyFromDate(item.date) === currentCompetenceMonth)
    .reduce((total, item) => total + moneyValue(item.hours_worked), 0);
  const servicesCount = services.filter(
    (service) => resolveCompetenceMonth(service.competence_month, service.date_performed) === currentCompetenceMonth,
  ).length;

  return (
    <AppShell role="technician" userName={user.name || user.email}>
      <PageHeader eyebrow="Financeiro" title="Meu pagamento" description="Detalhamento do fechamento de folha por competência." />

      {dataError ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{dataError}</div> : null}

      {!currentPayroll ? (
        <EmptyState
          icon={WalletCards}
          title="Nenhuma folha fechada"
          description="Ainda não existe fechamento de folha salvo para este colaborador. Quando a competência for fechada no admin, os valores reais aparecem aqui."
        />
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Horas realizadas" value={formatHours(workedHoursTotal)} hint={`Banco de horas: ${formatHours(hourBankBalance)}`} icon={Clock3} tone={hourBankBalance < 0 ? 'danger' : 'warning'} />
            <MetricCard title="OS realizadas" value={servicesCount} hint="Quantidade de OS na competência" icon={WalletCards} />
            <MetricCard title="Salário base" value={formatCurrency(baseSalary)} hint={competenceLabel} icon={WalletCards} />
            <MetricCard title="Vale alimentação" value={formatCurrency(vaTotal)} hint="Pago no cartão" icon={CreditCard} />
            <MetricCard title="Vale refeição" value={formatCurrency(vrTotal)} hint="Pago no cartão" icon={CreditCard} />
            <MetricCard title="Total VA/VR" value={formatCurrency(benefitsTotal)} hint="Soma dos benefícios" icon={CreditCard} />
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] xl:items-start">
            <DataPanel title="Composição da folha" description="Valores reais fechados no admin para esta competência.">
              <div className="space-y-5">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className={summaryCardClass}>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Em conta</div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{formatCurrency(cashNetTotal)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">Valor pago em conta nesta competência</div>
                  </div>
                  <div className={summaryCardClass}>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">VA/VR no cartão</div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{formatCurrency(benefitsTotal)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">Benefícios pagos fora da conta</div>
                  </div>
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 shadow-sm">
                    <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">Total da folha</div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-900">{formatCurrency(payrollTotal)}</div>
                    <div className="mt-1 text-xs text-emerald-700/90">Em conta + benefícios</div>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.78fr)]">
                  <section className="rounded-md border border-border bg-background p-4">
                    <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Entradas em conta</div>
                    <div className="space-y-3">
                      {earningsItems.map((item) => (
                        <div key={item.label} className={detailRowClass}>
                          <span className="text-sm text-muted-foreground">{item.label}</span>
                          <span className={detailValueClass}>{formatCurrency(item.value)}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-md border border-border bg-background p-4">
                    <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Saídas e fechamento</div>
                    <div className="space-y-3">
                      {deductionItems.map((item) => (
                        <div key={item.label} className={detailRowClass}>
                          <span className="text-sm text-muted-foreground">{item.label}</span>
                          <span className="text-right text-sm font-semibold tabular-nums text-rose-600 whitespace-nowrap">-{formatCurrency(item.value)}</span>
                        </div>
                      ))}
                      <div className={detailRowClass}>
                        <span className="text-sm text-muted-foreground">Em conta</span>
                        <span className={detailValueClass}>{formatCurrency(cashNetTotal)}</span>
                      </div>
                      <div className={detailRowClass}>
                        <span className="text-sm text-muted-foreground">VA/VR no cartão</span>
                        <span className={detailValueClass}>{formatCurrency(benefitsTotal)}</span>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
                        <span className="font-semibold">Total da folha</span>
                        <span className="text-right text-lg font-semibold tabular-nums whitespace-nowrap">{formatCurrency(payrollTotal)}</span>
                      </div>
                    </div>
                    <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                      VA e VR aparecem separados no topo e entram no total da folha, mas são pagos no cartão e não reduzem o valor em conta.
                    </p>
                  </section>
                </div>
              </div>
            </DataPanel>

            <DataPanel title="Histórico de competências" description="Fechamentos reais disponíveis ao técnico.">
              <div className="overflow-x-auto">
                <table className="w-full min-w-215 text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                      <th className="py-3 pr-4 text-left font-medium">Competência</th>
                      <th className={historyHeaderClass}>Base</th>
                      <th className={historyHeaderClass}>Comissão / DSR</th>
                      <th className={historyHeaderClass}>Horas extras</th>
                      <th className={historyHeaderClass}>Premiação</th>
                      <th className={historyHeaderClass}>Descontos</th>
                      <th className={historyHeaderClass}>Cartões</th>
                      <th className={historyHeaderClass}>Em conta</th>
                      <th className="py-3 text-right font-medium">Folha total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePayroll.map((item) => (
                      <tr key={item.id} className="border-b border-border last:border-0">
                        <td className="py-3 pr-4 whitespace-nowrap">{formatCompetence(item.competence_month)}</td>
                        <td className={historyValueClass}>{formatCurrency(item.base_salary)}</td>
                        <td className={historyValueClass}>{formatCurrency(item.commission_value)}</td>
                        <td className={historyValueClass}>{formatCurrency(item.extra_hours_value)}</td>
                        <td className={historyValueClass}>{formatCurrency(item.extraordinary_award_value ?? 0)}</td>
                        <td className={historyValueClass}>{formatCurrency(moneyValue(item.advances_total) + moneyValue(item.discounts_total))}</td>
                        <td className={historyValueClass}>{formatCurrency(getBenefitsTotal(item))}</td>
                        <td className={`${historyValueClass} text-foreground`}>{formatCurrency(item.net_total)}</td>
                        <td className="py-3 text-right font-semibold tabular-nums whitespace-nowrap">{formatCurrency(getPayrollTotal(item))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DataPanel>
          </div>
        </>
      )}
    </AppShell>
  );
}
