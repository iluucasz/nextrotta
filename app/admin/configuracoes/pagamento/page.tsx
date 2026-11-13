'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Panel } from '@/components/management-ui';
import { Button } from '@/components/ui/button';
import { FormulaBuilderDialog } from '@/components/settings/formula-builder';
import { newTier, parseNumber, useSettingsForm } from '@/components/settings/form';
import type { PeriodMode } from '@/components/settings/form';
import { Choice, NumberField, SettingsPage, TextField, Toggle } from '@/components/settings/kit';
import type { OptionHelp } from '@/components/settings/option-help';
import { describeFormulaStep, formulaUsesSource, stepName } from '@/lib/commission-formula';
import type { BenefitPayment, CommissionMode } from '@/lib/organization-settings';
import type { CompetenceSource } from '@/lib/pay-calendar';

const COMMISSION_OPTIONS: Array<{ value: CommissionMode; title: string; text: string; help: OptionHelp; wide?: boolean }> = [
  {
    value: 'excess',
    title: 'Sobre o excedente',
    text: 'Paga o que passa do fixo',
    help: {
      what: 'O percentual é aplicado sobre o total das OS do técnico. A comissão é só o que sobra depois de descontar o fixo dele: o salário base mais os vales que abatem. Abaixo do fixo não há comissão, e o técnico recebe o salário base.',
      examples: [
        {
          title: 'Produção acima do fixo',
          rows: [
            ['Total das OS', 'R$ 10.000'],
            ['30% das OS', 'R$ 3.000'],
            ['Salário base', '− R$ 2.000'],
            ['VR (abate)', '− R$ 500'],
          ],
          result: ['Comissão', 'R$ 500'],
        },
        {
          title: 'Produção abaixo do fixo',
          rows: [
            ['Total das OS', 'R$ 5.000'],
            ['30% das OS', 'R$ 1.500'],
            ['Fixo (salário + VR)', 'R$ 2.500'],
          ],
          result: ['Comissão', 'R$ 0 (recebe o salário)'],
        },
      ],
      note: 'Cada vale abate ou não da comissão: isso se escolhe nos painéis de VR e VA, logo abaixo.',
    },
  },
  {
    value: 'percentage',
    title: 'Percentual da produção',
    text: '% do valor das OS',
    help: {
      what: 'A comissão é o percentual aplicado sobre o total das OS do técnico no mês, somada ao salário base. Nada é abatido: salário e vales não entram na conta da comissão.',
      examples: [
        {
          rows: [
            ['Total das OS', 'R$ 10.000'],
            ['Comissão (30%)', 'R$ 3.000'],
            ['Salário base', 'R$ 2.000'],
          ],
          result: ['Salário + comissão', 'R$ 5.000'],
        },
      ],
      note: 'Cada técnico pode ter o seu percentual no cadastro. Sem percentual próprio, vale o padrão daqui.',
    },
  },
  {
    value: 'per_service',
    title: 'Valor fixo por OS',
    text: 'R$ por serviço feito',
    help: {
      what: 'Cada OS do mês vale um valor fixo, não importa o preço do serviço. A comissão é esse valor vezes a quantidade de OS, somada ao salário base.',
      examples: [
        {
          rows: [
            ['OS no mês', '42'],
            ['Valor por OS', 'R$ 30'],
          ],
          result: ['Comissão', 'R$ 1.260'],
        },
      ],
      note: 'Cada técnico pode ter o seu valor no cadastro. Sem valor próprio, vale o padrão daqui.',
    },
  },
  {
    value: 'per_hour',
    title: 'Valor por hora',
    text: 'R$ por hora trabalhada',
    help: {
      what: 'A comissão é o valor da hora vezes as horas trabalhadas no mês, que vêm do apontamento da escala e do Porto. É somada ao salário base.',
      examples: [
        {
          rows: [
            ['Horas no mês', '200 h'],
            ['Valor da hora', 'R$ 12'],
          ],
          result: ['Comissão', 'R$ 2.400'],
        },
      ],
      note: 'Cada técnico pode ter o seu valor no cadastro. Sem valor próprio, vale o padrão daqui.',
    },
  },
  {
    value: 'per_day',
    title: 'Diária',
    text: 'R$ por dia trabalhado',
    help: {
      what: 'A comissão é o valor do dia vezes os dias em que o técnico teve horas apontadas no mês. É somada ao salário base.',
      examples: [
        {
          rows: [
            ['Dias trabalhados', '22'],
            ['Valor do dia', 'R$ 100'],
          ],
          result: ['Comissão', 'R$ 2.200'],
        },
      ],
      note: 'Um dia só conta se tiver horas apontadas. Cada técnico pode ter o seu valor no cadastro.',
    },
  },
  {
    value: 'none',
    title: 'Sem comissão',
    text: 'Só salário e extras',
    help: {
      what: 'Nenhuma comissão é calculada. O técnico recebe o salário base, as horas extras e o prêmio por produção, se a empresa tiver faixas de prêmio.',
      examples: [
        {
          rows: [
            ['Salário base', 'R$ 2.000'],
            ['Horas extras', 'R$ 150'],
            ['Prêmio por produção', 'R$ 100'],
          ],
          result: ['Em conta', 'R$ 2.250'],
        },
      ],
      note: 'Os campos de percentual, mínimo garantido e teto não aparecem neste modo.',
    },
  },
  {
    value: 'custom',
    title: 'Personalizado',
    text: 'Monte o seu cálculo, etapa por etapa',
    wide: true,
    help: {
      what: 'Para a empresa que paga de um jeito só seu. Você monta o cálculo em etapas, respondendo a perguntas: uma porcentagem de algo, um valor por unidade, tirar o salário e os vales, pagar por faixas, pagar só depois de uma meta, garantir um mínimo. Cada etapa pode usar o resultado das anteriores, e a última é a comissão do mês.',
      examples: [
        {
          title: 'Exemplo: faixas de OS (42 OS no mês)',
          rows: [
            ['As primeiras 40 OS: R$ 20 cada', 'R$ 800'],
            ['Da 41ª em diante: R$ 30 cada (2 OS)', 'R$ 60'],
          ],
          result: ['Comissão', 'R$ 860'],
        },
        {
          title: 'Exemplo: só depois da meta',
          rows: [
            ['1. 20% da produção (R$ 10.000)', 'R$ 2.000'],
            ['2. Se a produção passar de R$ 8.000, vale a etapa 1', 'R$ 2.000'],
          ],
          result: ['Comissão (com R$ 7.000 de produção: R$ 0)', 'R$ 2.000'],
        },
      ],
      note: 'Na janela, um exemplo de um mês mostra o que cada etapa dá enquanto você monta. O mínimo garantido e o teto abaixo continuam valendo. Salário e vales só entram na conta se você os usar numa etapa.',
    },
  },
];

