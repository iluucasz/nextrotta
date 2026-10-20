import { randomUUID } from 'node:crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { hashPassword, verifyAuth } from '@/lib/auth';
import { syncSubscriptionValueQuietly } from '@/lib/billing/billing';
import { checkLimit } from '@/lib/billing/entitlements';
import { sql } from '@/lib/db';
import { valueOrDefault } from '@/lib/organization-settings';
import { getOrganizationSettings } from '@/lib/organization-settings-store';
import { validatePhone } from '@/lib/whatsapp/phone';

function getErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }

  return String((error as { code?: string }).code);
}

// Deliberately vague: e-mails are unique across the whole platform, and saying which organization
// already uses one would leak another customer's data.
/**
 * The Porto import links a socorrista to a technician by QRA (one active technician per QRA in the
 * organization, resolveTechnicianByQra). Two active technicians sharing one would send the hours to
 * either of them. An inactive technician may keep an old, reused QRA. Also enforced in the database
 * (technicians_active_qra_idx).
 */
async function findActiveTechnicianWithQra(organizationId: string, qra: unknown, exceptId: string | null): Promise<string | null> {
  const value = String(qra ?? '').trim();
  if (!value) return null;
  const rows = await sql`
    SELECT name FROM technicians
    WHERE organization_id = ${organizationId}
      AND qra = ${value}
      AND status = 'active'
      AND deleted_at IS NULL
      AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
    LIMIT 1
  `;
  return (rows[0]?.name as string | undefined) ?? null;
}

function duplicateQraResponse(holder: string | null) {
  return NextResponse.json(
    {
      error: `Este QRA já é ${holder ? `do técnico ${holder}` : 'de outro técnico ativo'}. Cada técnico ativo precisa de um QRA próprio — é por ele que as horas do Porto são vinculadas.`,
    },
    { status: 409 },
  );
}

function isDuplicateQraError(error: unknown) {
  return getErrorCode(error) === '23505' && (error as { constraint?: string }).constraint === 'technicians_active_qra_idx';
}

function technicianConflictResponse() {
  return NextResponse.json(
    { error: 'Ja existe um tecnico ou usuario com esse email.' },
    { status: 409 }
  );
}

