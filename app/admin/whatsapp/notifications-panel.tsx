'use client';

import { useState } from 'react';
import { Check, HelpCircle, Loader2, Play, RotateCcw, X, Zap } from 'lucide-react';
import { DataPanel } from '@/components/data-panel';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import {
  exampleVariables,
  NOTIFICATION_DEFINITIONS,
  NOTIFICATION_TYPES,
  renderTemplate,
  type NotificationSetting,
  type NotificationDefinition,
  type NotificationType,
  type NotificationVariable,
} from '@/lib/whatsapp/notification-types';
import { inputClassName, type WhatsAppConfigForm } from './types';

interface NotificationsPanelProps {
  form: WhatsAppConfigForm;
  onChange: (patch: Partial<WhatsAppConfigForm>) => void;
  /** True while an edit hasn't reached the server yet — running would use the old settings. */
  unsaved: boolean;
}

interface RunSummary {
  candidates: number;
  sent: number;
  failed: number;
  skipped: number;
  duplicates: number;
  problems?: Array<{ technician: string; reason: string }>;
}

function describeRun(summary: RunSummary) {
  if (!summary.candidates) return 'Nada para enviar agora: ninguém se encaixa nesta notificação hoje.';

  const parts = [`${summary.sent} enviada(s)`];
  if (summary.duplicates) parts.push(`${summary.duplicates} já enviada(s) antes`);
  if (summary.skipped) parts.push(`${summary.skipped} não enviada(s)`);
  if (summary.failed) parts.push(`${summary.failed} com falha`);
  return parts.join(' · ');
}

function scheduleLabel(type: NotificationType, setting: NotificationSetting) {
  const trigger = NOTIFICATION_DEFINITIONS[type].trigger;
  if (trigger === 'event') return 'Na hora do evento';
  if (trigger === 'monthly') return `Todo dia ${setting.dayOfMonth}, às ${setting.time}`;
  return `Todo dia, às ${setting.time}`;
}

