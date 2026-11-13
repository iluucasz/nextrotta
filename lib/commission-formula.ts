// The "Personalizado" way of paying commission: the company builds its own calculation out of steps, each one
// answering a small question ("what percentage of what?", "what is taken off?"). A step reads the month's data
// (production, number of OS, hours, days), the technician's values (salary, VR, VA, percentage, rate), plain
// numbers, or the result of an earlier step; the last step is the commission.
//
// Pure and dependency-free on purpose: the server (folha), the screens (Folha, Configurações and the builder's
// live example) and the worker use the same functions, so the example the admin sees is what gets calculated.
// Relative imports only.

/** What a step can read from the month: the month's data and the technician's own values. */
export type FormulaSource = 'production' | 'services' | 'hours' | 'days' | 'salary' | 'vr' | 'va' | 'percentage' | 'rate';

export const FORMULA_SOURCES: FormulaSource[] = ['production', 'services', 'hours', 'days', 'salary', 'vr', 'va', 'percentage', 'rate'];

/** How a value is written: R$, a count of things, hours, days or a percentage. */
export type FormulaUnit = 'money' | 'count' | 'hours' | 'days' | 'percent' | 'number';

export interface SourceInfo {
  /** The name used in sentences ("Produção do mês"). */
  label: string;
  unit: FormulaUnit;
  group: 'month' | 'technician';
  /** The short question-style hint the builder shows under the picker. */
  hint: string;
}

export const SOURCE_INFO: Record<FormulaSource, SourceInfo> = {
  production: { label: 'Produção do mês', unit: 'money', group: 'month', hint: 'Soma do valor de todas as OS do técnico no mês' },
  services: { label: 'Número de OS', unit: 'count', group: 'month', hint: 'Quantas OS o técnico fez no mês' },
  hours: { label: 'Horas trabalhadas', unit: 'hours', group: 'month', hint: 'Horas apontadas no mês (escala e Porto)' },
  days: { label: 'Dias trabalhados', unit: 'days', group: 'month', hint: 'Dias com horas apontadas no mês' },
  salary: { label: 'Salário base', unit: 'money', group: 'technician', hint: 'O salário do cadastro do técnico (ou o padrão da empresa)' },
  vr: { label: 'VR', unit: 'money', group: 'technician', hint: 'O vale-refeição do técnico' },
  va: { label: 'VA', unit: 'money', group: 'technician', hint: 'O vale-alimentação do técnico' },
  percentage: { label: 'Percentual do técnico', unit: 'percent', group: 'technician', hint: 'A comissão % do cadastro do técnico (ou o padrão da empresa)' },
  rate: { label: 'Valor por unidade do técnico', unit: 'money', group: 'technician', hint: 'O valor em R$ do cadastro do técnico (ou o padrão da empresa)' },
};

export type Operand = { kind: 'source'; source: FormulaSource } | { kind: 'number'; value: number } | { kind: 'step'; step: string };

export type CompareOp = 'gte' | 'gt' | 'lte' | 'lt';
export const COMPARE_OPS: CompareOp[] = ['gte', 'gt', 'lte', 'lt'];
export const COMPARE_LABEL: Record<CompareOp, string> = { gte: 'for maior ou igual a', gt: 'for maior que', lte: 'for menor ou igual a', lt: 'for menor que' };

export interface Tier {
  /** "A partir de" this quantity (reached tiers) or the quantity above which this band starts (progressive tiers). */
  from: number;
  /** R$ (amount), a percentage (percent): see `pays`. */
  value: number;
}

interface StepBase {
  /** Local id, "s1", "s2"… An operand points to an earlier step by it. */
  id: string;
  /** The name the admin gives the step ("Comissão bruta"); shown in the example. */
  label: string;
}

