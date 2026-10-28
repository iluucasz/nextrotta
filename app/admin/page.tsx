'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  UploadCloud,
  Users,
  WalletCards,
  Wrench,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { LoadingShell } from '@/components/page-skeleton';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import {
  compactName,
  formatCurrency,
  formatNumber,
  resolveCompetenceMonth,
  brasiliaDateKey,
} from '@/lib/formatters';
import type { Payroll, Service, Technician } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';
import './overview.css';

const monthNames = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

type TechnicianSummary = {
  technician: Technician;
  serviceCount: number;
  grossValue: number;
  payrollItem?: Payroll;
  /** The payroll exists and was explicitly closed; a draft still counts as pending. */
  payrollClosed: boolean;
  payrollCost: number;
  result: number | null;
  hasActivity: boolean;
};

function moneyValue(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundCurrency(value: number | string | null | undefined) {
  return Math.round((moneyValue(value) + Number.EPSILON) * 100) / 100;
}

function formatCompetenceLabel(value: string) {
  const [year, month] = value.split('-');
  const monthNumber = Number(month);

  if (!year || !month || !monthNames[monthNumber - 1]) {
    return value || 'Sem competência';
  }

  return `${month.padStart(2, '0')}/${year} - ${monthNames[monthNumber - 1]}`;
}

function getServiceCompetence(service: Service) {
  return resolveCompetenceMonth(
    service.competence_month,
    service.date_performed,
  );
}

function isPayrollClosed(payrollItem: Payroll | undefined) {
  return payrollItem?.status === 'closed';
}

/** Reads `{ [key]: [...] }` from an API response; null when it failed or isn't JSON. */
async function readList<T>(
  result: PromiseSettledResult<Response>,
  key: string,
): Promise<T[] | null> {
  if (result.status !== 'fulfilled' || !result.value.ok) return null;

  try {
    const data = await result.value.json();
    return Array.isArray(data?.[key]) ? data[key] : [];
  } catch {
    return null;
  }
}

function getPayrollCost(payrollItem: Payroll) {
  return roundCurrency(
    moneyValue(payrollItem.net_total) +
      moneyValue(payrollItem.va_deduction) +
      moneyValue(payrollItem.vr_deduction),
  );
}

function summarizeNames(rows: TechnicianSummary[]) {
  const names = rows.map((row) => compactName(row.technician.name));
  if (!names.length) return 'Nenhum';
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
}

function PriorityItem({
  title,
  value,
  description,
  tone,
  href,
  action,
}: {
  title: string;
  value: string | number;
  description: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
  href: string;
  action: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-2xl border border-border bg-background p-4 shadow-sm transition hover:border-primary/40 hover:bg-muted/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        <StatusBadge tone={tone}>{value}</StatusBadge>
      </div>

      <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary">
        {action}
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

export default function AdminDashboard() {
  const { user, loading } = useAppSession();
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [competenceMonth, setCompetenceMonth] = useState(() =>
    brasiliaDateKey().slice(0, 7),
  );
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      if (!user) return;

      setIsDataLoading(true);
      setDataError('');

      const [techniciansResult, servicesResult, payrollResult] =
        await Promise.allSettled([
          fetch('/api/technicians'),
          fetch('/api/services'),
          fetch('/api/payroll'),
        ]);
      const [loadedTechnicians, loadedServices, loadedPayroll] =
        await Promise.all([
          readList<Technician>(techniciansResult, 'technicians'),
          readList<Service>(servicesResult, 'services'),
          readList<Payroll>(payrollResult, 'payrolls'),
        ]);

      if (!mounted) return;

      const errors: string[] = [];
      if (!loadedTechnicians) errors.push('técnicos');
      if (!loadedServices) errors.push('OS');
      if (!loadedPayroll) errors.push('folha');

      setTechnicians(loadedTechnicians ?? []);
      setServices(loadedServices ?? []);
      setPayroll(loadedPayroll ?? []);
      setDataError(
        errors.length
          ? `Não foi possível carregar dados de ${errors.join(', ')}.`
          : '',
      );
      setIsDataLoading(false);
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [user]);

  const competenceOptions = useMemo(() => {
    const values = new Set<string>();
    const activeIds = new Set(
      technicians
        .filter((technician) => technician.status === 'active')
        .map((technician) => technician.id),
    );

    services.forEach((service) => {
      if (!activeIds.has(service.technician_id)) return;
      const competence = getServiceCompetence(service);
      if (competence) values.add(competence);
    });

    payroll.forEach((item) => {
      if (!activeIds.has(item.technician_id)) return;
      const competence = String(item.competence_month ?? '').trim();
      if (/^\d{4}-\d{2}$/.test(competence)) values.add(competence);
    });

    return Array.from(values).sort((left, right) =>
      right.localeCompare(left, 'pt-BR'),
    );
  }, [payroll, services, technicians]);

  const selectedCompetenceYear =
    Number(competenceMonth.slice(0, 4)) || new Date().getFullYear();
  const selectedCompetenceMonth =
    Number(competenceMonth.slice(5, 7)) || new Date().getMonth() + 1;
  const activeTechnicians = useMemo(
    () => technicians.filter((technician) => technician.status === 'active'),
    [technicians],
  );
  const activeTechnicianIds = useMemo(
    () => new Set(activeTechnicians.map((technician) => technician.id)),
    [activeTechnicians],
  );
  const competenceYearOptions = useMemo(() => {
    const years = competenceOptions
      .map((value) => Number(value.slice(0, 4)))
      .filter((value) => Number.isInteger(value));

    return Array.from(new Set([selectedCompetenceYear, ...years])).sort(
      (left, right) => left - right,
    );
  }, [competenceOptions, selectedCompetenceYear]);

  const servicesInCompetence = useMemo(
    () =>
      services.filter(
        (service) =>
          activeTechnicianIds.has(service.technician_id) &&
          getServiceCompetence(service) === competenceMonth,
      ),
    [activeTechnicianIds, competenceMonth, services],
  );

  const payrollInCompetence = useMemo(
    () =>
      payroll.filter(
        (item) =>
          activeTechnicianIds.has(item.technician_id) &&
          item.competence_month === competenceMonth,
      ),
    [activeTechnicianIds, competenceMonth, payroll],
  );

  const closedPayrollInCompetence = useMemo(
    () => payrollInCompetence.filter((item) => isPayrollClosed(item)),
    [payrollInCompetence],
  );

  const summaries = useMemo<TechnicianSummary[]>(() => {
    return activeTechnicians
      .map((technician) => {
        const technicianServices = servicesInCompetence.filter(
          (service) => service.technician_id === technician.id,
        );
        const payrollItem = payrollInCompetence.find(
          (item) => item.technician_id === technician.id,
        );
        const grossValue = roundCurrency(
          technicianServices.reduce(
            (total, service) => total + moneyValue(service.value),
            0,
          ),
        );
        const payrollCost = payrollItem ? getPayrollCost(payrollItem) : 0;
        const hasActivity = Boolean(technicianServices.length || payrollItem);

        return {
          technician,
          serviceCount: technicianServices.length,
          grossValue,
          payrollItem,
          payrollClosed: isPayrollClosed(payrollItem),
          payrollCost,
          result: payrollItem
            ? roundCurrency(
                moneyValue(payrollItem.total_services_value) - payrollCost,
              )
            : null,
          hasActivity,
        };
      })
      .sort((left, right) => {
        if (right.grossValue !== left.grossValue)
          return right.grossValue - left.grossValue;
        if (
          Number(Boolean(right.payrollItem)) !==
          Number(Boolean(left.payrollItem))
        ) {
          return (
            Number(Boolean(right.payrollItem)) -
            Number(Boolean(left.payrollItem))
          );
        }
        return left.technician.name.localeCompare(
          right.technician.name,
          'pt-BR',
        );
      });
  }, [activeTechnicians, payrollInCompetence, servicesInCompetence]);

  if (loading || isDataLoading || !user) {
    return <LoadingShell role="admin" />;
  }

  const rowsWithServices = summaries.filter((row) => row.serviceCount > 0);
  // Every active technician owes a payroll each month (base salary), with or without OS.
  const pendingPayrollRows = summaries.filter((row) => !row.payrollClosed);
  const negativeResultRows = summaries.filter(
    (row) => typeof row.result === 'number' && row.result < 0,
  );
  const activeWithoutServicesRows = summaries.filter(
    (row) => row.technician.status === 'active' && row.serviceCount === 0,
  );
  const totalGrossValue = roundCurrency(
    servicesInCompetence.reduce(
      (total, service) => total + moneyValue(service.value),
      0,
    ),
  );
  const payrollCostTotal = roundCurrency(
    closedPayrollInCompetence.reduce(
      (total, item) => total + getPayrollCost(item),
      0,
    ),
  );
  const closedResultTotal = roundCurrency(
    closedPayrollInCompetence.reduce(
      (total, item) =>
        total + (moneyValue(item.total_services_value) - getPayrollCost(item)),
      0,
    ),
  );
  const isPayrollAwaitingClosure = pendingPayrollRows.length > 0;
  const payrollProgress = summaries.length
    ? Math.round(
        ((summaries.length - pendingPayrollRows.length) / summaries.length) *
          100,
      )
    : 0;
  const shortcutCards = [
    {
      href: '/admin/services',
      title: 'Importar OS',
      description: 'Enviar e revisar as ordens de serviço da competência.',
      icon: UploadCloud,
    },
    {
      href: '/admin/payroll',
      title: 'Calcular folha',
      description: 'Abrir os fechamentos e salvar os cálculos do mês.',
      icon: WalletCards,
    },
    {
      href: '/admin/technicians',
      title: 'Técnicos',
      description: 'Atualizar cadastro, comissão e situação da equipe.',
      icon: Users,
    },
    {
      href: '/admin/schedule',
      title: 'Escala',
      description: 'Organizar a cobertura e revisar a programação da equipe.',
      icon: CalendarDays,
    },
  ];

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <div className="admin-overview">
        <PageHeader
          eyebrow="Painel administrativo"
          title="Visão geral"
          description="Acompanhe as ordens de serviço, os fechamentos e as prioridades da sua equipe."
        />
        <section
          className="admin-overview-filters"
          aria-label="Filtros do painel"
        >
          <div className="admin-overview-filter-heading">
            <span className="admin-overview-icon">
              <CalendarDays size={22} aria-hidden="true" />
            </span>
            <div>
              <h2>Competência</h2>
              <p>O período escolhido vale para todo o painel.</p>
            </div>
          </div>
          <div className="admin-overview-filter-fields">
            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Mês</span>
              <select
                value={String(selectedCompetenceMonth)}
                onChange={(event) =>
                  setCompetenceMonth(
                    `${selectedCompetenceYear}-${String(Number(event.target.value)).padStart(2, '0')}`,
                  )
                }
                className="min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
              >
                {monthNames.map((month, index) => (
                  <option key={month} value={index + 1}>
                    {month}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Ano</span>
              <select
                value={String(selectedCompetenceYear)}
                onChange={(event) =>
                  setCompetenceMonth(
                    `${event.target.value}-${String(selectedCompetenceMonth).padStart(2, '0')}`,
                  )
                }
                className="min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
              >
                {competenceYearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="admin-overview-period" aria-live="polite">
            Exibindo <strong>{formatCompetenceLabel(competenceMonth)}</strong>
          </p>
        </section>
        {dataError ? (
          <div
            role="alert"
            className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
          >
            {dataError}
          </div>
        ) : null}
        <div className="admin-overview-metrics">
          <MetricCard
            title="Valor bruto"
            value={formatCurrency(totalGrossValue)}
            hint="Soma das OS do mês"
            icon={Wrench}
            tone="success"
          />
          <MetricCard
            title="OS"
            value={formatNumber(servicesInCompetence.length)}
            hint={`${rowsWithServices.length} técnico(s)`}
            icon={Wrench}
          />
          <MetricCard
            title="Folha finalizada"
            value={
              isPayrollAwaitingClosure
                ? 'Aguardando'
                : formatCurrency(payrollCostTotal)
            }
            hint={
              isPayrollAwaitingClosure
                ? `Feche a folha de ${pendingPayrollRows.length} técnico(s) para liberar o total.`
                : `${closedPayrollInCompetence.length} folha(s) fechada(s)`
            }
            icon={WalletCards}
            tone={isPayrollAwaitingClosure ? 'warning' : 'default'}
          />
          <MetricCard
            title="Resultado fechado"
            value={
              isPayrollAwaitingClosure
                ? 'Aguardando'
                : formatCurrency(closedResultTotal)
            }
            hint={
              isPayrollAwaitingClosure
                ? 'O resultado final aparece após o fechamento completo da folha.'
                : 'Bruto salvo - folha fechada'
            }
            icon={WalletCards}
            tone={
              isPayrollAwaitingClosure
                ? 'warning'
                : closedResultTotal >= 0
                  ? 'success'
                  : 'danger'
            }
            accentText
          />
        </div>
        <nav
          className="admin-overview-shortcuts"
          aria-label="Atalhos da operação"
        >
          {shortcutCards.map(({ href, title, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              title={description}
              className="admin-overview-shortcut"
            >
              <span className="admin-overview-icon">
                <Icon size={22} aria-hidden="true" />
              </span>
              <span>{title}</span>
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          ))}
        </nav>
        <DataPanel
          title="O que precisa de atenção"
          description="Pendências e conferências do período selecionado."
        >
          <div className="admin-overview-priorities">
            <PriorityItem
              title="Folhas pendentes"
              value={pendingPayrollRows.length}
              tone={pendingPayrollRows.length ? 'warning' : 'success'}
              description={
                pendingPayrollRows.length
                  ? `Falta finalizar: ${summarizeNames(pendingPayrollRows)}.`
                  : 'Todos os técnicos ativos já têm a folha fechada.'
              }
              href="/admin/payroll"
              action="Abrir folha"
            />
            <PriorityItem
              title="Resultado negativo"
              value={negativeResultRows.length ? 'Atenção' : 'Ok'}
              tone={negativeResultRows.length ? 'danger' : 'success'}
              description={
                negativeResultRows.length
                  ? `Revisar fechamento de ${summarizeNames(negativeResultRows)}.`
                  : 'Nenhum cálculo salvo está negativo.'
              }
              href="/admin/payroll"
              action="Revisar cálculos"
            />
            <PriorityItem
              title="Ativos sem OS"
              value={activeWithoutServicesRows.length}
              tone={activeWithoutServicesRows.length ? 'info' : 'success'}
              description={
                activeWithoutServicesRows.length
                  ? `${summarizeNames(activeWithoutServicesRows)} sem OS nesta competência.`
                  : 'Todos os técnicos ativos têm OS no mês.'
              }
              href="/admin/services"
              action="Ver OS"
            />
          </div>
        </DataPanel>
        <DataPanel
          title="Produção por técnico"
          description={
            isPayrollAwaitingClosure
              ? `Fechamento aguardando a folha de ${pendingPayrollRows.length} técnico(s).`
              : `Fechamento da competência: ${payrollProgress}% concluído.`
          }
        >
          {summaries.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 pr-4 font-medium">Técnico</th>
                    <th className="py-3 pr-4 font-medium">OS</th>
                    <th className="py-3 pr-4 font-medium">Bruto</th>
                    <th className="py-3 pr-4 font-medium">Folha</th>
                    <th className="py-3 pr-4 font-medium">Resultado</th>
                    <th className="py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((row) => (
                    <tr
                      key={row.technician.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="py-3 pr-4">
                        <div className="font-medium">{row.technician.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.technician.qra || row.technician.email || '-'}
                        </div>
                      </td>
                      <td className="py-3 pr-4">{row.serviceCount}</td>
                      <td className="py-3 pr-4">
                        {formatCurrency(row.grossValue)}
                      </td>
                      <td className="py-3 pr-4">
                        {row.payrollItem
                          ? formatCurrency(row.payrollCost)
                          : '-'}
                      </td>
                      <td
                        className={`py-3 pr-4 font-semibold ${typeof row.result === 'number' && row.result < 0 ? 'text-rose-700' : 'text-emerald-700'}`}
                      >
                        {row.payrollItem ? formatCurrency(row.result) : '-'}
                      </td>
                      <td className="py-3">
                        {row.payrollClosed ? (
                          <StatusBadge tone="success">Finalizado</StatusBadge>
                        ) : row.payrollItem ? (
                          <StatusBadge tone="warning">Rascunho</StatusBadge>
                        ) : row.serviceCount > 0 ? (
                          <StatusBadge tone="warning">Pendente</StatusBadge>
                        ) : (
                          <StatusBadge tone="neutral">Sem OS</StatusBadge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border bg-secondary/30 px-4 py-8 text-center text-sm text-muted-foreground">
              Nenhum dado real encontrado para a competência selecionada.
            </div>
          )}
        </DataPanel>
        <p className="admin-overview-footnote">
          Equipe ativa: {activeTechnicians.length}/{technicians.length}. Dados
          de Serviços, Técnicos e Folha.
        </p>
      </div>
    </AppShell>
  );
}
