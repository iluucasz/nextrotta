# Integração com Portal do Prestador (Porto Seguro)

Status: **implementado (v1)**. Plano completo em `C:\Users\iluuc\.claude\plans\swirling-shimmying-plum.md`.
Automação nasce **desligada** — precisa ser configurada e ligada manualmente em Config. Porto.

**Antes de ligar a automação em produção, leia a seção "O que ainda é heurística" no final deste documento.** Login, navegação, lista de socorristas, escala e busca/detalhe de serviço já foram validados ao vivo contra o Porto (duas rodadas de teste). Só restam duas heurísticas de cálculo (vínculo serviço→técnico por nome, e horário de início aproximado pela escala) que ainda não têm forma validada de confirmar 100%.

## Objetivo

Aproveitar a escala e as horas trabalhadas que já existem no Portal do Prestador da
Porto Seguro (onde o time de socorristas já é gerenciado) para alimentar
automaticamente a Montagem da Escala e o Apontamento de Horas deste sistema, evitando
digitação duplicada.

Ideia original do produto:
- Aba **Config. Porto** na sidebar, visível só para admin.
- Admin cadastra login/senha do Porto (fica salvo no banco).
- Toggle para ligar/desligar a automação.
- **Apontamento de horas**: roda 1x por dia, no fim do dia.
- **Escala**: gerada 1x por mês, mas com checagem diária se a escala do período já existe.

## O que foi validado (testes reais, ambiente de teste isolado)

Todos os testes abaixo foram feitos com login real (credenciais do próprio usuário,
autorizado por ele) contra `prestador.portoseguro.com.br` /
`wwws.portoseguro.com.br`. Nenhum dado de teste (HARs com CPF/senha, cookies)
permanece no repositório — foi tudo apagado após a análise.

### 1. CORS não é um problema

A integração roda no backend (Node/cron), não no navegador do usuário. CORS só existe
como restrição de browser, então nunca vai bloquear uma chamada servidor-a-servidor.
O risco real era outro (ver abaixo).

### 2. Login funciona via HTTP puro, em 3 passos

O endpoint que aparece mais óbvio no DevTools (`/pdp-service/api/public/login/users/qras/`)
**não** autentica sozinho — ele só valida CPF/senha e devolve os códigos QRA
associados à conta. O login de verdade precisa de 3 chamadas em sequência, na mesma
sessão (cookie jar):

1. `GET https://prestador.portoseguro.com.br/portal/site/pdp/template.LOGIN/`
   → extrair o nonce anti-CSRF do HTML: campo hidden `vgn_realm1_nonce`.
2. `POST https://prestador.portoseguro.com.br/pdp-service/api/public/login/users/qras/`
   Body: `cpf=<cpf>&password=<senha>`
   → resposta: `{"status":"success","data":{"qras":[{"codQRA":"..."}]}}`
3. `POST https://prestador.portoseguro.com.br/portal/site/pdp/template.LOGIN/action.process/`
   Body: `vgn_realm1_nonce=<nonce do passo 1>&logon=<cpf>&password=<senha>&qra=<codQRA do passo 2>&remember=manterConectado`
   → `302` para `/pdp/Homepage` e seta os cookies de sessão reais:
   `SECURITY_TOKEN`, `CPFPrestador`, `IDPrestador` (domínio `.portoseguro.com.br`),
   `REMEMBERTOKEN` (domínio `prestador.portoseguro.com.br`).

Confirmar autenticação chamando (POST, mesma sessão):
`.../template.SINGLEPORTLET/menuitem.3f12931f95bf6da799d174c40812f1ca/resource.process/?...rid=getNotificacoesCount`
com body `origemId=655` → deve responder `{"count":"0"}` (ou outro número). Se voltar
o HTML da tela de login, a sessão não autenticou.

Esse fluxo funcionou de forma 100% confiável via HTTP puro (axios/fetch), sem
executar nenhum JS do site.

### 3. A parte que NÃO funciona via HTTP puro: acessar `wwws.portoseguro.com.br`

Escala e horas ficam num app **completamente separado**
(`wwws.portoseguro.com.br`, legado, JSF 1.2 / IBM WebSphere / RichFaces), com seu
próprio cluster de sessão. Mesmo autenticado de verdade no `prestador` (cookies
`SECURITY_TOKEN` etc. válidos e presentes), uma chamada HTTP pura direta para
esse domínio retorna **500 Internal Server Error**.

A página de erro (bug de exposição de informação do lado da Porto) vazou o stack
trace Java, que mostra a causa exata:

```
com.porto.seguranca.business.PortoSessionManager.authenticate
Sessão (<valor do cookie SECURITY_TOKEN>) inexistente!
```

Ou seja: o `wwws` valida sessão lendo o cookie `SECURITY_TOKEN` (que chega
corretamente, pois o domínio do cookie é `.portoseguro.com.br`) contra um cache de
sessão próprio — e esse cache nunca reconhece um token emitido por uma requisição
HTTP pura, mesmo sendo um login real e válido.

