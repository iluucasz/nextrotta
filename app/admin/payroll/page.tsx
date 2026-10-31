'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, FileText, LockOpen, RefreshCw, Search } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import {
  MODAL_BODY_CLASS,
  MODAL_DESCRIPTION_CLASS,
  MODAL_FOOTER_CLASS,
  MODAL_HEADER_CLASS,
  MODAL_TITLE_CLASS,
  HelpDot,
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
import type { CommissionMode } from '@/lib/organization-settings';
import { calculateServiceAward, valueOrDefault } from '@/lib/organization-settings';
import {
  awardProgress,
  calculateCashNet as sumCashNet,
  calculateCommissionValue,
  commissionBase,
  fixedCosts,
  type PayrollDetails,
} from '@/lib/payroll-rules';

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

/** 8,5 · 220 · 1,5 — no forced decimals. */
function hoursText(value: number) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

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

/** Fields that may be negative; everything else is clamped at zero (the API refuses negatives too). */
const signedFields: PayrollDraftField[] = ['hour_bank_balance', 'net_total'];
const MAX_AMOUNT = 99_999_999.99;

function formulaCommissionOf(draft: PayrollDraft, percentage: number, mode: CommissionMode) {
  return calculateCommissionValue({
    mode,
    totalServices: moneyValue(draft.total_services_value),
    percentage,
    baseSalary: moneyValue(draft.base_salary),
    vrAllowance: moneyValue(draft.vr_deduction),
    vaAllowance: moneyValue(draft.va_deduction),
  });
}

