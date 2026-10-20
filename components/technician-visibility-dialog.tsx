'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, HelpCircle, Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import {
  createDefaultVisibility,
  currentMonthKey,
  diffVisibility,
  normalizeVisibility,
  type MonthScope,
  type MonthScopeMode,
  type TechnicianVisibility,
  type VisibilityDifference,
  type VisibilitySource,
} from '@/lib/technician-visibility';

type Scope = 'technician' | 'global';

interface VisibilityDetail {
  technician: { id: string; name: string } | null;
  global: TechnicianVisibility | null;
  override: TechnicianVisibility | null;
  source: VisibilitySource;
  overrideCount: number;
}

interface TechnicianVisibilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const monthModeOptions: Array<{ value: MonthScopeMode; label: string }> = [
  { value: 'all', label: 'Todas as datas' },
  { value: 'current', label: 'Somente o mês atual' },
  { value: 'fixed', label: 'Somente um mês definido' },
];

function describeSource(detail: VisibilityDetail) {
  const name = detail.technician?.name ?? 'Este técnico';
  if (detail.source === 'technician') return `${name} tem uma exceção à regra de todos.`;
  if (detail.source === 'global') return `${name} segue a regra de todos os técnicos.`;
  return `${name} ainda vê tudo (nenhuma configuração salva).`;
}

/** The "?" next to a setting: what it changes on the technician's screen. */
function Hint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`O que faz: ${label}`}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-2 text-sm text-muted-foreground">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Same three options everywhere a month scope appears, so explain them once. */
function MonthScopeHint({ label, scope }: { label: string; scope: string }) {
  return (
    <Hint label={label}>
      <p className="font-semibold text-foreground">Quais meses o técnico pode ver {scope}</p>
      <ul className="list-disc space-y-1 pl-4">
        <li>
          <strong className="font-medium text-foreground">Todas as datas:</strong> ele escolhe qualquer mês que tenha dados.
        </li>
        <li>
          <strong className="font-medium text-foreground">Somente o mês atual:</strong> só o mês corrente, e vira o mês seguinte sozinho na virada.
        </li>
        <li>
          <strong className="font-medium text-foreground">Somente um mês definido:</strong> trava em um mês que você escolhe.
        </li>
      </ul>
      <p>Nos dois últimos casos, o seletor de data fica travado nesse mês, e os números da tela passam a considerar só ele.</p>
    </Hint>
  );
}

interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  help?: React.ReactNode;
}

function ToggleRow({ label, description, checked, onChange, disabled, help }: ToggleRowProps) {
  return (
    <div className={`flex items-center justify-between gap-4 py-2 ${disabled ? 'opacity-50' : ''}`}>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {label}
          {help ? <Hint label={label}>{help}</Hint> : null}
        </span>
        {description ? <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span> : null}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
    </div>
  );
}

interface MonthScopeFieldProps {
  label: string;
  value: MonthScope;
  onChange: (value: MonthScope) => void;
  disabled?: boolean;
  /** What this month scope applies to, e.g. "no banco de horas". */
  scope: string;
}