**Não é bloqueio do Imperva** (WAF/anti-bot que protege o site) nem CORS — a
requisição chega no backend normalmente (prova disso é o próprio erro 500 vindo do
Java). É a ponte de sessão entre os dois apps que exige algo que só um motor de
navegador real fornece (provavelmente fingerprint TLS/HTTP idêntico ao Chrome de
verdade — não foi isolado exatamente qual sinal falta, e não compensa continuar
investigando isso).

### 4. Solução validada: navegador headless (Playwright)

Repeti o mesmo fluxo de login com Playwright controlando um Chromium real
(headless) em vez de `fetch`/`axios`. Resultado:

- Login pela UI (preencher CPF/senha, clicar "entrar") funcionou normalmente.
- Navegar direto para `https://wwws.portoseguro.com.br/integracoesportaldeprestadores/click/ConSocor.xhtml?portal=2`
  **funcionou sem erro**, carregando a lista real de socorristas (nome, CPF, QRA,
  celular, status).

Ou seja: **a integração é viável, mas precisa rodar via navegador headless
(Playwright), não via chamadas HTTP puras.** O login em si até funcionaria com
HTTP puro, mas como a parte que interessa (escala/horas) está no `wwws`, mais
simples manter o fluxo inteiro em Playwright.

## Endpoints mapeados (via engenharia reversa do portal, para uso dentro do Playwright)

Todos abaixo pressupõem sessão autenticada (cookies válidos) e devem ser navegados
com uma página real do Playwright (`page.goto(...)`), não com `fetch` cru.

| Tela | URL | Método | Observação |
|---|---|---|---|
| Lista de socorristas | `wwws.portoseguro.com.br/integracoesportaldeprestadores/click/ConSocor.xhtml?portal=2` | GET | Retorna até 12 socorristas com `numeroQRA` embutido no HTML. Paginação além disso não foi confirmada (ver Lacunas). |
| Detalhe do socorrista + escala do mês atual | `.../click/ConDetSocor.xhtml?numeroQRA=<QRA>&flagMegaRecurso=false` | GET | HTML já traz a escala do **mês corrente** embutida (ex: `08:00 - 18:00`) e ícones de indisponibilidade (`/visual/img/indisponibilidade.png`) nos dias com exceção (férias, doença, folga, etc). |
| Busca de serviços por período | `.../click/ConServCons.xhtml` | POST | Body: `formConsultaServico=formConsultaServico&dadosFiltro=,,,,,,,,,,&tipoData=1&dataInicialInputDate=<dd/MM/yyyy>&dataInicialInputCurrentDate=<MM/yyyy>&numeroServicoAtendimento=&dataFinalInputDate=<dd/MM/yyyy>&dataFinalInputCurrentDate=<MM/yyyy>&anoServicoAtendimento=&pesquisar=Pesquisar&javax.faces.ViewState=<token>`. Resposta traz tabela HTML com nome do técnico (truncado) e data por linha. |
| Detalhe do serviço (horário de conclusão) | `.../click/ConDetServAW.xhtml?anoServico=<AA>&numeroServico=<num>&dadosFiltro=,,,,,,,,,,&origem=1&ret=false` | GET | HTML traz "Situação Atual" e os horários do trajeto (Em Deslocamento, Concluído etc). Testado e confirmado: horário de conclusão bate exatamente com o esperado. |

Formato de nomes truncado nas listagens (ex: "DAVID APOLINARIO FRA") — o match para
o sistema interno deve ser feito preferencialmente por **QRA** (identificador
estável) e não por nome.

## Lacunas conhecidas (não testadas, precisam de nova investigação quando formos implementar)

- **Troca de mês na tela de escala**: o calendário usa RichFaces AJAX
  (`A4J.AJAX.Submit('formDetalheServico', ...)`), ou seja, POST disparado por JS, não
  GET com data na URL. Não foi capturada a chamada real — vamos precisar disso para
  buscar meses diferentes do atual.
- **Paginação da lista de socorristas** além dos primeiros 12 (`LazyScrollTableSocorristas.jsp`,
  mencionado em pesquisa anterior) — não foi confirmada nesta rodada de testes.
- **`obterStatusSocorrista.do`** (consulta de status por QRA) — mencionado em
  pesquisa anterior, não confirmado nesta rodada.

## Riscos / cuidados para quando formos implementar

- **Sistema em produção**: a Montagem de Escala e o Apontamento de Horas já existem
  e já são usados. Qualquer automação de escrita precisa de: backup antes de
  sobrescrever, modo dry-run, e não mexer em dias/meses já concluídos (o sistema já
  tem essa regra para edição manual — reaproveitar).
- **Sessão do Porto expira**: vamos precisar decidir onde/como persistir a sessão
  autenticada (cookies) entre execuções do cron, e reautenticar quando expirar, sem
  gerar login repetido demais (risco de parecer comportamento anômalo pro Imperva).
- **Credenciais do Porto**: ficarão salvas no banco (pedido do usuário) — precisam
  ser criptografadas em repouso, não só em texto plano numa coluna.
