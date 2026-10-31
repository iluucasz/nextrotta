# Cálculo da folha

Exemplo: **Marcelo Gonçalves Veríssimo**, competência **05/2026**.

## Regra principal

```text
Comissão = Total de OS - Salário base - VR - VA
```

Se o resultado for negativo, a comissão fica **R$ 0,00**.

## Exemplo

- Total de OS: **R$ 5.682,07**
- Salário base: **R$ 3.452,00**
- VR: **R$ 699,60**
- VA: **R$ 249,00**

```text
R$ 5.682,07 - R$ 3.452,00 - R$ 699,60 - R$ 249,00 = R$ 1.281,47
```

> Este é o modo **sobre o excedente** (`excess`). Cada empresa pode usar também **percentual da produção** (comissão = % do bruto, somada ao salário) ou **sem comissão**: veja `docs/configuracoes.md`.

## Resultado

- Comissão: **R$ 1.281,47**
- Em conta: **R$ 4.733,47**
- Cartões (VR + VA): **R$ 948,60**
- Líquido da folha: **R$ 5.682,07**

## Observação

Descontos, adiantamentos, horas extras e prêmios podem alterar o valor final em conta no modal de cálculo.

## Rascunho, fechamento e reabertura

- Abrir a folha de um técnico mostra o que já foi salvo (sem recalcular); só uma folha nova é calculada. "Recalcular" troca os valores pelos do sistema.
- Cada alteração é salva sozinha como **rascunho**; fechar a janela salva o que estiver pendente. O técnico só vê a folha **fechada**.
- Folha fechada abre somente para leitura. A API recusa (409) qualquer gravação de rascunho sobre ela; para editar é preciso **Reabrir folha** (`reopen: true`, registrado na auditoria como `payroll.reopened`), e ela some da área do técnico até ser fechada de novo.
- A API valida a competência (`AAAA-MM`) e os valores (números finitos, sem negativos, exceto banco de horas e valor em conta): `lib/payroll-input.ts`, teste `scripts/test-payroll-input.cjs`.
- O banco de horas é em **horas**, não em reais (no PDF aparece como "X h").

## O modal da folha

- Estrutura de extrato: **Ganhos** (salário, comissão, horas extras, prêmio) − **Descontos** (descontos, adiantamentos) = **Valor em conta**; os **Cartões** (VR e VA) e a **Produção** ficam ao lado, e a **Folha total** (custo) = valor em conta + cartões.
- Cada valor calculado diz como chegou ali (comissão: % da produção e fixo; horas extras: horas acima da jornada × valor da hora × adicional; prêmio: faixa atingida). A explicação vem de `details` em `/api/payroll/preview`.
- Valor que o admin mudou fica marcado ("Ajustado. O sistema calcula R$ X. Restaurar"). Bruto, comissão e valor em conta ficam travados até apertar "Ajustar". Uma comissão ajustada à mão não é sobrescrita quando outro campo muda; um ajuste manual do valor em conta é mantido como diferença.
- Campos aceitam "1.234,56" ou "1234,5", não aceitam negativo (só banco de horas e valor em conta final) e limitam o valor máximo; Enter confirma sem enviar nada.
- O banco de horas é só informativo: não entra no valor em conta.

## PDF da folha

"Baixar PDF" (folha fechada) gera um PDF de verdade e baixa direto, sem janela de impressão: `lib/payroll-pdf.ts` (jsPDF, carregado só na hora do clique). É a via do técnico: cabeçalho com o nome da empresa e o mês, valor em conta em destaque, ganhos, descontos, cartões (só os que existem), produção e banco de horas. Não mostra folha total nem lucro da empresa. Arquivo: `Folha - <nome> - AAAA-MM.pdf`.
