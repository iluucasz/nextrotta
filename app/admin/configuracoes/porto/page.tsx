'use client';

import Link from 'next/link';
import { Bot } from 'lucide-react';
import { Panel } from '@/components/management-ui';
import { Button } from '@/components/ui/button';
import { useSettingsForm } from '@/components/settings/form';
import { Field, NumberField, SettingsPage, TextField, TimeField, Toggle } from '@/components/settings/kit';
import { PORTO_LAUDO_PENDING_MARKER, PORTO_WARNING_MARKER, buildPortoWarningNote, endOfWorkDayMinutes } from '@/lib/organization-settings';

export default function PortoSettingsPage() {
  const api = useSettingsForm('porto');
  const { form, update } = api;

  const warningPreview = buildPortoWarningNote(form.portoWarningText || '…', '6054881/26');
  // Before today's work is over, "Fim do expediente" reports the previous day (see endOfWorkDayMinutes).
  const endOfDay = /^\d{2}:\d{2}$/.test(form.defaultShiftEnd) ? endOfWorkDayMinutes({ defaultShiftEnd: form.defaultShiftEnd }) : null;
  const endOfDayLabel = endOfDay === null ? '' : `${String(Math.floor(endOfDay / 60)).padStart(2, '0')}:${String(endOfDay % 60).padStart(2, '0')}`;
  const hoursRunBeforeEndOfDay = endOfDay !== null && /^\d{2}:\d{2}$/.test(form.portoHoursImportTime) && Number(form.portoHoursImportTime.slice(0, 2)) * 60 + Number(form.portoHoursImportTime.slice(3, 5)) < endOfDay;
  const hoursHelp = hoursRunBeforeEndOfDay
    ? `Horário de Brasília em que a importação entra na fila do robô. Antes das ${endOfDayLabel} (2h após o fim do turno padrão) o dia ainda não acabou: a mensagem de fim de expediente sai com o dia anterior, e o dia de hoje é completado na próxima execução.`
    : 'Horário de Brasília em que a importação entra na fila do robô (pode começar alguns minutos depois, se houver outras empresas na frente). Ao terminar, sai a mensagem de fim de expediente. O dia de hoje é sempre conferido de novo na próxima execução.';

  return (
    <SettingsPage
      api={api}
      title="Robô do Porto"
      description="As regras da importação de horas e escala do Portal do Prestador."
      actions={
        <Button asChild variant="outline">
          <Link href="/admin/config-porto">
            <Bot className="h-4 w-4" />
            Abrir o robô
          </Link>
        </Button>
      }
    >
      <div className="st-grid-two">
        <div className="st-stack">
          <Panel title="Horários" help="A conta do Porto e o liga/desliga da automação ficam na tela do robô (Config. Porto).">
            <div className="st-fields">
              <TimeField id="porto-hours-time" label="Importação de horas" help={hoursHelp} value={form.portoHoursImportTime} onChange={(value) => update('portoHoursImportTime', value)} />
              <TimeField id="porto-schedule-time" label="Importação da escala" help="A escala é importada logo depois das horas, de hoje até o fim do mês. Este horário só vale quando a importação de horas não rodou." value={form.portoScheduleImportTime} onChange={(value) => update('portoScheduleImportTime', value)} />
              <TextField
                id="porto-alert-phone"
                label="WhatsApp dos alertas"
                type="tel"
                placeholder="(11) 99999-9999"
                help="Recebe, pelo WhatsApp da empresa, um aviso quando a importação falha ou termina com avisos (credenciais, técnico fora da lista do Porto, QRA repetido, laudos). Mudanças de tela do Porto ficam com a equipe do NextRotta. Vazio = sem alertas."
                value={form.portoAlertPhone}
                onChange={(value) => update('portoAlertPhone', value)}
              />
            </div>
          </Panel>

          <Panel title="Leitura do Porto" help="Como o robô recalcula os dias e interpreta o que o portal informa. Dias lançados à mão e dias com advertência nunca são recalculados.">
            <div className="st-fields">
              <NumberField id="porto-reprocess" label="Dias reprocessados" unit="dias" help="Além de hoje, quantos dias para trás são recalculados em toda execução (mínimo 1 = ontem e hoje)." value={form.portoReprocessDays} onChange={(value) => update('portoReprocessDays', value)} />
              <NumberField id="porto-max-hours" label="Máximo por dia" unit="horas" help="Um dia calculado acima disso é rejeitado como inválido." value={form.portoMaxShiftHours} onChange={(value) => update('portoMaxShiftHours', value)} />
              <NumberField id="porto-lookahead" label="Escala do mês seguinte" unit="dias" help="Nos últimos N dias do mês, também importa o mês seguinte, se já estiver publicado (0 = não importa)." value={form.portoNextMonthLookaheadDays} onChange={(value) => update('portoNextMonthLookaheadDays', value)} />
              <NumberField id="porto-day-off" label="Folga integral a partir de" unit="%" help="Quanto do turno uma indisponibilidade precisa cobrir para o dia contar como folga." value={form.portoFullDayOffPercent} onChange={(value) => update('portoFullDayOffPercent', value)} />
            </div>
            <div className="st-toggles st-divider">
              <Toggle
                title="Usar a conclusão do laudo sem assinatura"
                help="Ligado: sem assinatura, o fim do dia é a data de conclusão do laudo. Desligado: vai direto para o horário de Concluído."
                checked={form.portoUseLaudoConclusion}
                onChange={(value) => update('portoUseLaudoConclusion', value)}
              />
              <Toggle
                title="Registrar dias de serviço cancelado"
                help="O dia em que todos os serviços foram cancelados entra como “Serviço cancelado”. Desligado, o dia fica sem apontamento."
                checked={form.portoRecordCancelledDays}
                onChange={(value) => update('portoRecordCancelledDays', value)}
              />
            </div>
          </Panel>
        </div>

        <Panel title="Advertência por laudo" help="Quando o laudo do último serviço do dia não foi preenchido, o fim do dia vem do Concluído e o apontamento recebe a advertência. Uma advertência dada nunca é retirada pelo robô.">
          <div className="st-toggles">
            <Toggle title="Dar advertência" checked={form.portoWarningEnabled} onChange={(value) => update('portoWarningEnabled', value)} />
          </div>
          <div className="st-fields st-divider">
            <NumberField
              id="porto-laudo-grace"
              label="Prazo para preencher o laudo"
              unit="horas"
              help={`Contado do Concluído. Se o robô passar antes, o dia fica como "${PORTO_LAUDO_PENDING_MARKER}" e é conferido de novo na próxima execução; a advertência só é dada se o prazo vencer sem laudo. 0 = advertência na hora.`}
              value={form.portoLaudoGraceHours}
              onChange={(value) => update('portoLaudoGraceHours', value)}
            />
          </div>
          <div className="st-divider">
            <Field id="porto-warning-text" label="Texto da advertência" help={`Vai depois de "${PORTO_WARNING_MARKER}", que é fixo. Use {servico} para o número do serviço.`}>
              <div className="st-input">
                <textarea id="porto-warning-text" rows={3} value={form.portoWarningText} onChange={(event) => update('portoWarningText', event.target.value)} disabled={!form.portoWarningEnabled} />
              </div>
            </Field>
            <p className="st-preview">
              Na observação fica: <strong>{warningPreview}</strong>
            </p>
          </div>
        </Panel>
      </div>
    </SettingsPage>
  );
}
