'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, FileText, LockOpen, RefreshCw, Search } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import {
  MODAL_BODY_CLASS,
  MODAL_DESCRIPTION_CLASS,
  MODAL_FOOTER_CLASS,
  MODAL_HEADER_CLASS,
  MODAL_TITLE_CLASS,
  ModalNotice,
  ModalSection,
  SummaryBand,
} from '@/components/modal-kit';
import { LoadingShell } from '@/components/page-skeleton';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { brasiliaDateKey, formatCurrency, normalizeText, resolveCompetenceMonth } from '@/lib/formatters';
import type { Discount, Payroll, Service, ServiceFortnight, Technician } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAppSession } from '@/hooks/use-app-session';
import { useOrganizationSettings } from '@/hooks/use-organization-settings';
import { calculateServiceAward, valueOrDefault } from '@/lib/organization-settings';

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

type ServiceFortnightBucket = {
  count: number;
  totalValue: number;
};

type ServiceFortnightSummary = {
  Q1: ServiceFortnightBucket;
  Q2: ServiceFortnightBucket;
  unassigned: ServiceFortnightBucket;
};

type PayrollRow = {
  technician: Technician;
  payrollItem?: Payroll;
  serviceCount: number;
  totalServicesValue: number;
  profitValue: number;
  serviceFortnightSummary: ServiceFortnightSummary;
  commissionPercentage: number;
  baseSalary: number;
  vaAllowance: number;
  vrAllowance: number;
  commission: number;
  discountsTotal: number;
  advancesTotal: number;
  extraHoursValue: number;
  extraordinaryAward: number;
  hourBankBalance: number;
  cashNetTotal: number;
  payrollNetTotal: number;
};

const commissionFormulaFields: PayrollDraftField[] = ['total_services_value', 'base_salary', 'vr_deduction', 'va_deduction'];

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

const numberFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatHours(value: number) {
  return `${numberFormat.format(roundMoney(value))} h`;
}

/** What the person types: "1.234,56", "1234,5", "1500" or "1.500" (a dot before exactly three digits is thousands). */
function parseMoneyText(text: string, fallbackValue: number) {
  const cleaned = text.trim().replace(/\s/g, '');
  if (!cleaned) return 0;

  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : /^-?\d{1,3}(\.\d{3})+$/.test(cleaned)
      ? cleaned.replace(/\./g, '')
      : cleaned;
  const numericValue = Number(normalized);

  return Number.isFinite(numericValue) ? roundMoney(numericValue) : roundMoney(fallbackValue);
}

function formatCompetenceLabel(value: string) {
  const [year, month] = value.split('-');
  const monthNumber = Number(month);

  if (!year || !month || !monthNames[monthNumber - 1]) {
    return value || 'Sem competência';
  }

  return `${monthNames[monthNumber - 1]} de ${year}`;
}

function getServiceCompetence(service: Service) {
  return resolveCompetenceMonth(service.competence_month, service.date_performed);
}

function createServiceFortnightSummary(services: Service[]): ServiceFortnightSummary {
  const summary: ServiceFortnightSummary = {
    Q1: { count: 0, totalValue: 0 },
    Q2: { count: 0, totalValue: 0 },
    unassigned: { count: 0, totalValue: 0 },
  };

  services.forEach((service) => {
    const bucket =
      service.fortnight_period === 'Q1' || service.fortnight_period === 'Q2'
        ? summary[service.fortnight_period as ServiceFortnight]
        : summary.unassigned;

    bucket.count += 1;
    bucket.totalValue = roundMoney(bucket.totalValue + moneyValue(service.value));
  });

  return summary;
}

function formatFortnights(summary: ServiceFortnightSummary, withValues = false) {
  const entries: Array<[string, ServiceFortnightBucket]> = [
    ['Q1', summary.Q1],
    ['Q2', summary.Q2],
    ['Sem quinzena', summary.unassigned],
  ];

  return entries
    .filter(([, bucket]) => bucket.count > 0)
    .map(([label, bucket]) => (withValues ? `${label} ${formatCurrency(bucket.totalValue)}` : `${label} ${bucket.count}`))
    .join(' · ');
}

/** The service's technician by id; the name is only a fallback for rows that never got an id. */
function serviceBelongsToTechnician(service: Service, technician: Technician) {
  if (service.technician_id) return service.technician_id === technician.id;

  const serviceTechnicianName = normalizeText(service.technician_name);
  return Boolean(serviceTechnicianName && serviceTechnicianName === normalizeText(technician.name));
}

function calculateCalculationBase(totalServicesValue: number, commissionPercentage: number) {
  return roundMoney(Math.max(0, totalServicesValue) * (commissionPercentage / 100));
}

