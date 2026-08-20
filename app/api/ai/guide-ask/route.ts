import { NextResponse } from 'next/server';
import { verifyFirebaseBearerToken } from '@/lib/api-auth';
import { isOpenRouterConfigured, openRouterChat } from '@/lib/ai/openrouter';
import { matchGuideStepIndex, matchGuideTopic } from '@/lib/user-guide';
import { fallbackFieldAnswer, type ScreenField } from '@/lib/user-guide-fields';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SYSTEM = `You are the SKYMAP QMS in-app coach for a pharmaceutical quality system (GMP / 21 CFR Part 11 / ALCOA+).
Help the logged-in user understand the CURRENT screen: why a field is shown, what to type/select, and what happens after they save.
Rules:
- Always reply in clear professional English. Keep on-screen field names exactly as listed.
- Be specific to the field and module. Use short bullets.
- Never invent batch numbers, dates, specification limits, or regulatory clause numbers that are not in the context.
- Never ask for or repeat passwords, PINs, or e-signature secrets.
- If a field is not in the visible field list, say you cannot see it and ask them to click that field (or name it) and ask again.
- If unsure, tell them to follow the site SOP / ask QA. Do not guess GMP decisions.
- Do not write data into the form; only explain.`;

function asFields(value: unknown): ScreenField[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const rec = item as Record<string, unknown>;
      const label = typeof rec.label === 'string' ? rec.label.trim() : '';
      if (!label) return null;
      return {
        label: label.slice(0, 80),
        required: Boolean(rec.required),
        control: typeof rec.control === 'string' ? rec.control.slice(0, 24) : 'field',
        hint: typeof rec.hint === 'string' ? rec.hint.slice(0, 120) : '',
      };
    })
    .filter((x): x is ScreenField => Boolean(x))
    .slice(0, 40);
}

function asHistory(value: unknown): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const rec = item as Record<string, unknown>;
      const role = rec.role === 'assistant' ? 'assistant' : rec.role === 'user' ? 'user' : null;
      const content = typeof rec.content === 'string' ? rec.content.trim() : '';
      if (!role || !content) return null;
      return { role, content: content.slice(0, 1200) };
    })
    .filter((x): x is { role: 'user' | 'assistant'; content: string } => Boolean(x))
    .slice(-6);
}

export async function POST(request: Request) {
  try {
    if (!(await verifyFirebaseBearerToken(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as {
      question?: unknown;
      pathname?: unknown;
      focusedField?: unknown;
      fields?: unknown;
      history?: unknown;
    };

    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question || question.length > 500) {
      return NextResponse.json({ error: 'Question is required (max 500 characters).' }, { status: 400 });
    }

    const pathname = typeof body.pathname === 'string' ? body.pathname.slice(0, 200) : '/';
    const focusedField = typeof body.focusedField === 'string' ? body.focusedField.trim().slice(0, 80) : '';
    const fields = asFields(body.fields);
    const history = asHistory(body.history);
    const topic = matchGuideTopic(pathname);
    const stepIndex = matchGuideStepIndex(topic, pathname);
    const step = topic.steps[stepIndex];

    const fieldLines = fields.length
      ? fields.map((f) => `- ${f.label}${f.required ? ' (required)' : ''} [${f.control}]${f.hint ? ` hint: ${f.hint}` : ''}`).join('\n')
      : '(no visible form fields detected)';

    const context = `Screen: ${pathname}
Module: ${topic.title}
Who uses it: ${topic.who}
Current step: ${step?.title || 'n/a'} — ${step?.detail || topic.summary}
What happens next: ${topic.whatNext}
Focused field: ${focusedField || '(none)'}
Visible fields (labels only, no user-entered values):
${fieldLines}`;

    if (!isOpenRouterConfigured()) {
      const local = fallbackFieldAnswer(question, focusedField || undefined);
      return NextResponse.json({
        text:
          local
          || `AI is not configured. Current screen: ${topic.title} — ${step?.title || topic.summary}. Open How to use → Steps, or ask your QA / system owner. Field "${focusedField || 'this field'}" should be filled with factual GMP data from the batch / investigation; required fields must be completed before submit.`,
        usedAi: false,
      });
    }

    const result = await openRouterChat({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'system', content: context },
        ...history,
        { role: 'user', content: question },
      ],
      temperature: 0.2,
      maxTokens: 700,
    });

    if ('error' in result) {
      const local = fallbackFieldAnswer(question, focusedField || undefined);
      return NextResponse.json({
        text: local || result.error,
        usedAi: false,
        error: result.error,
      });
    }

    return NextResponse.json({ text: result.text, usedAi: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Guide question failed.' },
      { status: 500 },
    );
  }
}
