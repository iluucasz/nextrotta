'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Calculator, CheckCircle2, CreditCard, FileText, RefreshCw, Search, WalletCards } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { LoadingShell } from '@/components/page-skeleton';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { brasiliaDateKey, formatCurrency, normalizeText, resolveCompetenceMonth } from '@/lib/formatters';
import type { Discount, Payroll, Service, ServiceFortnight, Technician } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';
import { useOrganizationSettings } from '@/hooks/use-organization-settings';
import { calculateServiceAward, valueOrDefault, type OrganizationSettings } from '@/lib/organization-settings';

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

type PayrollDraft = {
  technician_id: string;
  competence_month: string;
  total_services_value: number;
  commission_value: number;
  base_salary: number;
  va_deduction: number;
  vr_deduction: number;
  discounts_total: number;
  advances_total: number;
  extra_hours_value: number;
  extraordinary_award_value: number;
  hour_bank_balance: number;
  net_total: number;
};

type PayrollDraftField = keyof PayrollDraft;

type PayrollRow = {
  technician: Technician;
  payrollItem?: Payroll;
  hasMonthlyActivity: boolean;
  hasMonthlyObligation: boolean;
  serviceCount: number;
  totalServicesValue: number;
  profitValue: number;
  serviceFortnightSummary: ServiceFortnightSummary;
  commissionPercentage: number;
  calculationBase: number;
  baseSalary: number;
  vaAllowance: number;
  vrAllowance: number;
  benefitsTotal: number;
  commission: number;
  discountsTotal: number;
  advancesTotal: number;
  totalDeductions: number;
  extraHoursValue: number;
  extraordinaryAward: number;
  cashNetTotal: number;
  payrollNetTotal: number;
};

type ServiceFortnightBucket = {
  count: number;
  totalValue: number;
};

type ServiceFortnightSummary = {
  Q1: ServiceFortnightBucket;
  Q2: ServiceFortnightBucket;
  unassigned: ServiceFortnightBucket;
};

const commissionFormulaFields: PayrollDraftField[] = [
  'total_services_value',
  'base_salary',
  'vr_deduction',
  'va_deduction',
];

