# Configurações da organização (`/admin/configuracoes/*`)

Regras de negócio de cada organização, editadas pelo admin dela (e pelo dono, no painel). Nenhum
número do cliente original fica no código: todos os pontos abaixo leem as configurações da organização.

## Telas (submenu Configurações)

As configurações são divididas por assunto, cada uma uma página no padrão do Dashboard Gerencial (painéis, explicações atrás do "?"):

| Página | O que tem |
|---|---|
| `/admin/configuracoes/pagamento` (`/admin/configuracoes` redireciona para ela) | Como a comissão é paga, percentual, salário/VA/VR padrão, prêmio por produção. |
| `/admin/configuracoes/jornada` | Jornada mensal, hora extra, intervalo, alerta de horas, turno padrão, último dia da Q1, serviço cancelado cobra o previsto. |
| `/admin/configuracoes/porto` (só com o recurso `porto`) | Horários das importações, WhatsApp dos alertas, leitura do Porto, advertência por laudo. |
| `/admin/configuracoes/financeiro` (só com o recurso `finance`) | Aviso de vencimento e categorias de despesa. |
| `/admin/assinatura` | Plano, cobranças, créditos de IA, exportação dos dados (também filho de Configurações no menu). |

Código: `components/settings/form.ts` (`useSettingsForm(grupo)` carrega tudo, mas cada página salva **só os campos dela**; a API mantém o resto), `components/settings/kit.tsx` (`SettingsPage`, `Frame`, `Field`/`NumberField`/`TimeField`/`TextField`, `Toggle`, `Choice`, `SectionPanel`) e `settings.css` (`st-*`). A barra "Alterações não salvas" (Descartar / Salvar) só aparece quando algo mudou. Teste de navegador: abrir cada página, editar um campo e conferir que o `PUT` leva só os campos da página.

## Como a comissão é paga (`commissionMode`, migrações `0030` e `0033`)

Cada empresa escolhe uma das seis regras em Configurações → Pagamento. O cálculo é um só
(`lib/payroll-rules.ts`), usado pela API (`/api/payroll/preview`) e pela tela da Folha:

- `excess` (padrão, regra do cliente original): comissão = `% da produção − salário − VR − VA`, nunca abaixo de zero.
- `percentage`: comissão = `% da produção`, somada ao salário; os vales não são abatidos.
- `per_service`: comissão = `valor por OS × número de OS` do mês.
- `per_hour`: comissão = `valor por hora × horas trabalhadas` no mês (`work_hours`).
- `per_day`: comissão = `valor por dia × dias com horas` no mês.
- `none`: não há comissão (a linha some da folha).

O valor por OS, hora ou dia é `commissionRate` (padrão da empresa) e `technicians.commission_rate` (do técnico; 0 usa o padrão).
`commissionMinimum` (mínimo garantido) e `commissionMaximum` (teto) seguram a comissão do mês em qualquer modo, menos `none`.
Na Folha, a janela do técnico explica a conta ("42 OS × R$ 30,00", "168,5 h × R$ 18,00") e avisa quando o mínimo ou o teto agiu.
Teste: `scripts/test-payroll-rules.cjs`.

## Períodos de pagamento (`periodCutDays`, migração `0051`)

Configurações → Pagamento → "Períodos de pagamento". A empresa lista os dias em que o mês é cortado (regras puras em `lib/pay-calendar.ts`, `periodKeys`, `periodForDay`, `periodLabel`...):

- **Mensal** (`[]`): o mês não é dividido. Q1/Q2 somem de Serviços (filtro, coluna, formulário, exclusão em lote), da janela de importação, do resumo da Folha e do PDF e do painel do técnico (fica só o cartão "Mensal", sem seletor de período). As OS entram sem período, mesmo que a requisição mande um.
- **Quinzenal** (`[15]`, o padrão e o que toda empresa tinha): Q1 até o dia de corte, Q2 depois. O campo é o "Último dia da Q1" (1 a 27); mudou de lugar: saiu de Jornada e horas.
- **Dias específicos** (`[10, 20]`, até 4 dias, de 1 a 27, crescentes): três períodos ou mais. Com dois períodos as telas dizem Q1 e Q2; com mais, "Período 1", "Período 2"... (o valor guardado é sempre Q1 a Q5).

O período de cada OS é guardado ao lançá-la (importação por lote, por data ou cadastro manual), por isso **mudar os dias de corte não reclassifica OS antigas**: elas mantêm o período em que entraram. A folha continua sendo calculada pelo mês, o período serve para separar e conferir. A coluna antiga `fortnight_split_day` continua na tabela, mas não é mais lida nem gravada. Testes: `scripts/test-pay-calendar.cjs` (regras) e `scripts/test-pay-calendar-flow.cjs` (empresa mensal, quinzenal e com dias específicos, na importação e no cadastro).

