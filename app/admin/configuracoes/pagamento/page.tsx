'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Panel } from '@/components/management-ui';
import { Button } from '@/components/ui/button';
import { newTier, useSettingsForm } from '@/components/settings/form';
import { Choice, NumberField, SettingsPage } from '@/components/settings/kit';
import type { CommissionMode } from '@/lib/organization-settings';

const COMMISSION_OPTIONS: Array<{ value: CommissionMode; title: string; text: string }> = [
  { value: 'excess', title: 'Sobre o excedente', text: 'Paga o que passa do fixo' },
  { value: 'percentage', title: 'Percentual da produção', text: 'Soma ao salário' },
  { value: 'none', title: 'Sem comissão', text: 'Só salário e extras' },
];

const COMMISSION_HELP =
  'Sobre o excedente: a comissão é o que a produção passa do fixo (% da produção − salário − vales). Abaixo disso, não há comissão.\nPercentual da produção: a comissão é o % da produção, somada ao salário. Os vales não são abatidos.\nSem comissão: o técnico recebe salário, horas extras e prêmio.';

export default function PagamentoPage() {
  const api = useSettingsForm('payment');
  const { form, update } = api;

  return (
    <SettingsPage api={api} title="Pagamento" description="Como a comissão e o prêmio dos técnicos são calculados.">
      <Panel title="Comissão" help={COMMISSION_HELP}>
        <div className={form.commissionMode !== 'none' ? 'st-commission' : undefined}>
          <Choice label="Como a comissão é paga" value={form.commissionMode} options={COMMISSION_OPTIONS} onChange={(value) => update('commissionMode', value)} />
          {form.commissionMode !== 'none' ? (
            <NumberField id="commission" label="Percentual" unit="%" help="Percentual sobre o total das OS do técnico." value={form.commissionPercentage} onChange={(value) => update('commissionPercentage', value)} />
          ) : null}
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
