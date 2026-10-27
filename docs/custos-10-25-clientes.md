# Quanto custa o NextRotta

**Data-base:** 26/10/2026 · **Dólar:** R$ 5,0377 (PTAX de 23/10) · **Valores:** reais por mês.
**Fora das contas:** impostos, contador, pró-labore e pessoas. A fatura do cartão pode vir um pouco maior (IOF e spread).

## 1. O resumo

- **Hoje você gasta cerca de R$ 410 por mês.** O sistema em si (VPS, Vercel, domínio e banco) custa cerca de R$ 180. O resto, cerca de R$ 230, são suas assinaturas pessoais (ChatGPT, Claude e ElevenLabs), que não crescem com clientes.
- **Hoje entra R$ 331 por mês** (um cliente Pro anual). Faltam cerca de R$ 80 por mês para empatar.
- **Mais 1 cliente já empata.** Cada cliente novo custa só R$ 5 a R$ 30 por mês e traz R$ 181 a R$ 364 (plano anual, com os preços novos de 26/10).
- **A partir daí, quase tudo vira sobra:** com 10 clientes, sobram cerca de R$ 1.760 por mês, e com 50, cerca de R$ 10.120, antes de impostos e pessoas.

## 2. O que você paga hoje

| Gasto | R$/mês | O que é | Certeza |
|---|---:|---|---|
| Vercel Pro (US$ 20) | 100,75 | Hospeda o sistema | Plano confirmado |
| ChatGPT Plus (US$ 20) | 100,75 | Ferramenta sua | Informado por você |
| Claude Pro (US$ 20) | 100,75 | Ferramenta sua | Informado por você |
| VPS LocaCloud | 50,00 | Worker, Porto e WhatsApp | Confirmado por você |
| ElevenLabs Starter (US$ 6) | 30,23 | Ferramenta sua | Plano "mais básico" informado; se for o Free, tire R$ 30,23 |
| Neon Launch | 25 a 96 | Banco de dados | Estimado: mínimo de US$ 5 mais uso (veja abaixo) |
| Domínio .com.br | 3,33 | Endereço | R$ 40 por ano; confirmar a renovação |
| **Total** | **≈ 410** | | Mínimo R$ 411, até R$ 482 se o Neon subir |

**Neon:** o Launch cobra por uso (US$ 0,106 por hora de computação). Com o worker antigo, o banco ficava ligado o mês todo, o que daria cerca de US$ 19 (R$ 96). Com a correção de hoje, o banco dorme, e a conta deve ficar perto do mínimo. A fatura mostra o valor certo.

**Ficam de fora porque são variáveis ou ainda não existem:**
- **DeepSeek (IA):** você faz recargas avulsas. O saldo medido é US$ 2,31 e o consumo até agora é menor que R$ 0,05.
- **Asaas:** R$ 0 até hoje (está em sandbox). Não há mensalidade, só taxa por cobrança paga.
- **Backup externo:** R$ 0, porque ainda não foi feito.
- **Vercel Blob:** dentro da franquia grátis.

**Suas assinaturas pessoais (R$ 232) não crescem com clientes.** O sistema (cerca de R$ 180) é o que cresce, em degraus.

## 3. Como o custo cresce com clientes

**Custos fixos:** as assinaturas pessoais, o domínio e a Vercel, até uns 25 clientes. Não mudam.

**Custos por cliente (cada um que entra traz isto):**

| Item | Quanto | Quando |
|---|---|---|
| Taxa do Asaas | R$ 1,99 (Pix ou boleto) · R$ 6,38 a R$ 12,36 (cartão) | Todo mês, por cobrança paga |
| IA (DeepSeek) | R$ 3,70 a R$ 7,40 | Só clientes Pro (500 a 1.000 respostas) |
| Backup | R$ 0,40 a R$ 1,50 | Quando o backup existir |
| Banco (Neon) | cresce com o uso | Pouco por cliente |

**Custos em degraus:** a VPS sobe de plano conforme a quantidade de clientes.

| Clientes | VPS | R$/mês |
|---|---|---:|
| Até ~10 | 8 GB (a atual) | 50,00 |
| ~25 a 50 | 16 GB | 69,90 |
| ~100 | 32 GB | 149,90 |
| ~200 | duas VPS de 32 GB | 299,80 |

**Atenção:** o plano de 16 GB aparece como Windows na LocaCloud. O NextRotta precisa de Linux, então confirme isso antes de contratar.

## 4. Quanto custa cada fase

Premissas: 10 técnicos por cliente; 70% dos clientes no Essencial e 30% no Pro; só o Pro usa Porto, WhatsApp e IA.
O valor baixo é uso otimizado. O alto é com folga para dólar, banco e cartão no Asaas.

| Clientes | Só o sistema | Total com suas assinaturas (R$ 232) |
|---:|---:|---:|
| 10 | 230 a 365 | **460 a 600** |
| 25 | 325 a 650 | **555 a 880** |
| 50 | 450 a 1.440 | **680 a 1.670** |
| 100 | 1.060 a 2.515 | **1.290 a 2.745** |
| 200 | 1.835 a 5.290 | **2.065 a 5.520** |

## 5. O que entra e o que sobra

**Preços atuais:**

Reajuste de 10% em 26/10/2026, só para clientes novos (quem já contratou mantém o preço; hoje o único cliente continua com o Pro anual de R$ 3.970).

