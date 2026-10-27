# API do painel do dono

Referência para ligar a interface do painel (`app/plataforma`, hoje com mocks em `lib/mocks/`) à API real. Todas as rotas ficam em `/api/platform/`, no domínio raiz, e só aceitam a sessão do dono (`platform_owner`). Uma sessão de "entrar na conta" **não** dá acesso a elas. Erros vêm como `{ "error": "mensagem em português" }`, com status 4xx/5xx.

Implementação: `lib/platform/organizations.ts` (regras), `lib/platform/route.ts` (autorização e erros), `lib/audit.ts` (auditoria).

## Organizações

| Método e rota | Corpo / parâmetros | Resposta |
|---|---|---|
| `GET /organizations` | `?status=active\|provisioning\|past_due\|suspended\|canceled&search=texto` | `{ organizations: [{ id, name, legalName, slug, status, email, city, state, createdAt, activatedAt, statusChangedAt, activeTechnicians, activeUsers, onboardingStatus, signupSource, admin: { name, email } }] }` |
| `GET /organizations/slug?slug=x` | — | `{ slug, available, reason }` (verificação ao vivo do assistente) |
| `POST /organizations` | `{ name, legalName?, document?, email?, phone?, city?, state?, slug, admin: { name, email } }` | `201 { organization }` com estado `provisioning` |
| `GET /organizations/:id` | — | `{ organization, usage: { activeTechnicians, activeUsers, storageBytes, whatsappSentThisMonth, portoRunsThisMonth }, integrations: { porto, whatsapp }, settings, provisioning }` |
| `PATCH /organizations/:id` | qualquer um de `name, legalName, document, email, phone, city, state` | `{ organization }` (o subdomínio nunca muda) |
| `POST /organizations/:id/status` | `{ action: "suspend" \| "reactivate" \| "cancel", reason }` (motivo obrigatório para suspender/cancelar) | `{ organization }` |
| `POST /organizations/:id/onboarding` | `{ action: "release" }` — libera o sistema para uma empresa que contratou pelo site (`organization.onboardingStatus`: `awaiting_payment` → `setup` → `done`). Liberar antes de a implantação ser paga já cria a assinatura no Asaas (1ª cobrança no mês seguinte, no dia escolhido). | `{ organization }` |
| `PUT /organizations/:id/settings` | as mesmas configurações de `/api/organization-settings` | `{ settings }` |

## Provisionamento (tela de progresso)

1. `POST /organizations` cria a organização.
2. `POST /organizations/:id/provisioning` roda as etapas e responde ao terminar: `{ provisioning, finished, adminTemporaryPassword }`. A senha temporária do admin **só vem na execução que criou o admin** — mostrar uma vez.
3. Enquanto a execução roda, `GET /organizations/:id/provisioning` devolve `{ provisioning: { steps, startedAt, finishedAt } }` para a tela acompanhar. Cada etapa: `{ key, label, status: pending|running|done|skipped|error, startedAt, finishedAt, error, note }`.
4. Se uma etapa falhar, chamar o `POST` de novo retoma a partir dela.

Etapas: `organization`, `plan` (pulada até existirem planos), `settings`, `admin`, `whatsapp` (pulada: a instância é criada quando a empresa configura o WhatsApp), `worker`, `activate`.

