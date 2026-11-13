'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Panel } from '@/components/management-ui';
import { Button } from '@/components/ui/button';
import { newTier, useSettingsForm } from '@/components/settings/form';
import type { PeriodMode } from '@/components/settings/form';
import { Choice, NumberField, SettingsPage, TextField, Toggle } from '@/components/settings/kit';
import type { BenefitPayment, CommissionMode } from '@/lib/organization-settings';
import type { CompetenceSource } from '@/lib/pay-calendar';

const COMMISSION_OPTIONS: Array<{ value: CommissionMode; title: string; text: string }> = [
  { value: 'excess', title: 'Sobre o excedente', text: 'Paga o que passa do fixo' },
  { value: 'percentage', title: 'Percentual da produção', text: '% do valor das OS' },
  { value: 'per_service', title: 'Valor fixo por OS', text: 'R$ por serviço feito' },
  { value: 'per_hour', title: 'Valor por hora', text: 'R$ por hora trabalhada' },
  { value: 'per_day', title: 'Diária', text: 'R$ por dia trabalhado' },
  { value: 'none', title: 'Sem comissão', text: 'Só salário e extras' },
];

const COMMISSION_HELP =
  'Sobre o excedente: a comissão é o que a produção passa do fixo (% das OS − salário − vales que abatem). Abaixo disso, não há comissão.\nPercentual da produção: a comissão é o % do valor das OS, somada ao salário. Os vales não são abatidos.\nValor fixo por OS: cada serviço do mês vale um valor, não importa o preço da OS (42 OS × R$ 30 = R$ 1.260).\nValor por hora: as horas trabalhadas no mês (escala e Porto) vezes o valor da hora.\nDiária: os dias com horas trabalhadas no mês vezes o valor do dia.\nSem comissão: o técnico recebe só salário, horas extras e prêmio.';

const BENEFIT_PAYMENT_OPTIONS: Array<{ value: BenefitPayment; title: string; text: string }> = [
  { value: 'card', title: 'No cartão', text: 'Fora do valor em conta' },
  { value: 'cash', title: 'Em dinheiro', text: 'À parte, fora do valor em conta' },
];

const BENEFIT_PAYMENT_HELP =
  'Como o vale chega ao técnico. Só muda o texto da folha, do PDF e da tela do técnico: o custo total da folha é o mesmo.';

const BENEFIT_DEDUCT_HELP =
  'Só vale no modo "Sobre o excedente". Ligado: o vale conta como fixo e a comissão só começa depois dele (produção − salário − vales). Desligado: o vale não entra na conta da comissão.';

const PERIOD_OPTIONS: Array<{ value: PeriodMode; title: string; text: string }> = [
  { value: 'monthly', title: 'Mensal', text: 'Um pagamento por mês' },
  { value: 'fortnightly', title: 'Quinzenal', text: 'Dois períodos: Q1 e Q2' },
  { value: 'custom', title: 'Dias específicos', text: 'Você escolhe os dias de corte' },
];

const PERIOD_HELP =
  'Mensal: o mês não é dividido. Q1 e Q2 somem das telas, da importação e do painel do técnico.\nQuinzenal: o mês tem dois períodos, Q1 até o dia de corte e Q2 do dia seguinte em diante.\nDias específicos: liste os dias em que um período termina (por exemplo 10, 20 gera três períodos, até 4 dias). A folha continua sendo calculada pelo mês; o período serve para separar e conferir as OS.\nOS já importadas guardam o período em que foram lançadas.';

const COMPETENCE_OPTIONS: Array<{ value: CompetenceSource; title: string; text: string }> = [
  { value: 'batch', title: 'Mês do lote', text: 'Você escolhe o mês ao importar' },
  { value: 'service_date', title: 'Data do serviço', text: 'Cada OS vai para o mês da sua data' },
];

const COMPETENCE_HELP =
  'Mês do lote: ao importar a planilha, você escolhe um mês e todas as OS do arquivo entram nele.\nData do serviço: cada OS entra no mês da própria data. Uma planilha com serviços de setembro, outubro e novembro preenche cada mês sozinha, e você escolhe quais meses importar na prévia.\nFolhas já fechadas não mudam: o sistema avisa antes de importar OS para elas.';

