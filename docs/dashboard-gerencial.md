# Dashboard Gerencial

Disponível em `/admin/dashboard-gerencial`, pelo menu **Dashboard Gerencial**. A página valida a sessão no servidor; a API `/api/dashboard-gerencial?year=2026` também consulta o papel atual do usuário e permite apenas administradores.

## Dados e filtros

O endpoint somente lê o banco. Retorna produção e despesas agrupadas por competência, folhas e indicadores operacionais, incluindo o histórico dos técnicos inativos. Não utiliza dados demonstrativos nem altera esquemas durante a leitura. O navegador recalcula os filtros imediatamente; troca de ano carrega o ano escolhido e o anterior. Atualização automática a cada minuto e ao recuperar o foco.

Filtros: mensal/anual, mês, ano, seleção múltipla de prestadores, situação atual do prestador, tipo de serviço, categoria de despesa, valores pagos/em aberto, situação da folha e origem dos custos. Período e equipe se aplicam a todas as seções; filtros financeiros refinam custos, e tipo de serviço refina produção. A busca e a ordenação do ranking não alteram os totais.

## Critérios financeiros

- Faturamento bruto: soma de `services.value` por competência, com fallback para o mês da realização. Contas a receber não são adicionadas novamente.
- Ticket médio: faturamento dividido pela quantidade de serviços. No anual, recalcula-se pela soma anual, sem tirar média dos tickets mensais.
- Custo do prestador: `net_total + advances_total + va_deduction + vr_deduction`. Adiantamentos são recompostos porque já foram descontados do líquido da folha. Horas extras e prêmios já compõem esse líquido.
- Repasse em folha: líquido mais adiantamentos, sem VA/VR. A folha não tem comprovante de pagamento; o painel identifica esse valor como repasse em folha, sem afirmar liquidação bancária.
- Despesas: contas a pagar por competência. Filtros de pagamento usam valores baixados ou saldo restante, incluindo pagamentos parciais; não mudam a base para data do pagamento.
- Resultado/faturamento líquido gerencial: bruto menos custo dos prestadores e despesas selecionadas. Taxas e outros custos só entram se cadastrados. Evitar lançar novamente a folha como despesa geral.
- Por padrão, entram somente folhas fechadas. Competências com produção sem fechamento geram aviso de resultado parcial. A opção de incluir rascunhos apresenta uma prévia.
- Despesas gerais não possuem vínculo com prestadores. São rateadas pela participação no faturamento de cada mês. Ao filtrar um tipo de serviço, a folha é rateada pela receita desse serviço no prestador/mês. Meses sem receita não permitem ratear despesas; elas continuam no total da empresa.
- Comparação mensal: mês anterior, inclusive dezembro/janeiro. Anual: ano anterior inteiro. Períodos em andamento são identificados. Base anterior zero não produz percentuais infinitos.

## Operação

As faltas e justificativas vêm do padrão de apontamento `Apontamento manual: ...` usado em `lib/work-hours-service.ts`. Para cada prestador/data, usa-se o último registro de escala; empates seguem a prioridade existente da escala. Folgas e cancelamentos sem apontamento explícito não são classificados como faltas. Dias passados programados sem apontamento são exibidos como pendências. Datas futuras são excluídas.

Índice de ausências = (faltas + justificativas) / dias com presença ou ausência apurada. Pendências e folgas ficam fora do denominador.

Créditos/débitos operacionais comparam horas realizadas com a jornada apontada, descontando a pausa de 1h, como na escala administrativa. Sem jornada prevista ou sem apontamento, não são inventados créditos/débitos. O saldo acumulado inclui o histórico anterior ao período. Esse saldo operacional pode diferir do saldo salvo na folha; não há registro separado que permita afirmar que um débito é compensação de horas utilizada.

## Validação

`node scripts/test-management-dashboard.cjs` executa testes de regressão dos cálculos sem conexão ao banco. `npx tsc --noEmit` verifica os tipos. O relatório Excel contém resumo, evolução mensal, todos os prestadores do recorte e critérios/filtros; paginação ou busca do ranking não removem prestadores da exportação.
