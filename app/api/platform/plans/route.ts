import { NextRequest, NextResponse } from 'next/server';
import { createPlan, listPlans } from '@/lib/platform/plans';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** Every plan (archived ones last) with how many active organizations use it. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json({ plans: await listPlans() }));
}

/**
 * { key, name, description?, monthlyPrice, annualPrice, extraTechnicianPrice?, setupFee?, onRequest?,
 *   featured?, visible?, displayOrder?, includedTechnicians?, limits?: { maxUsers, storageMb,
 *   whatsappMessagesMonth, portoRunsMonth }, features: [...], aiMonthlyCredits?, aiBonusCredits?,
 *   backupRetentionDays? } — limits and retention: null = unlimited.
 */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => {
    return NextResponse.json({ plan: await createPlan(await readJson(request), { id: owner.userId }) }, { status: 201 });
  });
}
