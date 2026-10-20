import { sql } from '../db';
import { getPlatformSettings } from './settings';

/**
 * The Vercel account that holds the Blob store, read from the Vercel REST API with an account token
 * (VERCEL_API_TOKEN; VERCEL_TEAM_ID picks the team when the token reaches several). The Blob token
 * can't tell this: it only opens the store's files. Only GETs are made.
 *
 * Blob storage per plan (vercel.com/docs/vercel-blob/usage-and-pricing):
 * - hobby: 1 GB for the whole account (every store of every project), a hard limit — past it Vercel
 *   blocks the Blob for 30 days, for all of them;
 * - pro: billed by use, no ceiling (Spend Management can pause it);
 * - enterprise: by contract.
 */

const API = 'https://api.vercel.com';
const CACHE_MS = 15 * 60 * 1000;
const MB = 1024 * 1024;
const HOBBY_STORAGE_MB = 1024;

export type VercelPlanName = 'hobby' | 'pro' | 'enterprise';

export type BlobStoreInfo = {
  id: string;
  name: string;
  sizeBytes: number;
  count: number | null;
  region: string | null;
  access: string | null;
  status: string | null;
  quotaExceeded: boolean;
};

export type VercelIntegration = {
  /** The provider's own id (for Neon, the project id). */
  externalResourceId: string | null;
  product: string | null;
  name: string;
  planName: string | null;
  details: Array<{ label: string; value: string }>;
  status: string | null;
  quotaExceeded: boolean;
};

export type VercelAccount =
  | { configured: false }
  | {
      configured: true;
      ok: true;
      plan: VercelPlanName;
      account: string;
      /** The store BLOB_READ_WRITE_TOKEN opens; null when it isn't in this account. */
      store: BlobStoreInfo | null;
      /** The account's other Blob stores (other projects), which share the Hobby allowance. */
      others: Array<{ name: string; sizeBytes: number }>;
      /** Marketplace resources (e.g. the Neon database): plan and state only, never their secrets. */
      integrations: VercelIntegration[];
    }
  | { configured: true; ok: false; error: string };

let cache: { at: number; value: VercelAccount } | null = null;

async function vercel(path: string, token: string) {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(response.status === 401 || response.status === 403 ? `token recusado pela Vercel (${message})` : message);
  }
  return body;
}

function planOf(billing: unknown): VercelPlanName | null {
  const plan = (billing as { plan?: unknown } | null | undefined)?.plan;
  return plan === 'hobby' || plan === 'pro' || plan === 'enterprise' ? plan : null;
}

/** vercel_blob_rw_<storeId>_<secret> → store_<storeId>. */
function ownStoreId() {
  const part = process.env.BLOB_READ_WRITE_TOKEN?.split('_')[3];
  return part ? `store_${part}` : null;
}

