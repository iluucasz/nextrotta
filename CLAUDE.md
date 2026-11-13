# NextRotta (SaaS)

**NextRotta** (com dois "t") é a plataforma SaaS multi-cliente com assinatura construída a partir de um clone do **Central Operacional** (`C:\Users\iluuc\Documents\sistema-de-gestao-tecnica`, repo `iluucasz/central-operacional`), que **está em produção e em uso por um cliente real**. Requisitos e decisões: `docs/saas/visao-geral.md`.

## ⚠️ Isolamento da produção — regras invioláveis

- **Nunca** editar, rodar comandos ou fazer git dentro de `sistema-de-gestao-tecnica`. Ler para comparar/portar código é permitido. (Edit/Write lá já estão bloqueados em `.claude/settings.json`.)
- **Nunca** usar credenciais da produção: `DATABASE_URL`, Blob, `PORTO_CREDENTIALS_KEY`, instância Evolution, `JWT_SECRET`. Se um valor parecer vir de lá, pare e pergunte.
- **Nunca** adicionar remote para `iluucasz/central-operacional` nem dar push para ele. Este repo foi iniciado do zero, sem remote.
- Scripts em `scripts/` (backup/restore) escrevem no banco apontado pelo `.env.local` — confirmar o destino antes de rodar.
- `JWT_SECRET` é obrigatório aqui (sem fallback, diferente da produção) para tokens de um ambiente nunca valerem no outro.

## Arquitetura SaaS decidida

