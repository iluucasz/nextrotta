import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

// No database here: the file format of the whole-platform backup, used by the app, the worker, the restore script and the tests.
//
// The file is gzip-compressed JSON lines, then encrypted (AES-256-GCM), because unlike a company's backup it keeps everything
// (password hashes, Porto credentials, tokens): without the key it is noise, even to whoever can read the storage.
//   line 1      {"format":"nextrotta-platform-backup","version":1,"createdAt":...,"tables":[...]}
//   each row    {"t":"<table>","r":{...the row as JSON...}}
//   last line   {"end":true,"counts":{"<table>":<rows>}}  (lets the reader prove nothing was cut short)

export const PLATFORM_BACKUP_FORMAT = 'nextrotta-platform-backup';
export const PLATFORM_BACKUP_VERSION = 1;

/** Tables that are not kept: raw monitoring samples of the VPS (big, renewable, nobody restores them). */
export const PLATFORM_BACKUP_EXCLUDED_TABLES: readonly string[] = ['vps_metrics', 'vps_container_metrics'];

/** The newest 30 days of nightly copies are kept; older ones are removed (the latest one never is). */
export const PLATFORM_BACKUP_RETENTION_DAYS = 30;

const MAGIC = Buffer.from('NRPB1');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * The key that locks the file: PLATFORM_BACKUP_KEY (base64 of 32 bytes) when set; otherwise one derived from
 * PORTO_CREDENTIALS_KEY, which the app and the worker already share. Null when neither exists.
 */
export function platformBackupKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const own = env.PLATFORM_BACKUP_KEY;
  if (own) {
    const key = Buffer.from(own, 'base64');
    if (key.length !== 32) throw new Error('PLATFORM_BACKUP_KEY deve ter 32 bytes em base64 (openssl rand -base64 32).');
    return key;
  }
  const shared = env.PORTO_CREDENTIALS_KEY;
  if (!shared) return null;
  const secret = Buffer.from(shared, 'base64');
  if (secret.length !== 32) return null;
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'nextrotta-platform-backup', 32));
}

export function encryptBackup(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function decryptBackup(file: Buffer, key: Buffer): Buffer {
  if (file.length < MAGIC.length + IV_LENGTH + TAG_LENGTH || !file.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Este arquivo não é um backup da plataforma do NextRotta.');
  }
  const iv = file.subarray(MAGIC.length, MAGIC.length + IV_LENGTH);
  const tag = file.subarray(MAGIC.length + IV_LENGTH, MAGIC.length + IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(file.subarray(MAGIC.length + IV_LENGTH + TAG_LENGTH)), decipher.final()]);
  } catch {
    throw new Error('Não foi possível abrir o backup: a chave não confere ou o arquivo foi alterado.');
  }
}

export type PlatformBackupHeader = { format: string; version: number; createdAt: string; tables: string[] };

export type ParsedPlatformBackup = {
  header: PlatformBackupHeader;
  /** Each table's rows as JSON text, ready for jsonb_populate_recordset. */
  rows: Map<string, string[]>;
  counts: Record<string, number>;
};

/** Reads the decrypted lines and checks them against the trailer: a cut or edited file is refused. */
export function parsePlatformBackup(text: string): ParsedPlatformBackup {
  const lines = text.split('\n').filter((line) => line.length > 0);
  if (lines.length < 2) throw new Error('O backup está vazio ou incompleto.');
  const header = JSON.parse(lines[0]) as PlatformBackupHeader;
  if (header.format !== PLATFORM_BACKUP_FORMAT || header.version !== PLATFORM_BACKUP_VERSION) {
    throw new Error('Este arquivo não é um backup da plataforma do NextRotta (formato ou versão desconhecidos).');
  }
  const trailer = JSON.parse(lines[lines.length - 1]) as { end?: boolean; counts?: Record<string, number> };
  if (!trailer.end || !trailer.counts) throw new Error('O backup está incompleto: falta o fim do arquivo.');

  const rows = new Map<string, string[]>(header.tables.map((table) => [table, []]));
  for (let index = 1; index < lines.length - 1; index += 1) {
    const line = lines[index];
    // {"t":"name","r":<row>}: the table name has no quotes or backslashes, so the row is what follows the prefix.
    const match = /^\{"t":"([^"\\]+)","r":/.exec(line);
    if (!match || !line.endsWith('}')) throw new Error(`Linha ${index + 1} do backup está corrompida.`);
    const list = rows.get(match[1]);
    if (!list) throw new Error(`O backup traz a tabela "${match[1]}" que não está no cabeçalho.`);
    list.push(line.slice(match[0].length, -1));
  }
  const counts: Record<string, number> = {};
  for (const [table, list] of rows) {
    counts[table] = list.length;
    if ((trailer.counts[table] ?? 0) !== list.length) {
      throw new Error(`O backup está incompleto: a tabela "${table}" tem ${list.length} linhas e deveria ter ${trailer.counts[table] ?? 0}.`);
    }
  }
  return { header, rows, counts };
}

/** From the stored file to the parsed content (decrypt, decompress, verify). */
export function openPlatformBackup(file: Buffer, key: Buffer): ParsedPlatformBackup {
  return parsePlatformBackup(gunzipSync(decryptBackup(file, key)).toString('utf8'));
}

/**
 * Which finished copies are past the retention and may be removed. The newest finished copy is never one of them,
 * whatever its age; no retention means keep everything.
 */
export function expiredPlatformCopyIds(
  copies: Array<{ id: string; createdAt: Date }>,
  retentionDays: number | null,
  now: Date,
): string[] {
  if (retentionDays === null || copies.length === 0) return [];
  const newest = copies.reduce((latest, copy) => (copy.createdAt > latest.createdAt ? copy : latest));
  const limit = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return copies.filter((copy) => copy.id !== newest.id && copy.createdAt.getTime() < limit).map((copy) => copy.id);
}
