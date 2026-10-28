'use client';

import { useMemo, useState, type ReactNode } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import {
  Activity,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Download,
  Filter,
  Layers3,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AppShell } from '@/components/app-shell';
import {
  buildManagementDashboard,
  defaultManagementFilters,
  MONTH_NAMES,
  variation,
  type ManagementData,
  type ManagementFilters,
} from '@/lib/management-dashboard';
import { formatCurrency, formatHours, formatNumber, formatPercent, normalizeText } from '@/lib/formatters';
import './management-dashboard.css';
import { CHART_COLORS as COLORS } from '@/lib/chart-theme';

const axis = { tickLine: false, axisLine: false, tick: { fill: '#8a8b9b', fontSize: 14 }, minTickGap: 24 };
const tooltipStyle = {
  border: '1px solid #eeedf4',
  borderRadius: 12,
  boxShadow: '0 8px 30px #25233d12',
  fontSize: 16,
  color: '#252337',
};
const compactCurrency = (value: number) =>
  value.toLocaleString('pt-BR', { notation: 'compact', style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

class SessionExpiredError extends Error {}

async function fetchDashboard(url: string): Promise<ManagementData> {
  const response = await fetch(url, { cache: 'no-store' });
  if (response.redirected || response.status === 401)
    throw new SessionExpiredError('Sua sessão expirou. Entre novamente para acessar os indicadores.');
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || 'Não foi possível carregar os indicadores.');
  }
  return response.json();
}

