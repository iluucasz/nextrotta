# Tabela de preços (16/11/2026, migração `0055`)

Decisão do dono. Os valores moram no banco (`plans`, `features.module_price`) e o dono ajusta no painel; esta página registra o que foi definido.

| | Monte o seu | Essencial | Pro |
|---|---|---|---|
| Ordem no site | 1º | 2º | 3º, selo **O MELHOR** (`featured`) |
| Mensal / anual (10×) | 249,99 / 2.499,90 (base) | 249,99 / 2.499,90 | 549,99 / 5.499,90 |
| Técnicos incluídos | 4 | 4 | 12 |
| Técnico extra (mês) | 19,99, comprado no contador (+/−) | **não vende: limite fixo de 4** | 19,99 (cobrado pelo que passar de 12) |
| Implantação | 799 em até 2x | 799 em até 2x | 999 em até 3x |
| Horas e banco de horas | módulo | **fora** | incluso |

- Horas e banco de horas deixou de ser `CORE_FEATURES`: é módulo do "Monte o seu" e some do Essencial (só o item de menu do técnico, `/dashboard/hours`, é barrado pelo plano; a folha e a API `work-hours` continuam iguais).
- O técnico extra é a última linha dos cartões (Monte o seu e Pro), para o Essencial, que não tem, não deixar buraco.
- Técnico extra: preço 0 no plano = limite fixo (`checkTechnicianCap`, `lib/billing/entitlements.ts`, barra criar, reativar e importar do Porto acima do incluído). No "Monte o seu" o contador do cartão e do `/contratar` (`?tecnicos=N`) soma N × 19,99 ao preço (anual × 10, como os módulos) e `included_technicians` da assinatura vira 4 + N; passou disso, cobra-se o extra normal. `quoteBuilder(..., extraTechnicians)`, `GET /api/public/signup?extraTechnicians=N`.
- O "Monte o seu" pode passar do preço do Pro: não há teto.
- Módulos (mensal / implantação): Notificações por WhatsApp 14,99 / 10; Venda de Peças 49,99 / 60; Automação Porto 89,99 / 200; Assistente de IA 49,99 / 60; Controle financeiro 29,99 / 40; Dashboard gerencial 29,99 / 20; Faturamento 14,99 / 10; **Horas e banco de horas 19,99 / 20**. Anual do módulo = mensal × 10.
- Backup: os cartões mostram só "Backup diário" (a retenção do plano segue no banco: Essencial 30 dias, Pro 90).
- Parcelamento da implantação: veja "Teste, parcelas e cancelamento" abaixo.
- Quem já assinou mantém o preço, os técnicos incluídos e o técnico extra copiados na assinatura; só as funcionalidades do plano seguem o plano ao vivo. Os 11 assinantes do Essencial eram só empresas de teste `zz-*`.

- **1º mês grátis** (destaque no site e no `/contratar`): na contratação só se paga a implantação; a primeira mensalidade/anuidade vence no mês seguinte (`nextMonthDueDate`, `lib/billing/billing.ts`). Já era a regra, agora é anunciada.

## Teste, parcelas e cancelamento (16/11/2026, migração `0058`)

- **Implantação parcelada = cobranças separadas no Asaas** (não o parcelamento do Asaas, que não conseguimos testar): `splitSetupFee` (`lib/plans.ts`) divide em centavos (a última leva a sobra). No cadastro cobra-se só a **1ª parcela** (referência `<org>:setup`, vence em 3 dias): é o **teste**. Quando ela é paga, `startSubscriptionAfterSetup` cria a mensalidade (1º vencimento no mês seguinte, no dia escolhido) e as parcelas 2..N (`<org>:setup:2`…), que vencem no mesmo dia da mensalidade, mês a mês. Só a 1ª parcela libera a conta. Pelo painel do dono (`activateBilling`) as parcelas são criadas todas de uma vez. `subscriptions.setup_installments` guarda em quantas vezes foi dividido (copiado do plano na 1ª cobrança).
- **Cancelar quando quiser:** `/admin/assinatura` → "Cancelar assinatura" (digita CANCELAR) → `POST /api/organization/billing/cancel` → `cancelSubscriptionByCustomer` (`lib/billing/billing.ts`): faz o backup de fechamento, cancela a mensalidade e **todas as cobranças pendentes** (parcelas e mensalidade, `DELETE /payments/{id}` no Asaas; no espelho viram `DELETED`), deixa a empresa `canceled` (só consulta e download, o dono reativa) e avisa o dono. Cobranças já **vencidas** continuam em aberto. Quem cancela no 1º mês só pagou a 1ª parcela.
- **Avisos no topo** (admins): `getBillingNotice` → `billingNotice` em `/api/organization/status` → `BillingNoticeBanner` (`components/app-shell.tsx`). Durante o teste (só a 1ª parcela paga, nenhuma mensalidade paga) o aviso fica sempre; depois só aparece a 7 dias do vencimento. O "x" esconde aquele aviso (por cobrança, `localStorage`); a próxima cobrança traz o aviso de volta. Atrasos seguem no aviso âmbar antigo.
- **Site:** faixa "Teste sem risco" em `/planos`, linha "Teste por R$ X · cancele quando quiser" em cada cartão (X = 1ª parcela) e o mesmo no resumo do `/contratar`.
- Teste: `scripts/test-customer-cancel.cjs` (gateway simulado).

- Verificado ponta a ponta no sandbox do Asaas (16/11/2026, contas `zz-pay-*`, arquivadas): cadastro cobra só a 1ª parcela; pagando-a, a mensalidade e as outras parcelas são criadas; o cancelamento pela tela apaga as pendentes também no Asaas e leva a empresa a `/acesso-encerrado`. O cancelamento é liberado durante a preparação e com o acesso travado (`middleware.ts`).

- **Ciclo anual verificado** (16/11/2026, sandbox): anuidade = mensal × 10 (Pro 5.499,90, Essencial 2.499,90); o Asaas recebe a assinatura `YEARLY` com o vencimento no mês seguinte; as parcelas da implantação seguem mensais e o cancelamento apaga a anuidade pendente e a assinatura. O aviso do topo soma tudo que vence no mesmo dia (anuidade/mensalidade + parcela). Técnico extra comprado no Monte o seu no anual = ×10 (199,90/ano); o que passar do incluído é cobrado ×12 (`calculateSubscriptionValue`).
