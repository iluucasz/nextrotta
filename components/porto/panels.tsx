'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronDown, FlaskConical, KeyRound, Loader2, Users, XCircle } from 'lucide-react';
import { Panel } from '@/components/management-ui';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS } from '@/components/modal-kit';
import { whenLabel, type PortoMode, type PortoStatus } from '@/lib/porto-status';
import { cn } from '@/lib/utils';
import type { PortoApi } from './use-porto';

const MODES: Array<{ value: PortoMode; title: string; text: string }> = [
  { value: 'off', title: 'Desligado', text: 'O robô não importa nada.' },
  { value: 'test', title: 'Teste', text: 'Roda todo dia e mostra o que faria, sem gravar nada. Bom para começar.' },
  { value: 'live', title: 'Valendo', text: 'Importa as horas e a escala de verdade, todo dia.' },
];

/** Off, test or live: one choice, said in words. Going live asks first; the others apply at once. */
export function ModePanel({ mode, enabled, times, saving, onChange }: { mode: PortoMode; enabled: boolean; times: { hours: string; schedule: string }; saving: boolean; onChange: (mode: PortoMode) => void }) {
  return (
    <Panel title="Importação automática" description="O que o robô faz sozinho todo dia.">
      <div role="radiogroup" aria-label="Modo da importação" className="po-modes">
        {MODES.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={mode === item.value}
            disabled={!enabled || saving}
            onClick={() => mode !== item.value && onChange(item.value)}
            className={cn('po-mode', mode === item.value && 'selected', item.value)}
          >
            <span className="po-mode-dot" aria-hidden="true" />
            <span>
              <strong>{item.title}</strong>
              <small>{item.text}</small>
            </span>
          </button>
        ))}
      </div>
      {!enabled ? <p className="po-note">Conecte a conta do Porto para poder ligar.</p> : null}
      <p className="po-note">
        Horas: todo dia às <strong>{times.hours}</strong> · Escala: todo dia às <strong>{times.schedule}</strong>.{' '}
        <Link href="/admin/configuracoes" className="po-link">
          Mudar horários e regras
        </Link>
      </p>
    </Panel>
  );
}

/** How many technicians the robot can find, who cannot be found yet, and the way to fix it. */
export function TechniciansPanel({ status, enabled, onMatch }: { status: PortoStatus; enabled: boolean; onMatch: () => void }) {
  const { active, linked, unlinked } = status.technicians;
  const share = active ? Math.round((linked / active) * 100) : 0;

  return (
    <Panel title="Técnicos" description="O robô acha as horas de cada um pelo QRA do Porto.">
      {active ? (
        <>
          <p className="po-count">
            <strong>{linked}</strong> de {active} vinculados
          </p>
          <div className={cn('po-bar', unlinked.length ? 'partial' : 'full')} role="progressbar" aria-valuenow={share} aria-valuemin={0} aria-valuemax={100} aria-label="Técnicos vinculados">
            <i style={{ width: `${share}%` }} />
          </div>
          {unlinked.length ? (
            <ul className="po-unlinked">
              {unlinked.slice(0, 5).map((technician) => (
                <li key={technician.id}>{technician.name}</li>
              ))}
              {unlinked.length > 5 ? <li className="more">e mais {unlinked.length - 5}</li> : null}
            </ul>
          ) : (
            <p className="po-note ok">Todos os técnicos ativos estão vinculados.</p>
          )}
        </>
      ) : (
        <p className="po-note">Nenhum técnico ativo cadastrado ainda.</p>
      )}
      <Button type="button" variant={unlinked.length ? 'default' : 'outline'} size="sm" className="mt-3" disabled={!enabled} onClick={onMatch}>
        <Users className="h-4 w-4" />
        {unlinked.length ? 'Vincular técnicos' : 'Conferir vínculos'}
      </Button>
    </Panel>
  );
}

