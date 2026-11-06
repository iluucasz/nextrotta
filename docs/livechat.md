# Livechat (chat ao vivo e WhatsApp oficial)

Uma caixa de entrada só, no painel do dono: **Reports → Livechat**, no formato do WhatsApp (lista de conversas à esquerda,
conversa à direita, balões, não lidas). Duas origens:

- **Chat ao vivo (`web`)** — para urgências. É um jeito de abrir o atendimento, escolhido na hora de criar o chamado (ver "Chat
  ao vivo × chamado por escrito"). O chamado vai com prioridade alta e a conversa já nasce aberta e **não lida** no Livechat, com a
  descrição como primeira mensagem do cliente; o chamado do painel aponta para o Livechat. O dono recebe um alerta no WhatsApp de
  alertas (no máximo um a cada 10 minutos por conversa).
- **WhatsApp oficial (`whatsapp`)** — o número oficial (instância `nextrotta-suporte`, separada da `nextrotta-alertas`). O que
  chega nele aparece no Livechat, o que o dono responde no painel sai por ele, e o que o dono digita no próprio celular também é
  guardado. Número de técnico ou empresa conhecidos vem com o nome e a empresa.

## Chat ao vivo × chamado por escrito

São dois tipos de atendimento separados, como Omni-Channel e Case no Salesforce (coluna `bug_reports.channel`: `chat` ou `case`,
migração `0042`). Ao abrir um chamado de suporte o cliente escolhe **Chamado por escrito** (padrão) ou **Chat ao vivo (urgente)**.

| | Chamado por escrito (`case`) | Chat ao vivo (`chat`) |
|---|---|---|
| Cliente | Descrição, conversa por escrito e "Responder" na página do chamado; **sem** janela de chat | Só a janela do chat; **sem** descrição separada nem "Responder" (a descrição é a primeira mensagem) |
| Dono | Reports (listas Todos/Suporte/Bugs/Sugestões), conversa e notas no chamado | **Só no Livechat**; fora das listas de Reports; o chamado mostra um aviso e o botão "Abrir no Livechat" |
| Encerra | O dono conclui o chamado (Estado → Resolvido) | O dono encerra no Livechat ou o cliente clica em "Encerrar chat"; isso conclui o chamado |
| Mensagem final | "Olá! Seu chamado #N foi encerrado… é só abrir um novo chamado" na conversa do chamado + aviso no sistema | "Obrigado pelo seu contato!… inicie um novo chat ao vivo ou abra um chamado" no chat (e no WhatsApp, se houver número) |
| Depois de encerrado | Se o cliente escrever de novo, reabre | **Não reabre pelo cliente**: aparece "Este chat foi encerrado" e o botão "Iniciar novo chat ao vivo" (`?novo=chat`) |

A mensagem final é sempre mostrada ao dono num diálogo, já preenchida, para **editar ou encerrar sem mensagem** (`closingMessage`
e `thanks`; textos padrão em `lib/livechat/rules.ts`: `chatClosingMessage`, `caseClosingMessage`). Um chat encerrado também pode ser
reaberto pelo dono ("Reabrir"), o que reabre o chamado. A API recusa o que pertence ao outro tipo: resposta escrita num chat (só nota
interna) e mensagem de chat num chamado por escrito. Chamados antigos que já tinham chat viraram `chat` na migração.

**Espelho no WhatsApp do cliente (urgentes).** Ao marcar "urgente" o cliente pode informar o WhatsApp dele (opcional; lembrado no
navegador; dá para informar, alterar ou remover depois na janela do chat). Com o número: as respostas que o dono dá no Livechat vão
também para esse WhatsApp pelo número oficial, como "*Suporte NextRotta* — chamado #1049" + o texto (o dono pode desmarcar "Enviar
também no WhatsApp do cliente" numa resposta); e o que o cliente escrever de volta no WhatsApp (ou o que o dono digitar no próprio
celular) cai na mesma conversa, mesmo se o número vier sem o nono dígito. O eco do que o painel enviou é reconhecido e não duplica.
Se o WhatsApp falhar, a resposta fica no chat e o painel avisa. **Nada sai sozinho:** não há mensagem automática ao cliente; só vai o
que o dono escreve, e ele vê o número na conversa (o número é digitado pelo cliente, por isso o envio é sempre ato do dono).
Sem número, ou sem o número oficial conectado, o chat segue só no sistema.

## Primeira mensagem e aviso ao dono

Ao abrir um chat ao vivo, a equipe já "fala primeiro": "Olá, Carla! Recebemos o seu chamado urgente #1227. Em instantes um de nossos
atendentes vai falar com você… pode ir adiantando os detalhes… é só anexar aqui no chat" (`chatWelcomeMessage`). Ela entra no chat na
hora (sem mexer na prévia nem nas não lidas do Livechat) e, se o cliente informou o WhatsApp, vai também por lá com o texto do
WhatsApp, **depois da resposta** da criação (usa `after()`; fora de uma requisição, como nos testes, roda na hora). Para ninguém
usar o chat para escrever a desconhecidos, no máximo **5 boas-vindas por hora por empresa** vão para um número digitado pelo
cliente; as demais ficam só no chat. As respostas que o dono dá continuam sendo atos dele.

O aviso ao dono sai pelo WhatsApp de alertas (Configurações → Alertas e robô) quando ele está configurado. Quando não está, sai pelo
**próprio número oficial, para ele mesmo** ("🚨 *NextRotta — Livechat (urgente)*", empresa, chamado, o começo da mensagem e o link do
Livechat), que aparece no celular que guarda o número. O eco dessa mensagem no webhook é ignorado (mensagens do número oficial para
ele mesmo nunca viram conversa). Uma vez por conversa e janela de 10 minutos. Falta provar com o número real que o WhatsApp entrega
uma mensagem para o próprio número (foi testado só com o Evolution simulado).

## Mensagens automáticas

Reports → **Mensagens automáticas** (só admins editam; o atendente não vê a aba). Cada mensagem tem liga/desliga, texto com variáveis (`{nome}`, `{chamado}`, `{horario}`; as que faltam somem com a pontuação), prévia e "Restaurar padrão". Só o que o admin mudou fica no banco (`livechat_auto_messages`, migração `0045`; `NULL` = padrão do código em `lib/livechat/auto-messages.ts`); as mensagens enviadas ficam marcadas (`livechat_messages.auto_key`, "Mensagem automática" no chat).

| Mensagem | Quando | Padrão |
|---|---|---|
| Chat começa (no sistema) | cliente abre um chat ao vivo | ligada (já existia) |
| Chat começa (cópia no WhatsApp do cliente) | o mesmo, no número que o cliente informou | ligada (já existia) |
| Chat termina (no sistema) / Conversa do WhatsApp termina | ao encerrar (o painel traz o texto pronto para editar) | ligadas (já existiam) |
| Chamado por escrito concluído | ao concluir Suporte/Bug/Sugestão | ligada (já existia) |
| **Primeira mensagem no WhatsApp** | alguém escreve para o número oficial sem conversa aberta | **desligada** |
| **Fora do horário** | mensagem no WhatsApp fora do horário (Brasília; padrão seg–sex 9h–18h, editável no cartão) | **desligada** |
| **Foto, áudio ou arquivo** | chega mídia no WhatsApp (o painel só mostra aviso) | **desligada** |

Regras de envio no WhatsApp (`autoReplyToInbound` em `lib/livechat/whatsapp.ts`, chamada pelo webhook): só responde ao que o cliente escreveu (nunca à equipe, nunca a quem está num chat do sistema); a saudação vai uma vez por conversa; fora do horário o aviso **substitui** a saudação (no máximo 1 a cada 6 h por conversa); o aviso de arquivo, 1 por hora por conversa; teto de 40 automáticas por hora no total (laço com outro robô nunca dispara); se o Evolution falhar nada é registrado como enviado. A resposta automática não zera o "não lido" nem muda a prévia da lista. Desligada, uma mensagem não é enviada (o painel não preenche o texto de encerramento).

Teste: `node scripts/test-livechat-auto.cjs`.

## Anexos

O cliente pode **anexar um arquivo (clipe) ou colar um print (Ctrl+V)** no chat; o dono também anexa nas respostas. Vale para o chat ao
vivo (não para o chamado por escrito). Aceita imagem (png, jpg, webp, gif), PDF, txt, csv, zip, doc/docx e xls/xlsx, **até 4 MB** (a Vercel
limita o corpo de uma requisição a 4,5 MB); nada de HTML, SVG ou executável (`ATTACHMENT_TYPES`, validado também no servidor).

- **Onde fica:** no armazenamento privado, na pasta da própria empresa (`chat/<empresa>/<conversa>/…`, `livechat_attachments`,
  migração `0043`), servido só por rotas que conferem quem pede (`/api/support/livechat/<chamado>/files/<id>` para a empresa do
  chamado, `/api/platform/livechat/files/<id>` para o dono; tipo vindo do nosso registro, `nosniff`, só imagem/PDF/txt aparecem na
  tela, o resto baixa).
- **Cota:** o que o **cliente** envia conta no armazenamento do plano dele (a view `organization_files` já alimenta limites, capacidade e
  custos; a mensagem de limite cheio é a de sempre). O que a **equipe** envia fica na pasta dele mas **não é cobrado** (`counted = false`).
- **WhatsApp:** o arquivo que o dono envia no Livechat vai também ao WhatsApp do cliente (imagem ou documento, com a legenda "*Suporte
  NextRotta* — chamado #N"), e numa conversa de WhatsApp só é guardado se o WhatsApp aceitar. **O que o cliente manda pelo WhatsApp
  (foto, áudio, documento) continua chegando como aviso** ("📷 Imagem"); baixar a mídia do WhatsApp para o armazenamento é o próximo passo.
- Backup: `livechat_attachments` está em `BACKUP_EXCLUDED` (registros da plataforma), como a conversa.

## Janela do chat do cliente

Usa a altura da tela (`calc(100dvh - 33rem)`, entre 18 e 44 rem), então cabe sem rolar a página em telas de 900 px ou mais e é
confortável num monitor grande; a conversa fica centralizada (até 48 rem) em telas largas; no celular os botões e as bolhas se
ajustam e a página **não rola para o lado** (a coluna da página precisa de `min-w-0`: o cabeçalho do chat não quebra linha e somava
~480 px ao mínimo da coluna).

O dono lê e responde sem abrir o WhatsApp Web. Escrever numa conversa encerrada a reabre; uma mensagem do cliente também.

## Conectar o número

Reports → Livechat → **Conectar WhatsApp**. Cria a instância `nextrotta-suporte` no servidor Evolution (se não existir), aponta o
webhook dela para `https://<ROOT_DOMAIN>/api/webhooks/evolution` e mostra o QR Code; a janela fecha sozinha ao conectar.
O token do webhook é derivado de `JWT_SECRET` (`webhookToken()`, nada novo para configurar). Em desenvolvimento
(`*.localhost`) não há endereço público: dá para conectar, mas as mensagens só chegam no site publicado.

**O Evolution do NextRotta** roda na VPS (ver `docs/saas/vps.md`) em `https://nextrotta-infra.duckdns.org:8443/nextrotta-evolution`, com a
interface web (manager) em `https://nextrotta-infra.duckdns.org:8443/manager/`. A instância `nextrotta-suporte` está **conectada** ao
número oficial e com o webhook em `https://nextrotta.app/api/webhooks/evolution` (o token vem do `JWT_SECRET` de produção).
`EVOLUTION_API_URL`/`EVOLUTION_API_KEY` já estão na Vercel e no worker; o `.env` local de desenvolvimento ainda aponta para o Evolution do
`essencialcentro`, que **não deve ser usado**. A criação da instância, o QR Code e a conexão foram feitos de verdade; **ainda não provados
com mensagens reais**: o recebimento (um cliente escrevendo para o número), a resposta pelo Livechat e o espelho de um chamado urgente
(só testados com mensagens simuladas).

## O que há de código

- Migração `0041_livechat.sql`: `livechat_conversations` e `livechat_messages` (nada é apagado; `livechat_conversations` está em
  `BACKUP_EXCLUDED`, são registros da plataforma e não voltam com a restauração de uma empresa).
- `lib/livechat/rules.ts` (puro: leitura do webhook do Evolution, prévia, limite, comparação de telefones), `store.ts` (banco),
  `whatsapp.ts` (instância, webhook, envio). `evolution.ts` ganhou `setEvolutionWebhook` e o id da mensagem enviada.
- Cliente: `GET/POST /api/support/livechat/[ticketId]` (o administrador vê qualquer chamado da empresa, os outros só os seus),
  `components/livechat/customer-chat.tsx` na página do chamado (`?chat=1` abre o chat). Liberado também com a empresa bloqueada
  (é como ela pede ajuda para voltar).
- Dono: `/api/platform/livechat` (lista e não lidas), `/[id]` (ler, responder, encerrar), `/whatsapp` (conectar, desconectar),
  `components/platform/livechat.tsx` + `livechat.css`; a aba Livechat mostra as não lidas e o título da janela também.
- Webhook: `POST /api/webhooks/evolution` (token no cabeçalho `x-webhook-token`; só a instância `nextrotta-suporte`; grupos e
  status são ignorados; a mesma mensagem duas vezes conta uma).

## Limites

- Só texto. Foto, áudio, documento e figurinha chegam como aviso ("📷 Imagem") e se abrem no WhatsApp do número oficial.
- Atualização por consulta periódica (sem WebSocket, para não pesar na Vercel): a janela do cliente consulta a cada 4 s com o chat
  aberto (20 s depois de encerrado) e só com a aba visível; o painel do dono, a lista a cada 6 s e a conversa aberta a cada 3 s.
- Sem sinal de "digitando" nem de lida/entregue.

Teste: `node scripts/test-livechat.cjs` (regras e fluxo no banco com empresa de teste própria).
