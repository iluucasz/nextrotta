# Livechat (chat ao vivo e WhatsApp oficial)

Uma caixa de entrada só, no painel do dono: **Reports → Livechat**, no formato do WhatsApp (lista de conversas à esquerda,
conversa à direita, balões, não lidas). Duas origens:

- **Chat do chamado (`web`)** — para urgências. Ao abrir um chamado de suporte com **"É urgente"**, o chamado vai com prioridade
  alta e a conversa já nasce aberta, **não lida**, no Livechat (com "Urgente: <título>"), antes de o cliente escrever; o chamado do
  painel ganha o botão **Abrir no Livechat**. Sem "urgente", o cliente pode clicar em **Iniciar chat ao vivo** na página do chamado e
  a conversa nasce com a primeira mensagem. Está ligada ao chamado e só existe uma aberta por chamado. Só chamados de suporte
  podem ser urgentes. O dono recebe um alerta no WhatsApp de alertas (no máximo um a cada 10 minutos por conversa).
- **WhatsApp oficial (`whatsapp`)** — o número oficial (instância `nextrotta-suporte`, separada da `nextrotta-alertas`). O que
  chega nele aparece no Livechat, o que o dono responde no painel sai por ele, e o que o dono digita no próprio celular também é
  guardado. Número de técnico ou empresa conhecidos vem com o nome e a empresa.

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

**O Evolution do NextRotta** foi criado em 05/11/2026 na VPS (ver `docs/saas/vps.md`): `nextrotta-evolution-api`, em
`https://nextrotta-infra.duckdns.org:8443/nextrotta-evolution`. **Falta o dono pôr no `.env` e na Vercel** `EVOLUTION_API_URL` (esse
endereço) e `EVOLUTION_API_KEY` (o `AUTHENTICATION_API_KEY` de `/opt/nextrotta/evolution/evolution.env` na VPS). Hoje o `.env`
ainda aponta para `evolution-whatsapp.duckdns.org`, que é do projeto `essencialcentro`: por isso a chave recebe **401**, e **esse
servidor não deve ser usado**. Sem a troca, o Livechat mostra "O servidor do WhatsApp recusou a chave" e só o chat dos chamados
funciona. Testado contra o Evolution novo: a criação da instância `nextrotta-suporte` e o QR Code (a instância já existe, sem número
conectado). Nunca testados com um número de verdade: o recebimento (webhook, só com mensagens simuladas) e o envio.

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