export async function getVercelAccount(): Promise<VercelAccount> {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) return { configured: false };
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  let value: VercelAccount;
  try {
    let teamId = process.env.VERCEL_TEAM_ID || null;
    let plan: VercelPlanName | null = null;
    let account = '';
    if (!teamId) {
      // Every account has a default team now; old personal accounts carry the plan on the user.
      const { user } = await vercel('/v2/user', token);
      teamId = user?.defaultTeamId ?? null;
      plan = planOf(user?.billing);
      account = String(user?.username ?? user?.email ?? 'conta pessoal');
    }
    const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
    if (teamId) {
      const team = await vercel(`/v2/teams/${encodeURIComponent(teamId)}`, token);
      plan = planOf(team?.billing) ?? plan;
      account = String(team?.name ?? team?.slug ?? teamId);
    }

    const { stores } = await vercel(`/v1/storage/stores${query}`, token);
    const blobStores: BlobStoreInfo[] = (Array.isArray(stores) ? stores : [])
      .filter((store) => store?.type === 'blob')
      .map((store) => ({
        id: String(store.id),
        name: String(store.name ?? store.id),
        sizeBytes: Number(store.size ?? 0),
        count: store.count === undefined ? null : Number(store.count),
        region: store.region ?? null,
        access: store.access ?? null,
        status: store.status ?? null,
        quotaExceeded: Boolean(store.usageQuotaExceeded),
      }));
    const storeId = ownStoreId();
    let store = blobStores.find((item) => item.id === storeId) ?? null;
    if (store) {
      // The list may leave out the live details; the store itself has them.
      const detail = (await vercel(`/storage/stores/${encodeURIComponent(store.id)}${query}`, token))?.store ?? {};
      store = {
        ...store,
        sizeBytes: Number(detail.size ?? store.sizeBytes),
        count: detail.count === undefined ? store.count : Number(detail.count),
        region: detail.region ?? store.region,
        access: detail.access ?? store.access,
        status: detail.status ?? store.status,
        quotaExceeded: Boolean(detail.usageQuotaExceeded ?? store.quotaExceeded),
      };
    }
    const others = blobStores.filter((item) => item.id !== storeId).map((item) => ({ name: item.name, sizeBytes: item.sizeBytes }));
    const integrations: VercelIntegration[] = (Array.isArray(stores) ? stores : [])
      .filter((item) => item?.type === 'integration')
      .map((item) => ({
        externalResourceId: item.externalResourceId ? String(item.externalResourceId) : null,
        product: item.product?.slug ? String(item.product.slug) : null,
        name: String(item.name ?? item.id),
        planName: item.billingPlan?.name ? String(item.billingPlan.name) : null,
        details: (Array.isArray(item.billingPlan?.details) ? item.billingPlan.details : [])
          .filter((detail: { label?: unknown; value?: unknown }) => detail?.label && detail?.value)
          .map((detail: { label: unknown; value: unknown }) => ({ label: String(detail.label), value: String(detail.value) })),
        status: item.status ?? null,
        quotaExceeded: Boolean(item.usageQuotaExceeded),
      }));

    value = plan
      ? { configured: true, ok: true, plan, account, store, others, integrations }
      : { configured: true, ok: false, error: 'a Vercel não informou o plano da conta' };
  } catch (error) {
    console.error('[capacity] Vercel account error:', error);
    value = { configured: true, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  cache = { at: Date.now(), value };
  return value;
}

export type StorageCapacity = {
  /** The owner's fixed ceiling ("Definir capacidades"), in MB. */
  ownerMb: number | null;
  plan: VercelPlanName | null;
  /** On Hobby: what's left of the account's 1 GB after the other projects' stores. */
  hobby: { roomMb: number; othersMb: number; othersCount: number } | null;
  /** Why Vercel blocks the store, when it does. */
  blocked: string | null;
  /** The store's region when it's away from Brazil. */
  farRegion: string | null;
  /** Why the account couldn't be read; null when it was (or no token). */
  error: string | null;
  tokenConfigured: boolean;
};

export function formatMb(mb: number) {
  if (mb > 0 && mb < 1) return 'menos de 1 MB';
  return mb >= 1024 ? `${(mb / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB` : `${Math.round(mb).toLocaleString('pt-BR')} MB`;
}

export async function getStorageCapacity(): Promise<StorageCapacity> {
  const [{ capacity }, vercelAccount] = await Promise.all([getPlatformSettings(), getVercelAccount()]);
  const detected = vercelAccount.configured && vercelAccount.ok ? vercelAccount : null;
  const store = detected?.store ?? null;
  // On Hobby the 1 GB is the whole account's: the other projects' stores take part of it.
  const othersMb = (detected?.others ?? []).reduce((sum, item) => sum + item.sizeBytes, 0) / MB;
  return {
    ownerMb: capacity.storageGb === null ? null : capacity.storageGb * 1024,
    plan: detected?.plan ?? null,
    hobby:
      detected?.plan === 'hobby'
        ? {
            roomMb: Math.max(0, Math.round(HOBBY_STORAGE_MB - othersMb)),
            othersMb,
            othersCount: (detected.others ?? []).filter((item) => item.sizeBytes > 0).length,
          }
        : null,
    blocked:
      store && (store.quotaExceeded || (store.status !== null && store.status !== 'available'))
        ? `a Vercel marca a loja como "${store.status}"${store.quotaExceeded ? ', cota excedida' : ''}`
        : null,
    farRegion: store?.region && store.region !== 'gru1' ? store.region : null,
    error: vercelAccount.configured && !vercelAccount.ok ? vercelAccount.error : null,
    tokenConfigured: vercelAccount.configured,
  };
}

/**
 * The ceiling "Distribuir recursos" enforces on storage: the owner's fixed value; with containers,
 * none (each container shows its own room); otherwise the Hobby allowance.
 */
export async function getStoragePool() {
  const [storage, containers] = await Promise.all([
    getStorageCapacity(),
    sql`SELECT COUNT(*)::int AS count FROM storage_containers WHERE archived_at IS NULL`,
  ]);
  if (storage.ownerMb !== null) return storage.ownerMb;
  if (Number(containers[0]?.count ?? 0) > 0) return null;
  return storage.hobby?.roomMb ?? null;
}
