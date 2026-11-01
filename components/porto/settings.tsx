'use client';

import Link from 'next/link';
import { CheckCircle2, KeyRound, Loader2, Users, XCircle } from 'lucide-react';
import { HelpDot } from '@/components/modal-kit';
import { Button } from '@/components/ui/button';
import { whenLabel, type PortoMode, type PortoStatus } from '@/lib/porto-status';
import { cn } from '@/lib/utils';
import type { PortoApi } from './use-porto';

const MODES: Array<{ value: PortoMode; label: string }> = [
  { value: 'off', label: 'Desligado' },
  { value: 'test', label: 'Teste' },
  { value: 'live', label: 'Valendo' },
];

const MODE_HELP =
  'Desligado: o robô não importa nada.\nTeste: roda todo dia e mostra o que faria, sem gravar. Bom para começar.\nValendo: importa as horas e a escala de verdade, todo dia. Os dias lançados à mão nunca são sobrescritos.';

const maskCpf = (cpf: string) => (cpf.length === 11 ? `•••.•••.•••-${cpf.slice(9)}` : cpf || '—');

function Row({ title, help, sub, children }: { title: string; help?: string; sub: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="po-row">
      <div className="po-row-main">
        <strong>
          {title}
          {help ? <HelpDot text={help} label={title} /> : null}
        </strong>
        <span className="po-row-sub">{sub}</span>
      </div>
      <div className="po-row-end">{children}</div>
    </div>
  );
}

/** The three things the robot depends on, one line each: when it runs, which account it uses, which technicians it finds. */
export function Settings({
  api,
  status,
  mode,
  times,
  now,
  saving,
  testing,
  onMode,
  onAccount,
  onTest,
  onMatch,
}: {
  api: PortoApi;
  status: PortoStatus;
  mode: PortoMode;
  times: { hours: string; schedule: string };
  now: Date;
  saving: boolean;
  testing: boolean;
  onMode: (mode: PortoMode) => void;
  onAccount: () => void;
  onTest: () => void;
  onMatch: () => void;
}) {
  const { config } = api;
  const has = Boolean(config.cpf) && config.has_password;
  const tested = config.last_login_test_ok;
  const { active, linked, unlinked } = status.technicians;

  return (
    <section className="po-card">
      <Row
        title="Importação automática"
        help={MODE_HELP}
        sub={
          <>
            Horas {times.hours} · Escala {times.schedule}{' '}
            <Link href="/admin/configuracoes" className="po-link">
              Mudar
            </Link>
          </>
        }
      >
        <div role="radiogroup" aria-label="Modo da importação" className="po-seg">
          {MODES.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={mode === item.value}
              disabled={!has || saving}
              title={!has ? 'Conecte a conta do Porto primeiro' : undefined}
              onClick={() => mode !== item.value && onMode(item.value)}
              className={cn(mode === item.value && 'selected', item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </Row>

      <Row
        title="Conta do Porto"
        help="O acesso que o robô usa para entrar no Portal do Prestador. A senha fica guardada com criptografia."
        sub={
          has ? (
            <>
              CPF {maskCpf(config.cpf)} ·{' '}
              <span className={cn('po-state', tested === true && 'ok', tested === false && 'bad')}>
                {tested === true ? <CheckCircle2 size={14} /> : tested === false ? <XCircle size={14} /> : null}
                {tested === true ? `Login funcionou ${whenLabel(config.last_login_test_at ?? null, now)}` : tested === false ? `O Porto recusou ${whenLabel(config.last_login_test_at ?? null, now)}` : 'Login ainda não testado'}
              </span>
            </>
          ) : (
            'Nenhuma conta conectada'
          )
        }
      >
        <Button type="button" size="sm" variant={has ? 'outline' : 'default'} onClick={onAccount}>
          <KeyRound className="h-4 w-4" />
          {has ? 'Alterar' : 'Conectar a conta'}
        </Button>
        {has ? (
          <Button type="button" size="sm" variant="outline" onClick={onTest} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {testing ? 'Testando…' : 'Testar'}
          </Button>
        ) : null}
      </Row>

      <Row
        title="Técnicos"
        help="O robô acha as horas de cada técnico pelo QRA dele no Porto. Quem não tem o QRA vinculado fica de fora da importação."
        sub={active ? <span className={cn('po-state', unlinked.length ? 'warn' : 'ok')}>{linked} de {active} vinculados</span> : 'Nenhum técnico ativo'}
      >
        <Button type="button" size="sm" variant={unlinked.length ? 'default' : 'outline'} disabled={!has} onClick={onMatch}>
          <Users className="h-4 w-4" />
          {unlinked.length ? 'Vincular' : 'Conferir'}
        </Button>
      </Row>
    </section>
  );
}
