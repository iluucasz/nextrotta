# VPS: worker, agente e manutenção

A VPS (Oracle, Ubuntu ARM `aarch64`, 2 núcleos, 12 GB sem swap, 45 GB de disco, host em UTC) é
**compartilhada** com o sistema original do cliente (Central Operacional, em produção) e com outro
sistema em `/opt/prumo`. Tudo o que o NextRotta põe lá tem nome, porta, rota e selo próprios.

## O que roda lá

| Container | Dono | Porta (só 127.0.0.1) | Rota no Caddy |
|---|---|---|---|
| `porto-worker` (+ `porto-worker-<sha7>` parado) | **Produção** — nunca parar, reiniciar, remover ou recriar | 8090 | `/porto-worker/*` |
| `evolution-api`, `evolution-postgres`, `evolution-redis` | **Compartilhado** (WhatsApp de todos) | 8080 | resto do site |
| `nextrotta-worker` | NextRotta | 8091 | `/nextrotta-worker/*` |
| `nextrotta-vps-agent` | NextRotta | 8092 | `/nextrotta-vps-agent/*` |

Todo container e imagem do NextRotta leva o label `com.nextrotta.owner=nextrotta`. O agente classifica
cada container por esse label/nome (`ownerOf` em `vps-agent/server.mjs`) e só deixa o dono agir no
que é do NextRotta. A produção é só leitura. O compartilhado só reinicia com confirmação explícita,
porque derruba o WhatsApp de todos por alguns segundos.

## Agente da VPS (`vps-agent/`)

Node puro, sem dependências. Fala com o Docker pelo socket e lê `/proc` e o disco do host por um bind
mount somente leitura. **O socket do Docker equivale a root**, por isso o agente não executa comando
arbitrário: só a lista fechada abaixo, com segredo próprio (`VPS_AGENT_SECRET`, comparado com
`timingSafeEqual`).

| Método | Rota | O que faz |
|---|---|---|
| GET | `/health` | vivo |
| GET | `/host` | CPU (uso, núcleos, load), RAM, disco, rede, uptime, SO |
| GET | `/containers` | nome, dono, estado, imagem, reinícios, política, portas, tamanho, CPU, RAM, limite, tamanho do log |
| GET | `/containers/:nome/logs?tail=200` | últimas linhas (só leitura, qualquer dono) |
| GET | `/images` | tags, tamanho, idade, quem usa, dono |
| GET | `/disk` | `docker system df`, pastas conhecidas e o log da limpeza antiga |
| POST | `/cleanup?dryRun=1` | prévia: o que sairia e quanto libera |
| POST | `/cleanup` | executa e devolve o que removeu |
| POST | `/containers/:nome/restart` | só NextRotta; compartilhado com `?confirm=evolution`; produção e desconhecidos: 403 |

### Regras da limpeza (as mesmas do `vps-cleanup.sh` que ela substitui, mais as do NextRotta)

1. Containers `porto-worker-<sha7>` parados: fica só o mais novo (é o "voltar atrás" da produção).
2. Imagens `porto-worker:*` que nenhum container usa e com mais de 1 dia, **exceto**
   `porto-worker:prev-20260831` (base de agosto) e imagens recém-criadas (deploy em andamento).
3. Imagens `nextrotta-worker:*` e `nextrotta-vps-agent:*`: ficam a em uso e a anterior; as mais velhas saem.
4. Imagens sem tag que nenhum container usa; cache de build com mais de 72h.
5. Logs acima de 200 MB de `porto-worker`, `evolution-*` e dos containers do NextRotta são zerados.
6. Pacotes baixados pelo apt (o mesmo que `apt-get clean`). O journal já é limitado a 200 MB pelo
   `/etc/systemd/journald.conf.d/size.conf`.

Nunca toca volumes, `/opt`, containers rodando ou o que é de outros sistemas.

