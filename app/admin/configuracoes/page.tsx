'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { LoadingShell } from '@/components/page-skeleton';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useAppSession } from '@/hooks/use-app-session';
import { resetOrganizationSettingsCache } from '@/hooks/use-organization-settings';
import {
  DEFAULT_ORGANIZATION_SETTINGS,
  PORTO_LAUDO_PENDING_MARKER,
  PORTO_WARNING_MARKER,
  buildPortoWarningNote,
  endOfWorkDayMinutes,
  normalizeOrganizationSettings,
  overtimeMultiplierFromPercent,
  overtimePercentFromMultiplier,
  type OrganizationSettings,
} from '@/lib/organization-settings';

type NumericKey =
  | 'commissionPercentage'
  | 'baseSalary'
  | 'vaAllowance'
  | 'vrAllowance'
  | 'monthlyHours'
  | 'overtimePercent'
  | 'dailyBreakMinutes'
  | 'monthlyHoursWarningFloor'
  | 'fortnightSplitDay'
  | 'portoReprocessDays'
  | 'portoMaxShiftHours'
  | 'portoNextMonthLookaheadDays'
  | 'portoFullDayOffPercent'
  | 'portoLaudoGraceHours'
  | 'financeDueSoonDays';

type TimeKey = 'defaultShiftStart' | 'defaultShiftEnd' | 'portoHoursImportTime' | 'portoScheduleImportTime';
type BooleanKey = 'chargeCancelledServicePlanned' | 'portoUseLaudoConclusion' | 'portoWarningEnabled' | 'portoRecordCancelledDays';

type FormState = Record<NumericKey, string> &
  Record<TimeKey, string> &
  Record<BooleanKey, boolean> & {
    portoWarningText: string;
    portoAlertPhone: string;
    tiers: Array<{ id: number; minServices: string; amount: string }>;
    financeCategories: string[];
  };

const inputClassName =
  'min-h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring';

let nextTierId = 1;

/** Shows numbers the Brazilian way (comma decimals) without trailing zeros. */
function formatNumber(value: number) {
  return String(Number(value.toFixed(2))).replace('.', ',');
}

/** Accepts "1.234,56", "1234,56" or "1234.56". Returns NaN for anything else. */
function parseNumber(value: string) {
  const trimmed = value.trim().replace(/\s/g, '');
  if (!trimmed) return Number.NaN;
  const normalized = trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed;
  return Number(normalized);
}

function toForm(settings: OrganizationSettings): FormState {
  return {
    commissionPercentage: formatNumber(settings.commissionPercentage),
    baseSalary: formatNumber(settings.baseSalary),
    vaAllowance: formatNumber(settings.vaAllowance),
    vrAllowance: formatNumber(settings.vrAllowance),
    monthlyHours: formatNumber(settings.monthlyHours),
    overtimePercent: formatNumber(overtimePercentFromMultiplier(settings.overtimeMultiplier)),
    dailyBreakMinutes: String(settings.dailyBreakMinutes),
    monthlyHoursWarningFloor: formatNumber(settings.monthlyHoursWarningFloor),
    fortnightSplitDay: String(settings.fortnightSplitDay),
    portoReprocessDays: String(settings.portoReprocessDays),
    portoMaxShiftHours: formatNumber(settings.portoMaxShiftHours),
    portoNextMonthLookaheadDays: String(settings.portoNextMonthLookaheadDays),
    portoFullDayOffPercent: formatNumber(settings.portoFullDayOffPercent),
    portoLaudoGraceHours: formatNumber(settings.portoLaudoGraceHours),
    financeDueSoonDays: String(settings.financeDueSoonDays),
    defaultShiftStart: settings.defaultShiftStart,
    defaultShiftEnd: settings.defaultShiftEnd,
    portoHoursImportTime: settings.portoHoursImportTime,
    portoScheduleImportTime: settings.portoScheduleImportTime,
    chargeCancelledServicePlanned: settings.chargeCancelledServicePlanned,
    portoUseLaudoConclusion: settings.portoUseLaudoConclusion,
    portoWarningEnabled: settings.portoWarningEnabled,
    portoRecordCancelledDays: settings.portoRecordCancelledDays,
    portoWarningText: settings.portoWarningText,
    portoAlertPhone: settings.portoAlertPhone,
    tiers: settings.serviceAwardTiers.map((tier) => ({ id: nextTierId++, minServices: String(tier.minServices), amount: formatNumber(tier.amount) })),
    financeCategories: [...settings.financeCategories],
  };
}

