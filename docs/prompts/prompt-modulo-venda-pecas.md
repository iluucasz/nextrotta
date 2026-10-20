# Prompt — Módulo de venda de peças pelo técnico (para reaproveitar em outro projeto)

> Origem: NextRotta (`c:\Users\iluuc\Documents\sistema-operacional`). Este arquivo tem duas partes:
> **A)** o prompt para colar numa IA/dev no projeto de destino; **B)** o mapa de onde consultar o código aqui.
> A IA do projeto de destino deve **ler** os arquivos listados na parte B (caminhos relativos à raiz do NextRotta) e **portar**, não copiar às cegas — a seção "O que é específico do NextRotta" diz o que trocar.
> Spec funcional completa já escrita: `docs/controle-de-pecas.md` (leia primeiro).

---

## A) Prompt

Você vai implementar, neste projeto, um módulo de **venda de peças em consignação pelo técnico de campo**, portando um módulo que já existe e foi testado em outro sistema (NextRotta). Leia os arquivos de referência indicados na parte B antes de escrever código. Adapte à stack, às convenções e ao modelo de usuário/organização deste projeto; não invente regras novas sem perguntar.

### O que o módulo faz

Uma empresa mantém um **estoque central** de peças e entrega peças a cada técnico em **consignação** (o carro do técnico é uma "filial"). O técnico vende ao cliente final pelo celular, **pelo preço que quiser**, recebe o dinheiro **na própria conta do Mercado Pago** e **deve à empresa o "preço de técnico"** do que vendeu. Isso é uma venda de peças ao técnico — **não é comissão** e fica fora da folha de pagamento.

### Regras de negócio (manter)

1. **Três preços por peça:** `custo` (o que a empresa pagou), `preço de técnico` (o que o técnico deve por unidade vendida) e `preço sugerido` (ao cliente). Os preços de cada venda são **copiados** para os itens da venda; editar a peça depois não altera vendas passadas. Exemplo: custo 50, técnico 75, sugerido 100.
2. **Estoque nunca é um número gravado.** É a soma de `part_movements` (tabela **só de inserção**; `technician_id` nulo = estoque central). Tipos de movimento: remessa, devolução, venda, cancelamento de venda, ajuste de inventário. Todo movimento guarda custo/preço unitário da época.
3. **Conta do técnico** = soma de `part_account_entries` (também só inserção), com `due_month` (`YYYY-MM`). Venda lança o preço de técnico; cancelar a venda lança o estorno. Saldo do mês = tudo que venceu até o mês − o que foi pago. O desconto na folha é manual; o módulo não mexe na folha.
4. **Remessa (`out`) e devolução (`return`)** são documentos numerados por empresa (`part_transfers`); o técnico **confirma cada uma no app** (`acknowledged_at` + IP) e o admin imprime o termo.
5. **Venda (`part_sales` + `part_sale_items`)**: número sequencial por empresa (com retry em colisão: `withNumberRetry`); só vende o que o técnico tem em estoque (409 com a lista do que falta); a mesma peça com dois preços na mesma venda é erro; **WhatsApp do cliente é obrigatório** (valida e grava em E.164); nome do cliente, código de OS e observação são opcionais. Criar a venda numa **única transação**: venda + itens + movimentos de saída + lançamento na conta.
6. **Status da venda:** `awaiting_payment` → `paid` | `canceled`. Técnico cancela só venda **não paga**; venda paga só o admin cancela (estorno ao cliente é feito no Mercado Pago). Cancelar devolve estoque e conta.
7. **Formas de pagamento** (configuráveis por empresa, `parts_settings.payment_methods`): `pix`, `card_link`, `card_present`, `cash`.
8. **Conta do Mercado Pago conectada é obrigatória para qualquer venda**, inclusive "dinheiro" (`createSale` recusa com 409 e a tela bloqueia o botão "Cobrar"). Para formas MP, total mínimo R$ 1,00; falha ao cobrar **não desfaz a venda** — grava `payment_error` e a tela oferece "tentar de novo" ou trocar o método (cada nova cobrança incrementa `payment_attempts`, usado na chave de idempotência).
9. **Marcar como recebido manualmente** ("Recebi de outra forma") grava `payment_confirmed_by = 'technician'`, destacado para o admin; confirmação pela API grava `'mercadopago'`.
10. **Técnico nunca vê o custo** da empresa (remova `totalCost`/`cost_price` das respostas ao técnico).
11. **Inventário** por leitura de código de barras (cada leitura soma 1, ou digita); ao encerrar o estoque vira o contado; falta pode ser **cobrada** (vira `part_debts` parcelado na conta) ou **assumida pela empresa**. Só um inventário aberto por escopo.
12. **Nada é excluído**: exclusão lógica (`deleted_at`/`deleted_by`) nas entidades editáveis; movimentos e lançamentos são imutáveis (correção = novo lançamento).