export type FormulaStep =
  | (StepBase & { kind: 'percent'; of: Operand; percent: Operand })
  | (StepBase & { kind: 'multiply'; of: Operand; by: Operand })
  | (StepBase & { kind: 'divide'; of: Operand; by: Operand })
  | (StepBase & { kind: 'add'; of: Operand; items: Operand[] })
  | (StepBase & { kind: 'subtract'; of: Operand; items: Operand[] })
  | (StepBase & { kind: 'at_least'; of: Operand; limit: Operand })
  | (StepBase & { kind: 'at_most'; of: Operand; limit: Operand })
  | (StepBase & { kind: 'tiers'; measure: Operand; style: 'reached' | 'progressive'; pays: 'amount' | 'percent'; tiers: Tier[] })
  | (StepBase & { kind: 'condition'; left: Operand; op: CompareOp; right: Operand; then: Operand; otherwise: Operand });

export type StepKind = FormulaStep['kind'];
export const STEP_KINDS: StepKind[] = ['percent', 'multiply', 'divide', 'add', 'subtract', 'at_least', 'at_most', 'tiers', 'condition'];

export interface CommissionFormula {
  steps: FormulaStep[];
}

export const MAX_FORMULA_STEPS = 12;
export const MAX_TIERS = 10;
const MAX_NUMBER = 100_000_000;

export const EMPTY_FORMULA: CommissionFormula = { steps: [] };

/** The month's numbers the formula reads. */
export interface FormulaInputs {
  production: number;
  services: number;
  hours: number;
  days: number;
  salary: number;
  vr: number;
  va: number;
  percentage: number;
  rate: number;
}

export const ZERO_INPUTS: FormulaInputs = { production: 0, services: 0, hours: 0, days: 0, salary: 0, vr: 0, va: 0, percentage: 0, rate: 0 };

function cents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading what is stored (lenient for the database, strict for what the admin submits)
// ---------------------------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readOperand(value: unknown): Operand | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'source') return FORMULA_SOURCES.includes(value.source as FormulaSource) ? { kind: 'source', source: value.source as FormulaSource } : null;
  if (value.kind === 'number') {
    const number = finite(value.value);
    return number === null ? null : { kind: 'number', value: number };
  }
  if (value.kind === 'step') return typeof value.step === 'string' && value.step ? { kind: 'step', step: value.step } : null;
  return null;
}

function readOperands(value: unknown): Operand[] | null {
  if (!Array.isArray(value)) return null;
  const items: Operand[] = [];
  for (const item of value) {
    const operand = readOperand(item);
    if (!operand) return null;
    items.push(operand);
  }
  return items;
}

function readStep(value: unknown): FormulaStep | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null;
  const base = { id: value.id, label: typeof value.label === 'string' ? value.label.trim().slice(0, 60) : '' };

  switch (value.kind) {
    case 'percent': {
      const of = readOperand(value.of);
      const percent = readOperand(value.percent);
      return of && percent ? { ...base, kind: 'percent', of, percent } : null;
    }
    case 'multiply':
    case 'divide': {
      const of = readOperand(value.of);
      const by = readOperand(value.by);
      return of && by ? { ...base, kind: value.kind, of, by } : null;
    }
    case 'add':
    case 'subtract': {
      const of = readOperand(value.of);
      const items = readOperands(value.items);
      return of && items ? { ...base, kind: value.kind, of, items } : null;
    }
    case 'at_least':
    case 'at_most': {
      const of = readOperand(value.of);
      const limit = readOperand(value.limit);
      return of && limit ? { ...base, kind: value.kind, of, limit } : null;
    }
    case 'tiers': {
      const measure = readOperand(value.measure);
      const style = value.style === 'reached' || value.style === 'progressive' ? value.style : null;
      const pays = value.pays === 'amount' || value.pays === 'percent' ? value.pays : null;
      if (!measure || !style || !pays || !Array.isArray(value.tiers)) return null;
      const tiers: Tier[] = [];
      for (const item of value.tiers) {
        if (!isRecord(item)) return null;
        const from = finite(item.from);
        const amount = finite(item.value);
        if (from === null || amount === null) return null;
        tiers.push({ from, value: amount });
      }
      return { ...base, kind: 'tiers', measure, style, pays, tiers };
    }
    case 'condition': {
      const left = readOperand(value.left);
      const right = readOperand(value.right);
      const then = readOperand(value.then);
      const otherwise = readOperand(value.otherwise);
      const op = COMPARE_OPS.includes(value.op as CompareOp) ? (value.op as CompareOp) : null;
      return left && right && then && otherwise && op ? { ...base, kind: 'condition', left, op, right, then, otherwise } : null;
    }
    default:
      return null;
  }
}