function MonthScopeField({ label, value, onChange, disabled, scope }: MonthScopeFieldProps) {
  return (
    <div className={`flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between ${disabled ? 'opacity-50' : ''}`}>
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {label}
        <MonthScopeHint label={label} scope={scope} />
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2.5">
          <CalendarDays className="h-4 w-4 text-primary" />
          <select
            value={value.mode}
            disabled={disabled}
            onChange={(event) => {
              const mode = event.target.value as MonthScopeMode;
              // Seed a fixed scope with the current month so it's never saved empty by accident.
              onChange({ mode, month: mode === 'fixed' ? value.month ?? currentMonthKey() : null });
            }}
            className="bg-transparent text-sm outline-none"
          >
            {monthModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </span>
        {value.mode === 'fixed' ? (
          <input
            type="month"
            value={value.month ?? ''}
            disabled={disabled}
            onChange={(event) => onChange({ mode: 'fixed', month: event.target.value || null })}
            className="h-9 rounded-md border border-border bg-background px-2.5 text-sm outline-none"
          />
        ) : null}
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  path: string;
  children: React.ReactNode;
}

function Section({ title, path, children }: SectionProps) {
  return (
    <section className="rounded-lg border border-border bg-background px-4 py-2">
      <div className="flex items-baseline justify-between gap-3 border-b border-border py-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <code className="text-xs text-muted-foreground">{path}</code>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

/**
 * Admin-only settings for what technicians can see, opened from the preview banner. Saves either
 * as an override for the technician being previewed or as the default for all technicians.
 */
export function TechnicianVisibilityDialog({ open, onOpenChange }: TechnicianVisibilityDialogProps) {
  const [detail, setDetail] = useState<VisibilityDetail | null>(null);
  const [form, setForm] = useState<TechnicianVisibility>(createDefaultVisibility);
  const [scope, setScope] = useState<Scope>('technician');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  /** Set while asking whether a technician's differing settings should become an exception. */
  const [pendingDifferences, setPendingDifferences] = useState<VisibilityDifference[] | null>(null);

  useEffect(() => {
    if (!open) return;

    let mounted = true;

    async function load() {
      setIsLoading(true);
      setError('');

      try {
        const response = await fetch('/api/technician-visibility?detail=1');
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(data?.error || 'Não foi possível carregar a configuração.');
        }

        if (!mounted) return;

        const loaded: VisibilityDetail = {
          technician: data.technician ?? null,
          global: data.global ? normalizeVisibility(data.global) : null,
          override: data.override ? normalizeVisibility(data.override) : null,
          source: data.source,
          overrideCount: Number(data.overrideCount ?? 0),
        };

        setDetail(loaded);
        // Start from what this technician currently sees, whichever layer it comes from.
        setForm(loaded.override ?? loaded.global ?? createDefaultVisibility());
        setScope(loaded.technician ? 'technician' : 'global');
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a configuração.');
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, [open]);

  function update<K extends keyof TechnicianVisibility>(section: K, patch: Partial<TechnicianVisibility[K]>) {
    setForm((current) => ({ ...current, [section]: { ...current[section], ...patch } }));
  }

  function findMissingFixedMonth() {
    const scopes: Array<[string, MonthScope]> = [
      ['Minha visão', form.dashboard.month],
      ['Banco de horas', form.hours.month],
      ['Agenda', form.schedule.month],
      ['Pagamento', form.payroll.month],
    ];

    return scopes.find(([, value]) => value.mode === 'fixed' && !value.month)?.[0];
  }

  function handleSave() {
    const missing = findMissingFixedMonth();

    if (missing) {
      setError(`Escolha o mês definido em "${missing}".`);
      return;
    }

    if (scope === 'global' || !detail) {
      void persist();
      return;
    }

    // The rule for all technicians is the baseline; a technician's own settings are an exception to
    // it. Anything that differs has to be confirmed as such before it's saved.
    const differences = diffVisibility(form, detail.global ?? createDefaultVisibility());

    if (differences.length) {
      setPendingDifferences(differences);
      return;
    }

    // Identical to the rule for all: an override would only freeze today's copy of that rule and
    // stop this technician from following future changes to it. Following the rule is the intent.
    if (detail.override) {
      void handleRemoveOverride();
    } else {
      onOpenChange(false);
    }
  }

  /** Answer to the exception prompt: drop the edits and keep following the rule for all. */
  function handleFollowGlobal() {
    setPendingDifferences(null);

    if (detail?.override) {
      void handleRemoveOverride();
    } else {
      onOpenChange(false);
    }
  }

  async function persist() {
    setPendingDifferences(null);
    setIsSaving(true);
    setError('');

    try {
      const response = await fetch('/api/technician-visibility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, settings: form }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Não foi possível salvar.');
      }

      // Full reload so every screen (and the menu) re-reads the settings from scratch.
      window.location.reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar.');
      setIsSaving(false);
    }
  }

  async function handleRemoveOverride() {
    setIsSaving(true);
    setError('');

    try {
      const response = await fetch('/api/technician-visibility', { method: 'DELETE' });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Não foi possível remover a exceção.');
      }

      window.location.reload();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Não foi possível remover a exceção.');
      setIsSaving(false);
    }
  }

  const technicianName = detail?.technician?.name ?? 'este técnico';
  const disabled = isLoading || isSaving || !detail;

  return (
    <>
    <Dialog open={open} onOpenChange={(value) => !isSaving && onOpenChange(value)}>
      <DialogContent className="max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Visibilidade do técnico</DialogTitle>
          <DialogDescription>
            Escolha o que o técnico pode ver nas telas dele. Isso só esconde o que aparece na tela e nas datas: nenhum dado é apagado.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando configuração...
          </div>
        ) : detail ? (
          <div className="flex flex-col gap-4">
            <div>
              <span className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                Aplicar para
                <Hint label="Aplicar para">
                  <p className="font-semibold text-foreground">Uma regra para todos, exceções quando precisar</p>
                  <p>
                    <strong className="font-medium text-foreground">Todos os técnicos</strong> é a regra base: vale para quem não tem exceção, e muda para
                    todos eles de uma vez.
                  </p>
                  <p>
                    <strong className="font-medium text-foreground">Somente este técnico</strong> cria uma exceção. Ele para de seguir a regra de todos,
                    inclusive em mudanças futuras, até você remover a exceção.
                  </p>
                  <p>Se o que você marcar for diferente da regra de todos, o sistema avisa antes de salvar e mostra exatamente o que está diferente.</p>
                </Hint>
              </span>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {([
                  {
                    value: 'technician' as const,
                    label: `Somente ${technicianName}`,
                    description: 'Exceção à regra de todos, vale só para ele.',
                  },
                  {
                    value: 'global' as const,
                    label: 'Todos os técnicos',
                    description: 'Regra base, vale para quem não tem exceção.',
                  },
                ]).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={disabled || (option.value === 'technician' && !detail.technician)}
                    onClick={() => setScope(option.value)}
                    className={`rounded-md border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      scope === option.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-secondary'
                    }`}
                  >
                    <span className="block text-sm font-semibold">{option.label}</span>
                    <span className={`mt-0.5 block text-xs ${scope === option.value ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                      {option.description}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {describeSource(detail)}
                {scope === 'global' && detail.overrideCount > 0
                  ? ` Técnicos com exceção (${detail.overrideCount}) não mudam ao salvar para todos.`
                  : ''}
              </p>
            </div>

            <Section title="Minha visão" path="/dashboard">
              <MonthScopeField
                label="Datas no filtro"
                scope="no painel dele"
                value={form.dashboard.month}
                onChange={(month) => update('dashboard', { month })}
                disabled={disabled}
              />
              <ToggleRow
                label="Serviços por tipo"
                description="Gráfico de OS agrupadas por tipo."
                checked={form.dashboard.servicesByType}
                onChange={(servicesByType) => update('dashboard', { servicesByType })}
                disabled={disabled}
                help={
                  <>
                    <p className="font-semibold text-foreground">O gráfico de barras por tipo de serviço</p>
                    <p>Desligado, o gráfico some do painel do técnico. Os cards do topo e as metas continuam como estão.</p>
                  </>
                }
              />
              <ToggleRow
                label="Serviços realizados"
                description="Tabela com as OS do período."
                checked={form.dashboard.servicesPerformed}
                onChange={(servicesPerformed) => update('dashboard', { servicesPerformed })}
                disabled={disabled}
                help={
                  <>
                    <p className="font-semibold text-foreground">A tabela com cada OS do período</p>
                    <p>Traz número da OS, tipo, data e hora. Desligado, o técnico continua vendo a quantidade de OS nos cards, mas não a lista item a item.</p>
                  </>
                }
              />
            </Section>

            <Section title="Banco de horas" path="/dashboard/hours">
              <ToggleRow
                label="Exibir página"
                checked={form.hours.visible}
                onChange={(visible) => update('hours', { visible })}
                disabled={disabled}
                help={<>
                    <p className="font-semibold text-foreground">Desligado, a página some para o técnico</p>
                    <p>Ela sai do menu lateral dele. Se ele abrir o endereço direto, volta para &quot;Minha visão&quot;.</p>
                    <p>Os dados continuam no sistema e você continua vendo tudo no admin.</p>
                  </>}
              />
              <MonthScopeField
                label="Meses"
                scope="no banco de horas"
                value={form.hours.month}
                onChange={(month) => update('hours', { month })}
                disabled={disabled || !form.hours.visible}
              />
              <ToggleRow
                label="Registro de horas"
                description="Tabela com os apontamentos dia a dia."
                checked={form.hours.hoursLog}
                onChange={(hoursLog) => update('hours', { hoursLog })}
                disabled={disabled || !form.hours.visible}
                help={
                  <>
                    <p className="font-semibold text-foreground">A tabela de entrada, saída e saldo de cada dia</p>
                    <p>Desligado, o técnico ainda vê os totais do mês nos cards do topo, mas não o detalhe dia a dia.</p>
                  </>
                }
              />
            </Section>

            <Section title="Agenda" path="/dashboard/schedule">
              <ToggleRow
                label="Exibir página"
                checked={form.schedule.visible}
                onChange={(visible) => update('schedule', { visible })}
                disabled={disabled}
                help={<>
                    <p className="font-semibold text-foreground">Desligado, a página some para o técnico</p>
                    <p>Ela sai do menu lateral dele. Se ele abrir o endereço direto, volta para &quot;Minha visão&quot;.</p>
                    <p>Os dados continuam no sistema e você continua vendo tudo no admin.</p>
                  </>}
              />
              <MonthScopeField
                label="Meses"
                scope="na agenda"
                value={form.schedule.month}
                onChange={(month) => update('schedule', { month })}
                disabled={disabled || !form.schedule.visible}
              />
            </Section>

            <Section title="Pagamento" path="/dashboard/payroll">
              <ToggleRow
                label="Exibir página"
                checked={form.payroll.visible}
                onChange={(visible) => update('payroll', { visible })}
                disabled={disabled}
                help={<>
                    <p className="font-semibold text-foreground">Desligado, a página some para o técnico</p>
                    <p>Ela sai do menu lateral dele. Se ele abrir o endereço direto, volta para &quot;Minha visão&quot;.</p>
                    <p>Os dados continuam no sistema e você continua vendo tudo no admin.</p>
                  </>}
              />
              <MonthScopeField
                label="Meses"
                scope="no pagamento"
                value={form.payroll.month}
                onChange={(month) => update('payroll', { month })}
                disabled={disabled || !form.payroll.visible}
              />
            </Section>

            <Section title="Biblioteca" path="/dashboard/library">
              <ToggleRow
                label="Exibir página"
                checked={form.library.visible}
                onChange={(visible) => update('library', { visible })}
                disabled={disabled}
                help={<>
                    <p className="font-semibold text-foreground">Desligado, a página some para o técnico</p>
                    <p>Ela sai do menu lateral dele. Se ele abrir o endereço direto, volta para &quot;Minha visão&quot;.</p>
                    <p>Os dados continuam no sistema e você continua vendo tudo no admin.</p>
                  </>}
              />
            </Section>
          </div>
        ) : null}

        {error ? <p className="text-sm text-rose-700">{error}</p> : null}

        <DialogFooter className="gap-2 sm:flex-wrap sm:items-center sm:justify-between">
          {scope === 'technician' && detail?.override ? (
            <Button type="button" variant="ghost" onClick={handleRemoveOverride} disabled={disabled}>
              Remover exceção
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSave} disabled={disabled}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {/* The name is already on the "Aplicar para" toggle above; repeating it here made the
                  footer as wide as the longest technician name and overflow the modal. */}
              {scope === 'technician' ? 'Salvar para este técnico' : 'Salvar para todos'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={Boolean(pendingDifferences)} onOpenChange={(value) => !value && setPendingDifferences(null)}>
      <AlertDialogContent className="max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Criar exceção para {technicianName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingDifferences?.length === 1 ? 'Esta configuração está diferente' : 'Estas configurações estão diferentes'} da regra de todos os técnicos.
            Deseja que {technicianName} tenha uma regra própria, ou que continue seguindo a regra de todos?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Configuração</th>
                <th className="px-3 py-2 text-left font-medium">Exceção</th>
                <th className="px-3 py-2 text-left font-medium">Regra de todos</th>
              </tr>
            </thead>
            <tbody>
              {pendingDifferences?.map((difference) => (
                <tr key={difference.label} className="border-t border-border">
                  <td className="px-3 py-2">{difference.label}</td>
                  <td className="px-3 py-2 font-semibold text-primary">{difference.left}</td>
                  <td className="px-3 py-2 text-muted-foreground">{difference.right}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">
          Com a exceção, mudanças futuras na regra de todos não afetam {technicianName} até que a exceção seja removida.
        </p>

        <AlertDialogFooter className="gap-2 sm:flex-wrap">
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <Button type="button" variant="outline" onClick={handleFollowGlobal}>
            Seguir a regra de todos
          </Button>
          <Button type="button" onClick={() => void persist()}>
            Salvar como exceção
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