function benefitPaymentOptions(voucher: 'VR' | 'VA'): Array<{ value: BenefitPayment; title: string; text: string; help: OptionHelp }> {
  return [
    {
      value: 'card',
      title: 'No cartão',
      text: 'Fora do valor em conta',
      help: {
        what: `O ${voucher} vai para o cartão do técnico, fora do valor pago em conta. Na folha, no PDF e na tela do técnico ele aparece como pago no cartão.`,
        examples: [
          {
            rows: [
              ['Salário + comissão', 'R$ 2.500 em conta'],
              [voucher, 'R$ 500 no cartão'],
            ],
          },
        ],
        note: 'Só muda onde o texto diz que o vale é pago: o custo total da folha é o mesmo. Se o vale abate da comissão ou não é a opção logo abaixo.',
      },
    },
    {
      value: 'cash',
      title: 'Em dinheiro',
      text: 'À parte, fora do valor em conta',
      help: {
        what: `O ${voucher} é entregue em dinheiro, à parte do valor pago em conta. A folha, o PDF e a tela do técnico dizem que ele é pago em dinheiro.`,
        examples: [
          {
            rows: [
              ['Salário + comissão', 'R$ 2.500 em conta'],
              [voucher, 'R$ 500 em dinheiro'],
            ],
          },
        ],
        note: 'Só muda onde o texto diz que o vale é pago: o custo total da folha é o mesmo. Se o vale abate da comissão ou não é a opção logo abaixo.',
      },
    },
  ];
}

