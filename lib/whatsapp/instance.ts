import { recordAudit } from '../audit';
import { sql } from '../db';
import { PlatformError } from '../platform/errors';
import {
  connectEvolutionInstance,
  createEvolutionInstance,
  fetchEvolutionInstance,
  logoutEvolutionInstance,
  type EvolutionQrCode,
  type EvolutionServer,
} from './evolution';
import { evolutionServer } from './store';

/**
 * Each organization's WhatsApp instance: created from its own screen, always named after its
 * subdomain, one number at a time (whichever phone reads the QR code). The server's URL and global
 * key never leave the backend.
 */

export type InstanceState = 'not_created' | 'connected' | 'connecting' | 'disconnected' | 'unknown';

export interface InstanceStatus {
  serverConfigured: boolean;
  instanceName: string;
  created: boolean;
  state: InstanceState;
  number: string | null;
  profileName: string | null;
  error: string | null;
}

type Actor = { userId: string; impersonationId?: string | null };

function requireServer(): EvolutionServer {
  const server = evolutionServer();
  if (!server) throw new PlatformError('O WhatsApp ainda não está disponível na plataforma. Fale com o suporte do NextRotta.', 503);
  return server;
}

async function loadOrganization(organizationId: string) {
  const rows = await sql`
    SELECT o.slug, c.instance_name
    FROM organizations o
    LEFT JOIN whatsapp_config c ON c.organization_id = o.id
    WHERE o.id = ${organizationId}
  `;
  if (!rows[0]) throw new PlatformError('Empresa não encontrada.', 404);
  return {
    slug: String(rows[0].slug),
    instanceName: (rows[0].instance_name as string | null) ?? null,
  };
}

function toState(state: string | null): InstanceState {
  if (state === 'open') return 'connected';
  if (state === 'connecting') return 'connecting';
  if (state === 'close' || state === 'closed') return 'disconnected';
  return 'unknown';
}

async function remember(organizationId: string, state: InstanceState, number: string | null, profileName: string | null) {
  await sql`
    UPDATE whatsapp_config
    SET connection_state = ${state}, connected_number = ${number}, connected_name = ${profileName}, connection_checked_at = NOW()
    WHERE organization_id = ${organizationId}
  `;
}

function audit(organizationId: string, actor: Actor, action: string, details: Record<string, unknown>) {
  return recordAudit({
    organizationId,
    actorId: actor.userId,
    actorRole: actor.impersonationId ? 'platform_owner' : 'admin',
    impersonationId: actor.impersonationId ?? null,
    action,
    targetType: 'whatsapp_instance',
    targetId: String(details.instance ?? ''),
    details,
  });
}

/** Current state, read live from Evolution when the instance exists. */
export async function getInstanceStatus(organizationId: string): Promise<InstanceStatus> {
  const organization = await loadOrganization(organizationId);
  const server = evolutionServer();
  const base = { serverConfigured: Boolean(server), instanceName: organization.instanceName ?? organization.slug };

  if (!organization.instanceName) {
    return { ...base, created: false, state: 'not_created', number: null, profileName: null, error: null };
  }
  if (!server) {
    return { ...base, created: true, state: 'unknown', number: null, profileName: null, error: 'Servidor do WhatsApp não configurado.' };
  }

  const info = await fetchEvolutionInstance(server, organization.instanceName);
  if (info.error) return { ...base, created: true, state: 'unknown', number: null, profileName: null, error: info.error };
  if (!info.exists) {
    // Removed on the server side: the organization can create it again.
    await sql`
      UPDATE whatsapp_config
      SET instance_name = NULL, instance_created_at = NULL, connection_state = NULL,
          connected_number = NULL, connected_name = NULL, connection_checked_at = NOW()
      WHERE organization_id = ${organizationId}
    `;
    return { ...base, instanceName: organization.slug, created: false, state: 'not_created', number: null, profileName: null, error: null };
  }

  const state = toState(info.state);
  const number = state === 'connected' ? info.number : null;
  await remember(organizationId, state, number, state === 'connected' ? info.profileName : null);
  return { ...base, created: true, state, number, profileName: state === 'connected' ? info.profileName : null, error: null };
}