### Pagamento — Mercado Pago na conta do técnico

- **Um** aplicativo da plataforma no Mercado Pago; **cada técnico conecta a própria conta** por **OAuth com PKCE**. `state` de uso único em `mercadopago_oauth_states`; callback no domínio raiz. Tokens **cifrados em repouso** (AES com `MERCADOPAGO_TOKEN_KEY`), renovados 7 dias antes de vencer (duram 180 dias). O dinheiro é sempre do técnico.
- **Pix:** `POST /v1/orders` (`type: online`, expira em 60 min) → QR + copia-e-cola; a tela consulta a cada 4 s.
- **Link de cartão:** Checkout Pro (`/checkout/preferences`, sem boleto, expira em 24 h, `external_reference` = id da venda).
- **Maquininha Point (modo PDV):** `POST /v1/orders` (`type: point`, `terminal_id`). **Sem maquininha** (Point Tap no app do MP): botão **"Conferir pagamento"** procura na conta do técnico um pagamento aprovado de **mesmo valor, feito depois da venda e ainda não ligado a outra venda** (janela de 6 h; `mp_payment_id` tem índice único).
- **Webhook público** `POST /api/webhooks/mercadopago`: **nada do corpo é confiável** — ele só diz qual venda conferir; a conferência pergunta ao MP com o token do técnico. Valida `x-signature` quando presente e há `MERCADOPAGO_WEBHOOK_SECRET`. Grava todo evento em `mercadopago_webhook_events` (com erro/processado) e responde 500 em falha para o MP reenviar. Idempotente.
- Em dev (`localhost`) o MP não alcança o webhook; a confirmação vem das consultas da tela.

### Mensagens ao cliente

- Link de pagamento (Pix: link + copia-e-cola em mensagem só dele) e **recibo** após pago, pelo **WhatsApp da empresa** (Evolution API), com histórico e dedupe (`dedupeKey`). Rodapé do recibo configurável.
- **Fallback:** se o WhatsApp da empresa não está conectado/disponível, a tela oferece **"Enviar pelo meu WhatsApp"** (link `wa.me` com o texto pronto).

### Telas

- **Técnico** `/dashboard/pecas` ("Minhas peças"): cartão de conexão do Mercado Pago (conectar/desconectar/escolher maquininha), pendências de confirmação (remessas, devoluções, débitos), **painel de venda** (buscar peça/ler código de barras, quantidades, preço por item, checkout com cliente + WhatsApp + OS + forma de pagamento), **painel de pagamento** (QR Pix, link, status, tentar de novo, conferir pagamento, recebi, enviar por WhatsApp), minhas vendas, resumo da conta do mês.
- **Admin** `/admin/pecas`: visão geral, catálogo/estoque (com imagem, importação, detalhe da peça), técnicos (remessas/devoluções, termo), vendas, inventário, acerto (pagamentos e débitos), configurações.
- **Leitor de código de barras** no navegador: `BarcodeDetector` nativo e, onde não existe, o pacote `barcode-detector` (ZXing WASM, carregado sob demanda). Exige HTTPS. Leitor USB/Bluetooth funciona como teclado; sempre dá para digitar.
- Imagens da peça: reduzidas a 800 px em JPEG no cliente antes do envio; armazenamento privado servido por rota que confere permissão.

