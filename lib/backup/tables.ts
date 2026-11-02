// What an organization's backup holds, and which part of it a restore may put back. Dependency-free: read by the
// worker, the API and the tests.

/**
 * Every table that carries an organization's own data, in the order they are saved (archived rows included, marked by
 * deleted_at). A table with an `organization_id` that is in neither this list nor BACKUP_EXCLUDED fails the coverage
 * check (scripts/test-backup-coverage.mjs), so a new table cannot be left out of the backups by accident.
 */
export const BACKUP_TABLES = [
  'users', 'technicians', 'services', 'work_hours', 'schedule', 'payroll', 'discounts',
  'financial_entries', 'financial_payments', 'finance_budgets', 'library_documents',
  'organization_settings', 'technician_visibility_settings', 'porto_config', 'porto_sync_log',
  'whatsapp_config', 'whatsapp_messages', 'subscriptions', 'billing_charges', 'ai_credit_ledger',
  'ai_conversations', 'ai_messages', 'bug_reports', 'notifications', 'organization_features', 'coupon_redemptions',
  'audit_events',
  'parts', 'part_images', 'part_transfers', 'part_sales', 'part_sale_items', 'part_inventories', 'part_inventory_items',
  'part_debts', 'part_movements', 'part_account_entries', 'parts_settings', 'mercadopago_accounts',
] as const;

/** Tables with an organization_id that are not the organization's data: short-lived, platform-internal or the register of the backups. */
export const BACKUP_EXCLUDED = [
  'ai_request_locks', 'auth_handoffs', 'mercadopago_oauth_states', 'impersonation_sessions', 'leads',
  'organization_notes', 'organization_provisioning', 'worker_runs', 'organization_backups',
  // Legal evidence: what was accepted and what was asked must never roll back with a restore.
  'legal_acceptances', 'data_subject_requests',
] as const;

/** Secrets never go into a backup file: it can be downloaded by the organization's admin. */
export const BACKUP_SECRET_COLUMNS = ['password_hash', 'encrypted_password', 'access_token_enc', 'refresh_token_enc'] as const;

export type RestoreTable = {
  table: string;
  /** The columns that identify a row (the conflict target of the upsert). */
  keys: string[];
  /** Has deleted_at: what did not exist in the backup is archived, never erased. */
  soft: boolean;
  /** Archive every row first, so a partial unique index never sees two rows fight for the same value (technicians' QRA and e-mail). */
  archiveAllFirst?: boolean;
  /** No soft delete: rows absent from the backup get this column set to 0 (a budget with no amount is no budget). */
  zeroColumn?: string;
};

/**
 * What a restore brings back: the company's operation (technicians, OS, hours, escala, folhas, discounts, despesas,
 * documents) and its settings. Billing, credits, accounts, integrations, the history of messages and Venda de Peças
 * stay as they are: they must never roll back (a restored balance or a restored stock would be a lie), and the
 * parts' movements only ever grow.
 */
export const RESTORE_TABLES: RestoreTable[] = [
  { table: 'technicians', keys: ['id'], soft: true, archiveAllFirst: true },
  { table: 'services', keys: ['id'], soft: true },
  { table: 'work_hours', keys: ['id'], soft: true },
  { table: 'schedule', keys: ['id'], soft: true },
  { table: 'payroll', keys: ['id'], soft: true },
  { table: 'discounts', keys: ['id'], soft: true },
  { table: 'financial_entries', keys: ['id'], soft: true },
  { table: 'financial_payments', keys: ['id'], soft: true },
  { table: 'finance_budgets', keys: ['organization_id', 'category'], soft: false, zeroColumn: 'amount' },
  { table: 'library_documents', keys: ['id'], soft: true },
  { table: 'organization_settings', keys: ['organization_id'], soft: false },
  { table: 'technician_visibility_settings', keys: ['organization_id', 'scope'], soft: true },
];

/** Plain-language names for the tables a restore touches, for the confirmation and the result. */
export const RESTORE_LABELS: Record<string, string> = {
  technicians: 'Técnicos',
  services: 'Ordens de serviço',
  work_hours: 'Horas',
  schedule: 'Escala',
  payroll: 'Folhas',
  discounts: 'Descontos e adiantamentos',
  financial_entries: 'Contas (despesas)',
  financial_payments: 'Pagamentos de contas',
  finance_budgets: 'Orçamentos',
  library_documents: 'Documentos',
  organization_settings: 'Configurações',
  technician_visibility_settings: 'Visibilidade do técnico',
};

export type BackupKind = 'daily' | 'manual' | 'before_restore';
export type BackupStatus = 'running' | 'completed' | 'failed' | 'expired';

export const BACKUP_KIND_LABELS: Record<BackupKind, string> = {
  daily: 'Diário',
  manual: 'Manual',
  before_restore: 'Antes de restaurar',
};

/** The shape of the backup file (before gzip). */
export type BackupFile = {
  format: 'nextrotta-backup';
  version: 1;
  createdAt: string;
  organization: { id: string; name: string; slug: string };
  tables: Record<string, Array<Record<string, unknown>>>;
};
