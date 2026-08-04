import { NextResponse } from 'next/server';
import { runScheduledWatermarkJobs } from '@/lib/watermark-service';
import { assertCronAuthorized } from '@/lib/cron-auth';

export async function POST(request: Request) {
  const denied = assertCronAuthorized(request, 'WATERMARK_CRON_SECRET');
  if (denied) return denied;
  try {
    const result = await runScheduledWatermarkJobs();
    return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Scheduler failed' }, { status: 500 });
  }
}

export async function GET(request: Request) { return POST(request); }
