# Porte das correções da produção + gerenciamento da VPS

> Prompt de trabalho para a IA que mantém o **NextRotta** (este repositório). Escrito em 06/10/2026 a
> partir da produção (**Central Operacional**, `C:\Users\iluuc\Documents\sistema-de-gestao-tecnica`,
> commit `cb36852`). Leia inteiro antes de começar. As regras do `CLAUDE.md` deste repositório valem
> acima de tudo o que está aqui: isolamento da produção, `organization_id` em tudo, migrações,
> nenhum `DELETE`, território da IA de design.

## 0. O que é este pacote e como usar

O NextRotta foi clonado da produção em **05/10/2026 por volta das 17h** (commit `fafa68b` da produção).
Depois disso a produção recebeu **10 commits de correções** que o clone não tem: integração com o
Porto, WhatsApp, técnicos, escala, banco de horas, folha, Configurações e avisos de falha. Todas
foram validadas ao vivo contra o Portal do Prestador e contra os dados reais do cliente.

Conteúdo desta pasta (`docs/saas/porte-producao/`):

| Pasta | O que tem |
|---|---|
| `PROMPT.md` | Este documento: regras, problemas, soluções, como adaptar ao SaaS e o módulo novo da VPS. |
| `patches/`, `referencia/` | **Arquivados fora do repositório** (o porte já foi aplicado). Eram, respectivamente, o `git show` dos 10 commits e a cópia do estado final dos arquivos da produção. Para consultar de novo, leia a produção direto. |
| `vps/` | Script de limpeza que roda hoje na VPS e os units do systemd (a responsabilidade passa para você — seção 6). |

Você também pode **ler** os arquivos da produção direto em `C:\Users\iluuc\Documents\sistema-de-gestao-tecnica`
(o `CLAUDE.md` permite ler para portar). **Nunca** edite, rode comandos ou git lá. Os arquivos muito grandes
da produção (ex.: `app/admin/schedule/admin-schedule-builder.tsx`, ~5,2 mil linhas) não foram copiados:
os diffs mostram exatamente o que mudou neles.

**Porte o comportamento, não cole o código.** O código da produção é single-tenant: usa
`ensure*Schema()` em runtime, `DELETE`, uma linha `id = 1` em `porto_config` e `organization_settings`,
uma única instância de WhatsApp, um worker para um cliente só. Aqui cada regra precisa ser adaptada a:
`organization_id` em toda query, migrações versionadas em `db/migrations/`, exclusão lógica,
`verifyOrganizationAuth()`, `porto_config`/`whatsapp_config` por organização, instância Evolution por
organização, worker que itera organizações, direitos do plano (`blockUnlessFeature`, `checkLimit`).

Ordem sugerida: seção 3 (regras), depois 4 (os problemas, área por área), depois 5 (adaptações ao SaaS),
e por fim 6 (VPS). Ao terminar cada bloco: `npx tsc --noEmit`, build do worker, teste de isolamento
entre duas organizações e atualização do `CLAUDE.md`/docs deste repositório.

---

## 1. Mapa dos 10 commits

| # | Commit | Assunto | Áreas |
|---|---|---|---|
| 01 | `70e7659` | Fim do dia pela assinatura do laudo; datas do job de horas corrigidas | Porto (horas), worker (TZ), WhatsApp |
| 02 | `5e7bbfb` | Endurece os jobs do Porto; "Fim do expediente" que nunca saía | Porto (horas e escala), worker (trava), WhatsApp |
| 03 | `dfbbae9` | Advertências mantidas (passo intermediário, substituído pelo 04) | Porto (horas) |
| 04 | `606a40f` | Dia com advertência nunca é recalculado | Porto (horas) |
| 05 | `3f74c6f` | Situação "Serviço cancelado"; escala do mês seguinte; modal do almoço | Porto, apontamento, banco de horas, escala |
| 06 | `20de30b` | Tela de Configurações com todas as regras que estavam fixas no código | Tudo (folha, horas, metas, robô, financeiro, worker) |
| 07 | `bcd0509` | Proteção contra falhas silenciosas | Porto, worker, alertas |
| 08 | `5b5060c` | Quem manda na escala: Porto (automação ligada) ou "Montar escala" (desligada) | Escala |
| 09 | `f06c447` | QRA duplicado recusado; credenciais ausentes viram erro | Técnicos, Porto |
| 10 | `cb36852` | Alerta de mudança de tela no Porto; aviso de VPS fora do ar | Porto, worker, app |

O commit 03 foi desfeito na prática pelo 04 (a regra final é a do 04). Leia os dois só para entender a decisão.

---

## 2. O Portal do Prestador: o que foi validado ao vivo

Use isto como verdade sobre o portal (vale para todas as organizações, porque o portal é o mesmo):

- **Login:** 3 passos (nonce → CPF/senha devolvem QRAs → logon). Só funciona via navegador (Playwright).
  Páginas de detalhe recusam link direto ("Acesso proibido"): sempre entrar pelo wrapper do menu
  (`openPortalFrame` em `lib/porto-integration/navigation.ts`) e clicar a partir da lista.