- **Custo operacional do Playwright**: precisa manter um binário de Chromium
  disponível no ambiente onde o cron roda (mais pesado que uma function HTTP simples).
- **ToS do portal**: é um portal de terceiro (Porto Seguro); a automação usa
  credenciais legítimas do próprio usuário/prestador, mas vale ter em mente que é
  scraping de um sistema de terceiro sem API oficial documentada.

## Próximo passo

Com a viabilidade técnica confirmada, a próxima etapa é desenhar como isso entra no
sistema: aba "Config. Porto" (admin), modelo de dados para credenciais + toggle,
desenho do job/cron (apontamento diário + checagem/criação mensal de escala), e
estratégia de conciliação com dados já existentes no sistema.

## Implementação (v1)

Plano completo aprovado e implementado — arquivos principais:

- `lib/porto-crypto.ts`, `lib/porto-config-schema.ts`, `app/api/porto-config/*`,
  `app/admin/config-porto/page.tsx` — credenciais (AES-256-GCM), toggle, teste de
  login, histórico de execuções.
- `lib/work-hours-service.ts`, `lib/schedule-write-service.ts` — lógica de escrita seguras extraída
  das rotas existentes (`app/api/work-hours/route.ts`, `app/api/schedule/route.ts`),
  reaproveitada tanto pelo fluxo manual quanto pelos jobs do Porto. **Job de escala**
  (`porto-schedule`) grava `schedule.notes` com o prefixo `Importado do Porto: ...`.
  **Job de horas** (`porto-hours`) é diferente de propósito: o `schedule.notes`
  espelhado continua no formato `Apontamento manual: ...` (para herdar a mesma
  proteção contra sobrescrita que um lançamento manual já tem — ver seção 4 do
  plano), e a proveniência real fica só em `work_hours.source='porto'`. A nota
  ainda inclui `obs=Importado automaticamente do Porto Seguro.` pra não confundir
  quem olhar o calendário.
- `lib/porto-integration/*` — módulo de scraping (login, lista de socorristas,
  escala, busca de serviço/horário de conclusão), usando Playwright real (não HTTP puro).
- `app/api/cron/porto-hours`, `app/api/cron/porto-schedule` — os dois jobs, protegidos
  por `CRON_SECRET`, agendados em `vercel.json` (1x/dia cada).

### Variáveis de ambiente novas (configurar na Vercel antes de usar)

- `PORTO_CREDENTIALS_KEY` — chave AES de 32 bytes em base64. Gerar com `openssl rand -base64 32`.
- `CRON_SECRET` — string aleatória qualquer, usada para autenticar as chamadas de cron.

### Passos manuais de deploy

- Habilitar **Fluid Compute** no projeto Vercel (Settings → Functions) — necessário
  pro `maxDuration` de 280s funcionar no plano Hobby.
- Rodar `npx playwright install chromium` localmente antes de testar `test-login`
  ou os crons em ambiente de desenvolvimento (em produção/Vercel o `@sparticuz/chromium`
  cuida disso sozinho).

## Validação ao vivo (rodada 2) — navegação corrigida

Uma segunda rodada de testes ao vivo (login real, sem gravar nada) achou e corrigiu
três problemas de navegação que teriam quebrado a automação em produção:

1. **Páginas de detalhe rejeitam URL direta.** Navegar direto pra
   `ConDetSocor.xhtml?numeroQRA=...` (sem passar pela lista antes) retorna
   **"Acesso proibido"**. Só funciona clicando no link de dentro da lista já
   carregada — o Porto parece checar que a navegação veio do fluxo normal, não de
   um link direto. Corrigido: `lib/porto-integration/navigation.ts` (novo) abre
   cada página pelo wrapper de portal correto (`/pdp/iframe?menuid=...`) e as
   páginas de detalhe são sempre alcançadas clicando no link real, nunca por
   `page.goto` direto. Isso afeta `socorristas.ts`, `escala.ts` e `servicos.ts`.
2. **Escala: o seletor estava certo, o técnico de teste é que estava errado.**
   Testando com o QRA da própria conta logada (que não é um técnico de campo), as
   células do calendário vinham vazias — parecia confirmar a suspeita de que
   `.organizerDayCell` não bastava. Testando de novo com um técnico de campo real
   (QRA 611072), cada célula tem sim o texto "08:00 - 18:00" e a
   `<img src=".../indisponibilidade.png">` aparece exatamente nos dias com
   exceção (9 de 42 células, agosto/2026) — a implementação original de
   `escala.ts` estava certa, só a navegação (item 1) precisava do ajuste.
3. **Busca de serviço: o campo de data fica escondido até escolher "TIPO DE
   BUSCA".** O campo `dataInicialInputDate` existe mas está dentro de uma
   `<div style="display:none">` até o dropdown `#tipoData` ser setado pra "1"
   (Combinada com Cliente) — sem isso, preencher o campo (mesmo com `force`) é
   ignorado silenciosamente, e o POST direto (sem passar pela UI) retorna 500.
   Corrigido: `servicos.ts` agora seleciona o dropdown antes de preencher as datas.
