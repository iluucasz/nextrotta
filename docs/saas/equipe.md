# Equipe da NextRotta (dono e atendentes)

Pessoas da própria NextRotta, **sem organização** (`users.organization_id` nulo). Não confundir com os usuários de uma empresa cliente.

| Papel | Valor em `users.role` | O que faz |
|---|---|---|
| Dono | `platform_owner` | Tudo: financeiro, planos, cupons, créditos, operação, configurações, auditoria, **Equipe**, entrar na conta das empresas. |
| Atendente | `platform_support` | **Reports** (chamados) e **Livechat**; vê as **organizações** só para consulta (contato, estado, usuários, chamados abertos); mexe na **própria conta e senha**. |

O atendente **não** vê dinheiro, planos, cupons, créditos, operação, configurações da plataforma, auditoria nem Equipe, **não entra na conta das empresas** e não conecta/desconecta o WhatsApp oficial.

## Como o dono gerencia

`/plataforma/equipe` (só o dono): **Novo atendente** (nome + e-mail; a senha temporária aparece uma vez), **Editar**, **Nova senha** (outra temporária, a antiga deixa de valer), **Desativar/Reativar**. Ninguém é apagado: desativar derruba a sessão na próxima requisição (o cookie deixa de valer) e o login passa a recusar. Só se criam atendentes por aqui; o dono é um só e se edita em Configurações → Minha conta.

No primeiro acesso (e depois de "Nova senha") a janela `PasswordGate` impede de usar o painel até a pessoa escolher a própria senha (mínimo 8 caracteres, diferente da temporária).

## Onde a regra mora (negar por padrão)

- `lib/platform-access.ts` — papéis, `mayOpenPanelPath` (quais páginas do painel cada papel abre); sem dependências, usado pelo middleware, pelo painel e pelo teste.
- `middleware.ts` — na raiz só `platform_owner`/`platform_support` têm sessão; o atendente é mandado para `/plataforma/reports` em qualquer página fora da lista.
- `lib/platform/route.ts` — `withPlatformOwner` continua **só do dono** (atendente recebe 403, e a tela não o manda ao login); `withPlatformStaff` abre uma rota à equipe toda; `requireOwnerRole` para métodos de uma rota aberta que são só do dono. **Rota nova nasce só do dono**: abrir ao atendente é decisão explícita.
- Abertas à equipe: `/bugs/*`, `/livechat/*` (o `whatsapp` só no GET), `/account`, `/organizations` (GET, com visão reduzida decidida na API: `listOrganizationsForSupport` / `getOrganizationForSupport` em `lib/platform/organizations.ts`).
- `lib/platform/team.ts` e `/api/platform/team/*` — criar, editar, desativar, nova senha; auditoria `team.*` (o `actor_role` das ações do atendente em chamados e conta é o dele).
- Painel: `components/platform/role.tsx` (contexto do papel), `team.tsx` (tela Equipe e telas de empresas do atendente), menu por papel em `shell.tsx`.

Migração `0044`: aceita o papel e exige organização nula para os dois papéis da plataforma.

Teste: `node scripts/test-platform-team.cjs` (regras de acesso, criação, senha temporária, desativação, o que cada papel chama, visão reduzida sem valores).
