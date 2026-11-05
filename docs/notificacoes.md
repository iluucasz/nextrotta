# Notificações

O sino do sistema da empresa (barra de cima, só para o admin) mostra dois tipos de aviso:

- **Da empresa** (`organization_id` preenchido): o que está acontecendo com ela. Sai sozinho, de eventos do sistema.
- **Do NextRotta** (`organization_id` nulo): avisos gerais da plataforma, publicados pelo dono para todas as empresas ou para uma só.

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
