import { NextResponse } from 'next/server';
import { AI_ENRICH_TASKS, enrichWithOpenRouter, type AiEnrichTask } from '@/lib/ai/enrich';
import { verifyFirebaseBearerToken } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isTask(value: unknown): value is AiEnrichTask {
  return typeof value === 'string' && (AI_ENRICH_TASKS as readonly string[]).includes(value);
}

export async function POST(request: Request) {
  try {
    if (!(await verifyFirebaseBearerToken(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as {
      task?: unknown;
      context?: unknown;
      fallback?: unknown;
    };

    if (!isTask(body.task)) {
      return NextResponse.json(
        { error: `Invalid task. Allowed: ${AI_ENRICH_TASKS.join(', ')}` },
        { status: 400 },
      );
    }

    const context =
      body.context && typeof body.context === 'object' && !Array.isArray(body.context)
        ? (body.context as Record<string, unknown>)
        : {};
    const fallback =
      body.fallback && typeof body.fallback === 'object' && !Array.isArray(body.fallback)
        ? (body.fallback as Record<string, unknown>)
        : {};

    const result = await enrichWithOpenRouter({
      task: body.task,
      context,
      fallback,
    });

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        data: {},
        usedAi: false,
        error: e instanceof Error ? e.message : 'AI enrich failed.',
      },
      { status: 500 },
    );
  }
}