/** The "?" in the card header: what this notification does, when it goes out and who gets it. */
function NotificationHelp({ definition, setting, enabledGlobally }: { definition: NotificationDefinition; setting: NotificationSetting; enabledGlobally: boolean }) {
  const requirements = [
    { label: 'Esta notificação ligada (o botão ao lado)', done: setting.enabled },
    { label: 'Automação ativa, na aba Conexão', done: enabledGlobally },
    ...(definition.trigger === 'event' ? [] : [{ label: 'Worker rodando na VPS (é ele quem dispara no horário)', done: null }]),
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Como funciona: ${definition.label}`}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] space-y-3 text-sm">
        <div>
          <p className="font-semibold">{definition.label}</p>
          <p className="mt-1 text-muted-foreground">{definition.help.purpose}</p>
        </div>

        <div className="border-t border-border pt-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">Quando sai</p>
          <p className="mt-1 text-muted-foreground">{definition.help.when}</p>
        </div>

        <div className="border-t border-border pt-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">Quem recebe</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
            {definition.help.recipients.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="border-t border-border pt-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">Para sair automaticamente</p>
          <ul className="mt-1 space-y-1">
            {requirements.map((requirement) => (
              <li key={requirement.label} className="flex items-start gap-1.5">
                {requirement.done === null ? (
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
                ) : requirement.done ? (
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                ) : (
                  <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" />
                )}
                <span className={requirement.done === false ? 'text-rose-700' : 'text-muted-foreground'}>{requirement.label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            &quot;Rodar agora&quot; envia na hora mesmo com tudo desligado — útil para testar.
          </p>
        </div>

        {definition.help.notes.length ? (
          <div className="border-t border-border pt-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Vale saber</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {definition.help.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** The "?" next to the variables: what they are, and what each one is replaced with. */
function VariablesHelp({ variables }: { variables: NotificationVariable[] }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="O que são variáveis?"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] space-y-3 text-sm">
        <div className="space-y-1">
          <p className="font-semibold">O que são variáveis</p>
          <p className="text-muted-foreground">
            São trechos entre chaves que o sistema troca pelos dados reais de cada técnico na hora do envio. Escrever{' '}
            <code className="rounded bg-secondary px-1 font-mono text-xs">Olá, {'{nome}'}!</code> faz cada um receber o próprio nome.
          </p>
          <p className="text-muted-foreground">Clique em uma variável para inserir no fim do texto, ou digite você mesmo, com as chaves.</p>
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">Nesta mensagem</p>
          {variables.map((variable) => (
            <div key={variable.key} className="space-y-0.5">
              <code className="font-mono text-xs text-foreground">{`{${variable.key}}`}</code>
              <p className="text-xs text-muted-foreground">{variable.description}</p>
              <p className="text-xs text-muted-foreground">
                Vira: <span className="whitespace-pre-line text-foreground">{variable.example}</span>
              </p>
            </div>
          ))}
        </div>

        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          Escreveu uma variável que não existe? Ela sai no texto do jeito que você digitou. Confira sempre na prévia ao lado.
        </p>
      </PopoverContent>
    </Popover>
  );
}

interface NotificationCardProps {
  type: NotificationType;
  setting: NotificationSetting;
  onChange: (patch: Partial<NotificationSetting>) => void;
  unsaved: boolean;
  testPhone: string;
  enabledGlobally: boolean;
}

function NotificationCard({ type, setting, onChange, unsaved, testPhone, enabledGlobally }: NotificationCardProps) {
  const definition = NOTIFICATION_DEFINITIONS[type];
  const [isRunning, setIsRunning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [runFeedback, setRunFeedback] = useState<{ tone: 'success' | 'error'; text: string; problems?: Array<{ technician: string; reason: string }> } | null>(null);
  const preview = renderTemplate(setting.template, exampleVariables(type));

  async function handleRunNow() {
    setConfirmOpen(false);
    setIsRunning(true);
    setRunFeedback(null);

    try {
      const response = await fetch('/api/whatsapp/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) throw new Error(data?.error || 'Não foi possível executar.');

      setRunFeedback({ tone: 'success', text: describeRun(data.summary), problems: data.summary?.problems ?? [] });
    } catch (error) {
      setRunFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Não foi possível executar.' });
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <DataPanel
      title={definition.label}
      description={definition.description}
      action={
        <div className="flex items-center gap-3">
          <NotificationHelp definition={definition} setting={setting} enabledGlobally={enabledGlobally} />
          <StatusBadge tone={setting.enabled ? 'success' : 'neutral'}>{setting.enabled ? scheduleLabel(type, setting) : 'Desligada'}</StatusBadge>
          <Switch checked={setting.enabled} onCheckedChange={(enabled) => onChange({ enabled })} aria-label={`Ativar ${definition.label}`} />
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className="space-y-4">
          {definition.trigger === 'event' ? (
            <p className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">
              <Zap className="h-4 w-4 text-primary" />
              Disparada automaticamente pelo sistema, uma única vez por {type === 'payroll_closed' ? 'folha' : 'dia justificado'}.
            </p>
          ) : (
            <div className="flex flex-wrap gap-4">
              {definition.trigger === 'monthly' ? (
                <label className="text-sm">
                  <span className="mb-1.5 block font-medium">Dia do mês</span>
                  <select
                    value={setting.dayOfMonth}
                    onChange={(event) => onChange({ dayOfMonth: Number(event.target.value) })}
                    className={`${inputClassName} w-28`}
                  >
                    {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                      <option key={day} value={day}>
                        Dia {day}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="text-sm">
                <span className="mb-1.5 block font-medium">Horário (Brasília)</span>
                <input type="time" value={setting.time} onChange={(event) => onChange({ time: event.target.value })} className={`${inputClassName} w-32`} />
              </label>
            </div>
          )}

          {type === 'daily_hours' ? (
            <p className="text-xs text-muted-foreground">
              Sai logo após a importação das horas da Porto (horário em Configurações). O horário acima é a segunda chance: só dispara depois que a importação do dia terminou.
            </p>
          ) : null}

          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Mensagem</span>
            <textarea
              value={setting.template}
              onChange={(event) => onChange({ template: event.target.value })}
              rows={7}
              className={`${inputClassName} py-2 font-mono text-[13px] leading-relaxed`}
            />
          </label>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
              Variáveis (clique para inserir)
              <VariablesHelp variables={definition.variables} />
            </p>
            <div className="flex flex-wrap gap-1.5">
              {definition.variables.map((variable) => (
                <button
                  key={variable.key}
                  type="button"
                  title={`${variable.description} — vira: ${variable.example}`}
                  onClick={() => onChange({ template: `${setting.template}{${variable.key}}` })}
                  className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  {`{${variable.key}}`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange({ template: definition.defaultTemplate })}
              disabled={setting.template === definition.defaultTemplate}
            >
              <RotateCcw className="h-4 w-4" />
              Restaurar texto padrão
            </Button>
            {definition.trigger !== 'event' ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmOpen(true)} disabled={isRunning || unsaved} title={unsaved ? 'Aguarde o salvamento automático' : undefined}>
                {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Rodar agora
              </Button>
            ) : null}
          </div>
          {runFeedback ? (
            <div className="space-y-1 text-sm">
              <p className={runFeedback.tone === 'success' ? 'text-emerald-700' : 'text-rose-700'}>{runFeedback.text}</p>
              {runFeedback.problems?.length ? (
                <ul className="space-y-0.5 text-xs text-amber-700">
                  {runFeedback.problems.map((problem, index) => (
                    <li key={`${problem.technician}-${index}`}>
                      <strong className="font-medium">{problem.technician || 'Sem técnico'}</strong>: {problem.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Enviar &quot;{definition.label}&quot; agora?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                {testPhone ? (
                  <div className="space-y-2">
                    <span className="block rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
                      <strong className="font-semibold">Modo teste ligado.</strong> As mensagens vão para {testPhone} e nenhum técnico recebe.
                    </span>
                    <span className="block">Para enviar de verdade, apague o número de teste na aba Conexão e salve antes de rodar.</span>
                  </div>
                ) : (
                  <span>
                    As mensagens saem agora para os técnicos que se encaixam nesta notificação. Quem já recebeu não recebe de novo, e o resultado aparece
                    logo abaixo do botão.
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <Button type="button" onClick={handleRunNow}>
                {testPhone ? 'Enviar para o número de teste' : 'Enviar agora'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div>
          <p className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">Prévia (dados de exemplo)</p>
          <div className="rounded-xl border border-emerald-200 bg-[#e7fbe6] p-4 shadow-sm">
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[#111b21]">{preview}</p>
          </div>
        </div>
      </div>
    </DataPanel>
  );
}

export function NotificationsPanel({ form, onChange, unsaved }: NotificationsPanelProps) {
  function updateSetting(type: NotificationType, patch: Partial<NotificationSetting>) {
    onChange({ notifications: { ...form.notifications, [type]: { ...form.notifications[type], ...patch } } });
  }

  return (
    <div className="space-y-5">
      {!form.enabled ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          A automação está desligada na aba Conexão: nenhuma destas notificações sai sozinha até você ligá-la. &quot;Rodar agora&quot; funciona mesmo assim.
        </div>
      ) : null}
      {form.testPhone ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong className="font-semibold">Modo teste ligado.</strong> Enquanto o número de teste ({form.testPhone}) estiver preenchido na aba Conexão,
          todas as mensagens vão para ele e <strong>nenhum técnico recebe</strong>. Envios de teste não contam como enviados: ao limpar o número, cada
          técnico ainda recebe a mensagem dele normalmente.
        </div>
      ) : null}
      {NOTIFICATION_TYPES.map((type) => (
        <NotificationCard
          key={type}
          type={type}
          setting={form.notifications[type]}
          onChange={(patch) => updateSetting(type, patch)}
          unsaved={unsaved}
          testPhone={form.testPhone}
          enabledGlobally={form.enabled}
        />
      ))}
    </div>
  );
}
