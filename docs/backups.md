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
- **Retenção:** `plans.backup_retention_days` (Essencial 90, Pro 180; vazio = sem limite; sem assinatura = 90). Depois da
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

`GET/POST /api/organization/backups` (lista + próxima execução + retenção; fazer agora) e
`GET/POST /api/organization/backups/[id]` (baixar o arquivo; restaurar com `{ confirm: "RESTAURAR" }`).

## Testes

- `node scripts/test-backup-rules.cjs`: dia de Brasília, próxima meia-noite, vencimento (a última cópia fica), instruções
  da restauração (nada de `DELETE`, parâmetros certos, outra empresa recusada).
- `node scripts/test-backup-coverage.cjs`: nenhuma tabela da empresa fora do backup.
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
