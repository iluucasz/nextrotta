# NextRotta — desenho do SaaS

Desenho fechado em 2026-10-03. Nada disto está implementado ainda. A especificação de telas do painel do dono e do site de marketing está em `docs/saas/prompt-painel-dono.md` (prompt para a IA de design).

## 1. Objetivo

Transformar o Central Operacional (sistema dedicado de um cliente) na plataforma **NextRotta**: SaaS multi-cliente por assinatura no estilo Salesforce. Cada cliente é uma **organização** com dados, usuários, configurações, créditos e limites próprios. O dono da plataforma enxerga e administra todas.

## 2. Superfícies do produto

| Superfície | Endereço | Quem usa |
|---|---|---|
| Site de marketing + login | `nextrotta.com.br` | visitantes, todos os usuários (login) |
| Painel do dono | `nextrotta.com.br/plataforma` | só `platform_owner` |
| Sistema da organização | `<slug>.nextrotta.com.br` | admin e usuários da organização |

- Login sempre em `nextrotta.com.br`: o e-mail (único na plataforma) identifica a organização e o usuário é redirecionado para o subdomínio dela. O dono vai para o painel.
- Cookie de sessão no domínio `.nextrotta.com.br`; o token carrega `organizationId` e o middleware recusa token de uma organização usado no subdomínio de outra.
- Subdomínios reservados (não podem ser slug): `www`, `app`, `api`, `admin`, `painel`, `plataforma`, `login`, `suporte`, `status`, `blog`, `docs`, `mail`.
- Vercel: wildcard `*.nextrotta.com.br` com os nameservers da Vercel. Em desenvolvimento, `<slug>.localhost:3000`.

## 3. Papéis

- `platform_owner` — o dono. Acesso total: cria organizações, entra na conta de qualquer uma e altera dados, define planos, limites, créditos e configurações globais.
- `admin` — administra só a própria organização: usuários, técnicos, configurações da organização, assinatura, créditos, exportação.
- `technician` e demais papéis da organização — como hoje.
- **Entrar na conta de uma organização** (dono): sessão marcada como "acesso do dono", com faixa visível e **registro em auditoria** de tudo o que for alterado. Diferente do modo preview atual (admin vendo como técnico), que segue somente leitura.

## 4. Planos e preços

Planos, preços, limites e recursos ficam no banco e são editados pelo dono no painel — os valores abaixo são os iniciais, não constantes no código.

| | **Essencial** | **Pro** | **Sob medida** |
|---|---|---|---|
| Mensal | R$ 197/mês, até 5 técnicos | R$ 397/mês, até 10 técnicos | "Fale conosco" |
| Anual | R$ 1.970/ano (2 meses grátis) | R$ 3.970/ano (2 meses grátis) | negociado |
| Técnico extra | R$ 29/mês | R$ 35/mês | negociado |
| Implantação (única) | R$ 600 | R$ 1.000 | negociada |
| Backup diário (retenção) | 3 meses (90 dias) | 6 meses (180 dias) | negociada, pode ser ilimitada |
| Recursos | técnicos, OS, importação de planilhas, horas e banco de horas, escala, folha + recibo, biblioteca | tudo do Essencial + automação Porto, WhatsApp, financeiro e faturamento, dashboard gerencial, **IA com créditos** | tudo do Pro + funcionalidades desenvolvidas para o cliente |

- **Ciclo mensal ou anual**, escolhido por organização; troca de ciclo/plano pelo dono ou pelo admin.
- **Implantação** = configuração do cliente (criar organização, importar planilhas/histórico, configurar regras, conectar Porto e WhatsApp, treinamento). Não inclui desenvolvimento.
- **Descontos/cupons** por organização (ex.: programa de fundadores) configuráveis pelo dono.
- **Contratação:** o site leva a um formulário de contato/contratação (lead). O dono cria a organização, a cobrança (implantação + primeiro ciclo) sai pelo Asaas e, com o pagamento confirmado, a organização é provisionada. Checkout automático pelo site fica para depois.
- **Atualizações contínuas sem custo extra:** novos recursos gerais chegam a todas as organizações dos planos correspondentes sem alterar a mensalidade (mensagem de marketing e compromisso do produto).

