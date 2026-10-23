# Venda de Peças

Módulo de vendas de peças em **consignação** com os técnicos (criado como "Controle de Peças"; o arquivo manteve o nome). Recurso de plano `parts` ("Venda de Peças"). Fica **fora da folha**: não é comissão, é venda de peças ao técnico. Atualizado em 22–23/10/2026 com tudo o que a produção (Central Operacional) ganhou no módulo, já por organização.

## Multi-cliente (o que é só do NextRotta)

- Toda tabela do módulo tem `organization_id`, e **toda consulta filtra por ele**. Número sequencial de venda/remessa/inventário/débito é **por organização** (índice único `(organization_id, number)`).
- Recurso de plano `parts`: `partsContext` (`lib/parts/route-helpers.ts`) chama `blockUnlessFeature(organizationId, 'parts')`; as páginas `/admin/pecas` e `/dashboard/pecas` seguem o plano (`components/app-shell.tsx`). **Hoje o recurso não está em nenhum plano**: o dono escolhe em Planos. Organização sem assinatura não tem restrição.
- Imagens: Vercel Blob **privado** em `parts/<organização>/…`, limite `storageMb` conferido no envio (`checkLimit`), contadas pela view `organization_files`.
- **Mercado Pago:** **um** aplicativo da plataforma; cada técnico de cada organização conecta a **própria** conta (OAuth com PKCE). A URL de retorno é **uma só, na raiz do domínio** (o Mercado Pago não aceita curinga): o callback (`app/api/mercadopago/oauth/callback`) acha a organização pelo `state` (`mercadopago_oauth_states.organization_id`) e devolve o técnico ao subdomínio dela. No webhook, a organização vem da **conta** (`mp_user_id` → `mercadopago_accounts`) ou da própria venda, nunca do corpo da requisição.
- Endereços (retorno do OAuth, webhook, e-mail do pagador no Pix) saem de `ROOT_DOMAIN` (não há `APP_URL` aqui); `MERCADOPAGO_REDIRECT_URI`, `MERCADOPAGO_WEBHOOK_URL` e `MERCADOPAGO_FALLBACK_PAYER_EMAIL` sobrescrevem.
- Auditoria: `recordAudit` (`lib/audit.ts`, tabela `audit_events`) com `organization_id`; não existe `parts_audit_log` aqui.
- WhatsApp ao cliente: instância Evolution **da organização** (`lib/parts/notify.ts`), e só com o recurso `whatsapp` no plano.
- **Nome da empresa** (mensagem de pagamento, recibo, termo impresso): `parts_settings.company_name` (Ajustes). Em branco, vale o nome da organização (`getCompanyName` em `lib/parts/catalog.ts`).

## Modelo