- **Busca de serviços** (`lib/porto-integration/servicos.ts`):
  - O site **ignora as datas digitadas**: mantém uma janela própria de 15 dias (pedir 01/10–05/10
    buscou 01/10–16/10; pedir 01/09–15/09 buscou 31/08–15/09) e às vezes usa "últimos 15 dias".
    Solução: `runServiceSearch` lê de volta o período usado, tenta de novo uma vez e, se ainda não
    cobrir, lança erro. O job **descarta serviços fora do período** da execução.
  - Os blocos de 15 dias se sobrepõem, então o mesmo serviço vem duas vezes: **deduplicar por código**.
  - Colunas vêm de comentários HTML: `cap_horaAtendimento` = **Hora Prev.** (quando o técnico pegou o
    serviço); `cap_horaProgramadaAtendimento` = **Hora Comb.** (definida pela Porto, **não usar**). A
    célula de status vem logo depois.
  - O resultado traz só o **nome do socorrista cortado em 20 caracteres**, sem QRA.
- **Detalhe do serviço:** linha do tempo com `<!-- BT Concluir -->` (Concluído) e `<!-- BT Em Execução -->`.
  Voltar com `page.goBack()` dá timeout: cada serviço exige refazer a busca e clicar de novo.
- **Laudo (a "lupa"):** `#imgLaudo`.
  - **Liberado:** `<a onclick="abreLink('https://porto-socorro-app-portal.web.app/laudo/<id>?token=...')">`
    com `laudo.png`. Abrir essa URL e ler **"Data da assinatura"**. Se não houver, usar
    "Data de conclusão do laudo".
  - **Desabilitado:** `laudo_disable.png`, sem `onclick`.
- **Lista de socorristas** (`ConSocor.xhtml`): traz nome completo + QRA. O "carregar mais ao rolar"
  (`LazyScrollTableSocorristas.jsp`) responde 404, então a primeira carga é a lista inteira.
- **Escala** (`ConDetSocor.xhtml`): calendário RichFaces. `organizer.component.nextMonth()` troca para
  o mês seguinte. Confira o mês exibido (`getCurrentYear/getCurrentMonth`) antes de ler a grade. Ler
  só a grade do mês leva ~5s por técnico; abrir cada dia de indisponibilidade leva ~68s.
- **Tempos medidos** (12 socorristas, 10 técnicos): login ~9s; busca ~4s; fim de jornada de um
  técnico num dia (busca + detalhe + laudo) ~9s. Execução de horas noturna normal: **15–20 min**;
  reprocessamento pesado: **66–83 min**. Escala quando importa: 6–8 min.

---

## 3. Regras de negócio decididas pelo dono do produto (não mudar)

1. **Início do dia** = menor **Hora Prev.** dos serviços **concluídos** do dia. Se a Hora Prev. estiver
   vazia ou cair depois do fim do dia, usar o horário "Em Execução" (ou "Em Deslocamento") da linha do
   tempo dos serviços já abertos (`timelineStart`).
2. **Fim do dia** = o mais tarde entre os últimos serviços concluídos. Abrir até 3, do maior para o
   menor Hora Prev., e parar quando a Hora Prev. do próximo já é anterior ao melhor fim encontrado
   (a Hora Prev. é previsão: um serviço previsto para 17:00 foi assinado às 14:00).
   - Lupa liberada → **Data da assinatura** do laudo.
   - Lupa desabilitada → horário de **Concluído** + observação
     `ADVERTÊNCIA: laudo digital não preenchido no serviço NNNNNNN/AA` no apontamento.
   - Lupa não encontrada ou laudo que não abre → Concluído **sem** advertência
     (`laudo_unreadable_used_concluido` no histórico).
3. **Só contam serviços concluídos.** "Cancelado" e "Aceite" (aceito e nunca executado) ficam fora.
4. **A advertência nunca sai.** Dia que já tem advertência gravada **nunca** é recalculado pelo robô,
   nem na janela de reprocessamento. Laudo preenchido depois não muda o dia. Só a correção manual tira.
5. **Dia manual é sagrado:** dias apontados ou corrigidos à mão (`source='manual'`, folga, falta ou
   justificado manual) nunca são sobrescritos pelo robô.
6. **Intervalo de almoço** (padrão 60 min, configurável) é descontado das horas importadas.
7. **Dia só com serviço cancelado** → situação **"Serviço cancelado"** (`cancelled_service`), com nota
   `Apontamento manual: serviço cancelado`. As horas vão da Hora Prev. até a assinatura/conclusão do
   laudo quando há laudo; senão 0h com observação pedindo ajuste manual. **Conta as horas, mas não cobra
   as horas previstas do dia** no banco de horas (configurável: `chargeCancelledServicePlanned`).
8. **Escala:** com a automação do Porto **ligada, o Porto manda** (reimporta todo dia, de hoje ao fim do
   mês, e substitui o que foi montado); **desligada, o "Montar escala" manda** (pode substituir até os
   dias que vieram do Porto). Nos dois casos, dias concluídos e manuais nunca são substituídos.
9. **Escala do mês seguinte:** nos últimos N dias do mês (padrão 7), importar o mês seguinte se estiver
   publicado no Porto, só para técnicos com escala publicada. O lembrete de turno do dia 1 sai na
   noite anterior e só uma vez (deduplicação por técnico/dia).
10. **Planilha de horas sem almoço:** ao carregar, se houver linhas com o intervalo bruto (saída − entrada
    sem o almoço), perguntar **"Deseja adicionar o desconto de 1h de almoço para todos os técnicos?"**.
    Sim → desconta dessas linhas. Não → mantém.
11. **Horários do robô no fuso de Brasília real** (`TZ=America/Sao_Paulo` no container), nunca offset
    UTC fixo.
