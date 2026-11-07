# Notificações

O sino do sistema da empresa (barra de cima, só para o admin) mostra dois tipos de aviso:

- **Da empresa** (`organization_id` preenchido): o que está acontecendo com ela. Sai sozinho, de eventos do sistema.
- **Do NextRotta** (`organization_id` nulo): avisos gerais da plataforma, publicados pelo dono para todas as empresas ou para uma só.

## Página e importância

- **Página** `/admin/notificacoes` (menu Empresa → Notificações; o sino tem "Ver todas"): contadores por importância que filtram a lista, filtro por área, lista agrupada por dia, "Marcar todas como lidas", **Limpar** (uma, ou todas as que o filtro mostra, com confirmação) e a aba **Limpas** para ver e restaurar. Componentes em `components/notifications/`, rótulos em `lib/notification-meta.ts` (um lugar só: sino e página).
- **Importância** (`severity`): **Crítico** (`critical`: algo parou ou vence agora), **Atenção** (`warning`: precisa de uma olhada), **Concluído** (`success`: deu certo) e **Aviso** (`info`: só para saber). O texto de cada um fica atrás do "?" da página (`SEVERITY_HELP`).
- **Limpar** é por pessoa: `notification_reads.dismissed_at` (migração `0039`). Nada é apagado e a chave de repetição continua ocupada, então o mesmo evento não volta. API: `POST /api/notifications/clear` (`{ ids }` ou `{ all: true, severity?, kind?, scope? }`, e `restore: true` para trazer de volta); `GET /api/notifications` aceita `state`, `severity`, `kind`, `scope`, `limit`, `offset` e `summary=1` (contadores).

## Dados (migração `0029`)

- `notifications`: tipo (`kind`), importância (`info|success|warning|critical`), título (até 140), texto (até 1000), link interno (`href`, só caminhos do sistema), público (`admins` por padrão, ou `everyone`), validade (`expires_at`), `archived_at` (retirar), `dedupe_key`.
- `notification_reads`: uma linha por pessoa e notificação. A leitura é de cada pessoa, não da empresa.
- Nada é apagado: o dono **retira** um aviso (arquiva); a leitura é uma linha nova.
- **Chave de repetição** (`dedupe_key`): o mesmo evento não avisa a mesma empresa duas vezes (índice único parcial). Ex.: `billing:overdue:<cobrança>`.
- Uma empresa nova não vê o que foi publicado antes de ela existir (`created_at >= organizations.created_at`).

## Código

- `lib/notifications.ts`: `createNotification`, `notifyOrganization` (para usar dentro de outros fluxos: nunca quebra o fluxo), `listNotifications`, `countUnreadNotifications`, `markNotificationsRead`, `ensureScheduleReminder`, e as funções do dono (`listPlatformNotifications`, `archiveNotification`). Só imports relativos: o worker usa (`lib/porto-alerts.ts`).
- API da empresa: `GET /api/notifications` (`?check=1` ao abrir a página também confere a escala), `POST /api/notifications/read` (`{ ids }` ou `{ all: true }`). Liberadas no modo somente leitura (`middleware.ts`).
- API do dono: `GET/POST /api/platform/notifications`, `DELETE /api/platform/notifications/:id` (auditado: `notification.published`, `notification.archived`). Tela: Painel do dono → Notificações.
- Sino: `components/notifications-bell.tsx` (atualiza a cada 60 s e ao abrir).

## O que avisa sozinho