- Cada peça tem **custo** (o que a empresa pagou), **preço de técnico** (o que o técnico deve por unidade vendida) e **preço sugerido** (ao cliente final). Exemplo: custo R$ 50, técnico R$ 75, sugerido R$ 100. Os preços de cada venda são copiados para os itens da venda: editar a peça depois não altera vendas passadas.
- **Estoque central** + **um estoque por técnico** (o "carro"). Estoque nunca é um número gravado: é a soma de `part_movements` (só inserção), então cada unidade tem rastro. `technician_id` nulo = estoque central.
- **Remessa** (`part_transfers`, `direction = out`): central → técnico, em consignação. **Devolução** (`return`): técnico → central. O técnico confirma cada uma no app (`acknowledged_at` + IP) e o admin imprime o termo.
- **Venda** (`part_sales`): o técnico vende do próprio estoque, **pelo preço que quiser** (não pode ser zero). A peça sai na hora e a **conta do técnico** (`part_account_entries`) recebe o preço de técnico. Cancelar devolve as duas coisas. O técnico só cancela venda não paga (e, em Pix/link, o sistema confere antes no Mercado Pago se o cliente acabou de pagar: se pagou, recusa com 409); venda paga, só o admin cancela (o estorno ao cliente é feito no Mercado Pago).
- Valores digitados no padrão brasileiro: `parseAmount` lê "1.500" como mil e quinhentos (antes virava R$ 1,50).
- **Inventário** (`part_inventories`): contagem por código de barras (cada leitura soma 1) ou digitada. Ao encerrar, o estoque passa a ser o que foi contado. A falta no carro de um técnico pode ser **cobrada** (vira `part_debts` parcelado na conta) ou **assumida pela empresa** (ex.: roubo com boletim de ocorrência). O histórico tem busca e filtros.
- **Acerto**: o saldo do mês é tudo o que venceu até o mês menos o que foi pago. O admin registra o pagamento (Pix, dinheiro, transferência, desconto acordado). O desconto na folha é **manual**: o saldo de peças não entra no cálculo da folha. Cancelar um débito cancela as parcelas a partir de um mês; as anteriores continuam devidas.
- **Nove abas** no admin (`/admin/pecas`, a aba fica no hash da URL): Resumo, Vendas, Peças, Movimentações, Técnicos, Inventário, Acerto, Financeiro, Ajustes.
- A aba **Movimentações** lista todas as linhas de `part_movements` (central e técnicos), com filtro por período, local, tipo e busca, totais do filtro (compras, remessas, devoluções, vendas, ajustes), paginação e exportação. Vem de `GET /api/parts/movements` (`listMovements` em `lib/parts/stock.ts`); a remessa gera duas linhas (saída do central e entrada no técnico), com o mesmo número de termo.
- A aba **Financeiro** (`/api/parts/finance`, `lib/parts/finance.ts`) mostra o resultado para a organização, mensal ou anual, comparado ao período anterior: faturamento (preço de técnico), lucro bruto e margem, vendido aos clientes, custo das peças vendidas, caixa (recebido dos técnicos, compras de peças, resultado de caixa), perdas por faltas assumidas e a posição atual (saldo em aberto e estoque a custo). Critérios: vendas por mês da venda, sem canceladas; custo gravado em cada item da venda; recebido = pagamentos do Acerto no dia do registro; compras = entradas × custo unitário; perdas = faltas de inventário do estoque central ou com `resolution = absorb`, ao custo atual da peça; saldo e estoque são posição, não fluxo. Quatro seções (Visão geral, Técnicos, Peças, Caixa), filtro por técnico (compras e estoque central, que são da organização toda, saem da conta quando há técnicos selecionados), atualização a cada minuto e exportação em planilha.
- O técnico **nunca vê o custo** da organização (as rotas tiram `totalCost`/`unitCost` das respostas dele).
- Nada é excluído: exclusão lógica nas peças; movimentos e lançamentos são imutáveis (correção = novo lançamento).
- Botão **"Ver vídeo"** (admin, por aba, e técnico): `components/parts/admin/tab-video.tsx`, player próprio sobre o YouTube em modal. Os vídeos são os do Central Operacional, reaproveitados com a aprovação do dono (mostram a marca dele); sem id, o botão não aparece. Trocar `TAB_VIDEOS` e `TECHNICIAN_VIDEO` quando houver gravações do NextRotta.

## Integridade (o que o código garante)

- Criar uma venda é **uma única transação**: venda + itens + movimentos de saída + lançamento na conta.
- Antes de tirar unidades, a transação **trava o estoque** (`lockStock`: `pg_advisory_xact_lock` por organização e estoque) e **reconfere** com a função `parts_require_units` (migração `0024`, erro `P0409` → 409). Dois toques em "Cobrar", ou dois aparelhos, nunca vendem a mesma unidade duas vezes. Vale também para remessas e ajustes negativos (`lib/parts/common.ts`: `lockStock`, `requireUnits`, `runStockTransaction`).
- Cancelar uma venda é uma transação só (status + estoque + conta). Índices únicos `part_movements (sale_id, part_id)` (`sale` e `sale_canceled`) e `part_account_entries (sale_id)` (`sale_canceled`) fazem um segundo cancelamento simultâneo falhar e desfazer tudo (responde 409).
- Número sequencial: `MAX(number)+1` por organização com índice único e `withNumberRetry`.
- `mp_payment_id` tem índice único parcial: um pagamento do Mercado Pago quita no máximo uma venda.

## Pagamento — Mercado Pago na conta do técnico

O dinheiro da venda é sempre do técnico. Os tokens ficam cifrados (AES-256-GCM, `MERCADOPAGO_TOKEN_KEY`) em `mercadopago_accounts` e são renovados 7 dias antes de vencer (duram 180 dias). O `state` do OAuth é de uso único e vale 15 min.