4. **O mistério do "click/0" do `numeroServico` (aberto desde a pesquisa
   original) está resolvido**: o link do resultado é
   `<a href="0" onclick="changeUrlAW(this, 26, 5167437, '1', false)">5167437/26</a>`
   — `anoServico` e `numeroServico` vêm como argumentos literais da função JS no
   próprio HTML. Confirmado clicando de verdade: abriu `ConDetServAW.xhtml` com
   os timestamps `17/08/2026 06:13, 09:17, 10:25, 10:58` — batendo exatamente com
   a pesquisa original (`5167437/26 → Concluído 10:58`).

Com isso, **login, lista de socorristas, leitura de escala e busca+detalhe de
serviço estão validados ponta a ponta contra produção**, não só inferidos de HAR.

## Heurísticas aceitas (decisão de produto, confirmada em 2026-08-20)

- **Vincular serviço da busca a um técnico** é feito comparando prefixo do nome
  (o Porto não filtra a busca por QRA) — pode errar com nomes muito parecidos.
  **Aceito**: ok pro tamanho do time atual.
- **Horário de início real do técnico**: não existe forma validada de ler isso no
  Porto — o job usa o horário *previsto* da escala do dia como aproximação, e o
  horário do último serviço concluído como fim. **Aceito**: aproximação é
  suficiente.

Essas eram as duas únicas heurísticas em aberto — o resto da integração foi
validado ao vivo nesta sessão e está com alta confiança. Continua recomendado
rodar alguns dias com o modo de teste (`dry_run_only`) ligado antes de desligar,
já que essa parte alimenta dado que afeta folha de pagamento.

## Cobertura do job de horas: mês inteiro, não só "hoje" (2026-08-25)

Ajustado após teste em produção: o job de apontamento de horas varre todo dia
do dia 1 do mês corrente até hoje, em vez de checar só a data de hoje. Isso
evita perder dias (ex: automação ligada no meio do mês, cron falhou um dia,
serviço só aparece "Concluído" no dia seguinte).

- A busca de serviço do Porto aceita **período** (`dataInicialInputDate` /
  `dataFinalInputDate`), não só um dia — usado pra buscar o mês inteiro numa
  chamada só, agrupando os resultados por técnico e data.
- **Limite real do próprio site**: o JS deles limita o período a 15 dias (ajusta
  a data final sozinho se você passar mais que isso) — `lib/porto-integration/servicos.ts`
  quebra o intervalo em blocos de até 15 dias quando o mês já passou desse
  tamanho.
- **Fica barato mesmo cobrindo o mês todo**: antes de buscar o detalhe (caro —
  1 busca+clique por serviço) de cada dia, o job confere no banco se aquele
  `(técnico, data)` já tem uma linha `work_hours.source='porto'` — se já tem,
  pula. Ou seja, a primeira execução depois de ligar a automação faz o trabalho
  pesado do mês todo; os próximos dias, só o dia novo é processado.
- A escala de cada técnico (pro horário previsto de início) é buscada uma vez
  por técnico por execução, não uma vez por dia — reaproveitada pra todos os
  dias novos daquele técnico na mesma rodada.

## Início e fim de jornada (2026-10-05)

Regra validada ao vivo com o dono do produto, usando o dia 05/10/2026 (`lib/porto-jobs/run-hours-job.ts`
+ `getServicoEndTime` em `lib/porto-integration/servicos.ts`):

- Só contam serviços **concluídos** (coluna STATUS começando com "Concluído", com ou sem sucesso).
  "Cancelado" e "Aceite" (aceito e nunca executado) ficam fora — validado ao vivo: um serviço
  "Aceite" com Hora Prev. 17:19 jogava o fim do dia para 07:39 e geraria advertência indevida.
- **Início** = menor **Hora Prev.** (`cap_horaAtendimento`) dos serviços concluídos do dia. A Hora
  Comb. (`cap_horaProgramadaAtendimento`) é o horário definido pela Porto e não é usada. A Hora Prev.
  é uma previsão — costuma bater com o "Em Execução", mas nem sempre segue a ordem real.
- **Fim** = o mais tarde entre os **últimos serviços concluídos** (até 3, do maior para o menor Hora
  Prev.; para de abrir quando a Hora Prev. do próximo já é anterior ao melhor fim encontrado — um
  técnico faz um serviço por vez). Validado ao vivo: um serviço com Hora Prev. 17:00 foi assinado às
  14:00, enquanto o anterior terminou às 15:32. Para cada serviço aberto:
  - Laudo liberado (`<img id="imgLaudo" src=".../laudo.png">` dentro de
    `<a onclick="abreLink('https://porto-socorro-app-portal.web.app/laudo/<id>?token=...')">`) → abre
    o laudo direto por essa URL e usa a **"Data da assinatura"** (ou "Data de conclusão do laudo" se
    não houver assinatura).
  - Laudo desabilitado (`laudo_disable.png`, sem `onclick`) → usa o horário de **Concluído** (célula
    `<!-- BT Concluir -->` da linha do tempo) e grava no apontamento a observação
    `ADVERTÊNCIA: laudo digital não preenchido no serviço NNNNNNN/AA`.
  - Ícone não encontrado ou laudo que não abre → usa o Concluído **sem** advertência e registra
    `laudo_unreadable_used_concluido` no histórico.