12. **Nenhum número de negócio fixo no código:** tudo vem das Configurações da organização (seção 4.H).

---

## 4. Problemas resolvidos, área por área

Formato: **problema → causa → solução → onde (produção) → patch**. Cada item precisa existir no
NextRotta, por organização.

### 4.A Job de horas do Porto (`lib/porto-jobs/run-hours-job.ts`, `lib/porto-integration/servicos.ts`)

1. **Fim do dia errado.** Usava o horário do último serviço da lista. Agora segue a regra 3.2 (laudo /
   Concluído + advertência), com `getServicoEndTime(page, serviceDateKey, params, { useLaudoConclusion })`,
   que devolve `{ situacaoAtual, endTime, endDate, endSource, laudo, laudoError, timelineStart }`. Funções:
   `readLaudoLink`, `readLaudoEndTime`, `readConcluidoTimestamp`. *(patch 01, 05)*
2. **Serviços cancelados e "Aceite" contavam** e jogavam o fim do dia para horários absurdos (um "Aceite"
   com Hora Prev. 17:19 virava fim 07:39 e geraria advertência indevida). Agora só os concluídos contam
   (`/conclu/i` no status). *(01)*
3. **Datas erradas:** as execuções de outubro reescreviam dias de setembro (com o previsto da escala de
   outubro) e as de setembro gravavam 31/08, por causa da janela própria de 15 dias do site. Solução:
   ler de volta o período usado + descartar serviços fora do período. *(01)*
4. **Último dia do mês nunca importado e "hoje" errado às 23:00:** o container rodava em UTC. Solução:
   `ENV TZ=America/Sao_Paulo` no `worker/Dockerfile`; a execução automática cobre o mês corrente
   **mais ontem** (`rangeStart = min(início do mês, ontem)`). Dias fora do mês corrente mantêm o
   previsto já gravado (`getStoredPlannedTimes`), porque só a escala do mês atual é lida. *(01, 02)*
5. **Vínculo serviço → técnico errado.** Comparava os 8 primeiros caracteres do nome cadastrado aqui. Agora
   compara o nome de 20 caracteres da busca com o **nome completo da lista de socorristas do Porto** (que
   traz o QRA) e então acha o técnico pelo QRA. Nome que não casa com ninguém, ou casa com mais de um, vai
   para o histórico e os serviços são ignorados. `porto_name_hint` deixou de ser usado pelo job. *(02)*
6. **Serviço duplicado** (blocos de 15 dias sobrepostos): deduplicar por código. *(02)*
7. **Fim na manhã seguinte virava dia minúsculo** (início 08:00, Concluído 08:30 do dia seguinte = 0,5h).
   A conta usa a data real do fim (`diffHours(start, end, endsNextDay, breakMinutes)`); acima do máximo
   (padrão 16h, configurável) o dia é rejeitado (`invalid_hours`). *(02)*
8. **Dias manuais sobrescritos.** `getManualWorkHourDates` → o job pula esses dias. *(01)*
9. **Advertência recalculada / removida.** `getPortoWarningDates` → o job pula dias com
   `PORTO_WARNING_MARKER` (`'ADVERTÊNCIA:'`) na observação. *(04)*
10. **Lento:** a escala era lida abrindo cada dia (~68s por técnico). O job de horas só precisa do horário
    do turno, então lê só a grade do mês (~5s). *(01)*
11. **Serviço que não abre** → o dia não é gravado e fica para a próxima execução (não grava dia pela metade).
12. **Dia só com serviço cancelado** → `cancelled_service` (regra 3.7). Serviço cancelado tem a linha do
    tempo vazia (validado em 4 serviços). *(05)*
13. **QRA duplicado entre técnicos ativos** mandava horas para o técnico errado (o job pegava um deles
    com `LIMIT 1`). Aviso no job + recusa no cadastro (4.E). *(09)*
14. **Credenciais apagadas com a automação ligada** davam `skipped` silencioso. Agora é `error`, e o
    worker alerta. *(09)*
15. **Verificações de saúde** em toda execução, gravadas no histórico (`error_message` começando com
    "Atenção:") e devolvidas em `warnings` *(07)*:
    - lista de socorristas vazia;
    - nenhum socorrista casa com técnico ativo;
    - técnico ativo fora da lista;
    - QRA em mais de um técnico ativo;
    - busca sem nenhum serviço no período;
    - coluna de status não reconhecida;
    - nome fora da lista ou ambíguo;
    - socorrista com serviços no Porto e sem técnico ativo;
    - 3+ serviços que não abriram;
    - 3+ laudos ilegíveis;
    - dias com horas implausíveis;
    - execução interrompida por tempo.
16. **Mensagens de erro inúteis** ("Erro inesperado"). Agora levam o erro real (primeira linha, até 200
    caracteres). *(07)*
17. **Mudança de tela no Porto** *(10, `lib/porto-layout.ts`)*:
    - Iframe que não aparece, busca que ignora o período e calendário no mês errado lançam `PortoLayoutError`.
    - Timeout do Playwright depois do login (`TimeoutError`) também conta como mudança de tela.
    - Os avisos de lista vazia, busca vazia, status não reconhecido, 3+ serviços/laudos que falharam e
      escala que não abriu para ninguém marcam `layout_suspect`.
    - A execução grava `porto_sync_log.layout_suspect = true`.
    - O alerta sai com o título "o Portal do Porto parece ter mudado de tela — o robô precisa de ajuste na VPS".
    - A Config. Porto mostra um aviso até a próxima execução limpa. Execuções `running` e `skipped` não
      apagam o aviso.