/** The amount that goes with each way of paying: a percentage, or R$ per service, hour or day. */
const RATE_FIELD: Record<Exclude<CommissionMode, 'none'>, { label: string; unit: string; position: 'start' | 'end'; help: string }> = {
  excess: { label: 'Percentual', unit: '%', position: 'end', help: 'Percentual sobre o total das OS do técnico. Cada técnico pode ter o seu no cadastro; sem valor próprio, vale este.' },
  percentage: { label: 'Percentual', unit: '%', position: 'end', help: 'Percentual sobre o total das OS do técnico. Cada técnico pode ter o seu no cadastro; sem valor próprio, vale este.' },
  per_service: { label: 'Valor por OS', unit: 'R$', position: 'start', help: 'Quanto o técnico recebe por cada OS do mês. Cada técnico pode ter um valor próprio no cadastro; sem valor próprio, vale este.' },
  per_hour: { label: 'Valor por hora', unit: 'R$', position: 'start', help: 'Quanto o técnico recebe por hora trabalhada no mês (as horas vêm da escala e do Porto). Cada técnico pode ter um valor próprio no cadastro; sem valor próprio, vale este.' },
  per_day: { label: 'Valor por dia', unit: 'R$', position: 'start', help: 'Quanto o técnico recebe por dia com horas trabalhadas no mês. Cada técnico pode ter um valor próprio no cadastro; sem valor próprio, vale este.' },
};

