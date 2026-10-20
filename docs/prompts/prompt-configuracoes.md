# Tela "Configurações": regras de negócio editáveis pelo admin

Implemente uma tela **Configurações** no painel do admin (`/admin/configuracoes`) para que as regras usadas nos cálculos de folha, banco de horas e metas dos técnicos deixem de ser fixas no código e passem a ser definidas pelo admin.

Antes de começar, procure no código os valores fixos que esta tela vai substituir. Exemplos comuns:
- jornada de `220` horas (`STANDARD_HOURS_PER_MONTH`);
- comissão padrão de `25`%;
- hora extra com adicional fixo (×1,5);
- intervalo de almoço de 1 h (`DAILY_BREAK_HOURS`);
- faixas de prêmio por quantidade de OS escritas no código.

Cada um desses pontos passa a ler as configurações. No fim, nenhum desses números deve continuar no código, a não ser como padrão de quando ainda não há configuração salva.

UI e mensagens em português; código e comentários em inglês.

## Campos

| Campo (tela) | Chave | Unidade | Padrão | Validação |
|---|---|---|---|---|
| Comissão | `commissionPercentage` | % sobre o total das OS | 25 | 0 a 100 |
| Salário base | `baseSalary` | R$ | 0 | ≥ 0 |
| Vale-alimentação (VA) | `vaAllowance` | R$ | 0 | ≥ 0 |
| Vale-refeição (VR) | `vrAllowance` | R$ | 0 | ≥ 0 |
| Jornada mensal | `monthlyHours` | horas | 220 | > 0 e ≤ 744 |
| Adicional de hora extra | `overtimeMultiplier` | multiplicador; na tela, em % | 1,5 (tela: 50%) | 1 a 5 (tela: 0% a 400%) |
| Intervalo diário | `dailyBreakMinutes` | minutos (inteiro) | 60 | 0 a 240 |
| Prêmio por produção | `serviceAwardTiers` | lista `{ minServices, amount }` | vazia | cada faixa com OS > 0 e valor > 0; sem duas faixas com a mesma quantidade de OS |

- **Hora extra:** a tela mostra o adicional em porcentagem e o sistema guarda o multiplicador: `multiplicador = 1 + % / 100` e `% = (multiplicador − 1) × 100`.
- **Faixas de prêmio:** são guardadas ordenadas por `minServices` (crescente).

## Banco

Crie uma tabela de uma linha só, ou uma linha por empresa se o sistema for multiempresa, com uma migração (não criar a tabela em tempo de execução):

```sql
CREATE TABLE organization_settings (
  -- sistema de uma empresa só: id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1)
  -- sistema multiempresa:      organization_id UUID PRIMARY KEY REFERENCES organizations (id)
  commission_percentage  NUMERIC(5, 2)  NOT NULL DEFAULT 25  CHECK (commission_percentage BETWEEN 0 AND 100),
  base_salary            NUMERIC(12, 2) NOT NULL DEFAULT 0   CHECK (base_salary >= 0),
  va_allowance           NUMERIC(12, 2) NOT NULL DEFAULT 0   CHECK (va_allowance >= 0),
  vr_allowance           NUMERIC(12, 2) NOT NULL DEFAULT 0   CHECK (vr_allowance >= 0),
  monthly_hours          NUMERIC(6, 2)  NOT NULL DEFAULT 220 CHECK (monthly_hours > 0),
  overtime_multiplier    NUMERIC(4, 2)  NOT NULL DEFAULT 1.5 CHECK (overtime_multiplier >= 1),
  daily_break_minutes    INTEGER        NOT NULL DEFAULT 60  CHECK (daily_break_minutes BETWEEN 0 AND 240),
  service_award_tiers    JSONB          NOT NULL DEFAULT '[]'::jsonb, -- [{"minServices": 80, "amount": 250}]
  updated_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_by             TEXT
);
```

**Se o sistema já está em uso,** a linha inicial precisa nascer com os valores que hoje estão fixos no código, e não com os padrões acima. Assim nada muda nos cálculos no dia em que a tela for publicada.

## Módulos

1. **Regras (`lib/organization-settings.ts`):** um módulo sem dependências, usado pelas telas, pela API e pelo worker. Ele contém:
   - o tipo `OrganizationSettings` e os valores padrão `DEFAULT_ORGANIZATION_SETTINGS`;
   - `normalizeOrganizationSettings(row)`: aceita a linha do banco (snake_case) ou um objeto camelCase e usa o padrão para cada campo ausente ou inválido;
   - `parseOrganizationSettingsInput(body)`: devolve `{ settings }` ou `{ error }`, com as mensagens:
     - "O percentual de comissão deve estar entre 0 e 100."
     - "Salário, VA e VR não podem ser negativos."
     - "A jornada mensal deve ser maior que zero (até 744 horas)."
     - "O adicional de hora extra deve ficar entre 1 (sem adicional) e 5."
     - "O intervalo diário deve ser um número inteiro de minutos entre 0 e 240."
     - "Cada faixa de prêmio precisa de quantidade de OS e valor maiores que zero."
     - "Duas faixas de prêmio não podem exigir a mesma quantidade de OS."
   - `calculateServiceAward(quantidadeDeOS, faixas)`: devolve o valor da **maior faixa atingida** no mês, ou 0 se nenhuma foi atingida;
   - `valueOrDefault(valorDoTecnico, padrao)`: usa o valor do técnico quando ele é maior que 0 e, senão, o padrão.
2. **Banco (`lib/organization-settings-store.ts`):**
   - `getOrganizationSettings()`: devolve os padrões quando ainda não existe linha;
   - `saveOrganizationSettings(settings, userId)`: faz um upsert e devolve o que foi salvo.
