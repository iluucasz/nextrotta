# Controle de Peças

Módulo de vendas de peças em **consignação** com os técnicos. Recurso de plano `parts` ("Controle de Peças"). Fica **fora da folha**: não é comissão, é venda de peças ao técnico.

## Modelo

- Cada peça tem **custo** (o que a empresa pagou), **preço de técnico** (o que o técnico deve por unidade vendida) e **preço sugerido** (ao cliente final). Exemplo: custo R$ 50, técnico R$ 75, sugerido R$ 100.
- **Estoque central** + **um estoque por técnico** (o "carro"). Estoque nunca é um número gravado: é a soma de `part_movements` (só inserção), então cada unidade tem rastro.
- **Remessa** (`part_transfers`, `direction = out`): central → técnico, em consignação. **Devolução** (`return`): técnico → central. O técnico confirma cada uma no app (`acknowledged_at` + IP), e o admin imprime o termo.
- **Venda** (`part_sales`): o técnico vende do próprio estoque, pelo preço que quiser. A peça sai na hora e a **conta do técnico** (`part_account_entries`) recebe o preço de técnico. Cancelar devolve as duas coisas. O técnico só cancela venda não paga; venda paga, só o admin cancela (o estorno ao cliente é feito no Mercado Pago).
- **Inventário** (`part_inventories`): a contagem é feita lendo os códigos de barras (cada leitura soma 1) ou digitando. Ao encerrar, o estoque passa a ser o que foi contado. A falta no carro de um técnico pode ser **cobrada**, virando um débito parcelado (`part_debts` + parcelas na conta), ou **assumida pela empresa** (ex.: roubo com boletim de ocorrência).
- **Acerto**: o saldo do mês é tudo o que venceu até o mês menos o que foi pago. O admin registra o pagamento (Pix, dinheiro, transferência, desconto acordado em contrato). O desconto na folha é **manual**: o saldo de peças não entra no cálculo da folha, o admin lança o desconto lá por conta própria. Cancelar um débito cancela as parcelas a partir de um mês; as anteriores continuam devidas.
- O técnico **nunca vê o custo** da empresa.

## Pagamento — Mercado Pago na conta do técnico

A plataforma tem **um** aplicativo no Mercado Pago. Cada técnico conecta a **própria** conta em "Minhas peças" (OAuth com PKCE; retorno em `/api/mercadopago/oauth/callback`, no domínio raiz, com `state` de uso único em `mercadopago_oauth_states`). Os tokens ficam cifrados (`MERCADOPAGO_TOKEN_KEY`) em `mercadopago_accounts` e são renovados 7 dias antes de vencer (duram 180 dias). O dinheiro da venda é sempre do técnico.

| Forma | Como funciona | Confirmação |
|---|---|---|
| Pix (QR Code) | `POST /v1/orders` (`type: online`, `pix`, expira em 60 min). A tela mostra o QR e o copia e cola. | webhook `order` + a tela consulta a cada 4 s |
| Link de cartão | Checkout Pro (`/checkout/preferences`, sem boleto, expira em 24 h). | webhook `payment` (`external_reference` = id da venda) + consulta |
| Cartão na maquininha ou no celular | Com maquininha Point escolhida pelo técnico (modo PDV): `POST /v1/orders` (`type: point`, `terminal_id`). Sem maquininha: o técnico cobra pelo app do Mercado Pago (Point Tap) e toca em **Conferir pagamento**, que procura na conta dele um pagamento aprovado de mesmo valor, feito depois da venda e ainda não ligado a outra venda. | webhook/consulta, ou "Conferir pagamento" |
| Dinheiro / registro manual | Sem cobrança pelo Mercado Pago. | o técnico marca "Recebi" |

**A conta do Mercado Pago conectada é obrigatória para qualquer venda**, inclusive a registrada como dinheiro: `createSale` recusa (409) o técnico sem conta conectada, e a tela mostra o aviso e bloqueia o botão "Cobrar". Se a plataforma ainda não tiver o aplicativo configurado (`MERCADOPAGO_*`), ninguém consegue conectar e, portanto, vender.

Em qualquer forma, "Recebi de outra forma" marca a venda como paga por declaração do técnico (`payment_confirmed_by = technician`, destacado para o admin).

