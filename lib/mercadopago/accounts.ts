import { randomBytes } from 'crypto';
import { recordAudit } from '../audit';
import { sql } from '../db';
import { decryptToken, encryptToken, mercadoPagoApp, mercadoPagoMissingConfig } from './config';
import {
  authorizationUrl,
  createPkcePair,
  exchangeAuthorizationCode,
  getAccountUser,
  listTerminals,
  MercadoPagoError,
  refreshAccessToken,
  setTerminalPdvMode,
  type MercadoPagoTerminal,
} from './client';

/** Refresh when the token has less than this left (tokens last 180 days). */
const REFRESH_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;
const STATE_TTL_MINUTES = 15;

export interface MercadoPagoAccountStatus {
  /** The platform has the application configured (otherwise nobody can connect). */
  available: boolean;
  connected: boolean;
  nickname: string | null;
  email: string | null;
  liveMode: boolean | null;
  connectedAt: string | null;
  terminalId: string | null;
  lastError: string | null;
}

export async function getAccountStatus(organizationId: string, technicianId: string): Promise<MercadoPagoAccountStatus> {
  const row = (
    await sql`
      SELECT nickname, email, live_mode, connected_at, terminal_id, last_error
      FROM mercadopago_accounts
      WHERE organization_id = ${organizationId} AND technician_id = ${technicianId} AND disconnected_at IS NULL
    `
  )[0];
  return {
    available: mercadoPagoMissingConfig().length === 0,
    connected: Boolean(row),
    nickname: row?.nickname ?? null,
    email: row?.email ?? null,
    liveMode: row ? row.live_mode : null,
    connectedAt: row ? new Date(row.connected_at).toISOString() : null,
    terminalId: row?.terminal_id ?? null,
    lastError: row?.last_error ?? null,
  };
}

/** Connection state of every technician of the organization (admin screens). */
export async function listAccountStatuses(organizationId: string) {
  const rows = await sql`
    SELECT technician_id, nickname, email, live_mode, connected_at, terminal_id
    FROM mercadopago_accounts
    WHERE organization_id = ${organizationId} AND disconnected_at IS NULL
  `;
  return new Map(
    rows.map((row) => [
      String(row.technician_id),
      { nickname: row.nickname as string | null, email: row.email as string | null, liveMode: row.live_mode as boolean | null, terminalId: row.terminal_id as string | null },
    ]),
  );
}

/** First step of OAuth: the URL the technician opens to authorize the platform's application. */
export async function startConnection(organizationId: string, technicianId: string, userId: string) {
  const missing = mercadoPagoMissingConfig();
  if (missing.length) throw new MercadoPagoError('O Mercado Pago ainda não foi configurado na plataforma. Fale com o suporte.', 503);

  const state = randomBytes(24).toString('base64url');
  const { verifier, challenge } = createPkcePair();
  await sql`
    INSERT INTO mercadopago_oauth_states (state, organization_id, technician_id, user_id, code_verifier)
    VALUES (${state}, ${organizationId}, ${technicianId}, ${userId}, ${verifier})
  `;
  return authorizationUrl(state, challenge);
}

/**
 * OAuth callback: trades the code for the technician's tokens and stores them (encrypted). Returns
 * the organization's slug so the callback can send the technician back to their subdomain.
 */
export async function finishConnection(state: string, code: string) {
  const pending = (
    await sql`
      UPDATE mercadopago_oauth_states s
      SET used_at = NOW()
      FROM organizations o
      WHERE s.state = ${state}
        AND s.used_at IS NULL
        AND s.created_at > NOW() - make_interval(mins => ${STATE_TTL_MINUTES}::int)
        AND o.id = s.organization_id
      RETURNING s.organization_id, s.technician_id, s.user_id, s.code_verifier, o.slug
    `
  )[0];
  if (!pending) throw new MercadoPagoError('Link de autorização expirado ou já usado. Tente conectar de novo.', 400);

  const organizationId = String(pending.organization_id);
  const technicianId = String(pending.technician_id);
  const tokens = await exchangeAuthorizationCode(code, String(pending.code_verifier));
  const user = await getAccountUser(tokens.access_token).catch(() => null);
  const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;

  // One active account per technician: connecting again replaces the previous one.
  await sql.transaction([
    sql`
      UPDATE mercadopago_accounts SET disconnected_at = NOW(), disconnected_by = ${pending.user_id}
      WHERE organization_id = ${organizationId} AND technician_id = ${technicianId} AND disconnected_at IS NULL
    `,
    sql`
      INSERT INTO mercadopago_accounts (
        organization_id, technician_id, mp_user_id, nickname, email, access_token_enc, refresh_token_enc, public_key, live_mode, expires_at
      )
      VALUES (
        ${organizationId}, ${technicianId}, ${String(tokens.user_id)}, ${user?.nickname ?? null}, ${user?.email ?? null},
        ${encryptToken(tokens.access_token)}, ${tokens.refresh_token ? encryptToken(tokens.refresh_token) : null},
        ${tokens.public_key ?? null}, ${tokens.live_mode ?? null}, ${expiresAt}
      )
    `,
  ]);

  await recordAudit({
    organizationId,
    actorId: String(pending.user_id),
    actorRole: 'technician',
    action: 'mercadopago.connected',
    targetType: 'technician',
    targetId: technicianId,
    details: { mpUserId: String(tokens.user_id), nickname: user?.nickname ?? null, liveMode: tokens.live_mode ?? null },
  });

  return { slug: String(pending.slug) };
}

