# Prompt — Painel do dono + site de marketing do NextRotta

> Cole tudo abaixo da linha na IA de design. Este arquivo descreve **o que** cada tela precisa ter (conteúdo, dados, ações, regras). As decisões visuais ficam com a IA de design.

---

## Contexto

Você vai criar a interface de duas partes do **NextRotta**, um SaaS brasileiro de gestão de equipes técnicas de campo (prestadores de serviço). O produto já existe para os clientes: cadastro de técnicos, ordens de serviço (OS), importação de planilhas, horas e banco de horas, escala, folha de pagamento com comissão, financeiro, biblioteca de documentos, automação do portal da seguradora Porto Seguro, notificações por WhatsApp, dashboard gerencial e recursos de IA.

Cada cliente é uma **organização**, com o próprio sistema em `<empresa>.nextrotta.com.br`. Uma única pessoa, o **dono da plataforma**, administra todas as organizações.

Você vai criar:

1. **Painel do dono** (`nextrotta.com.br/plataforma`): área privada, usada só pelo dono, para administrar organizações, planos, cobrança, créditos de IA, recursos, bugs, leads, conteúdo do site e a saúde do sistema.
2. **Site de marketing** (`nextrotta.com.br`): site público para vender o produto, com página de login. Todo o conteúdo do site é editável pelo painel do dono.

**Não** crie o sistema usado pelos clientes (ele já existe) nem lógica de servidor.

## Decisões visuais

Layout, navegação, cores, tipografia, componentes, ícones, gráficos e animações ficam **inteiramente a seu critério**. Este documento só define conteúdo, dados, ações e regras.

## Restrições técnicas

- Next.js (App Router), React, TypeScript, Tailwind CSS 4 e shadcn/ui.
- **Sem chamadas reais de API** (exceto login e sair, descritos abaixo). Use dados fictícios realistas, tipados com interfaces TypeScript e concentrados em `lib/mocks/`, para serem trocados depois pela API real.
- Rotas do painel sob `/plataforma/...`. Rotas do site: `/`, `/planos`, `/novidades`, `/contato`, `/sob-medida`, `/login`, `/termos`, `/privacidade`. Veja abaixo em que pastas cada uma fica.
- Todo texto em **português do Brasil**. Moeda em R$ (`R$ 1.970,00`), datas `dd/mm/aaaa`, horários de Brasília.
- Funcionar em desktop e celular.

## Onde trabalhar neste repositório

Você está dentro do repositório do sistema, que outra pessoa está desenvolvendo **ao mesmo tempo** (banco, API, autenticação). Para não quebrar o trabalho dela, siga estas regras à risca.

**Pode criar e alterar somente:**
- `app/plataforma/**` — páginas do painel do dono. Pode substituir os arquivos provisórios que estão lá (`page.tsx`, `logout-button.tsx`).
- `app/site/**` — páginas do site de marketing. Elas aparecem nos endereços públicos **sem** o `/site`:
  - `app/site/page.tsx` → `/`
  - `app/site/planos/page.tsx` → `/planos`
  - `app/site/novidades/page.tsx` → `/novidades` (e subpáginas em `app/site/novidades/...`)
  - `app/site/contato/page.tsx`, `app/site/sob-medida/page.tsx`, `app/site/termos/page.tsx`, `app/site/privacidade/page.tsx`
  - Links internos usam sempre o endereço público (`/planos`), nunca `/site/planos` (esse caminho responde 404 de propósito).
  - Substitua o `app/site/page.tsx` provisório que está lá.
- `app/plataforma/layout.tsx` e `app/site/layout.tsx` — se precisar de layout, fonte ou tema próprios, aplique aqui.
- `components/platform/**`, `components/site/**` e `lib/mocks/**`.
- `components/ui/` — pode **adicionar** componentes novos do shadcn; não altere os que já existem.
- `app/login/page.tsx` — **só o visual**. O comportamento abaixo tem que continuar exatamente igual.