### Entregáveis

1. Migração SQL (tabelas da parte B), com índices únicos citados.
2. Camada de regras (`parts/*`) e cliente Mercado Pago (`mercadopago/*`).
3. Rotas de API (admin / técnico / webhook / OAuth).
4. Telas do técnico e do admin.
5. Teste ponta a ponta: venda Pix, venda com falta de estoque, cancelamento, webhook duplicado, técnico sem conta MP, isolamento entre técnicos (técnico A não vê nem vende estoque do B).
6. Lista do que ficou de fora ou ainda não foi testado com o Mercado Pago real.

### O que é específico do NextRotta (trocar no projeto de destino)

| No NextRotta | No projeto novo |
|---|---|
| `organization_id` em todas as tabelas, `verifyOrganizationAuth()` | Seu modelo de tenant/empresa e sua autenticação. Se não há multi-empresa, remova a coluna e os filtros — mas mantenha a mesma lógica |
| `blockUnlessFeature(org, 'parts')` e tabela `features`/planos | Seu controle de plano/permissão (ou remova) |
| `recordAudit` (`lib/audit.ts`) | Seu log de auditoria |
| `technicians` + `auth.technicianId` | Seu cadastro de técnicos e a ligação usuário→técnico |
| `sql` de `@neondatabase/serverless` (`sql.transaction([...])`) | Seu acesso ao banco; **a criação de venda precisa ser transacional** |
| WhatsApp: `lib/whatsapp/*` (instância Evolution por empresa, `claimMessage/finishMessage`) | Seu envio de WhatsApp; mantenha o fallback `wa.me` |
| View `organization_files` e Blob privado para imagens | Seu storage; a regra é: privado, servido por rota que confere permissão |
| Personificação do dono (`impersonationId`) em `PartsActor` | Pode remover |
| `ui` shadcn, Tailwind 4, textos em PT-BR | Componentes e idioma do projeto |

---

## B) Onde consultar o código (raiz: `c:\Users\iluuc\Documents\sistema-operacional`)

Ordem sugerida de leitura: spec → migração → tipos → regras → Mercado Pago → rotas → telas.

### Especificação e schema
- `docs/controle-de-pecas.md` — modelo, pagamento, webhook, configuração do MP, leitor de código.
- `db/migrations/0023_parts_control.sql` — tabelas: `parts`, `part_images`, `part_transfers`, `part_sales`, `part_sale_items`, `part_inventories`, `part_inventory_items`, `part_debts`, `part_movements`, `part_account_entries`, `parts_settings`, `mercadopago_accounts`, `mercadopago_oauth_states`, `mercadopago_webhook_events` + view `organization_files` (específica do NextRotta).

### Regras (`lib/parts/`)
| Arquivo | Para quê |
|---|---|
| `types.ts` | Rótulos, métodos de pagamento (`MERCADOPAGO_METHODS`), `parseAmount` — sem dependências, portar primeiro |
| `common.ts` | `PartsError`, `money`, `parseQuantity`, `withNumberRetry`, `requireTechnician`, mês `YYYY-MM` |
| **`sales.ts`** | **Núcleo do módulo de venda.** `createSale` (l.185), `startPayment`, `retryPayment`, `checkPayment` (Pix/link/Point/"Conferir pagamento"), `confirmReceived`, `cancelSale`, `paymentMessage`/`receiptMessage`, `sendPaymentLink`/`sendReceipt`, `handleMercadoPagoNotification` (webhook) |
| `stock.ts` | `getStock` (soma de movimentos), remessas/devoluções, inventário |
| `account.ts` | Conta do técnico, saldo do mês, débitos parcelados, pagamentos |
| `catalog.ts` | Peças, imagens, importação, `getPartsSettings`, `listTechnicianParts` |
| `notify.ts` | `sendCustomerMessage` (WhatsApp da empresa) + `whatsappShareUrl` (fallback `wa.me`) |
| `route-helpers.ts` | `partsContext` (sessão + papel + técnico), `partsError`, `readJson` |
| `detail.ts`, `overview.ts` | Detalhe da peça e visão geral do admin (só admin) |