### 4.B Job de escala (`lib/porto-jobs/run-schedule-job.ts`, `lib/porto-integration/escala.ts`)

1. **Folgas lançadas no Porto no meio do mês nunca chegavam:** importava uma vez por mês. Agora reimporta
   **todo dia** (03:00), de hoje até o fim do mês. Dias passados, concluídos e manuais não são tocados. *(02)*
2. **Escala do mês seguinte** (regra 3.9): `getEscalaForMonth(page, qra, { monthOffset, fullDayOffPercent })`,
   com `nextMonth()` e conferência do mês exibido. Sem escala publicada → `next_month_not_published`, sem
   gravar nada. *(05)*
3. **Escala apagada à noite:** técnico sem nenhuma escala no Porto no mês (licença, dono da conta) tinha a
   escala futura inteira apagada pela reimportação diária. Agora fica como está (`no_escala_on_porto`). *(07)*
4. **Folga parcial × dia inteiro:** `portoFullDayOffPercent` (padrão 90%) decide quando a indisponibilidade
   vira folga do dia inteiro. *(06)*
5. **Saúde:** lista vazia; nenhum técnico com escala no mês; escalas que não abriram. Se nenhuma abrir
   para ninguém, `layout_suspect`. *(07, 10)*

### 4.C Worker (`worker/index.ts`, `worker/server.ts`, `worker/porto-lock.ts`, `worker/job-schedule.ts`)

1. **Fuso:** `ENV TZ=America/Sao_Paulo` no Dockerfile. *(01)*
2. **Uma sessão do Porto por vez** (`porto-lock.ts`): as execuções agendadas esperam a trava; pedidos da
   tela (testar login, socorristas, testar/rodar agora) recebem **409** "já existe uma execução em
   andamento". *(02)*
3. **Horários configuráveis:** troca o cron fixo por um tick por minuto que lê os horários das
   Configurações (`isJobDue`, com recuperação de até 60 min se o worker estava fora no horário). *(06)*
   **Ao reiniciar não repete** a execução do dia: `loadLastRunDays` olha `porto_sync_log` de execuções
   **automáticas**. *(07)*
4. **Execução automática × manual:** `porto_sync_log.run_trigger` ('auto' | 'manual'). O reinício e o
   "Fim do expediente" só consideram execuções automáticas. Antes, um "Rodar agora" à tarde contava como a
   importação da noite. *(07)*
5. **Execução travada:** um watchdog alerta se a trava passa de 2h. *(07)*
6. **Alertas por WhatsApp** (`lib/porto-alerts.ts`, `sendPortoAlert`): execução automática que falha,
   termina com avisos, parece mudança de tela ou fica travada. Nunca lança exceção. *(07, 10)*
7. **WhatsApp agendado só com Evolution configurada no container.** Senão, cada notificação "reservava"
   o dia e falhava o envio. *(01)*
8. **`GET /health`** (autenticado com o segredo do worker) → `{ ok: true }`, usado pelo app para o aviso
   de manutenção. *(10)*
9. **Disco da VPS:** cada build deixa ~2,4 GB. Rodar com rotação de log
   (`--log-opt max-size=20m --log-opt max-file=5`) e limpar imagens antigas (seção 6).

### 4.D WhatsApp (`lib/whatsapp/notifications.ts`)

1. **"Fim do expediente" nunca saía.** O horário configurado (em produção, 17:30) "reservava" o dia antes
   da importação das 23:00, e o envio pós-importação era bloqueado. Agora:
   - o horário configurado só dispara depois que a importação **automática** daquele dia terminou
     (`dailyHoursReady`: `porto_sync_log` com `range_end ≥ dia`, terminada no dia ou depois,
     `run_trigger = 'auto'`);
   - o envio pós-importação usa o **dia da execução**, mesmo que ela termine depois da meia-noite;
   - o envio só acontece se a importação deu certo. *(02, 07)*
2. **`{meta_mes}`** passa a vir das faixas de prêmio das Configurações (que também são as metas de OS). *(06)*
3. **Alerta do robô** usa a mesma Evolution, independente do liga/desliga das notificações; número em
   Configurações → "WhatsApp para alertas do robô". *(07)*
4. Técnico sem telefone simplesmente não recebe. Em modo teste, tudo vai para o número de teste (já era assim).

### 4.E Técnicos (`app/api/technicians/route.ts`)

1. **QRA duplicado:** criar ou editar um técnico **ativo** com QRA de outro técnico ativo é recusado com
   409: "Este QRA já é do técnico X. Cada técnico ativo precisa de um QRA próprio — é por ele que as horas
   do Porto são vinculadas." Técnico inativo pode manter QRA antigo. *(09)*
   **No SaaS:** por organização. Garanta também no banco com índice único parcial
   `(organization_id, qra) WHERE status = 'active' AND deleted_at IS NULL AND qra <> ''`. A produção não
   tinha isso.
2. **Padrões de comissão/salário/VA/VR** vêm das Configurações quando o técnico não tem valor próprio. O
   NextRotta já fez isso na Fase 3; confira se as telas de cadastro usam o hook. *(06)*

### 4.F Escala — tela "Montar escala" (`app/admin/schedule/admin-schedule-builder.tsx`, `lib/schedule-write-service.ts`, `app/api/schedule/route.ts`)

