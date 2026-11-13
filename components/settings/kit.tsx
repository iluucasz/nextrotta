'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Banknote, Bot, CheckCircle2, CircleHelp, Clock3, CreditCard, DatabaseBackup, Loader2, Tags, type LucideIcon } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Panel } from '@/components/management-ui';
import { HelpDot } from '@/components/modal-kit';
import { LoadingShell } from '@/components/page-skeleton';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { OptionHelpDot, type OptionHelp } from './option-help';
import { cn } from '@/lib/utils';
import type { useSettingsForm } from './form';
import '../../app/admin/dashboard-gerencial/management-dashboard.css';
import './settings.css';

export type SettingsApi = ReturnType<typeof useSettingsForm>;

const SECTIONS: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: '/admin/configuracoes/pagamento', label: 'Pagamento', icon: Banknote },
  { href: '/admin/configuracoes/jornada', label: 'Jornada e horas', icon: Clock3 },
  { href: '/admin/configuracoes/porto', label: 'Robô do Porto', icon: Bot },
  { href: '/admin/configuracoes/financeiro', label: 'Financeiro', icon: Tags },
  { href: '/admin/configuracoes/backups', label: 'Backups', icon: DatabaseBackup },
  { href: '/admin/assinatura', label: 'Assinatura', icon: CreditCard },
];

/** Header and page frame shared by every screen under Configurações (including Assinatura). */
export function Frame({ userName, title, description, actions, children }: { userName: string; title: string; description: string; actions?: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <AppShell role="admin" userName={userName}>
      <div className="mg-dashboard st-page">
        <header className="mg-page-heading">
          <div>
            <div className="mg-eyebrow">
              <span /> EMPRESA <span className="mg-eyebrow-divider">/</span> CONFIGURAÇÕES
            </div>
            <h1>
              {title}
              <span>.</span>
            </h1>
            <p>{description}</p>
          </div>
          {actions ? <div className="mg-header-actions st-header-actions">{actions}</div> : null}
        </header>
        <nav className="mg-section-nav st-tabs" aria-label="Seções das configurações">
          {SECTIONS.map((section) => (
            <Link key={section.href} href={section.href} className={pathname === section.href ? 'active' : ''} aria-current={pathname === section.href ? 'page' : undefined}>
              <section.icon size={15} />
              {section.label}
            </Link>
          ))}
        </nav>
        <div className="st-body">{children}</div>
      </div>
    </AppShell>
  );
}

/** A panel whose explanation sits behind the "?" and whose extra control sits at the right of the title. */
export function SectionPanel({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Panel title={title} help={description} badge={action}>
      {children}
    </Panel>
  );
}

/** The frame of every settings screen: header, load/error states and the bar that appears when there is something to save. */
export function SettingsPage({ api, title, description, actions, children }: { api: SettingsApi; title: string; description: string; actions?: ReactNode; children: ReactNode }) {
  const { user, sessionLoading, loaded, error, dirty, saving, save, discard, saveError, justSaved } = api;

  if (sessionLoading || !user || (!loaded && !error)) return <LoadingShell role="admin" />;

  return (
    <Frame userName={user.name || user.email} title={title} description={description} actions={actions}>
      {error ? (
        <div className="mg-error" role="alert">
          <CircleHelp size={23} />
          <div>
            <strong>Não foi possível carregar</strong>
            <p>{error}</p>
          </div>
        </div>
      ) : (
        <>
          {/* On top, pinned under the header: at the bottom the assistant's bubble covers the Salvar button. */}
          {dirty || saving || justSaved || saveError ? (
            <div className={cn('st-savebar', saveError && 'bad', justSaved && !dirty && 'ok')} role="status">
              <span className="st-savebar-text">
                {saveError ? (
                  saveError
                ) : justSaved && !dirty ? (
                  <>
                    <CheckCircle2 size={18} /> Configurações salvas.
                  </>
                ) : (
                  <>
                    Alterações não salvas
                    <HelpDot label="Ao salvar" text="As mudanças valem para os próximos cálculos. Folhas já salvas mantêm os valores com que foram calculadas." />
                  </>
                )}
              </span>
              {dirty || saving ? (
                <span className="st-savebar-actions">
                  <Button type="button" variant="outline" onClick={discard} disabled={saving}>
                    Descartar
                  </Button>
                  <Button type="button" onClick={() => void save()} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Salvar
                  </Button>
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="st-stack">{children}</div>
        </>
      )}
    </Frame>
  );
}

/** A label with the "?" beside it: the explanation opens on click, the form stays quiet. */
export function Field({ id, label, help, children }: { id: string; label: string; help?: string; children: ReactNode }) {
  return (
    <div className="st-field">
      <div className="st-label">
        <label htmlFor={id}>{label}</label>
        {help ? <HelpDot text={help} label={label} /> : null}
      </div>
      {children}
    </div>
  );
}

export function NumberField({
  id,
  label,
  unit,
  unitPosition = 'end',
  help,
  value,
  onChange,
}: {
  id: string;
  label: string;
  unit: string;
  unitPosition?: 'start' | 'end';
  help?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field id={id} label={label} help={help}>
      <div className={cn('st-input', unitPosition === 'start' && 'unit-start')}>
        {unitPosition === 'start' ? <span>{unit}</span> : null}
        <input id={id} type="text" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} />
        {unitPosition === 'end' ? <span>{unit}</span> : null}
      </div>
    </Field>
  );
}

export function TimeField({ id, label, help, value, onChange }: { id: string; label: string; help?: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field id={id} label={label} help={help}>
      <div className="st-input">
        <input id={id} type="time" value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </Field>
  );
}

export function TextField({ id, label, help, value, placeholder, type = 'text', onChange }: { id: string; label: string; help?: string; value: string; placeholder?: string; type?: string; onChange: (value: string) => void }) {
  return (
    <Field id={id} label={label} help={help}>
      <div className="st-input">
        <input id={id} type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      </div>
    </Field>
  );
}

/** An on/off rule: title and "?" on the left, the switch on the right. */
export function Toggle({ title, help, checked, disabled, onChange }: { title: string; help?: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="st-toggle">
      <span className="st-toggle-title">
        {title}
        {help ? <HelpDot text={help} label={title} /> : null}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

/**
 * A few named choices side by side; the one picked is highlighted. An option with `help` gets its own "?"
 * (what it does, an example with numbers) so each way of doing it is explained where it is chosen.
 */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; title: string; text: string; help?: OptionHelp; /** Takes the whole row (an option that opens its own builder). */ wide?: boolean }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="st-choice">
      {options.map((option) => (
        <div key={option.value} className={cn('st-choice-item', option.help && 'has-help', option.wide && 'wide')}>
          <button type="button" role="radio" aria-checked={value === option.value} onClick={() => onChange(option.value)} className={cn(value === option.value && 'selected')}>
            <strong>{option.title}</strong>
            <small>{option.text}</small>
          </button>
          {option.help ? (
            <span className="st-choice-help">
              <OptionHelpDot title={option.title} help={option.help} />
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
