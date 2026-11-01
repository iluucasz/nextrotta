'use client';

import { Panel } from '@/components/management-ui';
import { useSettingsForm } from '@/components/settings/form';
import { NumberField, SettingsPage, TimeField, Toggle } from '@/components/settings/kit';

export default function JornadaPage() {
  const api = useSettingsForm('hours');
  const { form, update } = api;

  return (
    <SettingsPage api={api} title="Jornada e horas" description="A base do banco de horas e das horas extras.">
      <div className="st-grid-two">
        <Panel title="Jornada" help="Base do banco de horas e do cálculo de horas extras.">
          <div className="st-fields">
            <NumberField id="monthly-hours" label="Jornada mensal" unit="horas" help="Meta de horas do mês e divisor do valor da hora." value={form.monthlyHours} onChange={(value) => update('monthlyHours', value)} />
            <NumberField id="overtime" label="Hora extra" unit="%" help="Adicional sobre a hora normal. 50% = a hora extra vale 1,5 hora normal." value={form.overtimePercent} onChange={(value) => update('overtimePercent', value)} />
            <NumberField id="break" label="Intervalo diário" unit="min" help="Descontado de cada dia ao calcular as horas trabalhadas (escala e importação do Porto)." value={form.dailyBreakMinutes} onChange={(value) => update('dailyBreakMinutes', value)} />
            <NumberField id="hours-floor" label="Alerta de horas" unit="horas" help="No painel do técnico, o card de horas do mês fica vermelho abaixo deste valor e amarelo entre ele e a jornada." value={form.monthlyHoursWarningFloor} onChange={(value) => update('monthlyHoursWarningFloor', value)} />
          </div>
        </Panel>

        <Panel title="Turno e quinzena" help="O turno padrão é usado em escalas novas, no apontamento e quando o Porto não informa o turno. A quinzena vale para serviço sem quinzena informada: até o último dia da Q1 é Q1, depois é Q2.">
          <div className="st-fields">
            <TimeField id="shift-start" label="Início do turno" value={form.defaultShiftStart} onChange={(value) => update('defaultShiftStart', value)} />
            <TimeField id="shift-end" label="Fim do turno" value={form.defaultShiftEnd} onChange={(value) => update('defaultShiftEnd', value)} />
            <NumberField id="fortnight" label="Último dia da Q1" unit="dia" value={form.fortnightSplitDay} onChange={(value) => update('fortnightSplitDay', value)} />
          </div>
        </Panel>
      </div>

      <Panel title="Regras" help="Como o banco de horas trata os dias em que todos os serviços foram cancelados.">
        <div className="st-toggles">
          <Toggle
            title="Serviço cancelado cobra as horas previstas"
            help="Desligado: as horas apontadas contam e o previsto do dia não é cobrado no banco de horas. Ligado: o dia é tratado como normal (horas − previsto)."
            checked={form.chargeCancelledServicePlanned}
            onChange={(value) => update('chargeCancelledServicePlanned', value)}
          />
        </div>
      </Panel>
    </SettingsPage>
  );
}