const BENEFIT_DEDUCT_HELP =
  'Só vale no modo "Sobre o excedente".\nLigado: o vale conta como parte do fixo e a comissão só começa depois dele. Ex.: 30% de R$ 10.000 = R$ 3.000; menos salário de R$ 2.000 e vale de R$ 500, a comissão é R$ 500.\nDesligado: o vale fica fora da conta. Ex.: R$ 3.000 menos o salário de R$ 2.000, a comissão é R$ 1.000, e o vale de R$ 500 é pago além disso.';

const PERIOD_OPTIONS: Array<{ value: PeriodMode; title: string; text: string; help: OptionHelp }> = [
  {
    value: 'monthly',
    title: 'Mensal',
    text: 'Um pagamento por mês',
    help: {
      what: 'O mês não é dividido: a empresa paga uma vez por mês. Q1 e Q2 não aparecem em Serviços, na importação, na Folha nem no painel do técnico.',
      examples: [
        {
          rows: [
            ['OS de 03/11', 'Folha de novembro'],
            ['OS de 25/11', 'Folha de novembro'],
          ],
        },
      ],
    },
  },
  {
    value: 'fortnightly',
    title: 'Quinzenal',
    text: 'Dois períodos: Q1 e Q2',
    help: {
      what: 'O mês tem dois períodos: a Q1 vai do dia 1 até o dia de corte e a Q2, do dia seguinte até o fim do mês. A folha continua calculada pelo mês inteiro; os períodos servem para separar e conferir as OS.',
      examples: [
        {
          title: 'Exemplo (corte no dia 15)',
          rows: [
            ['OS de 10/11', 'Q1'],
            ['OS de 15/11', 'Q1'],
            ['OS de 23/11', 'Q2'],
          ],
        },
      ],
      note: 'O dia de corte aparece logo abaixo e pode ser mudado.',
    },
  },
  {
    value: 'custom',
    title: 'Dias específicos',
    text: 'Você escolhe os dias de corte',
    help: {
      what: 'Você informa os dias em que cada período termina, até 4 dias. Cada dia vira um corte e o mês passa a ter um período a mais que o número de cortes.',
      examples: [
        {
          title: 'Exemplo (cortes 10 e 20)',
          rows: [
            ['Período 1', 'dias 1 a 10'],
            ['Período 2', 'dias 11 a 20'],
            ['Período 3', 'dia 21 em diante'],
          ],
        },
      ],
      note: 'OS já importadas guardam o período em que entraram: mudar os cortes não reclassifica as antigas.',
    },
  },
];

const COMPETENCE_OPTIONS: Array<{ value: CompetenceSource; title: string; text: string; help: OptionHelp }> = [
  {
    value: 'batch',
    title: 'Mês do lote',
    text: 'Você escolhe o mês ao importar',
    help: {
      what: 'Ao importar a planilha, você escolhe o mês e todas as OS do arquivo entram nele, seja qual for a data de cada uma.',
      examples: [
        {
          rows: [
            ['Mês escolhido na importação', 'Outubro'],
            ['OS de 28/09', 'Outubro'],
            ['OS de 05/10', 'Outubro'],
          ],
        },
      ],
      note: 'Serve para quem recebe um arquivo por mês, já com as OS certas.',
    },
  },
  {
    value: 'service_date',
    title: 'Data do serviço',
    text: 'Cada OS vai para o mês da sua data',
    help: {
      what: 'Cada OS entra no mês da própria data de serviço. Uma planilha com meses misturados preenche cada mês sozinha, sem você escolher o mês.',
      examples: [
        {
          rows: [
            ['OS de 28/09', 'Setembro'],
            ['OS de 05/10', 'Outubro'],
            ['OS de 03/11', 'Novembro'],
          ],
        },
      ],
      note: 'A janela de importação mostra quantas OS vão para cada mês e deixa escolher quais importar. Se a folha do técnico naquele mês já estiver fechada, o sistema avisa antes.',
    },
  },
];