/** Reads a stored formula (an object, or its JSON text). Returns null when it is not a formula at all. */
export function normalizeCommissionFormula(raw: unknown): CommissionFormula | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isRecord(value) || !Array.isArray(value.steps)) return null;
  const steps: FormulaStep[] = [];
  for (const item of value.steps) {
    const step = readStep(item);
    if (!step) return null;
    steps.push(step);
  }
  return { steps };
}

// ---------------------------------------------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------------------------------------------

/** What is wrong with a formula, in the words of the screen (empty = ready to use). Each message names the step. */
export function validateCommissionFormula(formula: CommissionFormula): string[] {
  const errors: string[] = [];
  if (!formula.steps.length) return ['Monte o cálculo com pelo menos uma etapa.'];
  if (formula.steps.length > MAX_FORMULA_STEPS) return [`O cálculo pode ter no máximo ${MAX_FORMULA_STEPS} etapas.`];

  const ids = new Set<string>();
  const earlier = new Set<string>();

  const checkOperand = (operand: Operand, name: string, position: number) => {
    if (operand.kind === 'number') {
      if (!(Math.abs(operand.value) <= MAX_NUMBER)) errors.push(`Etapa ${position}: o número de "${name}" é grande demais.`);
    } else if (operand.kind === 'step' && !earlier.has(operand.step)) {
      errors.push(`Etapa ${position}: "${name}" usa uma etapa que não existe antes dela.`);
    }
  };

  formula.steps.forEach((step, index) => {
    const position = index + 1;
    if (ids.has(step.id)) errors.push(`Etapa ${position}: o código da etapa se repete.`);
    ids.add(step.id);

    switch (step.kind) {
      case 'percent':
        checkOperand(step.of, 'de quê', position);
        checkOperand(step.percent, 'porcentagem', position);
        if (step.percent.kind === 'number' && !(step.percent.value >= 0 && step.percent.value <= 100)) errors.push(`Etapa ${position}: a porcentagem deve ficar entre 0 e 100.`);
        break;
      case 'multiply':
      case 'divide':
        checkOperand(step.of, 'primeiro valor', position);
        checkOperand(step.by, 'segundo valor', position);
        break;
      case 'add':
      case 'subtract':
        checkOperand(step.of, 'valor de partida', position);
        step.items.forEach((item) => checkOperand(item, 'valores', position));
        if (!step.items.length) errors.push(`Etapa ${position}: escolha o que ${step.kind === 'add' ? 'somar' : 'tirar'}.`);
        break;
      case 'at_least':
      case 'at_most':
        checkOperand(step.of, 'valor', position);
        checkOperand(step.limit, 'limite', position);
        break;
      case 'tiers': {
        checkOperand(step.measure, 'o que mede as faixas', position);
        if (!step.tiers.length) errors.push(`Etapa ${position}: crie pelo menos uma faixa.`);
        if (step.tiers.length > MAX_TIERS) errors.push(`Etapa ${position}: no máximo ${MAX_TIERS} faixas.`);
        step.tiers.forEach((tier, tierIndex) => {
          if (!(tier.from >= 0 && tier.from <= MAX_NUMBER)) errors.push(`Etapa ${position}, faixa ${tierIndex + 1}: o ponto de partida não pode ser negativo.`);
          if (!(tier.value >= 0 && tier.value <= MAX_NUMBER)) errors.push(`Etapa ${position}, faixa ${tierIndex + 1}: o valor não pode ser negativo.`);
          if (step.pays === 'percent' && tier.value > 100) errors.push(`Etapa ${position}, faixa ${tierIndex + 1}: a porcentagem deve ficar entre 0 e 100.`);
          if (tierIndex > 0 && !(tier.from > step.tiers[tierIndex - 1].from)) errors.push(`Etapa ${position}: as faixas devem seguir em ordem crescente, sem repetir.`);
        });
        break;
      }
      case 'condition':
        checkOperand(step.left, 'valor comparado', position);
        checkOperand(step.right, 'comparado com', position);
        checkOperand(step.then, 'então', position);
        checkOperand(step.otherwise, 'senão', position);
        break;
    }
    earlier.add(step.id);
  });

  return errors;
}