/**
 * Re-reads every organization's instance from Evolution so the stored state (owner panel, Operação)
 * never keeps showing "connected" for a number that dropped or a server that was replaced. An
 * unreachable server leaves the last known state and its check time untouched.
 */
export async function refreshAllInstanceStatuses() {
  if (!evolutionServer()) return;
  const rows = await sql`
    SELECT c.organization_id
    FROM whatsapp_config c
    JOIN organizations o ON o.id = c.organization_id
    WHERE c.instance_name IS NOT NULL AND o.deleted_at IS NULL
  `;
  for (const row of rows) {
    await getInstanceStatus(String(row.organization_id)).catch(() => null);
  }
}

/**
 * Creates the organization's instance (named after its subdomain) and returns the first QR code.
 * Refuses a name already taken on the server by someone else.
 */
export async function createInstance(organizationId: string, actor: Actor): Promise<{ status: InstanceStatus; qr: EvolutionQrCode | null }> {
  const server = requireServer();
  const organization = await loadOrganization(organizationId);
  if (organization.instanceName) return { status: await getInstanceStatus(organizationId), qr: (await getQrCode(organizationId)).qr };

  const name = organization.slug;
  const existing = await fetchEvolutionInstance(server, name);
  if (existing.error) throw new PlatformError(`Não foi possível falar com o servidor do WhatsApp. ${existing.error}`, 502);
  if (existing.exists) {
    throw new PlatformError('Já existe uma instância com o nome desta empresa no servidor do WhatsApp. Fale com o suporte do NextRotta.', 409);
  }

  const created = await createEvolutionInstance(server, name);
  if (!created.ok) throw new PlatformError(`O servidor do WhatsApp recusou a criação da instância. ${created.error ?? ''}`.trim(), 502);

  await sql`
    INSERT INTO whatsapp_config (organization_id, instance_name, instance_created_at, connection_state)
    VALUES (${organizationId}, ${name}, NOW(), 'connecting')
    ON CONFLICT (organization_id) DO UPDATE
    SET instance_name = EXCLUDED.instance_name, instance_created_at = NOW(), connection_state = 'connecting'
  `;
  await audit(organizationId, actor, 'whatsapp.instance_created', { instance: name });

  const qr = created.qr?.base64 ? created.qr : (await connectEvolutionInstance(server, name)).qr;
  return { status: await getInstanceStatus(organizationId), qr };
}

/** A fresh QR code while no number is connected yet. */
export async function getQrCode(organizationId: string): Promise<{ connected: boolean; qr: EvolutionQrCode | null }> {
  const server = requireServer();
  const organization = await loadOrganization(organizationId);
  if (!organization.instanceName) throw new PlatformError('Crie a instância do WhatsApp primeiro.', 409);

  const result = await connectEvolutionInstance(server, organization.instanceName);
  if (!result.ok) throw new PlatformError(`Não foi possível gerar o QR Code. ${result.error ?? ''}`.trim(), 502);
  if (result.state === 'open') return { connected: true, qr: null };
  return { connected: false, qr: result.qr };
}

/** Disconnects the number, so another one can be connected to the same instance. */
export async function disconnectInstance(organizationId: string, actor: Actor) {
  const server = requireServer();
  const organization = await loadOrganization(organizationId);
  if (!organization.instanceName) throw new PlatformError('A empresa ainda não tem instância do WhatsApp.', 409);

  const result = await logoutEvolutionInstance(server, organization.instanceName);
  if (!result.ok) throw new PlatformError(`Não foi possível desconectar. ${result.error ?? ''}`.trim(), 502);
  await remember(organizationId, 'disconnected', null, null);
  await audit(organizationId, actor, 'whatsapp.disconnected', { instance: organization.instanceName });
  return getInstanceStatus(organizationId);
}