**Ponto de partida na criação da empresa** (`lib/pay-presets.ts`, migração `0052`): o dono escolhe "Quinzenal" (`[15]`, mês do lote: o padrão de sempre) ou "Mensal" (`[]`, mês da OS pela data do serviço, acerto do mês anterior em 0) em `POST /api/platform/organizations` (`payPreset`). É aplicado uma única vez, na etapa "Criar configurações padrão" do provisionamento (repetir a etapa não sobrescreve o que o admin já mudou). Quem contrata pelo site começa quinzenal. Teste: `scripts/test-pay-preset-flow.cjs`.

**Ainda não existe:** o "dia de fechamento do mês" (mês de 26 a 25). Horas, banco de horas e descontos são calculados pelo mês-calendário; mudar só o mês das OS deixaria a folha inconsistente. Precisa de um desenho que cubra horas e descontos.

## Vales (VA e VR) — abatem da comissão? como são pagos? (`vaDeductsFromCommission`, `vrDeductsFromCommission`, `vaPayment`, `vrPayment`, migração `0050`)

Configurações → Pagamento, um painel para o VR e outro para o VA. Os padrões mantêm a regra de antes (abatem e vão no cartão).

- **Abate da comissão** (só aparece no modo "Sobre o excedente", o único que abate vales): ligado, o vale conta como fixo e a comissão só começa depois dele (`produção × % − salário − vales que abatem`). Desligado, ele sai da conta da comissão. Cada vale tem a sua chave (VR pode não abater e VA abater). Regra pura em `fixedCosts(..., { vrDeducts, vaDeducts })` e `calculateCommissionValue` (`lib/payroll-rules.ts`); o servidor (`lib/payroll-utils.ts`) e a Folha da tela usam a mesma.
- **Como é pago** — `card` (no cartão) ou `cash` (em dinheiro, à parte): só muda o texto (título "Cartões" / "Dinheiro à parte" / "Vales (cartão e dinheiro)", PDF e tela do técnico, que recebe só estas duas chaves); o valor em conta e o custo total da folha são os mesmos. Textos em `benefitsTitle`, `benefitsExplanation` e `benefitPaidPhrase`.
- Quando a produção fica abaixo do salário não há comissão e o técnico recebe o salário menos os adiantamentos (2.047 − 1.500 = 547): é o comportamento do modo "Sobre o excedente", não uma opção.
- Folha **já aberta ou fechada** guarda os valores calculados: depois de mudar a regra, "Recalcular" refaz um rascunho; folha fechada não muda.
- Testes: `scripts/test-payroll-rules.cjs` (regras puras) e `scripts/test-benefit-rules-flow.cjs` (a folha que o servidor calcula, empresa `zz-teste-vales`).

## Mês das OS (`competenceSource` e `settlePreviousMonthUntilDay`, migração `0049`)

Configurações → Pagamento → "Mês das OS". É o começo do **calendário de pagamento** de cada empresa (regras puras em `lib/pay-calendar.ts`, teste `scripts/test-pay-calendar.cjs`; fluxo da importação em `scripts/test-pay-calendar-flow.cjs`). Os padrões mantêm o comportamento anterior.

- **`competenceSource`** — quem define o mês de cada OS importada:
  - `batch` (padrão): o admin escolhe o mês e a quinzena (Q1/Q2) ao importar e o arquivo inteiro entra neles.
  - `service_date`: cada OS entra no mês da própria data, e o período segue o dia (dias de corte, ver "Períodos de pagamento"). Uma planilha de OP com setembro, outubro e novembro preenche cada mês sozinha; a janela de importação mostra quantas OS há por mês e deixa desmarcar os meses que não devem entrar. O servidor refaz esse cálculo (não confia no que a tela manda).
  - Nesse modo, a OS de um técnico cuja **folha do mês já está fechada** é recusada ("A folha de 10/2026 deste técnico já está fechada"), porque a folha fechada não é recalculada: a janela avisa antes e oferece "Importar também as OS de folha fechada" (`allow_closed_payroll`). No modo `batch` essa checagem não existe (comportamento de antes).
- **`settlePreviousMonthUntilDay`** (0 a 28, padrão 0) — até esse dia do mês, Serviços e Folha abrem no mês anterior (quem acerta outubro até 5 de novembro usa 5). 0 = sempre o mês atual.

Ainda **não** existe o dia de fechamento do mês diferente do último dia (ver "Períodos de pagamento").

## Onde fica

- `lib/organization-settings.ts`: tipos, padrões de organização nova (`DEFAULT_ORGANIZATION_SETTINGS`),
  validação campo a campo (`parseOrganizationSettingsInput`), leitura tolerante
  (`normalizeOrganizationSettings`, aceita a linha do banco em snake_case) e helpers
  (`calculateServiceAward`, `valueOrDefault`, `netOfDailyBreak`, `calculateOvertimeValue`,
  `fortnightForDay`, `buildPortoWarningNote`, `pickTechnicianSettings`). Sem dependências: usado pela
  tela, pela API e pelo worker.
- `lib/organization-settings-store.ts`: tabela `organization_settings`, uma linha por organização,
  uma coluna por campo (migrações `0003` e `0017`). Cache de 30 s por organização em cada processo;
  salvar limpa o cache do próprio processo.