- Falha ao abrir um dos serviços → o dia não é gravado e é tentado de novo na próxima execução.
- Dias apontados/corrigidos à mão (`work_hours.source='manual'`, ou folga/falta/justificado manual)
  nunca são sobrescritos pelo job.

### Período da busca (2026-10-05)

O site **não respeita as datas digitadas**: mantém sempre uma janela de 15 dias própria (pedir
01/10–05/10 buscou 01/10–16/10; pedir 01/09–15/09 buscou 31/08–15/09) e às vezes ignora o
preenchimento e usa o padrão "últimos 15 dias". Por isso:

- `runServiceSearch` lê de volta o período usado e, se não cobrir o pedido, tenta de novo uma vez e
  depois falha com erro.
- O job de horas descarta qualquer serviço com data fora do período da execução. Antes disso, as
  rodadas de outubro reescreveram dias de setembro (com o "previsto" da escala de outubro) e as de
  setembro gravaram 31/08.

O worker roda com `TZ=America/Sao_Paulo` (`worker/Dockerfile`). Em UTC, a execução das 23:00 já
calculava "hoje" como o dia seguinte e o último dia de cada mês ficava sem importar.

Tempos medidos ao vivo (05/10/2026, 12 socorristas, 47 serviços de 7 técnicos):

| Etapa | Tempo |
|---|---|
| Login | ~9s |
| Busca de serviços do dia | ~4s |
| Escala de um técnico, abrindo cada dia de indisponibilidade (job de escala) | ~68s |
| Escala de um técnico, só a grade do mês (job de horas — só precisa do horário do turno) | ~5s |
| Fim de jornada de um técnico no dia (busca + detalhe + laudo) | ~9s |
| Job de horas completo para o dia | ~2 min |

Voltar da página de detalhe com `page.goBack()` não funciona (timeout) — cada serviço continua exigindo
refazer a busca do dia.

## Revisão de 2026-10-06

- **Vínculo serviço → técnico pelo nome do próprio Porto.** A busca de serviços não traz QRA, só o
  nome do socorrista cortado em 20 caracteres. Antes, ele era comparado com os 8 primeiros
  caracteres do nome cadastrado aqui. Agora é comparado com o nome completo da lista de socorristas
  do Porto, que traz o QRA. Validado ao vivo (21/09–05/10/2026): cada nome casa com exatamente um
  socorrista. Nome que não casa com nenhum, ou com mais de um, é registrado no histórico e seus
  serviços são ignorados. `technicians.porto_name_hint` deixou de ser usado pelo job.
- **Lista de socorristas:** o "carregar mais ao rolar" (`LazyScrollTableSocorristas.jsp`) responde
  404, então a primeira carga é a lista inteira (12 em 06/10/2026). Se um técnico ativo com QRA não
  aparecer nela, o job registra `technician_not_in_porto_list`.
- **Serviços duplicados:** os blocos de 15 dias se sobrepõem (janela própria do site); cada serviço
  agora entra uma vez.
- **Fim no dia seguinte:** a conta de horas usa a data real do fim. Antes, um Concluído na manhã
  seguinte (ex.: início 08:00, fim 08:30 do dia seguinte) virava 0,5h; agora passa de 16h e é
  rejeitado (`invalid_hours`).
- **Advertência nunca sai (decisão do dono do produto, 06/10):** um dia que já tem advertência
  gravada não é mais recalculado pelo robô, nem pela janela de reprocessamento (ontem e hoje). Laudo
  preenchido depois não muda o dia. Para tirar uma advertência, só corrigindo o dia à mão.
- **Virada do mês:** a execução automática cobre o mês corrente **mais ontem**, então o último dia do
  mês anterior também é reprocessado no dia 1. Dias fora do mês corrente (esse caso, ou uma execução
  manual de datas passadas) mantêm o "previsto" já gravado, porque só a escala do mês atual é lida.
- **Escala reimportada todo dia, de hoje até o fim do mês** (no NextRotta, logo depois das horas da organização — ver "Fila do worker" abaixo). Antes importava uma vez por mês
  e depois só conferia o portal — folgas/trocas lançadas no Porto no meio do mês nunca chegavam, e os
  lembretes de turno do WhatsApp leem essa escala. Dias passados, concluídos e manuais não são tocados.
- **Uma sessão do Porto por vez por organização** (`worker/porto-lock.ts`): as execuções agendadas
  esperam; pedidos da tela daquela organização (testar login, buscar técnicos, testar/rodar agora)
  recebem 409 "já existe uma execução em andamento". Além disso, no máximo N navegadores ao mesmo tempo
  na VPS inteira (ver "Fila do worker"). Um `docker exec ... --run=` é outro processo e não entra nessa trava.
