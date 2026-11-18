# Desempenho

Análise de 18/11/2026 a partir de uma lista genérica de otimizações, separada em: **já existia**, **feito agora**, **fica para depois** (com o motivo) e **não se aplica**.

## Já existia

- Skeleton de carregamento: `LoadingShell` (`components/page-skeleton.tsx`) em todas as telas da empresa.
- Índices por `organization_id` + competência/data nas tabelas de domínio (migrações `0001`–`0066`).
- Timeout nas chamadas externas: DeepSeek, Mercado Pago, Evolution, VPS, worker, sistema de status.
- Chamadas em paralelo onde são independentes (`/api/organization/status` usa `Promise.all`); estado da empresa guardado uma vez por carregamento (`cachedOrganizationStatus`).
- Colunas explícitas nos `SELECT` das rotas de listagem; `sql.transaction` nas gravações com várias linhas.
- Lazy load do `xlsx` nas telas de despesas, faturamento e dashboard; `jspdf` carregado sob demanda.
- Fontes próprias via `next/font` (sem pedido a terceiros); nenhum script de terceiros além do Vercel Analytics.
- Banco pelo driver HTTP do Neon (sem conexão persistente: **pool de conexões não se aplica**; o host já é o `-pooler`).

## Feito agora

- **Região das funções na Vercel = `gru1` (São Paulo)** em `vercel.json`. O banco (Neon `sa-east-1`) e o Blob (`gru1`) já estão em São Paulo; sem isso as funções rodam no padrão da Vercel (Washington) e cada consulta atravessa o continente (várias por requisição). Conferir em Settings → Functions que o projeto não está com outra região fixada lá.
- **Sessão no cliente** (`lib/client-auth.ts`, `hooks/use-app-session.ts`): cada tela perguntava `/api/auth/me` ao abrir (uma ida ao servidor + uma consulta ao banco por navegação). Agora a resposta vale 30 s dentro do app e pedidos simultâneos dividem uma só chamada. Só guarda login confirmado; nunca no servidor; toda troca de sessão (login, sair, preview, sair do modo dono) termina em recarga completa, que zera o cache; as rotas de dados continuam conferindo a sessão sozinhas. Teste: `scripts/test-client-session-cache.cjs`.
- **Histórico de OS** (`app/admin/services/page.tsx`): o texto pesquisável de cada OS é calculado uma vez por lista (antes, a cada tecla, para todas as linhas), a busca usa `useDeferredValue` e a tabela desenha 100 linhas por vez ("Mostrar mais"); os totais continuam somando o filtro inteiro.
- **Timeout de 25 s no Asaas** (`lib/billing/asaas.ts`), com mensagem em português.
- **`xlsx` só ao exportar/importar** em todas as telas: Peças, histórico do WhatsApp, importação de OS e importação/exportação da Escala. `lib/spreadsheet-import.ts` (`readSpreadsheet` agora é assíncrona) carrega a biblioteca sob demanda; as telas de OS e Escala guardam o módulo em uma variável do arquivo (`sheetjs`) preenchida ao ler a planilha, que os ajudantes de data do Excel usam. Teste: `scripts/test-spreadsheet-import.cjs`.
- **Busca adiada (`useDeferredValue`)** também no registro da Escala, no catálogo de peças e nas OS do técnico; as OS do técnico desenham 100 linhas por vez, como as da admin (o registro da Escala já pagina).
- **Dependências sem uso removidas:** `@hookform/resolvers`, `autoprefixer`, `date-fns`, `jwt-decode`, `papaparse`.

## Fica para depois

| Item | Por que ainda não |
| --- | --- |
| Paginar `GET /api/services` | A admin (início, OS, faturamento) e a folha leem a lista inteira para somar no cliente. Paginar exige mover totais e filtros para o servidor; fazer junto com o primeiro cliente que passar de alguns milhares de OS. |
| Streaming da resposta do assistente | Os créditos são cobrados pelo uso real, que só vem no fim da resposta; precisa redesenhar a cobrança. Só no Pro. |
| Recharts sob demanda | Os gráficos estão dentro do JSX das telas (dashboard gerencial, faturamento, início do técnico); separar exige extrair componentes e só se confere olhando as telas no Chrome com uma empresa real. |
| Timeout no cliente do worker do Porto | As rotas já têm `maxDuration` da Vercel; um timeout nosso daria só uma mensagem melhor e confundiria com "worker em manutenção". |
| Speed Insights (`@vercel/speed-insights`) | Mede a velocidade dos usuários reais, mas é cobrado por evento no Pro; o dono decide. |
| Cache em Redis / memória | Sem medição de gargalo; cache por organização é risco de vazar dado entre clientes. Medir antes. |
| OpenTelemetry | A aba Observability da Vercel (Pro) já mostra as funções lentas. |
| `ensure`/N+1 | Não há N+1 nas rotas lidas; os laços com `await sql` (`lib/platform/bugs.ts`, `features.ts`) são de poucas linhas. |

## Observação sobre o build local

`next build` na máquina do dono compila (Turbopack) e depois falha ao pré-renderizar (`Invariant: Expected workStore to be initialized`, em páginas como `/admin/apps/carros` e `/admin/technicians`). Acontece também no commit anterior a estas mudanças (`9ce60f6`), então não vem delas. O passo "Compiled successfully" é o que valida imports dinâmicos; o `tsc` segue sendo a verificação principal.

## Não se aplica

Brotli/Gzip e CDN (a Vercel já entrega), imagens em WebP/AVIF (as imagens do sistema são anexos privados e QR codes servidos pela API; as do site são do território da IA de design), fila para tarefas lentas (já existe: o worker faz Porto, WhatsApp, cobrança e backups), distribuir tráfego entre instâncias (a Vercel escala as funções).