const maskCpf = (cpf: string) => (cpf.length === 11 ? `•••.•••.•••-${cpf.slice(9)}` : cpf || '—');

/** The Porto account: who it is, whether the login works, and how to change it. */
export function AccountPanel({ api, now, onEdit, onTest, testing }: { api: PortoApi; now: Date; onEdit: () => void; onTest: () => void; testing: boolean }) {
  const { config } = api;
  const has = Boolean(config.cpf) && config.has_password;
  const tested = config.last_login_test_ok;

  return (
    <Panel title="Conta do Porto" description="O acesso que o robô usa no Portal do Prestador.">
      {has ? (
        <dl className="po-account">
          <div>
            <dt>CPF</dt>
            <dd>{maskCpf(config.cpf)}</dd>
          </div>
          <div>
            <dt>Senha</dt>
            <dd>•••••••• guardada</dd>
          </div>
          <div>
            <dt>Login</dt>
            <dd className={cn(tested === true && 'ok', tested === false && 'bad')}>
              {tested === true ? <CheckCircle2 size={15} /> : tested === false ? <XCircle size={15} /> : null}
              {tested === true ? `Funcionou ${whenLabel(config.last_login_test_at ?? null, now)}` : tested === false ? `O Porto recusou ${whenLabel(config.last_login_test_at ?? null, now)}` : 'Ainda não testado'}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="po-note">Nenhuma conta conectada.</p>
      )}
      <div className="po-actions">
        <Button type="button" size="sm" variant={has ? 'outline' : 'default'} onClick={onEdit}>
          <KeyRound className="h-4 w-4" />
          {has ? 'Alterar' : 'Conectar a conta'}
        </Button>
        {has ? (
          <Button type="button" size="sm" variant="outline" onClick={onTest} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {testing ? 'Testando…' : 'Testar o login'}
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

/** The technical part, out of the way: simulate a job for a chosen period without writing anything. */
export function Advanced({ busy, onSimulate }: { busy: boolean; onSimulate: (job: 'hours' | 'schedule', range?: { start: string; end: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  return (
    <section className="po-advanced">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Ferramentas avançadas
        <ChevronDown size={15} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="po-advanced-body">
          <p>
            Simule uma importação sem gravar nada, para ver o que o robô faria. Não conta no limite do plano. Para as horas, você pode escolher o período (em branco é o mês inteiro até hoje).
          </p>
          <div className="po-range">
            <label>
              De
              <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
            </label>
            <label>
              Até
              <input type="date" value={end} min={start || undefined} disabled={!start} onChange={(event) => setEnd(event.target.value)} />
            </label>
            {start ? (
              <button type="button" className="po-link" onClick={() => (setStart(''), setEnd(''))}>
                Limpar
              </button>
            ) : null}
          </div>
          <div className="po-actions">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onSimulate('hours', start ? { start, end: end || start } : undefined)}>
              <FlaskConical className="h-4 w-4" />
              Simular horas
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onSimulate('schedule')}>
              <FlaskConical className="h-4 w-4" />
              Simular escala
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Going live writes hours and escala for real: say it, and say that nothing done by hand is overwritten. */
export function LiveConfirm({ saving, onCancel, onConfirm }: { saving: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <DialogTitle className={MODAL_TITLE_CLASS}>Gravar de verdade?</DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>A partir de agora o robô grava as horas e a escala no seu sistema, todo dia.</DialogDescription>
        </DialogHeader>
        <div className={cn(MODAL_BODY_CLASS, 'space-y-2 text-sm text-muted-foreground')}>
          <p>Os dias que você lançou à mão não são sobrescritos.</p>
          <p>Você pode voltar para o modo Teste ou desligar quando quiser.</p>
        </div>
        <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'flex-col-reverse sm:flex-row sm:justify-end')}>
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Voltar
          </Button>
          <Button type="button" onClick={onConfirm} disabled={saving}>
            {saving ? 'Ligando…' : 'Sim, gravar de verdade'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