- **"Fim do expediente" (WhatsApp)** (regra atual em "Horários livres", abaixo): o horário configurado só dispara depois que a importação da
  noite terminou para o dia (`porto_sync_log`: `range_end` ≥ dia e terminada no dia ou depois). Antes,
  um horário anterior às 23:00 (em produção estava 17:30) marcava o dia como enviado sem horas, e o
  envio após a importação era bloqueado — a mensagem nunca saía. O envio após a importação usa o dia
  da execução, mesmo que ela termine depois da meia-noite, e só acontece se a importação deu certo.

## Ajustes de 2026-10-06 (tarde)

- **Início pela linha do tempo:** quando a Hora Prev. está vazia ou cai depois do fim do dia (ex.: um
  único serviço previsto para 17:00 e assinado às 14:00), o início vem do horário "Em Execução" (ou
  "Em Deslocamento") da linha do tempo dos serviços já abertos — `timelineStart` em
  `getServicoEndTime`. Validado ao vivo: 6054881/26 → 16:23.
- **Dia só com serviço cancelado → situação "Serviço cancelado"** (`attendance_status =
  'cancelled_service'`, nota `Apontamento manual: serviço cancelado`). Serviço cancelado tem a linha do
  tempo vazia (validado ao vivo em 4 serviços); as horas vão da Hora Prev. até a assinatura/conclusão
  do laudo quando há laudo, senão o dia entra com 0h e a observação pedindo ajuste manual. As horas
  contam, mas as horas previstas do dia **não** são cobradas no banco de horas (tela e dashboard
  gerencial). A situação também aparece no menu "Situação" do apontamento.
- **Escala do mês seguinte:** nos últimos 7 dias do mês, a execução das 03:00 também lê o mês
  seguinte (o calendário é um componente RichFaces; `component.nextMonth()` troca para o mês seguinte
  — validado ao vivo: novembro já estava publicado em 06/10). Só é importado para técnicos com escala
  publicada; senão registra `next_month_not_published` e não grava nada. Assim o lembrete de turno do
  dia 1 sai na noite anterior; a deduplicação por técnico/dia garante um envio só.
- **Planilha de horas:** ao carregar, linhas cujas horas são o intervalo bruto (saída − entrada, sem
  o almoço) disparam o modal "Deseja adicionar o desconto de 1h de almoço para todos os técnicos?". Sim
  desconta 1h dessas linhas; Não mantém como está.
- **"Data de separação do laudo":** esclarecido com a cliente — ela pedia usar o laudo em vez do
  Concluído, que é o que já é feito.

## Prevenção (2026-10-06, madrugada)

- **Escala sem dados no Porto não apaga a do sistema:** se um técnico não tem nenhuma escala no Porto
  no mês (licença, dono da conta etc.), a reimportação diária deixa as linhas dele como estão
  (`no_escala_on_porto`). Antes, apagava toda a escala futura dele no sistema e não colocava nada.
- **Execução automática × manual:** `porto_sync_log.run_trigger` ('auto' | 'manual'). O agendador
  do worker (ao reiniciar) e o "Fim do expediente" só consideram execuções automáticas — um "Rodar
  agora" à tarde não conta mais como a importação da noite (antes: a mensagem saía com horas parciais
  e bloqueava o envio certo; e um reinício podia pular a importação do dia).
- **Verificações de saúde** em cada execução, gravadas no histórico (coluna de erro, com "Atenção:")
  e no resultado (`warnings`):
  - horas: lista de socorristas vazia; nenhum socorrista casa com técnico ativo; técnico ativo fora da
    lista; busca sem nenhum serviço no período; coluna de status não reconhecida; nome de socorrista
    fora da lista ou ambíguo; **socorrista com serviços no Porto e sem técnico ativo no sistema**;
    3+ serviços que não abriram; 3+ laudos ilegíveis; dias com horas fora do plausível; execução
    interrompida por tempo;
  - escala: lista vazia; nenhum técnico com escala no mês; escala de técnico que não abriu.
- **Alerta por WhatsApp para a empresa** (Configurações → "WhatsApp para alertas do robô", opcional,
  `lib/porto-alerts.ts`): o worker avisa quando uma execução automática da organização falha ou termina
  com avisos. Sai pela instância de WhatsApp da própria empresa, independente do liga/desliga das
  notificações. Sem WhatsApp conectado, o alerta não sai (só no log).
- **Alertas para o dono** (`lib/platform/alerts.ts`, tabela `platform_alerts`, instância
  `nextrotta-alertas`): mudança de tela do Porto (um alerta por noite, com quantas e quais organizações
  foram afetadas), execução travada há mais de 2h, fila noturna que não terminou até as 06:00 e
  problemas da VPS. Cada incidente alerta uma vez (chave única), inclusive depois de reiniciar o worker.
- Mensagens de erro inesperado agora trazem o erro de verdade (até 200 caracteres), para o histórico
  e o alerta servirem de diagnóstico.
- **VPS:** cada build deixa ~2,4 GB de imagem e cache. A limpeza fica com o agente da VPS do NextRotta
  (`docs/saas/vps.md`); os containers rodam com rotação de log (`--log-opt max-size=20m --log-opt max-file=5`).