**Modo somente leitura** (`VPS_AGENT_READ_ONLY=1` no `agent.env`): tudo pode ser lido, inclusive a
prévia da limpeza, mas a limpeza e o reinício respondem 403. Para sair dele: tirar a linha do
`agent.env`, trocar os volumes `/var/lib/docker/containers` e `/var/cache/apt/archives` de `:ro` para
leitura e escrita e recriar o container. As regras foram testadas
contra um Docker simulado (prévia, execução, permissões de restart).

## Worker do NextRotta

`worker/` (fila do Porto, WhatsApp, cobrança, métricas da VPS e limpeza automática). Detalhes da fila
em `docs/integracao-porto-seguro.md` → "Fila do worker". Variáveis: as do `.env.example` (banco,
`PORTO_CREDENTIALS_KEY`, `PORTO_WORKER_SECRET`, `PORTO_WORKER_PORT=8091`, `EVOLUTION_API_URL/KEY`,
`VPS_AGENT_URL` = a URL pública (`https://evolution-whatsapp.duckdns.org/nextrotta-vps-agent`; dentro do container, `127.0.0.1` não é o host), `VPS_AGENT_SECRET`, `WORKER_ID`).

A cada 5 minutos o worker grava `vps_metrics`/`vps_container_metrics` e alerta o dono (WhatsApp da
plataforma, `platform_alerts`) quando:
- o disco passa de 80% (aviso) ou 90% (crítico);
- a RAM disponível cai abaixo de 1 GB;
- um container do NextRotta para;
- o agente não responde.

Às 04:30 roda a limpeza, se o dono ligou a limpeza automática (`platform_settings.vps.autoCleanup`,
desligada por padrão).

Se a VPS inteira cai, ninguém lá dentro consegue avisar (o WhatsApp também está nela): o painel do dono
mostra o worker offline (o app pergunta ao `/health` dele, sem consultar o banco) e as empresas veem "Módulo(s) em manutenção".

## Estado da implantação

