# Backups por empresa

Cada empresa tem a sua cópia, todo dia à meia-noite, guardada fora do banco, e o administrador pode restaurar a
empresa para aquele ponto. Tela: Configurações → **Backups** (`/admin/configuracoes/backups`).

## O que acontece

- **Todo dia às 00:00 (Brasília)** o worker faz um backup de cada empresa em uso (`active`/`past_due`; `suspended` e
  `canceled` não mudam, então não geram cópia nova). Se o worker estava parado à meia-noite, o primeiro ciclo de 30
  minutos do dia faz o que faltou. Uma empresa nunca ganha dois backups diários no mesmo dia (índice único).
- **Fazer backup agora** (administrador): cópia manual, no máximo uma a cada 2 minutos.
- **Antes de restaurar**, o sistema guarda uma cópia do estado atual (`before_restore`). Se essa cópia falhar, a
  restauração nem começa.
- **Antes de bloquear** (`closing`): um dia antes do fim da carência (`runBillingMaintenance`, 06:00) e no momento em que a
  empresa é suspensa (por falta de pagamento ou pelo dono) ou cancelada, é feita uma cópia nova para que o que ela baixa
  na tela de bloqueio seja o mais atual possível (`createClosingBackup`: nunca derruba o bloqueio se falhar; não repete em
  6 horas). Empresa bloqueada não ganha backup diário (não muda).
- **Retenção:** `plans.backup_retention_days` (**Essencial e "Monte o seu" 30 dias, Pro 90**, migração `0040`; o dono edita em Planos; vazio = sem limite; sem assinatura = 90). Depois da
  rotina da noite, as cópias mais velhas que isso saem do armazenamento e a linha vira `expired`. **É a única exclusão
  definitiva do sistema e só atinge cópias de backup.** A cópia mais recente nunca é removida, e empresa suspensa ou
  cancelada não vence.

## Onde fica

- Registro: tabela `organization_backups` (migração `0034`): tipo (`daily`/`manual`/`before_restore`), estado
  (`running`/`completed`/`failed`/`expired`), tamanho, contagem por tabela, quem restaurou e quando.
- Arquivo: `backups/<empresa>/<data>-<tipo>-<id>.json.gz` no Blob privado (o mesmo `BLOB_READ_WRITE_TOKEN` da biblioteca;
  o worker precisa dele no ambiente do container). Só é lido pela API, que confere de quem é.
- O arquivo é um JSON compactado com **todas** as tabelas da empresa (`lib/backup/tables.ts` → `BACKUP_TABLES`, também a
  lista da exportação), arquivados incluídos, **sem** `password_hash`, senha do Porto nem tokens do Mercado Pago.
  Tabela nova com `organization_id` precisa entrar em `BACKUP_TABLES` (ou em `BACKUP_EXCLUDED`, de propósito):
  `node scripts/test-backup-coverage.cjs` confere isso contra o banco.
- Uma única transação de leitura (`RepeatableRead`) tira a foto, então o arquivo é consistente entre tabelas.

## Planilha (download)

`lib/backup/workbook.ts` (`exceljs`, escrita em fluxo: 250 mil OS em ~14 s e sem estourar memória). Rota
`GET /api/organization/backups/<id|ultimo|atual>/planilha` (`ultimo` = a cópia mais recente; `atual` = a empresa agora,
lida do banco, para quando não há cópia). Um `.xlsx` com a aba **Resumo** (empresa, data e horário de Brasília, tipo, índice
com links para cada aba, quantos registros e quantos arquivados, notas de como ler) e **uma aba por assunto**, na ordem
Operação (técnicos, serviços/OS, horas, escala, folhas, descontos) → Financeiro → Venda de Peças → Empresa (configurações,
usuários, documentos) → Integrações → Plano e IA → Sistema (chamados, notificações, auditoria). Cada aba: cabeçalho escuro
fixo com filtro, larguras ajustadas, **nomes no lugar de códigos** (técnico, peça, conta, venda), datas/horas de verdade no
fuso de Brasília, valores em R$, horas, %, situação em palavras, mais recentes primeiro, e **registros arquivados
mantidos** com a data na coluna "Arquivado em". Configurações viram uma lista "configuração / valor" em português. Tabela
vazia aparece no Resumo mas não ganha aba. Passou de 1 milhão de linhas, continua em "(2)". Senhas, chaves e tokens não
entram; arquivos da biblioteca também não (só o registro). Cada aba tem a cor do seu grupo. Para mudar colunas: `SPECS` no topo
do arquivo (tabelas sem entrada ganham uma aba genérica, para nada ficar de fora). Teste: `node scripts/test-backup-workbook.cjs`.

## Restaurar e desfazer

- **Aviso e prévia:** a janela diz "Voltar a empresa para <data>?", conta o que muda por tabela (`GET .../<id>/preview`:
  quantos voltam como estavam e quantos feitos depois serão arquivados; `previewRestore`, `previewCounts`) e explica os 3
  passos: guarda uma cópia de agora, volta para a data, e "Desfazer restauração" volta para a cópia de agora. Continua
  exigindo digitar `RESTAURAR`.