### Mercado Pago (`lib/mercadopago/`)
| Arquivo | Para quê |
|---|---|
| `config.ts` | Variáveis de ambiente, **cifra/decifra dos tokens** (`encryptToken`/`decryptToken`) |
| `client.ts` | REST do MP: PKCE/OAuth, `createPixOrder`, `createPointOrder`, `getOrder`, `orderOutcome`, `createPaymentLink`, `searchRecentApprovedPayments`, terminais, `verifyWebhookSignature` |
| `accounts.ts` | Conexão do técnico: `startConnection`, `finishConnection`, `getAccessToken` (renova token), `getTerminals`, `chooseTerminal`, `disconnect` |

Variáveis: `MERCADOPAGO_CLIENT_ID`, `MERCADOPAGO_CLIENT_SECRET`, `MERCADOPAGO_TOKEN_KEY` (`openssl rand -base64 32`), `MERCADOPAGO_WEBHOOK_SECRET`, opcionais `MERCADOPAGO_REDIRECT_URI`, `MERCADOPAGO_WEBHOOK_URL`, `MERCADOPAGO_FALLBACK_PAYER_EMAIL`. Configuração do aplicativo no MP Developers: `docs/controle-de-pecas.md`, seção "Configurar o Mercado Pago".

### API
- Venda: `app/api/parts/sales/route.ts`, `app/api/parts/sales/[id]/route.ts`
- Tela do técnico (uma chamada traz tudo): `app/api/parts/me/route.ts`
- Estoque/remessas/inventário/conta: `app/api/parts/{stock,transfers,movements,inventories,account,debts,overview,settings,lookup,import}/`, `app/api/parts/route.ts`, `app/api/parts/[id]/{route,image}`
- Mercado Pago: `app/api/mercadopago/{account,oauth/callback,terminals}/route.ts`
- Webhook: `app/api/webhooks/mercadopago/route.ts` (público; exceção no `middleware.ts`)

### Telas
- Técnico: `app/dashboard/pecas/page.tsx` → `components/parts/technician-parts.tsx` (`MercadoPagoCard`, `SellPanel`, `CheckoutForm`, `MySales`, `PendingConfirmations`/`TransferReview`/`DebtReview`) e `components/parts/payment-panel.tsx` (`PaymentPanel`)
- Compartilhado: `components/parts/shared.tsx` (`BarcodeScanner`, `PartImage`, `Field`, `Alert`, `useParts`)
- Admin: `app/admin/pecas/page.tsx` → `components/parts/admin/{overview,catalog,technicians,sales,inventory,account,settings}-tab.tsx`
- Navegação e gate de plano: `components/app-shell.tsx` (linhas ~70, 90–91, 164)

### Pontos de atenção (aprendidos ao construir)
- O **webhook nunca confia no corpo**: sempre reconsulta o MP com o token do técnico dono da venda.
- `mp_payment_id` com **índice único parcial** evita ligar o mesmo pagamento a duas vendas.
- A numeração sequencial por empresa precisa de **índice único + retry** (`withNumberRetry`), senão duas vendas simultâneas colidem.
- Falha de cobrança **não pode derrubar a venda** — grava `payment_error` e permite retentar.
- Renovação de token: tratar autorização expirada com mensagem clara ("reconecte sua conta").
- O Mercado Pago **real nunca foi testado** no NextRotta (faltavam as variáveis e o aplicativo): valide Pix, link, Point e webhook em sandbox/produção antes de confiar.