/** The amount that goes with each way of paying: a percentage, or R$ per service, hour or day. */
const RATE_FIELD: Record<Exclude<CommissionMode, 'none' | 'custom'>, { label: string; unit: string; position: 'start' | 'end'; help: string }> = {
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
  const isCustom = mode === 'custom';
  const rateField = mode === 'none' || isCustom ? null : RATE_FIELD[mode];
  const isPercent = mode === 'excess' || mode === 'percentage';
  const [building, setBuilding] = useState(false);
  const formula = form.commissionFormula;
  // A custom calculation asks for the company's default percentage / R$ value only when one of its steps reads it.
  const usesPercentage = isCustom && formulaUsesSource(formula, 'percentage');
  const usesRate = isCustom && formulaUsesSource(formula, 'rate');

  return (
    <SettingsPage api={api} title="Pagamento" description="Como a comissão e o prêmio dos técnicos são calculados.">
      <Panel title="Comissão">
        <Choice label="Como a comissão é paga" value={mode} options={COMMISSION_OPTIONS} onChange={(value) => update('commissionMode', value)} />
        {isCustom ? (
          <div className="st-formula">
            {formula.steps.length ? (
              <>
                <ol className="st-formula-steps">
                  {formula.steps.map((step, index) => (
                    <li key={step.id}>
                      <div>
                        <strong>{stepName(step, index)}</strong>
                        <span>{describeFormulaStep(formula, index)}</span>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="st-formula-actions">
                  <Button type="button" variant="outline" onClick={() => setBuilding(true)}>
                    Editar o cálculo
                  </Button>
                </div>
              </>
            ) : (
              <div className="st-formula-empty">
                <span>Nenhum cálculo montado.</span>
                <Button type="button" onClick={() => setBuilding(true)}>
                  Montar o cálculo
                </Button>
              </div>
            )}
          </div>
        ) : null}
        {building ? (
          <FormulaBuilderDialog
            formula={formula}
            defaults={{
              percentage: parseNumber(form.commissionPercentage),
              rate: parseNumber(form.commissionRate),
              salary: parseNumber(form.baseSalary),
              vr: parseNumber(form.vrAllowance),
              va: parseNumber(form.vaAllowance),
            }}
            onClose={() => setBuilding(false)}
            onApply={(next) => {
              update('commissionFormula', next);
              setBuilding(false);
            }}
          />
        ) : null}
        {rateField || isCustom ? (
          <div className="st-fields three st-divider">
            {rateField ? (
              <NumberField
                id="commission-value"
                label={rateField.label}
                unit={rateField.unit}
                unitPosition={rateField.position}
                help={rateField.help}
                value={isPercent ? form.commissionPercentage : form.commissionRate}
                onChange={(value) => update(isPercent ? 'commissionPercentage' : 'commissionRate', value)}
              />
            ) : null}
            {usesPercentage ? (
              <NumberField
                id="commission-percentage"
                label="Percentual padrão"
                unit="%"
                unitPosition="end"
                help="Usado nas etapas que pedem o percentual do técnico. Cada técnico pode ter o seu no cadastro; sem valor próprio, vale este."
                value={form.commissionPercentage}
                onChange={(value) => update('commissionPercentage', value)}
              />
            ) : null}
            {usesRate ? (
              <NumberField
                id="commission-rate"
                label="Valor padrão por unidade"
                unit="R$"
                unitPosition="start"
                help="Usado nas etapas que pedem o valor por unidade do técnico (por OS, hora ou dia, como você montou). Cada técnico pode ter o seu no cadastro; sem valor próprio, vale este."
                value={form.commissionRate}
                onChange={(value) => update('commissionRate', value)}
              />
            ) : null}
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
        <Panel title="Vale-refeição (VR)">
          <Choice label="Como o VR é pago" value={form.vrPayment} options={benefitPaymentOptions('VR')} onChange={(value) => update('vrPayment', value)} />
          {mode === 'excess' ? (
            <div className="st-toggles st-divider">
              <Toggle title="Abate da comissão" help={BENEFIT_DEDUCT_HELP} checked={form.vrDeductsFromCommission} onChange={(value) => update('vrDeductsFromCommission', value)} />
            </div>
          ) : null}
        </Panel>
        <Panel title="Vale-alimentação (VA)">
          <Choice label="Como o VA é pago" value={form.vaPayment} options={benefitPaymentOptions('VA')} onChange={(value) => update('vaPayment', value)} />
          {mode === 'excess' ? (
            <div className="st-toggles st-divider">
              <Toggle title="Abate da comissão" help={BENEFIT_DEDUCT_HELP} checked={form.vaDeductsFromCommission} onChange={(value) => update('vaDeductsFromCommission', value)} />
            </div>
          ) : null}
        </Panel>
      </div>

      <Panel title="Períodos de pagamento">
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

      <Panel title="Mês de pagamento">
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