- **Desfazer:** ao concluir a restauração e num banner na tela de Backups (`getLastRestore`: a última restauração cuja cópia
  de "antes" ainda existe e não foi restaurada), o botão **Desfazer restauração** restaura a cópia de antes. Como isso cria
  a sua própria cópia de antes, o desfazer também pode ser desfeito.

## Acesso bloqueado

Empresa suspensa (falta de pagamento, depois da carência `grace_days`, ou pelo dono) ou cancelada fica **bloqueada na hora**:
`DEFAULT_READ_ONLY_DAYS = 0` e `platform_settings.readOnlyDays = 0` (o dono ainda pode conceder dias de consulta em
Configurações). A empresa só chega a `/acesso-encerrado` (`middleware.ts`: `exportOnlyAllowed*`), que mostra o motivo, a
cobrança em aberto com **Pagar agora**, **Abrir chamado** (um chamado de suporte, a única escrita liberada, mais o WhatsApp
publicado), e **Baixar planilha** do último backup (e o arquivo completo); sem backup, "Gerar e baixar a planilha" lê a
empresa na hora. A página confere o acesso a cada 20 s e abre o sistema sozinha quando o pagamento é confirmado. Nessa tela a
empresa só *baixa* (GET em `/api/organization/backups`); fazer backup e restaurar ficam bloqueados. `past_due` (carência)
usa o sistema normalmente. Teste: `node scripts/test-backup-flow.cjs`.

## O que a restauração devolve

`RESTORE_TABLES` (`lib/backup/tables.ts`): técnicos, ordens de serviço, horas, escala, folhas, descontos e adiantamentos,
contas e pagamentos de despesas, orçamentos, documentos (registro), configurações e visibilidade do técnico.

**Não muda** (de propósito): assinatura e cobranças, créditos de IA, usuários e senhas, WhatsApp, Porto, Mercado Pago,
auditoria e a **Venda de Peças** (as movimentações de estoque só crescem; voltar o saldo seria mentira). Quem precisar
desfazer algo nesses pontos fala com o suporte.

Como é feita (`lib/backup/rules.ts` + `restore.ts`), tudo em **uma transação**: ou volta tudo, ou nada muda:

1. o que o backup não tem é **arquivado** (`deleted_at`), nunca apagado — vale para OS, horas, folhas etc. criadas depois;
2. o que o backup tem é gravado de volta por cima (inclusive o `deleted_at` da época: uma OS arquivada naquele dia volta
   arquivada);
3. técnicos são todos arquivados antes e regravados, para dois deles poderem trocar de QRA sem esbarrar no índice único;
4. orçamentos que não existiam voltam a R$ 0; configurações só são regravadas;
5. colunas criadas depois do backup mantêm o valor atual; colunas que não existem mais são ignoradas;
6. um registro de **outra empresa** dentro do arquivo faz a restauração parar antes de tocar em qualquer coisa.

Como a cópia de antes também é um backup, **restaurar a cópia de antes desfaz a restauração** (testado).
Auditoria: `backup.restored` (quem, qual backup, o que mudou por tabela). A restauração exige digitar `RESTAURAR` (a API
confere), só administrador (nunca o modo preview) e é bloqueada nos estados de somente leitura.

## API

`GET/POST /api/organization/backups` (lista + próxima execução + retenção + última restauração desfazível; fazer agora),
`GET/POST /api/organization/backups/[id]` (baixar o arquivo; restaurar com `{ confirm: "RESTAURAR" }`),
`GET /api/organization/backups/[id]/planilha` e `GET /api/organization/backups/[id]/preview`.

## Testes

- `node scripts/test-backup-rules.cjs`: dia de Brasília, próxima meia-noite, vencimento (a última cópia fica), instruções
  da restauração (nada de `DELETE`, parâmetros certos, outra empresa recusada).
- `node scripts/test-backup-coverage.cjs`: nenhuma tabela da empresa fora do backup.
- `node scripts/test-backup-workbook.cjs`: a planilha (abas, nomes, datas, arquivados, divisão, 250 mil linhas).
- `node scripts/test-backup-flow.cjs`: de ponta a ponta no banco e no armazenamento de desenvolvimento (empresa de teste própria):
  backup guardado, planilha, prévia, restaurar a uma data antiga, desfazer, cópia antes de bloquear, bloqueio imediato.
- De ponta a ponta (API real, banco e armazenamento de desenvolvimento, empresa `kappa`): fazer backup, alterar dados,
  restaurar, conferir, desfazer a restauração, conferir isolamento entre empresas e rotina de vencimento.

## Worker

`worker/index.ts`: `cron '0 0 * * *'` (fuso Brasília) → `runBackups()` = `runDailyBackups()` + `cleanupExpiredBackups()`,
registrado em `worker_runs` (`backups`, `backup_cleanup`). Uma vez: `node dist/worker/index.js --run=backups`.
O container precisa de `BLOB_READ_WRITE_TOKEN`; sem ele, o worker avisa no log e não faz nada.

## Ainda não existe

- Backup da **plataforma** inteira (restauração pontual do Neon e cópia completa do banco): depende do plano do Neon.
- O painel do dono (Operação → Backups diários, aba da organização) ainda mostra o texto antigo; falta ligar à lista real.
- Os arquivos da biblioteca não são copiados (nunca são apagados): o backup guarda só o registro deles.