/** Salary + commission + overtime + award − discounts − advances: what goes to the technician's account. */
function calculateCashNet(draft: PayrollDraft) {
  return sumCashNet({
    baseSalary: moneyValue(draft.base_salary),
    commission: moneyValue(draft.commission_value),
    extraHours: moneyValue(draft.extra_hours_value),
    award: moneyValue(draft.extraordinary_award_value),
    discounts: moneyValue(draft.discounts_total),
    advances: moneyValue(draft.advances_total),
  });
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

function formatAmount(unit: 'R$' | 'h', value: number) {
  return unit === 'h' ? formatHours(value) : formatCurrency(value);
}

/**
 * One line of the folha: what it is (and how it came about) on the left, the amount to read or type on the
 * right. A value the admin changed shows what the system calculates, with a way back. A value that is
 * normally derived stays locked until "Ajustar" is pressed.
 */
function AmountRow({
  label,
  hint,
  value,
  onChange,
  unit = 'R$',
  sign,
  readOnly = false,
  allowNegative = false,
  calculated = null,
  onRestore,
  locked = false,
  onUnlock,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  unit?: 'R$' | 'h';
  /** "−" for a deduction: only a visual cue, the amount itself is always positive. */
  sign?: '−';
  readOnly?: boolean;
  allowNegative?: boolean;
  /** What the system calculates for this line (null = unknown). */
  calculated?: number | null;
  onRestore?: () => void;
  locked?: boolean;
  onUnlock?: () => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const adjusted = !readOnly && calculated !== null && roundMoney(value) !== roundMoney(calculated);
  const frozen = readOnly || locked;

  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0 pt-2">
        <div className="flex items-center gap-2">
          <label htmlFor={id} className="text-sm text-foreground">
            {label}
          </label>
          {hint || adjusted ? (
            <HelpDot
              label={label}
              text={[hint, adjusted && calculated !== null ? `O sistema calcula ${formatAmount(unit, calculated)}.` : null].filter(Boolean).join('\n')}
            />
          ) : null}
        </div>
        {adjusted && onRestore ? (
          <p className="mt-0.5 text-xs leading-snug text-amber-700">
            Ajustado ·{' '}
            <button type="button" onClick={onRestore} className="font-medium underline underline-offset-2 hover:text-amber-900">
              Restaurar
            </button>
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={cn(
            'flex h-10 w-40 items-center gap-1.5 rounded-lg border px-3 transition',
            frozen ? 'border-transparent bg-secondary/50' : 'border-border bg-background focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
            adjusted && !frozen ? 'border-amber-300' : '',
          )}
        >
          <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{sign ? `${sign} ${unit}` : unit}</span>
          <input
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            readOnly={frozen}
            value={editing ? text : numberFormat.format(value)}
            onFocus={(event) => {
              if (frozen) return;
              setText(value === 0 ? '' : String(value).replace('.', ','));
              setEditing(true);
              event.currentTarget.select();
            }}
            onChange={(event) => {
              // Digits, a decimal comma (or dot) and, only where it makes sense, a leading minus.
              const typed = event.target.value.replace(allowNegative ? /[^\d.,-]/g : /[^\d.,]/g, '');
              const nextText = typed.replace(/(?!^)-/g, '');
              setText(nextText);
              const parsed = parseMoneyText(nextText, value);
              onChange(Math.max(allowNegative ? -MAX_AMOUNT : 0, Math.min(MAX_AMOUNT, parsed)));
            }}
            onKeyDown={(event) => {
              // Enter confirms the value; it must never submit or close anything.
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            onBlur={() => setEditing(false)}
            className="w-full min-w-0 bg-transparent text-right text-sm font-medium tabular-nums outline-none"
          />
        </span>
        {locked && !readOnly && onUnlock ? (
          <button type="button" onClick={onUnlock} className="text-xs font-medium text-primary hover:underline">
            Ajustar
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** A subtotal under a group of lines. */
function TotalLine({ label, value, sign }: { label: string; value: number; sign?: '−' }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border pt-3 text-sm font-semibold tabular-nums">
      <span>{label}</span>
      <span>
        {sign ? `${sign} ` : ''}
        {formatCurrency(value)}
      </span>
    </div>
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
  // What the system calculates for this folha (to show what was changed by hand) and how it got there.
  const [calculated, setCalculated] = useState<PayrollDraft | null>(null);
  const [details, setDetails] = useState<PayrollDetails | null>(null);
  // Normally derived values (gross, commission, final amount) stay locked until "Ajustar" is pressed.
  const [unlocked, setUnlocked] = useState<Set<PayrollDraftField>>(new Set());
  const activeTechnicianRef = useRef('');
  const commissionMode: CommissionMode = organizationSettings.commissionMode ?? 'excess';
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
          : calculateCommissionValue({
              mode: commissionMode,
              totalServices: totalServicesValue,
              percentage: commissionPercentage,
              baseSalary,
              vrAllowance,
              vaAllowance,
            });
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
  }, [commissionMode, competenceMonth, discounts, organizationSettings, payroll, services, technicians]);

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
    activeTechnicianRef.current = '';
    setSelectedRow(null);
    setPayrollDraft(null);
    setCalculated(null);
    setDetails(null);
    setUnlocked(new Set());
    setDraftError('');
    setIsPreviewLoading(false);
    setIsClosing(false);
    setIsDirty(false);
    setAutoSaveState('idle');
    setLastSavedAt(null);
    setDraftStatus('none');
  }

  /** What the system calculates for this technician and month, with how it got there. Null when it fails. */
  async function fetchPreview(row: PayrollRow) {
    try {
      const response = await fetch('/api/payroll/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ technicianId: row.technician.id, competenceMonth }),
      });
      if (!response.ok) return null;

      const data = await response.json();
      return { draft: normalizeDraft(data.payroll), details: (data.payroll?.details ?? null) as PayrollDetails | null };
    } catch {
      return null;
    }
  }

  async function loadPreview(row: PayrollRow) {
    setIsPreviewLoading(true);
    setOpeningTechnicianId(row.technician.id);
    setDraftError('');

    const preview = await fetchPreview(row);
    if (activeTechnicianRef.current === row.technician.id) {
      if (preview) {
        setPayrollDraft(preview.draft);
        setCalculated(preview.draft);
        setDetails(preview.details);
      } else {
        setPayrollDraft(createDraftFromRow(row, competenceMonth));
        setDraftError('Não foi possível recalcular automaticamente. Revise os valores antes de fechar.');
      }
    }

    setIsPreviewLoading(false);
    setOpeningTechnicianId('');
    return Boolean(preview);
  }

  async function openPayrollDialog(row: PayrollRow) {
    activeTechnicianRef.current = row.technician.id;
    setSelectedRow(row);
    setIsPayrollDialogOpen(true);
    setDraftError('');
    setIsDirty(false);
    setCalculated(null);
    setDetails(null);
    setUnlocked(new Set());
    setAutoSaveState('idle');
    setLastSavedAt(row.payrollItem?.updated_at ? new Date(row.payrollItem.updated_at) : null);
    setDraftStatus(row.payrollItem ? (row.payrollItem.status === 'closed' ? 'closed' : 'draft') : 'none');

    if (!row.payrollItem) {
      setPayrollDraft(null);
      await loadPreview(row);
      return;
    }

    // Already saved (draft or closed): show exactly what was saved, no recalculation.
    setPayrollDraft(createDraftFromRow(row, competenceMonth));

    // A draft is still being worked on: ask the system what it calculates now, to show what differs.
    if (row.payrollItem.status !== 'closed') {
      const preview = await fetchPreview(row);
      if (preview && activeTechnicianRef.current === row.technician.id) {
        setCalculated(preview.draft);
        setDetails(preview.details);
      }
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

  function updateDraftNumber(field: PayrollDraftField, rawValue: number) {
    if (isClosed) return;

    const value = signedFields.includes(field) ? rawValue : Math.max(0, rawValue);
    setIsDirty(true);
    setPayrollDraft((current) => {
      if (!current) return current;

      const next = { ...current, [field]: roundMoney(value) };

      // A commission set by hand is kept; one that was following the rule keeps following it.
      if (commissionFormulaFields.includes(field)) {
        const wasAutomatic = roundMoney(current.commission_value) === formulaCommissionOf(current, currentCommissionPercentage, commissionMode);
        if (wasAutomatic) next.commission_value = formulaCommissionOf(next, currentCommissionPercentage, commissionMode);
      }

      if (field !== 'net_total') {
        // A hand-set "em conta" keeps its adjustment when something else changes, instead of being thrown away.
        const adjustment = roundMoney(current.net_total - calculateCashNet(current));
        next.net_total = roundMoney(calculateCashNet(next) + adjustment);
      }

      return next;
    });
  }

  function unlock(field: PayrollDraftField) {
    setUnlocked((current) => new Set(current).add(field));
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

  const draft = payrollDraft;
  const money = formatCurrency;
  const formulaCommission = draft ? formulaCommissionOf(draft, currentCommissionPercentage, commissionMode) : 0;
  const cashSum = draft ? calculateCashNet(draft) : 0;
  const draftPayrollNet = draft ? calculatePayrollNet(draft) : 0;
  const draftProfit = draft ? roundMoney(draft.total_services_value - draftPayrollNet) : 0;
  const draftBase = draft ? commissionBase(draft.total_services_value, currentCommissionPercentage) : 0;
  const draftFixed = draft ? fixedCosts(draft.base_salary, draft.vr_deduction, draft.va_deduction) : 0;
  const earningsTotal = draft ? roundMoney(draft.base_salary + draft.commission_value + draft.extra_hours_value + draft.extraordinary_award_value) : 0;
  const deductionsTotal = draft ? roundMoney(draft.discounts_total + draft.advances_total) : 0;
  const cardsTotal = draft ? calculateBenefitTotal(draft) : 0;
  const netAdjustment = draft ? roundMoney(draft.net_total - cashSum) : 0;

  /** What the system calculates for a line (null when unknown), to show what was changed by hand. */
  function systemValue(field: PayrollDraftField): number | null {
    if (!draft) return null;
    if (field === 'commission_value') return formulaCommission;
    if (field === 'net_total') return cashSum;
    return calculated ? Number(calculated[field]) : null;
  }

  function isAdjusted(field: PayrollDraftField) {
    const system = systemValue(field);
    return !isClosed && Boolean(draft) && system !== null && roundMoney(draft![field] as number) !== roundMoney(system);
  }

  function lineProps(field: PayrollDraftField, extra: { locked?: boolean } = {}) {
    return {
      value: Number(draft?.[field] ?? 0),
      onChange: (value: number) => updateDraftNumber(field, value),
      readOnly: isClosed,
      calculated: isClosed ? null : systemValue(field),
      onRestore: () => {
        const system = systemValue(field);
        if (system !== null) updateDraftNumber(field, system);
      },
      ...(extra.locked ? { locked: !unlocked.has(field) && !isAdjusted(field), onUnlock: () => unlock(field) } : {}),
    };
  }

  const adjustedLabels = (
    [
      ['total_services_value', 'Valor bruto'],
      ['base_salary', 'Salário base'],
      ['commission_value', 'Comissão'],
      ['extra_hours_value', 'Horas extras'],
      ['extraordinary_award_value', 'Prêmio'],
      ['discounts_total', 'Descontos'],
      ['advances_total', 'Adiantamentos'],
      ['vr_deduction', 'VR'],
      ['va_deduction', 'VA'],
      ['hour_bank_balance', 'Banco de horas'],
      ['net_total', 'Valor em conta'],
    ] as Array<[PayrollDraftField, string]>
  )
    .filter(([field]) => isAdjusted(field))
    .map(([, label]) => label);

  const awardTiers = organizationSettings.serviceAwardTiers;
  const showCommission = commissionMode !== 'none' || Boolean(draft?.commission_value);
  const showAward = awardTiers.length > 0 || Boolean(draft?.extraordinary_award_value);

  let commissionHint: string | undefined;
  if (draft) {
    if (commissionMode === 'none') {
      commissionHint = 'A empresa não paga comissão (Configurações).';
    } else if (commissionMode === 'percentage') {
      commissionHint = `${currentCommissionPercentage}% de ${money(draft.total_services_value)}`;
    } else {
      commissionHint = `${currentCommissionPercentage}% de ${money(draft.total_services_value)} = ${money(draftBase)}
menos o fixo de ${money(draftFixed)} (salário + VR + VA)`;
      if (draftBase <= draftFixed) commissionHint += `
Ainda não passou do fixo: faltam ${money(roundMoney(draftFixed - draftBase))} de produção.`;
    }
  }

  let overtimeHint: string | undefined;
  if (details && draft && !isClosed) {
    if (!(draft.base_salary > 0)) overtimeHint = 'Sem salário base, a hora extra não tem valor.';
    else if (details.extraHours > 0)
      overtimeHint = `${hoursText(details.extraHours)} h acima de ${hoursText(details.monthlyHours)} h
× ${money(details.hourlyRate)} por hora × ${hoursText(details.overtimeMultiplier)}`;
    else overtimeHint = `${hoursText(details.totalHours)} h trabalhadas de ${hoursText(details.monthlyHours)} h: sem horas extras.`;
  }

  let awardHint: string | undefined;
  if (selectedRow && awardTiers.length) {
    const progress = awardProgress(selectedRow.serviceCount, awardTiers);
    if (progress.reached) awardHint = `${selectedRow.serviceCount} OS: faixa de ${progress.reached.minServices} OS atingida.`;
    else if (progress.next)
      awardHint = `${selectedRow.serviceCount} OS: faltam ${progress.next.minServices - selectedRow.serviceCount} para o prêmio de ${money(progress.next.amount)}.`;
  }

  const bankHint = details && !isClosed
    ? `${hoursText(details.previousHourBank)} h do mês anterior + ${hoursText(details.extraHours)} h deste mês.
Só informativo: não entra no valor em conta.`
    : 'Só informativo: não entra no valor em conta.';

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

            {draft ? (
              <>
                <SummaryBand
                  items={[
                    { label: 'Valor bruto', value: money(draft.total_services_value) },
                    { label: 'Em conta', value: money(draft.net_total) },
                    { label: 'Folha total', value: money(draftPayrollNet) },
                    { label: 'Lucro gerado', value: money(draftProfit), tone: draftProfit >= 0 ? 'good' : 'bad' },
                  ]}
                />

                {adjustedLabels.length ? (
                  <p className="text-sm text-amber-800">
                    Ajustado à mão: {adjustedLabels.join(', ')}.
                  </p>
                ) : null}

                <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[1.15fr_1fr]">
                  <div className="space-y-8">
                    <ModalSection title="Ganhos">
                      <div className="divide-y divide-border">
                        <AmountRow label="Salário base" {...lineProps('base_salary')} />
                        {showCommission ? <AmountRow label="Comissão" hint={commissionHint} {...lineProps('commission_value', { locked: true })} /> : null}
                        <AmountRow label="Horas extras" hint={overtimeHint} {...lineProps('extra_hours_value')} />
                        {showAward ? <AmountRow label="Prêmio por produção" hint={awardHint} {...lineProps('extraordinary_award_value')} /> : null}
                      </div>
                      <TotalLine label="Total de ganhos" value={earningsTotal} />
                    </ModalSection>

                    <ModalSection title="Descontos">
                      <div className="divide-y divide-border">
                        <AmountRow label="Descontos" sign="−" {...lineProps('discounts_total')} />
                        <AmountRow label="Adiantamentos" sign="−" {...lineProps('advances_total')} />
                      </div>
                      <TotalLine label="Total de descontos" value={deductionsTotal} sign="−" />
                    </ModalSection>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-4 rounded-xl bg-primary px-5 py-4 text-primary-foreground">
                        <div>
                          <p className="text-base font-semibold">Valor em conta</p>
                        </div>
                        <p className="text-2xl font-semibold tabular-nums">{money(draft.net_total)}</p>
                      </div>

                      {isClosed ? (
                        netAdjustment !== 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Valor ajustado à mão: a soma dos ganhos e descontos daria {money(cashSum)}.
                          </p>
                        ) : null
                      ) : unlocked.has('net_total') || netAdjustment !== 0 ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-1">
                          <AmountRow
                            label="Valor em conta final"
                            hint="Use só para combinar um valor diferente da soma de ganhos menos descontos."
                            allowNegative
                            {...lineProps('net_total')}
                          />
                        </div>
                      ) : (
                        <button type="button" onClick={() => unlock('net_total')} className="text-sm font-medium text-primary hover:underline">
                          Ajustar o valor em conta manualmente
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-8">
                    <ModalSection title="Produção do mês">
                      <div className="divide-y divide-border">
                        <AmountRow
                          label="Valor bruto das OS"
                          hint={selectedRow ? `${selectedRow.serviceCount} OS${formatFortnights(selectedRow.serviceFortnightSummary, true) ? `\n${formatFortnights(selectedRow.serviceFortnightSummary, true)}` : ''}` : undefined}
                          {...lineProps('total_services_value', { locked: true })}
                        />
                      </div>
                    </ModalSection>

                    <ModalSection
                      title="Cartões"
                      help={
                        commissionMode === 'excess'
                          ? 'Pagos no cartão, fora do valor em conta. Contam como fixo: a comissão só começa depois deles.'
                          : 'Pagos no cartão, fora do valor em conta.'
                      }
                    >
                      <div className="divide-y divide-border">
                        <AmountRow label="Vale-refeição (VR)" {...lineProps('vr_deduction')} />
                        <AmountRow label="Vale-alimentação (VA)" {...lineProps('va_deduction')} />
                      </div>
                      <TotalLine label="Total nos cartões" value={cardsTotal} />
                    </ModalSection>

                    <ModalSection title="Banco de horas">
                      <div className="divide-y divide-border">
                        <AmountRow label="Saldo acumulado" unit="h" hint={bankHint} allowNegative {...lineProps('hour_bank_balance')} />
                      </div>
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
