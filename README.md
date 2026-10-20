# NextRotta

Plataforma SaaS multi-cliente, por assinatura, para gestão de equipes técnicas em campo: técnicos, serviços (OS), escala, horas, folha, financeiro, controle de peças, automação do Portal do Prestador (Porto Seguro), notificações por WhatsApp e assistente de IA.

Cada empresa-cliente (organização) tem o próprio endereço, `<slug>.nextrotta.com.br`, e os dados ficam isolados por `organization_id` num banco único. O dono da plataforma administra tudo pelo painel em `/plataforma`.

## Stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, shadcn/ui
- Postgres no Neon (`@neondatabase/serverless`, SQL cru) com migrações versionadas
- Auth própria (JWT + bcrypt), cobrança pelo Asaas, IA pela DeepSeek, arquivos no Vercel Blob
- Worker em Docker (`worker/`) para as automações do Porto (Playwright) e envios de WhatsApp; agente da VPS em `vps-agent/`

## Como rodar

Requisitos: Node 20+ e pnpm.

```bash
pnpm install
cp .env.example .env.local   # preencha ao menos DATABASE_URL e JWT_SECRET
pnpm db:migrate              # aplica db/migrations/*.sql
pnpm platform:create-owner --email <e-mail> --name "<nome>"
pnpm dev
```

Em desenvolvimento acesse `http://nextrotta.localhost:3000` (login e painel do dono) e `http://<slug>.nextrotta.localhost:3000` (cada organização). Não use `localhost:3000` puro.

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Servidor Next.js |
| `pnpm db:migrate` / `pnpm db:status` | Aplica / lista as migrações |
| `pnpm platform:create-owner` | Cria o dono da plataforma |
| `pnpm platform:create-org` | Cria uma organização com o primeiro admin |
| `npx tsc --noEmit` | Verificação de tipos (o build ignora erros de tipo) |
| `node scripts/test-management-dashboard.cjs` | Teste dos cálculos do dashboard gerencial |
| `cd worker && npm run build` | Compila o worker |

## Estrutura

```
app/            Rotas: admin/, dashboard/ (técnico), plataforma/ (dono), site/ (marketing), api/
components/     UI: platform/ (painel do dono), site/, assistant/, ui/ (shadcn)
lib/            Regras de negócio, auth, cobrança (billing/), IA (ai/), Porto, WhatsApp, plataforma
db/migrations/  Schema versionado (nunca edite uma migração já aplicada)
worker/         Automações (Porto, WhatsApp, cobrança, métricas) — roda na VPS
vps-agent/      Agente de leitura/limpeza da VPS
scripts/        Migração, criação de dono/organização, backup/restore de tabelas
docs/           Documentação por assunto (ver abaixo)
```

## Documentação

- `CLAUDE.md` — estado do projeto, decisões de arquitetura e regras de trabalho
- `docs/saas/visao-geral.md` — desenho completo do SaaS (papéis, planos, créditos, inadimplência, dados)
- `docs/saas/api-plataforma.md` — rotas da API do painel do dono
- `docs/saas/vps.md` — VPS compartilhada, agente, limpeza, implantação
- `docs/configuracoes.md`, `docs/calculo-folha.md`, `docs/dashboard-gerencial.md` — regras de negócio
- `docs/integracao-porto-seguro.md`, `docs/whatsapp-notificacoes.md`, `docs/assistente-ia.md`, `docs/controle-de-pecas.md` — integrações e módulos
- `docs/prompts/` — prompts de trabalho já executados ou reaproveitáveis

## Princípios

- Toda query de domínio filtra por `organization_id`.
- Nada é excluído: exclusão lógica (`deleted_at`/`deleted_by`) com lixeira e auditoria; não há `DELETE FROM` no código.
- Preços, limites e recursos dos planos ficam no banco, nunca no código.
- Segredos só em `.env`/`.env.local` (fora do git); `.env.example` lista as variáveis esperadas.

## Licença

Proprietário.
