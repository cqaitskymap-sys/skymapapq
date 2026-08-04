import { NextResponse } from 'next/server';
import { runScheduledChangeImpactJobs } from '@/lib/change-impact-assessment-service';
import { assertCronAuthorized } from '@/lib/cron-auth';

export async function POST(request: Request) {
  const denied = assertCronAuthorized(request, 'CHANGE_IMPACT_CRON_SECRET');
  if (denied) return denied;
  try {
    const result = await runScheduledChangeImpactJobs();
    return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Scheduler failed' }, { status: 500 });
  }
}

export async function GET(request: Request) { return POST(request); }
