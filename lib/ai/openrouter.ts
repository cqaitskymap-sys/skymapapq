/**
 * Server-only OpenRouter client. Never import from client components.
 */

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL?.trim() || 'openai/gpt-4o-mini';

export type OpenRouterMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type OpenRouterChatOptions = {
  messages: OpenRouterMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
};

export function getOpenRouterApiKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return key || null;
}

export function isOpenRouterConfigured(): boolean {
  return Boolean(getOpenRouterApiKey());
}

export async function openRouterChat(
  options: OpenRouterChatOptions,
): Promise<{ text: string; model: string } | { error: string }> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    return { error: 'OPENROUTER_API_KEY is not configured.' };
  }

  const model = options.model || DEFAULT_OPENROUTER_MODEL;
  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 1200,
  };
  if (options.responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }

  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://apq-skymap.local',
        'X-Title': 'APQ Skymap QMS',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { error: `OpenRouter error ${res.status}: ${detail.slice(0, 300)}` };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };
    const text = data.choices?.[0]?.message?.content?.trim() || '';
    if (!text) return { error: 'OpenRouter returned an empty response.' };
    return { text, model: data.model || model };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'OpenRouter request failed.' };
  }
}

export function safeParseJsonObject<T extends Record<string, unknown>>(
  text: string,
): T | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
