import { sql } from './db';
import {
  createDefaultVisibility,
  normalizeVisibility,
  type TechnicianVisibility,
  type VisibilitySource,
} from './technician-visibility';

/** Row key for the settings that apply to every technician without an override of their own. */
export const GLOBAL_VISIBILITY_SCOPE = 'global';

export interface VisibilitySnapshot {
  global: TechnicianVisibility | null;
  override: TechnicianVisibility | null;
  effective: TechnicianVisibility;
  source: VisibilitySource;
}

/** Loads both layers for a technician and resolves which one wins (override → global → defaults). */
export async function loadVisibilitySnapshot(
  organizationId: string,
  technicianId: string | null,
): Promise<VisibilitySnapshot> {
  // One row per scope: `global`, or a technicians.id for a per-technician override. Stored as
  // JSONB and normalized on read, so adding a new toggle later needs no migration.
  const scopes = technicianId ? [GLOBAL_VISIBILITY_SCOPE, technicianId] : [GLOBAL_VISIBILITY_SCOPE];
  const rows = await sql`
    SELECT scope, settings
    FROM technician_visibility_settings
    WHERE organization_id = ${organizationId}
      AND scope = ANY(${scopes})
      AND deleted_at IS NULL
  `;

  const globalRow = rows.find((row) => row.scope === GLOBAL_VISIBILITY_SCOPE);
  const overrideRow = technicianId ? rows.find((row) => row.scope === technicianId) : undefined;
  const global = globalRow ? normalizeVisibility(globalRow.settings) : null;
  const override = overrideRow ? normalizeVisibility(overrideRow.settings) : null;

  if (override) return { global, override, effective: override, source: 'technician' };
  if (global) return { global, override, effective: global, source: 'global' };

  return { global, override, effective: createDefaultVisibility(), source: 'default' };
}

export async function saveVisibility(
  organizationId: string,
  scope: string,
  settings: TechnicianVisibility,
  updatedBy: string,
) {
  await sql`
    INSERT INTO technician_visibility_settings (organization_id, scope, settings, updated_at, updated_by)
    VALUES (${organizationId}, ${scope}, ${JSON.stringify(settings)}::jsonb, NOW(), ${updatedBy})
    ON CONFLICT (organization_id, scope) DO UPDATE
    SET settings = EXCLUDED.settings,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by,
        deleted_at = NULL,
        deleted_by = NULL
  `;
}

/** How many technicians have their own settings — i.e. won't follow a change to the global ones. */
export async function countVisibilityOverrides(organizationId: string) {
  const rows = await sql`
    SELECT COUNT(*)::int AS total
    FROM technician_visibility_settings
    WHERE organization_id = ${organizationId}
      AND scope <> ${GLOBAL_VISIBILITY_SCOPE}
      AND deleted_at IS NULL
  `;

  return Number(rows[0]?.total ?? 0);
}

/** Drops an override so the technician follows the global settings again (the row is kept, marked deleted). */
export async function deleteVisibility(organizationId: string, scope: string, deletedBy: string) {
  await sql`
    UPDATE technician_visibility_settings
    SET deleted_at = NOW(), deleted_by = ${deletedBy}, updated_at = NOW()
    WHERE organization_id = ${organizationId}
      AND scope = ${scope}
      AND deleted_at IS NULL
  `;
}
