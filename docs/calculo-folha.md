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
