# Despesas (`/admin/despesas`, recurso de plano `finance`)

Controle de contas a pagar e a receber. Antes ficava em `/admin/financeiro` (o endereço antigo redireciona). Refeito do zero a partir do que a
pesquisa mostrou que mais pesa para uma empresa pequena: esquecer um vencimento, olhar só o saldo do banco sem as contas que vêm aí, não ter previsão
nem orçamento por categoria, e perder tempo lançando.

## O que a tela faz

- **Visão geral:** o que precisa de atenção (vencidas, de hoje, da semana, com "Pagar" na própria linha), o atraso por faixa (1–7, 8–30, 31–60, mais de 60 dias),
  as próximas 8 semanas (a pagar × a receber e o saldo acumulado; o atraso já entra desde o início), para onde foi o dinheiro do mês (por categoria, fixo × variável,
  comparado com o mês anterior) e o orçamento.
- **Contas:** lista com busca (sem acento), situação (em aberto, vencidas, pagas), tipo, categoria e mês; seleção para dar baixa ou excluir em lote; ações por linha.
- **Calendário:** o mês por vencimento; clicar no dia mostra e permite pagar.
- **Orçamento:** limite mensal por categoria contra o lançado no mês (aviso a partir de 80%, estourado a partir de 100%).
- **Nova conta:** o essencial em cima (descrição, fornecedor/cliente, categoria, valor, vencimento, quantas vezes: uma vez, parcelada ou todo mês); o resto em "Mais detalhes" (forma de
  pagamento, código de barras/Pix para copiar na hora de pagar, custo fixo ou variável, competência, observações). "Já foi paga" lança com a baixa.
- **Dar baixa:** total ou parcial, com data e forma de pagamento; nunca passa do que falta. **Desfazer** um pagamento reabre a conta. Excluir tem **Desfazer** logo depois.
- Editar uma conta de série pergunta se vale só para ela, para ela e as próximas ou para toda a série.
- **Importar** de planilha (modelo para baixar; confere linha a linha antes de salvar) e **Exportar** (XLSX).

## Dados (migração `0031`)

`financial_entries` ganhou `supplier`, `payment_method`, `payment_code` e `nature` (`fixed`/`variable`; o que se repete todo mês nasce fixo). `status`, `paid_amount` e `paid_at`
continuam, agora como cache dos pagamentos, e o Dashboard Gerencial e o Assistente seguem lendo a tabela como antes. Cada pagamento é uma linha em `financial_payments` (com exclusão lógica:
desfazer marca como excluído e a conta é recalculada). `finance_budgets` guarda o limite por categoria (0 = sem limite). Nada é apagado.

## Código

- Regras e contas (puras, testadas): `lib/expenses.ts` (estado da conta, atraso por faixa, urgência, previsão por semana, orçamento, calendário, parcelas e repetição, filtros) e
  `lib/expenses-import.ts` (leitura da planilha). Banco: `lib/expenses-store.ts`. Rotas: `app/api/despesas/**` (todas só admin, exigem o recurso `finance`).
- Tela: `app/admin/despesas/page.tsx` e `components/expenses/*`, no mesmo visual do Dashboard Gerencial (`components/management-ui.tsx`).
- Avisos no sino (`checkExpenses` em `lib/notification-checks.ts`): contas vencidas, contas que vencem em breve (usa "vence em breve" das Configurações) e categoria que estourou o orçamento.
- Testes: `node scripts/test-expenses.cjs` (regras), `node scripts/test-expenses-store.cjs` (banco: pagamentos, séries, desfazer, isolamento entre empresas) e `node scripts/test-notification-checks.cjs`.