1. **Quem manda** (regra 3.8): `replaceGeneratedScheduleRows({ ..., portoAutomationEnabled })`. Ligada →
   modo `'generated'` (protege as linhas do Porto); desligada → modo `'porto'` (pode substituir). O PUT
   lê `automation_enabled` do `porto_config` **da organização** e devolve
   `summary.portoAutomationEnabled`. A mensagem de sucesso avisa que o Porto manda. *(08)*
   **No SaaS:** o "substituir" precisa ser exclusão lógica (`deleted_at`), nunca `DELETE`.
2. **Situação "Serviço cancelado"** no menu "Situação" do apontamento. *(05)*
3. **Modal do almoço na planilha** (regra 3.10). *(05)*
4. **Regras da escala lidas das Configurações** (turno padrão, intervalo, jornada). O builder usa um
   objeto de regras de módulo sincronizado no render e um wrapper que só monta o builder depois que as
   Configurações carregaram (`AdminScheduleBuilderPage` → `AdminScheduleBuilderContent`). *(06)*

### 4.G Banco de horas e apontamento (`lib/work-hours-service.ts`, `lib/hour-bank.ts`, `lib/management-dashboard.ts`)

1. `AttendanceStatus` ganha `'cancelled_service'`; `attendanceHasHours(status)` diz quais situações
   contam horas. `app/api/work-hours/route.ts` aceita a nova situação. *(05)*
2. Dia "Serviço cancelado" conta as horas e **não cobra o previsto** (tela de horas, banco de horas e
   dashboard gerencial, que recebe `AttendanceRules`). *(05, 06)*
3. Helpers do job: `getManualWorkHourDates`, `getPortoWarningDates`, `getStoredPlannedTimes`,
   `getExistingPortoImportedDates`. *(01, 02, 04)*
4. Jornada mensal (220h), intervalo, adicional de hora extra, piso de alerta de horas do técnico e dia de
   corte Q1/Q2 vêm das Configurações. *(06)*

### 4.H Configurações (`lib/organization-settings.ts`, `lib/organization-settings-store.ts`, `/admin/configuracoes`)

O NextRotta já tem `organization_settings` (migração `0003`, colunas) com: comissão, salário base, VA, VR,
jornada mensal, hora extra, intervalo e faixas de prêmio. A produção tem estes campos **a mais**. Crie-os
por migração (colunas, no padrão da `0003`) e leve cada um a quem o usa *(06, 07)*:

| Campo (produção) | Padrão na produção | Padrão sugerido para organização nova | Onde é usado |
|---|---|---|---|
| `defaultShiftStart` / `defaultShiftEnd` | 08:00 / 18:00 | igual | escala, previsto do dia |
| `monthlyHoursWarningFloor` | 200 | igual | alerta de horas no painel do técnico |
| `fortnightSplitDay` | 15 | igual | quinzena Q1/Q2 dos serviços |
| `chargeCancelledServicePlanned` | false | igual | banco de horas (regra 3.7) |
| `portoHoursImportTime` | 23:00 | igual (ver 5.3) | worker |
| `portoScheduleImportTime` | 03:00 | igual (ver 5.3) | worker |
| `portoReprocessDays` | 1 | igual | job de horas (ontem e hoje) |
| `portoMaxShiftHours` | 16 | igual | job de horas (`invalid_hours`) |
| `portoNextMonthLookaheadDays` | 7 | igual | job de escala (0 = nunca) |
| `portoFullDayOffPercent` | 90 | igual | escala (folga do dia inteiro) |
| `portoUseLaudoConclusion` | true | igual | usa "Data de conclusão do laudo" sem assinatura |
| `portoWarningEnabled` | true | igual | grava advertência |
| `portoWarningText` | texto da advertência | igual | o marcador `ADVERTÊNCIA:` é fixo e não editável |
| `portoRecordCancelledDays` | true | igual | grava dias "Serviço cancelado" |
| `portoAlertPhone` | vazio | vazio | alertas do robô para o admin da organização |
| `financeDueSoonDays` | 7 | igual | financeiro ("vence em breve") |
| `financeCategories` | lista | lista genérica | sugestões de categoria |

Funções puras da produção para reaproveitar: `calculateServiceAward`, `valueOrDefault`, `netOfDailyBreak`,
`calculateOvertimeValue`, `fortnightForDay`, `buildPortoWarningNote`, `pickTechnicianSettings`
(subconjunto que o técnico pode ler). A API devolve tudo ao admin e só o subconjunto ao técnico. A
documentação campo a campo está em `docs/configuracoes.md`.

Os valores **do cliente da produção** (salário 2664,53, VA 249, VR 783, faixas 80→250 e 160→600) **não
são padrão do SaaS**. Organização nova começa com os padrões do NextRotta.

### 4.I Avisos de indisponibilidade (`lib/system-status.ts`, `components/maintenance-banner.tsx`, `lib/porto-worker-client.ts`)

1. **VPS fora do ar** não avisava ninguém: quem alerta é o próprio worker, e a Evolution está na mesma VPS.
   Na produção, a Vercel testa a cada 2 min (cache de 60s) se o worker (`/health`) e a Evolution
   respondem (502/503 do Caddy ou sem resposta = fora). Se não, o admin vê **"Módulos Porto e WhatsApp em
   manutenção"** (ou só o que caiu) no topo de toda tela. *(10)*
