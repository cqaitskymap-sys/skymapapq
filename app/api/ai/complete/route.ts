import { NextResponse } from 'next/server';
import {
  isOpenRouterConfigured,
  openRouterChat,
  type OpenRouterMessage,
} from '@/lib/ai/openrouter';
import { verifyFirebaseBearerToken } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!(await verifyFirebaseBearerToken(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    configured: isOpenRouterConfigured(),
    model: process.env.OPENROUTER_MODEL?.trim() || 'openai/gpt-4o-mini',
  });
}

export async function POST(request: Request) {
  try {
    if (!(await verifyFirebaseBearerToken(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isOpenRouterConfigured()) {
      return NextResponse.json(
        { error: 'OPENROUTER_API_KEY is not configured on the server.' },
        { status: 503 },
      );
    }

    const body = (await request.json()) as {
      prompt?: string;
      system?: string;
      messages?: OpenRouterMessage[];
      model?: string;
      temperature?: number;
      maxTokens?: number;
      json?: boolean;
    };

    let messages: OpenRouterMessage[] = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) {
      if (!body.prompt?.trim()) {
        return NextResponse.json({ error: 'prompt or messages is required.' }, { status: 400 });
      }
      messages = [
        {
          role: 'system',
          content:
            body.system?.trim()
            || 'You are a pharmaceutical QMS AI assistant. Be concise and audit-ready.',
        },
        { role: 'user', content: body.prompt.trim() },
      ];
    }

    const result = await openRouterChat({
      messages,
      model: body.model,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
      responseFormat: body.json ? 'json' : 'text',
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({ text: result.text, model: result.model });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'AI completion failed.' },
      { status: 500 },
    );
  }
}