- **Banco único** (Neon novo, próprio do NextRotta, já no `.env`). Isolamento por `organization_id` em todas as tabelas de domínio; tabela `organizations` é a raiz. Toda query filtra pela organização — esquecer o filtro vaza dados entre clientes.
- **Papéis:** `platform_owner` (dono/**Admin** da plataforma: o dono cria outros admins em `/plataforma/equipe`; acesso total a todas as organizações, inclusive entrar na conta delas e alterar) → `platform_support` (**atendente** da equipe NextRotta, sem organização: só Reports, Livechat e consulta das empresas, sem valores nem entrar na conta; criado pelo dono em `/plataforma/equipe`, `docs/saas/equipe.md`) → `admin` (só a própria organização) → `technician` e demais usuários.
- **Tenant pelo login + subdomínio:** login em `nextrotta.app` acha a organização do usuário (e-mail é único na plataforma inteira) e redireciona para `<slug>.nextrotta.app`. Token carrega a organização; o middleware confere com o subdomínio. Vercel com wildcard exige os nameservers da Vercel.
- **Usuários:** tabela própria com `organization_id`, não mais `neon_auth."user"` (era do banco da produção e nada no código a cria). O schema do clone pode ser redesenhado — não é preciso manter compatibilidade com o banco da produção.
- **Planos:** pacotes prontos (Essencial, Pro) e **"Monte o seu"** (a antiga "Sob medida" foi arquivada em 26/10/2026): o cliente parte de uma base (cópia do Essencial) e soma só os módulos que quer, cada um com preço e implantação próprios (veja "Monte o seu" em `docs/saas/estado-atual.md`); ciclo mensal ou anual; implantação cobrada à parte. Preços, limites e recursos ficam no banco, editados pelo dono — nunca fixos no código.
- **Cobrança:** Asaas (sandbox no `.env`; a chave começa com `$` e precisa ficar escapada como `\$`). Inadimplência: `active` → `past_due` (carência, uso normal) → `suspended` (**bloqueada na hora**; o dono pode conceder dias de consulta em Configurações). Suspensa ou cancelada, a empresa só chega a `/acesso-encerrado` (`lib/organization-access.ts` + `middleware.ts`; o dono dentro da conta é isento): motivo, **Pagar agora**, **Verificar pagamento** (consulta o Asaas na hora e libera sozinho), **Abrir chamado**, **chat ao vivo**, planilha do último backup e documentos/imagens para baixar. Um dia antes do fim da carência e ao suspender/cancelar é feito um backup `closing`. Reativar devolve o acesso completo.
- **Prazo de eliminação (LGPD, decisão do dono em 05/11/2026):** não guardamos dado de cliente sem contrato. 3 meses depois do bloqueio sem reativação ou pagamento, os dados e os backups devem ser **excluídos de forma permanente** e a conta não volta (só uma conta nova). O prazo está em `lib/data-retention.ts` e `/acesso-encerrado` já mostra o aviso com a data. **A rotina que executa a exclusão ainda NÃO existe** — construir só com o desenho aprovado pelo dono (o que apaga e o que a lei manda guardar) e então subir a versão do DPA/Termos.
- **IA:** DeepSeek, no Pro. Créditos por organização com extrato (ledger): cota mensal do plano + bônus de entrada + créditos extras comprados.
- **Alocação de recursos:** limites por organização = limites do plano, com sobrescrita pelo dono.
- **Nunca excluir dados:** exclusão lógica (`deleted_at`/`deleted_by`) em todas as tabelas de domínio, lixeira com restauração, auditoria de ações sensíveis. O app usa um papel do Postgres **sem `DELETE`/`TRUNCATE`/DDL**; schema via migrações versionadas (substituindo `ensure*Schema()` em runtime). Não escrever `DELETE FROM` em código novo. Exportação completa por organização.
- **Backup diário por organização** gerado pelo worker em storage externo, retenção pelo plano (Essencial 30 dias, Pro 90; vazio = ilimitado); a remoção de backups vencidos é a única exclusão definitiva permitida, e o backup mais recente nunca é removido.
- **Sob medida isolado:** catálogo de recursos (feature flags) com escopo geral ou por organização; código sob medida fica isolado e só roda para quem tem o recurso ligado; pode ser promovido a geral pelo painel.
- **Configurações da organização** (admin define, tabela `organization_settings`): percentual e modo de comissão, VA/VR, salário base padrão, jornada, intervalo, prêmios, horários do Porto etc. Nenhum valor do cliente original fica no código.
- **Worker compartilhado:** um worker itera as organizações com credenciais Porto/Evolution de cada uma, fila com concorrência limitada para o Playwright, falha isolada por organização.
- **Painel do dono + site de marketing:** a interface é feita por uma IA de design a partir de `docs/saas/prompt-painel-dono.md`, **no mesmo repositório e ao mesmo tempo**. Território dela: `app/plataforma/**`, `app/site/**` (servido nos endereços públicos `/`, `/planos` etc. por rewrite no `middleware.ts`), `components/platform/**`, `components/site/**`, `lib/mocks/**` e o visual de `app/login/page.tsx` — não editar esses arquivos; erros de tipo neles são dela. O contrato de integração (login, sair, pastas) está na seção "Onde trabalhar neste repositório" do prompt. Aqui mantemos essa especificação e implementamos back-end/API e integração. Ao especificar telas, não opinar em decisões visuais. Exceções feitas com autorização do dono (telas do painel, do site e do Livechat que eu mesmo fiz) estão listadas em `docs/saas/estado-atual.md`; uma correção pontual, como trocar o domínio, também vale.
- **Suporte:** chamados (suporte, bug, sugestão) em todas as telas do sistema do cliente, com caixa de entrada em Reports no painel; **Livechat** (chat ao vivo + WhatsApp oficial numa caixa só, `docs/livechat.md`). **Chat ao vivo e chamado por escrito são separados** (`bug_reports.channel`: `chat` ou `case`, como Omni-Channel e Case): o cliente escolhe ao abrir; o chat só existe no Livechat e o chamado só tem conversa escrita; ao encerrar, os dois mandam uma mensagem de agradecimento (editável pelo dono); o chat abre com a primeira mensagem da equipe, aceita anexos e prints (até 4 MB, guardados na pasta da empresa e contados no armazenamento dela) e avisa o dono pelo próprio número oficial quando o WhatsApp de alertas não está configurado; **novidades (changelog)** no site e no sistema.
- **Domínio e contato oficiais:** `nextrotta.app` (login e site; empresas em `<slug>.nextrotta.app`), WhatsApp (21) 99779-2422, e-mail nextrotta@gmail.com (`docs/whatsapp-oficial.md`). O domínio antigo `nextrotta.com.br` **não é o do projeto**.
- **Onde roda:** app na Vercel; banco no Neon; arquivos no Vercel Blob (loja privada `nextrotta-storage`); **worker** (Porto, WhatsApp, cobrança diária, backups às 00:00) em Docker numa VPS compartilhada, junto do **Evolution próprio** (`nextrotta-evolution-*`), do agente da VPS e do proxy (`docs/saas/vps.md`). Mexer na VPS só em `nextrotta-*` e com confirmação do dono.

## Estado atual (resumo; o registro detalhado está em `docs/saas/estado-atual.md`)

**Funcionando e testado (Chrome real, testes em `scripts/`):** multi-tenant por organização com exclusão lógica; configurações por organização; painel do dono ligado à API (sem mocks); site de marketing + contratação pelo site (Asaas sandbox); planos (Essencial, Pro, "Monte o seu" com módulos), cupons, créditos e assistente de IA (DeepSeek), empresa vitalícia/de teste, upgrade pelo admin; cobrança e inadimplência com bloqueio imediato, "Verificar pagamento" e página de acesso encerrado completa; backups diários por empresa (planilha, restauração com desfazer, cópia antes do bloqueio), no worker da VPS desde 05/11; LGPD (termos com aceite, canal do titular, aviso de eliminação em 3 meses); notificações (sino e página); Venda de Peças; despesas e faturamento; suporte com chamados e **Livechat**; Evolution próprio na VPS, com o número oficial conectado.

**Nunca testado de verdade:** o robô do Porto (precisa de credenciais de uma organização autorizada), o Mercado Pago real, o recebimento e o envio de mensagens reais pelo WhatsApp oficial (o número está conectado, mas o Livechat foi testado só com mensagens simuladas) e o Asaas de produção.

**Pendências, em ordem:**
1. **WhatsApp oficial no ar, falta provar com mensagens reais:** o Evolution próprio está em uso (instância `nextrotta-suporte` conectada ao (21) 99779-2422, webhook em `https://nextrotta.app/api/webhooks/evolution`, `ROOT_DOMAIN` e `EVOLUTION_*` já no worker). Testar de verdade: um cliente escrevendo para o número, a resposta pelo Livechat e o espelho de um chamado urgente com WhatsApp. O `.env` **local** ainda aponta para o Evolution do `essencialcentro` (não usar); para desenvolver, trocar pelo do NextRotta. O manager do Evolution abre em `https://nextrotta-infra.duckdns.org:8443/manager/`.
2. **Rotina de exclusão permanente** (3 meses após o bloqueio) e, junto, DPA/Termos novos (versão nova, novo aceite) e a revisão do que a lei obriga a guardar (cobranças, fiscais).
3. **Asaas de produção** (depende do CNPJ e da conta PJ) e cadastro do webhook `https://nextrotta.app/api/webhooks/asaas` (eventos de cobrança, token = `ASAAS_WEBHOOK_TOKEN`).
4. **Mercado Pago real:** aplicativo do NextRotta com URL de retorno e de webhook de produção e `MERCADOPAGO_*` no ambiente.
5. **Site e jurídico:** CNPJ, razão social, redes e endereço (em Conteúdo do site); revisão dos textos legais por advogado (`LEGAL_REVIEWED = false`); o texto **publicado** do site ainda diz "Nenhum dado é apagado" e "Seus dados nunca são apagados por atraso" (bloco `seg1` e `pricingFootnote`) — contradiz o prazo de 3 meses, trocar com a autorização do dono.
6. **Conferir a primeira meia-noite** com o worker novo (`worker_runs` jobs `backups` e `backup_cleanup`; um backup "Diário" 00:00 por empresa).
7. **Banco:** criar no Neon o papel do app sem `DELETE`/TRUNCATE/DDL (hoje o app usa o dono do banco); textos da UI da empresa ainda falam em "excluir"/"DELETAR OS".
8. **Painel do dono:** tela de preços dos módulos e "adicionar módulo" pelo admin; o painel ainda pode mostrar o texto antigo de "backups não configurado"; backup da plataforma inteira (Neon) não existe.
9. **Custos e preços:** a taxa do Asaas ainda não entra na margem dos créditos de IA; `DEEPSEEK_MODEL` pode passar para `deepseek-flash`; no ciclo anual o técnico extra é cobrado ×12; Venda de Peças ainda não está em nenhum plano.
10. **Livechat:** só texto (foto/áudio/documento chegam como aviso), sem "digitando" nem confirmação de leitura.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript, Tailwind 4, shadcn/ui (`components/ui/` — gerado, evite editar).
- Banco: Neon Postgres via `@neondatabase/serverless` (tagged template `sql\`...\``, SQL cru, sem ORM). Cliente em `lib/db.ts`, mas 6 rotas em `app/api/` e `lib/payroll-utils.ts` criam a própria conexão com `neon(...)`.
- Auth própria: JWT (`jose`) no cookie `auth-token`, senhas com `bcryptjs`. Ver `lib/auth.ts` e `middleware.ts`.
- Deploy: app na Vercel; **worker** (`worker/`) em Docker numa VPS roda as automações do Porto (Playwright), os envios de WhatsApp, a cobrança diária e os backups via `node-cron`.
- Alias de import: `@/*` → raiz do repo.

## Comandos

- `pnpm install` / `pnpm dev` — precisa de `.env` (ou `.env.local`) com ao menos `DATABASE_URL` e `JWT_SECRET`. Acesse por `http://nextrotta.localhost:3000` (login/painel) e `http://<slug>.nextrotta.localhost:3000` (organização) — **não** por `localhost:3000` puro.
- `pnpm db:migrate` / `pnpm db:status` — aplica/lista migrações de `db/migrations/*.sql` (ordem do nome do arquivo, uma transação cada, registradas em `schema_migrations`). Mostra o banco de destino. Schema novo vai em migração nova; nunca editar uma migração já aplicada.
- `pnpm platform:create-owner --email <e> --name "<n>"` e `pnpm platform:create-org --name "<n>" --slug <s> --admin-email <e> --admin-name "<n>"` — criam o dono e organizações (senha gerada e impressa uma vez) até o painel existir.
- `npx tsc --noEmit` — **verificação principal**. `next.config.mjs` usa `ignoreBuildErrors: true`, então o build não pega erro de tipo. Passava limpo no momento do clone; mantenha assim. Enquanto a IA de design trabalha em paralelo, um erro de sintaxe num arquivo dela impede o TypeScript de checar o resto: use `npx tsc --noEmit -p tsconfig.claude-check.json`, que exclui as pastas dela.
- Testes: ~30 scripts `scripts/test-*.cjs` (`node:test`; rode `node scripts/test-<nome>.cjs`). Regras puras rodam sem banco; os de fluxo (`test-backup-flow`, `test-livechat`, `test-billing-release`…) usam o **banco de desenvolvimento** e empresas de teste próprias `zz-*` (deixadas arquivadas), nunca dados de uma empresa real. Antes de mexer em backup, cobrança, Livechat ou Porto, rode o teste da área.
- `pnpm lint` não funciona (ESLint não está instalado).
- Worker: `cd worker && npm run build` (usa `tsc` de propósito, não tsx/esbuild — ver comentário no `worker/Dockerfile`).

## Mapa do código

- `app/admin/<área>/page.tsx` e `app/dashboard/<área>/page.tsx` — telas (client components grandes, com fetch para `/api`).
- `app/api/<recurso>/route.ts` — API. Padrão: `const auth = await verifyAuth(request)` (`lib/auth.ts`) e checar `auth.role`; para técnico ele já resolve `auth.technicianId` e barra técnico inativo. Algumas rotas usam `requireAdmin()`.
- Schema: só por migração em `db/migrations/` (o antigo `ensure*Schema()` em runtime foi removido).
- `lib/payroll-utils.ts` — cálculo da folha. `lib/hour-bank.ts` — banco de horas (220h/mês). `lib/work-hours-service.ts` — apontamento de horas.
- `lib/porto-integration/` + `lib/porto-jobs/` — automação do Portal do Prestador (só rodam no worker; excluídos do `tsconfig` raiz). O app chama o worker via `lib/porto-worker-client.ts`.
- `lib/whatsapp/` — Evolution API, notificações e store. `lib/livechat/` — Livechat (regras puras, banco, WhatsApp). `lib/backup/` — backups e restauração. `lib/billing/` — Asaas, direitos e limites. `lib/ai/` — assistente. `lib/platform/` — o que o painel do dono usa. `lib/legal/` — textos legais versionados.
- `lib/schedule-planner.ts`, `lib/schedule-write-service.ts` — montagem da escala.
- `app/admin/schedule/registros/` — histórico "Registros da escala" (submenu de Escala na sidebar: `children` em `adminLinks` de `components/app-shell.tsx`); a leitura/rotulagem das linhas fica em `lib/schedule-display.ts`, usada também pela tela de montagem.
- `lib/types.ts` — tipos de domínio compartilhados.
- `db/migrations/` — schema versionado. `scripts/lib/db.mjs` — conexão dos scripts (Pool WebSocket, carrega `.env.local`/`.env`).
- `lib/tenant-host.ts` — resolve raiz × subdomínio pelo cabeçalho `Host` e monta URLs (`rootUrl`, `organizationUrl`, `sameHostUrl`). Em dev, `request.url` não traz o subdomínio: nunca montar redirect com `new URL(path, request.url)`.
- `lib/auth-handoff.ts` + `app/api/auth/handoff/` — código de uso único que leva o login da raiz para o subdomínio.
- Menu lateral (`components/app-shell.tsx`, estilos no fim de `styles/design-system.css`): cada página monta o próprio `AppShell`, então o que a pessoa fez no menu vive em variáveis de módulo (`cachedNavScroll`, `cachedClosedSections`) e não em estado: rolagem restaurada e item ativo trazido para a vista a cada navegação; títulos de grupo dobráveis (lembrados em `localStorage`, o grupo da página atual nunca dobra); um submenu aberto por vez; recolhido (só ícones) esconde títulos e filhos. Não voltar a deixar `min-height` de 44 px nos itens no desktop.
- Login já com sessão: `/login` na raiz manda o dono direto para `/plataforma`; para usuários de empresa, o login grava na raiz o cookie `last-organization` (só o subdomínio, sem token) e `/login` redireciona para lá — a sessão do subdomínio decide. Sessão expirada volta com `?sessao=expirada` e sair com `?sair=1`: ambos mostram o formulário e esquecem a empresa (sem loop). Regras no `middleware.ts`.
- `verifyAuth()` devolve `organizationId`/`organizationSlug` e revalida usuário/organização no banco a cada requisição.

Arquivos muito grandes — leia por trechos (Grep primeiro), nunca inteiros:
`app/admin/schedule/admin-schedule-builder.tsx` (~5,2 mil linhas), `app/admin/services/page.tsx`, `app/admin/dashboard-gerencial/management-dashboard.tsx`, `app/admin/payroll/page.tsx` (1,3–1,7 mil linhas cada).

## Regras de negócio herdadas

- Competência no formato `YYYY-MM`. Serviços têm quinzena `Q1`/`Q2`.
- Comissão (`commissionMode` das Configurações, regras em `lib/payroll-rules.ts`): `base = total de OS × commission_percentage`; modo `excess` (padrão): `comissão = max(0, base − salário base − VA − VR)`; modo `percentage`: `comissão = base`; modo `per_service`: `valor por OS × nº de OS`; `per_hour`: `valor por hora × horas do mês`; `per_day`: `valor por dia × dias com horas`; modo `none`: sem comissão. O valor por OS/hora/dia é `commissionRate` (empresa) ou `technicians.commission_rate` (técnico; 0 = padrão), e `commissionMinimum`/`commissionMaximum` seguram a comissão do mês (0 = não usa; o teto vence). Valores do técnico (ou o padrão da organização quando vazios). Detalhes em `docs/calculo-folha.md` (exemplo com os valores do cliente original).
- Hora extra: horas acima da jornada mensal × (salário base ÷ jornada) × adicional. Prêmio: valor da maior faixa de OS atingida no mês.
- Calendário de pagamento (`lib/pay-calendar.ts`, `docs/configuracoes.md` → "Mês das OS"): a empresa escolhe se o mês de cada OS importada vem do lote (padrão) ou da data do serviço, e até que dia as telas abrem no mês anterior. Fases 1 (mês das OS), 2 (VA/VR: abate da comissão e cartão/dinheiro) e 3 (`periodCutDays`: mensal, quinzenal ou dias específicos; empresa mensal não vê Q1/Q2) prontas; e os presets "Quinzenal"/"Mensal" na criação da empresa (`payPreset`, `lib/pay-presets.ts`) prontos; o dia de fechamento do mês (`monthClosingDay`: com 25, a competência de novembro é 26/10 a 25/11; OS, horas e Folha seguem, Escala e Despesas ficam no calendário) também pronto. Não escrever regra de um cliente no código: vira configuração.
- Folha tem status `draft`/`closed`; relatórios gerenciais usam só folhas fechadas por padrão.
- Horas (escala e importação do Porto) descontam o intervalo diário da organização. O job de horas reprocessa hoje e os `portoReprocessDays` (1 a 7) dias anteriores, e todo dia `LAUDO PENDENTE:` (laudo ausente dentro do prazo `portoLaudoGraceHours`, padrão 6 h após o Concluído) até ele virar normal ou, vencido o prazo, advertência — a advertência nunca é recalculada. "Fim do expediente" relata o dia já encerrado (2 h depois do fim do turno padrão da organização); a importação automática que falha é tentada de novo (3 tentativas, 5 e 15 min, trava e navegador por tentativa). Detalhes em `docs/integracao-porto-seguro.md` ("Horários livres" e "Tentativas automáticas").
- Escala: "semana sim, semana não" (`alternating`/`alternating_off`) e as equipes que se alternam contam semanas a partir de uma segunda-feira fixa (`getScheduleWeekIndex` em `lib/schedule-planner.ts`), não do início do período — montar mês após mês continua a alternância. Teste: `scripts/test-schedule-alternation.cjs`.
- Horários do job seguem o fuso de Brasília real (não offset UTC fixo).
- **Modo preview** (admin vendo como técnico): o middleware bloqueia qualquer método não-GET. Exceções em `previewEscapeRoutes`/`previewAdminRoutes` em `middleware.ts`. Não confundir com o acesso do `platform_owner` à conta de uma organização, que pode alterar dados.
- Visibilidade por técnico: `lib/technician-visibility*.ts`.

Os números dessas regras vêm de `organization_settings`; não escrever valores do cliente original no código.

## Documentação por assunto (leia só quando o tema surgir)

- `docs/saas/estado-atual.md` — registro detalhado do que foi construído, fase a fase, com os caminhos do código (o resumo está acima).
- `docs/saas/visao-geral.md` — desenho completo do SaaS: superfícies, papéis, planos, créditos, inadimplência, dados, provisionamento, ordem de implementação.
- `docs/saas/prompt-painel-dono.md` — especificação das telas do painel do dono e do site de marketing (prompt para a IA de design).
- `docs/saas/api-plataforma.md` — rotas da API do painel do dono (`/api/platform/`).
- `docs/integracao-porto-seguro.md` — fluxo de login/navegação no Porto, heurísticas, worker.
- `docs/whatsapp-notificacoes.md` — Evolution API, tipos de notificação, número de teste.
- `docs/configuracoes.md` — campos das Configurações da organização e quem usa cada um.
- `docs/controle-de-pecas.md` — Venda de Peças: consignação, inventário, acerto, Mercado Pago (configuração do aplicativo, webhooks).
- `docs/saas/vps.md` — VPS compartilhada: containers e donos, agente, limpeza, implantação, capacidade.
- `docs/saas/porte-producao/` — prompt do porte de 06/10 (já aplicado) e units da limpeza da VPS.
- `docs/prompts/` — prompts de trabalho já executados ou para reaproveitar em outros projetos (configurações, assistente, WhatsApp na produção, venda de peças).
- `docs/notificacoes.md` — **também a caixa de alertas da equipe (dono e atendentes: `/plataforma/notificacoes` e sino do painel, migração `0048`, `lib/platform/notice-*.ts`)**; sino e página de notificações (`/admin/notificacoes`: Crítico, Atenção, Concluído, Aviso; limpar/restaurar por pessoa, migração `0039`): avisos da empresa (cobrança, chamados, Porto, folha, técnicos, peças, créditos, escala) e avisos gerais do NextRotta; como criar um novo.
- `docs/lgpd-seguranca-contratos.md` — LGPD, segurança e contratos: papéis, o que existe, o que o advogado revisa, riscos, fluxo de pedido de titular e de incidente.
- `docs/saas/equipe.md` — equipe da NextRotta (dono e atendentes): o que cada papel vê, como o dono gerencia, onde a regra mora (`lib/platform-access.ts`, `withPlatformStaff`).
- `docs/livechat.md` — Livechat (inclui **Casos** — tudo é caso, com tipo Suporte/Bug/Sugestão, tabela `bug_reports`, `lib/cases/` — e **Mensagens automáticas**, Reports → aba própria, `lib/livechat/auto-messages.ts`): chat ao vivo dos chamados urgentes + WhatsApp oficial (instância `nextrotta-suporte`, webhook `/api/webhooks/evolution`) numa caixa só em Reports → Livechat; limites e como conectar.
- `docs/whatsapp-oficial.md` — número e e-mail oficiais, foto, capa e descrição do WhatsApp Business (imagens em `public/brand/`).
- `docs/backups.md` — backups diários por empresa (00h, Blob privado, retenção do plano) e restauração pelo administrador.
- `docs/dashboard-gerencial.md` — critérios financeiros do dashboard gerencial.
- `docs/despesas.md` — Controle de despesas (`/admin/despesas`): contas a pagar e a receber, previsão, orçamento, avisos.
- `docs/faturamento.md` — relatório de Faturamento (mesmo visual e critérios do dashboard, sem despesas gerais).
- `docs/calculo-folha.md` — exemplo do cálculo da folha.
- `docs/assistente-ia.md` — assistente de IA (DeepSeek): consultas, créditos, sugestões.
- `docs/onboarding-cliente.md` — como entregar a plataforma a um cliente novo.
- `docs/custos-10-25-clientes.md` — estimativa de custos de infraestrutura para 10 a 25 clientes.

## Padrão de design das telas (admin e técnico)

Aprovado pelo dono em Folha, Faturamento, Despesas e Config. Porto. Vale para tela nova e para redesenho.

- **Pouco texto.** A tela mostra títulos, rótulos curtos e uma frase de estado. Toda explicação, regra ou exemplo vai atrás de um **"?" clicável** (`HelpDot`, `components/modal-kit.tsx`; `Panel` e `Metric` aceitam `help`). Nunca parágrafo sob título nem subtítulo de painel explicando. Estado vazio: uma linha.
- **Poucos números.** Só o que muda uma decisão; o resto vai para o detalhe.
- **Base visual:** página dentro de `.mg-dashboard` (`app/admin/dashboard-gerencial/management-dashboard.css`), cabeçalho com eyebrow, título e uma linha; blocos de `components/management-ui.tsx` (`Metric`, `Panel`, `Delta`, `Legend`, `ChartEmpty`); janelas com `components/modal-kit.tsx` (`MODAL_*`, `ModalSection`, `SummaryBand`, `SegmentedControl`, `ModalNotice`). CSS próprio da tela em arquivo com prefixo (`po-*`, `ex-*`), sempre sob `.mg-dashboard`.
- **Layout:** duas colunas no desktop que empilham no celular; o estado em uma frase no topo (hero) e os problemas como cartões, cada um com o botão que resolve.
- **Confirmação** em janela antes de qualquer ação irreversível ou que grava de verdade (fechar folha, ligar o robô valendo). Nada de `DELETE`: exclusão lógica.
- **Regra fora da tela:** cálculo e decisão em `lib/*.ts` sem dependências, com `scripts/test-*.cjs`; a tela só desenha.
- **Verificar como o usuário:** abrir no Chrome real (harness do Playwright com `/api/**` simulado por estado, e com os dados reais da `kappa`), desktop e celular, olhar as capturas e corrigir antes de dizer que terminou; `npx tsc --noEmit -p tsconfig.claude-check.json`; commit e push.
- **Processo:** usar as skills `frontend-design` e `ui-ux-pro-max` nos redesenhos; sem telas "em construção".
- **Vídeo tutorial:** cada tela do sistema da empresa com vídeo publicado (série `tutoriais-do-sistema`, YouTube não listado) mostra o botão roxo "Vídeo tutorial" no cabeçalho (`TutorialVideoButton page="..."`, `components/tutorial-video.tsx`; o modal e o player são os de Venda de Peças, `components/parts/admin/tab-video.tsx`; estilo `.nr-tutorial-button` em `styles/design-system.css`). Sem vídeo cadastrado em `TUTORIAL_VIDEOS`, o botão não aparece: ao publicar um vídeo novo, é só somar o id ali e pôr o botão no `PageHeader` da tela. Já ligados: Operação, Dashboard Gerencial e Serviços (03/11/2026).

## Convenções

- UI e mensagens ao usuário em português; código e comentários em inglês.
- Commits em inglês, no imperativo, descrevendo o comportamento.
- `.env` e `.env.local` contêm segredos: não ler nem commitar (ambos estão no `.gitignore`). Nunca imprimir chaves no chat (o ambiente bloqueia): para entregar uma chave ao dono, diga em que arquivo ela está.
- Armadilhas já vividas: se uma rota nova responder 404 em HTML no `pnpm dev`, apague `.next/dev` (cache do Turbopack); ao parar o dev server mate a árvore de processos; em arquivo montado por bind no Docker (Caddyfile) edite com `cat >`, nunca `sed -i` (troca o inode); script grande com aspas vai por arquivo (Write + python/node), não por heredoc.
- VPS: `ssh vps` (root, só por chave). Só `nextrotta-*`; `porto-*`, `essencialcentro-*` e `garimpo-*` são de outros projetos.