2. **Ações do Porto na tela** com o worker fora: `callPortoWorker` devolve 503 com "Módulo Porto em
   manutenção: o servidor da automação (VPS) está fora do ar. Tente de novo quando ele voltar.", em vez de
   "Resposta inválida". *(10)*
3. **No NextRotta** já existem `worker_heartbeats` (sinal a cada minuto) e a faixa de manutenção em
   `components/organization-support.tsx`. Use o heartbeat para o Porto (3 sinais perdidos = fora) e
   acrescente o teste de alcance da Evolution para o WhatsApp. A faixa da empresa deve dizer **quais
   módulos** estão em manutenção.

---

## 5. Adaptações obrigatórias ao SaaS

### 5.1 Banco (migração nova, ex.: `0017_porto_production_fixes.sql`)

- `porto_sync_log.run_trigger VARCHAR(16)` e `porto_sync_log.layout_suspect BOOLEAN NOT NULL DEFAULT false`.
- `cancelled_service` aceito em `work_hours.attendance_status`. Confira se existe `CHECK` na coluna e
  ajuste.
- Colunas novas de `organization_settings` (tabela da 4.H).
- Índice único parcial de QRA por organização (4.E). Antes de criar, verifique se há duplicados nos dados
  de teste.
- Nada de `ensure*Schema()`: a produção cria colunas em runtime; aqui tudo é migração.

### 5.2 Trava e fila do worker

Na produção a trava é **global** (um cliente, uma sessão). Aqui:

- **Trava por organização:** nunca duas sessões do Porto da mesma organização. Pedidos da tela dessa
  organização recebem 409 enquanto ela roda.
- **Semáforo global de 2 navegadores ao mesmo tempo** (configurável pelo dono). Medições: 2 núcleos,
  12 GB, sem swap. 10 navegadores juntos arriscam estourar a memória: o Linux mataria processos,
  inclusive a Evolution e o worker de produção. Também deixariam tudo ~5× mais lento (timeouts de 30s,
  falsos alertas de "tela mudou") e fariam 10 logins simultâneos do mesmo IP, o que arrisca bloqueio pelo
  Porto.
- **Fila às 23:00:** com 10 organizações do tamanho do cliente da produção e 2 por vez, a fila termina em
  ~1,5h numa noite normal e ~6,5h numa noite pesada.
- **Escala depois da fila de horas**, não às 03:00 fixas, para nunca competir com uma noite pesada.
- **Ordem que gira** a cada noite, para não ser sempre a mesma organização a ficar por último.
- **Alerta ao dono** se a fila não terminar até as 06:00.
- **Falha isolada:** a falha de uma organização nunca para as outras (o NextRotta já faz isso).

### 5.3 Horários

O NextRotta tem os horários fixos (23:00/03:00) para todos. Sugestão: o horário de horas de cada
organização vem das Configurações dela e **entra na fila** nesse horário; a escala entra na fila quando
as horas da organização terminam. O tick por minuto com recuperação de 60 min (`isJobDue`) e o
`loadLastRunDays` por organização evitam repetir ao reiniciar.

### 5.4 Alertas

- **Problema da organização** (credenciais, técnico fora da lista, QRA duplicado, laudos): vai para o
  `portoAlertPhone` **da organização**, pela instância Evolution dela.
- **Mudança de tela do Porto:** é problema da plataforma, e todas as organizações falham juntas. Mande
  **um** alerta ao **dono** ("Porto mudou de tela — N organizações afetadas"), com deduplicação por
  incidente, por uma instância de WhatsApp da plataforma (configurada nas configurações do dono). Cada
  organização vê o aviso na Config. Porto dela. Mostre também no painel do dono (Operação).
- **Execução travada / fila atrasada / VPS:** só ao dono.

### 5.5 Direitos do plano

`checkLimit` de execuções do Porto por mês: decida (e documente) se testes manuais contam. Sugestão: só
as execuções que gravam (`auto` e "Rodar agora"). Organização `suspended` não entra na fila.

### 5.6 Testes

- Teste de isolamento entre `demo` e `beta` em cada rota tocada.
- Os cálculos das Configurações e da folha com os padrões precisam dar o mesmo resultado de antes.
- `scripts/test-management-dashboard.cjs` precisa passar.
- O Porto real só pode ser testado com credenciais de uma organização que o dono autorizar, **nunca** com
  as da produção.

---

## 6. Gerenciamento da VPS (módulo novo do painel do dono)

### 6.1 O que o dono pediu

- Saber os **gastos** e **quanto a VPS está consumindo**.
- **Acesso à VPS** para limpezas e manutenção.
- **Telas visuais com os containers** que existem.
- **A limpeza do disco passa a ser responsabilidade do NextRotta**, que enxerga todos os containers.
  Hoje ela é feita por um timer instalado pela produção (6.4).

### 6.2 Como a VPS está hoje (06/10/2026)

- **Máquina:** Oracle Cloud, Ubuntu, ARM `aarch64` (Ampere Neoverse-N1), **2 núcleos, 12 GB de RAM, sem
  swap, 45 GB de disco** (32% usado). Fuso do host: UTC. O serviço `cron` está **inativo**: use timers do
  systemd.
- **Acesso SSH:** `ssh -i C:\Users\iluuc\Documents\ssh_oracle\ssh-key-2026-07-20.key ubuntu@163.176.250.63`
  (usuário com `sudo`). Autorizado pelo dono para este trabalho.