## 5. Créditos de IA (DeepSeek)

- IA disponível no **Pro** (e Sob medida). O dono pode liberar em outros planos pela configuração do plano.
- Três origens de crédito, consumidas nesta ordem:
  1. **Cota mensal** do plano — renova a cada ciclo mensal, não acumula.
  2. **Bônus de entrada** — crédito inicial concedido ao ativar o Pro.
  3. **Créditos extras** comprados pelo cliente em pacotes (cobrados pelo Asaas).
- Sem saldo: a funcionalidade de IA fica bloqueada até recarga ou renovação da cota; o resto do sistema continua normal.
- Tudo registrado num **extrato de créditos** (ledger) por organização: concessões, compras, consumo por uso (com tokens e custo real no DeepSeek), ajustes manuais do dono.
- O dono configura: valor da cota mensal por plano, bônus de entrada, pacotes à venda e preços, conversão tokens → créditos (margem sobre o custo DeepSeek).

### Assistente de IA (escopo)

Assistente que responde sobre **tudo do sistema e dos dados da organização**:
- **Dúvidas de uso** ("como importo planilha?", "como fecho a folha?") — a partir de uma base de ajuda do sistema mantida no código.
- **Consultas aos dados:** OS, técnicos, horas e banco de horas, escala, folha, financeiro (gastos, receitas, contas), documentos, recursos e limites do plano.
- **Análises:** análise da folha (variações, valores fora do padrão, comissão), gastos e resultado por período, produção por técnico.
- **Sugestões:** escala, ajustes na operação, pontos de atenção.

Formas de uso: chat disponível em todas as telas + ações prontas em telas específicas (ex.: "Analisar esta folha" na folha, "Sugerir escala" na escala), todas consumindo créditos.

Regras de segurança (obrigatórias):
- **A IA nunca acessa o banco diretamente nem gera SQL.** Ela só chama funções de consulta do servidor (function calling), cada uma já filtrada por `organization_id` — impossível ver dados de outra organização.
- **Respeita o papel do usuário:** técnico só consulta os próprios dados (mesmas regras de visibilidade de hoje); admin vê a organização inteira.
- **Somente leitura:** a IA sugere, mas não altera dados. Aplicar uma sugestão é sempre uma ação do usuário na tela correspondente.
- **Dados mínimos:** enviar ao DeepSeek só o necessário para a resposta; nunca senhas, credenciais Porto/Evolution ou documentos pessoais (CPF etc.).
- Conversas guardadas por usuário (sem exclusão definitiva, como o resto) e cada chamada registrada no extrato de créditos com tokens e custo.
- **LGPD:** o DeepSeek processa dados fora do Brasil — a Política de Privacidade e os Termos precisam informar o uso de IA de terceiros e essa transferência internacional.

## 6. Assinatura, inadimplência e o que nunca acontece

Estados da organização:

| Estado | Quando | Efeito |
|---|---|---|
| `provisioning` | criada, montando o ambiente | sem acesso, tela de progresso no painel do dono |
| `active` | em dia | acesso normal |
| `past_due` | cobrança vencida, dentro da carência (padrão 7 dias, configurável) | acesso normal + aviso para regularizar |
| `suspended` | carência esgotada ou suspensão manual | **somente leitura**: login funciona, nada pode ser criado/alterado, automações (Porto, WhatsApp, IA) pausadas; admin ainda vê a cobrança e **pode exportar os dados** |
| `canceled` | cancelamento a pedido | igual a `suspended`; dados mantidos |

- **Nada é apagado por falta de pagamento ou cancelamento** — só desabilitado. Pagar reativa na hora (webhook do Asaas).
- O dono pode suspender, reativar ou estender a carência manualmente.

