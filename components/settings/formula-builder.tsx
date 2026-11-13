'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { HelpDot, MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS, ModalNotice } from '@/components/modal-kit';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  COMPARE_LABEL,
  COMPARE_OPS,
  EXAMPLE_INPUTS,
  FORMULA_SOURCES,
  FORMULA_TEMPLATES,
  MAX_FORMULA_STEPS,
  MAX_TIERS,
  SOURCE_INFO,
  describeFormulaStep,
  evaluateCommissionFormula,
  formatFormulaValue,
  nextStepId,
  newFormulaStep,
  operandUnitAt,
  stepName,
  unitWord,
  usedSources,
  validateCommissionFormula,
  withoutStep,
  type CommissionFormula,
  type CompareOp,
  type FormulaInputs,
  type FormulaSource,
  type FormulaStep,
  type Operand,
  type StepKind,
  type Tier,
} from '@/lib/commission-formula';
import { cn } from '@/lib/utils';

/** The way into each kind of step, asked as the question the admin has in mind. */
const STEP_CHOICES: Array<{ kind: StepKind; title: string; text: string }> = [
  { kind: 'percent', title: 'Uma porcentagem de algo', text: 'Ex.: 30% da produção' },
  { kind: 'multiply', title: 'Um valor por unidade', text: 'Ex.: R$ 30 por OS, por hora ou por dia' },
  { kind: 'subtract', title: 'Tirar alguma coisa', text: 'Ex.: o salário e o VR' },
  { kind: 'add', title: 'Somar alguma coisa', text: 'Ex.: um bônus fixo' },
  { kind: 'tiers', title: 'Pagar por faixas', text: 'Ex.: até 40 OS paga X, acima paga Y' },
  { kind: 'condition', title: 'Pagar só se…', text: 'Ex.: só se passar de uma meta' },
  { kind: 'at_least', title: 'Garantir um mínimo', text: 'Ex.: nunca menos de R$ 1.000' },
  { kind: 'at_most', title: 'Limitar a um teto', text: 'Ex.: nunca mais de R$ 4.000' },
  { kind: 'divide', title: 'Dividir', text: 'Ex.: o salário pelas horas do mês' },
];

// Fields are 44px tall on a phone (a finger) and 36px from the small breakpoint up; text is 16px on a phone so the
// browser does not zoom in when a field gets focus.
const SELECT_CLASS =
  'h-11 w-full min-w-0 truncate rounded-md border border-border bg-background px-3 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:px-2 sm:text-sm';
const INPUT_CLASS =
  'h-11 w-full min-w-0 rounded-md border border-border bg-background px-3 text-base tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:px-2.5 sm:text-sm';
const ICON_BUTTON_CLASS = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary disabled:pointer-events-none disabled:opacity-30 sm:h-8 sm:w-8';
const CARD_BUTTON_CLASS = 'rounded-lg border border-border bg-card px-3.5 py-3 text-left transition hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const parseNumber = (text: string): number | null => {
  const trimmed = text.trim().replace(/\s/g, '');
  if (!trimmed) return null;
  const parsed = Number(trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

/** A number field that lets you type "12,5" without fighting the cursor: it keeps its own text until the value really changes. */
function NumInput({ value, onChange, unit, label, className }: { value: number; onChange: (value: number) => void; unit?: string; label: string; className?: string }) {
  const [text, setText] = useState(() => String(value).replace('.', ','));
  useEffect(() => {
    setText((current) => (parseNumber(current) === value ? current : String(value).replace('.', ',')));
  }, [value]);

  return (
    <span className={cn('relative block min-w-0', className)}>
      <input
        inputMode="decimal"
        aria-label={label}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const parsed = parseNumber(event.target.value);
          if (parsed !== null) onChange(parsed);
        }}
        onBlur={() => setText(String(value).replace('.', ','))}
        className={cn(INPUT_CLASS, unit ? 'pr-10' : '')}
      />
      {unit ? <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground sm:right-2.5">{unit}</span> : null}
    </span>
  );
}

/**
 * Where a value in a step comes from: the month, the technician, an earlier step, or a number typed here. The list
 * and the number sit side by side and never grow past the card: the list shrinks (and ellipsizes) before anything overflows.
 */
