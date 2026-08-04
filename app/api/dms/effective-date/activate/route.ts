import { NextResponse } from 'next/server';
import { runScheduledEffectiveDateActivation } from '@/lib/effective-date-service';
import { assertCronAuthorized } from '@/lib/cron-auth';

/**
 * Cron endpoint for scheduled document activation.
 * Set EFFECTIVE_DATE_CRON_SECRET in env and pass as Authorization: Bearer <secret>
 */
export async function POST(request: Request) {
  const denied = assertCronAuthorized(request, 'EFFECTIVE_DATE_CRON_SECRET');
  if (denied) return denied;

  try {
    const result = await runScheduledEffectiveDateActivation();
    return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Activation failed' },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