## Usuários da organização

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /organizations/:id/users` | — | `{ users: [{ id, name, email, role, status, lastLoginAt, createdAt, technicianId }] }` |
| `POST /organizations/:id/users` | `{ name, email }` (cria admin) | `201 { user, temporaryPassword }` |
| `PATCH /organizations/:id/users/:userId` | `{ role?, status?, resetPassword?: true }` | `{ user, temporaryPassword }` (senha só quando redefinida) |

## Anotações internas

`GET /organizations/:id/notes` → `{ notes: [{ id, text, createdAt, authorName }] }` · `POST` `{ text }` · `DELETE ?noteId=` (arquiva).

## Entrar na conta

`POST /organizations/:id/impersonate` com `{ reason }` → `{ redirectTo }`. A interface navega com `window.location.assign(redirectTo)`. A sessão não tem limite de tempo (dura até o dono sair ou o login dele expirar); dentro do sistema da organização aparece a faixa "Você está acessando como dono da plataforma — Sair", e toda alteração entra na auditoria. A faixa encerra a sessão em `POST /api/auth/impersonation/exit` e volta para `/plataforma`.

## Auditoria

`GET /audit?organizationId=&action=prefixo&before=ISO&limit=50` → `{ events: [{ id, organizationId, organizationName, actorId, actorName, actorEmail, actorRole, impersonationId, action, targetType, targetId, details, createdAt }] }`, mais recentes primeiro.

Ações registradas hoje: `organization.created|updated|suspend|reactivate|cancel|provisioned|provisioning_failed`, `organization_settings.updated` (com antes/depois), `user.created|updated`, `impersonation.started|request|ended`.

## Planos

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /plans` | — | `{ plans: [...] }` com `activeSubscriptions` |
| `POST /plans` | `{ key, name, monthlyPrice, annualPrice, features: [...], extraTechnicianPrice?, setupFee?, onRequest?, featured?, visible?, displayOrder?, includedTechnicians?, limits?: { maxUsers, storageMb, whatsappMessagesMonth, portoRunsMonth }, aiMonthlyCredits?, aiBonusCredits?, backupRetentionDays? }` (limites e retenção: `null` = ilimitado) | `201 { plan }` |
| `PATCH /plans/:planId` | qualquer campo acima, `archived`, e numa mudança de preço `applyPriceChange: "new_only"` (padrão) ou `"next_cycle"` | `{ plan, affectedSubscriptions }` |
| `GET /features` | — | `{ features: [{ key, name, core }] }` — os recursos `core` fazem parte de todo plano |
| `GET /modules` | — | "Monte o seu": `{ builder: { id, name, monthlyPrice, annualPrice, annualFactor, setupFee, includedTechnicians, extraTechnicianPrice } | null, modules: [{ key, name, description, core, inBase, sellable, monthlyPrice (null = fora de venda), setupFee }] }` |
| `PUT /modules/:key` | `{ monthlyPrice: number | null, setupFee? }` — `null` tira o recurso de venda como módulo; vale só para novas assinaturas | a mesma lista de `GET /modules` |

