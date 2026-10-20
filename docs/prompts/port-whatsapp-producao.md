# Portar as melhorias do WhatsApp para a produção (Central Operacional)

Roteiro para uma sessão do Claude Code aberta **dentro de** `C:\Users\iluuc\Documents\sistema-de-gestao-tecnica`.
A fonte é o NextRotta (`C:\Users\iluuc\Documents\sistema-operacional`): ler arquivos de lá para copiar é permitido, alterar não.

A produção atende **uma única empresa**: não tem `organization_id`, planos, recursos, auditoria, exclusão lógica nem subdomínio.
Portar só o comportamento do WhatsApp; tudo o que é do SaaS fica de fora.

## O que muda para o usuário

1. **Conectar o WhatsApp pela tela:** na aba Conexão, um cartão mostra o estado da instância (conectado com número e nome do perfil / aguardando leitura / desconectado), gera o QR Code (renovado a cada 30 s e verificado a cada 4 s até a leitura, com código de pareamento quando a Evolution devolve um), tem "Verificar conexão" e "Trocar número" (logout com confirmação). Hoje a tela só mostra as variáveis do `.env` e testa a conexão.
2. **Chave geral da automação no cabeçalho** da página (no lugar do switch dentro da aba Conexão). Ao ligar, abre um diálogo que pergunta quais notificações ativar ("Ativar todas" ou "Ativar selecionadas"), para a automação nunca ficar ligada com todas as notificações desligadas.
3. **Área de teste:** um switch "Modo teste" (ligado = todas as notificações vão para o número de teste) separado do número em si. O número digitado continua lá com o modo desligado e serve para a "Mensagem de teste", que só pode ser enviada com o WhatsApp conectado.

## Arquivos (origem → destino, com adaptações)

| NextRotta | Produção | Adaptação |
|---|---|---|
| `lib/whatsapp/evolution.ts` | mesmo caminho | Copiar o bloco "Instance lifecycle" do fim (`EvolutionServer`, `EvolutionQrCode`, `EvolutionInstanceInfo`, `readQr`, `failure`, `create/fetch/connect/logoutEvolutionInstance`). Ajustar o comentário do topo. |
| `lib/whatsapp/instance.ts` | **novo** | Reescrever para uma instância só (ver abaixo). |
| `app/api/whatsapp/instance/route.ts` e `instance/qrcode/route.ts` | **novos** | Sem `blockUnlessFeature` e sem `organizationId`; `requireWhatsAppAdmin` igual ao da produção (`verifyAuth`). Em vez de `PlatformError`, uma classe de erro local com `status` (ou devolver `{ error, status }`). |
| `app/admin/whatsapp/instance-card.tsx` | **novo** | Copiar. Trocar "Fale com o suporte do NextRotta" por uma mensagem dizendo que faltam `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` no ambiente; o texto "nome do subdomínio" não se aplica. |
| `app/admin/whatsapp/enable-automation-dialog.tsx` | **novo** | Copiar sem mudanças (a produção já tem `components/ui/dialog` e `checkbox`). |
| `app/admin/whatsapp/connection-panel.tsx` | substituir | Copiar a versão nova, **mas manter o campo "Link do sistema" (`appUrl`)**: na produção a variável `{link}` da folha fechada depende dele (não há subdomínio). Texto de teste: "Mensagem de teste da Central Operacional ✅". |
| `app/admin/whatsapp/page.tsx` | substituir | Chave geral no cabeçalho + `EnableAutomationDialog`; remover o estado `connection`/`EnvConnection`. |
| `app/admin/whatsapp/types.ts` | substituir | Remover `EnvConnection`. |
| `app/api/whatsapp/config/route.ts` | ajustar | Parar de devolver `connection` (URL e chave do servidor não saem do backend). |
| `docs/whatsapp-notificacoes.md` | ajustar | Descrever o cartão de conexão e o modo teste, sem falar em organizações. |

**Não portar:** `organization_id` em queries, `checkLimit`/`blockUnlessFeature`/`featureAllowedSql`, `recordAudit`, `deleted_at`, `organizationPublicUrl` (link da folha), `getOrganizationSettings` (manter `STANDARD_HOURS_PER_MONTH`), `listOrganizationsWithWhatsApp` e o laço por organização do worker, as migrações `0012`/`0013` e a troca de `ensureWhatsAppSchema()` por migração. `notifications-panel.tsx`, `history-panel.tsx`, `phone.ts`, `notification-types.ts` e `components/phone-input.tsx` já são iguais nos dois (o único detalhe é o exemplo do `{link}`, que na produção deve continuar como está).

## `lib/whatsapp/instance.ts` na produção

- Nome da instância = `EVOLUTION_INSTANCE` (a produção já usa essa variável e a instância já existe e está conectada). Servidor = `EVOLUTION_API_URL` + `EVOLUTION_API_KEY`. Nada novo no banco: o estado é sempre lido ao vivo da Evolution.
- `getInstanceStatus()`: `serverConfigured` = as três variáveis definidas; `fetchEvolutionInstance` → `created`, `state` (`open`→connected, `connecting`, `close`→disconnected, senão unknown), `number`, `profileName`. Sem a parte que limpa `instance_name` no banco.
- `createInstance()`: só quando a instância não existe no servidor; cria com o nome de `EVOLUTION_INSTANCE` e devolve o primeiro QR Code. Se já existir, apenas devolve o estado + QR (nunca recriar).
- `getQrCode()` e `disconnectInstance()`: iguais ao NextRotta, usando o nome do env.
- Registrar no `console` (não há auditoria) quando alguém cria ou desconecta.

## Cuidados

- **"Trocar número" desconecta o WhatsApp que está em uso pelo cliente.** Não clicar em teste. Validar a tela com uma instância de teste: apontar `EVOLUTION_INSTANCE` no `.env.local` para um nome novo (ex.: `central-teste`) e conectar um celular de teste. Nunca rodar contra a instância de produção.
- Conferir no `.env.local` qual banco está apontado antes de abrir a tela (o `ensureWhatsAppSchema()` roda na primeira requisição).
- Verificar com `npx tsc --noEmit` e abrir `/admin/whatsapp` no navegador: estados conectado / sem instância / QR Code, diálogo da chave geral, modo teste ligado e desligado, mensagem de teste.
- Commit e push só com a autorização do dono do projeto (é o repositório em produção).