function toPayload(form: FormState) {
  const number = (key: NumericKey) => parseNumber(form[key]);
  return {
    commissionPercentage: number('commissionPercentage'),
    baseSalary: number('baseSalary'),
    vaAllowance: number('vaAllowance'),
    vrAllowance: number('vrAllowance'),
    monthlyHours: number('monthlyHours'),
    overtimeMultiplier: Number.isFinite(number('overtimePercent')) ? overtimeMultiplierFromPercent(number('overtimePercent')) : Number.NaN,
    dailyBreakMinutes: number('dailyBreakMinutes'),
    defaultShiftStart: form.defaultShiftStart,
    defaultShiftEnd: form.defaultShiftEnd,
    monthlyHoursWarningFloor: number('monthlyHoursWarningFloor'),
    fortnightSplitDay: number('fortnightSplitDay'),
    chargeCancelledServicePlanned: form.chargeCancelledServicePlanned,
    serviceAwardTiers: form.tiers.map((tier) => ({ minServices: parseNumber(tier.minServices), amount: parseNumber(tier.amount) })),
    portoHoursImportTime: form.portoHoursImportTime,
    portoScheduleImportTime: form.portoScheduleImportTime,
    portoReprocessDays: number('portoReprocessDays'),
    portoMaxShiftHours: number('portoMaxShiftHours'),
    portoNextMonthLookaheadDays: number('portoNextMonthLookaheadDays'),
    portoFullDayOffPercent: number('portoFullDayOffPercent'),
    portoLaudoGraceHours: number('portoLaudoGraceHours'),
    portoUseLaudoConclusion: form.portoUseLaudoConclusion,
    portoWarningEnabled: form.portoWarningEnabled,
    portoWarningText: form.portoWarningText,
    portoAlertPhone: form.portoAlertPhone,
    portoRecordCancelledDays: form.portoRecordCancelledDays,
    financeDueSoonDays: number('financeDueSoonDays'),
    financeCategories: form.financeCategories,
  };
}