- **Caddy** (`/etc/caddy/Caddyfile`, site `evolution-whatsapp.duckdns.org`):
  `handle_path /porto-worker/*` → `127.0.0.1:8090` (worker da **produção**); o resto → `127.0.0.1:8080`
  (Evolution). Mudanças no Caddy só **acrescentando** rotas, com `caddy validate` antes de
  `systemctl reload caddy`. Nunca remover ou alterar as rotas existentes.
- **Containers:**

| Container | Dono | Observação |
|---|---|---|
| `porto-worker` | **Produção (Central Operacional)** | Cliente real. Imagem `porto-worker:<sha>`, porta 8090, rotação de log 20m×5. |
| `porto-worker-<sha7>` (parado) | Produção | Versão anterior, guardada para voltar atrás. |
| `evolution-api`, `evolution-postgres`, `evolution-redis` | **Compartilhado** | WhatsApp. A instância da produção está aqui; as das organizações do NextRotta também ficarão. Sem rotação de log. Volumes `evolution_*` = sessões do WhatsApp e banco. |

- **Pastas:**
  - `/opt/porto-worker` e `/opt/porto-worker.bak-*`: contexto de build da produção.
  - `/opt/evolution`: Evolution.
  - `/opt/prumo`: **outro sistema, não mexer**.
  - `/opt/containerd`, `/opt/unified-monitoring-agent`: do sistema e da Oracle.
- **Imagens:** `porto-worker:<sha atual>`, `porto-worker:<sha anterior>` (+ `:latest` na mesma),
  `porto-worker:prev-20260831` (base de agosto, manter), `evoapicloud/evolution-api:v2.3.7`,
  `postgres:15-alpine`, `redis:7-alpine`.

### 6.3 Regra de ouro: a VPS é compartilhada

Classifique **todo** container e imagem por dono e aplique estas permissões:

| Dono | Como identificar | Permitido |
|---|---|---|
| NextRotta | label `com.nextrotta.owner=nextrotta`, que você coloca em tudo que criar | tudo da lista de ações permitidas |
| Produção | nomes `porto-worker`, `porto-worker-<sha7>`, imagens `porto-worker:*` | **só leitura** (status, métricas, logs). Nunca parar, reiniciar, remover ou recriar. |
| Compartilhado | `evolution-*` | ver e ler logs; reiniciar só com confirmação explícita e aviso de que derruba o WhatsApp da produção |
| Desconhecido | qualquer outro | só leitura |

O worker do NextRotta **não pode** usar nomes `porto-worker*` nem a porta 8090. Sugestão:
`nextrotta-worker`, porta `8091`, rota `/nextrotta-worker/*` no Caddy, imagem `nextrotta-worker:<versão>`.
Rode com label de dono, rotação de log, `TZ=America/Sao_Paulo` e **limite de memória**
(ex.: `--memory=4g`), para um pico do SaaS nunca derrubar a produção.

### 6.4 A limpeza que existe hoje (você assume)

- **Onde:** `/usr/local/sbin/vps-cleanup.sh`, que rodava por `vps-cleanup.timer`/`vps-cleanup.service` todo
  dia às 07:30 UTC (04:30 Brasília). Log em `/var/log/vps-cleanup.log`. Cópias em `vps/`. O log do journal
  continua limitado a 200M em `/etc/systemd/journald.conf.d/size.conf`.
- **Estado:** o timer foi **desligado em 06/10/2026** (`systemctl disable --now vps-cleanup.timer`), a pedido
  do dono. **Hoje nenhuma limpeza automática roda na VPS.** O script continua em disco como referência. Cada
  deploy da produção deixa ~2,4 GB e cache de build, então isto é **prioridade**: disco em 31% (14 de 45 GB)
  em 06/10.
- **O que faz, sempre restrito por nome:**
  - mantém só o container `porto-worker-<sha7>` parado mais novo;
  - remove imagens `porto-worker:*` que nenhum container usa e que têm mais de 1 dia, exceto
    `prev-20260831`;
  - remove imagens sem tag e cache de build com mais de 72h;
  - zera logs acima de 200 MB só de `porto-worker` e `evolution-*`;
  - `journalctl --vacuum-size=200M` e `apt-get clean`.
- **Nunca toca:** volumes, `/opt` e containers rodando.
- **Passagem de responsabilidade:**
  1. Implemente a limpeza no agente (6.5) com **todas** as regras acima, mais as do NextRotta (imagens
     antigas `nextrotta-worker`, mantendo a atual e a anterior).
  2. Rode em modo **prévia** e compare com o que o script atual faria.
  3. Ative a sua. A antiga já está desligada. Se a sua demorar, o dono pode religar a antiga
     temporariamente com `sudo systemctl enable --now vps-cleanup.timer`.
  4. A produção faz deploy manual (build em `/opt/porto-worker.new`, troca de pastas, container anterior
     renomeado para `porto-worker-<sha>` com `restart=no`). A sua limpeza precisa continuar compatível com
     isso.

### 6.5 Arquitetura proposta: agente da VPS

O app roda na Vercel e não tem SSH. Crie um **agente** pequeno na VPS:

- Container `nextrotta-vps-agent` (label de dono), ouvindo só em `127.0.0.1:<porta>`, publicado pelo Caddy
  em `/nextrotta-vps-agent/*`.