/** Phone is optional; when given it has to be something WhatsApp can actually reach. */
function parsePhone(value: unknown): { phone: string | null; error: string | null } {
  const validation = validatePhone(typeof value === 'string' ? value : '');
  if (validation.status === 'empty') return { phone: null, error: null };
  if (validation.status !== 'valid') return { phone: null, error: `WhatsApp: ${validation.message}` };

  // Stored in one canonical format whatever way it was typed, so lists and exports read the same.
  return { phone: validation.formatted, error: null };
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

type ExistingUser = {
  id: string;
  role: string;
  organization_id: string | null;
  technician_id: string | null;
};

/** Live account (if any) holding this e-mail, anywhere on the platform. */
async function findUserByEmail(email: string): Promise<ExistingUser | null> {
  const rows = await sql`
    SELECT u.id, u.role, u.organization_id, t.id AS technician_id
    FROM users u
    LEFT JOIN technicians t ON t.user_id = u.id AND t.deleted_at IS NULL
    WHERE u.email = ${email}
      AND u.deleted_at IS NULL
    LIMIT 1
  `;

  return (rows[0] as ExistingUser | undefined) ?? null;
}

/** A leftover technician login in this organization with no technician record can be reused. */
function isReusableTechnicianUser(user: ExistingUser, organizationId: string, technicianId?: string) {
  return (
    user.role === 'technician' &&
    user.organization_id === organizationId &&
    (!user.technician_id || user.technician_id === technicianId)
  );
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const technicians = await sql`
      SELECT id, qra, porto_name_hint, name, email, phone, commission_percentage, base_salary,
             va_allowance, vr_allowance, status, created_at
      FROM technicians
      WHERE organization_id = ${auth.organizationId}
        AND deleted_at IS NULL
      ORDER BY name ASC
    `;

    return NextResponse.json({ technicians });
  } catch (error) {
    console.error('[v0] Get technicians error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin' || !auth.organizationId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const organizationId = auth.organizationId;

    const {
      qra,
      name,
      email: rawEmail,
      password,
      commission_percentage,
      base_salary,
      va_allowance,
      vr_allowance,
      porto_name_hint,
      phone: rawPhone,
    } = await request.json();

    const email = normalizeEmail(rawEmail);

    const { phone, error: phoneError } = parsePhone(rawPhone);
    if (phoneError) {
      return NextResponse.json({ error: phoneError }, { status: 400 });
    }

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Name, email and password are required' },
        { status: 400 }
      );
    }

    const qraHolder = await findActiveTechnicianWithQra(organizationId, qra, null);
    if (qraHolder) return duplicateQraResponse(qraHolder);

    const existingUser = await findUserByEmail(email);
    if (existingUser && !isReusableTechnicianUser(existingUser, organizationId)) {
      return technicianConflictResponse();
    }

    const userLimit = await checkLimit(organizationId, 'maxUsers');
    if (!userLimit.allowed) {
      return NextResponse.json({ error: userLimit.message }, { status: 403 });
    }

    const passwordHash = await hashPassword(password);
    const userId = existingUser?.id ?? randomUUID();
    const defaults = await getOrganizationSettings(organizationId);

    // The login and the technician record are written together: either both exist or neither does.
    const userStatement = existingUser
      ? sql`
          UPDATE users
          SET name = ${name}, password_hash = ${passwordHash}, status = 'active', updated_at = NOW()
          WHERE id = ${userId}
            AND organization_id = ${organizationId}
        `
      : sql`
          INSERT INTO users (id, organization_id, email, name, password_hash, role)
          VALUES (${userId}, ${organizationId}, ${email}, ${name}, ${passwordHash}, 'technician')
        `;

    const [, technicianRows] = await sql.transaction([
      userStatement,
      sql`
        INSERT INTO technicians (
          organization_id, user_id, qra, name, email, commission_percentage,
          base_salary, va_allowance, vr_allowance, porto_name_hint, phone
        )
        VALUES (
          ${organizationId}, ${userId}, ${qra || null}, ${name}, ${email},
          ${valueOrDefault(commission_percentage, defaults.commissionPercentage)},
          ${valueOrDefault(base_salary, defaults.baseSalary)},
          ${valueOrDefault(va_allowance, defaults.vaAllowance)},
          ${valueOrDefault(vr_allowance, defaults.vrAllowance)},
          ${porto_name_hint || null},
          ${phone}
        )
        RETURNING *
      `,
    ]);

    after(() => syncSubscriptionValueQuietly(organizationId));
    return NextResponse.json(technicianRows[0], { status: 201 });
  } catch (error) {
    if (isDuplicateQraError(error)) return duplicateQraResponse(null);
    if (getErrorCode(error) === '23505') {
      return technicianConflictResponse();
    }

    console.error('[v0] Create technician error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin' || !auth.organizationId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const organizationId = auth.organizationId;

    const technicianId = request.nextUrl.searchParams.get('id');
    if (!technicianId) {
      return NextResponse.json(
        { error: 'Technician id is required' },
        { status: 400 }
      );
    }

    const {
      qra,
      name,
      email: rawEmail,
      password,
      commission_percentage,
      base_salary,
      va_allowance,
      vr_allowance,
      porto_name_hint,
      status,
      phone: rawPhone,
    } = await request.json();

    const email = normalizeEmail(rawEmail);

    const { phone, error: phoneError } = parsePhone(rawPhone);
    if (phoneError) {
      return NextResponse.json({ error: phoneError }, { status: 400 });
    }

    if (!name || !email) {
      return NextResponse.json(
        { error: 'Name and email are required' },
        { status: 400 }
      );
    }

    const existingTechnicians = await sql`
      SELECT id, user_id
      FROM technicians
      WHERE id = ${technicianId}
        AND organization_id = ${organizationId}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (existingTechnicians.length === 0) {
      return NextResponse.json(
        { error: 'Technician not found' },
        { status: 404 }
      );
    }

    if (status !== 'inactive') {
      const qraHolder = await findActiveTechnicianWithQra(organizationId, qra, technicianId);
      if (qraHolder) return duplicateQraResponse(qraHolder);
    }

    let userId = existingTechnicians[0].user_id as string | null;
    const passwordHash = password ? await hashPassword(password) : null;
    let userStatement = null;

    if (userId) {
      userStatement = sql`
        UPDATE users
        SET email = ${email},
            name = ${name},
            password_hash = COALESCE(${passwordHash}, password_hash),
            updated_at = NOW()
        WHERE id = ${userId}
          AND organization_id = ${organizationId}
      `;
    } else if (passwordHash) {
      const existingUser = await findUserByEmail(email);

      if (existingUser) {
        if (!isReusableTechnicianUser(existingUser, organizationId, technicianId)) {
          return technicianConflictResponse();
        }

        userId = existingUser.id;
        userStatement = sql`
          UPDATE users
          SET name = ${name}, password_hash = ${passwordHash}, status = 'active', updated_at = NOW()
          WHERE id = ${userId}
            AND organization_id = ${organizationId}
        `;
      } else {
        const userLimit = await checkLimit(organizationId, 'maxUsers');
        if (!userLimit.allowed) {
          return NextResponse.json({ error: userLimit.message }, { status: 403 });
        }

        userId = randomUUID();
        userStatement = sql`
          INSERT INTO users (id, organization_id, email, name, password_hash, role)
          VALUES (${userId}, ${organizationId}, ${email}, ${name}, ${passwordHash}, 'technician')
        `;
      }
    }

    const defaults = await getOrganizationSettings(organizationId);
    const technicianStatement = sql`
      UPDATE technicians
      SET
        user_id = ${userId},
        qra = ${qra || null},
        porto_name_hint = ${porto_name_hint || null},
        phone = CASE WHEN ${rawPhone !== undefined} THEN ${phone} ELSE phone END,
        name = ${name},
        email = ${email},
        commission_percentage = ${valueOrDefault(commission_percentage, defaults.commissionPercentage)},
        base_salary = ${valueOrDefault(base_salary, defaults.baseSalary)},
        va_allowance = ${valueOrDefault(va_allowance, defaults.vaAllowance)},
        vr_allowance = ${valueOrDefault(vr_allowance, defaults.vrAllowance)},
        status = ${status === 'inactive' ? 'inactive' : 'active'},
        updated_at = NOW()
      WHERE id = ${technicianId}
        AND organization_id = ${organizationId}
      RETURNING *
    `;

    const results = await sql.transaction(
      userStatement ? [userStatement, technicianStatement] : [technicianStatement],
    );

    after(() => syncSubscriptionValueQuietly(organizationId));
    return NextResponse.json(results[results.length - 1][0]);
  } catch (error) {
    if (isDuplicateQraError(error)) return duplicateQraResponse(null);
    if (getErrorCode(error) === '23505') {
      return technicianConflictResponse();
    }

    console.error('[v0] Update technician error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Archives the technician and their login. Nothing is removed: services, hours, schedule and
 * payroll stay linked to the archived record and it can be restored later.
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin' || !auth.organizationId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const technicianId = request.nextUrl.searchParams.get('id');
    if (!technicianId) {
      return NextResponse.json(
        { error: 'Technician id is required' },
        { status: 400 }
      );
    }

    const linkedUsers = await sql`
      SELECT user_id
      FROM technicians
      WHERE id = ${technicianId}
        AND organization_id = ${auth.organizationId}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (linkedUsers.length === 0) {
      return NextResponse.json(
        { error: 'Technician not found' },
        { status: 404 }
      );
    }

    const userId = linkedUsers[0].user_id as string | null;

    await sql.transaction([
      sql`
        UPDATE technicians
        SET status = 'inactive', deleted_at = NOW(), deleted_by = ${auth.userId}, updated_at = NOW()
        WHERE id = ${technicianId}
          AND organization_id = ${auth.organizationId}
      `,
      sql`
        UPDATE users
        SET status = 'inactive', deleted_at = NOW(), deleted_by = ${auth.userId}, updated_at = NOW()
        WHERE id = ${userId}
          AND organization_id = ${auth.organizationId}
          AND deleted_at IS NULL
      `,
    ]);

    after(() => syncSubscriptionValueQuietly(auth.organizationId as string));
    return NextResponse.json({ success: true, id: technicianId, deletedUser: Boolean(userId) });
  } catch (error) {
    console.error('[v0] Delete technician error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