3. **API `/api/organization-settings`:**
   - `GET` para o admin: todos os campos.
   - `GET` para o técnico: só `monthlyHours`, `dailyBreakMinutes` e `serviceAwardTiers` (as telas dele só usam isso; salários e comissão padrão não podem vazar).
   - `PUT` só para o admin. Valida com `parseOrganizationSettingsInput`, responde 400 com a mensagem do erro e 403 para quem não é admin. Se o projeto tiver auditoria, registra os valores antes e depois.
4. **Hook do cliente (`useOrganizationSettings()`):**
   - busca uma vez por carregamento de página e guarda em cache em memória;
   - não guarda falhas no cache, para a próxima chamada tentar de novo;
   - começa com os valores padrão enquanto carrega;
   - exporta `resetOrganizationSettingsCache()`, que a tela chama depois de salvar.

## Onde as configurações são usadas

- **Folha de pagamento:**
  - comissão do técnico: `base = total das OS × comissão%`, e `comissão = max(0, base − salário base − VA − VR)`;
  - comissão, salário, VA e VR vêm do cadastro do técnico e, quando estão vazios ou 0, do padrão das Configurações (`valueOrDefault`);
  - hora extra: `max(0, horas do mês − jornada) × (salário base ÷ jornada) × multiplicador`;
  - prêmio por produção: `calculateServiceAward(OS do mês, faixas)`.
  - Folhas já salvas guardam os valores calculados e **não** são recalculadas quando as Configurações mudam.
- **Banco de horas:** a meta mensal é a jornada (`monthlyHours`), no lugar de 220.
- **Horas trabalhadas** (montagem da escala e importação de horas de um sistema externo, por exemplo o portal do Porto): de cada dia desconta-se `dailyBreakMinutes / 60` horas, só quando o intervalo entre entrada e saída é maior que o próprio intervalo.
- **Painel do técnico:** a meta de horas do mês é `monthlyHours`. As metas de quantidade de OS são os `minServices` das faixas de prêmio. Sem faixas, não há metas.
- **Cadastro de técnico:** um técnico novo começa com comissão, salário, VA e VR iguais aos padrões das Configurações. Na API, campos vazios recebem o padrão.
- **Faturamento ou relatórios que calculam comissão:** a mesma regra, `valueOrDefault` com o padrão.
- **Mensagens automáticas** (por exemplo, a mensagem de fim de expediente no WhatsApp com a "meta do mês"): usam `monthlyHours`.

## Tela

- **Cabeçalho:** eyebrow "EMPRESA", título "Configurações" e descrição "Regras usadas nos cálculos de folha, banco de horas e metas dos técnicos."
- **Painel "Padrões dos técnicos"**
  - Descrição: "Usados para o técnico que não tem valor próprio no cadastro e como valor inicial de um técnico novo."
  - Campos:
    - Comissão (%), com a dica "Percentual sobre o total das OS.";
    - Salário base (R$);
    - Vale-alimentação (VA) (R$);
    - Vale-refeição (VR) (R$).
- **Painel "Jornada e horas"**
  - Descrição: "Base do banco de horas e do cálculo de horas extras."
  - Campos:
    - Jornada mensal (horas), com a dica "Meta de horas do mês e divisor do valor da hora.";
    - Adicional de hora extra (%), com a dica "50% = hora extra vale 1,5 hora normal.";
    - Intervalo diário (min), com a dica "Descontado de cada dia ao calcular horas trabalhadas (escala e importação do Porto)."
- **Painel "Prêmio por produção"** (largura total)
  - Descrição: "Valor pago na folha quando o técnico atinge a quantidade de OS no mês. As faixas também aparecem como metas no painel do técnico. Sem faixas, não há prêmio nem metas."
  - Botão "+ Adicionar faixa".
  - Cada faixa tem:
    - "Faixa N: a partir de" (OS);
    - "Prêmio" (R$);
    - um botão de lixeira com `aria-label` "Remover faixa N".
  - Sem faixas, mostra "Nenhuma faixa de prêmio configurada.".
  - Com faixas, mostra a nota "Vale o prêmio da maior faixa atingida no mês."
- **Rodapé**
  - Texto: "As mudanças valem para os próximos cálculos. Folhas já salvas mantêm os valores com que foram calculadas."
  - Botão "Salvar configurações". Ao salvar:
    - mostra "Configurações salvas." ou a mensagem de erro da API;
    - chama `resetOrganizationSettingsCache()`.
- **Detalhes dos campos:**
  - cada campo é numérico e tem a unidade ao lado (%, R$, horas, min);
  - aceita vírgula ou ponto como separador decimal.
- **Layout:**
  - os dois primeiros painéis ficam lado a lado no desktop e um embaixo do outro no celular;
  - dentro de cada painel, os campos ficam em duas colunas.
- **Acesso:**
  - item "Configurações" no menu, só para o admin;
  - um técnico que abrir a URL deve ser barrado como nas outras telas do admin.

## Como verificar

- Rodar a checagem de tipos do projeto.
- Salvar valores diferentes dos padrões e conferir:
  - uma folha nova, com a comissão, a hora extra e o prêmio usando os valores novos;
  - o banco de horas e o painel do técnico, com a meta nova;
  - a importação ou o lançamento de horas, com o intervalo descontado.
- Salvar valores inválidos, um de cada vez, e ver as mensagens acima.
- Abrir como técnico, conferindo que o `GET` não traz salário nem comissão e que o `PUT` dá 403.
