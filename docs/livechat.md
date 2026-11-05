# Livechat (chat ao vivo e WhatsApp oficial)

Uma caixa de entrada só, no painel do dono: **Reports → Livechat**, no formato do WhatsApp (lista de conversas à esquerda,
conversa à direita, balões, não lidas). Duas origens:

- **Chat do chamado (`web`)** — para urgências. O cliente marca "É urgente" ao abrir um chamado de suporte (ou clica em
  **Iniciar chat ao vivo** na página do chamado) e conversa ali. A conversa nasce com a primeira mensagem, é ligada ao chamado e
  só existe uma aberta por chamado. O dono recebe um alerta no WhatsApp de alertas (no máximo um a cada 10 minutos por conversa).
- **WhatsApp oficial (`whatsapp`)** — o número oficial (instância `nextrotta-suporte`, separada da `nextrotta-alertas`). O que
  chega nele aparece no Livechat, o que o dono responde no painel sai por ele, e o que o dono digita no próprio celular também é
  guardado. Número de técnico ou empresa conhecidos vem com o nome e a empresa.

O dono lê e responde sem abrir o WhatsApp Web. Escrever numa conversa encerrada a reabre; uma mensagem do cliente também.

## Conectar o número

Reports → Livechat → **Conectar WhatsApp**. Cria a instância `nextrotta-suporte` no servidor Evolution (se não existir), aponta o
webhook dela para `https://<ROOT_DOMAIN>/api/webhooks/evolution` e mostra o QR Code; a janela fecha sozinha ao conectar.
O token do webhook é derivado de `JWT_SECRET` (`webhookToken()`, nada novo para configurar). Em desenvolvimento
(`*.localhost`) não há endereço público: dá para conectar, mas as mensagens só chegam no site publicado.

**Pendência (05/11/2026):** a `EVOLUTION_API_KEY` do `.env` recebe **401** do servidor `evolution-whatsapp.duckdns.org` (o
`docs/saas/vps.md` registra que a chave global foi trocada na reconstrução do Evolution). Enquanto a chave certa não estiver no
`.env`, na Vercel e no `worker.env`, o Livechat mostra "O servidor do WhatsApp recusou a chave" e só o chat dos chamados
funciona. O recebimento e o envio pelo WhatsApp foram testados só com mensagens simuladas do webhook, nunca com o Evolution real.

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