| Plano | Mensal | Anual | Implantação (uma vez) | Técnicos incluídos |
|---|---:|---:|---:|---:|
| Essencial | R$ 217 | R$ 2.170 | R$ 600 | 8 |
| Pro | R$ 437 | R$ 4.370 | R$ 1.000 | 16 |
| Monte o seu | R$ 217 (base) + módulos | R$ 2.170 (base) + módulos | R$ 600 (base) + módulos | 8 |

Técnico extra: R$ 29,99 por mês.

**Monte o seu:** o cliente parte da base (o Essencial) e soma só os módulos que quer. O anual de cada módulo é o mensal ×10, igual à base. Preços iniciais sugeridos (você ajusta no painel):

| Módulo | Mensal | Implantação |
|---|---:|---:|
| Automação Porto Seguro | 80 | 200 |
| Venda de Peças | 35 | 60 |
| Assistente de IA | 35 | 60 |
| Controle financeiro | 25 | 40 |
| Dashboard gerencial | 20 | 20 |
| Faturamento | 15 | 10 |
| WhatsApp | 10 | 10 |
| **Todos juntos** | **220** | **400** |

Todos os módulos somam o que o Pro acrescenta ao Essencial (R$ 220 por mês), mas o Pro também inclui 16 técnicos. Um cliente com 16 técnicos e todos os módulos pagaria 217 + 220 + 8 × 29,99 = R$ 677 na montagem, contra R$ 437 no Pro. Por isso o pacote Pro continua sendo o melhor negócio para quem quer tudo.

**Leitura conservadora:** todos no plano anual, sem técnicos extras, e o custo no teto. A implantação não entra, porque é paga uma vez.

| Clientes | Entra por mês | Custo máximo | **Sobra por mês** | Implantação, uma vez |
|---:|---:|---:|---:|---:|
| 10 | 2.358 | 600 | **1.760** | 7.200 |
| 25 | 5.988 | 880 | **5.110** | 18.200 |
| 50 | 11.792 | 1.670 | **10.120** | 36.000 |
| 100 | 23.583 | 2.745 | **20.840** | 72.000 |
| 200 | 47.167 | 5.520 | **41.650** | 144.000 |

Se os clientes pagarem mensal, a entrada sobe cerca de 20%. Com técnicos extras (média de 10 por cliente), sobe cerca de 40%.
A sobra é antes de impostos, atendimento, suporte e o seu trabalho. A implantação também precisa pagar o tempo de configurar cada cliente.

## 6. O que ainda falta saber

- **Planos exatos:** confirmar na fatura o Neon e o ElevenLabs (se é Free ou Starter).
- **DeepSeek:** os preços estão zerados no painel, então o custo da IA aparece como R$ 0 por engano. Defina os preços reais antes de liberar a IA.
- **Pacotes de créditos de IA:** 5.000 créditos por R$ 10 custam cerca de R$ 37 em API pelo consumo médio atual. Hoje cada pergunta desconta só 1 crédito, então a plataforma perde dinheiro nesse pacote.
- **Backup:** os planos prometem 90 e 180 dias, mas o backup ainda não existe. Quando existir, custa de R$ 4 (10 clientes) a R$ 330 (200 clientes) por mês.
- **E-mail e monitoramento:** grátis até uns 25 clientes. Depois podem custar de R$ 100 a R$ 800 por mês, somados.
- **Capacidade do Porto:** ainda não há execuções reais para medir quantos clientes a VPS aguenta. Registre pelo menos 30 e calcule a duração média.

## 7. Detalhe por serviço (para consulta)

Faixa em R$/mês. O sistema = soma da tabela + domínio R$ 3,33.

| Serviço | 10 clientes | 25 | 50 | 100 | 200 |
|---|---:|---:|---:|---:|---:|
| VPS | 50 | 69,90 | 69,90 | 149,90 | 299,80 |
| Vercel | 100,75 | 100,75 | 100,75 a 150 | 125 a 250 | 200 a 500 |
| Neon | 40 a 76 | 60 a 126 | 100 a 250 | 180 a 450 | 350 a 900 |
| Blob | 0 a 5 | 0 a 10 | 0 a 30 | 5 a 60 | 10 a 125 |
| Backup | 4 a 15 | 10 a 41 | 20 a 82 | 40 a 164 | 80 a 328 |
| DeepSeek | 11 a 22 | 30 a 59 | 56 a 111 | 111 a 222 | 222 a 444 |
| Asaas | 19,90 a 94,30 | 49,75 a 237,84 | 99,50 a 471,48 | 199 a 942,97 | 398 a 1.885,94 |
| E-mail | 0 | 0 | 0 a 100,75 | 100,75 | 100,75 a 453,39 |
| Monitoramento | 0 | 0 | 0 a 171,28 | 146,09 a 171,28 | 171,28 a 350 |

O Asaas "baixo" é tudo por Pix ou boleto. O "alto" é tudo por cartão.
Taxas: Pix e boleto R$ 1,99; cartão R$ 0,49 mais 2,99%.

Fontes: [Neon](https://neon.com/pricing) · [Vercel](https://vercel.com/pricing) · [DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/) · [ElevenLabs](https://elevenlabs.io/pricing) · [Asaas](https://www.asaas.com/precos-e-taxas) · [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/) · [Resend](https://resend.com/pricing) · [Better Stack](https://betterstack.com/pricing) · [PTAX](https://ptax.bcb.gov.br/ptax_internet/consultarUltimaCotacaoDolar.do)