export default function PagamentoPage() {
  const api = useSettingsForm('payment');
  const { form, update } = api;
  const mode = form.commissionMode;
  const rateField = mode === 'none' ? null : RATE_FIELD[mode];
  const isPercent = mode === 'excess' || mode === 'percentage';

  return (
    <SettingsPage api={api} title="Pagamento" description="Como a comissão e o prêmio dos técnicos são calculados.">
      <Panel title="Comissão" help={COMMISSION_HELP}>
        <Choice label="Como a comissão é paga" value={mode} options={COMMISSION_OPTIONS} onChange={(value) => update('commissionMode', value)} />
        {rateField ? (
          <div className="st-fields three st-divider">
            <NumberField
              id="commission-value"
              label={rateField.label}
              unit={rateField.unit}
              unitPosition={rateField.position}
              help={rateField.help}
              value={isPercent ? form.commissionPercentage : form.commissionRate}
              onChange={(value) => update(isPercent ? 'commissionPercentage' : 'commissionRate', value)}
            />
            <NumberField
              id="commission-minimum"
              label="Mínimo garantido"
              unit="R$"
              unitPosition="start"
              help="Se a comissão do mês der menos que isto, o técnico recebe este valor. Deixe 0 para não garantir mínimo."
              value={form.commissionMinimum}
              onChange={(value) => update('commissionMinimum', value)}
            />
            <NumberField
              id="commission-maximum"
              label="Teto"
              unit="R$"
              unitPosition="start"
              help="A comissão do mês nunca passa deste valor, mesmo que a produção seja maior. Deixe 0 para não ter teto. O teto vale mais que o mínimo."
              value={form.commissionMaximum}
              onChange={(value) => update('commissionMaximum', value)}
            />
          </div>
        ) : null}
      </Panel>

      <div className="st-grid-two">
        <Panel title="Vale-refeição (VR)" help={BENEFIT_PAYMENT_HELP}>
          <Choice label="Como o VR é pago" value={form.vrPayment} options={BENEFIT_PAYMENT_OPTIONS} onChange={(value) => update('vrPayment', value)} />
          {mode === 'excess' ? (
            <div className="st-toggles st-divider">
              <Toggle title="Abate da comissão" help={BENEFIT_DEDUCT_HELP} checked={form.vrDeductsFromCommission} onChange={(value) => update('vrDeductsFromCommission', value)} />
            </div>
          ) : null}
        </Panel>
        <Panel title="Vale-alimentação (VA)" help={BENEFIT_PAYMENT_HELP}>
          <Choice label="Como o VA é pago" value={form.vaPayment} options={BENEFIT_PAYMENT_OPTIONS} onChange={(value) => update('vaPayment', value)} />
          {mode === 'excess' ? (
            <div className="st-toggles st-divider">
              <Toggle title="Abate da comissão" help={BENEFIT_DEDUCT_HELP} checked={form.vaDeductsFromCommission} onChange={(value) => update('vaDeductsFromCommission', value)} />
            </div>
          ) : null}
        </Panel>
      </div>

      <Panel title="Períodos de pagamento" help={PERIOD_HELP}>
        <Choice label="Como o mês é dividido" value={form.periodMode} options={PERIOD_OPTIONS} onChange={(value) => update('periodMode', value)} />
        {form.periodMode === 'fortnightly' ? (
          <div className="st-fields one st-divider">
            <NumberField id="period-cut" label="Último dia da Q1" unit="dia" help="A Q1 vai do dia 1 até este dia; a Q2 vai do dia seguinte até o fim do mês (1 a 27)." value={form.periodCutDay} onChange={(value) => update('periodCutDay', value)} />
          </div>
        ) : null}
        {form.periodMode === 'custom' ? (
          <div className="st-fields one st-divider">
            <TextField id="period-cuts" label="Dias de corte" placeholder="10, 20" help="Separe os dias por vírgula, de 1 a 27 e em ordem crescente. Cada dia é o último do seu período." value={form.periodCutList} onChange={(value) => update('periodCutList', value)} />
          </div>
        ) : null}
      </Panel>

      <Panel title="Mês de pagamento" help={COMPETENCE_HELP}>
        <Choice label="Quem define o mês de cada OS importada" value={form.competenceSource} options={COMPETENCE_OPTIONS} onChange={(value) => update('competenceSource', value)} />
        <div className="st-fields one st-divider">
          <NumberField
            id="closing-day"
            label="Dia de fechamento do mês"
            unit="dia"
            help="Deixe 0 para fechar no último dia do mês. Com 25, a competência de novembro vai de 26/10 a 25/11: as OS (pela data do serviço), as horas e os dias trabalhados seguem esse período. Escala, despesas e avisos continuam pelo mês do calendário. Quem usa dias de corte conta esses dias a partir do início da competência."
            value={form.monthClosingDay}
            onChange={(value) => update('monthClosingDay', value)}
          />
          <NumberField
            id="settle-day"
            label="Acerto do mês anterior até o dia"
            unit="dia"
            help="Até este dia do mês, Serviços e Folha abrem no mês anterior (quem acerta outubro até 5 de novembro usa 5). Deixe 0 para abrir sempre no mês atual."
            value={form.settlePreviousMonthUntilDay}
            onChange={(value) => update('settlePreviousMonthUntilDay', value)}
          />
        </div>
      </Panel>

      <div className="st-grid-two">
        <Panel title="Valores padrão do técnico" help="Valem para o técnico que não tem valor próprio no cadastro e como valor inicial de um técnico novo. Deixe 0 no que a empresa não paga.">
          <div className="st-fields one">
            <NumberField id="base-salary" label="Salário base" unit="R$" unitPosition="start" value={form.baseSalary} onChange={(value) => update('baseSalary', value)} />
            <NumberField id="va" label="Vale-alimentação" unit="R$" unitPosition="start" help="Deixe 0 se a empresa não paga." value={form.vaAllowance} onChange={(value) => update('vaAllowance', value)} />
            <NumberField id="vr" label="Vale-refeição" unit="R$" unitPosition="start" help="Deixe 0 se a empresa não paga." value={form.vrAllowance} onChange={(value) => update('vrAllowance', value)} />
          </div>
        </Panel>

        <Panel
          title="Prêmio por produção"
          help="Valor pago na folha quando o técnico atinge a quantidade de OS no mês. Vale o prêmio da maior faixa atingida. As faixas também aparecem como metas no painel do técnico. Sem faixas, não há prêmio nem metas."
          badge={
            <Button type="button" variant="outline" size="sm" onClick={() => update('tiers', [...form.tiers, newTier()])}>
              <Plus className="h-4 w-4" />
              Adicionar faixa
            </Button>
          }
        >
          {form.tiers.length ? (
            <div className="st-rows">
              {form.tiers.map((tier, index) => (
                <div key={tier.id} className="st-row">
                  <NumberField
                    id={`tier-${tier.id}-min`}
                    label={`Faixa ${index + 1}: a partir de`}
                    unit="OS"
                    value={tier.minServices}
                    onChange={(value) => update('tiers', form.tiers.map((item) => (item.id === tier.id ? { ...item, minServices: value } : item)))}
                  />
                  <NumberField
                    id={`tier-${tier.id}-amount`}
                    label="Prêmio"
                    unit="R$"
                    unitPosition="start"
                    value={tier.amount}
                    onChange={(value) => update('tiers', form.tiers.map((item) => (item.id === tier.id ? { ...item, amount: value } : item)))}
                  />
                  <Button type="button" variant="outline" size="icon" aria-label={`Remover faixa ${index + 1}`} onClick={() => update('tiers', form.tiers.filter((item) => item.id !== tier.id))} className="h-11 w-11">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="st-empty">Nenhuma faixa de prêmio.</p>
          )}
        </Panel>
      </div>
    </SettingsPage>
  );
}