| Evento | Onde | Importância |
|---|---|---|
| Nova cobrança, pagamento confirmado, cobrança vencida | `lib/billing/billing.ts` (`notifyCharge`) | info, sucesso, crítica |
| Pagamento em atraso, acesso pausado, assinatura em dia | `evaluateBillingStatus`, `runBillingMaintenance` | crítica, crítica, sucesso |
| Resposta do suporte num chamado (sem notas internas) | `lib/platform/bugs.ts` (`addBugMessage`) | info |
| Técnico cadastrado | `app/api/technicians/route.ts` | concluído |
| Folha do mês anterior fechada para todos (uma por mês) | `checkPayroll` | concluído |
| Login do Porto funcionou (teste) e importação automática do dia concluída (uma por tarefa por dia) | `app/api/porto-config/test-login`, `notifyPortoSuccess` (worker) | concluído |
| Venda de peças concluída (paga) | `lib/parts/notices.ts` (`notifySalePaid`) | concluído |
| Venda de peças com problema no pagamento (some quando é paga) | `notifySaleProblem` | atenção |
| Peças no estoque mínimo; vendas esperando pagamento há mais de 24 h (uma por dia enquanto durar) | `checkParts` | atenção |
| Robô do Porto falhou ou terminou com avisos (1 por dia por problema; o texto é a frase de `describePortoError`, nunca o rastro técnico) | `lib/porto-alerts.ts` | atenção |
| Login do Porto não funciona (senha expirada ou trocada, CPF recusado): vem do teste de login ou da última execução e sai sozinho quando um teste ou uma execução volta a funcionar. Uma só entrada por dia, também quando o worker avisa (`porto:login:`) | `checkPortoLogin`, `lib/porto-alerts.ts` | crítica |
| Créditos de IA acabando / acabaram (1 por mês cada) | `lib/ai/assistant.ts` | atenção, crítica |
| A escala termina em menos de 7 dias, ou não existe (empresa sem Porto) | `ensureScheduleReminder` | atenção |
| Módulo Porto ou WhatsApp em manutenção (o servidor não responde). Sai do sino quando volta | `checkModules` | atenção |
| Folha do mês que terminou ainda sem fechar (a partir do dia 3; nomeia os técnicos e some quando todas fecham) | `checkPayroll` | atenção |
| WhatsApp da empresa desconectado (precisa ler o QR Code de novo) | `checkWhatsAppConnection` | atenção |
| Armazenamento do plano em 90% e cheio | `checkStorage` | atenção, crítica |
| Contas vencidas, contas que vencem em breve (prazo das Configurações) e categoria acima do orçamento do mês | `checkExpenses` | crítica, atenção |

As verificações de `lib/notification-checks.ts` (`runNotificationChecks`) rodam em `GET /api/notifications?check=1`: quando o admin abre uma página e a cada 5 minutos com o sino aberto na tela. Cada uma avisa uma vez (chave de repetição) e, quando a situação se resolve sozinha, arquiva o aviso (`resolveNotifications`). Não há mais faixa amarela de "módulo em manutenção": o aviso vai para o sino. Teste: `node scripts/test-notification-checks.cjs`.

Para avisar de algo novo: `await notifyOrganization(organizationId, { kind, severity, title, body, href, dedupeKey })`.

Teste: `node scripts/test-notifications.cjs` (usa o banco de desenvolvimento; cria uma empresa de teste e a deixa arquivada).

---

# Notificações da equipe (dono e atendentes)

A caixa de quem cuida da plataforma: o que acontece nas empresas e na própria NextRotta, sem precisar abrir cada empresa. Tela em **Painel → Notificações → "Alertas da equipe"** (a aba "Avisos aos clientes" é a tela antiga de publicar avisos no sino das empresas) e um **sino no cabeçalho** do painel com o número de não lidas (vermelho quando há algo crítico). Atendentes veem só o que é do atendimento.

## Dados (migração `0048`)