- `app/api/organization-settings/route.ts`:
  - `GET` do admin: tudo, mais `updatedAt`/`updatedBy`.
  - `GET` do técnico (ou do admin em modo preview): só `monthlyHours`, `dailyBreakMinutes`,
    `serviceAwardTiers`, `monthlyHoursWarningFloor`, `periodCutDays`, `vaPayment` e `vrPayment`.
  - `PUT`: só admin fora do preview. Campos ausentes mantêm o valor atual. Responde 400 com a mensagem
    de validação e audita antes/depois (`organization_settings.updated`).
  - O dono edita pelo painel: `PUT /api/platform/organizations/[id]/settings` (mesmas regras).
- `hooks/use-organization-settings.ts`: busca uma vez por carregamento de página e começa com os
  padrões. `resetOrganizationSettingsCache()` é chamado ao salvar e ao sair.

## Campos e quem usa

| Campo | Padrão de organização nova | Onde é usado |
|---|---|---|
| Comissão (percentual ou valor por OS/hora/dia), mínimo e teto, salário base, VA, VR | 25%, R$ 0 (valor), R$ 0, R$ 0, R$ 0, R$ 0 | Folha (servidor e tela), Faturamento, cadastro de técnico (valor inicial e campo vazio). Vale o do técnico quando > 0 (`valueOrDefault`). |
| Vale abate da comissão / como é pago (VA e VR) | Abate, no cartão | Cálculo da comissão no modo "Sobre o excedente" e textos da folha, do PDF e do técnico — ver "Vales". |
| Quem define o mês da OS importada | Mês do lote | Importação de OS (`/api/services/import`) — ver "Mês das OS". |
| Acerto do mês anterior até o dia | 0 (desligado) | Mês com que Serviços e Folha abrem. |
| Jornada mensal | 220 h | Hora extra da folha, banco de horas, painel do técnico, `{meta_mes}` do WhatsApp. |
| Adicional de hora extra | 50% (×1,5) | Folha: `max(0, horas − jornada) × (salário ÷ jornada) × multiplicador`. |
| Intervalo diário | 60 min | Horas da escala/apontamento, robô do Porto, dashboard gerencial, modal de almoço da planilha. |
| Turno padrão | 08:00–18:00 | Escalas novas e apontamento; previsto do robô quando o Porto não informa o turno. |
| Alerta de horas | 200 h | Cor do card de horas do técnico (vermelho abaixo, amarelo até a jornada). |
| Dias de corte do mês (`periodCutDays`) | `[15]` (duas quinzenas) | Importação e cadastro de OS, filtros e tabela de Serviços, resumo da Folha e do PDF, painel do técnico, assistente de IA — ver "Períodos de pagamento". |
| Serviço cancelado cobra o previsto | não | Saldo no apontamento e no dashboard gerencial. |
| Faixas de prêmio | nenhuma | Prêmio da folha (maior faixa atingida) e metas do painel do técnico. Sem faixas, não há prêmio nem metas. |
| Horário da importação de horas | 23:00 | Quando a organização entra na fila do robô (`worker/porto-queue.ts`). |
| Horário da importação da escala | 03:00 | Só quando as horas não rodaram: normalmente a escala entra na fila logo depois das horas. |
| Dias reprocessados | 1 (ontem e hoje), de 1 a 7 | Job de horas. Mínimo 1 porque a importação pode rodar antes do dia acabar: o dia de hoje sempre é completado na execução seguinte. Dia com advertência ou manual nunca é recalculado. |
| Máximo de horas por dia | 16 h | Job de horas (`invalid_hours`). |
| Escala do mês seguinte | 7 dias | Job de escala (0 = nunca). |
| Folga integral a partir de | 90% | Job de escala (indisponibilidade que cobre o turno). |
| Usar conclusão do laudo | sim | Fim do dia sem assinatura: conclusão do laudo antes do Concluído. |
| Prazo para preencher o laudo | 6 h (0 a 48) | Contado do Concluído. Execução dentro do prazo grava o dia com `LAUDO PENDENTE:` e o recalcula em toda execução (mesmo fora da janela de reprocessamento) até o laudo aparecer ou o prazo vencer — aí entra a advertência. 0 = advertência na hora. Coluna `porto_laudo_grace_hours` (migração `0026`). |
| Advertência + texto | ligada | Nota `ADVERTÊNCIA: <texto>`. O marcador `ADVERTÊNCIA:` é fixo, porque é por ele que o robô reconhece um dia advertido. `{servico}` = número do serviço. |
| Registrar serviço cancelado | sim | Job de horas (situação "Serviço cancelado"). |
| WhatsApp para alertas do robô | vazio | Aviso ao admin, pelo WhatsApp da empresa, quando uma execução automática falha ou termina com avisos. Mudança de tela do Porto vai só para o dono. Vazio = sem alertas. |
| Aviso de vencimento | 7 dias | Controle de despesas ("A vencer"). |
| Categorias de despesa | lista genérica | Sugestões do campo Categoria no controle de despesas. |

Folhas já salvas guardam os valores calculados e não são recalculadas quando as configurações mudam.