**Não altere nada fora dessa lista.** Em especial: `middleware.ts`, `lib/` (exceto `lib/mocks/`), `app/api/`, `app/admin/`, `app/dashboard/`, `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `components/app-shell.tsx`, `db/`, `scripts/`, `worker/`, `docs/`, `CLAUDE.md` e `package.json`. Não leia nem altere arquivos `.env*`. Não rode migrações nem scripts de banco, não instale dependências novas (se uma for indispensável, só liste no resumo final) e não faça commits.

**Autenticação já existe — não implemente.** O acesso a `/plataforma` (só o dono) e a liberação pública do site são feitos pelo `middleware.ts`.

**Comportamento obrigatório do login (`app/login/page.tsx`):**
- Envia `POST /api/auth/login` com JSON `{ "email": "...", "password": "..." }`.
- Sucesso: a resposta é `{ "success": true, "redirectTo": "<url>" }`. Navegue com `window.location.assign(redirectTo)` — **não** use `router.push`, porque o destino pode ser outro subdomínio. Mostre o estado "redirecionando" enquanto isso.
- Erro: a resposta tem status 4xx/5xx e `{ "error": "<mensagem>" }`. Mostre a mensagem recebida.
- Se a URL tiver `?erro=link`, mostre "O link de acesso expirou. Entre novamente."
- "Esqueci minha senha" é só visual por enquanto (a API ainda não existe).

**Sair (no painel):** `POST /api/auth/logout` e depois `window.location.assign('/login')`.

**Verificação:** `npx tsc --noEmit` precisa passar sem erros nos seus arquivos antes de você considerar uma etapa pronta.

## Regras gerais do painel

- **Nada é excluído definitivamente.** Onde houver "excluir", a ação é **arquivar/desativar**, com opção de restaurar. Nunca use textos como "excluir permanentemente".
- Ações sensíveis pedem confirmação: suspender, cancelar, entrar na conta de um cliente, alterar preço, promover recurso, ajustar créditos e mudar configurações de cobrança. Algumas pedem **motivo**, indicado abaixo.
- Toda lista tem busca, filtros relevantes, ordenação e paginação.
- Toda tela tem estados de **carregando**, **vazio** (com orientação do que fazer) e **erro** (com opção de tentar de novo).
- Estados de organização usados em todo o painel: `Provisionando`, `Ativa`, `Em atraso`, `Suspensa`, `Cancelada`.

---

## Parte 1 — Painel do dono

### 1.1 Visão geral (página inicial do painel)
Resumo do negócio com filtro de período (este mês, mês anterior, últimos 12 meses, personalizado):
- Receita recorrente mensal (MRR) e anual (ARR), com evolução mês a mês.
- Organizações por estado.
- Novos clientes e cancelamentos no período; taxa de cancelamento.
- Inadimplência: quantidade de organizações em atraso e valor em aberto.
- Receita do período por tipo: mensalidades, implantações, técnicos extras, créditos de IA.
- IA: receita de créditos × custo real da IA no período.
- Pendências: bugs novos, leads novos, provisionamentos com erro.
- Alertas: organizações perto de algum limite, falhas da automação Porto, WhatsApp desconectado, backup atrasado, worker fora do ar.
- Atalhos: nova organização, ver bugs, ver leads.

### 1.2 Organizações (lista)
Colunas: nome, subdomínio, plano, ciclo (mensal/anual), estado, técnicos usados/limite, valor do ciclo, próxima cobrança e data de criação.
Filtros: plano, estado, ciclo e "perto do limite".
Ações por linha: abrir detalhes, **entrar na conta** e copiar link do subdomínio.
Botão **Nova organização**.

### 1.3 Nova organização (assistente em etapas)
1. **Empresa:** razão social, nome fantasia, CNPJ, e-mail, telefone/WhatsApp, cidade/UF e nº aproximado de técnicos.
2. **Subdomínio:** sugerido a partir do nome, editável e com verificação de disponibilidade em tempo real. Mostra a prévia `empresa.nextrotta.com.br`. Recusa nomes reservados (`www`, `app`, `api`, `admin`, `painel`, `plataforma`, `login`, `suporte`, `status`, `blog`, `docs`, `mail`) e aceita só letras minúsculas, números e hífen.
3. **Plano:** Essencial, Pro ou Sob medida; ciclo mensal ou anual; cupom/desconto opcional; cobrar implantação (sim/não, valor pré-preenchido pelo plano e editável). Mostra o resumo do valor da primeira cobrança.
4. **Administrador:** nome e e-mail do admin da organização; opção de enviar convite por e-mail.
5. **Recursos sob medida (opcional):** liberar recursos sob medida do catálogo.
6. **Revisão:** resumo de tudo, com botão **Criar organização**.

O assistente também pode ser aberto já preenchido a partir de um lead (seção 1.11).

### 1.4 Provisionamento (tela de progresso)
Aparece após criar a organização. Mostra as etapas reais, cada uma com estado (aguardando, em andamento, concluída, erro) e tempo:
1. Criar organização e subdomínio
2. Aplicar plano, limites e créditos iniciais
3. Criar configurações padrão
4. Criar administrador e enviar convite
5. Criar instância de WhatsApp (só se o plano tiver)
6. Registrar no worker de automações (só se o plano tiver)
7. Validar acesso ao subdomínio

- Em caso de erro: mensagem do erro e botão **Tentar novamente a partir desta etapa**.
- O dono pode sair e voltar; o progresso continua de onde parou.
- Ao concluir: link do subdomínio, confirmação de envio do convite e botões **Abrir organização** e **Entrar na conta**.

### 1.5 Detalhes da organização
Cabeçalho fixo com nome, subdomínio, estado, plano e ciclo, e as ações **Entrar na conta**, **Suspender/Reativar** e **Exportar dados**.

Seções:

**a) Resumo:** dados da empresa (editáveis), contatos, admins, data de criação, data de ativação e uso atual × limites.

**b) Assinatura e cobrança**
- Plano, ciclo, valor, desconto aplicado, próxima cobrança, dias de carência.
- Histórico de cobranças: tipo (mensalidade, implantação, técnico extra, créditos, avulsa), valor, vencimento, estado (paga, pendente, vencida, cancelada) e link da fatura.
- Ações: trocar plano, trocar ciclo, aplicar/remover desconto, gerar cobrança avulsa, estender carência, suspender (pede motivo), reativar, cancelar (pede motivo).
- Aviso fixo: "Suspender ou cancelar não apaga dados — a organização fica somente leitura e pode exportar tudo."

**c) Limites e recursos**
- Tabela de limites: técnicos ativos, usuários, armazenamento, mensagens de WhatsApp/mês e execuções da automação Porto/mês. Para cada um: valor do plano, valor personalizado (editável, vazio = usa o do plano) e uso atual.
- Recursos do plano (somente leitura).
- Recursos sob medida: lista com chave liga/desliga por recurso.

**d) Créditos de IA**
- Saldos separados: cota mensal restante (e data de renovação), bônus de entrada e créditos extras comprados.
- Extrato: data, tipo (cota mensal, bônus, compra, consumo, ajuste do dono), descrição/funcionalidade, quantidade (+/−) e saldo após.
- Consumo por período e por funcionalidade de IA.
- Ação **Ajustar créditos** (conceder ou retirar, pede motivo).

**e) Usuários:** nome, e-mail, papel, estado (ativo/inativo) e último acesso. Ações: criar admin, alterar papel, redefinir senha, desativar/reativar.

**f) Configurações da organização** (editáveis pelo dono, mesmos campos da tela `/admin/configuracoes` da empresa — lista completa em `docs/configuracoes.md`): padrões dos técnicos (comissão, salário base, VA, VR); jornada e horas (jornada mensal, adicional de hora extra, intervalo diário, alerta de horas, turno padrão, último dia da Q1, serviço cancelado cobra o previsto); faixas de prêmio por produção; robô do Porto (horário em que entra na fila, horário da escala, dias reprocessados, máximo de horas por dia, escala do mês seguinte, folga integral, usar conclusão do laudo, advertência e texto, registrar serviço cancelado, WhatsApp para alertas do robô); financeiro (aviso de vencimento, categorias de despesa). A API aceita salvar só parte dos campos.

**g) Integrações**
- Porto Seguro: configurada ou não, última execução por tipo (horas, escala), resultado, histórico de execuções com falhas e botão **Executar agora**.
- WhatsApp: instância, estado (conectado/desconectado), mensagens enviadas no mês, ação para reconectar (exibir QR code).
- Armazenamento de arquivos: espaço usado.

**h) Dados**
- **Exportar dados:** gera um pacote com todos os dados e arquivos da organização. Mostra o histórico de exportações (data, quem pediu, estado: gerando/pronta/expirada, baixar).
- **Lixeira:** registros arquivados por tipo (técnicos, OS, documentos, lançamentos financeiros etc.), com data, quem arquivou e ação **Restaurar**.
- **Backups:** retenção vigente (do plano ou personalizada: nº de dias ou "ilimitado"), espaço ocupado pelos backups e lista dos backups diários (data, tamanho, estado: gerando/concluído/falhou, vence em). Ações por backup: **Baixar** e **Restaurar organização para esta data**. A restauração pede confirmação forte com motivo e avisa que um backup do estado atual será feito antes. Ação geral: **Gerar backup agora**.

**i) Auditoria:** eventos da organização (quem, quando, ação, antes/depois), destacando ações feitas pelo dono.

**j) Bugs reportados** por esta organização (atalho para a seção 1.10 filtrada).

**k) Anotações internas:** notas livres do dono sobre o cliente, com data. O cliente nunca vê.

**Entrar na conta:** confirmação com motivo. Abre o sistema da organização. Lá deve aparecer uma faixa permanente "Você está acessando como dono da plataforma — Sair", em todas as telas, e tudo o que for feito fica registrado na auditoria.

### 1.6 Planos
Lista dos planos com nome, preço mensal, preço anual, nº de organizações ativas, visível no site (sim/não) e estado (ativo/arquivado).

Edição de plano:
- Nome, descrição curta, destaque ("mais escolhido"), ordem de exibição.
- Preço mensal, preço anual (mostrar a economia calculada em relação a 12× o mensal), preço por técnico extra, valor da implantação.
- Opção **"Sob consulta / Fale conosco"**: oculta preços e o botão do site leva ao formulário de sob medida.
- Limites: técnicos incluídos, usuários, armazenamento, mensagens de WhatsApp/mês, execuções Porto/mês.
- Recursos incluídos: seleção a partir do catálogo de recursos gerais.
- IA: liberada (sim/não), cota mensal de créditos e bônus de entrada.
- Backup: retenção dos backups diários em dias, ou "ilimitado".
- Visível no site (sim/não).
- Ao salvar uma mudança de preço: escolher entre **aplicar só a novas assinaturas** ou **aplicar a todos a partir do próximo ciclo**, mostrando quantas organizações são afetadas.

Planos iniciais (dados de exemplo):

| | Essencial | Pro | Sob medida |
|---|---|---|---|
| Mensal | R$ 197 (até 5 técnicos) | R$ 397 (até 10 técnicos) | Fale conosco |
| Anual | R$ 1.970 | R$ 3.970 | Fale conosco |
| Técnico extra | R$ 29/mês | R$ 35/mês | — |
| Implantação | R$ 600 | R$ 1.000 | Fale conosco |
| Backup diário | guardado 3 meses | guardado 6 meses | negociado (até ilimitado) |
| Recursos | técnicos, OS, importação de planilhas, horas e banco de horas, escala, folha + recibo, biblioteca | tudo do Essencial + automação Porto, WhatsApp, financeiro e faturamento, dashboard gerencial, IA com créditos | tudo do Pro + funcionalidades desenvolvidas para o cliente |

### 1.7 Cupons e descontos
Lista: código, tipo (% ou valor fixo), valor, duração (nº de ciclos ou permanente), validade, planos aplicáveis, usos/limite de usos e estado.
Ações: criar, editar, desativar. Detalhe com as organizações que usaram.

### 1.8 Créditos de IA (configuração global)
- **Pacotes à venda:** nome, quantidade de créditos, preço e ativo (sim/não).
- **Conversão:** custo da IA por milhão de tokens (entrada e saída), créditos cobrados por uso. Mostra a margem calculada.
- **Indicadores do período:** créditos consumidos, receita de créditos, custo real e margem.
- **Ranking** das organizações que mais consomem.

### 1.9 Catálogo de recursos (funcionalidades)
Lista: chave, nome, descrição, escopo (**Geral** ou **Sob medida**), planos que incluem (se geral), organizações com acesso (se sob medida), data de criação.

Ações:
- Criar recurso.
- **Liberar para organização** (sob medida): escolher organizações.
- **Promover para geral:** escolher em quais planos entra. A confirmação mostra o impacto ("passará a valer para X organizações").
- Desativar recurso (pede motivo).
- Histórico de mudanças do recurso.

Mensagem explicativa na tela: recursos sob medida só afetam as organizações liberadas; nenhuma outra é impactada.

### 1.10 Bugs reportados (caixa de entrada)
Lista: título/início da descrição, organização, usuário, página onde ocorreu, data, prioridade (baixa, média, alta, crítica) e estado (novo, em análise, resolvido, não reproduzido).
Detalhe:
- Descrição, captura de tela e dados técnicos (página, navegador, sistema, data/hora, versão do sistema).
- Conversa com o usuário: as respostas do dono aparecem para ele dentro do sistema.
- Mudar estado e prioridade; nota interna (o usuário não vê).
- Atalho para a organização.

### 1.11 Leads (contatos do site)
Lista: nome, empresa, e-mail, WhatsApp, nº de técnicos, plano de interesse, origem (contratar, sob medida, contato), data e estado (novo, em contato, proposta enviada, ganho, perdido).
Detalhe: mensagem enviada, histórico de anotações e mudança de estado.
Ação **Converter em organização**: abre o assistente da seção 1.3 já preenchido.

### 1.12 Novidades (changelog)
Lista de publicações: título, categoria (novo recurso, melhoria, correção), data, onde aparece (site, sistema, ambos) e estado (rascunho/publicado).
Editor: título, data, categoria, texto com formatação, imagem opcional, onde publicar, salvar rascunho e publicar.

### 1.13 Site (conteúdo do site de marketing)
Todas as seções do site (Parte 2) são editáveis aqui, com **pré-visualização**, **rascunho** e **publicar**:
- **Topo (hero):** título, subtítulo, texto do botão principal e do secundário.
- **Benefícios:** lista de itens (título, texto, imagem opcional), reordenável.
- **Funcionalidades:** lista de itens (título, texto, imagem/print opcional, plano em que está disponível), reordenável.
- **Como funciona:** passos (título, texto), reordenável.
- **Atualizações contínuas:** título e texto do bloco.
- **Segurança dos dados:** título e itens.
- **Planos:** os dados vêm automaticamente da seção 1.6. Aqui só se escolhe se o site abre mostrando mensal ou anual e o texto de rodapé dos planos.
- **Depoimentos:** nome, cargo, empresa, texto, foto opcional, visível (sim/não).
- **Perguntas frequentes:** pergunta e resposta, reordenáveis.
- **Contato:** WhatsApp, e-mail, telefone, horário de atendimento.
- **Rodapé:** razão social, CNPJ, redes sociais e links.
- **SEO:** título da página, descrição e imagem de compartilhamento.
- **Textos legais:** Termos de uso e Política de privacidade (texto com formatação).

### 1.14 Financeiro da plataforma
- Todas as cobranças de todas as organizações: filtros por estado, tipo, período e organização.
- Receita por tipo e por mês.
- **Inadimplentes:** organização, valor em aberto, dias em atraso, estado, ação de reenviar cobrança.
- Evolução do MRR e previsão de recebimentos dos próximos 30/60/90 dias.

### 1.15 Auditoria global
Eventos de todas as organizações e do painel. Filtros: organização, usuário, tipo de ação, período. Detalhe com antes/depois.

### 1.16 Operação (saúde do sistema)
- **Worker de automações:** online/offline, última comunicação, fila de execuções, últimas execuções por organização e falhas.
- **WhatsApp:** instâncias por organização e estado.
- **Backups:** execução diária (data, duração, quantas organizações, falhas), organizações com backup falho, espaço total ocupado por backups, próxima limpeza de backups vencidos. Backup geral da plataforma: último (data, tamanho, estado) e histórico.
- **Banco de dados:** espaço total e por organização.
- **Modo manutenção:** liga/desliga, com mensagem exibida aos clientes.
- **Fila do Porto** (`GET /api/platform/porto-queue`): navegadores ocupados de quantos permitidos, execuções em andamento (organização, o quê, há quanto tempo) e na fila. Com o worker fora, dizer isso.
- **Alertas da plataforma** (`GET /api/platform/alerts`): lista dos alertas enviados ao dono (mudança de tela do Porto com as organizações afetadas, execução travada, fila noturna atrasada, VPS), com data e se o WhatsApp foi entregue ou o motivo de não ter sido.
- **Organizações com aviso de mudança de tela do Porto:** execuções com `layout_suspect` (aparecem em Operação e no detalhe da organização).

### 1.16.0 Capacidade (dentro de Operação)

Aba **Capacidade** (`GET /api/platform/capacity`), para o dono nunca vender mais do que a infraestrutura entrega:
- Quatro números no topo: empresas atendidas (e quantas com automações rodando), % da janela do Porto reservada (e quantas empresas ainda cabem), memória prevista no pico da noite × memória da VPS, armazenamento prometido × contratado.
- **O que a plataforma tem × o que foi prometido:** um bloco por recurso (`resources`) com o texto explicativo (`note`), uma barra do prometido/previsto (`committed`) e uma do uso real (`used`), ambas contra o total (`capacity`), e um selo: com folga (< 70%), perto do limite (70–100%), prometido além do que tem (> 100%), capacidade não informada (`capacity: null`), N com plano ilimitado (`unlimited`).
- Botão **Definir capacidades:** armazenamento contratado (GB), banco contratado (GB), orçamento mensal de IA (R$), minutos do Porto por empresa e por técnico, memória por navegador (MB) — grava em `PUT /settings` (`capacity`).
- **Distribuir recursos** (`/allocation`): seletor do recurso (armazenamento, mensagens de WhatsApp por mês, execuções do Porto por mês, usuários ativos); total da plataforma, distribuído, livre para distribuir e em uso, com barra do distribuído contra o total; aviso para empresas sem limite quando há total. Tabela: organização (plano, situação), o que o plano dá, quanto recebe ("ajustado por você" ou "igual ao plano"), quanto usa, quanto pode ceder. Ações: **Ajustar** (valor próprio, igual ao plano ou sem limite, com motivo) e **Transferir** (para outra empresa, quantidade, motivo). Armazenamento é digitado em GB. Os erros da API (acima do livre, abaixo do uso) aparecem no próprio formulário.
- O botão **Definir capacidades** também tem os totais a distribuir de mensagens de WhatsApp, execuções do Porto e usuários (vazio = sem total).

### 1.16.1 VPS (dentro de Operação)
> **Já implementada** (06/10/2026, no padrão do painel): abas de Operação em `components/platform/vps.tsx` e aba "Alertas e robô" em `components/platform/settings.tsx`. Ao redesenhar, mantenha o conteúdo e as regras abaixo.

Dados: `GET /api/platform/vps…` (rotas em `docs/saas/api-plataforma.md`, seção VPS). A VPS é compartilhada com o sistema original do cliente: a interface precisa deixar claro de quem é cada container e só oferecer ações onde a API permite.
1. **Visão geral:** CPU, RAM e disco agora (com total e livre), uptime e sistema; gráficos de 24h / 7 dias / 30 dias (CPU média e pico, RAM usada, disco %, tráfego de rede); estado do agente da VPS (sem agente configurado ou sem resposta, mostrar a mensagem `agentError`); **ocupação da janela noturna** do robô (minutos usados por noite × capacidade, últimas noites) — quando passa de ~70%, sinalizar que é hora de mais navegadores ou outra VPS.
2. **Containers:** cada container com selo do dono (NextRotta / Produção / Compartilhado / Desconhecido), estado, há quanto tempo está de pé, reinícios, imagem, tamanho, CPU, RAM (e limite), tamanho do log e se tem rotação de log. Ver logs (últimas 200 linhas, opção de mais). **Reiniciar** só aparece para NextRotta; para Compartilhado, com uma confirmação forte avisando que o WhatsApp de todos os sistemas (inclusive o do cliente em produção) cai por alguns segundos; Produção e Desconhecido são só leitura (explicar o porquê). Histórico de CPU/RAM do container.
3. **Imagens e cache:** espaço por imagem, em uso ou não, dono, idade; cache de build; quanto dá para liberar.
4. **Limpeza:** botão "Ver prévia" → lista do que sai (com o motivo de cada item) e quanto libera → "Executar" com confirmação → resultado (o que saiu, falhas, disco antes/depois). Histórico de limpezas (prévia, manual, automática). Liga/desliga da **limpeza automática diária (04:30)** — enquanto desligada, mostrar que o dono deve primeiro comparar a prévia com a limpeza antiga (o log dela aparece em `GET /vps/disk` → `legacyCleanupLog`).
5. **Gastos:** lançamentos do mês por categoria (VPS, Vercel, banco, domínio, WhatsApp, IA, e-mail, outros), adicionar e arquivar lançamento; total do mês. **Rateio por organização** (`/vps/costs/allocation?month=`): minutos de navegador do Porto, execuções, mensagens de WhatsApp, custo estimado, quanto paga por mês e margem; explicar o método (`method`).
6. **Alertas** que chegam ao dono (por WhatsApp e listados na tela): disco ≥ 80% (aviso) e ≥ 90% (crítico), RAM disponível < 1 GB, container do NextRotta parado, agente sem responder, execução travada, fila noturna depois das 06:00, mudança de tela do Porto.

### 1.17 Configurações da plataforma
- Dados do dono/empresa da plataforma.
- **Cobrança:** dias de carência padrão, lembretes de vencimento (quantos dias antes e depois), ambiente do gateway (teste/produção), estado da conexão com o gateway e do webhook.
- **IA:** estado da conexão com o provedor.
- **WhatsApp:** servidor e estado.
- **WhatsApp de alertas da plataforma** (`/api/platform/alerts-whatsapp` e `PUT /settings { alerts: { phone } }`): número que recebe os alertas do dono e a conexão da instância da plataforma (`nextrotta-alertas`) — estado, conectar com QR Code (renovar o código), desconectar.
- **Robô do Porto:** navegadores ao mesmo tempo na VPS (`porto.maxBrowsers`, de 1 a 4; explicar que mais navegadores aceleram a fila noturna mas arriscam a memória da VPS compartilhada).
- **VPS:** limpeza automática diária liga/desliga (`vps.autoCleanup`).
- **E-mails:** remetente e modelos (convite, cobrança, suspensão, reativação), com variáveis.
- Subdomínios reservados (lista editável).
- **Minha conta:** nome, e-mail, senha e autenticação em dois fatores.

---

## Parte 2 — Site de marketing (público)

Todo o conteúdo vem do que for configurado na seção 1.13 (use os mocks).

### 2.1 Página inicial
Seções, nesta ordem lógica (a disposição visual fica a seu critério):
1. Topo com proposta de valor e chamadas para **Ver planos** e **Falar com a gente**.
2. Benefícios (substituir planilhas, folha e comissão calculadas sozinhas, escala organizada, técnicos com acesso próprio).
3. **Assistente de IA** (plano Pro): pergunte qualquer coisa sobre a sua operação — OS, técnicos, folha, gastos, escala — e receba respostas, análises e sugestões na hora. Exemplos de perguntas: "Quanto gastei com folha este mês?", "Qual técnico mais produziu na Q1?", "Tem algo estranho na folha de setembro?".
4. Funcionalidades.
5. Como funciona: contratar → implantação (configuramos e treinamos sua equipe) → usar.
6. **Atualizações contínuas:** "O NextRotta é atualizado periodicamente com novos recursos — sem aumentar sua mensalidade. Toda melhoria geral chega para todos os clientes do plano." Link para Novidades.
7. **Seus dados seguros:** nada é apagado se a assinatura atrasar (o acesso só é pausado), exportação de todos os seus dados a qualquer momento, backup diário guardado por 3 meses (Essencial), 6 meses (Pro) ou pelo tempo que você precisar (Sob medida).
8. Resumo dos planos com link para a página de planos.
9. Depoimentos.
10. Perguntas frequentes.
11. Chamada final para contato.

### 2.2 Planos
- Alternância **Mensal / Anual**, mostrando a economia no anual ("2 meses grátis").
- Três colunas: **Essencial**, **Pro** (destaque) e **Sob medida** (sem preço, botão **Fale conosco**).
- Para cada plano: preço, técnicos incluídos, preço do técnico extra, valor da implantação, tempo de guarda do backup diário e lista de recursos.
- No Pro, destacar a IA: "Créditos de IA inclusos todo mês. Precisa de mais? Compre créditos extras quando quiser."
- Comparativo completo de recursos entre os planos.
- Avisos: implantação inclui configuração e treinamento; atualizações sem custo extra; dados nunca apagados por atraso.
- Perguntas frequentes sobre cobrança.
- Botões **Contratar** (leva a `/contato` com o plano pré-selecionado).

### 2.3 Contato / Contratar (`/contato`)
Formulário: nome, empresa, e-mail, WhatsApp, nº de técnicos, plano de interesse (pré-selecionado quando vier da página de planos), ciclo preferido (mensal/anual) e mensagem.
Confirmação após envio. Links diretos para WhatsApp e e-mail.

### 2.4 Sob medida (`/sob-medida`)
Explica o plano Sob medida: funcionalidades desenvolvidas para a sua operação, isoladas para a sua empresa. Formulário: dados de contato + descrição da necessidade + nº de técnicos.

### 2.5 Novidades (`/novidades`)
Lista das publicações marcadas para o site (seção 1.12), da mais recente para a mais antiga, com categoria e data.

### 2.6 Login (`/login`)
- E-mail e senha, **Esqueci minha senha** (fluxo: informar e-mail → mensagem de que o link foi enviado).
- Mensagens de erro: credenciais inválidas; usuário inativo; organização suspensa ("Acesso pausado por pendência na assinatura — o administrador pode regularizar e exportar os dados").
- Após o login, o usuário é levado ao sistema da empresa dele (`empresa.nextrotta.com.br`) ou, se for o dono, ao painel. Mostre um estado de "redirecionando".

### 2.7 Termos de uso e Política de privacidade
Páginas de texto com o conteúdo configurado em 1.13.

---

## Entregáveis

- Todas as telas acima, navegáveis, com dados fictícios realistas: nomes de empresas brasileiras, CNPJs fictícios e valores em R$.
- Estados de carregando, vazio e erro em cada tela.
- Diálogos de confirmação das ações sensíveis.
- Interfaces TypeScript dos dados em uma pasta de mocks.
