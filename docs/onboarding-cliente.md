# Checklist de implantação: o que pedir ao cliente

Padrão para empresas **vitalícias** (sem cobrança, sem plano a contratar). Marque cada item ao receber. O que não se aplica ao cliente (por exemplo, WhatsApp ou Venda de Peças) fica de fora.

## 1. Empresa
- [ ] Razão social e nome fantasia
- [ ] CNPJ ou CPF
- [ ] Endereço completo
- [ ] WhatsApp e e-mail de contato
- [ ] Subdomínio desejado (vira `<slug>.nextrotta.app`; confira se está livre)
- [ ] Logo e o nome que deve sair nos termos impressos

## 2. Pessoas e acessos
- [ ] **Administrador principal:** nome, e-mail (único na plataforma inteira) e telefone
- [ ] Outros usuários administrativos, se houver: nome, e-mail e papel
- [ ] **Lista de técnicos** (uma planilha, uma linha por técnico):
  - [ ] Nome completo
  - [ ] QRA (único entre os ativos)
  - [ ] E-mail (para o técnico entrar no sistema)
  - [ ] Telefone com DDD (é o número do WhatsApp)
  - [ ] Nome como aparece no Portal do Porto (para o vínculo do robô)
  - [ ] Salário base, VA, VR e % de comissão, quando diferentes do padrão da empresa
  - [ ] Situação (ativo ou inativo)
- [ ] Dados pessoais dos técnicos entram na LGPD: peça só o necessário e por canal que o cliente controle

## 3. Regras de pagamento (Configurações)
Peça por escrito e, de preferência, com um exemplo real de folha de um técnico para conferir o cálculo.
- [ ] **Modo de comissão:** excedente, percentual, por OS, por hora, por dia ou nenhuma
  - [ ] Percentual ou valor, e mínimo e máximo do mês, se houver
- [ ] Salário base, VA e VR padrão (para técnico sem valor próprio)
- [ ] Jornada mensal (padrão 220 h)
- [ ] Adicional de hora extra (padrão 1,5×)
- [ ] Intervalo diário (padrão 60 min)
- [ ] **Faixas de prêmio por produção** (nº de OS e valor; também são as metas do técnico)
- [ ] Como funciona o banco de horas
- [ ] Horário padrão do turno
- [ ] Horário em que a importação automática deve rodar
- [ ] Prazo do laudo (padrão 6 h após o Concluído)
- [ ] Quantos dias anteriores reprocessar (1 a 7)
- [ ] Quem manda na escala: a automação do Porto ou o próprio sistema

## 4. Acesso ao Portal do Prestador (Porto)
- [ ] Login e senha do portal, **com autorização expressa** para o robô acessar
  - [ ] Combinar canal seguro de envio (nunca WhatsApp aberto)
- [ ] Confirmar que o login funciona e que a conta **não** tem verificação em duas etapas
- [ ] Saber se há mais de uma conta ou unidade no Porto
- [ ] Como cada técnico aparece no portal (vínculo)
- [ ] Combinar de começar em modo **Teste** e só passar para **Valendo** depois de conferir com a folha dele

## 5. Dados históricos e planilhas
- [ ] **Ordens de serviço** (opcional, se quiser histórico): modelo em `public/planilhas/list_os.xlsx`
  - [ ] Número da Ordem de Serviço
  - [ ] Valor Total
  - [ ] Especialidade
  - [ ] Socorrista
  - [ ] QRA
  - [ ] Data de atendimento (data e hora)
  - [ ] Sigla da viatura
  - [ ] Definir a partir de qual mês importar
- [ ] **Horas trabalhadas** do mês corrente: data, entrada, saída e técnico (o robô do Porto preenche depois)
- [ ] **Escala:** modelo (semana sim e não, equipes que se alternam, plantões, fins de semana) e a escala do mês atual e do próximo
- [ ] **Folha** do mês anterior fechada, como referência de conferência
- [ ] **Saldo do banco de horas** de cada técnico
- [ ] **Descontos e adiantamentos** em aberto, por técnico (valor e parcelas)

## 6. WhatsApp (se for usar)
- [ ] Número da empresa que vai enviar as mensagens
- [ ] Quem vai ler o QR Code e quando
- [ ] Quais notificações quer (fim do expediente, lembretes, folha etc.) e em quais horários
- [ ] Confirmar que o número não está em outra automação (pode derrubar a conexão)

## 7. Módulos opcionais (só se for usar)
- [ ] **Financeiro e despesas:**
  - [ ] Contas a pagar e a receber recorrentes
  - [ ] Categorias
  - [ ] Orçamento e avisos
- [ ] **Venda de Peças:**
  - [ ] Catálogo (código de barras, preço de técnico, quantidade em estoque)
  - [ ] O que cada técnico leva em consignação hoje
  - [ ] Conta do Mercado Pago de cada técnico, se for receber pelo sistema
- [ ] **Assistente de IA:** quem vai usar (os créditos são concedidos por você)

## 8. Alinhamento operacional
- [ ] Contato do dia a dia e responsável pela implantação
- [ ] Datas do treinamento, da validação (comparar o sistema com a folha dele) e da liberação
- [ ] Canal de suporte combinado (chamados pelo sistema e WhatsApp)
- [ ] Aceite dos documentos legais (termos, privacidade e DPA) pelo administrador no primeiro acesso
- [ ] Aceite do envio de dados à DeepSeek (fica fora do Brasil), só se for usar o assistente de IA

## Do meu lado (não pedir ao cliente)
- [ ] Criar a organização e marcá-la como **vitalícia** (Organizações → detalhe → "Tornar vitalícia", com o motivo)
- [ ] Ligar os recursos que ele vai usar
- [ ] Definir os limites da empresa, inclusive o container de armazenamento
- [ ] Conferir que o **worker na VPS** está atualizado e com `BLOB_READ_WRITE_TOKEN` (sem isso os backups diários não rodam)
- [ ] Se o cliente for usar WhatsApp: ter o Evolution próprio do NextRotta no ar
- [ ] Rodar o Porto em modo Teste por cerca de uma semana, comparando com a folha dele
- [ ] "Liberar plataforma" ao final, quando o cliente validar

## Atenção ao primeiro cliente
- O **Porto real nunca foi testado** com credenciais de uma organização autorizada: este cliente é o primeiro teste. Planeje a semana em modo Teste.
- Mesmo vitalícia, a empresa **conta nos custos** (Porto, armazenamento, IA, banco). Confira a margem em Custos no detalhe da organização.