function moneyValue(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function roundMoney(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) return 0;

  return Math.round((numericValue + Number.EPSILON) * 100) / 100;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoneyInputValue(value: number) {
  return String(roundMoney(value));
}

function parseMoneyInputValue(value: string, fallbackValue: number) {
  if (!value.trim()) {
    return 0;
  }

  const normalizedValue = value.replace(',', '.');
  const numericValue = Number(normalizedValue);

  if (!Number.isFinite(numericValue)) {
    return roundMoney(fallbackValue);
  }

  return roundMoney(numericValue);
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
  return resolveCompetenceMonth(service.competence_month, service.date_performed);
}

function createServiceFortnightBucket(): ServiceFortnightBucket {
  return {
    count: 0,
    totalValue: 0,
  };
}

function createServiceFortnightSummary(services: Service[]): ServiceFortnightSummary {
  const summary: ServiceFortnightSummary = {
    Q1: createServiceFortnightBucket(),
    Q2: createServiceFortnightBucket(),
    unassigned: createServiceFortnightBucket(),
  };

  services.forEach((service) => {
    const bucket = service.fortnight_period === 'Q1' || service.fortnight_period === 'Q2'
      ? summary[service.fortnight_period as ServiceFortnight]
      : summary.unassigned;

    bucket.count += 1;
    bucket.totalValue = roundMoney(bucket.totalValue + moneyValue(service.value));
  });

  return summary;
}

function formatServiceFortnightCountSummary(summary: ServiceFortnightSummary) {
  const parts: string[] = [];

  if (summary.Q1.count > 0) parts.push(`Q1 ${summary.Q1.count}`);
  if (summary.Q2.count > 0) parts.push(`Q2 ${summary.Q2.count}`);
  if (summary.unassigned.count > 0) parts.push(`Sem quinzena ${summary.unassigned.count}`);

  return parts.join(' | ') || 'Sem OS';
}

function formatServiceFortnightValueSummary(summary: ServiceFortnightSummary) {
  const parts: string[] = [];

  if (summary.Q1.totalValue > 0) parts.push(`Q1 ${formatCurrency(summary.Q1.totalValue)}`);
  if (summary.Q2.totalValue > 0) parts.push(`Q2 ${formatCurrency(summary.Q2.totalValue)}`);
  if (summary.unassigned.totalValue > 0) parts.push(`Sem quinzena ${formatCurrency(summary.unassigned.totalValue)}`);

  return parts.join(' | ') || 'Sem valor';
}

function serviceBelongsToTechnician(service: Service, technician: Technician) {
  if (service.technician_id === technician.id) return true;

  const serviceTechnicianName = normalizeText(service.technician_name);
  return Boolean(serviceTechnicianName && serviceTechnicianName === normalizeText(technician.name));
}


function calculateCalculationBase(totalServicesValue: number, commissionPercentage: number) {
  return roundMoney(Math.max(0, totalServicesValue) * (commissionPercentage / 100));
}

function calculateCommissionRemainder(
  calculationBase: number,
  baseSalary: number,
  vrAllowance: number,
  vaAllowance: number,
) {
  return roundMoney(
    Math.max(
      0,
      moneyValue(calculationBase) -
        moneyValue(baseSalary) -
        moneyValue(vrAllowance) -
        moneyValue(vaAllowance),
    ),
  );
}

function convertCalculationBaseToTotalServices(calculationBase: number, commissionPercentage: number) {
  if (commissionPercentage <= 0) {
    return roundMoney(calculationBase);
  }

  return roundMoney((Math.max(0, calculationBase) * 100) / commissionPercentage);
}

function calculateFormulaCommission(draft: PayrollDraft, commissionPercentage: number) {
  return calculateCommissionRemainder(
    calculateCalculationBase(moneyValue(draft.total_services_value), commissionPercentage),
    moneyValue(draft.base_salary),
    moneyValue(draft.vr_deduction),
    moneyValue(draft.va_deduction),
  );
}

function calculateCashNet(draft: PayrollDraft) {
  return roundMoney(
    moneyValue(draft.base_salary) +
      moneyValue(draft.commission_value) +
      moneyValue(draft.extra_hours_value) +
      moneyValue(draft.extraordinary_award_value) -
      moneyValue(draft.discounts_total) -
      moneyValue(draft.advances_total),
  );
}

function calculateBenefitTotal(draft: PayrollDraft) {
  return roundMoney(moneyValue(draft.va_deduction) + moneyValue(draft.vr_deduction));
}

function calculatePayrollNet(draft: PayrollDraft) {
  return roundMoney(moneyValue(draft.net_total) + calculateBenefitTotal(draft));
}

function normalizeDraft(payroll: Partial<PayrollDraft>): PayrollDraft {
  const draft: PayrollDraft = {
    technician_id: payroll.technician_id || '',
    competence_month: payroll.competence_month || '',
    total_services_value: roundMoney(payroll.total_services_value),
    commission_value: roundMoney(payroll.commission_value),
    base_salary: roundMoney(payroll.base_salary),
    va_deduction: roundMoney(payroll.va_deduction),
    vr_deduction: roundMoney(payroll.vr_deduction),
    discounts_total: roundMoney(payroll.discounts_total),
    advances_total: roundMoney(payroll.advances_total),
    extra_hours_value: roundMoney(payroll.extra_hours_value),
    extraordinary_award_value: roundMoney(payroll.extraordinary_award_value),
    hour_bank_balance: roundMoney(payroll.hour_bank_balance),
    net_total: roundMoney(payroll.net_total),
  };

  return {
    ...draft,
    net_total: payroll.net_total === undefined || payroll.net_total === null ? calculateCashNet(draft) : roundMoney(payroll.net_total),
  };
}

function createDraftFromRow(row: PayrollRow, competenceMonth: string) {
  return normalizeDraft({
    technician_id: row.technician.id,
    competence_month: competenceMonth,
    total_services_value: row.totalServicesValue,
    commission_value: row.commission,
    base_salary: row.baseSalary,
    va_deduction: row.vaAllowance,
    vr_deduction: row.vrAllowance,
    discounts_total: row.discountsTotal,
    advances_total: row.advancesTotal,
    extra_hours_value: row.extraHoursValue,
    extraordinary_award_value: row.extraordinaryAward,
    hour_bank_balance: 0,
    net_total: row.cashNetTotal,
  });
}

function MoneyInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
}) {
  const [draftValue, setDraftValue] = useState(() => formatMoneyInputValue(value));
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setDraftValue(formatMoneyInputValue(value));
    }
  }, [isEditing, value]);

  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium uppercase text-muted-foreground">{label}</span>
      <input
        type="number"
        step="0.01"
        inputMode="decimal"
        value={isEditing ? draftValue : formatMoneyInputValue(value)}
        onFocus={() => setIsEditing(true)}
        onChange={(event) => {
          const nextValue = event.target.value;
          setDraftValue(nextValue);

          if (!nextValue.trim()) {
            onChange(0);
            return;
          }

          onChange(parseMoneyInputValue(nextValue, value));
        }}
        onBlur={() => {
          const normalizedValue = parseMoneyInputValue(draftValue, value);
          setIsEditing(false);
          setDraftValue(formatMoneyInputValue(normalizedValue));
          onChange(normalizedValue);
        }}
        className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
      {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function HelpTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Ajuda"
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[11px] font-semibold text-muted-foreground transition hover:border-primary hover:text-foreground"
        >
          ?
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-xs px-3 py-2 text-xs leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export default function PayrollPage() {
  const { user, loading } = useAppSession();
  // Technicians' empty commission/salary/VA/VR fall back to the organization's defaults.
  const { settings: organizationSettings } = useOrganizationSettings();
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [query, setQuery] = useState('');
  const [openingTechnicianId, setOpeningTechnicianId] = useState('');
  const [competenceMonth, setCompetenceMonth] = useState(brasiliaDateKey().slice(0, 7));
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [selectedRow, setSelectedRow] = useState<PayrollRow | null>(null);
  const [isPayrollDialogOpen, setIsPayrollDialogOpen] = useState(false);
  const [payrollDraft, setPayrollDraft] = useState<PayrollDraft | null>(null);
  const [draftError, setDraftError] = useState('');
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [draftStatus, setDraftStatus] = useState<'none' | 'draft' | 'closed'>('none');
  const selectedCompetenceYear = Number(competenceMonth.slice(0, 4)) || new Date().getFullYear();
  const selectedCompetenceMonth = Number(competenceMonth.slice(5, 7)) || new Date().getMonth() + 1;
  const competenceYearOptions = useMemo(
    () => Array.from(new Set([
      selectedCompetenceYear,
      new Date().getFullYear() - 2,
      new Date().getFullYear() - 1,
      new Date().getFullYear(),
      new Date().getFullYear() + 1,
      new Date().getFullYear() + 2,
    ])).sort((left, right) => left - right),
    [selectedCompetenceYear],
  );

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      if (!user) return;

      setIsDataLoading(true);
      setDataError('');

      const [payrollResult, techniciansResult, servicesResult, discountsResult] = await Promise.allSettled([
        fetch(`/api/payroll?competenceMonth=${competenceMonth}`),
        fetch('/api/technicians'),
        fetch(`/api/services?competenceMonth=${competenceMonth}`),
        fetch(`/api/discounts?competenceMonth=${competenceMonth}`),
      ]);
      const errors: string[] = [];

      if (payrollResult.status === 'fulfilled' && payrollResult.value.ok) {
        const data = await payrollResult.value.json();
        if (mounted) setPayroll(Array.isArray(data.payrolls) ? data.payrolls : []);
      } else {
        errors.push('folha');
        if (mounted) setPayroll([]);
      }

      if (techniciansResult.status === 'fulfilled' && techniciansResult.value.ok) {
        const data = await techniciansResult.value.json();
        if (mounted) setTechnicians(Array.isArray(data.technicians) ? data.technicians : []);
      } else {
        errors.push('técnicos');
        if (mounted) setTechnicians([]);
      }

      if (servicesResult.status === 'fulfilled' && servicesResult.value.ok) {
        const data = await servicesResult.value.json();
        if (mounted) setServices(Array.isArray(data.services) ? data.services : []);
      } else {
        errors.push('OS');
        if (mounted) setServices([]);
      }

      if (discountsResult.status === 'fulfilled' && discountsResult.value.ok) {
        const data = await discountsResult.value.json();
        if (mounted) setDiscounts(Array.isArray(data.discounts) ? data.discounts : []);
      } else {
        errors.push('descontos');
        if (mounted) setDiscounts([]);
      }

      if (mounted) {
        setDataError(errors.length ? `Não foi possível carregar os dados de ${errors.join(', ')}.` : '');
        setIsDataLoading(false);
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [competenceMonth, user]);

  const rows = useMemo<PayrollRow[]>(() => {
    return technicians.filter((technician) => technician.status === 'active').map((technician) => {
      const payrollItem = payroll.find(
        (item) => item.technician_id === technician.id && item.competence_month === competenceMonth,
      );
      const technicianServices = services.filter(
        (service) => serviceBelongsToTechnician(service, technician) && getServiceCompetence(service) === competenceMonth,
      );
      const technicianDiscounts = discounts.filter(
        (discount) => discount.technician_id === technician.id && discount.competence_month === competenceMonth,
      );
      const hasMonthlyActivity = Boolean(payrollItem || technicianServices.length > 0 || technicianDiscounts.length > 0);
      const hasMonthlyObligation = true;
      const serviceFortnightSummary = createServiceFortnightSummary(technicianServices);
      const servicesTotal = roundMoney(technicianServices.reduce((total, service) => total + moneyValue(service.value), 0));
      const serviceCount = technicianServices.length;
      const totalServicesValue = roundMoney(servicesTotal || payrollItem?.total_services_value);
      const commissionPercentage = valueOrDefault(technician.commission_percentage, organizationSettings.commissionPercentage);
      const baseSalary = roundMoney(
        payrollItem ? payrollItem.base_salary : valueOrDefault(technician.base_salary, organizationSettings.baseSalary),
      );
      const vaAllowance = roundMoney(
        payrollItem ? payrollItem.va_deduction : valueOrDefault(technician.va_allowance, organizationSettings.vaAllowance),
      );
      const vrAllowance = roundMoney(
        payrollItem ? payrollItem.vr_deduction : valueOrDefault(technician.vr_allowance, organizationSettings.vrAllowance),
      );
      const benefitsTotal = roundMoney(vaAllowance + vrAllowance);
      const calculationBase = calculateCalculationBase(totalServicesValue, commissionPercentage);
      const commission = payrollItem
        ? roundMoney(payrollItem.commission_value)
        : calculateCommissionRemainder(calculationBase, baseSalary, vrAllowance, vaAllowance);
      const discountsTotal = payrollItem
        ? roundMoney(payrollItem.discounts_total)
        : roundMoney(technicianDiscounts
            .filter((discount) => discount.type === 'discount' || discount.type === 'other')
            .reduce((total, discount) => total + moneyValue(discount.amount), 0));
      const advancesTotal = payrollItem
        ? roundMoney(payrollItem.advances_total)
        : roundMoney(technicianDiscounts
            .filter((discount) => discount.type === 'advance')
            .reduce((total, discount) => total + moneyValue(discount.amount), 0));
      const totalDeductions = roundMoney(discountsTotal + advancesTotal);
      const extraHoursValue = roundMoney(payrollItem?.extra_hours_value);
      const extraordinaryAward = payrollItem
        ? roundMoney(payrollItem.extraordinary_award_value)
        : calculateServiceAward(serviceCount, organizationSettings.serviceAwardTiers);
      const projectedCashNetTotal = payrollItem
        ? roundMoney(payrollItem.net_total)
        : roundMoney(baseSalary + commission + extraHoursValue + extraordinaryAward - totalDeductions);
      const cashNetTotal = hasMonthlyObligation ? projectedCashNetTotal : 0;
      const displayBenefitsTotal = hasMonthlyObligation ? benefitsTotal : 0;
      const displayCommission = hasMonthlyObligation ? commission : 0;
      const displayDiscountsTotal = hasMonthlyObligation ? discountsTotal : 0;
      const displayAdvancesTotal = hasMonthlyObligation ? advancesTotal : 0;
      const displayTotalDeductions = hasMonthlyObligation ? totalDeductions : 0;
      const displayExtraHoursValue = hasMonthlyObligation ? extraHoursValue : 0;
      const displayExtraordinaryAward = hasMonthlyObligation ? extraordinaryAward : 0;

      return {
        technician,
        payrollItem,
        hasMonthlyActivity,
        hasMonthlyObligation,
        serviceCount,
        totalServicesValue,
        profitValue: hasMonthlyObligation ? roundMoney(totalServicesValue - roundMoney(cashNetTotal + displayBenefitsTotal)) : 0,
        serviceFortnightSummary,
        commissionPercentage,
        calculationBase,
        baseSalary,
        vaAllowance,
        vrAllowance,
        benefitsTotal: displayBenefitsTotal,
        commission: displayCommission,
        discountsTotal: displayDiscountsTotal,
        advancesTotal: displayAdvancesTotal,
        totalDeductions: displayTotalDeductions,
        extraHoursValue: displayExtraHoursValue,
        extraordinaryAward: displayExtraordinaryAward,
        cashNetTotal,
        payrollNetTotal: roundMoney(cashNetTotal + displayBenefitsTotal),
      };
    });
  }, [competenceMonth, discounts, organizationSettings, payroll, services, technicians]);

  const filteredRows = rows.filter((row) => {
    const haystack = normalizeText(`${row.technician.name} ${row.technician.qra}`);
    return normalizeText(haystack).includes(normalizeText(query));
  });

  const rowsWithMonthlyActivity = rows.filter((row) => row.hasMonthlyActivity);
  const rowsWithMonthlyObligation = rows.filter((row) => row.hasMonthlyObligation);

  const totalCashNet = rowsWithMonthlyObligation.reduce((total, row) => total + row.cashNetTotal, 0);
  const totalBenefits = rowsWithMonthlyObligation.reduce((total, row) => total + row.benefitsTotal, 0);
  const totalPayrollNet = rowsWithMonthlyObligation.reduce((total, row) => total + row.payrollNetTotal, 0);
  const totalServiceCount = rowsWithMonthlyActivity.reduce((total, row) => total + row.serviceCount, 0);
  const totalServicesValue = rowsWithMonthlyActivity.reduce((total, row) => total + row.totalServicesValue, 0);
  const totalProfit = rowsWithMonthlyObligation.reduce((total, row) => total + row.profitValue, 0);
  const closedCount = rowsWithMonthlyObligation.filter((row) => row.payrollItem?.status === 'closed').length;
  const draftCount = rowsWithMonthlyObligation.filter((row) => row.payrollItem && row.payrollItem.status !== 'closed').length;
  const pendingClosureCount = rowsWithMonthlyObligation.length - closedCount;
  const isPayrollAwaitingClosure = rowsWithMonthlyObligation.length > 0 && pendingClosureCount > 0;

  function resetDialogState() {
    setSelectedRow(null);
    setPayrollDraft(null);
    setDraftError('');
    setIsPreviewLoading(false);
    setIsClosing(false);
    setIsDirty(false);
    setAutoSaveState('idle');
    setLastSavedAt(null);
    setDraftStatus('none');
  }

  function handleDialogOpenChange(open: boolean) {
    setIsPayrollDialogOpen(open);

    if (!open) {
      resetDialogState();
    }
  }

  async function loadPreview(row: PayrollRow) {
    setIsPreviewLoading(true);
    setOpeningTechnicianId(row.technician.id);
    setDraftError('');

    try {
      const response = await fetch('/api/payroll/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          technicianId: row.technician.id,
          competenceMonth,
        }),
      });

      if (!response.ok) {
        throw new Error('Preview failed');
      }

      const data = await response.json();
      setPayrollDraft(normalizeDraft(data.payroll));
    } catch {
      setPayrollDraft(createDraftFromRow(row, competenceMonth));
      setDraftError('Não foi possível recalcular automaticamente. Revise os valores carregados antes de finalizar.');
    } finally {
      setIsPreviewLoading(false);
      setOpeningTechnicianId('');
    }
  }

  async function openPayrollDialog(row: PayrollRow) {
    if (!row.hasMonthlyObligation) {
      return;
    }

    setSelectedRow(row);
    setIsPayrollDialogOpen(true);
    setDraftError('');
    setIsDirty(false);
    setAutoSaveState('idle');
    setLastSavedAt(row.payrollItem?.updated_at ? new Date(row.payrollItem.updated_at) : null);
    setDraftStatus(row.payrollItem ? (row.payrollItem.status === 'closed' ? 'closed' : 'draft') : 'none');

    if (row.payrollItem) {
      // Já existe rascunho/fechamento salvo: carrega os valores gravados, sem recalcular.
      setPayrollDraft(createDraftFromRow(row, competenceMonth));
    } else {
      setPayrollDraft(null);
      await loadPreview(row);
    }
  }

  function openPayrollPdf(row: PayrollRow) {
    if (!row.payrollItem || typeof window === 'undefined') {
      return;
    }

    const payrollItem = row.payrollItem;
    const payrollTotal = roundMoney(payrollItem.net_total + payrollItem.va_deduction + payrollItem.vr_deduction);
    const updatedAt = payrollItem.updated_at ? new Date(payrollItem.updated_at).toLocaleString('pt-BR') : '-';
    const printWindow = window.open('', '_blank', 'width=960,height=1200');

    if (!printWindow) {
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>Folha - ${escapeHtml(row.technician.name)} - ${escapeHtml(formatCompetenceLabel(competenceMonth))}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 32px; color: #0f172a; }
            h1, p { margin: 0; }
            .header { margin-bottom: 24px; }
            .eyebrow { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; margin-bottom: 8px; }
            .title { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
            .subtitle { font-size: 14px; color: #475569; line-height: 1.5; }
            .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
            .card { border: 1px solid #cbd5e1; border-radius: 12px; padding: 14px; }
            .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin-bottom: 6px; }
            .value { font-size: 20px; font-weight: 700; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            th, td { text-align: left; padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
            th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; }
            .footer { margin-top: 24px; font-size: 12px; color: #64748b; }
            @media print { body { margin: 20px; } }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="eyebrow">Folha fechada</div>
            <div class="title">${escapeHtml(row.technician.name)}</div>
            <p class="subtitle">Competência ${escapeHtml(formatCompetenceLabel(competenceMonth))} | QRA ${escapeHtml(row.technician.qra || '-')} | Atualizado em ${escapeHtml(updatedAt)}</p>
          </div>

          <div class="grid">
            <div class="card"><div class="label">Valor bruto</div><div class="value">${escapeHtml(formatCurrency(payrollItem.total_services_value))}</div></div>
            <div class="card"><div class="label">Em conta</div><div class="value">${escapeHtml(formatCurrency(payrollItem.net_total))}</div></div>
            <div class="card"><div class="label">Folha total</div><div class="value">${escapeHtml(formatCurrency(payrollTotal))}</div></div>
            <div class="card"><div class="label">Lucro gerado</div><div class="value">${escapeHtml(formatCurrency(row.profitValue))}</div></div>
          </div>

          <table>
            <thead>
              <tr><th>Item</th><th>Valor</th></tr>
            </thead>
            <tbody>
              <tr><td>Ordens de serviço</td><td>${escapeHtml(String(row.serviceCount))}</td></tr>
              <tr><td>Resumo de quinzena</td><td>${escapeHtml(formatServiceFortnightCountSummary(row.serviceFortnightSummary))}</td></tr>
              <tr><td>Valor por quinzena</td><td>${escapeHtml(formatServiceFortnightValueSummary(row.serviceFortnightSummary))}</td></tr>
              <tr><td>Comissão</td><td>${escapeHtml(formatCurrency(payrollItem.commission_value))}</td></tr>
              <tr><td>Salário base</td><td>${escapeHtml(formatCurrency(payrollItem.base_salary))}</td></tr>
              <tr><td>Vale-refeição</td><td>${escapeHtml(formatCurrency(payrollItem.vr_deduction))}</td></tr>
              <tr><td>Vale-alimentação</td><td>${escapeHtml(formatCurrency(payrollItem.va_deduction))}</td></tr>
              <tr><td>Horas extras</td><td>${escapeHtml(formatCurrency(payrollItem.extra_hours_value))}</td></tr>
              <tr><td>Prêmio extraordinário</td><td>${escapeHtml(formatCurrency(payrollItem.extraordinary_award_value))}</td></tr>
              <tr><td>Banco de horas</td><td>${escapeHtml(formatCurrency(payrollItem.hour_bank_balance))}</td></tr>
              <tr><td>Descontos</td><td>${escapeHtml(formatCurrency(payrollItem.discounts_total))}</td></tr>
              <tr><td>Adiantamentos</td><td>${escapeHtml(formatCurrency(payrollItem.advances_total))}</td></tr>
            </tbody>
          </table>

          <div class="footer">Use a opção "Salvar como PDF" da impressão para guardar a folha deste técnico.</div>
          <script>
            window.onload = function () {
              window.focus();
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }

  function updateCalculationBase(value: number) {
    const commissionPercentage = selectedRow?.commissionPercentage ?? organizationSettings.commissionPercentage;
    updateDraftNumber('total_services_value', convertCalculationBaseToTotalServices(value, commissionPercentage));
  }

  function updateDraftNumber(field: PayrollDraftField, value: number) {
    setIsDirty(true);
    setPayrollDraft((current) => {
      if (!current) return current;

      const commissionPercentage = selectedRow?.commissionPercentage ?? organizationSettings.commissionPercentage;

      const next = {
        ...current,
        [field]: roundMoney(value),
      };

      if (commissionFormulaFields.includes(field)) {
        next.commission_value = calculateFormulaCommission(next, commissionPercentage);
      }

      if (field !== 'net_total') {
        next.net_total = calculateCashNet(next);
      }

      return next;
    });
  }

  function applyCommissionFormula() {
    setIsDirty(true);
    setPayrollDraft((current) => {
      if (!current) return current;
      const commissionPercentage = selectedRow?.commissionPercentage ?? organizationSettings.commissionPercentage;
      const next = {
        ...current,
        commission_value: calculateFormulaCommission(current, commissionPercentage),
      };

      return {
        ...next,
        net_total: calculateCashNet(next),
      };
    });
  }

  async function persistPayroll(status: 'draft' | 'closed') {
    if (!payrollDraft) return null;

    const response = await fetch('/api/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...normalizeDraft(payrollDraft), status }),
    });

    if (!response.ok) {
      throw new Error('Save failed');
    }

    const savedPayroll = (await response.json()) as Payroll;
    setPayroll((current) => {
      const others = current.filter(
        (item) =>
          item.technician_id !== savedPayroll.technician_id ||
          item.competence_month !== savedPayroll.competence_month,
      );

      return [savedPayroll, ...others];
    });

    return savedPayroll;
  }

  async function autoSaveDraft() {
    if (!payrollDraft || isClosing) return;

    setAutoSaveState('saving');
    setDraftError('');

    try {
      await persistPayroll('draft');
      setIsDirty(false);
      setDraftStatus('draft');
      setLastSavedAt(new Date());
      setAutoSaveState('saved');
    } catch {
      setAutoSaveState('error');
      setDraftError('Não foi possível salvar automaticamente. Verifique a conexão e tente novamente.');
    }
  }

  async function closePayroll() {
    if (!payrollDraft) return;

    setIsClosing(true);
    setDraftError('');

    try {
      await persistPayroll('closed');
      setIsDirty(false);
      setDraftStatus('closed');
      setLastSavedAt(new Date());
      setIsPayrollDialogOpen(false);
      resetDialogState();
    } catch {
      setDraftError('Não foi possível fechar a folha. Confira os valores e tente novamente.');
    } finally {
      setIsClosing(false);
    }
  }

  // Salva automaticamente como rascunho toda vez que um valor da folha muda,
  // com um pequeno atraso para agrupar edições consecutivas. O fechamento
  // continua sendo uma ação manual e explícita.
  useEffect(() => {
    if (!isPayrollDialogOpen || !payrollDraft || !isDirty || isClosing) return;

    const handle = setTimeout(() => {
      void autoSaveDraft();
    }, 900);

    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payrollDraft, isDirty, isPayrollDialogOpen, isClosing]);

  const currentCommissionPercentage = selectedRow?.commissionPercentage ?? organizationSettings.commissionPercentage;
  const formulaCommission = payrollDraft ? calculateFormulaCommission(payrollDraft, currentCommissionPercentage) : 0;
  const formulaCashNet = payrollDraft ? calculateCashNet(payrollDraft) : 0;
  const previewPayrollNet = payrollDraft ? calculatePayrollNet(payrollDraft) : 0;
  const previewProfit = payrollDraft ? roundMoney(payrollDraft.total_services_value - previewPayrollNet) : 0;
  const isClosed = draftStatus === 'closed';
  const autoSaveLabel =
    autoSaveState === 'saving'
      ? 'Salvando alterações...'
      : autoSaveState === 'error'
        ? 'Falha ao salvar automaticamente'
        : lastSavedAt
          ? `Alterações salvas automaticamente às ${lastSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
          : 'As alterações são salvas automaticamente como rascunho';
  const hasManualNetAdjustment = payrollDraft ? roundMoney(payrollDraft.net_total) !== roundMoney(formulaCashNet) : false;

  function renderRowStatus(row: PayrollRow) {
    if (row.payrollItem?.status === 'closed') return <StatusBadge tone="success">Folha fechada</StatusBadge>;
    if (row.payrollItem) return <StatusBadge tone="info">Rascunho salvo</StatusBadge>;
    if (row.hasMonthlyObligation) return <StatusBadge tone="warning">Aguardando fechamento</StatusBadge>;
    return <StatusBadge tone="neutral">Sem movimento</StatusBadge>;
  }

  function renderRowActions(row: PayrollRow) {
    if (!row.hasMonthlyObligation) {
      return <span className="text-sm text-muted-foreground">-</span>;
    }

    const isClosedRow = row.payrollItem?.status === 'closed';
    const isLoadingRow = openingTechnicianId === row.technician.id;

    return (
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={isClosedRow ? 'outline' : 'default'}
          onClick={() => openPayrollDialog(row)}
          disabled={isLoadingRow}
        >
          <Calculator className="h-4 w-4" />
          {isLoadingRow ? 'Carregando' : isClosedRow ? 'Editar' : row.payrollItem ? 'Continuar rascunho' : 'Abrir folha'}
        </Button>
        {isClosedRow ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => openPayrollPdf(row)}
                aria-label={`Gerar PDF da folha de ${row.technician.name}`}
              >
                <FileText className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>Gerar PDF da folha</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    );
  }

  if (loading || isDataLoading || !user) {
    return <LoadingShell role="admin" />;
  }

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Fechamento"
        title="Folha de pagamento"
        description="Abra a folha do técnico e edite à vontade: cada alteração é salva automaticamente como rascunho. A folha só é enviada ao técnico quando você clicar em Fechar folha."
      >
        <div className="flex items-end gap-2" role="group" aria-label="Competência">
          <label className="text-sm">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Competência</span>
            <select
              aria-label="Mês"
              value={String(selectedCompetenceMonth)}
              onChange={(event) => setCompetenceMonth(`${selectedCompetenceYear}-${String(Number(event.target.value)).padStart(2, '0')}`)}
              className="min-h-11 min-w-40 rounded-lg border border-input bg-card px-3 text-sm font-medium outline-none transition focus:ring-2 focus:ring-ring"
            >
              {monthNames.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>
          </label>
          <select
            aria-label="Ano"
            value={String(selectedCompetenceYear)}
            onChange={(event) => setCompetenceMonth(`${event.target.value}-${String(selectedCompetenceMonth).padStart(2, '0')}`)}
            className="min-h-11 rounded-lg border border-input bg-card px-3 text-sm font-medium outline-none transition focus:ring-2 focus:ring-ring"
          >
            {competenceYearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
      </PageHeader>

      {dataError ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{dataError}</div> : null}

      {/* Two full rows, no gaps: production and result on top (4), payroll cost below (3, wider). */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
        <div className="grid xl:col-span-3">
          <MetricCard title="Valor bruto" value={formatCurrency(totalServicesValue)} hint="Produção do mês" icon={Calculator} />
        </div>
        <div className="grid xl:col-span-3">
          <MetricCard title="OS" value={totalServiceCount} hint="Ordens do mês" icon={Calculator} />
        </div>
        <div className="grid xl:col-span-3">
          <MetricCard title="Lucro gerado" value={formatCurrency(totalProfit)} hint="Valor bruto - folha total" icon={WalletCards} tone={totalProfit >= 0 ? 'success' : 'danger'} accentText />
        </div>
        <div className="grid xl:col-span-3">
          <MetricCard
            title="Finalizados"
            value={`${closedCount}/${rowsWithMonthlyObligation.length}`}
            hint={isPayrollAwaitingClosure ? `Faltam ${pendingClosureCount} folha(s) (${draftCount} em rascunho).` : 'Todas as folhas da competência foram fechadas.'}
            icon={WalletCards}
            tone={isPayrollAwaitingClosure ? 'warning' : 'success'}
          />
        </div>
        <div className="grid xl:col-span-4">
          <MetricCard title="Em conta" value={formatCurrency(totalCashNet)} hint="Valor já devido em conta" icon={WalletCards} tone="success" />
        </div>
        <div className="grid xl:col-span-4">
          <MetricCard title="Cartões" value={formatCurrency(totalBenefits)} hint="VR + VA já devidos" icon={CreditCard} />
        </div>
        <div className="grid sm:col-span-2 xl:col-span-4">
          <MetricCard title="Líquido da folha" value={formatCurrency(totalPayrollNet)} hint="Custo total já devido" icon={Calculator} tone="success" />
        </div>
      </div>

      {isPayrollAwaitingClosure ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            A competência {formatCompetenceLabel(competenceMonth)} ainda não foi fechada. Falta concluir a folha de {pendingClosureCount} técnico(s). Enquanto isso, os totais desta tela servem como conferência e o painel administrativo continua aguardando o fechamento completo.
          </div>
        </div>
      ) : null}


      {!rowsWithMonthlyActivity.length && rowsWithMonthlyObligation.length ? (
        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
          Esta competência ainda não tem OS lançadas. Os totais do topo já mostram o salário fixo e os benefícios que a operação deve pagar no mês.
        </div>
      ) : null}

      <DataPanel
        title="Fechamento por técnico"
        description="A tabela mostra o resumo do mês, a base de cálculo (valor usado para os 25%) e o breakdown de Q1 e Q2. Abra a folha para editar (salva sozinho como rascunho) e feche quando estiver pronto para o técnico."
        action={
          <div className="flex min-h-10 w-full items-center gap-2 rounded-md border border-border bg-background px-3 sm:w-auto">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar técnico" className="w-full bg-transparent text-sm outline-none sm:w-56" />
          </div>
        }
      >
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-6xl text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="py-3 pr-4 font-medium">Técnico</th>
                <th className="py-3 pr-4 font-medium">OS</th>
                <th className="py-3 pr-4 font-medium">Valor bruto</th>
                <th className="py-3 pr-4 font-medium">Base de cálculo</th>
                <th className="py-3 pr-4 font-medium">Comissão</th>
                <th className="py-3 pr-4 font-medium">Descontos</th>
                <th className="py-3 pr-4 font-medium">Em conta</th>
                <th className="py-3 pr-4 font-medium">Líquido da folha</th>
                <th className="py-3 pr-4 font-medium">LUCRO GERADO</th>
                <th className="py-3 pr-4 font-medium">Status</th>
                <th className="py-3 font-medium">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.technician.id} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4">
                    <div className="font-medium">{row.technician.name}</div>
                    {row.technician.qra ? <div className="text-xs text-muted-foreground">{row.technician.qra}</div> : null}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-medium">{row.serviceCount}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.hasMonthlyActivity ? formatServiceFortnightCountSummary(row.serviceFortnightSummary) : row.hasMonthlyObligation ? 'Sem OS na competência' : 'Sem movimento na competência'}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-medium">{formatCurrency(row.totalServicesValue)}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.hasMonthlyActivity ? formatServiceFortnightValueSummary(row.serviceFortnightSummary) : row.hasMonthlyObligation ? 'Somente custo fixo' : 'Sem valor lançado'}
                    </div>
                  </td>
                  <td className="whitespace-nowrap py-3 pr-4">
                    <div className="font-medium">{row.hasMonthlyObligation ? formatCurrency(row.calculationBase) : '-'}</div>
                    {row.hasMonthlyObligation ? (
                      <div className="text-xs text-muted-foreground">{row.commissionPercentage}% do bruto</div>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap py-3 pr-4">{row.hasMonthlyObligation ? formatCurrency(row.commission) : '-'}</td>
                  <td className="whitespace-nowrap py-3 pr-4">{row.hasMonthlyObligation ? formatCurrency(row.totalDeductions) : '-'}</td>
                  <td className="whitespace-nowrap py-3 pr-4 font-semibold">{row.hasMonthlyObligation ? formatCurrency(row.cashNetTotal) : '-'}</td>
                  <td className="whitespace-nowrap py-3 pr-4 font-semibold">{row.hasMonthlyObligation ? formatCurrency(row.payrollNetTotal) : '-'}</td>
                  <td className={`whitespace-nowrap py-3 pr-4 font-semibold ${row.profitValue >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {row.hasMonthlyObligation ? formatCurrency(row.profitValue) : '-'}
                  </td>
                  <td className="py-3 pr-4">{renderRowStatus(row)}</td>
                  <td className="py-3">{renderRowActions(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 lg:hidden">
          {filteredRows.map((row) => (
            <div key={row.technician.id} className="rounded-lg border border-border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{row.technician.name}</div>
                  {row.technician.qra ? <div className="text-xs text-muted-foreground">{row.technician.qra}</div> : null}
                </div>
                {renderRowStatus(row)}
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">OS</dt>
                  <dd className="font-medium">
                    {row.serviceCount}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {row.hasMonthlyActivity ? formatServiceFortnightCountSummary(row.serviceFortnightSummary) : row.hasMonthlyObligation ? 'Sem OS' : 'Sem movimento'}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Valor bruto</dt>
                  <dd className="font-medium">{formatCurrency(row.totalServicesValue)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Base de cálculo</dt>
                  <dd className="font-medium">
                    {row.hasMonthlyObligation ? formatCurrency(row.calculationBase) : '-'}
                    {row.hasMonthlyObligation ? <span className="block text-xs font-normal text-muted-foreground">{row.commissionPercentage}% do bruto</span> : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Comissão</dt>
                  <dd className="font-medium">{row.hasMonthlyObligation ? formatCurrency(row.commission) : '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Descontos</dt>
                  <dd className="font-medium">{row.hasMonthlyObligation ? formatCurrency(row.totalDeductions) : '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Em conta</dt>
                  <dd className="font-semibold">{row.hasMonthlyObligation ? formatCurrency(row.cashNetTotal) : '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Líquido da folha</dt>
                  <dd className="font-semibold">{row.hasMonthlyObligation ? formatCurrency(row.payrollNetTotal) : '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Lucro gerado</dt>
                  <dd className={`font-semibold ${row.profitValue >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {row.hasMonthlyObligation ? formatCurrency(row.profitValue) : '-'}
                  </dd>
                </div>
              </dl>

              <div className="mt-4">{renderRowActions(row)}</div>
            </div>
          ))}
        </div>
      </DataPanel>

      <Dialog open={isPayrollDialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="flex h-auto max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl">
          <DialogHeader className="shrink-0 border-b border-border p-4 pb-3 sm:p-6 sm:pb-4">
            <DialogTitle>Folha do técnico</DialogTitle>
            <DialogDescription>
              {selectedRow ? `${selectedRow.technician.name} - competência ${formatCompetenceLabel(competenceMonth)}` : 'Abra a folha, revise os valores e feche quando estiver certo.'}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {draftError ? <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{draftError}</div> : null}
            {selectedRow && selectedRow.serviceCount === 0 ? (
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Não há OS lançadas para este técnico nesta competência. A prévia abaixo já considera salário base, VR, VA e demais valores fixos do mês.
              </div>
            ) : null}

            {isPreviewLoading && !payrollDraft ? (
              <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">Calculando valores...</div>
            ) : null}

            {payrollDraft ? (
              <div className="space-y-5">
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold">Resumo</h3>
                    <HelpTip text="As alterações são salvas automaticamente como rascunho. A folha só fica visível para o técnico quando você clicar em Fechar folha." />
                    <StatusBadge tone={isClosed ? 'success' : draftStatus === 'draft' ? 'info' : 'warning'}>
                      {isClosed ? 'Fechada' : draftStatus === 'draft' ? 'Rascunho salvo' : 'Em aberto'}
                    </StatusBadge>
                    <StatusBadge tone={hasManualNetAdjustment ? 'warning' : 'info'}>
                      {hasManualNetAdjustment ? 'Ajuste manual' : 'Fórmula'}
                    </StatusBadge>
                    <StatusBadge tone="info">{currentCommissionPercentage}% bruto</StatusBadge>
                    {selectedRow ? <StatusBadge tone="info">{selectedRow.serviceCount} OS</StatusBadge> : null}
                    {selectedRow ? <StatusBadge tone="info">Q1 {selectedRow.serviceFortnightSummary.Q1.count}</StatusBadge> : null}
                    {selectedRow ? <StatusBadge tone="info">Q2 {selectedRow.serviceFortnightSummary.Q2.count}</StatusBadge> : null}
                    {selectedRow && selectedRow.serviceFortnightSummary.unassigned.count > 0 ? (
                      <StatusBadge tone="warning">Sem quinzena {selectedRow.serviceFortnightSummary.unassigned.count}</StatusBadge>
                    ) : null}
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-md border border-border bg-background p-3">
                      <div className="text-xs uppercase text-muted-foreground">Bruto</div>
                      <div className="mt-1 text-lg font-semibold">{formatCurrency(payrollDraft.total_services_value)}</div>
                    </div>
                    <div className="rounded-md border border-border bg-background p-3">
                      <div className="text-xs uppercase text-muted-foreground">Comissão</div>
                      <div className="mt-1 text-lg font-semibold">{formatCurrency(formulaCommission)}</div>
                    </div>
                    <div className="rounded-md border border-border bg-background p-3">
                      <div className="text-xs uppercase text-muted-foreground">Em conta</div>
                      <div className="mt-1 text-lg font-semibold">{formatCurrency(payrollDraft.net_total)}</div>
                    </div>
                    <div className="rounded-md border border-border bg-background p-3">
                      <div className="text-xs uppercase text-muted-foreground">Folha total</div>
                      <div className="mt-1 text-lg font-semibold">{formatCurrency(previewPayrollNet)}</div>
                    </div>
                    <div className="rounded-md border border-border bg-background p-3">
                      <div className="text-xs uppercase text-muted-foreground">LUCRO GERADO</div>
                      <div className={`mt-1 text-lg font-semibold ${previewProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatCurrency(previewProfit)}</div>
                    </div>
                  </div>
                </div>

                <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-4">
                  <section className="rounded-md border border-border p-4">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">1. Comissão</h3>
                          <HelpTip text="Os 25% do bruto formam a base do técnico. A comissão é o que sobra depois de abater salário base, VR e VA." />
                        </div>
                        {selectedRow ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {selectedRow.serviceCount} OS | {formatServiceFortnightCountSummary(selectedRow.serviceFortnightSummary)} | {formatServiceFortnightValueSummary(selectedRow.serviceFortnightSummary)}
                          </p>
                        ) : null}
                      </div>
                      <Button type="button" variant="secondary" size="sm" onClick={applyCommissionFormula} className="shrink-0">
                        <RefreshCw className="h-4 w-4" />
                        Atualizar
                      </Button>
                    </div>
                    <div className="grid gap-3">
                      <MoneyInput
                        label="Base do cálculo"
                        value={calculateCalculationBase(payrollDraft.total_services_value, selectedRow?.commissionPercentage ?? organizationSettings.commissionPercentage)}
                        onChange={updateCalculationBase}
                        hint={`${selectedRow?.commissionPercentage ?? organizationSettings.commissionPercentage}% do total bruto (${formatCurrency(payrollDraft.total_services_value)})`}
                      />
                      <MoneyInput
                        label="Comissão"
                        value={payrollDraft.commission_value}
                        onChange={(value) => updateDraftNumber('commission_value', value)}
                        hint="Base do cálculo - salário base - VR - VA"
                      />
                    </div>
                  </section>

                  <section className="rounded-md border border-border p-4">
                    <div className="mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">2. Fixo e benefícios</h3>
                        <HelpTip text="Salário base, VR e VA entram como abatimento da base dos 25%. VR e VA continuam aparecendo no total da folha porque são pagos no cartão." />
                      </div>
                    </div>
                    <div className="grid gap-3">
                      <MoneyInput label="Salário base" value={payrollDraft.base_salary} onChange={(value) => updateDraftNumber('base_salary', value)} />
                      <MoneyInput label="Vale-refeição" value={payrollDraft.vr_deduction} onChange={(value) => updateDraftNumber('vr_deduction', value)} />
                      <MoneyInput label="Vale-alimentação" value={payrollDraft.va_deduction} onChange={(value) => updateDraftNumber('va_deduction', value)} />
                    </div>
                  </section>

                  <section className="rounded-md border border-border p-4">
                    <div className="mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">3. Acréscimos</h3>
                        <HelpTip text="Horas extras e prêmio extraordinário aumentam o valor pago em conta. Banco de horas é apenas informativo neste bloco." />
                      </div>
                    </div>
                    <div className="grid gap-3">
                      <MoneyInput label="Horas extras" value={payrollDraft.extra_hours_value} onChange={(value) => updateDraftNumber('extra_hours_value', value)} />
                      <MoneyInput label="Prêmio extraordinário" value={payrollDraft.extraordinary_award_value} onChange={(value) => updateDraftNumber('extraordinary_award_value', value)} />
                      <MoneyInput label="Banco de horas" value={payrollDraft.hour_bank_balance} onChange={(value) => updateDraftNumber('hour_bank_balance', value)} />
                    </div>
                  </section>

                  <section className="rounded-md border border-border p-4">
                    <div className="mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">4. Descontos e pagamento</h3>
                        <HelpTip text="Descontos de folha e adiantamentos reduzem o valor em conta. Se necessário, você pode ajustar o valor final manualmente antes de fechar a folha." />
                      </div>
                    </div>
                    <div className="grid gap-3">
                      <MoneyInput label="Descontos de folha" value={payrollDraft.discounts_total} onChange={(value) => updateDraftNumber('discounts_total', value)} />
                      <MoneyInput label="Adiantamento" value={payrollDraft.advances_total} onChange={(value) => updateDraftNumber('advances_total', value)} />
                      <MoneyInput label="Valor em conta a pagar" value={payrollDraft.net_total} onChange={(value) => updateDraftNumber('net_total', value)} />
                    </div>
                  </section>
                </div>

                <div className="rounded-md border border-border bg-muted/25 p-4">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">Resumo em conta</h3>
                    <HelpTip text="A fórmula faz: 25% do bruto - salário base - VR - VA. Depois soma extras e prêmio, e por fim desconta descontos e adiantamentos para chegar no valor em conta." />
                  </div>
                  <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
                    <div>
                      <span className="block text-xs uppercase text-muted-foreground">Comissão</span>
                      <strong>{formatCurrency(formulaCommission)}</strong>
                    </div>
                    <div>
                      <span className="block text-xs uppercase text-muted-foreground">Pela fórmula</span>
                      <strong>{formatCurrency(formulaCashNet)}</strong>
                    </div>
                    <div>
                      <span className="block text-xs uppercase text-muted-foreground">Para fechar</span>
                      <strong>{formatCurrency(payrollDraft.net_total)}</strong>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter className="shrink-0 flex-col gap-3 border-t border-border p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div
              className={`flex items-center gap-2 text-xs font-medium ${
                autoSaveState === 'error' ? 'text-rose-600' : autoSaveState === 'saving' ? 'text-muted-foreground' : 'text-emerald-700'
              }`}
              aria-live="polite"
            >
              {autoSaveState === 'saving' ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : autoSaveState === 'error' ? (
                <AlertCircle className="h-3.5 w-3.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              <span>{autoSaveLabel}</span>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                variant="secondary"
                onClick={() => selectedRow && loadPreview(selectedRow).then(() => setIsDirty(true))}
                disabled={!selectedRow || isPreviewLoading || isClosing}
                className="w-full sm:w-auto"
              >
                <RefreshCw className="h-4 w-4" />
                {isPreviewLoading ? 'Recalculando' : 'Recalcular'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => handleDialogOpenChange(false)} disabled={isClosing || autoSaveState === 'saving'} className="w-full sm:w-auto">
                Fechar janela
              </Button>
              <Button type="button" onClick={closePayroll} disabled={!payrollDraft || isClosing || isPreviewLoading || autoSaveState === 'saving'} className="w-full sm:w-auto">
                <CheckCircle2 className="h-4 w-4" />
                {isClosing ? 'Fechando' : isClosed ? 'Atualizar fechamento' : 'Fechar folha'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