- **Mudança de tela no Porto** (`lib/porto-layout.ts`): iframe que não aparece, busca que ignora o
  período, calendário no mês errado (`PortoLayoutError`) e timeout do Playwright depois do login
  marcam a execução com `porto_sync_log.layout_suspect`, assim como os avisos de lista vazia, busca
  sem serviços, status não reconhecido, ≥3 serviços/laudos que não abriram e escala que não abriu
  para ninguém. A mudança de tela é problema da plataforma (todas as organizações falham juntas): vai
  um alerta só para o dono, e cada organização vê o aviso na Config. Porto dela até a próxima execução limpa.
- **VPS fora do ar** (`lib/system-status.ts`, `/api/system-status`): a cada 2 min (cache de 60s) o app
  pergunta ao `/health` do worker (sem consultar o banco; sem resposta = fora) e se o servidor
  do WhatsApp responde; o admin vê "Módulo(s) … em manutenção" no topo de toda tela, só para os módulos
  que o plano dele tem. As ações do Porto na tela respondem "Módulo Porto em manutenção".

Riscos que continuam (sem como prevenir só pelo código): worker/VPS fora do ar (nenhum alerta por
WhatsApp sai, porque a Evolution está na mesma VPS — só o aviso na tela); WhatsApp desconectado (alertas e notificações não saem);
sessão do Porto expirando no meio de uma execução muito longa (os dias que falharem ficam para a
próxima execução); serviço com "Data Comb." diferente do dia real de execução (as horas contam no
dia combinado).

## Quem manda na escala (decisão do dono do produto, 2026-10-06)

- **Automação do Porto ligada:** o Porto manda. A escala é reimportada toda madrugada (de hoje até o
  fim do mês) e substitui o que foi montado no sistema; o "Montar escala" mantém os dias importados do
  Porto e avisa isso na mensagem ao salvar.
- **Automação desligada:** o "Montar escala" manda. Ele pode substituir também os dias que vieram do
  Porto (`replaceGeneratedScheduleRows` com `portoAutomationEnabled: false`).
- Nos dois casos, dias concluídos e apontamentos manuais nunca são substituídos.

## Fila do worker (NextRotta, várias organizações na mesma VPS)

- **Horário por organização:** cada organização entra na fila no horário de importação de horas das
  Configurações dela (`portoHoursImportTime`, Brasília). Um tick por minuto (`worker/porto-queue.ts`)
  verifica o que venceu, com recuperação de até 60 min se o worker estava fora no horário. Ao reiniciar,
  o que já rodou hoje (execuções automáticas em `porto_sync_log`) não é repetido.
- **Escala depois das horas:** a escala da organização entra na fila quando as horas dela terminam (com
  qualquer resultado). O horário de escala das Configurações só vale quando as horas não rodaram (sem
  escala automática nas últimas 12h).
- **Navegadores ao mesmo tempo:** no máximo `porto.maxBrowsers` (configurações da plataforma, padrão
  2, máximo 4). Medido na VPS (2 núcleos, 12 GB, sem swap): mais navegadores arriscam a memória (o
  Linux mataria processos, inclusive o WhatsApp e o worker do sistema original), deixam tudo mais lento
  (falsos alertas de "tela mudou") e fazem muitos logins do mesmo IP ao mesmo tempo.
- **Ordem que gira:** organizações que vencem juntas são ordenadas por um hash da noite, para não ser
  sempre a mesma a ficar por último.
- **Pedidos da tela** esperam até 20 s por um navegador livre; depois respondem 409 "o robô está
  ocupado com as importações de outras empresas".
- **Falha isolada:** a falha de uma organização nunca para as outras.
- **Esperar na fila não é "rodar":** a trava da organização é tomada antes de esperar um navegador livre, mas
  o relógio da execução (`startedAt`, usado pelo alerta de "execução travada") só começa quando o navegador é
  obtido (`portoLockInfo()` devolve `running: false` e `heldForMs: 0` para quem ainda espera). Com mais
  organizações do que navegadores ninguém é anunciado como travado só por estar na fila.
- **Reinício do worker** (`loadLastRuns`): as horas só contam como "já rodou hoje" se houve uma execução
  **automática, terminada sem erro** (`status NOT IN ('error','running')`) que começou **no horário de horas
  da organização ou depois**. Log `running` (deploy no meio da importação), erro, execução manual ou uma
  anterior ao horário configurado não impedem a nova execução dentro da janela de recuperação.
- **Plano:** organização suspensa ou sem o recurso `porto` não entra na fila; só as execuções que gravam
  (automáticas e "Rodar agora") contam no limite `portoRunsMonth` do plano; testes e execuções puladas não.
- **Painel do dono:** `GET /api/platform/porto-queue` mostra navegadores ocupados, execuções em
  andamento e na fila; `getNightCapacity` (Operação → VPS) mostra a ocupação da janela 23:00–06:00.

## Horários livres (07/10/2026, portado em 23/10/2026)

