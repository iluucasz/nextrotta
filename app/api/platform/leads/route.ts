import { NextRequest, NextResponse } from 'next/server';
import { listLeads } from '@/lib/platform/leads';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** Contacts from the site, newest first. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json({ leads: await listLeads() }));
}