/** Whether any step reads this source (the screens show the technician's percentage/rate only when it matters). */
export function formulaUsesSource(formula: CommissionFormula, source: FormulaSource): boolean {
  const reads = (operand: Operand) => operand.kind === 'source' && operand.source === source;
  return formula.steps.some((step) => operandsOf(step).some(reads));
}

function operandsOf(step: FormulaStep): Operand[] {
  switch (step.kind) {
    case 'percent':
      return [step.of, step.percent];
    case 'multiply':
    case 'divide':
      return [step.of, step.by];
    case 'add':
    case 'subtract':
      return [step.of, ...step.items];
    case 'at_least':
    case 'at_most':
      return [step.of, step.limit];
    case 'tiers':
      return [step.measure];
    case 'condition':
      return [step.left, step.right, step.then, step.otherwise];
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------------------------------------------

export interface StepResult {
  id: string;
  /** The step's name: the one the admin gave it, or what it does. */
  label: string;
  value: number;
  unit: FormulaUnit;
  /** The step in one sentence with the numbers in it ("30% de Produção do mês (R$ 10.000,00)"). */
  text: string;
}

export interface FormulaResult {
  /** The commission: the last step, never below zero. */
  value: number;
  /** What the last step came to before being held at zero. */
  raw: number;
  steps: StepResult[];
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const plain = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/** A value written in its unit: "R$ 1.260,00", "42 OS", "200 h", "30%". */
export function formatFormulaValue(value: number, unit: FormulaUnit): string {
  switch (unit) {
    case 'money':
      return money.format(value);
    case 'count':
      return `${plain.format(value)} OS`;
    case 'hours':
      return `${plain.format(value)} h`;
    case 'days':
      return `${plain.format(value)} ${value === 1 ? 'dia' : 'dias'}`;
    case 'percent':
      return `${plain.format(value)}%`;
    default:
      return plain.format(value);
  }
}

/** What each kind of step does, as the short name used when the admin did not name it. */
export const STEP_NAMES: Record<StepKind, string> = {
  percent: 'Porcentagem',
  multiply: 'Multiplicação',
  divide: 'Divisão',
  add: 'Soma',
  subtract: 'Subtração',
  at_least: 'Mínimo',
  at_most: 'Máximo',
  tiers: 'Faixas',
  condition: 'Condição',
};

export function stepName(step: FormulaStep, index: number): string {
  return step.label.trim() || `${STEP_NAMES[step.kind]} (etapa ${index + 1})`;
}

/** The role an operand plays inside a step: it decides how a plain number is written (R$, %, or bare). */
type Role = 'of' | 'by' | 'percent' | 'item' | 'limit' | 'left' | 'right' | 'then' | 'otherwise' | 'measure';

/** The unit of an operand when it is known without running (a source or an earlier step); null for a plain number. */
function knownUnit(operand: Operand, units: Map<string, FormulaUnit>): FormulaUnit | null {
  if (operand.kind === 'source') return SOURCE_INFO[operand.source].unit;
  if (operand.kind === 'step') return units.get(operand.step) ?? 'number';
  return null;
}

/** How a plain number typed into a step is written there: a percentage, R$ per unit, or the unit of what it sits next to. */
function literalUnit(step: FormulaStep, role: Role, units: Map<string, FormulaUnit>): FormulaUnit {
  switch (step.kind) {
    case 'percent':
      return role === 'percent' ? 'percent' : 'money';
    case 'multiply':
      return role === 'by' ? 'money' : 'number';
    case 'divide':
      return role === 'of' ? 'money' : 'number';
    case 'add':
    case 'subtract': {
      const unit = knownUnit(step.of, units);
      return unit && unit !== 'percent' ? unit : 'money';
    }
    case 'at_least':
    case 'at_most': {
      const unit = knownUnit(step.of, units);
      return unit && unit !== 'percent' ? unit : 'money';
    }
    case 'condition': {
      if (role === 'right') {
        const unit = knownUnit(step.left, units);
        return unit && unit !== 'percent' ? unit : 'money';
      }
      return 'money';
    }
    default:
      return 'number';
  }
}

/** What a step's result is measured in. Depends only on how the steps are built, never on the numbers. */
function stepUnit(step: FormulaStep, units: Map<string, FormulaUnit>): FormulaUnit {
  switch (step.kind) {
    case 'percent': {
      const unit = knownUnit(step.of, units) ?? 'money';
      return unit === 'percent' ? 'number' : unit;
    }
    case 'multiply': {
      const a = knownUnit(step.of, units);
      const b = knownUnit(step.by, units);
      if (a === null || b === null || a === 'money' || b === 'money') return 'money';
      return 'number';
    }
    case 'divide': {
      const a = knownUnit(step.of, units) ?? 'number';
      const b = knownUnit(step.by, units);
      return a === 'money' && b === 'money' ? 'number' : a;
    }
    case 'add':
    case 'subtract':
    case 'at_least':
    case 'at_most':
      return knownUnit(step.of, units) ?? ('items' in step ? step.items.map((item) => knownUnit(item, units)).find(Boolean) : knownUnit(step.limit, units)) ?? 'money';
    case 'tiers':
      return 'money';
    case 'condition':
      return knownUnit(step.then, units) ?? knownUnit(step.otherwise, units) ?? 'money';
  }
}

function nameOfOperand(operand: Operand, unit: FormulaUnit, nameOfStep: (id: string) => string): string {
  if (operand.kind === 'source') return SOURCE_INFO[operand.source].label;
  if (operand.kind === 'step') return `“${nameOfStep(operand.step)}”`;
  return formatFormulaValue(operand.value, unit);
}

/**
 * One step in a sentence, with no month numbers in it ("30% de Produção do mês"): what the screen lists under the
 * choice of "Personalizado" and over the builder's own example.
 */
export function describeFormulaStep(formula: CommissionFormula, index: number): string {
  const units = new Map<string, FormulaUnit>();
  const names = new Map<string, string>();
  formula.steps.forEach((step, i) => {
    if (i < index) {
      units.set(step.id, stepUnit(step, units));
    }
    names.set(step.id, stepName(step, i));
  });
  const step = formula.steps[index];
  const nameOfStep = (id: string) => names.get(id) ?? 'etapa';
  const op = (operand: Operand, role: Role) => nameOfOperand(operand, operand.kind === 'number' ? literalUnit(step, role, units) : 'number', nameOfStep);

  switch (step.kind) {
    case 'percent':
      return `${op(step.percent, 'percent')} de ${op(step.of, 'of')}`;
    case 'multiply':
      return `${op(step.of, 'of')} × ${op(step.by, 'by')}`;
    case 'divide':
      return `${op(step.of, 'of')} ÷ ${op(step.by, 'by')}`;
    case 'add':
      return `${op(step.of, 'of')} ${step.items.map((item) => `+ ${op(item, 'item')}`).join(' ')}`.trim();
    case 'subtract':
      return `${op(step.of, 'of')} ${step.items.map((item) => `− ${op(item, 'item')}`).join(' ')}`.trim();
    case 'at_least':
      return `${op(step.of, 'of')}, no mínimo ${op(step.limit, 'limit')}`;
    case 'at_most':
      return `${op(step.of, 'of')}, no máximo ${op(step.limit, 'limit')}`;
    case 'tiers': {
      const measure = op(step.measure, 'measure');
      const how =
        step.style === 'reached'
          ? step.pays === 'amount'
            ? 'paga o valor fixo da faixa atingida'
            : 'paga a porcentagem da faixa atingida sobre o total'
          : step.pays === 'amount'
            ? 'cada parte paga um valor por unidade'
            : 'cada parte paga uma porcentagem';
      return `Faixas de ${measure}: ${how}`;
    }
    case 'condition':
      return `Se ${op(step.left, 'left')} ${COMPARE_LABEL[step.op]} ${op(step.right, 'right')}, vale ${op(step.then, 'then')}; senão, ${op(step.otherwise, 'otherwise')}`;
  }
}

/**
 * Runs the formula. Every step is rounded to the cent, so the numbers the example shows add up exactly to what the
 * folha pays. The commission is the last step, never below zero.
 */
export function evaluateCommissionFormula(formula: CommissionFormula, inputs: FormulaInputs): FormulaResult {
  const values = new Map<string, number>();
  const units = new Map<string, FormulaUnit>();
  const steps: StepResult[] = [];

  formula.steps.forEach((step, index) => {
    const read = (operand: Operand): number => {
      if (operand.kind === 'source') return Number(inputs[operand.source]) || 0;
      if (operand.kind === 'step') return values.get(operand.step) ?? 0;
      return operand.value;
    };
    const unit = stepUnit(step, units);
    const label = stepName(step, index);
    const names = new Map(formula.steps.map((item, i) => [item.id, stepName(item, i)] as const));
    const nameOfStep = (id: string) => names.get(id) ?? 'etapa';
    /** A reference with its value ("Produção do mês (R$ 10.000,00)"), or the bare number. */
    const shown = (operand: Operand, role: Role): string => {
      const own = knownUnit(operand, units);
      const asUnit = own ?? literalUnit(step, role, units);
      const name = nameOfOperand(operand, asUnit, nameOfStep);
      return operand.kind === 'number' ? name : `${name} (${formatFormulaValue(read(operand), own ?? 'number')})`;
    };

    let value = 0;
    let text = '';

    switch (step.kind) {
      case 'percent':
        value = read(step.of) * (read(step.percent) / 100);
        text = `${shown(step.percent, 'percent')} de ${shown(step.of, 'of')}`;
        break;
      case 'multiply':
        value = read(step.of) * read(step.by);
        text = `${shown(step.of, 'of')} × ${shown(step.by, 'by')}`;
        break;
      case 'divide': {
        const divisor = read(step.by);
        value = divisor === 0 ? 0 : read(step.of) / divisor;
        text = `${shown(step.of, 'of')} ÷ ${shown(step.by, 'by')}`;
        break;
      }
      case 'add':
      case 'subtract': {
        const sign = step.kind === 'add' ? 1 : -1;
        value = read(step.of) + sign * step.items.reduce((total, item) => total + read(item), 0);
        text = `${shown(step.of, 'of')} ${step.items.map((item) => `${step.kind === 'add' ? '+' : '−'} ${shown(item, 'item')}`).join(' ')}`;
        break;
      }
      case 'at_least':
      case 'at_most': {
        const own = read(step.of);
        const limit = read(step.limit);
        value = step.kind === 'at_least' ? Math.max(own, limit) : Math.min(own, limit);
        text = `${shown(step.of, 'of')}, ${step.kind === 'at_least' ? 'no mínimo' : 'no máximo'} ${shown(step.limit, 'limit')}`;
        break;
      }
      case 'tiers': {
        const measure = read(step.measure);
        const measureUnit = knownUnit(step.measure, units) ?? 'number';
        const tiers = [...step.tiers].sort((a, b) => a.from - b.from);
        if (step.style === 'reached') {
          let reached: Tier | null = null;
          for (const tier of tiers) if (measure >= tier.from) reached = tier;
          value = reached ? (step.pays === 'amount' ? reached.value : measure * (reached.value / 100)) : 0;
          text = reached
            ? `Faixa a partir de ${formatFormulaValue(reached.from, measureUnit)} atingida (${shown(step.measure, 'measure')})`
            : `Nenhuma faixa atingida (${shown(step.measure, 'measure')})`;
        } else {
          const parts: string[] = [];
          tiers.forEach((tier, i) => {
            const upper = i + 1 < tiers.length ? tiers[i + 1].from : Number.POSITIVE_INFINITY;
            const inBand = Math.max(0, Math.min(measure, upper) - tier.from);
            if (inBand > 0) {
              value += step.pays === 'amount' ? inBand * tier.value : inBand * (tier.value / 100);
              parts.push(`${formatFormulaValue(inBand, measureUnit)} × ${step.pays === 'amount' ? formatFormulaValue(tier.value, 'money') : formatFormulaValue(tier.value, 'percent')}`);
            }
          });
          text = parts.length ? `${shown(step.measure, 'measure')}: ${parts.join(' + ')}` : `${shown(step.measure, 'measure')}: nenhuma parte entra nas faixas`;
        }
        break;
      }
      case 'condition': {
        const left = read(step.left);
        const right = read(step.right);
        const holds = step.op === 'gte' ? left >= right : step.op === 'gt' ? left > right : step.op === 'lte' ? left <= right : left < right;
        value = read(holds ? step.then : step.otherwise);
        text = `${shown(step.left, 'left')} ${holds ? COMPARE_LABEL[step.op] : `não ${COMPARE_LABEL[step.op]}`} ${shown(step.right, 'right')}: vale ${shown(holds ? step.then : step.otherwise, holds ? 'then' : 'otherwise')}`;
        break;
      }
    }

    value = cents(value);
    values.set(step.id, value);
    units.set(step.id, unit);
    steps.push({ id: step.id, label, value, unit, text });
  });

  const raw = steps.length ? steps[steps.length - 1].value : 0;
  return { value: Math.max(0, raw), raw, steps };
}

/** The commission the formula gives for this month (0 when it has no steps). */
export function commissionFromFormula(formula: CommissionFormula | null | undefined, inputs: FormulaInputs): number {
  if (!formula || !formula.steps.length) return 0;
  return evaluateCommissionFormula(formula, inputs).value;
}

// ---------------------------------------------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------------------------------------------

const src = (source: FormulaSource): Operand => ({ kind: 'source', source });
const num = (value: number): Operand => ({ kind: 'number', value });
const prev = (step: string): Operand => ({ kind: 'step', step });

/** The next free local id ("s1", "s2"…). */
export function nextStepId(formula: CommissionFormula): string {
  const used = new Set(formula.steps.map((step) => step.id));
  let n = formula.steps.length + 1;
  while (used.has(`s${n}`)) n += 1;
  return `s${n}`;
}

/** A new step of this kind with sensible starting values, ready to be edited. */
export function newFormulaStep(kind: StepKind, id: string, previousId: string | null): FormulaStep {
  const start: Operand = previousId ? prev(previousId) : src('production');
  switch (kind) {
    case 'percent':
      return { id, label: '', kind, of: start, percent: src('percentage') };
    case 'multiply':
      return { id, label: '', kind, of: previousId ? prev(previousId) : src('services'), by: num(0) };
    case 'divide':
      return { id, label: '', kind, of: start, by: num(1) };
    case 'add':
      return { id, label: '', kind, of: start, items: [src('salary')] };
    case 'subtract':
      return { id, label: '', kind, of: start, items: [src('salary')] };
    case 'at_least':
      return { id, label: '', kind, of: start, limit: num(0) };
    case 'at_most':
      return { id, label: '', kind, of: start, limit: num(0) };
    case 'tiers':
      return { id, label: '', kind, measure: src('services'), style: 'progressive', pays: 'amount', tiers: [{ from: 0, value: 0 }] };
    case 'condition':
      return { id, label: '', kind, left: src('production'), op: 'gte', right: src('salary'), then: start, otherwise: num(0) };
  }
}

export interface FormulaTemplate {
  id: string;
  title: string;
  text: string;
  build: () => CommissionFormula;
}

/** Starting points: each one rebuilds a rule in steps, so the admin sees how to make their own. */
export const FORMULA_TEMPLATES: FormulaTemplate[] = [
  {
    id: 'excess',
    title: 'Sobre o excedente',
    text: 'Paga o que passa do salário e dos vales',
    build: () => ({
      steps: [
        { id: 's1', label: 'Parte da produção', kind: 'percent', of: src('production'), percent: src('percentage') },
        { id: 's2', label: 'Comissão', kind: 'subtract', of: prev('s1'), items: [src('salary'), src('vr'), src('va')] },
      ],
    }),
  },
  {
    id: 'tiers_os',
    title: 'Por faixas de OS',
    text: 'Cada faixa de OS paga um valor por OS',
    build: () => ({
      steps: [
        {
          id: 's1',
          label: 'Comissão',
          kind: 'tiers',
          measure: src('services'),
          style: 'progressive',
          pays: 'amount',
          tiers: [
            { from: 0, value: 20 },
            { from: 40, value: 30 },
            { from: 80, value: 40 },
          ],
        },
      ],
    }),
  },
  {
    id: 'goal',
    title: 'Só depois da meta',
    text: 'Paga % se a produção passar de um valor',
    build: () => ({
      steps: [
        { id: 's1', label: 'Parte da produção', kind: 'percent', of: src('production'), percent: src('percentage') },
        { id: 's2', label: 'Comissão', kind: 'condition', left: src('production'), op: 'gte', right: num(8000), then: prev('s1'), otherwise: num(0) },
      ],
    }),
  },
  {
    id: 'guaranteed',
    title: 'Com mínimo e teto',
    text: '% da produção, entre um piso e um teto',
    build: () => ({
      steps: [
        { id: 's1', label: 'Parte da produção', kind: 'percent', of: src('production'), percent: src('percentage') },
        { id: 's2', label: 'Com o mínimo', kind: 'at_least', of: prev('s1'), limit: num(1000) },
        { id: 's3', label: 'Comissão', kind: 'at_most', of: prev('s2'), limit: num(4000) },
      ],
    }),
  },
];

/** A sample month for the builder's live example. */
export const EXAMPLE_INPUTS: FormulaInputs = { production: 10000, services: 42, hours: 200, days: 22, salary: 2000, vr: 500, va: 0, percentage: 30, rate: 30 };

// ---------------------------------------------------------------------------------------------------------------
// Helpers for the builder screen
// ---------------------------------------------------------------------------------------------------------------

/** The unit of an operand sitting in step `index` (null for a plain number): what the builder writes next to a field. */
export function operandUnitAt(formula: CommissionFormula, index: number, operand: Operand): FormulaUnit | null {
  const units = new Map<string, FormulaUnit>();
  for (let i = 0; i < index && i < formula.steps.length; i += 1) units.set(formula.steps[i].id, stepUnit(formula.steps[i], units));
  return knownUnit(operand, units);
}

/** The short word written next to a number of this unit: "OS", "R$", "h"… */
export function unitWord(unit: FormulaUnit | null): string {
  switch (unit) {
    case 'money':
      return 'R$';
    case 'count':
      return 'OS';
    case 'hours':
      return 'h';
    case 'days':
      return 'dias';
    case 'percent':
      return '%';
    default:
      return '';
  }
}

/** The sources some step reads, in the order the example asks for them. */
export function usedSources(formula: CommissionFormula): FormulaSource[] {
  return FORMULA_SOURCES.filter((source) => formulaUsesSource(formula, source));
}

/** The formula without a step: whatever pointed to it now holds the number 0 (so nothing is left dangling). */
export function withoutStep(formula: CommissionFormula, id: string): CommissionFormula {
  const fix = (operand: Operand): Operand => (operand.kind === 'step' && operand.step === id ? { kind: 'number', value: 0 } : operand);
  const steps = formula.steps
    .filter((step) => step.id !== id)
    .map((step): FormulaStep => {
      switch (step.kind) {
        case 'percent':
          return { ...step, of: fix(step.of), percent: fix(step.percent) };
        case 'multiply':
        case 'divide':
          return { ...step, of: fix(step.of), by: fix(step.by) };
        case 'add':
        case 'subtract':
          return { ...step, of: fix(step.of), items: step.items.map(fix) };
        case 'at_least':
        case 'at_most':
          return { ...step, of: fix(step.of), limit: fix(step.limit) };
        case 'tiers':
          return { ...step, measure: fix(step.measure) };
        case 'condition':
          return { ...step, left: fix(step.left), right: fix(step.right), then: fix(step.then), otherwise: fix(step.otherwise) };
      }
    });
  return { steps };
}