## 7. Dados: nunca excluir, exportar, backup

- **Exclusão lógica em todas as tabelas de domínio:** colunas `deleted_at`/`deleted_by`; "excluir" na interface marca o registro. Consultas filtram `deleted_at IS NULL`. Hoje há ~10 pontos no servidor com `DELETE FROM` e 5 rotas `DELETE` em `app/api/` a converter. Arquivos do Blob também não são apagados (só marcados).
- **Lixeira:** admin e dono podem restaurar registros excluídos.
- **Proteção no banco:** o app conecta com um papel do Postgres **sem permissão de `DELETE`, `TRUNCATE` nem DDL**. Mudanças de schema saem do runtime (`ensure*Schema()`) e viram **migrações versionadas** rodadas com um papel separado. Assim, nem um bug do app consegue apagar dados.
- **Auditoria:** tabela de eventos com quem, quando, organização, o que mudou (antes/depois) para ações sensíveis (folha, pagamentos, usuários, configurações, acessos do dono).
- **Exportação:** admin (e o dono, por qualquer organização) gera um pacote ZIP com todos os dados da organização (CSV/JSON por tabela + arquivos da biblioteca). Gerado em segundo plano, com link de download temporário.
- **Backup por organização (o que o cliente contrata):**
  - Todo dia o worker gera um backup **de cada organização** (todos os dados dela, compactados) e guarda em armazenamento externo, fora do Neon. Tem que ser por organização porque a retenção varia por plano.
  - **Retenção pelo plano:** Essencial 90 dias, Pro 180 dias, Sob medida negociada (pode ser ilimitada). A retenção é um campo do plano (dias ou "ilimitado"), editável pelo dono, com sobrescrita por organização.
  - Backups vencidos são removidos por um job diário. **Esta é a única exclusão definitiva do sistema e vale só para cópias de backup** — os dados do sistema continuam nunca sendo apagados.
  - Arquivos da biblioteca não são copiados todo dia (como nunca são apagados, o backup guarda a lista de arquivos e eles ficam no storage).
  - O backup mais recente de cada organização **nunca** é removido, mesmo vencido.
  - Organização `suspended`/`canceled`: os dados não mudam, então para de gerar backup novo e os existentes deixam de vencer.
  - Mudança de plano: a nova retenção vale a partir da próxima limpeza (Pro → Essencial descarta o que passar de 90 dias).
  - Registro em tabela `organization_backups`: organização, data, tamanho, local no storage, estado (gerando, concluído, falhou), data de vencimento.
  - **Restauração** (só o dono): baixar o backup ou restaurar a organização inteira para aquela data. Antes de restaurar, um backup do estado atual é gerado automaticamente.
- **Backup da plataforma (segurança do dono):** além disso, restauração pontual do Neon (janela conforme o plano Neon) + backup diário completo do banco com retenção curta, para recuperar desastre. Independe dos planos.
- **LGPD:** a única forma de remover dados é um processo manual do dono, a pedido formal do titular/cliente, com anonimização e registro em auditoria. Nunca automático.

## 8. Funcionalidades sob medida (feature flags)

- Catálogo de recursos (`features`) com chave, nome, descrição e escopo:
  - **geral** — faz parte dos planos;
  - **sob medida** — liberado só para organizações específicas.
- Código sob medida fica isolado (pasta própria por recurso) e só roda quando a organização tem o recurso ligado — **não altera o comportamento das outras organizações**.
- **Promover para geral:** o dono move o recurso para o catálogo dos planos; passa a valer para todos os planos escolhidos sem reescrever código.
- Cada liberação é registrada em auditoria.

## 9. Report de bug

- Botão "Reportar problema" em todas as telas do sistema da organização: descrição, captura de tela opcional, e o app anexa sozinho página, navegador, organização, usuário e horário.
- Painel do dono: caixa de entrada com status (novo, em análise, resolvido, não reproduzido), prioridade, resposta ao usuário (aparece para ele no sistema) e vínculo com a organização.