> **14/10/2026 — VPS compartilhada atual (164.163.11.159, Ubuntu 24.04, 8 vCPU, 8 GB, 55 GB).** A
> VPS da BlackHosting (143.20.50.58) caiu e **não deve mais ser usada**; o texto abaixo sobre ela é
> histórico. A atual é compartilhada com outros projetos do dono (`garimpo-importer`, `porto-evolution-*`,
> `essencialcentro-*` — o Caddy em 80/443 é de outro projeto, **não alterar**). Acesso: `ssh vps`
> (root, só por chave). Regras: tudo do NextRotta em `/opt/nextrotta/`, contêineres/imagens com prefixo
> `nextrotta-`, `--memory`, `--restart unless-stopped`, rotação de log, segredos em `*.env` com `chmod 600`;
> nada de `docker system prune`, firewall, portas publicadas ou proxy sem autorização do dono.
> - Código em `/opt/nextrotta/app` (`lib/`, `worker/`, `vps-agent/`; sem git na VPS — envio por `tar`).
> - Worker: `nextrotta-worker:20261014-1`, `WORKER_ID=vps-nova`, `--memory=3g --shm-size=512m`, **sem porta
>   publicada**; segredos em `/opt/nextrotta/worker.env` (DATABASE_URL, PORTO_CREDENTIALS_KEY,
>   PORTO_WORKER_SECRET, PORTO_WORKER_PORT, ASAAS_API_KEY, ASAAS_ENVIRONMENT, DEEPSEEK_API_KEY,
>   ROOT_DOMAIN, WORKER_ID). Roda os jobs agendados pelo banco; o app (Vercel) ainda **não** o alcança.
> - Imagem `nextrotta-vps-agent:20261014-1` construída, **não executada** (precisa do socket do Docker e
>   do `/` em leitura — só com autorização do dono nesta VPS compartilhada). Sem agente, as métricas da
>   VPS ficam desligadas.
> - WhatsApp desligado no worker (sem `EVOLUTION_API_URL/KEY`): o Evolution do NextRotta ainda será definido
>   (não usar o `porto-evolution-*`/`essencialcentro-evolution` da produção).
> - Falta: caminho público para `PORTO_WORKER_URL`/`VPS_AGENT_URL` (domínio + proxy próprio, autorizado
>   pelo dono) e Evolution próprio.
>
> **07/10/2026 — VPS anterior (BlackHosting, 143.20.50.58, Brasil — caiu).** A conta da Oracle foi encerrada pela
> Oracle em 06/10 (elegibilidade do plano gratuito) e a VPS de lá deixou de existir. A nova: KVM, 8 vCPU,
> 7,6 GB de RAM + 4 GB de swap, disco de 30 GB (o plano diz 100 GB — chamado a abrir), Ubuntu 24.04.
> - SSH só por chave (`ssh-key-2026-07-20`), login por senha desligado (`/etc/ssh/sshd_config.d/00-hardening.conf`).
> - Firewall `ufw`: 22, 80, 443. Fuso America/Sao_Paulo. Journal limitado a 200 MB.
> - Docker 29.8 + Caddy 2.11 (`/etc/caddy/Caddyfile` com as mesmas rotas da Oracle).
> - WhatsApp: `/opt/evolution/docker-compose.yml` (Evolution v2.3.7 + Postgres 15 + Redis 7), chave global
>   **nova** em `/opt/evolution/.env` (600). Instâncias e QR Codes precisam ser refeitos.
> - Agente do NextRotta (`nextrotta-vps-agent:20261007-1`), somente leitura.
> - `evolution-whatsapp.duckdns.org` já aponta para o IP novo (certificado HTTPS emitido pelo Caddy).
> - Worker do NextRotta (`nextrotta-worker:20261007-3`, `WORKER_ID=vps-blackhosting`, `--memory=3g
>   --shm-size=512m`), segredos em `/opt/nextrotta/worker.env` (600). Conferido: `/health` 401 sem
>   segredo e 200 com ele (pelo Caddy), sinal de vida a cada minuto e `vps_metrics` gravando. Usa o
>   banco do NextRotta, Asaas em sandbox e `ROOT_DOMAIN=nextrotta.com.br`. Sem worker da produção nesta VPS.
> - Sem limpeza do sistema antigo aqui (`vps-cleanup.timer` não existe na VPS nova): a limpeza do painel
>   é a única; a imagem do worker ocupa ~3,6 GB (disco em 49%).
> - Falta: worker da produção (com autorização do dono), `EVOLUTION_API_KEY` nova na Vercel da produção
>   e reler os QR Codes das instâncias.
>
> O histórico abaixo é da VPS da Oracle.


- **06/10/2026 — passo 2 feito:** `nextrotta-vps-agent:20261006-1` rodando em **modo somente leitura**,
  com todos os volumes montados `:ro` (exceto o socket do Docker). Código em `/opt/nextrotta/app/vps-agent`
  e segredo em `/opt/nextrotta/agent.env` (600). Leituras conferidas na VPS; restart e limpeza
  respondem 403. A prévia da limpeza ficou vazia, como a última execução do script antigo (13:27, disco
  31% → 31%). Produção (`porto-worker`, 401 no `/health`) e `evolution-*` seguiram de pé.
- **06/10/2026 — passo 3 feito:** rotas `/nextrotta-worker/*` (8091) e `/nextrotta-vps-agent/*` (8092)
  acrescentadas ao Caddy (cópia anterior em `/etc/caddy/Caddyfile.bak-20261006`), validado e
  recarregado. Conferido: produção 401 no `/health`, Evolution 200, agente 401 sem segredo e ok com
  ele (também de fora da VPS), `/nextrotta-worker` 502 até o worker subir.
- Faltam: worker (passo 4), limpeza ativa (5), gastos (7).

## Implantação (cada passo com confirmação do dono)

Acesso: `ssh -i <chave> ubuntu@163.176.250.63` (usuário com `sudo`). Antes e depois de cada passo:
`docker ps` (os containers da produção e do WhatsApp continuam de pé) e
`curl -s -o /dev/null -w '%{http_code}' https://evolution-whatsapp.duckdns.org/porto-worker/health`
(deve dar **401**: o worker da produção responde e exige o segredo dele).