## Assinatura e cobrança de uma organização

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /organizations/:id/subscription` | — | `{ subscription }` com `value` (base + técnicos extras − descontos), `extraTechnicians`, `setupFeeStatus`, `graceDays`, `limitOverrides` |
| `PUT /organizations/:id/subscription` | `{ planId, cycle: "monthly"\|"annual", discountPercent?, discountAmount?, setupFee?, chargeSetupFee?, graceDays?, limitOverrides? }` | `{ subscription, syncWarning }` — `syncWarning` traz o motivo se o Asaas recusou o novo valor |
| `GET /organizations/:id/billing` | — | `{ subscription, charges }` |
| `POST /organizations/:id/billing` | `{ action: "activate", firstDueDate? }` cria cliente, implantação e assinatura no Asaas (exige CNPJ/CPF); `{ action: "sync" }` reenvia o valor e puxa as cobranças | `{ subscription, charges }` |
| `POST /billing/maintenance` | — | `{ suspended: [ids] }` — roda agora a checagem de inadimplência (o worker roda todo dia às 6h) |

A criação de organização aceita `subscription` com os mesmos campos do `PUT`; a etapa "plano" do provisionamento aplica.

## Visão geral, financeiro e leads

- `GET /overview?start&end`, `GET /charges?start&end` — números do painel e cobranças de todas as organizações.
- `GET /leads`, `GET|PATCH /leads/[leadId]` — contatos do site (estado, anotação).

## Cupons

- `GET|POST /coupons` — `{ code, kind: percent|fixed, value, durationCycles (0 = permanente), expiresOn?, planKeys? (vazio = todos), maxUses? }`.
- `GET|PATCH /coupons/[couponId]` — detalhe com as organizações que usaram; `PATCH { archived }` arquiva/restaura.
- `GET|POST|DELETE /organizations/[id]/coupon` — cupom aplicado; `POST { code }` aplica (o desconto do cupom substitui o da assinatura e o valor é sincronizado com o Asaas); `DELETE` remove e devolve o desconto anterior. O worker encerra cupons vencidos às 6h.

## Catálogo de recursos

- `GET|POST /features` — nativos (do código), gerais e sob medida; `POST { key, name, description? }` cria um sob medida.
- `GET|PATCH|POST /features/[key]` — detalhe com histórico; `PATCH { name, description }` ou `{ archived, reason }` (arquivar tira dos planos); `POST { action: "organizations", organizationIds }` define quem tem o recurso; `POST { action: "promote", planIds, reason }` torna geral e inclui nos planos.
- `GET|PUT /organizations/[id]/features` — recursos sob medida da organização; `PUT { key, enabled }`.
- Planos só aceitam recursos gerais. `hasFeature()` (`lib/billing/entitlements.ts`): recurso sob medida só vale com liberação explícita, com ou sem plano.

## Créditos de IA

- `GET /ai-credits?start&end` — consumo, receita, custo do provedor, pacotes, conversão e consumo por organização.
- `POST /ai-credits/packages`, `GET|PATCH /ai-credits/packages/[packageId]` — pacotes à venda e suas vendas.
- `GET|POST /organizations/[id]/credits` — saldo e extrato; `POST { quantity, reason }` ajuste manual (negativo debita, sem deixar saldo negativo).
- Extrato em `ai_credit_ledger`: cota mensal (worker, uma vez por mês; a sobra do mês anterior expira), bônus de entrada (ao criar a assinatura), compra (cobrança paga), consumo, ajuste.
- Empresa: `GET|POST /api/organization/credits` — saldo, pacotes e compra (`{ packageId }` gera cobrança avulsa no Asaas; os créditos entram pelo webhook de pagamento, uma vez por cobrança).

## Bugs reportados

- `GET /bugs?organizationId=`, `GET|PATCH|POST /bugs/[bugId]` — caixa de entrada; `PATCH { status, priority }`; `POST { text, internal? }` responde ao usuário ou grava nota interna. `GET /bugs/[bugId]/screenshot`.
- Empresa: `GET|POST /api/bug-reports`, `GET|POST /api/bug-reports/[bugId]` (sem as notas internas; o admin vê todos da empresa, os demais só os próprios; a resposta da empresa reabre o relato). Liberado mesmo em modo somente leitura.

## Novidades

- `GET|POST /news`, `GET|PATCH /news/[newsId]` — `{ title, publishedOn, category: feature|improvement|fix, body, imageUrl?, destination: site|system|both, status: draft|published }`; `PATCH { archived }`.
- Públicas: `GET /api/public/news` (site) e `GET /api/news` (sistema das empresas).

## Conteúdo do site

- `GET /site` (rascunho e publicado), `PUT /site` (salva rascunho), `POST /site` (publica). O site (`app/site/layout.tsx`) lê o publicado do banco; sem publicação, usa os padrões de `lib/site/content.ts`.

## Operação e configurações

- `GET /operations` — worker (online = resposta do `/health`; `worker_heartbeats` guarda versão e início, a cada 30 min), execuções (`porto_sync_log` + `worker_runs`), WhatsApp/Porto/arquivos por organização, tamanho do banco.
- `GET|PUT /settings` — `{ defaultGraceDays, reservedSubdomains, maintenance: { enabled, message }, ai: { inputCostPerMillion, outputCostPerMillion, creditsPerUse }, porto: { maxBrowsers }, alerts: { phone }, vps: { autoCleanup }, capacity: { storageGb, databaseGb, aiMonthlyBudget, portoBaseMinutes, portoMinutesPerTechnician, browserMemoryMb, pools: { whatsappMessagesMonth, portoRunsMonth, maxUsers } } }` (`porto.maxBrowsers` de 1 a 4: navegadores do Porto ao mesmo tempo na VPS; `alerts.phone`: WhatsApp do dono para os alertas da plataforma; `vps.autoCleanup`: limpeza diária da VPS às 04:30) e o estado real das integrações (Asaas consultado na hora, webhook, DeepSeek, Evolution, worker). A manutenção aparece como faixa no sistema de todas as empresas.
- `GET /capacity` — o que a plataforma tem × o que os planos prometeram (`lib/platform/capacity.ts`): `{ resources: [{ key, label, unit, capacity, committed, unlimited, used, note }], organizations: [{ id, name, slug, status, planName, runsAutomations, storage, users, technicians, whatsapp, porto: { feature, automationEnabled, runsMonth, limitMonth, minutesPerNight, nightsMeasured, estimatedMinutes }, ai }], totals: { organizations, runningAutomations, withPorto, portoRoom }, settings, maxBrowsers }`. Recursos: janela noturna do Porto (navegadores × 7 h; cada empresa com o Porto conta o tempo medido nas últimas 14 noites ou `portoBaseMinutes + portoMinutesPerTechnician × técnicos`), memória da VPS no pico (mediana de 24 h + navegadores × `browserMemoryMb`), armazenamento (soma de `storageMb` de todas as empresas não excluídas × `storageGb`), banco (`pg_database_size` × `databaseGb`), WhatsApp (sem teto da plataforma) e IA (créditos mensais × custo real por crédito dos últimos 90 dias × `aiMonthlyBudget`). `capacity: null` = não informada; `unlimited` = empresas com limite ilimitado (fora da soma).
- `GET /allocation?resource=storageMb|whatsappMessagesMonth|portoRunsMonth|maxUsers` — distribuição do recurso (`lib/platform/allocation.ts`): `{ resource, label, unit: 'mb'|'count', monthly, pool, allocated, unlimited, free, used, unsubscribed, organizations: [{ id, name, slug, status, planName, planValue, adjusted, allocated, used }] }`. `pool` = total da plataforma (`capacity.storageGb` ou `capacity.pools.<recurso>`; null = sem total); o que cada empresa recebe é o limite efetivo (plano ou `limit_overrides`), o mesmo que `checkLimit()` aplica.
- `PUT /allocation/:organizationId` — `{ resource, mode: 'value'|'plan'|'unlimited', value?, reason }`: valor próprio, volta ao plano ou sem limite. Recusa abaixo do uso atual, acima do livre (só quando aumenta) e sem limite quando há total. Armazenamento de empresa num container só cresce até o livre dele (`assertStorageFits`, também em `PUT /organizations/:id/subscription` e na transferência). `whatsappMessagesMonth` não é mais recurso: WhatsApp é sempre ilimitado. Audita `allocation.updated`.
- `POST /allocation/transfer` — `{ resource, from, to, amount, reason }`: tira de uma empresa e dá a outra numa transação (o total não muda). A origem só cede o que não está em uso; nenhuma das duas pode estar sem limite. Audita `allocation.transferred` nas duas.
- `GET /storage` — containers de armazenamento (`lib/platform/storage-containers.ts`, migração `0020`): `{ containers: [{ id, name, notes, sizeMb, reservePercent, usableMb, allocatedMb, usedMb, freeMb, createdAt, organizations }], organizations: [{ id, name, slug, status, planName, limitMb, usedMb, containerId, since }], defaults: { sizeGb, reservePercent } | null, totals, vercel: { plan, hobbyRoomMb, blocked } }`. Contabilidade só: todos os arquivos ficam na mesma loja do Blob, cada empresa na própria pasta; `usableMb` = tamanho − folga; `limitMb` é o limite efetivo (plano ou `limit_overrides`).
- `POST /storage/containers` — `{ name, sizeGb, reservePercent?, notes? }`. Audita `storage_container.created`.
- `PUT /storage/containers/:id` — mesmos campos; recusa se tamanho − folga ficar abaixo do que as empresas dele recebem. Audita `storage_container.updated`.
- `POST /storage/containers/:id/archive` — só vazio; fica no banco (`archived_at`). Audita `storage_container.archived`.
- `PUT /storage/organizations/:organizationId` — `{ containerId | null, reason }`: atribui, transfere ou tira do container; recusa se não couber no livre do destino ou se a empresa estiver sem limite. Audita `storage_container.assigned`.
- `POST /storage/auto-assign` — põe as empresas sem container (com limite) no primeiro com espaço, por ordem de chegada; abre um novo com o padrão se nenhum couber. Devolve `{ placed, skipped, storage }`. O mesmo roda sozinho quando uma empresa ganha assinatura (contratação pelo site e `setSubscription`).
- `PUT /storage/defaults` — `{ sizeGb | null, reservePercent }`: tamanho dos containers abertos sozinhos (`capacity.storageLot` nas configurações; vazio = nunca abre).
- `GET /porto-queue` — fila do Porto ao vivo, do worker: `{ capacity: { maxBrowsers, activeBrowsers, waiting }, running: [{ organizationId, name, heldForMs }], queue: [{ organizationId, job, runDay, enqueuedAt, startedAt }] }` (503 com o worker fora).
- `GET /alerts?limit=` — alertas enviados ao dono (`platform_alerts`: mudança de tela do Porto, execução travada, fila atrasada, VPS), com `sentAt`/`error` do envio.
- `GET|POST|DELETE /alerts-whatsapp` — WhatsApp da plataforma que envia esses alertas (instância `nextrotta-alertas` no servidor Evolution compartilhado): estado; `POST` cria quando falta e devolve `{ status, qr }` (chamar de novo renova o QR Code); `DELETE` desconecta o número.
- `GET|PUT|PATCH /account` — conta do dono (`PATCH { name, email }`; `PUT` troca a senha).

## Dados da organização

- `GET /organizations/[id]/data` — lixeira (registros com `deleted_at`); `?export=1` baixa a exportação completa em JSON (sem senhas nem credenciais); `POST { table, recordId }` restaura.
- Empresa: `GET /api/organization/export` (admin), liberado mesmo com a conta suspensa.

## Ainda não existe

Backups diários (precisam de armazenamento externo — `BACKUP_STORAGE_URL` — e do worker rodando); consumo real de créditos (chega com o assistente de IA/DeepSeek); envio de e-mails da plataforma; autenticação em dois fatores.

## VPS (Operação → VPS)

Pelo agente da VPS (`vps-agent/`, `VPS_AGENT_URL`/`VPS_AGENT_SECRET`); detalhes e implantação em `docs/saas/vps.md`. Sem o agente configurado, as rotas ao vivo respondem 503 e o histórico vem vazio.

- `GET /vps?range=24h|7d|30d` — `{ agentConfigured, host (ao vivo: cpu, memory, disk, network, uptimeSeconds, os), agentError, history: [{ at, cpuPercent, cpuMaxPercent, memoryUsedBytes, memoryTotalBytes, diskPercent, networkRxBytes, networkTxBytes }], capacity: { maxBrowsers, windowMinutes, nights: [{ night, browserMinutes, occupancyPercent, lastFinishedAt }] }, autoCleanup }`.
- `GET /vps/containers` — `{ containers: [{ name, owner: nextrotta|production|shared|unknown, state, status, image, restartCount, restartPolicy, ports, sizeRw, cpuPercent, memoryBytes, memoryLimitBytes, logBytes, ... }] }`; `?name=&range=` devolve o histórico de CPU/RAM de um container.
- `GET /vps/containers/[name]/logs?tail=200` — últimas linhas (só leitura).
- `POST /vps/containers/[name]/restart` — `{ confirmShared? }`. Só containers do NextRotta; os compartilhados (`evolution-*`) exigem `confirmShared: true` (o WhatsApp de todos cai por alguns segundos); produção e desconhecidos: 403. Auditado (`vps.container_restarted`).
- `GET /vps/images` — imagens com tamanho, idade, quem usa e dono.
- `GET /vps/disk` — uso do disco, Docker (imagens, containers, volumes, cache de build), pastas conhecidas e o log da limpeza antiga.
- `GET|POST /vps/cleanup` — histórico de limpezas; `POST { dryRun: true }` lista o que sairia e quanto libera, `{ dryRun: false }` executa (auditado `vps.cleanup`). Regras em `docs/saas/vps.md`.
- `GET|POST /vps/costs`, `DELETE /vps/costs/[id]` — gastos de infraestrutura lançados à mão (`{ month: AAAA-MM, category: vps|vercel|database|domain|whatsapp|ai|email|other, description?, amount }`); excluir arquiva (`deleted_at`).
- `GET /vps/costs/allocation?month=` — custo estimado × quanto paga, por organização (`lib/platform/costs.ts`): cada categoria lançada em `infra_costs` é dividida pelo que a move — VPS pelos minutos de navegador do Porto, WhatsApp pelas mensagens, `storage` (Blob) pelo espaço dos arquivos, `database` pelo tamanho estimado das linhas de cada empresa (soma de `pg_column_size` nas tabelas com `organization_id`), IA pelo custo real do `ai_credit_ledger`; o resto em partes iguais (e também quando ninguém usou o recurso no mês). Cada organização traz `usage` e `lines: [{ category, label, total, basis, share, amount }]`.
- `GET /organizations/:id/costs?month=` — o mesmo para uma organização: `{ month, organization: { usage, lines, estimatedCost, monthlyRevenue, margin } | null, platform: { costs, totalCost, organizations, measuredAiCost }, method }` (null quando ela não estava ativa no mês). Aba "Custos" do detalhe.
- `GET /ai-balance?month=` — saldo da DeepSeek (`lib/ai/balance.ts`; lê de novo se a última leitura tem mais de 5 min): `{ configured, error, balances: [{ currency, total, granted, toppedUp, isAvailable, collectedAt }], month, movements: [{ currency, spent, toppedUp, since, readings }], daily: [{ currency, day, total }], calculatedCost, lowBalanceAlert }`. `spent`/`toppedUp` = soma das quedas/aumentos entre leituras do mês; `calculatedCost` = custo pelos tokens (R$). O aviso de saldo baixo é `ai.lowBalanceAlert` em `PUT /settings`.