- `platform_notices`: assunto (`category`), importância (`severity`: Crítico, Atenção, Concluído, Aviso, os mesmos quatro das empresas), público (`audience`: `owner` = só admins; `staff` = admins e atendentes), título, texto, link do painel, empresa (ou nenhuma, quando é da plataforma), `dedupe_key`, `occurrences`, `last_seen_at` e `resolved_at`.
- **Chave de repetição enquanto aberto:** um problema que continua não avisa de novo (só soma `occurrences`); quando acaba é **resolvido** (`resolved_at`) e, se voltar, vira aviso novo. Nada é apagado.
- `platform_notice_reads`: leitura e "limpar" **por pessoa** (`read_at`, `dismissed_at`); a aba Limpas restaura.
- Assuntos (`lib/platform/notice-meta.ts`, um lugar só): Pagamentos, Limites, Robô do Porto, WhatsApp, Backups, Créditos de IA, Atendimento (`support`, único para atendentes), Clientes e vendas, Privacidade, Plataforma.

## Código

- `lib/platform/notices.ts` (banco: `insertNotice`, `resolveNotices`, `listNotices`, leitura/limpeza), `lib/platform/notice-alerts.ts` (`notifyPlatform`, nunca quebra o fluxo; `syncPlatformNotices`; avisa o **WhatsApp do dono** quando é crítico e só para admins, uma vez por aviso), `lib/platform/notice-checks.ts` (varredura), `lib/platform/notice-meta.ts` (regras puras).
- API: `GET/POST /api/platform/notices` (`withPlatformStaff`; o atendente só enxerga `staff`). `?check=1` pede a varredura (só em produção, no máximo a cada 10 min).
- Tela: `components/platform/notice-inbox.tsx` e `notice-bell.tsx` (estilo `notice-inbox.css`). Seção `notificacoes` em `PLATFORM_SECTIONS` e em `SUPPORT_SECTIONS`.
- Exceção ao território da IA de design (autorizada pelo dono em 07/11/2026): `shell.tsx` (sino e menu do atendente), `notifications.tsx` (abas), `notice-*`.

## De onde vêm os avisos

| Origem | Aviso | Importância |
|---|---|---|
| Espelho do sino da empresa (`mirrorRule`, em `createNotification`/`resolveNotifications`) | Pagamento confirmado, cobrança vencida, pagamento em atraso, acesso pausado, assinatura em dia; créditos de IA acabando/acabaram; robô do Porto falhou ou com avisos | conforme a empresa |
| Eventos | Cobrança ativada, assinatura cancelada, empresa nova pelo site, novo contato (lead), caso novo, cliente respondeu num caso, backup diário que falhou, rotina do worker que falhou | sucesso, atenção, aviso |
| Alertas do WhatsApp do dono (`sendOwnerAlert`) | Tela do Porto mudou, execução travada, fila atrasada, saldo da IA, pedido de privacidade, chat urgente | crítico/atenção |
| Varredura (worker a cada 30 min + painel aberto) | **Plataforma:** worker sem sinal há 75 min, Asaas ou IA com erro. **Limites** por empresa (armazenamento, usuários, mensagens de WhatsApp e execuções do Porto do mês): 90% aviso, 100% atenção. WhatsApp da empresa desconectado. Robô do Porto ligado e sem importar há 2 dias. Sem backup há 36 h (crítico). Ninguém entra há 14 dias. Caso escrito sem resposta há 24 h | variados |

O que é da vida da empresa (folha, despesas, peças, escala) **não** sobe para a equipe, e limites/WhatsApp/módulos não são espelhados (a varredura já cobre, mesmo que ninguém abra o sistema da empresa).

Para avisar de algo novo: `await notifyPlatform({ organizationId, category, severity, title, body, href, dedupeKey })`; para uma condição que pode acabar, uma verificação nova em `platformChecks()` (cada uma com o seu prefixo de chave: o que sumiu da lista é resolvido sozinho). Teste: `node scripts/test-platform-notices.cjs` (usa o banco de desenvolvimento; `collectPlatformFindings` lê os achados reais sem gravar).

Pendências: configurar quais assuntos mandam WhatsApp (hoje só os críticos); a varredura só roda em produção quando alguém abre o painel ou no worker (que precisa da versão nova na VPS e das migrações aplicadas).