- Segredo próprio, diferente do worker, comparado com `timingSafeEqual`.
- Acesso ao Docker pelo socket e a `/proc` e `/` do host somente leitura, para as métricas.
- **O socket do Docker equivale a root no host.** Por isso o agente **não executa comando arbitrário**:
  só uma lista fechada de ações, todas com checagem de dono (6.3).

Endpoints sugeridos:

| Método | Rota | O que faz |
|---|---|---|
| GET | `/health` | vivo |
| GET | `/host` | CPU (uso, load), RAM (usada/disponível), disco (total/usado/%), rede (bytes in/out), uptime, versão do SO |
| GET | `/containers` | nome, dono, status, uptime, reinícios, imagem, tamanho, portas, política de restart, CPU%, RAM, limite de memória, tamanho do log |
| GET | `/containers/:name/logs?tail=200` | últimas linhas (só leitura) |
| GET | `/images` | repositório:tag, tamanho, criada em, em uso por, dono |
| GET | `/disk` | `docker system df` + maiores pastas conhecidas + journal + log da limpeza |
| POST | `/cleanup?dryRun=1` | prévia: o que seria removido e quanto libera |
| POST | `/cleanup` | executa, devolve o que removeu |
| POST | `/containers/:name/restart` | só NextRotta (ou compartilhado com `confirm=evolution`) |

Coleta de histórico: o **worker do NextRotta** (que tem acesso ao banco) chama o agente localmente a cada
5 min e grava em `vps_metrics` (host + por container). Para os gráficos, consulte agregado por
hora/dia. Toda ação de escrita fica em `audit_events`.

### 6.6 Gastos

- **VPS Oracle:** pode estar no plano gratuito. O "Always Free" da Oracle dá até 4 núcleos ARM e 24 GB no
  total; o dono precisa confirmar no console da Oracle. Implemente:
  - (a) **opcional:** leitura do custo pela OCI Usage API (tenancy OCID, user OCID, fingerprint, chave
    privada e região em variáveis de ambiente, nunca no banco em texto puro);
  - (b) **sempre:** lançamento manual mensal de custos de infraestrutura (VPS, Vercel, Neon, domínio,
    Evolution etc.) numa tabela `infra_costs`.
- **Rateio por organização** (para o dono saber quanto cada cliente custa): minutos de navegador do Porto
  no mês (soma das durações em `porto_sync_log`), instância de WhatsApp e mensagens enviadas, armazenamento.
  Mostre custo estimado por organização × quanto ela paga (assinatura).
- **Capacidade:** com 2 navegadores por vez, cabem ~15–20 organizações do tamanho do cliente da produção
  (10 técnicos) com folga; ~40–50 numa noite normal. Mostre a ocupação da janela noturna (minutos usados de
  23:00 a 06:00) para o dono ver quando precisa de outra VPS. Recomendação: o SaaS em VPS própria quando
  passar de 5–10 organizações, para não dividir máquina com a produção.

### 6.7 Telas (painel do dono → Operação → VPS)

Siga o `CLAUDE.md`: o visual do painel é território da IA de design. Aqui você entrega a API e a
especificação (no `docs/saas/prompt-painel-dono.md`), sem opinar no visual. Conteúdo:

1. **Visão geral:** medidores de CPU, RAM e disco; gráficos 24h/7d/30d; uptime; status do agente e do worker.
2. **Containers:** cartões ou tabela com dono (selo Produção/Compartilhado/NextRotta/Desconhecido),
   status, CPU, RAM, imagem, tamanho, reinícios e logs. Ações só onde a regra 6.3 permite, com
   confirmação.
3. **Imagens e cache:** espaço por imagem, em uso ou não, cache de build, quanto dá para liberar.
4. **Limpeza:** botão "Ver prévia" → lista do que sai e quanto libera → "Executar". Histórico das limpezas
   automáticas e manuais.
5. **Gastos:** custo do mês, lançamentos, rateio por organização, margem.
6. **Alertas** ao dono por WhatsApp (instância da plataforma) e no painel: disco ≥ 80% (aviso) e ≥ 90%
   (crítico), RAM disponível < 1 GB, container do NextRotta parado, heartbeat do worker perdido, fila
   noturna passando das 06:00, agente sem responder.

### 6.8 Ordem de implantação na VPS

1. Agente (só leitura) + Caddy + teste.
2. Telas e coleta de métricas.
3. Limpeza em prévia → comparação → ativação → desligar o timer antigo.
4. Ações de restart.
5. Gastos.

Em cada passo, confirme que `porto-worker` e `evolution-*` continuam de pé
(`docker ps`, `curl` no `/porto-worker/health` com 401 sem token).

---

## 7. Resumo do que entregar

- [ ] Todas as correções das seções 4.A–4.I portadas, por organização, com migração `0017`.
- [ ] Trava por organização + semáforo de 2 + fila com escala depois das horas + ordem que gira + alerta às 06:00.
- [ ] Alertas: organização → admin dela; tela do Porto mudou → um alerta ao dono por incidente.
- [ ] Faixa de manutenção dizendo quais módulos (Porto/WhatsApp) estão fora.
- [ ] Agente da VPS, métricas, containers, imagens, limpeza (assumindo a atual), gastos e alertas.
- [ ] Worker do NextRotta com nome, porta e rota próprios, label de dono e limite de memória.
- [ ] `CLAUDE.md` e `docs/` deste repositório atualizados; `npx tsc --noEmit` e build do worker limpos.