## 10. Novidades (changelog)

- O dono publica notas de versão no painel. Aparecem no site de marketing (página de novidades) e dentro do sistema dos clientes (aviso de "novidades").
- Reforça a mensagem "o sistema é atualizado periodicamente, sem custo extra".

## 11. Alocação de recursos e limites

Limites por organização = limites do plano, com sobrescrita individual pelo dono:
técnicos ativos, usuários, armazenamento (banco aproximado por `organization_id` + arquivos no Blob), créditos de IA, mensagens de WhatsApp/mês, execuções da automação Porto. Ao atingir um limite, a ação é bloqueada com mensagem clara; nada existente é afetado.

## 12. Infraestrutura

- **Banco:** um Neon (plano Launch no início, Scale quando houver SLA a cumprir), isolamento por `organization_id` + índices por `organization_id` em todas as tabelas; Row Level Security como rede de segurança. Acesso ao banco centralizado em `lib/db.ts` (hoje há 8 conexões espalhadas). Saída futura: cliente muito grande pode ir para projeto Neon próprio; Postgres puro permite migrar de provedor.
- **Usuários:** tabela própria com `organization_id`, substituindo `neon_auth."user"`. O schema herdado do cliente dedicado pode ser redesenhado.
- **Worker compartilhado:** itera as organizações ativas com credenciais Porto/Evolution de cada uma (uma instância Evolution por organização), fila com concorrência limitada para o Playwright, falha isolada por organização, horários configuráveis por organização. Organizações `suspended`/`canceled` são puladas.
- **Cobrança:** Asaas (conta criada), atrás de uma interface própria; status por webhook.
- **IA:** DeepSeek, chamada só pelo servidor, com débito de créditos por uso.
- **Configurações da organização** (admin): percentual de comissão, VA/VR, salário base padrão, jornada mensal (220h), horários das automações, dados da empresa.

## 13. Provisionamento de uma organização

Disparado pelo dono (ou pela confirmação do pagamento). Etapas reais, exibidas em tela de progresso:
1. Criar organização e slug (subdomínio).
2. Aplicar plano, limites e créditos iniciais.
3. Criar configurações padrão da organização.
4. Criar usuário admin e enviar convite/credenciais.
5. Criar instância de WhatsApp (se o plano tiver).
6. Registrar a organização no worker (se o plano tiver Porto/WhatsApp).
7. Validar o acesso ao subdomínio.

Falha numa etapa mostra o erro e permite tentar de novo a partir dela.

## 14. Ordem de implementação

1. Base multi-tenant: `organizations`, usuários próprios, login + subdomínio, `platform_owner`, conexão centralizada.
2. `organization_id`, exclusão lógica e índices em todas as tabelas; migrações versionadas; papel do banco sem `DELETE`.
3. Configurações da organização substituindo regras fixas.
4. API do painel do dono (organizações, provisionamento, acesso à conta, limites, auditoria) + integração da interface feita pela IA de design.
5. Planos, assinatura e Asaas (implantação, mensal/anual, inadimplência, suspensão).
6. Exportação, backup e lixeira.
7. Feature flags, report de bug, novidades.
8. Créditos de IA + primeiras funcionalidades com DeepSeek.
9. Worker multi-organização.
10. Site de marketing com conteúdo editável pelo painel.

## 15. Em aberto

- Valor do crédito e tamanho da cota mensal do Pro (calibrar com o consumo real do assistente nos primeiros clientes).
- Se técnicos (não só admins) terão acesso ao assistente e se consomem os créditos da organização.
- Onde guardar os backups (recomendado: Cloudflare R2 ou outro storage compatível com S3, fora do Neon e da Vercel).
- Política de retenção de dados de organizações canceladas há muito tempo (hoje: manter indefinidamente).
- Checkout automático pelo site (hoje: contratação via contato + dono provisiona).