function OperandField({
  label,
  value,
  onChange,
  earlier,
  sources = FORMULA_SOURCES,
  numberUnit,
}: {
  label: string;
  value: Operand;
  onChange: (value: Operand) => void;
  earlier: Array<{ id: string; name: string }>;
  sources?: FormulaSource[];
  numberUnit: string;
}) {
  const current = value.kind === 'source' ? `src:${value.source}` : value.kind === 'step' ? `step:${value.step}` : 'num';
  const month = sources.filter((source) => SOURCE_INFO[source].group === 'month');
  const technician = sources.filter((source) => SOURCE_INFO[source].group === 'technician');

  return (
    <div className={cn('grid gap-2', value.kind === 'number' ? 'grid-cols-[minmax(0,1fr)_minmax(0,7.5rem)]' : 'grid-cols-1')}>
      <select
        aria-label={label}
        value={current}
        onChange={(event) => {
          const next = event.target.value;
          if (next === 'num') onChange(value.kind === 'number' ? value : { kind: 'number', value: 0 });
          else if (next.startsWith('src:')) onChange({ kind: 'source', source: next.slice(4) as FormulaSource });
          else onChange({ kind: 'step', step: next.slice(5) });
        }}
        className={SELECT_CLASS}
      >
        {month.length ? (
          <optgroup label="Dados do mês">
            {month.map((source) => (
              <option key={source} value={`src:${source}`}>
                {SOURCE_INFO[source].label}
              </option>
            ))}
          </optgroup>
        ) : null}
        {technician.length ? (
          <optgroup label="Valores do técnico">
            {technician.map((source) => (
              <option key={source} value={`src:${source}`}>
                {SOURCE_INFO[source].label}
              </option>
            ))}
          </optgroup>
        ) : null}
        {earlier.length ? (
          <optgroup label="Resultado de uma etapa">
            {earlier.map((step) => (
              <option key={step.id} value={`step:${step.id}`}>
                {step.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        <option value="num">Número fixo</option>
      </select>
      {value.kind === 'number' ? <NumInput label={`${label}: número`} value={value.value} unit={numberUnit} onChange={(next) => onChange({ kind: 'number', value: next })} /> : null}
    </div>
  );
}

/** A question and the field that answers it: stacked on a phone, label beside the field from the small breakpoint up. */
function Question({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-3">
      <span className="text-sm font-medium text-foreground sm:pt-2 sm:font-normal sm:text-muted-foreground">{text}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const TIER_STYLES: Array<{ style: 'reached' | 'progressive'; pays: 'amount' | 'percent'; title: string; text: string }> = [
  { style: 'reached', pays: 'amount', title: 'Valor da faixa atingida', text: 'Chegou na faixa, ganha o valor dela' },
  { style: 'reached', pays: 'percent', title: '% da faixa atingida', text: 'A faixa define a % sobre o total' },
  { style: 'progressive', pays: 'amount', title: 'Cada parte paga um valor', text: 'Cada OS paga o valor da sua faixa' },
  { style: 'progressive', pays: 'percent', title: 'Cada parte paga uma %', text: 'Cada parte paga a % da sua faixa' },
];

/** What one unit of the measure is called, for "R$ por OS". */
const perUnitWord = (unit: ReturnType<typeof operandUnitAt>) => (unit === 'count' ? 'OS' : unit === 'hours' ? 'hora' : unit === 'days' ? 'dia' : 'unidade');

function TiersEditor({ step, onChange, measureUnit }: { step: Extract<FormulaStep, { kind: 'tiers' }>; onChange: (step: FormulaStep) => void; measureUnit: ReturnType<typeof operandUnitAt> }) {
  const measureWord = unitWord(measureUnit);
  const setTier = (index: number, patch: Partial<Tier>) => onChange({ ...step, tiers: step.tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)) });
  const payLabel = step.pays === 'percent' ? 'Paga (%)' : step.style === 'progressive' ? `Paga (R$ por ${perUnitWord(measureUnit)})` : 'Paga (R$ fixo)';

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Como cada faixa paga" className="grid gap-2 sm:grid-cols-2">
        {TIER_STYLES.map((option) => {
          const selected = option.style === step.style && option.pays === step.pays;
          return (
            <button
              key={`${option.style}-${option.pays}`}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange({ ...step, style: option.style, pays: option.pays })}
              className={cn(CARD_BUTTON_CLASS, selected && 'border-primary bg-primary/5')}
            >
              <span className="block text-sm font-semibold">{option.title}</span>
              <span className="block text-[13px] leading-snug text-muted-foreground">{option.text}</span>
            </button>
          );
        })}
      </div>
      <div className="space-y-2">
        {step.tiers.map((tier, index) => {
          const next = step.tiers[index + 1];
          return (
            <div key={index} className="space-y-2 rounded-lg border border-border bg-secondary/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">
                  Faixa {index + 1}
                  {step.style === 'progressive' ? (
                    <span className="ml-2 text-[13px] font-normal text-muted-foreground">{next ? `vai até ${formatFormulaValue(next.from, measureUnit ?? 'number')}` : 'e tudo que passar'}</span>
                  ) : null}
                </span>
                {step.tiers.length > 1 ? (
                  <button type="button" aria-label={`Remover a faixa ${index + 1}`} onClick={() => onChange({ ...step, tiers: step.tiers.filter((_, i) => i !== index) })} className={cn(ICON_BUTTON_CLASS, '-my-1 hover:text-rose-600')}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1 text-[13px] text-muted-foreground">
                  {step.style === 'reached' ? 'A partir de' : 'Acima de'}
                  <NumInput label={`Faixa ${index + 1}: ponto de partida`} value={tier.from} unit={measureWord} onChange={(value) => setTier(index, { from: value })} />
                </label>
                <label className="block space-y-1 text-[13px] text-muted-foreground">
                  {payLabel}
                  <NumInput label={`Faixa ${index + 1}: valor`} value={tier.value} unit={step.pays === 'percent' ? '%' : 'R$'} onChange={(value) => setTier(index, { value })} />
                </label>
              </div>
            </div>
          );
        })}
        {step.tiers.length < MAX_TIERS ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 sm:h-9"
            onClick={() => {
              const last = step.tiers[step.tiers.length - 1];
              onChange({ ...step, tiers: [...step.tiers, { from: last ? last.from + (last.from > 0 ? last.from : 10) : 0, value: last ? last.value : 0 }] });
            }}
          >
            <Plus className="h-4 w-4" />
            Adicionar faixa
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The list of things added or taken off: each one picked like any other value, with a button for one more. */
function ItemsEditor({ step, onChange, earlier, unit }: { step: Extract<FormulaStep, { kind: 'add' | 'subtract' }>; onChange: (step: FormulaStep) => void; earlier: Array<{ id: string; name: string }>; unit: string }) {
  return (
    <div className="space-y-2">
      {step.items.map((item, index) => (
        <div key={index} className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <OperandField label={`${step.kind === 'add' ? 'Somar' : 'Tirar'} ${index + 1}`} value={item} earlier={earlier} numberUnit={unit} onChange={(value) => onChange({ ...step, items: step.items.map((current, i) => (i === index ? value : current)) })} />
          </div>
          {step.items.length > 1 ? (
            <button type="button" aria-label="Remover este valor" onClick={() => onChange({ ...step, items: step.items.filter((_, i) => i !== index) })} className={cn(ICON_BUTTON_CLASS, 'hover:text-rose-600')}>
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ))}
      <Button type="button" variant="ghost" className="-ml-2 h-11 sm:h-9" onClick={() => onChange({ ...step, items: [...step.items, { kind: 'source', source: 'salary' }] })}>
        <Plus className="h-4 w-4" />
        Mais um valor
      </Button>
    </div>
  );
}

function StepEditor({
  formula,
  index,
  result,
  isLast,
  onChange,
  onMove,
  onRemove,
}: {
  formula: CommissionFormula;
  index: number;
  result: { value: number; text: string } | undefined;
  isLast: boolean;
  onChange: (step: FormulaStep) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const step = formula.steps[index];
  const earlier = formula.steps.slice(0, index).map((item, i) => ({ id: item.id, name: stepName(item, i) }));
  const unitOf = (operand: Operand) => operandUnitAt(formula, index, operand);
  // A plain number next to a value is written in that value's unit (R$, OS, h…).
  const beside = (operand: Operand) => {
    const unit = unitOf(operand);
    return unit && unit !== 'percent' ? unitWord(unit) : 'R$';
  };
  const title = STEP_CHOICES.find((choice) => choice.kind === step.kind)?.title ?? '';

  let body: ReactNode = null;
  switch (step.kind) {
    case 'percent':
      body = (
        <>
          <Question text="Que porcentagem?">
            <OperandField label="Porcentagem" value={step.percent} earlier={earlier} sources={['percentage']} numberUnit="%" onChange={(value) => onChange({ ...step, percent: value })} />
          </Question>
          <Question text="De quê?">
            <OperandField label="De quê" value={step.of} earlier={earlier} numberUnit="R$" onChange={(value) => onChange({ ...step, of: value })} />
          </Question>
        </>
      );
      break;
    case 'multiply':
      body = (
        <>
          <Question text="Quanto?">
            <OperandField label="Quantidade" value={step.of} earlier={earlier} numberUnit="" onChange={(value) => onChange({ ...step, of: value })} />
          </Question>
          <Question text="Vezes quanto cada um?">
            <OperandField label="Valor de cada um" value={step.by} earlier={earlier} numberUnit="R$" onChange={(value) => onChange({ ...step, by: value })} />
          </Question>
        </>
      );
      break;
    case 'divide':
      body = (
        <>
          <Question text="Dividir o quê?">
            <OperandField label="Dividir o quê" value={step.of} earlier={earlier} numberUnit="R$" onChange={(value) => onChange({ ...step, of: value })} />
          </Question>
          <Question text="Por quanto?">
            <OperandField label="Dividir por" value={step.by} earlier={earlier} numberUnit="" onChange={(value) => onChange({ ...step, by: value })} />
          </Question>
        </>
      );
      break;
    case 'add':
    case 'subtract':
      body = (
        <>
          <Question text="Partir de quê?">
            <OperandField label="Partir de" value={step.of} earlier={earlier} numberUnit="R$" onChange={(value) => onChange({ ...step, of: value })} />
          </Question>
          <Question text={step.kind === 'add' ? 'E somar o quê?' : 'E tirar o quê?'}>
            <ItemsEditor step={step} onChange={onChange} earlier={earlier} unit={beside(step.of)} />
          </Question>
        </>
      );
      break;
    case 'at_least':
    case 'at_most':
      body = (
        <>
          <Question text="Pegar quanto?">
            <OperandField label="Valor" value={step.of} earlier={earlier} numberUnit="R$" onChange={(value) => onChange({ ...step, of: value })} />
          </Question>
          <Question text={step.kind === 'at_least' ? 'Garantir pelo menos?' : 'Nunca passar de?'}>
            <OperandField label="Limite" value={step.limit} earlier={earlier} numberUnit={beside(step.of)} onChange={(value) => onChange({ ...step, limit: value })} />
          </Question>
        </>
      );
      break;
    case 'tiers':
      body = (
        <>
          <Question text="As faixas medem o quê?">
            <OperandField label="Medido por" value={step.measure} earlier={earlier} sources={['production', 'services', 'hours', 'days']} numberUnit="" onChange={(value) => onChange({ ...step, measure: value })} />
          </Question>
          <TiersEditor step={step} onChange={onChange} measureUnit={unitOf(step.measure)} />
        </>
      );
      break;
    case 'condition':
      body = (
        <>
          <Question text="Se">
            <OperandField label="Se" value={step.left} earlier={earlier} numberUnit="R$" onChange={(value) => onChange({ ...step, left: value })} />
          </Question>
          <Question text="Quando">
            <select aria-label="Quando" value={step.op} onChange={(event) => onChange({ ...step, op: event.target.value as CompareOp })} className={SELECT_CLASS}>
              {COMPARE_OPS.map((op) => (
                <option key={op} value={op}>
                  {COMPARE_LABEL[op]}
                </option>
              ))}
            </select>
          </Question>
          <Question text="Este valor">
            <OperandField label="Este valor" value={step.right} earlier={earlier} numberUnit={beside(step.left)} onChange={(value) => onChange({ ...step, right: value })} />
          </Question>
          <Question text="Então vale">
            <OperandField label="Então vale" value={step.then} earlier={earlier} numberUnit="R$" onChange={(value) => onChange({ ...step, then: value })} />
          </Question>
          <Question text="Senão vale">
            <OperandField label="Senão vale" value={step.otherwise} earlier={earlier} numberUnit="R$" onChange={(value) => onChange({ ...step, otherwise: value })} />
          </Question>
        </>
      );
      break;
  }

  return (
    <li className={cn('rounded-xl border bg-card', isLast && formula.steps.length > 1 ? 'border-primary/40' : 'border-border')}>
      <div className="flex items-center gap-1 border-b border-border px-3 py-1.5 sm:px-4 sm:py-2.5">
        <span className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
        <input
          aria-label={`Nome da etapa ${index + 1}`}
          value={step.label}
          maxLength={60}
          placeholder={title}
          onChange={(event) => onChange({ ...step, label: event.target.value })}
          className="h-10 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-base font-semibold outline-none sm:h-8 sm:text-sm placeholder:font-medium placeholder:text-muted-foreground hover:border-border focus-visible:border-border focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button type="button" aria-label="Subir a etapa" disabled={index === 0} onClick={() => onMove(-1)} className={ICON_BUTTON_CLASS}>
          <ArrowUp className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Descer a etapa" disabled={isLast} onClick={() => onMove(1)} className={ICON_BUTTON_CLASS}>
          <ArrowDown className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Remover a etapa" onClick={onRemove} className={cn(ICON_BUTTON_CLASS, 'hover:text-rose-600')}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-4 px-3 py-4 sm:space-y-3 sm:px-4 sm:py-3.5">{body}</div>
      <div className="space-y-1 rounded-b-xl bg-secondary/50 px-3 py-2.5 text-[13px] leading-snug sm:px-4">
        {isLast ? <span className="inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Resultado final: é a comissão do mês</span> : null}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="min-w-0 flex-1 basis-48 text-muted-foreground">{result?.text ?? describeFormulaStep(formula, index)}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">= {formatFormulaValue(result?.value ?? 0, 'money')}</span>
        </div>
      </div>
    </li>
  );
}

const INPUT_LABELS: Record<FormulaSource, { label: string; unit: string }> = {
  production: { label: 'Produção do mês', unit: 'R$' },
  services: { label: 'Número de OS', unit: 'OS' },
  hours: { label: 'Horas trabalhadas', unit: 'h' },
  days: { label: 'Dias trabalhados', unit: 'dias' },
  salary: { label: 'Salário base', unit: 'R$' },
  vr: { label: 'VR', unit: 'R$' },
  va: { label: 'VA', unit: 'R$' },
  percentage: { label: 'Percentual do técnico', unit: '%' },
  rate: { label: 'Valor por unidade', unit: 'R$' },
};

/** What the example month looks like when scaled: a weak month, the one in the example, a strong month. */
const SCENARIOS: Array<{ label: string; factor: number }> = [
  { label: 'Mês fraco', factor: 0.5 },
  { label: 'Mês do exemplo', factor: 1 },
  { label: 'Mês forte', factor: 1.5 },
];

export interface FormulaBuilderProps {
  formula: CommissionFormula;
  /** The company's own default values, so the example starts close to its real numbers. */
  defaults: Partial<FormulaInputs>;
  onApply: (formula: CommissionFormula) => void;
  onClose: () => void;
}

/**
 * The window where the company builds its own commission, step by step. Left: the steps, each one a few questions.
 * Right: a month in numbers (editable) with what every step comes to, and what a weaker and a stronger month would pay.
 */
export function FormulaBuilderDialog({ formula: initial, defaults, onApply, onClose }: FormulaBuilderProps) {
  const [formula, setFormula] = useState<CommissionFormula>(initial);
  const [inputs, setInputs] = useState<FormulaInputs>(() => {
    const start = { ...EXAMPLE_INPUTS };
    for (const key of Object.keys(defaults) as Array<keyof FormulaInputs>) {
      const value = defaults[key];
      if (typeof value === 'number' && value > 0) start[key] = value;
    }
    return start;
  });
  const [choosing, setChoosing] = useState(false);

  const errors = useMemo(() => validateCommissionFormula(formula), [formula]);
  const result = useMemo(() => evaluateCommissionFormula(formula, inputs), [formula, inputs]);
  const used = useMemo(() => usedSources(formula), [formula]);
  const shownInputs: FormulaSource[] = used.length ? used : ['production', 'services'];
  const empty = formula.steps.length === 0;

  const scenarioValue = (factor: number) =>
    evaluateCommissionFormula(formula, { ...inputs, production: inputs.production * factor, services: Math.round(inputs.services * factor), hours: inputs.hours * factor, days: Math.round(inputs.days * factor) }).value;

  const addStep = (kind: StepKind) => {
    setFormula((current) => {
      const last = current.steps[current.steps.length - 1];
      return { steps: [...current.steps, newFormulaStep(kind, nextStepId(current), last?.id ?? null)] };
    });
    setChoosing(false);
  };

  const moveStep = (index: number, direction: -1 | 1) =>
    setFormula((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.steps.length) return current;
      const steps = [...current.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { steps };
    });

  const chooser = (
    <div className="grid gap-2 sm:grid-cols-2">
      {STEP_CHOICES.map((choice) => (
        <button key={choice.kind} type="button" onClick={() => addStep(choice.kind)} className={CARD_BUTTON_CLASS}>
          <span className="block text-sm font-semibold">{choice.title}</span>
          <span className="block text-[13px] text-muted-foreground">{choice.text}</span>
        </button>
      ))}
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className={cn(MODAL_HEADER_CLASS, 'px-4 py-4 pr-12 text-left sm:px-8 sm:py-5')}>
          <DialogTitle className={cn(MODAL_TITLE_CLASS, 'flex items-center gap-2')}>
            Monte o seu cálculo
            <HelpDot
              label="Monte o seu cálculo"
              text={'Cada etapa responde a uma pergunta e dá um resultado. A etapa seguinte pode usar o resultado das anteriores, e a última etapa é a comissão do mês (se der negativo, vale R$ 0,00).\nO exemplo mostra o que cada etapa dá. Troque os números do exemplo para testar.\nO mínimo garantido e o teto de Configurações continuam valendo depois do seu cálculo.'}
            />
          </DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>Responda etapa por etapa. O exemplo mostra o que cada uma dá.</DialogDescription>
        </DialogHeader>

        <div className={cn(MODAL_BODY_CLASS, 'grid content-start gap-6 px-4 py-4 sm:px-8 sm:py-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-8')}>
          <div className="min-w-0 space-y-5">
            {empty ? (
              <>
                <section className="space-y-3">
                  <h3 className="text-base font-semibold">Comece de um modelo</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {FORMULA_TEMPLATES.map((template) => (
                      <button key={template.id} type="button" onClick={() => setFormula(template.build())} className={CARD_BUTTON_CLASS}>
                        <span className="block text-sm font-semibold">{template.title}</span>
                        <span className="block text-[13px] text-muted-foreground">{template.text}</span>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="space-y-3">
                  <h3 className="text-base font-semibold">Ou monte do zero: qual é a primeira etapa?</h3>
                  {chooser}
                </section>
              </>
            ) : (
              <>
                <ol className="space-y-4">
                  {formula.steps.map((step, index) => (
                    <StepEditor
                      key={step.id}
                      formula={formula}
                      index={index}
                      isLast={index === formula.steps.length - 1}
                      result={result.steps[index]}
                      onChange={(next) => setFormula((current) => ({ steps: current.steps.map((item) => (item.id === step.id ? next : item)) }))}
                      onMove={(direction) => moveStep(index, direction)}
                      onRemove={() => setFormula((current) => withoutStep(current, step.id))}
                    />
                  ))}
                </ol>
                {choosing ? (
                  <section className="space-y-3">
                    <h3 className="text-base font-semibold">E agora, o que mais?</h3>
                    {chooser}
                  </section>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {formula.steps.length < MAX_FORMULA_STEPS ? (
                    <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => setChoosing((current) => !current)}>
                      <Plus className="h-4 w-4" />
                      {choosing ? 'Fechar' : 'Adicionar etapa'}
                    </Button>
                  ) : null}
                  <Button type="button" variant="ghost" className="h-11 sm:h-9" onClick={() => setFormula({ steps: [] })}>
                    <RotateCcw className="h-4 w-4" />
                    Recomeçar
                  </Button>
                </div>
              </>
            )}
          </div>

          <aside className={cn('min-w-0 space-y-4 lg:sticky lg:top-0 lg:block lg:self-start lg:space-y-5', empty && 'hidden')}>
            <section className="space-y-3 rounded-xl border border-border bg-card p-4">
              <h3 className="flex items-center gap-2 text-base font-semibold">
                Exemplo de um mês
                <HelpDot label="Exemplo de um mês" text="Números de mentira, só para você ver o cálculo funcionando. Mude à vontade: nada daqui é salvo." />
              </h3>
              <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                {shownInputs.map((source) => (
                  <label key={source} className="block min-w-0 space-y-1 text-[13px] leading-tight text-muted-foreground">
                    {INPUT_LABELS[source].label}
                    <NumInput label={`Exemplo: ${INPUT_LABELS[source].label}`} value={inputs[source]} unit={INPUT_LABELS[source].unit} onChange={(value) => setInputs((current) => ({ ...current, [source]: value }))} className="block w-full" />
                  </label>
                ))}
              </div>
            </section>

            <section className="space-y-3 rounded-xl border border-border bg-card p-4">
              <h3 className="text-base font-semibold">Quanto dá</h3>
              {empty ? (
                <p className="text-sm text-muted-foreground">Escolha um modelo ou a primeira etapa.</p>
              ) : (
                <>
                  <ol className="space-y-1.5 text-[13px]">
                    {result.steps.map((line, index) => (
                      <li key={line.id} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 text-muted-foreground">
                          {index + 1}. {line.label}
                        </span>
                        <span className="shrink-0 tabular-nums">{formatFormulaValue(line.value, 'money')}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
                    <span className="text-sm font-semibold">Comissão do mês</span>
                    <span className="text-xl font-semibold tabular-nums text-primary">{formatFormulaValue(result.value, 'money')}</span>
                  </div>
                  {result.raw < 0 ? <p className="text-[13px] text-amber-700">O cálculo deu {formatFormulaValue(result.raw, 'money')}: a comissão fica em R$ 0,00.</p> : null}
                </>
              )}
            </section>

            {!empty ? (
              <section className="space-y-2 rounded-xl border border-border bg-card p-4">
                <h3 className="flex items-center gap-2 text-base font-semibold">
                  E se o mês for diferente?
                  <HelpDot label="E se o mês for diferente?" text="Mexe só na produção, nas OS, nas horas e nos dias do exemplo: metade deles num mês fraco, uma vez e meia num mês forte. Salário, vales e percentuais ficam como estão." />
                </h3>
                <dl className="space-y-1.5 text-[13px]">
                  {SCENARIOS.map((scenario) => (
                    <div key={scenario.label} className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">{scenario.label}</dt>
                      <dd className="font-medium tabular-nums">{formatFormulaValue(scenarioValue(scenario.factor), 'money')}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
          </aside>
        </div>

        <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'flex-col items-stretch gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-4')}>
          <div className="min-w-0 flex-1 space-y-2">
            {!empty && errors.length ? <ModalNotice tone="warning">{errors[0]}</ModalNotice> : null}
            {/* on a phone the example sits below the steps: the result stays in view here while the steps are edited */}
            {!empty ? (
              <div className="flex items-baseline justify-between gap-3 lg:hidden" aria-live="polite">
                <span className="text-sm text-muted-foreground">Comissão do exemplo</span>
                <span className="text-lg font-semibold tabular-nums text-primary">{formatFormulaValue(result.value, 'money')}</span>
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="button" className="h-11 sm:h-9" disabled={empty || errors.length > 0} onClick={() => onApply(formula)}>
              Usar este cálculo
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
