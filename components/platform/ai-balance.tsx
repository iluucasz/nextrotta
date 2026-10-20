'use client';

import { useState } from 'react';
import { api, date, money, useResource } from './api';
import { useNotify } from './notice';
import { DataTable, Editor, ErrorState, Loading, Metric, Panel } from './ui';

type Reading = { currency: string; total: number; granted: number | null; toppedUp: number | null; isAvailable: boolean; collectedAt: string };

type AiBalance = {
  configured: boolean;
  error: string | null;
  balances: Reading[];
  month: string;
  movements: Array<{ currency: string; spent: number; toppedUp: number; since: string | null; readings: number }>;
  daily: Array<{ currency: string; day: string; total: number }>;
  calculatedCost: number;
  lowBalanceAlert: number | null;
};

type Conversion = { inputCostPerMillion: number; outputCostPerMillion: number; creditsPerUse: number };

const currentMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);
const providerMoney = (value: number, currency: string) =>
  `${currency === 'USD' ? 'US$' : currency === 'CNY' ? '¥' : currency} ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

/**
 * Créditos de IA → Saldo na DeepSeek: the provider has no spending history, so what it charged is
 * measured from the balance readings (lib/ai/balance.ts).
 */
export function AiBalancePanel({ conversion }: { conversion: Conversion }) {
  const notify = useNotify();
  const [month, setMonth] = useState(currentMonth);
  const data = useResource<AiBalance>(`/ai-balance?month=${month}`);
  const [editing, setEditing] = useState(false);

  const picker = (
    <div className="flex flex-wrap items-center gap-2">
      <input type="month" aria-label="Mês" value={month} max={currentMonth()} onChange={(event) => event.target.value && setMonth(event.target.value)} />
      <button className="nr-btn" onClick={() => setEditing(true)}>
        Aviso de saldo baixo
      </button>
    </div>
  );

  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;
  const balance = data.data!;

  if (!balance.configured) {
    return (
      <Panel title="Saldo na DeepSeek" description="Falta DEEPSEEK_API_KEY no ambiente do servidor: sem ela o assistente não responde e o saldo não pode ser lido.">
        <div className="nr-pad text-[13px] text-[#7a897e]">Configure a chave para ver o saldo, o gasto real do mês e receber aviso quando estiver acabando.</div>
      </Panel>
    );
  }

  const main = balance.balances[0] ?? null;
  const movement = balance.movements.find((item) => item.currency === main?.currency) ?? balance.movements[0] ?? null;
  const low = main && balance.lowBalanceAlert !== null && main.total < balance.lowBalanceAlert;

  return (
    <Panel
      title="Saldo na DeepSeek"
      description={
        'A DeepSeek não informa histórico de gastos: o gasto real é a queda do saldo entre uma leitura e outra (depois das respostas, de hora em hora pelo worker e ao abrir esta tela); ' +
        'aumento do saldo é recarga. Compare com o custo que a plataforma calcula pelos tokens: se ficarem distantes, ajuste os preços em "Editar conversão".'
      }
      action={picker}
    >
      <div className="nr-pad">
        {balance.error && <div className="nr-alert mb-4">Não foi possível ler o saldo agora: {balance.error}. Mostrando a última leitura.</div>}
        {main && !main.isAvailable && <div className="nr-alert mb-4">Saldo insuficiente: o assistente de IA parou em todas as empresas até a conta ser recarregada.</div>}
        {low && <div className="nr-alert mb-4">Saldo abaixo do aviso de {providerMoney(balance.lowBalanceAlert!, main!.currency)}: recarregue a conta da DeepSeek.</div>}
        <div className="nr-metrics">
          <Metric
            label="Saldo agora"
            value={main ? providerMoney(main.total, main.currency) : '—'}
            detail={main ? `Lido em ${date(main.collectedAt, true)}` : 'Nenhuma leitura ainda'}
            accent
          />
          <Metric
            label="Gasto real no mês"
            value={movement ? providerMoney(movement.spent, movement.currency) : '—'}
            detail={movement?.since ? `Medido desde ${date(movement.since, true)} (${movement.readings} leitura(s))` : 'Sem leituras neste mês'}
          />
          <Metric label="Recargas no mês" value={movement ? providerMoney(movement.toppedUp, movement.currency) : '—'} detail="Aumentos do saldo" />
          <Metric label="Custo calculado no mês" value={money(balance.calculatedCost)} detail="Tokens × preços da conversão (R$)" />
        </div>
        {main && (main.granted !== null || main.toppedUp !== null) && (
          <p className="mt-3 text-[13px] text-[#7a897e]">
            Do saldo: {providerMoney(main.toppedUp ?? 0, main.currency)} comprados e {providerMoney(main.granted ?? 0, main.currency)} em crédito promocional.
            {' '}Aviso de saldo baixo: {balance.lowBalanceAlert === null ? 'só quando acabar' : `abaixo de ${providerMoney(balance.lowBalanceAlert, main.currency)}`}, no WhatsApp de alertas da plataforma.
          </p>
        )}
      </div>
      {balance.daily.length > 1 && (
        <DataTable
          rows={balance.daily.map((item) => ({ ...item, id: `${item.currency}-${item.day}` }))}
          defaultSort="day"
          defaultDescending
          columns={[
            { key: 'day', label: 'Dia', render: (item) => date(`${item.day}T12:00:00`) },
            { key: 'total', label: 'Saldo no fim do dia', render: (item) => providerMoney(item.total, item.currency) },
          ]}
        />
      )}

      {editing && (
        <Editor
          title="Aviso de saldo baixo"
          description={`Quando o saldo da DeepSeek ficar abaixo deste valor (na moeda da conta${main ? `, ${main.currency}` : ''}), você recebe um aviso por dia no WhatsApp de alertas da plataforma. Vazio: só avisa quando acabar.`}
          fields={[{ key: 'lowBalanceAlert', label: `Avisar abaixo de${main ? ` (${main.currency})` : ''}`, type: 'number' }]}
          initial={{ lowBalanceAlert: balance.lowBalanceAlert ?? '' }}
          onClose={() => setEditing(false)}
          onSave={async (values) => {
            await api('/settings', {
              method: 'PUT',
              body: { ai: { ...conversion, lowBalanceAlert: values.lowBalanceAlert === '' ? null : Number(values.lowBalanceAlert) } },
            });
            notify('Aviso de saldo salvo.');
            data.reload();
          }}
        />
      )}
    </Panel>
  );
}
