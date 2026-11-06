import { NextRequest, NextResponse } from 'next/server';
import { listAssignees } from '@/lib/cases/store';
import { withPlatformStaff } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** The people a case can be given to (name and role only), and who is asking (for "Assumir"). */
export async function GET(request: NextRequest) {
  return withPlatformStaff(request, async (staff) => NextResponse.json({ assignees: await listAssignees(), meId: staff.userId }));
}
