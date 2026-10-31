# Faturamento (`/admin/faturamento`, recurso de plano `billing_report`)

Relatório enxuto do que os serviços faturaram, do custo da folha e do resultado, no mesmo visual do Dashboard Gerencial
(classes `mg-*` de `app/admin/dashboard-gerencial/management-dashboard.css`; blocos compartilhados em
`components/management-ui.tsx`).

- **Cálculo:** `lib/billing-report.ts` (puro, teste `scripts/test-billing-report.cjs`). A tela só desenha.
- **Período:** mensal (comparado com o mês anterior; janeiro compara com dezembro) ou anual (comparado com o ano anterior), mais filtro por técnico. A evolução mostra os 12 meses que terminam no mês escolhido (ou o ano todo).
- **Critério igual ao do Dashboard Gerencial:** só folhas **fechadas** entram no custo, e o custo de uma folha é `líquido + adiantamentos + VA + VR`. Serviço sem folha fechada deixa o resultado "parcial", com aviso e link para a Folha.
- **Fora do escopo:** despesas gerais (ficam no Dashboard Gerencial, que por isso tem um resultado menor) e técnicos inativos (a API de serviços e de folha só lista os ativos).
- **Exportar relatório:** planilha com Resumo, Evolução, Tipos de serviço e Técnicos.
