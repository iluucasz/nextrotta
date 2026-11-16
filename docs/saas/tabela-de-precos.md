# Tabela de preços (16/11/2026, migração `0055`)

Decisão do dono. Os valores moram no banco (`plans`, `features.module_price`) e o dono ajusta no painel; esta página registra o que foi definido.

| | Monte o seu | Essencial | Pro |
|---|---|---|---|
| Ordem no site | 1º | 2º | 3º, selo **O MELHOR** (`featured`) |
| Mensal / anual (10×) | 249,99 / 2.499,90 (base) | 249,99 / 2.499,90 | 549,99 / 5.499,90 |
| Técnicos incluídos | 4 | 4 | 16 (inalterado) |
| Técnico extra (mês) | 19,99 | 19,99 | 29,99 (inalterado) |
| Implantação | 799 em até 2x | 799 em até 2x | 999 em até 3x |
| Horas e banco de horas | módulo | **fora** | incluso |

- Horas e banco de horas deixou de ser `CORE_FEATURES`: é módulo do "Monte o seu" e some do Essencial (só o item de menu do técnico, `/dashboard/hours`, é barrado pelo plano; a folha e a API `work-hours` continuam iguais).
- O "Monte o seu" pode passar do preço do Pro: não há teto.
- Módulos (mensal / implantação): Notificações por WhatsApp 14,99 / 10; Venda de Peças 49,99 / 60; Automação Porto 89,99 / 200; Assistente de IA 49,99 / 60; Controle financeiro 29,99 / 40; Dashboard gerencial 29,99 / 20; Faturamento 14,99 / 10; **Horas e banco de horas 29,99 / 20 (sugestão minha, o dono não definiu)**. Anual do módulo = mensal × 10.
- Backup: os cartões mostram só "Backup diário" (a retenção do plano segue no banco: Essencial 30 dias, Pro 90).
- Parcelamento da implantação: `plans.setup_installments`. No Asaas vira cobrança parcelada (`installmentCount` + `totalValue`, `createPayment` em `lib/billing/asaas.ts`); a primeira parcela paga libera a conta. **Não testado**: a chave do sandbox respondeu 401 em 16/11.
- Quem já assinou mantém o preço, os técnicos incluídos e o técnico extra copiados na assinatura; só as funcionalidades do plano seguem o plano ao vivo. Os 11 assinantes do Essencial eram só empresas de teste `zz-*`.