export async function disconnect(organizationId: string, technicianId: string, actor: { id: string; role: string }) {
  const rows = await sql`
    UPDATE mercadopago_accounts SET disconnected_at = NOW(), disconnected_by = ${actor.id}
    WHERE organization_id = ${organizationId} AND technician_id = ${technicianId} AND disconnected_at IS NULL
    RETURNING id
  `;
  if (rows.length) {
    await recordAudit({
      organizationId,
      actorId: actor.id,
      actorRole: actor.role,
      action: 'mercadopago.disconnected',
      targetType: 'technician',
      targetId: technicianId,
    });
  }
}

/**
 * A valid access token of the technician's account, refreshed when close to expiring. Throws a
 * MercadoPagoError the screens can show when the technician hasn't connected.
 */
export async function getAccessToken(organizationId: string, technicianId: string): Promise<{ token: string; mpUserId: string; terminalId: string | null }> {
  if (!mercadoPagoApp()) throw new MercadoPagoError('O Mercado Pago ainda não foi configurado na plataforma.', 503);
  const row = (
    await sql`
      SELECT id, mp_user_id, access_token_enc, refresh_token_enc, expires_at, terminal_id
      FROM mercadopago_accounts
      WHERE organization_id = ${organizationId} AND technician_id = ${technicianId} AND disconnected_at IS NULL
    `
  )[0];
  if (!row) throw new MercadoPagoError('Conecte sua conta do Mercado Pago para receber por Pix, link ou cartão.', 409);

  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
  if (row.refresh_token_enc && expiresAt !== null && expiresAt - Date.now() < REFRESH_BEFORE_MS) {
    try {
      const tokens = await refreshAccessToken(decryptToken(String(row.refresh_token_enc)));
      const newExpiry = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;
      await sql`
        UPDATE mercadopago_accounts
        SET access_token_enc = ${encryptToken(tokens.access_token)},
            refresh_token_enc = ${tokens.refresh_token ? encryptToken(tokens.refresh_token) : row.refresh_token_enc},
            expires_at = ${newExpiry}, refreshed_at = NOW(), last_error = NULL
        WHERE id = ${row.id}
      `;
      return { token: tokens.access_token, mpUserId: String(row.mp_user_id), terminalId: row.terminal_id ?? null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await sql`UPDATE mercadopago_accounts SET last_error = ${message} WHERE id = ${row.id}`;
      // Still valid for a few days: use it and try again next time.
      if (expiresAt > Date.now()) return { token: decryptToken(String(row.access_token_enc)), mpUserId: String(row.mp_user_id), terminalId: row.terminal_id ?? null };
      throw new MercadoPagoError('A autorização do Mercado Pago expirou. Conecte sua conta de novo.', 409);
    }
  }

  return { token: decryptToken(String(row.access_token_enc)), mpUserId: String(row.mp_user_id), terminalId: row.terminal_id ?? null };
}

/** Token of whichever technician account received a notification (by Mercado Pago user id). */
export async function findAccountByMpUser(mpUserId: string) {
  const row = (
    await sql`
      SELECT organization_id, technician_id FROM mercadopago_accounts
      WHERE mp_user_id = ${mpUserId} AND disconnected_at IS NULL
      ORDER BY connected_at DESC LIMIT 1
    `
  )[0];
  return row ? { organizationId: String(row.organization_id), technicianId: String(row.technician_id) } : null;
}

export async function getTerminals(organizationId: string, technicianId: string): Promise<MercadoPagoTerminal[]> {
  const { token } = await getAccessToken(organizationId, technicianId);
  return listTerminals(token);
}

/** Chooses the Point device charges go to (switching it to PDV mode), or clears it with null. */
export async function chooseTerminal(organizationId: string, technicianId: string, terminalId: string | null) {
  if (terminalId) {
    const { token } = await getAccessToken(organizationId, technicianId);
    const terminals = await listTerminals(token);
    const terminal = terminals.find((item) => item.id === terminalId);
    if (!terminal) throw new MercadoPagoError('Maquininha não encontrada na sua conta do Mercado Pago.', 404);
    if (terminal.operating_mode !== 'PDV') await setTerminalPdvMode(token, terminalId);
  }
  await sql`
    UPDATE mercadopago_accounts SET terminal_id = ${terminalId}
    WHERE organization_id = ${organizationId} AND technician_id = ${technicianId} AND disconnected_at IS NULL
  `;
}
