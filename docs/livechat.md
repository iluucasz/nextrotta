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