function FieldShell({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function NumberField({
  id,
  label,
  unit,
  unitPosition = 'end',
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  unit: string;
  unitPosition?: 'start' | 'end';
  hint?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FieldShell label={label} hint={hint} htmlFor={id}>
      <div className="flex items-stretch">
        {unitPosition === 'start' ? (
          <span className="flex items-center rounded-l-md border border-r-0 border-input bg-secondary/50 px-3 text-sm text-muted-foreground">{unit}</span>
        ) : null}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClassName} ${unitPosition === 'start' ? 'rounded-l-none' : 'rounded-r-none'}`}
        />
        {unitPosition === 'end' ? (
          <span className="flex items-center rounded-r-md border border-l-0 border-input bg-secondary/50 px-3 text-sm text-muted-foreground">{unit}</span>
        ) : null}
      </div>
    </FieldShell>
  );
}

function TimeField({ id, label, hint, value, onChange }: { id: string; label: string; hint?: string; value: string; onChange: (value: string) => void }) {
  return (
    <FieldShell label={label} hint={hint} htmlFor={id}>
      <input id={id} type="time" value={value} onChange={(event) => onChange(event.target.value)} className={inputClassName} />
    </FieldShell>
  );
}

function ToggleRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-secondary/40 px-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

export default function ConfiguracoesPage() {
  const { user, loading } = useAppSession();
  const [form, setForm] = useState<FormState>(() => toForm(DEFAULT_ORGANIZATION_SETTINGS));
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [newCategory, setNewCategory] = useState('');

  useEffect(() => {
    if (loading || !user) return;
    let mounted = true;

    fetch('/api/organization-settings', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || 'Não foi possível carregar as configurações.');
        if (!mounted) return;
        setForm(toForm(normalizeOrganizationSettings(data?.settings)));
        setUpdatedAt(data?.updatedAt ?? null);
      })
      .catch((error) => {
        if (mounted) setDataError(error instanceof Error ? error.message : 'Não foi possível carregar as configurações.');
      })
      .finally(() => {
        if (mounted) setIsDataLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [loading, user]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaveMessage('');
  }

  function updateTier(id: number, changes: Partial<{ minServices: string; amount: string }>) {
    setForm((current) => ({ ...current, tiers: current.tiers.map((tier) => (tier.id === id ? { ...tier, ...changes } : tier)) }));
    setSaveMessage('');
  }

  function addCategory() {
    const category = newCategory.trim();
    if (!category) return;
    if (form.financeCategories.some((existing) => existing.toLocaleLowerCase('pt-BR') === category.toLocaleLowerCase('pt-BR'))) {
      setSaveError(`A categoria "${category}" já existe.`);
      return;
    }
    update('financeCategories', [...form.financeCategories, category]);
    setNewCategory('');
    setSaveError('');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setSaveMessage('');
    setSaveError('');

    try {
      const response = await fetch('/api/organization-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: toPayload(form) }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível salvar as configurações.');

      setForm(toForm(normalizeOrganizationSettings(data?.settings)));
      setUpdatedAt(data?.updatedAt ?? null);
      resetOrganizationSettingsCache();
      setSaveMessage('Configurações salvas.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Não foi possível salvar as configurações.');
    } finally {
      setIsSaving(false);
    }
  }

  if (loading || isDataLoading || !user) {
    return <LoadingShell role="admin" />;
  }

  const warningPreview = buildPortoWarningNote(form.portoWarningText || '…', '6054881/26');
  // Before today's work is over, "Fim do expediente" reports the previous day (see endOfWorkDayMinutes).
  const endOfDay = /^\d{2}:\d{2}$/.test(form.defaultShiftEnd) ? endOfWorkDayMinutes({ defaultShiftEnd: form.defaultShiftEnd }) : null;
  const endOfDayLabel = endOfDay === null ? '' : `${String(Math.floor(endOfDay / 60)).padStart(2, '0')}:${String(endOfDay % 60).padStart(2, '0')}`;
  const hoursRunBeforeEndOfDay =
    endOfDay !== null && /^\d{2}:\d{2}$/.test(form.portoHoursImportTime) && Number(form.portoHoursImportTime.slice(0, 2)) * 60 + Number(form.portoHoursImportTime.slice(3, 5)) < endOfDay;
  const hoursTimeHint = hoursRunBeforeEndOfDay
    ? `Horário de Brasília em que a importação entra na fila do robô. Antes das ${endOfDayLabel} (2h após o fim do turno padrão) o dia ainda não acabou: a mensagem de fim de expediente sai com o dia anterior, e o dia de hoje é completado na próxima execução.`
    : 'Horário de Brasília em que a importação entra na fila do robô (pode começar alguns minutos depois, se houver outras empresas na frente). Ao terminar, sai a mensagem de fim de expediente. Pode ser qualquer horário: o dia de hoje é sempre conferido de novo na próxima execução.';

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader eyebrow="EMPRESA" title="Configurações" description="Regras usadas nos cálculos de folha, banco de horas e metas dos técnicos." />

      {dataError ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{dataError}</div> : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <DataPanel title="Padrões dos técnicos" description="Usados para o técnico que não tem valor próprio no cadastro e como valor inicial de um técnico novo.">
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField id="commission" label="Comissão" unit="%" hint="Percentual sobre o total das OS." value={form.commissionPercentage} onChange={(value) => update('commissionPercentage', value)} />
              <NumberField id="base-salary" label="Salário base" unit="R$" unitPosition="start" value={form.baseSalary} onChange={(value) => update('baseSalary', value)} />
              <NumberField id="va" label="Vale-alimentação (VA)" unit="R$" unitPosition="start" value={form.vaAllowance} onChange={(value) => update('vaAllowance', value)} />
              <NumberField id="vr" label="Vale-refeição (VR)" unit="R$" unitPosition="start" value={form.vrAllowance} onChange={(value) => update('vrAllowance', value)} />
            </div>
          </DataPanel>

          <DataPanel title="Jornada e horas" description="Base do banco de horas e do cálculo de horas extras.">
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField id="monthly-hours" label="Jornada mensal" unit="horas" hint="Meta de horas do mês e divisor do valor da hora." value={form.monthlyHours} onChange={(value) => update('monthlyHours', value)} />
              <NumberField id="overtime" label="Adicional de hora extra" unit="%" hint="50% = hora extra vale 1,5 hora normal." value={form.overtimePercent} onChange={(value) => update('overtimePercent', value)} />
              <NumberField id="break" label="Intervalo diário" unit="min" hint="Descontado de cada dia ao calcular horas trabalhadas (escala e importação do Porto)." value={form.dailyBreakMinutes} onChange={(value) => update('dailyBreakMinutes', value)} />
              <NumberField id="hours-floor" label="Alerta de horas no painel do técnico" unit="horas" hint="Abaixo disso o card de horas do mês fica vermelho; entre esse valor e a jornada, amarelo." value={form.monthlyHoursWarningFloor} onChange={(value) => update('monthlyHoursWarningFloor', value)} />
              <TimeField id="shift-start" label="Início do turno padrão" hint="Usado em escalas novas, no apontamento e quando o Porto não informa o turno." value={form.defaultShiftStart} onChange={(value) => update('defaultShiftStart', value)} />
              <TimeField id="shift-end" label="Fim do turno padrão" value={form.defaultShiftEnd} onChange={(value) => update('defaultShiftEnd', value)} />
              <NumberField id="fortnight" label="Último dia da Q1" unit="dia" hint="Para serviço sem quinzena informada: até este dia é Q1, depois é Q2." value={form.fortnightSplitDay} onChange={(value) => update('fortnightSplitDay', value)} />
            </div>
            <div className="mt-4">
              <ToggleRow
                title="Dia de serviço cancelado cobra as horas previstas"
                description="Desligado: as horas apontadas contam e o previsto do dia não é cobrado no banco de horas. Ligado: é tratado como um dia normal (horas − previsto)."
                checked={form.chargeCancelledServicePlanned}
                onChange={(value) => update('chargeCancelledServicePlanned', value)}
              />
            </div>
          </DataPanel>
        </div>

        <DataPanel
          title="Prêmio por produção"
          description="Valor pago na folha quando o técnico atinge a quantidade de OS no mês. As faixas também aparecem como metas no painel do técnico. Sem faixas, não há prêmio nem metas."
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => update('tiers', [...form.tiers, { id: nextTierId++, minServices: '', amount: '' }])}>
              <Plus className="h-4 w-4" />
              Adicionar faixa
            </Button>
          }
        >
          {form.tiers.length ? (
            <div className="flex flex-col gap-3">
              {form.tiers.map((tier, index) => (
                <div key={tier.id} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <NumberField id={`tier-${tier.id}-min`} label={`Faixa ${index + 1}: a partir de`} unit="OS" value={tier.minServices} onChange={(value) => updateTier(tier.id, { minServices: value })} />
                  <NumberField id={`tier-${tier.id}-amount`} label="Prêmio" unit="R$" unitPosition="start" value={tier.amount} onChange={(value) => updateTier(tier.id, { amount: value })} />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={`Remover faixa ${index + 1}`}
                    onClick={() => update('tiers', form.tiers.filter((item) => item.id !== tier.id))}
                    className="h-10 w-10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">Vale o prêmio da maior faixa atingida no mês.</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma faixa de prêmio configurada.</p>
          )}
        </DataPanel>

        <DataPanel
          title="Robô do Porto"
          description="Regras da importação automática de horas e escala do Portal do Prestador. As credenciais e o liga/desliga da automação ficam em Config. Porto."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TimeField id="porto-hours-time" label="Importação de horas" hint={hoursTimeHint} value={form.portoHoursImportTime} onChange={(value) => update('portoHoursImportTime', value)} />
            <TimeField id="porto-schedule-time" label="Importação da escala" hint="A escala é importada logo depois das horas, de hoje até o fim do mês. Este horário só vale quando a importação de horas não rodou." value={form.portoScheduleImportTime} onChange={(value) => update('portoScheduleImportTime', value)} />
            <NumberField id="porto-reprocess" label="Dias reprocessados" unit="dias" hint="Além de hoje, quantos dias para trás são recalculados em toda execução (mínimo 1 = ontem e hoje). Dias manuais e com advertência nunca são recalculados." value={form.portoReprocessDays} onChange={(value) => update('portoReprocessDays', value)} />
            <NumberField id="porto-max-hours" label="Máximo de horas por dia" unit="horas" hint="Um dia calculado acima disso é rejeitado como inválido." value={form.portoMaxShiftHours} onChange={(value) => update('portoMaxShiftHours', value)} />
            <NumberField id="porto-lookahead" label="Escala do mês seguinte" unit="dias" hint="Nos últimos N dias do mês também importa o mês seguinte, se já estiver publicado (0 = não importa)." value={form.portoNextMonthLookaheadDays} onChange={(value) => update('portoNextMonthLookaheadDays', value)} />
            <NumberField id="porto-day-off" label="Folga integral a partir de" unit="%" hint="Quanto do turno uma indisponibilidade precisa cobrir para o dia contar como folga." value={form.portoFullDayOffPercent} onChange={(value) => update('portoFullDayOffPercent', value)} />
            <FieldShell
              label="WhatsApp para alertas do robô"
              htmlFor="porto-alert-phone"
              hint="Recebe, pelo WhatsApp da empresa, um aviso quando a importação automática falha ou termina com avisos (credenciais, técnico fora da lista do Porto, QRA repetido, laudos). Mudanças de tela do Porto ficam com a equipe do NextRotta. Vazio = sem alertas."
            >
              <input
                id="porto-alert-phone"
                type="tel"
                inputMode="tel"
                value={form.portoAlertPhone}
                onChange={(event) => update('portoAlertPhone', event.target.value)}
                placeholder="(11) 99999-9999"
                className={inputClassName}
              />
            </FieldShell>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <ToggleRow
              title="Usar a conclusão do laudo quando não houver assinatura"
              description="Ligado: sem assinatura, o fim do dia é a data de conclusão do laudo. Desligado: vai direto para o horário de Concluído."
              checked={form.portoUseLaudoConclusion}
              onChange={(value) => update('portoUseLaudoConclusion', value)}
            />
            <ToggleRow
              title="Registrar dias de serviço cancelado"
              description="Dia em que todos os serviços foram cancelados entra como “Serviço cancelado”. Desligado, o dia fica sem apontamento."
              checked={form.portoRecordCancelledDays}
              onChange={(value) => update('portoRecordCancelledDays', value)}
            />
          </div>

          <div className="mt-4 flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50/60 p-3">
            <ToggleRow
              title="Advertência por laudo não preenchido"
              description="Quando o laudo do último serviço do dia não foi preenchido, o fim do dia vem do Concluído e o apontamento recebe a advertência. Uma advertência dada nunca é retirada pelo robô."
              checked={form.portoWarningEnabled}
              onChange={(value) => update('portoWarningEnabled', value)}
            />
            <FieldShell label="Texto da advertência" htmlFor="porto-warning-text" hint={`Vai depois de "${PORTO_WARNING_MARKER}", que é fixo. Use {servico} para o número do serviço.`}>
              <textarea
                id="porto-warning-text"
                rows={2}
                value={form.portoWarningText}
                onChange={(event) => update('portoWarningText', event.target.value)}
                disabled={!form.portoWarningEnabled}
                className={`${inputClassName} py-2`}
              />
            </FieldShell>
            <p className="text-xs text-muted-foreground">
              Exemplo na observação: <span className="font-medium text-foreground">{warningPreview}</span>
            </p>
            <div className="sm:max-w-xs">
              <NumberField
                id="porto-laudo-grace"
                label="Prazo para preencher o laudo"
                unit="horas"
                hint={`Contado do Concluído. Se o robô passar antes, o dia fica como "${PORTO_LAUDO_PENDING_MARKER}" e é conferido de novo na próxima execução; a advertência só é dada se o prazo vencer sem laudo. 0 = advertência na hora.`}
                value={form.portoLaudoGraceHours}
                onChange={(value) => update('portoLaudoGraceHours', value)}
              />
            </div>
          </div>
        </DataPanel>

        <DataPanel title="Financeiro" description="Regras do controle de despesas.">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,240px)_1fr]">
            <NumberField id="due-soon" label="Aviso de vencimento" unit="dias" hint="Contas que vencem nesse prazo aparecem como “vence em breve”." value={form.financeDueSoonDays} onChange={(value) => update('financeDueSoonDays', value)} />
            <FieldShell label="Categorias de despesa" htmlFor="new-category" hint="Sugestões ao lançar uma despesa (o campo continua aceitando outra categoria). Despesas já lançadas mantêm a categoria.">
              <div className="flex flex-wrap gap-2">
                {form.financeCategories.map((category) => (
                  <span key={category} className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/50 py-1 pl-3 pr-1 text-sm">
                    {category}
                    <button
                      type="button"
                      aria-label={`Remover categoria ${category}`}
                      onClick={() => update('financeCategories', form.financeCategories.filter((item) => item !== category))}
                      className="rounded-full p-0.5 text-muted-foreground transition hover:bg-background hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  id="new-category"
                  type="text"
                  value={newCategory}
                  onChange={(event) => setNewCategory(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addCategory();
                    }
                  }}
                  placeholder="Nova categoria"
                  className={inputClassName}
                />
                <Button type="button" variant="outline" onClick={addCategory}>
                  <Plus className="h-4 w-4" />
                  Adicionar
                </Button>
              </div>
            </FieldShell>
          </div>
        </DataPanel>

        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">As mudanças valem para os próximos cálculos. Folhas já salvas mantêm os valores com que foram calculadas.</p>
            {updatedAt ? <p className="mt-1 text-xs text-muted-foreground">Última alteração: {new Date(updatedAt).toLocaleString('pt-BR')}</p> : null}
            {saveMessage ? <p className="mt-2 text-sm text-emerald-700">{saveMessage}</p> : null}
            {saveError ? <p className="mt-2 text-sm text-rose-700">{saveError}</p> : null}
          </div>
          <Button type="submit" disabled={isSaving} className="shrink-0">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar configurações
          </Button>
        </div>
      </form>
    </AppShell>
  );
}