**WhatsApp do cliente** é obrigatório na venda. O link de pagamento (Pix: link + o copia e cola numa mensagem só dele) e o **recibo**, depois de pago, saem pela instância de WhatsApp da empresa (`lib/parts/notify.ts`, histórico com o tipo `parts_sale`, respeita o número de teste). Sem o WhatsApp da empresa conectado (ou fora do plano), a tela oferece **Enviar pelo meu WhatsApp** (link `wa.me` com o texto pronto). O rodapé do recibo é configurável.

Webhook: `POST /api/webhooks/mercadopago` (público). Nada do corpo é confiável: ele só diz qual venda conferir, e a conferência pergunta ao Mercado Pago com o token do técnico. Se `MERCADOPAGO_WEBHOOK_SECRET` estiver definido, uma assinatura `x-signature` errada é recusada. Os eventos ficam em `mercadopago_webhook_events`.

## Configurar o Mercado Pago (uma vez, pelo dono)

1. Em Mercado Pago Developers, criar o aplicativo da plataforma (pagamentos online e presenciais, modelo de integração marketplace/OAuth).
2. **URL de redirecionamento:** `https://nextrotta.com.br/api/mercadopago/oauth/callback` (ou o valor de `MERCADOPAGO_REDIRECT_URI`). Precisa ser idêntica.
3. **Webhooks:** URL `https://nextrotta.com.br/api/webhooks/mercadopago`, eventos **Order** e **Pagamentos**. Copiar a assinatura secreta para `MERCADOPAGO_WEBHOOK_SECRET`.
4. Variáveis no ambiente (Vercel): `MERCADOPAGO_CLIENT_ID`, `MERCADOPAGO_CLIENT_SECRET`, `MERCADOPAGO_TOKEN_KEY` (`openssl rand -base64 32`), `MERCADOPAGO_WEBHOOK_SECRET`.
5. Conferir em Painel → Configurações → Integrações ("Mercado Pago (Controle de Peças)").
6. Incluir o recurso "Controle de Peças" nos planos desejados (Planos, no painel), ou liberar para uma empresa específica.

Em desenvolvimento (`*.localhost`), o Mercado Pago não alcança o webhook; a confirmação vem pelas consultas da tela.

## Leitura de código de barras

`components/parts/shared.tsx` → `BarcodeScanner`: câmera pelo `BarcodeDetector` nativo do navegador (Chrome no Android e no macOS) e, onde ele não existe (Chrome no Windows, Safari/iPhone, Firefox), pelo pacote `barcode-detector` (ZXing em WebAssembly, carregado só quando preciso; o `.wasm` vem do jsDelivr). A câmera exige HTTPS ou `localhost`. Leitores USB/Bluetooth funcionam como teclado (digitam o código e dão Enter), e sempre dá para digitar.

## Código

- Schema: `db/migrations/0023_parts_control.sql` (inclui a view `organization_files`, que soma arquivos da biblioteca e imagens das peças para o limite de armazenamento).
- Regras: `lib/parts/` — `types.ts` (rótulos, sem dependências), `catalog.ts` (peças, imagens, importação, configurações), `stock.ts` (estoque, remessas, inventário), `sales.ts` (vendas, cobrança, recibo, webhook), `account.ts` (conta do técnico, débitos), `overview.ts`, `notify.ts`, `route-helpers.ts`.
- Mercado Pago: `lib/mercadopago/` — `config.ts` (env, cifra dos tokens), `client.ts` (REST, OAuth, assinatura do webhook), `accounts.ts` (contas dos técnicos, maquininhas).
- API: `app/api/parts/**`, `app/api/mercadopago/**`, `app/api/webhooks/mercadopago`. `GET /api/parts/:id` (`lib/parts/detail.ts`) devolve o detalhe de uma peça: quem tem quanto, vendas (pagas/aguardando), faturamento, lucro da empresa e últimas vendas; a tela abre ao clicar na linha do catálogo.
- Telas: `/admin/pecas` (`components/parts/admin/*`: visão geral, peças e estoque, técnicos, vendas, inventário, acerto, configurações) e `/dashboard/pecas` (`components/parts/technician-parts.tsx` + `payment-panel.tsx`).
- Imagens: Blob privado em `parts/<organização>/`, servidas por `/api/parts/[id]/image`; a tela reduz a foto para 800 px em JPEG antes de enviar.
