'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  CircleHelp,
  Clock3,
  Download,
  Layers3,
  LoaderCircle,
  RefreshCw,
  Search,
  Users,
  Wallet,
} from 'lucide-react';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AppShell } from '@/components/app-shell';
import { ChartEmpty, Delta, Legend, Metric, Panel, chartAxis, chartTooltipStyle, compactCurrency } from '@/components/management-ui';
import { useAppSession } from '@/hooks/use-app-session';
import { BILLING_MONTH_NAMES, buildBillingReport, type BillingFilters } from '@/lib/billing-report';
import { CHART_COLORS as COLORS } from '@/lib/chart-theme';
import { brasiliaDateKey, formatCurrency, formatNumber, formatPercent, normalizeText } from '@/lib/formatters';
import type { Payroll, Service, Technician } from '@/lib/types';
import '../dashboard-gerencial/management-dashboard.css';

type SortKey = 'revenue' | 'services' | 'ticket' | 'net' | 'margin';

const PAGE_SIZE = 10;

export default function AdminFaturamentoPage() {
  const { user, loading } = useAppSession();
  const today = brasiliaDateKey();
  const [services, setServices] = useState<Service[]>([]);
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [dataError, setDataError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [filters, setFilters] = useState<BillingFilters>({
    mode: 'monthly',
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
    technicianId: 'all',
  });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('revenue');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const update = <K extends keyof BillingFilters>(key: K, value: BillingFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const load = useCallback(async () => {
    setIsLoading(true);
    setDataError('');

    const [servicesResult, payrollResult, techniciansResult] = await Promise.allSettled([
      fetch('/api/services', { cache: 'no-store' }),
      fetch('/api/payroll', { cache: 'no-store' }),
      fetch('/api/technicians', { cache: 'no-store' }),
    ]);
    const errors: string[] = [];

    async function read<T>(result: PromiseSettledResult<Response>, key: string, label: string): Promise<T[]> {
      if (result.status === 'fulfilled' && result.value.ok) {
        const data = await result.value.json();
        return Array.isArray(data[key]) ? data[key] : [];
      }
      errors.push(label);
      return [];
    }

    setServices(await read<Service>(servicesResult, 'services', 'serviços'));
    setPayroll(await read<Payroll>(payrollResult, 'payrolls', 'folha'));
    setTechnicians(await read<Technician>(techniciansResult, 'technicians', 'técnicos'));
    setDataError(errors.length ? `Não foi possível carregar os dados de ${errors.join(', ')}.` : '');
    setUpdatedAt(new Date());
    setIsLoading(false);
    setHasLoaded(true);
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const years = useMemo(() => {
    const values = new Set<number>([Number(today.slice(0, 4)), filters.year]);
    services.forEach((service) => {
      const competence = service.competence_month || String(service.date_performed ?? '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(competence)) values.add(Number(competence.slice(0, 4)));
    });
    payroll.forEach((item) => /^\d{4}-\d{2}$/.test(item.competence_month) && values.add(Number(item.competence_month.slice(0, 4))));
    return [...values].sort((left, right) => right - left);
  }, [filters.year, payroll, services, today]);

  const technicianOptions = useMemo(
    () => technicians.filter((technician) => technician.status === 'active').sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
    [technicians],
  );

  // A technician who is no longer active leaves the filter.
  useEffect(() => {
    if (filters.technicianId !== 'all' && !technicianOptions.some((technician) => technician.id === filters.technicianId)) {
      setFilters((current) => ({ ...current, technicianId: 'all' }));
    }
  }, [filters.technicianId, technicianOptions]);

  const report = useMemo(() => buildBillingReport({ services, payroll, technicians }, filters), [filters, payroll, services, technicians]);
  const { current, previous } = report;
  const partial = current.missingPayroll + current.draftPayroll > 0;
  const periodInProgress =
    filters.year === Number(today.slice(0, 4)) && (filters.mode === 'annual' || filters.month === Number(today.slice(5, 7)));
  const payrollShare = current.revenue > 0 ? (current.payrollCost / current.revenue) * 100 : 0;
  const selectedTechnician = technicianOptions.find((technician) => technician.id === filters.technicianId);

  const ranking = report.technicians
    .filter((row) => normalizeText(`${row.name} ${row.qra}`).includes(normalizeText(search)))
    .sort((left, right) => right[sort] - left[sort] || left.name.localeCompare(right.name, 'pt-BR'));
  const pageCount = Math.max(1, Math.ceil(ranking.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);

  // The donut shows the six biggest types and gathers the rest, so the legend stays short.
  const donutTypes = useMemo(() => {
    const top = report.types.slice(0, 6);
    const rest = report.types.slice(6);
    return rest.length
      ? [...top, { name: 'Outros', revenue: rest.reduce((total, type) => total + type.revenue, 0), count: rest.reduce((total, type) => total + type.count, 0) }]
      : top;
  }, [report.types]);

  async function exportWorkbook() {
    setExporting(true);
    setExportError('');
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();
      const addSheet = (name: string, rows: Record<string, string | number>[]) => {
        const sheet = XLSX.utils.json_to_sheet(rows);
        sheet['!cols'] = Array.from({ length: 10 }, () => ({ wch: 22 }));
        XLSX.utils.book_append_sheet(workbook, sheet, name);
      };
      addSheet('Resumo', [
        {
          Período: report.periodLabel,
          Técnico: selectedTechnician?.name ?? 'Todos',
          Faturamento: current.revenue,
          'Custo da folha': current.payrollCost,
          Resultado: current.net,
          'Margem (%)': current.margin,
          Serviços: current.services,
          'Ticket médio': current.ticket,
          'Folhas pendentes': current.missingPayroll + current.draftPayroll,
        },
      ]);
      addSheet(
        'Evolução',
        report.trend.map((point) => ({ Mês: point.label, Faturamento: point.revenue, 'Custo da folha': point.cost, Resultado: point.net, Serviços: point.services })),
      );
      addSheet(
        'Tipos de serviço',
        report.types.map((type) => ({ Tipo: type.name, Serviços: type.count, Faturamento: type.revenue })),
      );
      addSheet(
        'Técnicos',
        report.technicians.map((row) => ({
          Técnico: row.name,
          QRA: row.qra,
          Serviços: row.services,
          Faturamento: row.revenue,
          'Ticket médio': row.ticket,
          'Custo da folha': row.payrollCost,
          Resultado: row.net,
          'Margem (%)': row.margin,
        })),
      );
      XLSX.writeFile(workbook, `faturamento-${filters.year}${filters.mode === 'monthly' ? `-${String(filters.month).padStart(2, '0')}` : ''}.xlsx`);
    } catch {
      setExportError('Não foi possível exportar a planilha. Tente novamente.');
    } finally {
      setExporting(false);
    }
  }

  if (loading || !user || !hasLoaded) {
    return (
      <AppShell role="admin" userName={user?.name || user?.email}>
        <div className="mg-dashboard">
          <div className="mg-loading" role="status">
            <LoaderCircle className="mg-spin" size={25} />
            <strong>Somando o faturamento</strong>
            <span>Serviços, folha e técnicos.</span>
          </div>
        </div>
      </AppShell>
    );
  }

  const hasData = services.length > 0 || payroll.length > 0;

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <div className="mg-dashboard">
        <header className="mg-page-heading">
          <div>
            <div className="mg-eyebrow">
              <span /> RELATÓRIO FINANCEIRO <span className="mg-eyebrow-divider">/</span> NEXTROTTA
            </div>
            <h1>
              Faturamento<span>.</span>
            </h1>
            <p>Quanto os serviços faturaram, quanto custou a folha e o que sobrou.</p>
          </div>
          <div className="mg-header-actions">
            <button className="mg-button mg-button-dark" onClick={exportWorkbook} disabled={exporting || !hasData}>
              {exporting ? <LoaderCircle className="mg-spin" size={15} /> : <Download size={15} />}
              {exporting ? 'Exportando...' : 'Exportar relatório'}
            </button>
          </div>
        </header>

        <section className="mg-filter-bar" aria-label="Filtros do faturamento">
          <div className="mg-period-toggle" aria-label="Visualização">
            <button aria-pressed={filters.mode === 'monthly'} className={filters.mode === 'monthly' ? 'selected' : ''} onClick={() => update('mode', 'monthly')}>
              Mensal
            </button>
            <button aria-pressed={filters.mode === 'annual'} className={filters.mode === 'annual' ? 'selected' : ''} onClick={() => update('mode', 'annual')}>
              Anual
            </button>
          </div>
          <div className="mg-period-inputs">
            <CalendarDays size={16} />
            {filters.mode === 'monthly' && (
              <select aria-label="Mês" value={filters.month} onChange={(event) => update('month', Number(event.target.value))}>
                {BILLING_MONTH_NAMES.map((month, index) => (
                  <option key={month} value={index + 1}>
                    {month}
                  </option>
                ))}
              </select>
            )}
            <select aria-label="Ano" value={filters.year} onChange={(event) => update('year', Number(event.target.value))}>
              {years.map((year) => (
                <option key={year}>{year}</option>
              ))}
            </select>
          </div>
          <div className="mg-period-inputs">
            <Users size={16} />
            <select aria-label="Técnico" value={filters.technicianId} onChange={(event) => update('technicianId', event.target.value)}>
              <option value="all">Todos os técnicos</option>
              {technicianOptions.map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.name}
                </option>
              ))}
            </select>
          </div>
          <div className="mg-filter-spacer" />
          <span className="mg-update">
            <span className={isLoading ? 'updating' : ''} />
            {isLoading ? 'Atualizando...' : updatedAt ? `Atualizado às ${updatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </span>
          <button className="mg-button mg-button-icon" aria-label="Atualizar" title="Atualizar" disabled={isLoading} onClick={() => void load()}>
            <RefreshCw size={15} className={isLoading ? 'mg-spin' : ''} />
          </button>
        </section>

        {exportError && (
          <div className="mg-notice" role="alert">
            {exportError}
          </div>
        )}
        {dataError && (
          <div className="mg-error" role="alert">
            <CircleHelp size={23} />
            <div>
              <strong>Alguns dados não carregaram</strong>
              <p>{dataError}</p>
            </div>
            <button className="mg-button" onClick={() => void load()}>
              Tentar novamente
            </button>
          </div>
        )}

        <div aria-busy={isLoading}>
          <section id="resultado" className="mg-section">
            <div className="mg-section-heading">
              <div>
                <span className="mg-section-number">01</span>
                <h2>Um olhar para o resultado</h2>
              </div>
              <span className="mg-comparison">
                {report.periodLabel} · comparado com {report.comparisonLabel}
                {periodInProgress ? ' · período em andamento' : ''}
              </span>
            </div>

            {partial && (
              <div className="mg-notice">
                <CircleHelp size={16} />
                <span>
                  {current.missingPayroll + current.draftPayroll} competência(s) de técnico com serviços ainda sem folha fechada. O resultado está parcial: só
                  folhas fechadas entram no custo.
                </span>
                <Link href="/admin/payroll">
                  Revisar folhas <ArrowRight size={13} />
                </Link>
              </div>
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
                title={`Resultado${partial ? ' · parcial' : ''}`}
                value={formatCurrency(current.net)}
                hint={`${formatPercent(current.margin)} de margem`}
                icon={ArrowUpRight}
                current={current.net}
                previous={previous.net}
                dark
              />
              <Metric
                title="Ticket médio"
                value={formatCurrency(current.ticket)}
                hint="Faturamento por serviço"
                icon={Layers3}
                current={current.ticket}
                previous={previous.ticket}
              />
              <Metric
                title="Custo da folha"
                value={formatCurrency(current.payrollCost)}
                hint={`${formatNumber(current.payrollCount)} folha(s) fechada(s)`}
                icon={ArrowDownLeft}
                current={current.payrollCost}
                previous={previous.payrollCost}
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
                  <small>Técnicos com produção</small>
                  <strong>
                    {current.producers}
                    <em>de {report.activeTechnicians} ativos</em>
                  </strong>
                </span>
              </div>
              <div>
                <span className="mg-strip-icon">
                  <Clock3 size={19} />
                </span>
                <span>
                  <small>Folha sobre o faturamento</small>
                  <strong>
                    {formatPercent(payrollShare)}
                    <em>do que entrou vira custo</em>
                  </strong>
                </span>
              </div>
            </div>

            <div className="mg-grid-finance">
              <Panel
                title="A evolução do seu resultado"
                description={filters.mode === 'annual' ? 'Faturamento, custo e resultado ao longo do ano.' : 'Últimos 12 meses, encerrando no mês selecionado.'}
                badge={<span className="mg-badge">POR COMPETÊNCIA</span>}
              >
                <Legend
                  items={[
                    { color: COLORS[0], label: 'Faturamento' },
                    { color: COLORS[2], label: 'Custo da folha' },
                    { color: COLORS[1], label: 'Resultado' },
                  ]}
                />
                {report.trend.some((point) => point.revenue || point.cost) ? (
                  <div className="mg-chart" role="img" aria-label="Evolução mensal do faturamento, do custo da folha e do resultado.">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={report.trend} margin={{ top: 12, right: 8, left: 0, bottom: 5 }} accessibilityLayer>
                        <defs>
                          <linearGradient id="fat-revenue-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={COLORS[0]} stopOpacity={0.17} />
                            <stop offset="100%" stopColor={COLORS[0]} stopOpacity={0.01} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#eeedf4" strokeDasharray="4 5" vertical={false} />
                        <XAxis dataKey="label" {...chartAxis} dy={8} />
                        <YAxis {...chartAxis} tickFormatter={compactCurrency} width={70} />
                        <Tooltip contentStyle={chartTooltipStyle} formatter={(value) => formatCurrency(Number(value))} />
                        <ReferenceLine y={0} stroke="#cedbd2" />
                        <Area type="monotone" dataKey="revenue" name="Faturamento" stroke={COLORS[0]} strokeWidth={2.5} fill="url(#fat-revenue-fill)" isAnimationActive={false} />
                        <Line type="monotone" dataKey="cost" name="Custo da folha" stroke={COLORS[2]} strokeWidth={2} dot={false} isAnimationActive={false} />
                        <Line type="monotone" dataKey="net" name="Resultado" stroke={COLORS[1]} strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <ChartEmpty />
                )}
              </Panel>

              <Panel title="De onde vem o resultado" description="Do faturamento ao valor que fica na empresa." className="mg-result-panel">
                <div className="mg-result-list">
                  {[
                    { label: 'Faturamento bruto', value: current.revenue, previous: previous.revenue, color: COLORS[0] },
                    { label: 'Custo da folha', value: -current.payrollCost, previous: previous.payrollCost, color: COLORS[2] },
                  ].map((item, index) => (
                    <div key={item.label}>
                      <span>
                        <i style={{ background: item.color }} />
                        {item.label}
                        <Delta current={Math.abs(item.value)} previous={item.previous} reverse={index > 0} />
                      </span>
                      <strong>{formatCurrency(item.value)}</strong>
                      <div className="mg-cost-track">
                        <i style={{ width: `${Math.min(100, current.revenue > 0 ? (Math.abs(item.value) / current.revenue) * 100 : 0)}%`, background: item.color }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className={`mg-result-total ${current.net < 0 ? 'negative' : ''}`}>
                  <span>
                    Resultado {partial ? 'parcial' : 'do período'}
                    <small>Faturamento menos o custo da folha</small>
                  </span>
                  <strong>{formatCurrency(current.net)}</strong>
                </div>
                <p className="mg-card-footnote">
                  O custo da folha soma o líquido, os adiantamentos e o VA/VR das folhas fechadas. Despesas gerais não entram aqui: elas estão no Dashboard
                  Gerencial.
                </p>
              </Panel>
            </div>

            <div className="mg-grid-two">
              <Panel
                title="Ritmo da operação"
                description="Quantidade de serviços realizados mês a mês."
                badge={<span className="mg-badge">VOLUME DE SERVIÇOS</span>}
              >
                {report.trend.some((point) => point.services) ? (
                  <div className="mg-chart mg-chart-short" role="img" aria-label="Quantidade de serviços por mês">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={report.trend} margin={{ top: 15, right: 8, left: -20, bottom: 5 }} accessibilityLayer>
                        <CartesianGrid vertical={false} stroke="#eeedf4" strokeDasharray="4 5" />
                        <XAxis dataKey="label" {...chartAxis} dy={8} />
                        <YAxis {...chartAxis} allowDecimals={false} />
                        <Tooltip cursor={{ fill: '#f5f3ff' }} contentStyle={chartTooltipStyle} formatter={(value) => formatNumber(Number(value))} />
                        <Bar dataKey="services" name="Serviços" radius={[5, 5, 0, 0]} maxBarSize={28} isAnimationActive={false}>
                          {report.trend.map((point, index) => (
                            <Cell key={point.key} fill={filters.mode === 'annual' || index === 11 ? COLORS[0] : '#bddbc9'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <ChartEmpty />
                )}
              </Panel>

              <Panel title="O que movimenta a empresa" description="Participação dos tipos de serviço no faturamento.">
                {donutTypes.length ? (
                  <div className="mg-mix">
                    <div className="mg-donut" role="img" aria-label="Distribuição do faturamento por tipo de serviço">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={donutTypes.filter((type) => type.revenue > 0)} dataKey="revenue" nameKey="name" innerRadius="70%" outerRadius="93%" paddingAngle={3} stroke="none" isAnimationActive={false}>
                            {donutTypes
                              .filter((type) => type.revenue > 0)
                              .map((type, index) => (
                                <Cell key={type.name} fill={COLORS[index % COLORS.length]} />
                              ))}
                          </Pie>
                          <Tooltip contentStyle={chartTooltipStyle} formatter={(value) => formatCurrency(Number(value))} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="mg-donut-label">
                        <strong>{report.types.length}</strong>
                        <span>tipos de serviço</span>
                      </div>
                    </div>
                    <div className="mg-mix-legend">
                      {donutTypes.map((type, index) => (
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

          {filters.technicianId === 'all' && (
            <section id="tecnicos" className="mg-section">
              <div className="mg-section-heading">
                <div>
                  <span className="mg-section-number">02</span>
                  <h2>Quem faz a operação acontecer</h2>
                </div>
                <span className="mg-comparison">Faturamento, custo e resultado por técnico</span>
              </div>
              <Panel
                title="Resultado por técnico"
                description="Produção, ticket e o que sobrou depois da folha de cada um."
                badge={<span className="mg-badge">{report.technicians.length} TÉCNICOS</span>}
              >
                <div className="mg-table-toolbar">
                  <label className="mg-search">
                    <Search size={15} />
                    <input
                      placeholder="Buscar nome ou QRA"
                      aria-label="Buscar técnico"
                      value={search}
                      onChange={(event) => {
                        setSearch(event.target.value);
                        setPage(1);
                      }}
                    />
                  </label>
                  <label className="mg-sort">
                    Ordenar por
                    <select
                      aria-label="Ordenar técnicos"
                      value={sort}
                      onChange={(event) => {
                        setSort(event.target.value as SortKey);
                        setPage(1);
                      }}
                    >
                      <option value="revenue">Maior faturamento</option>
                      <option value="services">Mais serviços</option>
                      <option value="ticket">Maior ticket médio</option>
                      <option value="net">Maior resultado</option>
                      <option value="margin">Maior margem</option>
                    </select>
                  </label>
                </div>
                <div className="mg-table-scroll">
                  <table className="mg-table">
                    <thead>
                      <tr>
                        <th>Técnico</th>
                        <th>Serviços</th>
                        <th>Faturamento</th>
                        <th>Ticket médio</th>
                        <th>Custo da folha</th>
                        <th>Resultado</th>
                        <th>Margem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map((row, index) => (
                        <tr key={row.id}>
                          <td>
                            <div className="mg-person">
                              <span className="mg-rank">{(currentPage - 1) * PAGE_SIZE + index + 1}</span>
                              <span className="mg-avatar" style={{ background: `${COLORS[index % COLORS.length]}16`, color: COLORS[index % COLORS.length] }}>
                                {row.name
                                  .split(/\s+/)
                                  .slice(0, 2)
                                  .map((part) => part[0])
                                  .join('')}
                              </span>
                              <span>
                                <strong>{row.name}</strong>
                                <small>
                                  {row.qra || 'Sem QRA'}
                                  {row.missingPayroll > 0 ? ' · Folha pendente' : row.draftPayroll > 0 ? ' · Rascunho' : ''}
                                </small>
                              </span>
                            </div>
                          </td>
                          <td>{formatNumber(row.services)}</td>
                          <td className="mg-cell-strong">{formatCurrency(row.revenue)}</td>
                          <td>{formatCurrency(row.ticket)}</td>
                          <td>{row.payrollCost ? formatCurrency(row.payrollCost) : '—'}</td>
                          <td className={row.net < 0 ? 'mg-negative' : 'mg-positive'}>
                            {formatCurrency(row.net)}
                            {row.missingPayroll + row.draftPayroll > 0 && <small className="mg-partial-label">Parcial</small>}
                          </td>
                          <td>
                            <span className={`mg-margin ${row.margin < 0 ? 'negative' : ''}`}>{formatPercent(row.margin)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!ranking.length && <ChartEmpty message="Nenhum técnico encontrado neste recorte." />}
                </div>
                <footer className="mg-table-footer">
                  <span>
                    {ranking.length ? `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, ranking.length)} de ${ranking.length}` : '0'} técnicos
                  </span>
                  <div>
                    <button className="mg-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                      Anterior
                    </button>
                    <span>
                      {currentPage} / {pageCount}
                    </span>
                    <button className="mg-button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>
                      Próxima
                    </button>
                  </div>
                </footer>
                <p className="mg-card-footnote">Técnico com serviços e sem folha fechada aparece como parcial: o custo dele ainda não entrou na conta.</p>
              </Panel>
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
}