| Forma | Como funciona | Confirmação |
|---|---|---|
| Pix (QR Code) | `POST /v1/orders` (`type: online`, expira em 60 min). A tela mostra o QR e o copia e cola; se o QR (1 h) ou o link (24 h) vencer, a tela avisa e oferece gerar outro. O nome do pagador sempre vai (o cliente sem nome vira "Cliente"): pedidos de Pix sem nome voltavam `processing_error`. | webhook `order` + a tela consulta a cada 4 s |
| Link de cartão | Checkout Pro (`/checkout/preferences`, sem boleto, expira em 24 h, `external_reference` = id da venda). | webhook `payment` + consulta |
| Cartão na maquininha ou no celular | Com maquininha Point escolhida pelo técnico (modo PDV): `POST /v1/orders` (`type: point`). Sem maquininha: o técnico cobra pelo app do Mercado Pago (Point Tap) e toca em **Conferir pagamento**, que procura na conta dele um pagamento aprovado de mesmo valor, feito depois da venda (janela de 6 h) e ainda não ligado a outra venda. | webhook/consulta, ou "Conferir pagamento" |
| Dinheiro / registro manual | Sem cobrança pelo Mercado Pago. | o técnico marca "Recebi" |

- **A conta do Mercado Pago conectada é obrigatória para qualquer venda**, inclusive a registrada como dinheiro: `createSale` recusa (409) o técnico sem conta conectada e a tela bloqueia "Cobrar". Para formas do Mercado Pago o total mínimo é R$ 1,00.
- Falha ao cobrar **não desfaz a venda**: grava `payment_error` e a tela oferece "tentar de novo" ou trocar o método. Cada nova cobrança incrementa `payment_attempts`, que entra na chave de idempotência (`pix-<venda>-<tentativa>`, `link-<venda>-<tentativa>`), então tentar de novo depois de um Pix expirado cria um pedido novo.
- **Sem chave Pix, o Pix falha:** a API não oferece como consultar se a conta tem chave, e a criação do pedido volta `402` com `processing_error`. O sistema não bloqueia antes: reconhece esse erro em `paymentFailureMessage` (`lib/parts/sales.ts`) e mostra ao técnico a orientação "Pix > Minhas chaves". O motivo real da recusa (campo `details` da Orders API) entra na mensagem e o `x-request-id` fica no log `[mercadopago]` do servidor, para o suporte do Mercado Pago.
- "Recebi de outra forma" grava `payment_confirmed_by = technician` (destacado para o admin); confirmação pela API grava `mercadopago`.
- **Webhook** `POST /api/webhooks/mercadopago` (público no `middleware.ts`, corpo de até 64 KB). Nada do corpo é confiável: ele só diz qual venda conferir, e a conferência pergunta ao Mercado Pago com o token do técnico daquela venda. Se `MERCADOPAGO_WEBHOOK_SECRET` estiver definido e vier `x-signature`, assinatura errada é recusada (401). Todo evento fica em `mercadopago_webhook_events` (com erro/processado) e uma falha responde 500 para o Mercado Pago reenviar. É idempotente (`markPaid` só age em venda aguardando pagamento).
- Em desenvolvimento (`*.localhost`) o Mercado Pago não alcança o webhook; a confirmação vem das consultas da tela.

## Configurar o Mercado Pago (uma vez, pelo dono)

1. Em Mercado Pago Developers → Suas integrações, criar o aplicativo **do NextRotta** (pagamentos online e presenciais, modelo marketplace/OAuth), primeiro em modo de teste. Não reaproveitar as credenciais da produção.
2. **URL de redirecionamento:** `https://<ROOT_DOMAIN>/api/mercadopago/oauth/callback` (ou o valor de `MERCADOPAGO_REDIRECT_URI`). Precisa ser idêntica, caractere por caractere.
3. **Webhooks:** URL `https://<ROOT_DOMAIN>/api/webhooks/mercadopago`, eventos **Order** e **Pagamentos**. Copiar a assinatura secreta para `MERCADOPAGO_WEBHOOK_SECRET`.
4. Variáveis no ambiente (Vercel e `.env`):

| Variável | Para quê |
|---|---|
| `MERCADOPAGO_CLIENT_ID` | ID do aplicativo |
| `MERCADOPAGO_CLIENT_SECRET` | Client secret do aplicativo |
| `MERCADOPAGO_TOKEN_KEY` | Chave de cifra dos tokens: `openssl rand -base64 32`, só do NextRotta. **Não troque depois de haver contas conectadas**: os tokens gravados deixam de abrir. |
| `MERCADOPAGO_WEBHOOK_SECRET` | Assinatura secreta do webhook |
| `MERCADOPAGO_REDIRECT_URI`, `MERCADOPAGO_WEBHOOK_URL` | Opcionais: sobrescrevem os endereços montados a partir de `ROOT_DOMAIN` |
| `MERCADOPAGO_FALLBACK_PAYER_EMAIL` | Opcional: e-mail do pagador no Pix quando a venda não tem (padrão: `pagador@<domínio>`). Não pode ser o e-mail do técnico. |

