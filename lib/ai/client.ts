/**
 * Browser-safe OpenRouter enrich helper (calls Next.js API; key stays server-side).
 */

import type { AiEnrichTask } from '@/lib/ai/enrich';
import { getFirebaseAuth, isFirebaseConfigured } from '@/lib/firebase';

export type AiEnrichClientResult = {
  data: Record<string, unknown>;
  usedAi: boolean;
  error?: string;
};

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!isFirebaseConfigured()) return headers;
  const user = getFirebaseAuth().currentUser;
  if (!user) return headers;
  try {
    const token = await user.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  } catch {
    // Leave unauthenticated; API will return 401.
  }
  return headers;
}

export async function enrichAiClient(input: {
  task: AiEnrichTask;
  context?: Record<string, unknown>;
  fallback?: Record<string, unknown>;
}): Promise<AiEnrichClientResult> {
  try {
    const res = await fetch('/api/ai/enrich', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({
        task: input.task,
        context: input.context || {},
        fallback: input.fallback || {},
      }),
    });
    const json = (await res.json().catch(() => ({}))) as AiEnrichClientResult & {
      error?: string;
    };
    if (!res.ok) {
      return {
        data: input.fallback || {},
        usedAi: false,
        error: json.error || `AI enrich failed (${res.status})`,
      };
    }
    return {
      data: json.data || input.fallback || {},
      usedAi: Boolean(json.usedAi),
      error: json.error,
    };
  } catch (e) {
    return {
      data: input.fallback || {},
      usedAi: false,
      error: e instanceof Error ? e.message : 'AI enrich request failed.',
    };
  }
}

export async function polishRecommendationText(
  text: string,
  context?: Record<string, unknown>,
): Promise<string> {
  if (!text.trim()) return text;
  const result = await enrichAiClient({
    task: 'capability_recommendation',
    context: context || {},
    fallback: { aiRecommendation: text },
  });
  const polished = result.data.aiRecommendation;
  return typeof polished === 'string' && polished.trim() ? polished.trim() : text;
}

export async function polishTrendDrafts(input: {
  module: string;
  recommendation_draft?: string;
  conclusion_draft?: string;
  management_summary_draft?: string;
  context?: Record<string, unknown>;
}): Promise<{
  recommendation_draft: string;
  conclusion_draft: string;
  management_summary_draft: string;
  usedAi: boolean;
}> {
  const fallback = {
    recommendation_draft: input.recommendation_draft || '',
    conclusion_draft: input.conclusion_draft || '',
    management_summary_draft: input.management_summary_draft || '',
  };
  const result = await enrichAiClient({
    task: 'trend_recommendation',
    context: { module: input.module, ...(input.context || {}) },
    fallback,
  });
  return {
    recommendation_draft:
      typeof result.data.recommendation_draft === 'string' && result.data.recommendation_draft.trim()
        ? String(result.data.recommendation_draft).trim()
        : fallback.recommendation_draft,
    conclusion_draft:
      typeof result.data.conclusion_draft === 'string' && result.data.conclusion_draft.trim()
        ? String(result.data.conclusion_draft).trim()
        : fallback.conclusion_draft,
    management_summary_draft:
      typeof result.data.management_summary_draft === 'string'
        && result.data.management_summary_draft.trim()
        ? String(result.data.management_summary_draft).trim()
        : fallback.management_summary_draft,
    usedAi: result.usedAi,
  };
}

export async function polishQmsReportTexts(input: {
  module: string;
  summary?: string;
  recommendations?: string;
  management_summary?: string;
  context?: Record<string, unknown>;
}): Promise<{
  summary: string;
  recommendations: string;
  management_summary: string;
  usedAi: boolean;
}> {
  const fallback = {
    summary: input.summary || '',
    recommendations: input.recommendations || '',
    management_summary: input.management_summary || '',
  };
  const result = await enrichAiClient({
    task: 'qms_report',
    context: { module: input.module, ...(input.context || {}) },
    fallback,
  });
  return {
    summary:
      typeof result.data.summary === 'string' && result.data.summary.trim()
        ? String(result.data.summary).trim()
        : fallback.summary,
    recommendations:
      typeof result.data.recommendations === 'string' && result.data.recommendations.trim()
        ? String(result.data.recommendations).trim()
        : Array.isArray(result.data.recommendations)
          ? result.data.recommendations.map(String).join('\n')
          : fallback.recommendations,
    management_summary:
      typeof result.data.management_summary === 'string' && result.data.management_summary.trim()
        ? String(result.data.management_summary).trim()
        : fallback.management_summary,
    usedAi: result.usedAi,
  };
}
