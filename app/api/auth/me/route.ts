import { NextResponse } from 'next/server';
import { getCurrentUser, getPreviewContext } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { preview, impersonating } = await getPreviewContext();

    return NextResponse.json({
      user: {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        technicianId: user.technician_id,
        organizationSlug: user.organization_slug,
        preview,
        impersonating,
      },
    });
  } catch (error) {
    console.error('[v0] Current user error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}