5. Conferir em Painel → Configurações → Integrações ("Mercado Pago (Venda de Peças)").
6. Incluir o recurso "Venda de Peças" nos planos desejados (Planos, no painel), ou liberar para uma organização específica.
7. Cada técnico precisa de conta no Mercado Pago com **chave Pix** cadastrada e, para maquininha, um Point vinculado. Em Venda de Peças → Ajustes, o admin define nome da empresa, formas de pagamento, rodapé do recibo e dia do acerto.

## Mensagens ao cliente

Link de pagamento (Pix: link + copia e cola numa mensagem só dele) e **recibo**, depois de pago, saem pelo WhatsApp da organização (Evolution API, `lib/parts/notify.ts`), com histórico (tipo `parts_sale`) e deduplicação. Respeita o número de teste das Configurações do WhatsApp. **Não depende** do interruptor geral de notificações: o link de pagamento precisa chegar ao cliente. Sem a instância conectada (ou fora do plano), a tela oferece **Enviar pelo meu WhatsApp** (link `wa.me` com o texto pronto).

## Leitura de código de barras

`components/parts/shared.tsx` → `BarcodeScanner`: câmera pelo `BarcodeDetector` nativo do navegador e, onde ele não existe (Chrome no Windows, Safari/iPhone, Firefox), pelo pacote `barcode-detector` (ZXing em WebAssembly, carregado só quando preciso; o `.wasm` vem do jsDelivr). A câmera exige HTTPS ou `localhost`. Leitores USB/Bluetooth funcionam como teclado, e sempre dá para digitar. Na tela do técnico o leitor fica aberto entre leituras e um código desconhecido aparece como erro dentro da janela.

## Código

- Schema: `db/migrations/0023_parts_control.sql` (inclui a view `organization_files`) e `0024_parts_sales_hardening.sql` (`parts_settings.company_name`, função `parts_require_units`, índices únicos de cancelamento); `0025` renomeia o recurso para "Venda de Peças".
- Regras: `lib/parts/` — `types.ts` (rótulos e `parseAmount`, sem dependências), `common.ts` (erros, travas de estoque), `catalog.ts` (peças, imagens, importação, configurações, nome da empresa), `stock.ts` (estoque, remessas, movimentações, inventário), `sales.ts` (vendas, cobrança, recibo, webhook), `account.ts` (conta do técnico, débitos), `finance.ts` (relatório financeiro), `overview.ts`, `detail.ts`, `notify.ts`, `route-helpers.ts`.
- Mercado Pago: `lib/mercadopago/` — `config.ts` (env, cifra dos tokens), `client.ts` (REST, OAuth, assinatura do webhook), `accounts.ts` (contas dos técnicos, maquininhas).
- API: `app/api/parts/**` (inclui `movements` e `finance`), `app/api/mercadopago/**`, `app/api/webhooks/mercadopago`. Tela do técnico: uma chamada (`/api/parts/me`) traz tudo.
- Telas: `/admin/pecas` (`components/parts/admin/*`) e `/dashboard/pecas` (`components/parts/technician-parts.tsx` + `payment-panel.tsx`). No modo preview (admin vendo como técnico) tudo é somente leitura, pelo middleware.

## Pendências conhecidas

- O Mercado Pago real **nunca foi testado** (nem aqui nem na produção): faltam o aplicativo do NextRotta e as variáveis `MERCADOPAGO_*`. Validar Pix, link, Point, "Conferir pagamento" e webhook em sandbox antes de liberar a técnicos reais.
- O recurso `parts` ainda não está em nenhum plano.
- Vídeos de tutorial: são os do Central Operacional (mostram a marca dele); trocar quando houver os do NextRotta.
- Os técnicos veem "Minhas peças" no menu sempre; a página não é ocultável pelas regras de visibilidade do técnico.

## Teste de 22–23/10/2026 (API, banco e Chrome, sem Mercado Pago)

Duas organizações descartáveis (removidas depois), técnico com conta do Mercado Pago **simulada** (só dinheiro): catálogo, compra, remessa e confirmação; venda com "1.500" e preço zero; duas vendas simultâneas da mesma unidade (uma passa, a outra 409); cancelamento duplo simultâneo (um 200, um 409, uma única devolução e um único estorno); técnico cancelando venda paga (403); movimentações com filtros; financeiro mensal, anual e por técnico; inventário com cobrança em 3 parcelas; isolamento entre organizações (peças, vendas, movimentos, financeiro, remessas, configurações); webhook (200, 500, 413); nove abas e tela do técnico no celular no Chrome real, sem erros de console. 56 verificações, todas ok.
