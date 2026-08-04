import { NextResponse } from 'next/server';
import { runScheduledDocumentAuditJobs } from '@/lib/document-audit-trail-service';
import { assertCronAuthorized } from '@/lib/cron-auth';

export async function POST(request: Request) {
  const denied = assertCronAuthorized(request, 'DOCUMENT_AUDIT_CRON_SECRET');
  if (denied) return denied;
  try {
    const result = await runScheduledDocumentAuditJobs();
    return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Scheduler failed' }, { status: 500 });
  }
}

export async function GET(request: Request) { return POST(request); }
