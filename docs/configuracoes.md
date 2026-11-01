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
    `serviceAwardTiers`, `monthlyHoursWarningFloor` e `fortnightSplitDay`.
  - `PUT`: só admin fora do preview. Campos ausentes mantêm o valor atual. Responde 400 com a mensagem
    de validação e audita antes/depois (`organization_settings.updated`).
  - O dono edita pelo painel: `PUT /api/platform/organizations/[id]/settings` (mesmas regras).
- `hooks/use-organization-settings.ts`: busca uma vez por carregamento de página e começa com os
  padrões. `resetOrganizationSettingsCache()` é chamado ao salvar e ao sair.

## Campos e quem usa

| Campo | Padrão de organização nova | Onde é usado |
|---|---|---|
| Comissão (percentual ou valor por OS/hora/dia), mínimo e teto, salário base, VA, VR | 25%, R$ 0 (valor), R$ 0, R$ 0, R$ 0, R$ 0 | Folha (servidor e tela), Faturamento, cadastro de técnico (valor inicial e campo vazio). Vale o do técnico quando > 0 (`valueOrDefault`). |
| Jornada mensal | 220 h | Hora extra da folha, banco de horas, painel do técnico, `{meta_mes}` do WhatsApp. |
| Adicional de hora extra | 50% (×1,5) | Folha: `max(0, horas − jornada) × (salário ÷ jornada) × multiplicador`. |
| Intervalo diário | 60 min | Horas da escala/apontamento, robô do Porto, dashboard gerencial, modal de almoço da planilha. |
| Turno padrão | 08:00–18:00 | Escalas novas e apontamento; previsto do robô quando o Porto não informa o turno. |
| Alerta de horas | 200 h | Cor do card de horas do técnico (vermelho abaixo, amarelo até a jornada). |
| Último dia da Q1 | 15 | Painel do técnico, para serviço sem quinzena informada. |
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