O admin pode pôr a importação de horas e a de escala da organização em qualquer horário (Configurações).
Para nenhum horário gerar dado errado:

- **Advertência com prazo** (`portoLaudoGraceHours`, padrão 6h, de 0 a 48, contado do Concluído; coluna
  `porto_laudo_grace_hours`, migração `0026`): se o robô passa antes do prazo, o dia é gravado pelo
  Concluído **sem** advertência e com `LAUDO PENDENTE: serviço X concluído sem laudo; prazo para preencher
  até DD/MM HH:MM` na observação (o registro leva `laudoPendingUntil`). Esses dias são recalculados em toda
  execução (`getPendingLaudoDates`, mesmo fora da janela de reprocessamento, e a busca recua até o dia
  pendente mais antigo, no máximo 14 dias: `getOldestPendingLaudoDate`). Laudo preenchido → dia normal;
  prazo vencido sem laudo → advertência, que **nunca** sai. A conta do prazo está em `lib/porto-laudo.ts`
  (`laudoGraceWindow`), os marcadores em `lib/organization-settings.ts`
  (`PORTO_WARNING_MARKER`, `PORTO_LAUDO_PENDING_MARKER`). Tudo filtrado pela organização.
- **Dias reprocessados: de 1 a 7** (antes 0–7; a migração leva 0 para 1) — o dia de hoje, importado antes
  de acabar, é completado na execução seguinte.
- **"Fim do expediente" fala do dia já encerrado**: o dia "acaba" 2h depois do fim do turno padrão da
  organização (`endOfWorkDayMinutes`, 18:00 → 20:00). Importação antes disso (madrugada, manhã) manda a
  mensagem do dia anterior (`dailyHoursDay`, e o período da mensagem é esse dia); o envio pelo horário
  configurado só sai depois de uma importação **automática** da organização que começou após o fim daquele
  dia (`dailyHoursReady`). Um "Rodar agora" ou uma importação anterior não liberam a mensagem.
- **Lembretes que leem a escala** ("Horário do dia seguinte", "Folga"): se a importação da escala da
  organização está marcada para antes do lembrete e ainda não terminou (ex.: esperando a importação de
  horas, ou a vez na fila), o lembrete espera até 60 min por ela (`scheduleImportPending`).

## Tentativas automáticas (13/10/2026, portado em 23/10/2026)

O portal do Prestador fica lento ou fora do ar em rajadas (um login estourou 2 min às 01:39 de 13/10 e, nas
noites de 08/10 e 10/10, a busca do mês demorou mais de 20s e virou o falso aviso "o portal pode ter
mudado"). Por isso a execução automática (não o teste manual) tenta de novo:

- **Quando** (`worker/job-retry.ts`): erro da execução (login que não abriu, busca que não terminou,
  exceção como falha de banco), resultado com `layout_suspect`, ou serviços que não puderam ser abertos
  (`service_detail_failed`). **Não** repete login rejeitado ("Login no Porto falhou…", já são 2 tentativas
  por execução e repetir senha errada trava a conta) nem credenciais ausentes.
- **Quanto**: 3 tentativas no total, com 5 e 15 minutos de espera. **No NextRotta** (`worker/porto-queue.ts`)
  cada tentativa pega a trava do Porto da organização e um navegador **por tentativa**: a espera entre elas
  não segura nem a trava nem navegador, e a nova tentativa entra no fim da fila (FIFO), atrás de quem já
  esperava — nunca fura a vez das outras organizações. Cada tentativa gera sua linha no histórico.
- **Alerta**: só depois da última tentativa, informando quantas foram feitas ("Já foram feitas N tentativas
  automáticas."). Mudança de tela continua sendo um alerta único ao dono, depois das tentativas.
- **Reinício do worker**: uma execução do dia que terminou em `error` ou ficou `running` (worker parado no
  meio, por exemplo num deploy) **não** conta como feita; roda de novo enquanto a janela de recuperação
  depois do horário configurado ainda estiver aberta.
- **Login** (`openLoginPage`): se o `networkidle` não chega em 30s mas o campo `#cpf` já está visível,
  segue em frente; se a página não abriu, lança "Não foi possível abrir a página de login do Porto.".
- **Busca de serviços** (`runServiceSearch`): espera `domcontentloaded` por até 60 s. Estouro vira "A busca
  de serviços do Porto não terminou em tempo hábil. Tente novamente." e resposta ausente ou não-OK vira "A
  busca de serviços do Porto falhou (HTTP …). Tente novamente." — nenhum dos dois é classificado como
  mudança de layout (`isPortoLayoutError`).

Testes (`PW_CHANNEL=chrome` usa o Chrome instalado quando o Chromium do worker não está):
`node scripts/test-porto-retry.cjs` (regras), `scripts/test-porto-queue-retry.cjs` (retentativa na fila
com várias organizações), `scripts/test-porto-laudo.cjs` (prazo do laudo, configurações, dia do "Fim do
expediente"), `scripts/test-porto-login.cjs` (~40s) e `scripts/test-porto-service-search.cjs` (~25s).