1. **Código na VPS:** `/opt/nextrotta/app` (contexto de build com `lib/`, `worker/`, `vps-agent/`),
   segredos em `/opt/nextrotta/worker.env` e `/opt/nextrotta/agent.env` (`chmod 600`). Nunca usar as
   pastas `/opt/porto-worker*`.
2. **Agente** (só leitura primeiro: o painel ainda não chama a limpeza):
   ```sh
   cd /opt/nextrotta/app/vps-agent
   docker build -t nextrotta-vps-agent:<versão> .
   docker run -d --name nextrotta-vps-agent --restart unless-stopped \
     --label com.nextrotta.owner=nextrotta --memory=256m \
     --log-opt max-size=20m --log-opt max-file=5 \
     -p 127.0.0.1:8092:8092 --env-file /opt/nextrotta/agent.env \
     -v /var/run/docker.sock:/var/run/docker.sock \
     -v /:/host:ro \
     -v /var/lib/docker/containers:/var/lib/docker/containers \
     -v /var/cache/apt/archives:/var/cache/apt/archives \
     nextrotta-vps-agent:<versão>
   ```
3. **Caddy:** só **acrescentar**, dentro do site `evolution-whatsapp.duckdns.org` e antes do
   `reverse_proxy` geral:
   ```
   handle_path /nextrotta-worker/* {
     reverse_proxy 127.0.0.1:8091
   }
   handle_path /nextrotta-vps-agent/* {
     reverse_proxy 127.0.0.1:8092
   }
   ```
   `sudo caddy validate --config /etc/caddy/Caddyfile` e só então `sudo systemctl reload caddy`. Nunca
   remover ou alterar as rotas existentes.
4. **Worker:**
   ```sh
   cd /opt/nextrotta/app
   docker build -f worker/Dockerfile -t nextrotta-worker:<versão> .
   docker run -d --name nextrotta-worker --restart unless-stopped \
     --label com.nextrotta.owner=nextrotta --memory=4g \
     --log-opt max-size=20m --log-opt max-file=5 \
     -p 127.0.0.1:8091:8091 --env-file /opt/nextrotta/worker.env \
     nextrotta-worker:<versão>
   ```
   Na Vercel: `PORTO_WORKER_URL=https://evolution-whatsapp.duckdns.org/nextrotta-worker`,
   `VPS_AGENT_URL=https://evolution-whatsapp.duckdns.org/nextrotta-vps-agent` e os segredos.
5. **Limpeza:** no painel, gerar a prévia e comparar com o que o script antigo faria (mesmas regras;
   `/var/log/vps-cleanup.log` aparece em `GET /disk`). Conferido, ligar a limpeza automática. O timer
   antigo (`vps-cleanup.timer`) foi desligado em 06/10/2026; se a nova demorar, o dono pode religá-lo
   com `sudo systemctl enable --now vps-cleanup.timer`. Depois de ligar a nova, ele fica desligado.
6. **Restart pelo painel:** já protegido pelo agente.
7. **Gastos:** lançamento manual mensal no painel (`infra_costs`). A leitura automática pela OCI Usage
   API não foi implementada (o plano gratuito "Always Free" da Oracle pode cobrir esta VPS; confirme
   no console da Oracle).

## Capacidade

Com 2 navegadores ao mesmo tempo: uma noite normal da produção leva 15–20 min por organização do
tamanho dela (10 técnicos) e uma pesada 66–83 min.
- **10 organizações:** a fila leva ~1,5 h numa noite normal e ~6,5 h numa pesada.
- **Até onde vai:** cabem ~15–20 organizações com folga, e ~40–50 numa noite normal.
- **Onde acompanhar:** `getNightCapacity` (Operação → VPS) mostra a ocupação da janela 23:00–06:00.
- **Quando separar:** levar o SaaS para uma VPS própria ao passar de 5–10 organizações, para não
  dividir máquina com a produção.