function calculateCommissionRemainder(calculationBase: number, baseSalary: number, vrAllowance: number, vaAllowance: number) {
  return roundMoney(
    Math.max(0, moneyValue(calculationBase) - moneyValue(baseSalary) - moneyValue(vrAllowance) - moneyValue(vaAllowance)),
  );
}

function calculateFormulaCommission(draft: PayrollDraft, commissionPercentage: number) {
  return calculateCommissionRemainder(
    calculateCalculationBase(moneyValue(draft.total_services_value), commissionPercentage),
    moneyValue(draft.base_salary),
    moneyValue(draft.vr_deduction),
    moneyValue(draft.va_deduction),
  );
}

/** Salary + commission + extras + award − discounts − advances: what goes to the technician's account. */
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

/** The draft shown when the folha is opened: the saved values when there are any, the table's estimate otherwise. */
function createDraftFromRow(row: PayrollRow, competenceMonth: string) {
  if (row.payrollItem) return normalizeDraft(row.payrollItem);

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
    hour_bank_balance: row.hourBankBalance,
    net_total: row.cashNetTotal,
  });
}

/** One line of the folha: what it is on the left, the amount to read or type on the right. */
function AmountRow({
  label,
  hint,
  value,
  onChange,
  unit = 'R$',
  readOnly = false,
  emphasis = false,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  unit?: 'R$' | 'h';
  readOnly?: boolean;
  emphasis?: boolean;
}) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);

  return (
    <label className={cn('flex items-center justify-between gap-4', emphasis ? 'py-3' : 'py-2.5')}>
      <span className="min-w-0">
        <span className={cn('block text-sm', emphasis ? 'font-semibold' : '', 'text-foreground')}>{label}</span>
        {hint ? <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{hint}</span> : null}
      </span>
      <span
        className={cn(
          'flex h-10 w-40 shrink-0 items-center gap-2 rounded-lg border px-3 transition',
          readOnly ? 'border-transparent bg-secondary/50' : 'border-border bg-background focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
          emphasis && !readOnly ? 'border-foreground/25' : '',
        )}
      >
        <span className="text-xs text-muted-foreground">{unit}</span>
        <input
          type="text"
          inputMode="decimal"
          readOnly={readOnly}
          value={editing ? text : numberFormat.format(value)}
          onFocus={(event) => {
            if (readOnly) return;
            setText(value === 0 ? '' : String(value).replace('.', ','));
            setEditing(true);
            event.currentTarget.select();
          }}
          onChange={(event) => {
            const nextText = event.target.value.replace(/[^\d.,-]/g, '');
            setText(nextText);
            onChange(parseMoneyText(nextText, value));
          }}
          onBlur={() => setEditing(false)}
          className={cn('w-full min-w-0 bg-transparent text-right text-sm tabular-nums outline-none', emphasis ? 'font-semibold' : 'font-medium')}
        />
      </span>
    </label>
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
  const [hasLoaded, setHasLoaded] = useState(false);
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
    () =>
      Array.from(
        new Set([
          selectedCompetenceYear,
          new Date().getFullYear() - 2,
          new Date().getFullYear() - 1,
          new Date().getFullYear(),
          new Date().getFullYear() + 1,
        ]),
      ).sort((left, right) => left - right),
    [selectedCompetenceYear],
  );

  function shiftMonth(delta: number) {
    const [year, month] = competenceMonth.split('-').map(Number);
    setCompetenceMonth(new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7));
  }

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
        setHasLoaded(true);
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [competenceMonth, user]);

  const rows = useMemo<PayrollRow[]>(() => {
    return technicians
      .filter((technician) => technician.status === 'active')
      .map((technician) => {
        const payrollItem = payroll.find((item) => item.technician_id === technician.id && item.competence_month === competenceMonth);
        const technicianServices = services.filter(
          (service) => serviceBelongsToTechnician(service, technician) && getServiceCompetence(service) === competenceMonth,
        );
        const technicianDiscounts = discounts.filter(
          (discount) => discount.technician_id === technician.id && discount.competence_month === competenceMonth,
        );
        const serviceCount = technicianServices.length;
        const commissionPercentage = valueOrDefault(technician.commission_percentage, organizationSettings.commissionPercentage);

        // A saved folha (draft or closed) is the truth for its month: the OS list may have changed since.
        const totalServicesValue = payrollItem
          ? roundMoney(payrollItem.total_services_value)
          : roundMoney(technicianServices.reduce((total, service) => total + moneyValue(service.value), 0));
        const baseSalary = roundMoney(payrollItem ? payrollItem.base_salary : valueOrDefault(technician.base_salary, organizationSettings.baseSalary));
        const vaAllowance = roundMoney(payrollItem ? payrollItem.va_deduction : valueOrDefault(technician.va_allowance, organizationSettings.vaAllowance));
        const vrAllowance = roundMoney(payrollItem ? payrollItem.vr_deduction : valueOrDefault(technician.vr_allowance, organizationSettings.vrAllowance));
        const commission = payrollItem
          ? roundMoney(payrollItem.commission_value)
          : calculateCommissionRemainder(calculateCalculationBase(totalServicesValue, commissionPercentage), baseSalary, vrAllowance, vaAllowance);
        const discountsTotal = payrollItem
          ? roundMoney(payrollItem.discounts_total)
          : roundMoney(
              technicianDiscounts
                .filter((discount) => discount.type === 'discount' || discount.type === 'other')
                .reduce((total, discount) => total + moneyValue(discount.amount), 0),
            );
        const advancesTotal = payrollItem
          ? roundMoney(payrollItem.advances_total)
          : roundMoney(technicianDiscounts.filter((discount) => discount.type === 'advance').reduce((total, discount) => total + moneyValue(discount.amount), 0));
        // Overtime needs the hours: only the folha opened (or its preview) knows it, so unopened rows leave it out.
        const extraHoursValue = roundMoney(payrollItem?.extra_hours_value);
        const extraordinaryAward = payrollItem
          ? roundMoney(payrollItem.extraordinary_award_value)
          : calculateServiceAward(serviceCount, organizationSettings.serviceAwardTiers);
        const cashNetTotal = payrollItem
          ? roundMoney(payrollItem.net_total)
          : roundMoney(baseSalary + commission + extraHoursValue + extraordinaryAward - discountsTotal - advancesTotal);
        const payrollNetTotal = roundMoney(cashNetTotal + vaAllowance + vrAllowance);

        return {
          technician,
          payrollItem,
          serviceCount,
          totalServicesValue,
          profitValue: roundMoney(totalServicesValue - payrollNetTotal),
          serviceFortnightSummary: createServiceFortnightSummary(technicianServices),
          commissionPercentage,
          baseSalary,
          vaAllowance,
          vrAllowance,
          commission,
          discountsTotal,
          advancesTotal,
          extraHoursValue,
          extraordinaryAward,
          hourBankBalance: roundMoney(payrollItem?.hour_bank_balance),
          cashNetTotal,
          payrollNetTotal,
        };
      });
  }, [competenceMonth, discounts, organizationSettings, payroll, services, technicians]);

  const filteredRows = rows.filter((row) => normalizeText(`${row.technician.name} ${row.technician.qra}`).includes(normalizeText(query)));

  const totalCashNet = roundMoney(rows.reduce((total, row) => total + row.cashNetTotal, 0));
  const totalBenefits = roundMoney(rows.reduce((total, row) => total + row.vaAllowance + row.vrAllowance, 0));
  const totalPayrollNet = roundMoney(rows.reduce((total, row) => total + row.payrollNetTotal, 0));
  const totalServicesValue = roundMoney(rows.reduce((total, row) => total + row.totalServicesValue, 0));
  const totalProfit = roundMoney(rows.reduce((total, row) => total + row.profitValue, 0));
  const closedCount = rows.filter((row) => row.payrollItem?.status === 'closed').length;
  const pendingCount = rows.length - closedCount;
  const notOpenedCount = rows.filter((row) => !row.payrollItem).length;
  const progress = rows.length ? Math.round((closedCount / rows.length) * 100) : 0;

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

  async function loadPreview(row: PayrollRow) {
    setIsPreviewLoading(true);
    setOpeningTechnicianId(row.technician.id);
    setDraftError('');

    try {
      const response = await fetch('/api/payroll/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ technicianId: row.technician.id, competenceMonth }),
      });

      if (!response.ok) {
        throw new Error('Preview failed');
      }

      const data = await response.json();
      setPayrollDraft(normalizeDraft(data.payroll));
      return true;
    } catch {
      setPayrollDraft(createDraftFromRow(row, competenceMonth));
      setDraftError('Não foi possível recalcular automaticamente. Revise os valores antes de fechar.');
      return false;
    } finally {
      setIsPreviewLoading(false);
      setOpeningTechnicianId('');
    }
  }

  async function openPayrollDialog(row: PayrollRow) {
    setSelectedRow(row);
    setIsPayrollDialogOpen(true);
    setDraftError('');
    setIsDirty(false);
    setAutoSaveState('idle');
    setLastSavedAt(row.payrollItem?.updated_at ? new Date(row.payrollItem.updated_at) : null);
    setDraftStatus(row.payrollItem ? (row.payrollItem.status === 'closed' ? 'closed' : 'draft') : 'none');

    if (row.payrollItem) {
      // Already saved (draft or closed): show exactly what was saved, no recalculation.
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
              <tr><td>Quinzenas</td><td>${escapeHtml(formatFortnights(row.serviceFortnightSummary) || 'Sem OS')}</td></tr>
              <tr><td>Valor por quinzena</td><td>${escapeHtml(formatFortnights(row.serviceFortnightSummary, true) || 'Sem valor')}</td></tr>
              <tr><td>Comissão</td><td>${escapeHtml(formatCurrency(payrollItem.commission_value))}</td></tr>
              <tr><td>Salário base</td><td>${escapeHtml(formatCurrency(payrollItem.base_salary))}</td></tr>
              <tr><td>Vale-refeição</td><td>${escapeHtml(formatCurrency(payrollItem.vr_deduction))}</td></tr>
              <tr><td>Vale-alimentação</td><td>${escapeHtml(formatCurrency(payrollItem.va_deduction))}</td></tr>
              <tr><td>Horas extras</td><td>${escapeHtml(formatCurrency(payrollItem.extra_hours_value))}</td></tr>
              <tr><td>Prêmio por produção</td><td>${escapeHtml(formatCurrency(payrollItem.extraordinary_award_value ?? 0))}</td></tr>
              <tr><td>Banco de horas</td><td>${escapeHtml(formatHours(payrollItem.hour_bank_balance))}</td></tr>
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

  const currentCommissionPercentage = selectedRow?.commissionPercentage ?? organizationSettings.commissionPercentage;
  const isClosed = draftStatus === 'closed';

  function updateDraftNumber(field: PayrollDraftField, value: number) {
    if (isClosed) return;

    setIsDirty(true);
    setPayrollDraft((current) => {
      if (!current) return current;

      const next = { ...current, [field]: roundMoney(value) };

      if (commissionFormulaFields.includes(field)) {
        next.commission_value = calculateFormulaCommission(next, currentCommissionPercentage);
      }

      if (field !== 'net_total') {
        // A hand-set "em conta" keeps its adjustment when something else changes, instead of being thrown away.
        const adjustment = roundMoney(current.net_total - calculateCashNet(current));
        next.net_total = roundMoney(calculateCashNet(next) + adjustment);
      }

      return next;
    });
  }

  function applyCommissionFormula() {
    updateDraftNumber('commission_value', payrollDraft ? calculateFormulaCommission(payrollDraft, currentCommissionPercentage) : 0);
  }

  async function persistPayroll(status: 'draft' | 'closed', reopen = false) {
    if (!payrollDraft) return null;

    const response = await fetch('/api/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...normalizeDraft(payrollDraft), status, reopen }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(typeof data?.error === 'string' ? data.error : 'Não foi possível salvar a folha.');
    }

    const savedPayroll = (await response.json()) as Payroll;
    setPayroll((current) => {
      const others = current.filter(
        (item) => item.technician_id !== savedPayroll.technician_id || item.competence_month !== savedPayroll.competence_month,
      );

      return [savedPayroll, ...others];
    });

    return savedPayroll;
  }

  async function autoSaveDraft() {
    if (!payrollDraft || isClosing || isClosed) return true;

    setAutoSaveState('saving');
    setDraftError('');

    try {
      await persistPayroll('draft');
      setIsDirty(false);
      setDraftStatus('draft');
      setLastSavedAt(new Date());
      setAutoSaveState('saved');
      return true;
    } catch (error) {
      setAutoSaveState('error');
      setDraftError(error instanceof Error ? error.message : 'Não foi possível salvar automaticamente.');
      return false;
    }
  }

  async function closePayroll() {
    if (!payrollDraft) return;

    setIsClosing(true);
    setDraftError('');

    try {
      await persistPayroll('closed');
      setIsDirty(false);
      setIsPayrollDialogOpen(false);
      resetDialogState();
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : 'Não foi possível fechar a folha.');
    } finally {
      setIsClosing(false);
    }
  }

  async function reopenPayroll() {
    if (!payrollDraft || !selectedRow) return;

    const confirmed = window.confirm(
      `Reabrir a folha de ${selectedRow.technician.name}? Ela deixa de aparecer para o técnico até ser fechada de novo.`,
    );
    if (!confirmed) return;

    setAutoSaveState('saving');
    setDraftError('');

    try {
      await persistPayroll('draft', true);
      setDraftStatus('draft');
      setIsDirty(false);
      setLastSavedAt(new Date());
      setAutoSaveState('saved');
    } catch (error) {
      setAutoSaveState('error');
      setDraftError(error instanceof Error ? error.message : 'Não foi possível reabrir a folha.');
    }
  }

  async function recalculate() {
    if (!selectedRow) return;

    if (draftStatus === 'draft') {
      const confirmed = window.confirm('Recalcular troca os valores desta folha pelos que o sistema calcula agora. Continuar?');
      if (!confirmed) return;
    }

    if (await loadPreview(selectedRow)) setIsDirty(true);
  }

  /** Closing the window never loses an edit: what is still waiting for the auto-save goes first. */
  async function requestClose() {
    if (isClosing || autoSaveState === 'saving') return;

    // After a failed save the second try closes anyway, so the window can always be left.
    if (isDirty && payrollDraft && !isClosed && autoSaveState !== 'error') {
      const saved = await autoSaveDraft();
      if (!saved) return;
    }

    setIsPayrollDialogOpen(false);
    resetDialogState();
  }

  // Saves a draft a moment after each change (grouping quick edits). Closing stays a manual, explicit action.
  useEffect(() => {
    if (!isPayrollDialogOpen || !payrollDraft || !isDirty || isClosing || isClosed) return;

    const handle = setTimeout(() => {
      void autoSaveDraft();
    }, 900);

    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payrollDraft, isDirty, isPayrollDialogOpen, isClosing, isClosed]);

  const formulaCommission = payrollDraft ? calculateFormulaCommission(payrollDraft, currentCommissionPercentage) : 0;
  const formulaCashNet = payrollDraft ? calculateCashNet(payrollDraft) : 0;
  const draftPayrollNet = payrollDraft ? calculatePayrollNet(payrollDraft) : 0;
  const draftProfit = payrollDraft ? roundMoney(payrollDraft.total_services_value - draftPayrollNet) : 0;
  const draftBase = payrollDraft ? calculateCalculationBase(payrollDraft.total_services_value, currentCommissionPercentage) : 0;
  const commissionAdjusted = payrollDraft ? roundMoney(payrollDraft.commission_value) !== roundMoney(formulaCommission) : false;
  const netAdjusted = payrollDraft ? roundMoney(payrollDraft.net_total) !== roundMoney(formulaCashNet) : false;

  const saveStatus =
    autoSaveState === 'saving'
      ? 'Salvando...'
      : autoSaveState === 'error'
        ? 'Não salvou'
        : isClosed
          ? lastSavedAt
            ? `Fechada em ${lastSavedAt.toLocaleDateString('pt-BR')}`
            : 'Folha fechada'
          : isDirty
            ? 'Alterações pendentes'
            : lastSavedAt
              ? `Salvo às ${lastSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
              : 'Salva sozinha como rascunho';

  function renderRowStatus(row: PayrollRow) {
    if (row.payrollItem?.status === 'closed') return <StatusBadge tone="success">Fechada</StatusBadge>;
    if (row.payrollItem) return <StatusBadge tone="info">Rascunho</StatusBadge>;
    return <StatusBadge tone="warning">Não aberta</StatusBadge>;
  }

  function renderRowActions(row: PayrollRow) {
    const isClosedRow = row.payrollItem?.status === 'closed';
    const isLoadingRow = openingTechnicianId === row.technician.id;

    return (
      <div className="flex items-center justify-end gap-2">
        {isClosedRow ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => openPayrollPdf(row)}
                aria-label={`Gerar PDF da folha de ${row.technician.name}`}
              >
                <FileText className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>Gerar PDF</TooltipContent>
          </Tooltip>
        ) : null}
        <Button type="button" size="sm" variant={isClosedRow ? 'outline' : 'default'} onClick={() => openPayrollDialog(row)} disabled={isLoadingRow}>
          {isLoadingRow ? 'Abrindo...' : isClosedRow ? 'Ver folha' : row.payrollItem ? 'Continuar' : 'Abrir folha'}
        </Button>
      </div>
    );
  }

  if (loading || !user || (isDataLoading && !hasLoaded)) {
    return <LoadingShell role="admin" />;
  }

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Fechamento"
        title="Folha de pagamento"
        description="Abra a folha de cada técnico, confira e feche. Enquanto estiver aberta, ela fica só com você."
      >
        <div className="flex items-center gap-1.5" role="group" aria-label="Competência">
          <Button type="button" variant="outline" size="icon" onClick={() => shiftMonth(-1)} aria-label="Mês anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <select
            aria-label="Mês"
            value={String(selectedCompetenceMonth)}
            onChange={(event) => setCompetenceMonth(`${selectedCompetenceYear}-${String(Number(event.target.value)).padStart(2, '0')}`)}
            className="h-10 min-w-36 rounded-lg border border-input bg-card px-3 text-sm font-medium outline-none transition focus:ring-2 focus:ring-ring"
          >
            {monthNames.map((month, index) => (
              <option key={month} value={index + 1}>
                {month}
              </option>
            ))}
          </select>
          <select
            aria-label="Ano"
            value={String(selectedCompetenceYear)}
            onChange={(event) => setCompetenceMonth(`${event.target.value}-${String(selectedCompetenceMonth).padStart(2, '0')}`)}
            className="h-10 rounded-lg border border-input bg-card px-3 text-sm font-medium outline-none transition focus:ring-2 focus:ring-ring"
          >
            {competenceYearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" size="icon" onClick={() => shiftMonth(1)} aria-label="Próximo mês">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </PageHeader>

      {dataError ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{dataError}</div> : null}

      <div className={cn('space-y-5 transition-opacity', isDataLoading && 'pointer-events-none opacity-60')} aria-busy={isDataLoading}>
        <SummaryBand
          items={[
            { label: 'Valor bruto', value: formatCurrency(totalServicesValue) },
            { label: 'Em conta', value: formatCurrency(totalCashNet) },
            { label: 'Cartões (VR e VA)', value: formatCurrency(totalBenefits) },
            { label: 'Folha total', value: formatCurrency(totalPayrollNet) },
            { label: 'Lucro gerado', value: formatCurrency(totalProfit), tone: totalProfit >= 0 ? 'good' : 'bad' },
          ]}
        />

        <DataPanel
          title={rows.length ? `${closedCount} de ${rows.length} folhas fechadas` : 'Técnicos'}
          description={
            !rows.length
              ? 'Nenhum técnico ativo. Cadastre técnicos para montar a folha.'
              : pendingCount === 0
                ? `A folha de ${formatCompetenceLabel(competenceMonth)} está completa.`
                : notOpenedCount > 0
                  ? `Faltam ${pendingCount} para fechar ${formatCompetenceLabel(competenceMonth)}. Nas folhas ainda não abertas, os valores são uma estimativa (sem horas extras).`
                  : `Faltam ${pendingCount} para fechar ${formatCompetenceLabel(competenceMonth)}.`
          }
          action={
            <div className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-border bg-background px-3 sm:w-auto">
              <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar técnico"
                aria-label="Buscar técnico"
                className="w-full bg-transparent text-sm outline-none sm:w-52"
              />
            </div>
          }
        >
          {rows.length ? (
            <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Folhas fechadas">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          ) : null}

          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[13px] text-muted-foreground">
                  <th className="py-3 pr-4 font-medium">Técnico</th>
                  <th className="py-3 pr-4 text-right font-medium">OS</th>
                  <th className="py-3 pr-4 text-right font-medium">Valor bruto</th>
                  <th className="py-3 pr-4 text-right font-medium">Em conta</th>
                  <th className="py-3 pr-4 text-right font-medium">Folha total</th>
                  <th className="py-3 pr-4 text-right font-medium">Lucro</th>
                  <th className="py-3 pr-4 font-medium">Situação</th>
                  <th className="py-3 text-right font-medium">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.technician.id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4">
                      <div className="font-medium">{row.technician.name}</div>
                      {row.technician.qra ? <div className="text-xs text-muted-foreground">{row.technician.qra}</div> : null}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums">{row.serviceCount}</td>
                    <td className="whitespace-nowrap py-3 pr-4 text-right tabular-nums">{formatCurrency(row.totalServicesValue)}</td>
                    <td className="whitespace-nowrap py-3 pr-4 text-right font-semibold tabular-nums">{formatCurrency(row.cashNetTotal)}</td>
                    <td className="whitespace-nowrap py-3 pr-4 text-right tabular-nums">{formatCurrency(row.payrollNetTotal)}</td>
                    <td className={cn('whitespace-nowrap py-3 pr-4 text-right font-semibold tabular-nums', row.profitValue >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                      {formatCurrency(row.profitValue)}
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
              <div key={row.technician.id} className="rounded-xl border border-border bg-background p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{row.technician.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.technician.qra ? `${row.technician.qra} · ` : ''}
                      {row.serviceCount} OS
                    </div>
                  </div>
                  {renderRowStatus(row)}
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Valor bruto</dt>
                    <dd className="font-medium tabular-nums">{formatCurrency(row.totalServicesValue)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Em conta</dt>
                    <dd className="font-semibold tabular-nums">{formatCurrency(row.cashNetTotal)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Folha total</dt>
                    <dd className="font-medium tabular-nums">{formatCurrency(row.payrollNetTotal)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Lucro</dt>
                    <dd className={cn('font-semibold tabular-nums', row.profitValue >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{formatCurrency(row.profitValue)}</dd>
                  </div>
                </dl>

                <div className="mt-4">{renderRowActions(row)}</div>
              </div>
            ))}
          </div>

          {rows.length && !filteredRows.length ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhum técnico encontrado para “{query}”.</p> : null}
        </DataPanel>
      </div>

      <Dialog
        open={isPayrollDialogOpen}
        onOpenChange={(open) => {
          if (open) setIsPayrollDialogOpen(true);
          else void requestClose();
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)] sm:max-w-4xl">
          <DialogHeader className={MODAL_HEADER_CLASS}>
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle className={MODAL_TITLE_CLASS}>{selectedRow ? selectedRow.technician.name : 'Folha do técnico'}</DialogTitle>
              {payrollDraft ? (
                <StatusBadge tone={isClosed ? 'success' : draftStatus === 'draft' ? 'info' : 'warning'}>
                  {isClosed ? 'Fechada' : draftStatus === 'draft' ? 'Rascunho' : 'Nova'}
                </StatusBadge>
              ) : null}
            </div>
            <DialogDescription className={MODAL_DESCRIPTION_CLASS}>
              {formatCompetenceLabel(competenceMonth)}
              {selectedRow ? ` · ${selectedRow.serviceCount} OS${formatFortnights(selectedRow.serviceFortnightSummary) ? ` (${formatFortnights(selectedRow.serviceFortnightSummary)})` : ''}` : ''}
            </DialogDescription>
          </DialogHeader>

          <div className={cn(MODAL_BODY_CLASS, 'space-y-6')}>
            {draftError ? <ModalNotice tone="error">{draftError}</ModalNotice> : null}
            {isClosed ? (
              <ModalNotice tone="success">Esta folha está fechada e o técnico já a vê. Para mudar algum valor, reabra a folha.</ModalNotice>
            ) : selectedRow && selectedRow.serviceCount === 0 && payrollDraft ? (
              <ModalNotice tone="warning">Este técnico não tem OS nesta competência. Valem só os valores fixos do mês.</ModalNotice>
            ) : null}

            {isPreviewLoading && !payrollDraft ? (
              <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">Calculando valores...</div>
            ) : null}

            {payrollDraft ? (
              <>
                <SummaryBand
                  items={[
                    { label: 'Valor bruto', value: formatCurrency(payrollDraft.total_services_value) },
                    { label: 'Em conta', value: formatCurrency(payrollDraft.net_total) },
                    { label: 'Folha total', value: formatCurrency(draftPayrollNet) },
                    { label: 'Lucro gerado', value: formatCurrency(draftProfit), tone: draftProfit >= 0 ? 'good' : 'bad' },
                  ]}
                />

                <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
                  <div className="space-y-8">
                    <ModalSection title="Produção">
                      <div className="divide-y divide-border">
                        <AmountRow
                          label="Valor bruto das OS"
                          hint={selectedRow ? formatFortnights(selectedRow.serviceFortnightSummary, true) || 'Sem OS no mês' : undefined}
                          value={payrollDraft.total_services_value}
                          onChange={(value) => updateDraftNumber('total_services_value', value)}
                          readOnly={isClosed}
                        />
                      </div>
                    </ModalSection>

                    <ModalSection title="Pago em conta">
                      <div className="divide-y divide-border">
                        <AmountRow label="Salário base" value={payrollDraft.base_salary} onChange={(value) => updateDraftNumber('base_salary', value)} readOnly={isClosed} />
                        <AmountRow
                          label="Comissão"
                          hint={commissionAdjusted ? `Ajustada à mão. Pela fórmula: ${formatCurrency(formulaCommission)}` : undefined}
                          value={payrollDraft.commission_value}
                          onChange={(value) => updateDraftNumber('commission_value', value)}
                          readOnly={isClosed}
                        />
                        <AmountRow label="Horas extras" value={payrollDraft.extra_hours_value} onChange={(value) => updateDraftNumber('extra_hours_value', value)} readOnly={isClosed} />
                        <AmountRow
                          label="Prêmio por produção"
                          value={payrollDraft.extraordinary_award_value}
                          onChange={(value) => updateDraftNumber('extraordinary_award_value', value)}
                          readOnly={isClosed}
                        />
                        <AmountRow label="Descontos" value={payrollDraft.discounts_total} onChange={(value) => updateDraftNumber('discounts_total', value)} readOnly={isClosed} />
                        <AmountRow label="Adiantamentos" value={payrollDraft.advances_total} onChange={(value) => updateDraftNumber('advances_total', value)} readOnly={isClosed} />
                        <AmountRow
                          emphasis
                          label="Valor em conta"
                          hint={netAdjusted ? `Ajustado à mão. Pela soma acima: ${formatCurrency(formulaCashNet)}` : 'Soma dos ganhos menos descontos e adiantamentos'}
                          value={payrollDraft.net_total}
                          onChange={(value) => updateDraftNumber('net_total', value)}
                          readOnly={isClosed}
                        />
                      </div>
                      {netAdjusted && !isClosed ? (
                        <button
                          type="button"
                          onClick={() => updateDraftNumber('net_total', formulaCashNet)}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          Usar a soma ({formatCurrency(formulaCashNet)})
                        </button>
                      ) : null}
                    </ModalSection>
                  </div>

                  <div className="space-y-8">
                    <ModalSection title="Cartões" description="Pagos no cartão e abatidos da base da comissão.">
                      <div className="divide-y divide-border">
                        <AmountRow label="Vale-refeição (VR)" value={payrollDraft.vr_deduction} onChange={(value) => updateDraftNumber('vr_deduction', value)} readOnly={isClosed} />
                        <AmountRow label="Vale-alimentação (VA)" value={payrollDraft.va_deduction} onChange={(value) => updateDraftNumber('va_deduction', value)} readOnly={isClosed} />
                      </div>
                    </ModalSection>

                    <ModalSection title="Banco de horas">
                      <div className="divide-y divide-border">
                        <AmountRow
                          label="Saldo do mês"
                          unit="h"
                          value={payrollDraft.hour_bank_balance}
                          onChange={(value) => updateDraftNumber('hour_bank_balance', value)}
                          readOnly={isClosed}
                        />
                      </div>
                    </ModalSection>

                    <ModalSection
                      title="Como a comissão é calculada"
                      action={
                        commissionAdjusted && !isClosed ? (
                          <button type="button" onClick={applyCommissionFormula} className="text-sm font-medium text-primary hover:underline">
                            Usar a fórmula
                          </button>
                        ) : undefined
                      }
                    >
                      <dl className="space-y-1.5 rounded-xl bg-secondary/40 px-4 py-3 text-sm tabular-nums">
                        <div className="flex justify-between gap-4">
                          <dt className="text-muted-foreground">
                            {currentCommissionPercentage}% de {formatCurrency(payrollDraft.total_services_value)}
                          </dt>
                          <dd>{formatCurrency(draftBase)}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-muted-foreground">− salário base, VR e VA</dt>
                          <dd>− {formatCurrency(payrollDraft.base_salary + payrollDraft.vr_deduction + payrollDraft.va_deduction)}</dd>
                        </div>
                        <div className="flex justify-between gap-4 border-t border-border pt-1.5 font-semibold">
                          <dt>Comissão</dt>
                          <dd>{formatCurrency(formulaCommission)}</dd>
                        </div>
                      </dl>
                    </ModalSection>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'flex-col items-stretch sm:flex-row sm:items-center sm:justify-between')}>
            <div
              className={cn(
                'flex items-center gap-2 text-sm',
                autoSaveState === 'error' ? 'font-medium text-rose-600' : 'text-muted-foreground',
              )}
              aria-live="polite"
            >
              {autoSaveState === 'saving' ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : autoSaveState === 'error' ? (
                <AlertCircle className="h-4 w-4" />
              ) : (
                <CheckCircle2 className={cn('h-4 w-4', !isDirty && (lastSavedAt || isClosed) ? 'text-emerald-600' : '')} />
              )}
              <span>{saveStatus}</span>
            </div>

            <div className="flex flex-wrap gap-2 sm:items-center">
              {isClosed ? (
                <>
                  <Button type="button" variant="outline" onClick={() => selectedRow && openPayrollPdf(selectedRow)} disabled={!selectedRow?.payrollItem} className="flex-1 sm:flex-none">
                    <FileText className="h-4 w-4" />
                    Gerar PDF
                  </Button>
                  <Button type="button" variant="outline" onClick={reopenPayroll} disabled={autoSaveState === 'saving'} className="flex-1 sm:flex-none">
                    <LockOpen className="h-4 w-4" />
                    Reabrir folha
                  </Button>
                  <Button type="button" onClick={() => void requestClose()} className="order-first basis-full sm:order-none sm:basis-auto">
                    Fechar janela
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="ghost" onClick={recalculate} disabled={!selectedRow || isPreviewLoading || isClosing} className="flex-1 sm:flex-none">
                    <RefreshCw className={cn('h-4 w-4', isPreviewLoading && 'animate-spin')} />
                    {isPreviewLoading ? 'Recalculando' : 'Recalcular'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void requestClose()} disabled={isClosing || autoSaveState === 'saving'} className="flex-1 sm:flex-none">
                    {autoSaveState === 'error' ? 'Sair sem salvar' : 'Fechar janela'}
                  </Button>
                  <Button type="button" onClick={closePayroll} disabled={!payrollDraft || isClosing || isPreviewLoading || autoSaveState === 'saving'} className="order-first basis-full sm:order-none sm:basis-auto">
                    <CheckCircle2 className="h-4 w-4" />
                    {isClosing ? 'Fechando...' : 'Fechar folha'}
                  </Button>
                </>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