function SelectFilter({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="mg-select">
      <span>{label}</span>
      <div>
        <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
          {children}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </div>
    </label>
  );
}
function Delta({ current, previous, reverse = false }: { current: number; previous: number; reverse?: boolean }) {
  const delta = variation(current, previous);
  if (delta === null) return <span className="mg-delta neutral">Sem base anterior</span>;
  const positive = reverse ? delta < 0 : delta > 0;
  const Icon = delta >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`mg-delta ${delta === 0 ? 'neutral' : positive ? 'positive' : 'negative'}`}>
      <Icon size={13} />
      {delta > 0 ? '+' : ''}
      {formatPercent(delta)}
    </span>
  );
}
function Metric({
  title,
  value,
  hint,
  icon: Icon,
  current,
  previous,
  dark = false,
  reverse = false,
}: {
  title: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  current: number;
  previous: number;
  dark?: boolean;
  reverse?: boolean;
}) {
  return (
    <article className={`mg-metric ${dark ? 'mg-metric-dark' : ''}`}>
      <div className="mg-metric-top">
        <span>{title}</span>
        <span className="mg-icon">
          <Icon size={18} />
        </span>
      </div>
      <strong>{value}</strong>
      <div className="mg-metric-bottom">
        <Delta current={current} previous={previous} reverse={reverse} />
        <span>{hint}</span>
      </div>
    </article>
  );
}
function Panel({
  title,
  description,
  badge,
  children,
  className = '',
}: {
  title: string;
  description: string;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mg-panel ${className}`}>
      <header className="mg-panel-heading">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        {badge}
      </header>
      {children}
    </section>
  );
}
function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="mg-legend">
      {items.map((item) => (
        <span key={item.label}>
          <i style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
function ChartEmpty({ message = 'Nenhum registro neste recorte.' }: { message?: string }) {
  return (
    <div className="mg-chart-empty">
      <ChartNoAxesCombined size={26} />
      <p>{message}</p>
      <span>Selecione outro período ou ajuste os filtros.</span>
    </div>
  );
}

export function ManagementDashboard({ userName, today }: { userName: string; today: string }) {
  const [filters, setFilters] = useState(() => defaultManagementFilters(today));
  const [expanded, setExpanded] = useState(false);
  const [activeSection, setActiveSection] = useState('visao-geral');
  const [technicianSearch, setTechnicianSearch] = useState('');
  const [rankingSearch, setRankingSearch] = useState('');
  const [rankingSort, setRankingSort] = useState<'revenue' | 'services' | 'ticket' | 'transfer' | 'net' | 'margin'>(
    'revenue',
  );
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const { data, error, isLoading, isValidating, mutate } = useSWR<ManagementData>(
    `/api/dashboard-gerencial?year=${filters.year}`,
    fetchDashboard,
    { revalidateOnFocus: true, refreshInterval: 60000, shouldRetryOnError: false },
  );
  const dashboard = useMemo(
    () => (data && data.year === filters.year ? buildManagementDashboard(data, filters) : null),
    [data, filters],
  );
  const update = <K extends keyof ManagementFilters>(key: K, value: ManagementFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const filterCount =
    Number(filters.technicianIds.length > 0) +
    Number(filters.technicianStatus !== 'all') +
    Number(filters.serviceType !== 'all') +
    Number(filters.expenseCategory !== 'all') +
    Number(filters.expenseStatus !== 'all') +
    Number(filters.payrollStatus !== 'closed') +
    Number(filters.costScope !== 'all');
  const years = [...new Set([filters.year, Number(today.slice(0, 4)), ...(data?.years ?? [])])].sort((a, b) => b - a);
  const serviceTypes = [...new Set(data?.production.map((p) => p.serviceType) ?? [])].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  );
  const expenseCategories = [...new Set(data?.expenses.map((e) => e.category) ?? [])].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  );
  const visibleTechnicians = (data?.technicians ?? []).filter((t) =>
    normalizeText(`${t.name} ${t.qra ?? ''}`).includes(normalizeText(technicianSearch)),
  );
  const ranking = (dashboard?.technicians ?? [])
    .filter((t) => normalizeText(`${t.name} ${t.qra ?? ''}`).includes(normalizeText(rankingSearch)))
    .sort((a, b) => b[rankingSort] - a[rankingSort] || a.name.localeCompare(b.name, 'pt-BR'));
  const pageCount = Math.max(1, Math.ceil(ranking.length / 10));
  const currentPage = Math.min(page, pageCount);
  const current = dashboard?.current,
    previous = dashboard?.previous;
  const periodInProgress =
    filters.year === Number(today.slice(0, 4)) &&
    (filters.mode === 'annual' || filters.month === Number(today.slice(5, 7)));
  const partial = Boolean(
    current?.missingPayroll ||
    current?.draftPayroll ||
    !data?.financeAvailable ||
    filters.payrollStatus !== 'closed' ||
    filters.costScope !== 'all' ||
    filters.expenseStatus !== 'all' ||
    filters.expenseCategory !== 'all',
  );
  const costTitle =
    filters.costScope === 'payroll'
      ? 'Custo dos prestadores'
      : filters.costScope === 'expenses'
        ? 'Despesas gerais'
        : 'Despesas + prestadores';

  async function exportWorkbook() {
    if (!dashboard || !data) return;
    setExporting(true);
    setExportError('');
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();
      const addSheet = (name: string, rows: Record<string, string | number>[]) => {
        const sheet = XLSX.utils.json_to_sheet(rows);
        sheet['!cols'] = Array.from({ length: 15 }, () => ({ wch: 23 }));
        XLSX.utils.book_append_sheet(workbook, sheet, name);
      };
      addSheet('Resumo', [
        {
          Período: dashboard.periodLabel,
          Faturamento: dashboard.current.revenue,
          'Custo dos prestadores': dashboard.current.payrollCost,
          Despesas: dashboard.current.expenses,
          Resultado: dashboard.current.net,
          'Ticket médio': dashboard.current.ticket,
          Serviços: dashboard.current.services,
          'Margem (%)': dashboard.current.margin,
          'Folhas pendentes': dashboard.current.missingPayroll,
          'Faltas confirmadas': dashboard.current.missed,
          'Ausências justificadas': dashboard.current.justified,
        },
      ]);
      addSheet(
        'Evolução mensal',
        dashboard.trend.map((t) => ({
          Mês: t.month,
          Faturamento: t.revenue,
          Custos: t.totalCosts,
          Resultado: t.net,
          Serviços: t.services,
          'Ticket médio': t.ticket,
          'Horas realizadas': t.worked,
          'Créditos (h)': t.credits,
          'Débitos (h)': t.debits,
          'Saldo acumulado (h)': t.accumulated,
          Faltas: t.missed,
          Justificadas: t.justified,
          'Sem apontamento': t.pending,
        })),
      );
      addSheet(
        'Prestadores',
        dashboard.technicians.map((t) => ({
          Prestador: t.name,
          QRA: t.qra ?? '',
          Status: t.status === 'active' ? 'Ativo' : 'Inativo',
          Serviços: t.services,
          Faturamento: t.revenue,
          'Ticket médio': t.ticket,
          'Repasse em folha': t.transfer,
          'Custo da folha (com benefícios)': t.payrollCost,
          'Despesas rateadas': t.expenses,
          Resultado: t.net,
          'Margem (%)': t.margin,
          'Folhas pendentes': t.missingPayroll,
          'Horas realizadas': t.worked,
          Faltas: t.missed,
        })),
      );
      addSheet('Critérios', [
        { Critério: 'Atualização', Valor: new Date(data.updatedAt).toLocaleString('pt-BR') },
        { Critério: 'Período e comparação', Valor: `${dashboard.periodLabel} / ${dashboard.comparisonLabel}` },
        ...Object.entries(filters).map(([key, value]) => ({
          Critério: key,
          Valor: Array.isArray(value) ? value.join(', ') : String(value),
        })),
        {
          Critério: 'Prestadores selecionados',
          Valor: filters.technicianIds.length
            ? data.technicians
                .filter((t) => filters.technicianIds.includes(t.id))
                .map((t) => t.name)
                .join(', ')
            : 'Todos',
        },
        {
          Critério: 'Faturamento',
          Valor: 'Soma dos serviços por competência. Contas a receber não são somadas novamente.',
        },
        {
          Critério: 'Custos',
          Valor:
            'Líquido da folha + adiantamentos + VA/VR + contas a pagar. Folha fechada não confirma pagamento bancário. Evite repetir folha em despesas gerais.',
        },
        {
          Critério: 'Rateio',
          Valor:
            'Despesas gerais proporcionais ao faturamento mensal; custo de folha proporcional ao faturamento do tipo de serviço no prestador/mês.',
        },
        {
          Critério: 'Operação',
          Valor:
            'Período e prestadores selecionados. Créditos/débitos comparados à escala apontada, com a pausa diária definida em Configurações. Débito não comprova compensação. Folgas e dias sem apontamento não são faltas.',
        },
      ]);
      XLSX.writeFile(
        workbook,
        `dashboard-gerencial-${filters.year}${filters.mode === 'monthly' ? `-${String(filters.month).padStart(2, '0')}` : ''}.xlsx`,
      );
    } catch {
      setExportError('Não foi possível exportar a planilha. Tente novamente.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell role="admin" userName={userName}>
      <div className="mg-dashboard">
        <header className="mg-page-heading">
          <div>
            <div className="mg-eyebrow">
              <span /> VISÃO ESTRATÉGICA <span className="mg-eyebrow-divider">/</span> NEXTROTTA
            </div>
            <h1>
              Dashboard Gerencial<span>.</span>
            </h1>
            <p>Os números da sua operação. A clareza para o próximo passo.</p>
          </div>
          <div className="mg-header-actions">
            <span className="mg-access">
              <ShieldCheck size={13} /> Exclusivo admin
            </span>
            <button
              className="mg-button mg-button-dark"
              onClick={exportWorkbook}
              disabled={!dashboard || exporting || Boolean(error)}
            >
              {exporting ? <LoaderCircle className="mg-spin" size={15} /> : <Download size={15} />}
              {exporting ? 'Exportando...' : 'Exportar relatório'}
            </button>
          </div>
        </header>

        <section className="mg-filter-bar" aria-label="Filtros do dashboard">
          <div className="mg-period-toggle" aria-label="Visualização">
            <button
              aria-pressed={filters.mode === 'monthly'}
              className={filters.mode === 'monthly' ? 'selected' : ''}
              onClick={() => update('mode', 'monthly')}
            >
              Mensal
            </button>
            <button
              aria-pressed={filters.mode === 'annual'}
              className={filters.mode === 'annual' ? 'selected' : ''}
              onClick={() => update('mode', 'annual')}
            >
              Anual
            </button>
          </div>
          <div className="mg-period-inputs">
            <CalendarDays size={16} />
            {filters.mode === 'monthly' && (
              <select
                aria-label="Mês"
                value={filters.month}
                onChange={(event) => update('month', Number(event.target.value))}
              >
                {MONTH_NAMES.map((month, index) => (
                  <option key={month} value={index + 1}>
                    {month}
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label="Ano"
              value={filters.year}
              onChange={(event) => update('year', Number(event.target.value))}
            >
              {years.map((year) => (
                <option key={year}>{year}</option>
              ))}
            </select>
          </div>
          <div className="mg-filter-spacer" />
          <span className="mg-update">
            <span className={isValidating ? 'updating' : ''} />
            {isValidating
              ? 'Atualizando...'
              : data
                ? `Atualizado às ${new Date(data.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                : 'Conectando aos dados'}
          </span>
          <button
            className={`mg-button ${expanded || filterCount ? 'mg-button-active' : ''}`}
            aria-expanded={expanded}
            aria-controls="management-filters"
            onClick={() => setExpanded((value) => !value)}
          >
            <SlidersHorizontal size={15} />
            Filtros{filterCount > 0 && <b className="mg-count">{filterCount}</b>}
            <ChevronDown size={13} />
          </button>
          <button
            className="mg-button mg-button-icon"
            aria-label="Atualizar indicadores"
            title="Atualizar indicadores"
            disabled={isValidating}
            onClick={() => mutate()}
          >
            <RefreshCw size={15} className={isValidating ? 'mg-spin' : ''} />
          </button>
        </section>

        {expanded && (
          <section className="mg-filter-details" id="management-filters">
            <div className="mg-filter-details-title">
              <div>
                <Filter size={15} />
                <strong>Explore os dados da empresa</strong>
              </div>
              <button
                onClick={() => {
                  setFilters((current) => ({
                    ...defaultManagementFilters(today),
                    mode: current.mode,
                    month: current.month,
                    year: current.year,
                  }));
                  setTechnicianSearch('');
                  setPage(1);
                }}
                className="mg-text-button"
              >
                Limpar filtros
              </button>
            </div>
            <div className="mg-filter-grid">
              <SelectFilter
                label="Situação dos prestadores"
                value={filters.technicianStatus}
                onChange={(value) => update('technicianStatus', value as ManagementFilters['technicianStatus'])}
              >
                <option value="all">Ativos e inativos</option>
                <option value="active">Somente ativos</option>
                <option value="inactive">Somente inativos</option>
              </SelectFilter>
              <SelectFilter
                label="Tipo de serviço"
                value={filters.serviceType}
                onChange={(value) => update('serviceType', value)}
              >
                <option value="all">Todos os serviços</option>
                {serviceTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
                {filters.serviceType !== 'all' && !serviceTypes.includes(filters.serviceType) && (
                  <option>{filters.serviceType}</option>
                )}
              </SelectFilter>
              <SelectFilter
                label="Categoria de despesa"
                value={filters.expenseCategory}
                onChange={(value) => update('expenseCategory', value)}
              >
                <option value="all">Todas as categorias</option>
                {expenseCategories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
                {filters.expenseCategory !== 'all' && !expenseCategories.includes(filters.expenseCategory) && (
                  <option>{filters.expenseCategory}</option>
                )}
              </SelectFilter>
              <SelectFilter
                label="Valores das despesas"
                value={filters.expenseStatus}
                onChange={(value) => update('expenseStatus', value as ManagementFilters['expenseStatus'])}
              >
                <option value="all">Total por competência</option>
                <option value="paid">Somente valores pagos</option>
                <option value="pending">Somente saldo em aberto</option>
              </SelectFilter>
              <SelectFilter
                label="Folhas consideradas"
                value={filters.payrollStatus}
                onChange={(value) => update('payrollStatus', value as ManagementFilters['payrollStatus'])}
              >
                <option value="closed">Somente fechadas</option>
                <option value="all">Fechadas + rascunhos</option>
                <option value="draft">Somente rascunhos</option>
              </SelectFilter>
              <SelectFilter
                label="Custos incluídos no resultado"
                value={filters.costScope}
                onChange={(value) => update('costScope', value as ManagementFilters['costScope'])}
              >
                <option value="all">Prestadores + despesas</option>
                <option value="payroll">Somente prestadores</option>
                <option value="expenses">Somente despesas</option>
              </SelectFilter>
            </div>
            <div className="mg-technician-filter">
              <div className="mg-technician-filter-heading">
                <span>
                  Prestadores{' '}
                  <small>
                    {filters.technicianIds.length
                      ? `${filters.technicianIds.length} selecionado(s)`
                      : 'Todos selecionados'}
                  </small>
                </span>
                <label className="mg-search">
                  <Search size={14} />
                  <input
                    aria-label="Buscar prestador nos filtros"
                    placeholder="Buscar por nome ou QRA"
                    value={technicianSearch}
                    onChange={(event) => setTechnicianSearch(event.target.value)}
                  />
                </label>
              </div>
              <div className="mg-technician-options">
                <button
                  className={!filters.technicianIds.length ? 'selected' : ''}
                  aria-pressed={!filters.technicianIds.length}
                  onClick={() => update('technicianIds', [])}
                >
                  <Users size={13} />
                  Todos
                </button>
                {visibleTechnicians.map((t) => (
                  <button
                    key={t.id}
                    aria-pressed={filters.technicianIds.includes(t.id)}
                    className={filters.technicianIds.includes(t.id) ? 'selected' : ''}
                    onClick={() =>
                      update(
                        'technicianIds',
                        filters.technicianIds.includes(t.id)
                          ? filters.technicianIds.filter((id) => id !== t.id)
                          : [...filters.technicianIds, t.id],
                      )
                    }
                  >
                    {filters.technicianIds.includes(t.id) && <Check size={12} />}
                    {t.name}
                    {t.status === 'inactive' && <small>Inativo</small>}
                  </button>
                ))}
                {!visibleTechnicians.length && <span className="mg-muted">Nenhum prestador encontrado.</span>}
              </div>
            </div>
            <p className="mg-scope-note">
              Período e prestadores filtram toda a visão. Tipo de serviço refina a produção; categoria, valores e folhas
              refinam os custos. Horas e ausências seguem o período e a equipe.
            </p>
          </section>
        )}
        {filterCount > 0 && !expanded && (
          <div className="mg-active-filters">
            <Filter size={13} />
            <span>{filterCount} filtro(s) adicional(is) aplicado(s) · resultado do recorte selecionado</span>
            <button
              aria-label="Limpar filtros adicionais"
              onClick={() =>
                setFilters((current) => ({
                  ...defaultManagementFilters(today),
                  mode: current.mode,
                  month: current.month,
                  year: current.year,
                }))
              }
            >
              <X size={14} />
            </button>
          </div>
        )}
        {exportError && (
          <div className="mg-notice" role="alert">
            {exportError}
          </div>
        )}
        {error && (
          <div className="mg-error" role="alert">
            <CircleHelp size={23} />
            <div>
              <strong>Os indicadores não puderam ser atualizados</strong>
              <p>{error.message}</p>
            </div>
            <button className="mg-button" onClick={() => mutate()}>
              Tentar novamente
            </button>
            {error instanceof SessionExpiredError && (
              <Link href="/login" className="mg-text-button">
                Entrar novamente
              </Link>
            )}
          </div>
        )}
        {!dashboard && !error && (
          <div className="mg-loading" role="status">
            <LoaderCircle className="mg-spin" size={25} />
            <strong>Consolidando a visão da empresa</strong>
            <span>Serviços, financeiro, prestadores e operação.</span>
            <div className="mg-skeleton-grid">
              {[1, 2, 3, 4].map((key) => (
                <div key={key} />
              ))}
            </div>
          </div>
        )}

        {dashboard && current && previous && (
          <div className={error ? 'mg-stale' : ''} aria-busy={isLoading}>
            <nav className="mg-section-nav" aria-label="Seções do dashboard">
              <a
                href="#visao-geral"
                className={activeSection === 'visao-geral' ? 'active' : ''}
                onClick={() => setActiveSection('visao-geral')}
              >
                <ChartNoAxesCombined size={15} />
                Visão geral
              </a>
              <a
                href="#prestadores"
                className={activeSection === 'prestadores' ? 'active' : ''}
                onClick={() => setActiveSection('prestadores')}
              >
                <Users size={15} />
                Prestadores
              </a>
              <a
                href="#operacao"
                className={activeSection === 'operacao' ? 'active' : ''}
                onClick={() => setActiveSection('operacao')}
              >
                <Activity size={15} />
                Operação
              </a>
              <span>{dashboard.periodLabel}</span>
            </nav>
            <section id="visao-geral" className="mg-section">
              <div className="mg-section-heading">
                <div>
                  <span className="mg-section-number">01</span>
                  <h2>Um olhar para o resultado</h2>
                </div>
                <span className="mg-comparison">
                  Comparativo com {dashboard.comparisonLabel.toLowerCase()}
                  {periodInProgress ? ' · período atual em andamento' : ''}
                </span>
              </div>
              {(current.missingPayroll > 0 || !data?.financeAvailable) && (
                <div className="mg-notice">
                  <CircleHelp size={16} />
                  <span>
                    {current.missingPayroll > 0 &&
                      `${current.missingPayroll} competência(s) de prestador com serviços ainda sem folha fechada. O resultado está parcial. `}
                    {!data?.financeAvailable &&
                      'O módulo de despesas ainda não tem estrutura disponível; despesas não foram contabilizadas.'}
                  </span>
                  {current.missingPayroll > 0 && (
                    <Link href="/admin/payroll">
                      Revisar folhas <ArrowRight size={13} />
                    </Link>
                  )}
                </div>
              )}
              {dashboard.scoped && (
                <p className="mg-scope-note mg-scope-inline">
                  <Layers3 size={14} />
                  Recorte com rateio: despesas gerais proporcionais ao faturamento mensal. Ao filtrar um serviço, a
                  folha também é rateada pela produção do prestador.
                </p>
              )}
              <div className="mg-metrics">
                <Metric
                  title="Faturamento bruto"
                  value={formatCurrency(current.revenue)}
                  hint={`${formatNumber(current.services)} serviços no período`}
                  icon={Wallet}
                  current={current.revenue}
                  previous={previous.revenue}
                />
                <Metric
                  title={`Faturamento líquido${partial ? ' · parcial' : ''}`}
                  value={formatCurrency(current.net)}
                  hint={`${formatPercent(current.margin)} de margem${dashboard.scoped ? ' estimada' : ''}`}
                  icon={ArrowUpRight}
                  current={current.net}
                  previous={previous.net}
                  dark
                />
                <Metric
                  title="Ticket médio geral"
                  value={formatCurrency(current.ticket)}
                  hint="Faturamento por serviço"
                  icon={Layers3}
                  current={current.ticket}
                  previous={previous.ticket}
                />
                <Metric
                  title={costTitle}
                  value={formatCurrency(current.totalCosts)}
                  hint={filters.expenseStatus === 'all' ? 'Custos por competência' : 'Despesas com filtro de pagamento'}
                  icon={ArrowDownLeft}
                  current={current.totalCosts}
                  previous={previous.totalCosts}
                  reverse
                />
              </div>
              <div className="mg-overview-strip">
                <div>
                  <span className="mg-strip-icon">
                    <ChartNoAxesCombined size={19} />
                  </span>
                  <span>
                    <small>Volume de serviços</small>
                    <strong>
                      {formatNumber(current.services)} <Delta current={current.services} previous={previous.services} />
                    </strong>
                  </span>
                </div>
                <div>
                  <span className="mg-strip-icon">
                    <Users size={19} />
                  </span>
                  <span>
                    <small>Prestadores com produção</small>
                    <strong>
                      {dashboard.technicians.filter((t) => t.services > 0).length}
                      <em>de {dashboard.technicians.length} no recorte</em>
                    </strong>
                  </span>
                </div>
                <div>
                  <span className="mg-strip-icon">
                    <Clock3 size={19} />
                  </span>
                  <span>
                    <small>Horas realizadas</small>
                    <strong>
                      {formatHours(current.worked)}
                      <em>na equipe selecionada</em>
                    </strong>
                  </span>
                </div>
              </div>
              <div className="mg-grid-finance">
                <Panel
                  title="A evolução do seu resultado"
                  description={
                    filters.mode === 'annual'
                      ? 'Faturamento e custos ao longo do ano selecionado.'
                      : 'Últimos 12 meses, encerrando no mês selecionado.'
                  }
                  badge={<span className="mg-badge">POR COMPETÊNCIA</span>}
                >
                  <Legend
                    items={[
                      { color: COLORS[0], label: 'Faturamento' },
                      { color: COLORS[2], label: 'Custos totais' },
                      { color: COLORS[1], label: 'Resultado' },
                    ]}
                  />
                  {dashboard.trend.some((t) => t.revenue || t.totalCosts) ? (
                    <div
                      className="mg-chart"
                      role="img"
                      aria-label="Evolução mensal do faturamento, custos e resultado. Valores disponíveis na exportação."
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={dashboard.trend}
                          margin={{ top: 12, right: 8, left: 0, bottom: 5 }}
                          accessibilityLayer
                        >
                          <defs>
                            <linearGradient id="mg-revenue-fill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={COLORS[0]} stopOpacity={0.17} />
                              <stop offset="100%" stopColor={COLORS[0]} stopOpacity={0.01} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke="#eeedf4" strokeDasharray="4 5" vertical={false} />
                          <XAxis dataKey="label" {...axis} dy={8} />
                          <YAxis {...axis} tickFormatter={compactCurrency} width={70} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatCurrency(Number(value))} />
                          <ReferenceLine y={0} stroke="#cedbd2" />
                          <Area
                            type="monotone"
                            dataKey="revenue"
                            name="Faturamento"
                            stroke={COLORS[0]}
                            strokeWidth={2.5}
                            fill="url(#mg-revenue-fill)"
                            isAnimationActive={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="totalCosts"
                            name="Custos totais"
                            stroke={COLORS[2]}
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="net"
                            name="Resultado"
                            stroke={COLORS[1]}
                            strokeWidth={2}
                            strokeDasharray="4 4"
                            dot={false}
                            isAnimationActive={false}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <ChartEmpty />
                  )}
                </Panel>
                <Panel
                  title="De onde vem o resultado"
                  description="Do faturamento ao valor que fica na empresa."
                  className="mg-result-panel"
                >
                  <div className="mg-result-list">
                    {[
                      {
                        label: 'Faturamento bruto',
                        value: current.revenue,
                        previous: previous.revenue,
                        color: COLORS[0],
                      },
                      {
                        label: 'Custo dos prestadores',
                        value: -current.payrollCost,
                        previous: previous.payrollCost,
                        color: COLORS[2],
                      },
                      {
                        label: 'Despesas gerais',
                        value: -current.expenses,
                        previous: previous.expenses,
                        color: '#db8faa',
                      },
                    ].map((item, index) => (
                      <div key={item.label}>
                        <span>
                          <i style={{ background: item.color }} />
                          {item.label}
                          <Delta current={Math.abs(item.value)} previous={item.previous} reverse={index > 0} />
                        </span>
                        <strong>
                          {index > 0 && item.value === 0 ? '− ' : ''}
                          {formatCurrency(item.value)}
                        </strong>
                        <div className="mg-cost-track">
                          <i
                            style={{
                              width: `${Math.min(100, current.revenue > 0 ? (Math.abs(item.value) / current.revenue) * 100 : 0)}%`,
                              background: item.color,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className={`mg-result-total ${current.net < 0 ? 'negative' : ''}`}>
                    <span>
                      Resultado {partial ? 'parcial' : dashboard.scoped ? 'estimado' : 'do período'}
                      <small>Após os custos selecionados</small>
                    </span>
                    <strong>{formatCurrency(current.net)}</strong>
                  </div>
                  <p className="mg-card-footnote">
                    Prestadores incluem líquido da folha, adiantamentos e VA/VR. Taxas entram quando cadastradas em
                    despesas.
                  </p>
                  {dashboard.categories.length > 0 && (
                    <details className="mg-expense-categories">
                      <summary>
                        Ver despesas por categoria <ChevronDown size={13} />
                      </summary>
                      <div>
                        {dashboard.categories.map((category) => (
                          <p key={category.name}>
                            <span>{category.name}</span>
                            <strong>{formatCurrency(category.value)}</strong>
                          </p>
                        ))}
                      </div>
                    </details>
                  )}
                </Panel>
              </div>
              <div className="mg-grid-two">
                <Panel
                  title="Ritmo da operação"
                  description="Quantidade de serviços realizados mês a mês."
                  badge={<span className="mg-badge">VOLUME DE SERVIÇOS</span>}
                >
                  {dashboard.trend.some((t) => t.services) ? (
                    <div className="mg-chart mg-chart-short" role="img" aria-label="Quantidade de serviços por mês">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={dashboard.trend}
                          margin={{ top: 15, right: 8, left: -20, bottom: 5 }}
                          accessibilityLayer
                        >
                          <CartesianGrid vertical={false} stroke="#eeedf4" strokeDasharray="4 5" />
                          <XAxis dataKey="label" {...axis} dy={8} />
                          <YAxis {...axis} allowDecimals={false} />
                          <Tooltip
                            cursor={{ fill: '#f5f3ff' }}
                            contentStyle={tooltipStyle}
                            formatter={(value) => formatNumber(Number(value))}
                          />
                          <Bar
                            dataKey="services"
                            name="Serviços"
                            radius={[5, 5, 0, 0]}
                            maxBarSize={28}
                            isAnimationActive={false}
                          >
                            {dashboard.trend.map((row, index) => (
                              <Cell
                                key={row.month}
                                fill={filters.mode === 'annual' || index === 11 ? COLORS[0] : '#bddbc9'}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <ChartEmpty />
                  )}
                </Panel>
                <Panel
                  title="O que movimenta a empresa"
                  description="Participação dos tipos de serviço no faturamento."
                >
                  {dashboard.types.length ? (
                    <div className="mg-mix">
                      <div className="mg-donut" role="img" aria-label="Distribuição do faturamento por tipo de serviço">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={dashboard.types.filter((t) => t.revenue > 0)}
                              dataKey="revenue"
                              nameKey="name"
                              innerRadius="70%"
                              outerRadius="93%"
                              paddingAngle={3}
                              stroke="none"
                              isAnimationActive={false}
                            >
                              {dashboard.types
                                .filter((t) => t.revenue > 0)
                                .map((type, index) => (
                                  <Cell key={type.name} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatCurrency(Number(value))} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="mg-donut-label">
                          <strong>{dashboard.types.length}</strong>
                          <span>tipos de serviço</span>
                        </div>
                      </div>
                      <div className="mg-mix-legend">
                        {dashboard.types.map((type, index) => (
                          <div key={type.name}>
                            <i style={{ background: COLORS[index % COLORS.length] }} />
                            <span title={type.name}>
                              {type.name}
                              <small>{formatNumber(type.count)} serviços</small>
                            </span>
                            <strong>
                              {formatPercent(current.revenue ? (type.revenue / current.revenue) * 100 : 0)}
                              <small>{formatCurrency(type.revenue)}</small>
                            </strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <ChartEmpty />
                  )}
                </Panel>
              </div>
            </section>

            <section id="prestadores" className="mg-section">
              <div className="mg-section-heading">
                <div>
                  <span className="mg-section-number">02</span>
                  <h2>Quem faz a operação acontecer</h2>
                </div>
                <span className="mg-comparison">Performance e rentabilidade por prestador</span>
              </div>
              <Panel
                title="Performance dos prestadores"
                description="Produção, ticket e resultado em uma única visão."
                badge={<span className="mg-badge">{dashboard.technicians.length} PRESTADORES</span>}
              >
                <div className="mg-table-toolbar">
                  <label className="mg-search">
                    <Search size={15} />
                    <input
                      placeholder="Buscar nome ou QRA"
                      aria-label="Buscar no ranking"
                      value={rankingSearch}
                      onChange={(event) => {
                        setRankingSearch(event.target.value);
                        setPage(1);
                      }}
                    />
                  </label>
                  <label className="mg-sort">
                    Ordenar por
                    <select
                      aria-label="Ordenar prestadores"
                      value={rankingSort}
                      onChange={(event) => {
                        setRankingSort(event.target.value as typeof rankingSort);
                        setPage(1);
                      }}
                    >
                      <option value="revenue">Maior faturamento</option>
                      <option value="services">Mais serviços</option>
                      <option value="ticket">Maior ticket médio</option>
                      <option value="transfer">Maior repasse</option>
                      <option value="net">Maior resultado</option>
                      <option value="margin">Maior margem</option>
                    </select>
                  </label>
                </div>
                <div className="mg-table-scroll">
                  <table className="mg-table">
                    <thead>
                      <tr>
                        <th>Prestador</th>
                        <th>Serviços</th>
                        <th>Faturamento</th>
                        <th>Ticket médio</th>
                        <th>
                          Repasse em folha{' '}
                          <span title="Líquido + adiantamentos. Não inclui VA/VR. Folha fechada não comprova pagamento bancário.">
                            ⓘ
                          </span>
                        </th>
                        <th>
                          Custo total <span title="Folha com benefícios + rateio de despesas gerais.">ⓘ</span>
                        </th>
                        <th>Resultado estimado</th>
                        <th>Margem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.slice((currentPage - 1) * 10, currentPage * 10).map((t, index) => (
                        <tr key={t.id}>
                          <td>
                            <div className="mg-person">
                              <span className="mg-rank">{(currentPage - 1) * 10 + index + 1}</span>
                              <span
                                className="mg-avatar"
                                style={{
                                  background: `${COLORS[index % COLORS.length]}16`,
                                  color: COLORS[index % COLORS.length],
                                }}
                              >
                                {t.name
                                  .split(/\s+/)
                                  .slice(0, 2)
                                  .map((part) => part[0])
                                  .join('')}
                              </span>
                              <span>
                                <strong>{t.name}</strong>
                                <small>
                                  {t.qra || 'Sem QRA'}
                                  {t.status === 'inactive' ? ' · Inativo' : ''}
                                  {t.missingPayroll > 0 ? ' · Folha pendente' : t.draftPayroll > 0 ? ' · Rascunho' : ''}
                                </small>
                              </span>
                            </div>
                          </td>
                          <td>{formatNumber(t.services)}</td>
                          <td className="mg-cell-strong">{formatCurrency(t.revenue)}</td>
                          <td>{formatCurrency(t.ticket)}</td>
                          <td>{t.payrollCount ? formatCurrency(t.transfer) : '—'}</td>
                          <td>{formatCurrency(t.totalCosts)}</td>
                          <td className={t.net < 0 ? 'mg-negative' : 'mg-positive'}>
                            {formatCurrency(t.net)}
                            {t.missingPayroll > 0 && <small className="mg-partial-label">Parcial</small>}
                          </td>
                          <td>
                            <span className={`mg-margin ${t.margin < 0 ? 'negative' : ''}`}>
                              {formatPercent(t.margin)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!ranking.length && <ChartEmpty message="Nenhum prestador encontrado para esta busca." />}
                </div>
                <footer className="mg-table-footer">
                  <span>
                    {ranking.length
                      ? `${(currentPage - 1) * 10 + 1}–${Math.min(currentPage * 10, ranking.length)} de ${ranking.length}`
                      : '0'}{' '}
                    prestadores
                  </span>
                  <div>
                    <button className="mg-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                      Anterior
                    </button>
                    <span>
                      {currentPage} / {pageCount}
                    </span>
                    <button
                      className="mg-button"
                      disabled={currentPage === pageCount}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      Próxima
                    </button>
                  </div>
                </footer>
                <p className="mg-card-footnote">
                  Repasse previsto nas folhas selecionadas, incluindo adiantamentos. Despesas gerais rateadas pelo
                  faturamento de cada mês; meses sem receita não permitem atribuir essas despesas a um prestador.
                </p>
              </Panel>
            </section>

            <section id="operacao" className="mg-section">
              <div className="mg-section-heading">
                <div>
                  <span className="mg-section-number">03</span>
                  <h2>Tempo, presença e produtividade</h2>
                </div>
                <span className="mg-comparison">Período e equipe selecionados</span>
              </div>
              <div className="mg-operation-metrics">
                <article>
                  <span>Saldo acumulado de horas</span>
                  <strong>{formatHours(dashboard.accumulated)}</strong>
                  <small>Até o fim do período · histórico apontado</small>
                </article>
                <article>
                  <span>Créditos / débitos do período</span>
                  <strong className="mg-hours-pair">
                    <span>+{formatHours(current.credits)}</span>
                    <em> / </em>
                    <span>−{formatHours(current.debits)}</span>
                  </strong>
                  <small>Horas acima / abaixo da escala apontada</small>
                </article>
                <article>
                  <span>Faltas confirmadas</span>
                  <strong>
                    {current.missed}
                    <Delta current={current.missed} previous={previous.missed} reverse />
                  </strong>
                  <small>{current.justified} ausência(s) justificada(s)</small>
                </article>
                <article>
                  <span>Índice de ausências</span>
                  <strong>{formatPercent(current.absenceRate)}</strong>
                  <small>{current.observed} dia(s) com presença ou ausência apurada</small>
                </article>
              </div>
              <div className="mg-grid-two">
                <Panel
                  title="Evolução do banco de horas"
                  description="Movimentação à esquerda; saldo acumulado no eixo à direita."
                >
                  <Legend
                    items={[
                      { color: COLORS[1], label: 'Créditos' },
                      { color: COLORS[2], label: 'Débitos' },
                      { color: COLORS[0], label: 'Acumulado' },
                    ]}
                  />
                  {dashboard.trend.some((t) => t.worked || t.planned || t.accumulated) ? (
                    <div
                      className="mg-chart mg-chart-short"
                      role="img"
                      aria-label="Créditos, débitos e saldo acumulado mensal de horas"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={dashboard.trend.map((t) => ({ ...t, negativeDebits: -t.debits }))}
                          margin={{ top: 10, right: 0, left: -5, bottom: 5 }}
                          accessibilityLayer
                        >
                          <CartesianGrid vertical={false} stroke="#eeedf4" strokeDasharray="4 5" />
                          <XAxis {...axis} dataKey="label" dy={8} />
                          <YAxis {...axis} width={45} tickFormatter={(value) => `${value}h`} />
                          <YAxis
                            {...axis}
                            yAxisId="balance"
                            orientation="right"
                            width={52}
                            tickFormatter={(value) => `${value}h`}
                          />
                          <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatHours(Number(value))} />
                          <ReferenceLine y={0} stroke="#cedbd2" />
                          <Bar
                            dataKey="credits"
                            name="Créditos"
                            fill={COLORS[1]}
                            radius={[3, 3, 0, 0]}
                            maxBarSize={14}
                            isAnimationActive={false}
                          />
                          <Bar
                            dataKey="negativeDebits"
                            name="Débitos"
                            fill={COLORS[2]}
                            radius={[0, 0, 3, 3]}
                            maxBarSize={14}
                            isAnimationActive={false}
                          />
                          <Line
                            dataKey="accumulated"
                            yAxisId="balance"
                            name="Saldo acumulado"
                            stroke={COLORS[0]}
                            strokeWidth={2.5}
                            dot={false}
                            isAnimationActive={false}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <ChartEmpty message="Sem horas ou escalas apontadas neste recorte." />
                  )}
                  <p className="mg-card-footnote">
                    Considera a jornada registrada e a pausa diária definida em Configurações. Débitos indicam horas abaixo do
                    previsto; o sistema não possui registro separado de compensações utilizadas.
                  </p>
                </Panel>
                <Panel
                  title="Presença e disponibilidade"
                  description="Ausências confirmadas e apontamentos que precisam de atenção."
                >
                  <Legend
                    items={[
                      { color: '#d77b91', label: 'Faltas' },
                      { color: COLORS[2], label: 'Justificadas' },
                      { color: '#a9beb1', label: 'Sem apontamento' },
                    ]}
                  />
                  {dashboard.trend.some((t) => t.observed || t.pending || t.daysOff) ? (
                    <div
                      className="mg-chart mg-chart-short"
                      role="img"
                      aria-label="Faltas, ausências justificadas e dias sem apontamento por mês"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={dashboard.trend}
                          margin={{ top: 10, right: 0, left: -20, bottom: 5 }}
                          accessibilityLayer
                        >
                          <CartesianGrid vertical={false} stroke="#eeedf4" strokeDasharray="4 5" />
                          <XAxis {...axis} dataKey="label" dy={8} />
                          <YAxis {...axis} allowDecimals={false} />
                          <Tooltip
                            cursor={{ fill: '#f5f3ff' }}
                            contentStyle={tooltipStyle}
                            formatter={(value) => `${formatNumber(Number(value))} dia(s)`}
                          />
                          <Bar
                            dataKey="missed"
                            name="Faltas confirmadas"
                            stackId="days"
                            fill="#d77b91"
                            maxBarSize={24}
                            isAnimationActive={false}
                          />
                          <Bar
                            dataKey="justified"
                            name="Ausências justificadas"
                            stackId="days"
                            fill={COLORS[2]}
                            maxBarSize={24}
                            isAnimationActive={false}
                          />
                          <Bar
                            dataKey="pending"
                            name="Sem apontamento"
                            stackId="days"
                            fill="#a9beb1"
                            radius={[3, 3, 0, 0]}
                            maxBarSize={24}
                            isAnimationActive={false}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <ChartEmpty message="Sem apontamentos de presença neste recorte." />
                  )}
                  <p className="mg-card-footnote">
                    {current.daysOff} folga(s) fora do índice de ausências. {current.pending} dia(s) passado(s) sem
                    apontamento para revisar. Dias futuros não entram nos cálculos.
                  </p>
                </Panel>
              </div>
            </section>

            <details className="mg-methodology">
              <summary>
                <CircleHelp size={16} />
                <span>Como os indicadores são calculados</span>
                <ChevronDown size={15} />
              </summary>
              <div className="mg-methodology-grid">
                <div>
                  <h4>Financeiro</h4>
                  <p>
                    Faturamento = soma dos serviços por competência. Ticket = faturamento ÷ serviços. Resultado =
                    faturamento − folha − despesas selecionadas. Contas a receber não são adicionadas ao faturamento
                    para evitar contar a mesma receita duas vezes.
                  </p>
                  <p>
                    Custo da folha = líquido + adiantamentos + VA/VR. Não cadastre o mesmo custo da folha também como
                    despesa geral. Pagamentos parciais usam o valor baixado; o restante compõe o saldo em aberto, sempre
                    na competência original.
                  </p>
                </div>
                <div>
                  <h4>Comparações e recortes</h4>
                  <p>
                    O modo mensal compara com o mês anterior; o anual, com o ano anterior completo. Períodos em
                    andamento são parciais e comparados ao período anterior inteiro. Sem valor anterior, a variação
                    aparece como “Sem base anterior”.
                  </p>
                  <p>
                    Técnicos inativos fazem parte do histórico. Despesas gerais são rateadas mensalmente pela
                    participação na receita; o filtro de serviço rateia a folha pela produção de cada prestador.
                    Resultados individuais são estimativas.
                  </p>
                </div>
                <div>
                  <h4>Horas e ausências</h4>
                  <p>
                    Créditos e débitos comparam horas realizadas com a escala apontada. O acumulado inclui o histórico
                    anterior ao período. Horas sem jornada prevista não geram créditos automáticos. O saldo operacional
                    pode diferir do saldo salvo em folha.
                  </p>
                  <p>
                    Faltas e justificativas usam os apontamentos explícitos da escala. Folgas, cancelamentos sem
                    apontamento e datas futuras não são faltas. Índice = faltas + justificativas ÷ dias com presença ou
                    ausência apurada. Pendências ficam fora desse índice.
                  </p>
                </div>
              </div>
            </details>
            <footer className="mg-footer">
              <span>
                <span className="mg-footer-mark">
                  <ChartNoAxesCombined size={15} />
                </span>
                NextRotta <i>/</i> Inteligência gerencial
              </span>
              <span>Dados reais do sistema · atualização automática a cada minuto</span>
            </footer>
          </div>
        )}
      </div>
    </AppShell>
  );
}
