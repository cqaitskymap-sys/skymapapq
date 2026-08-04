import {
  openRouterChat,
  safeParseJsonObject,
  isOpenRouterConfigured,
} from '@/lib/ai/openrouter';

export const AI_ENRICH_TASKS = [
  'recommendations',
  'alert_intelligence',
  'report_insights',
  'annual_review',
  'trend_recommendation',
  'capability_recommendation',
  'management_summary',
  'pqr_narrative',
  'qms_report',
  'generic_text',
] as const;

export type AiEnrichTask = (typeof AI_ENRICH_TASKS)[number];

const PHARMA_SYSTEM = `You are a pharmaceutical Quality Management System (QMS) AI assistant for Stage 3 Continued Process Verification (CPV), OOS, CAPA, deviations, complaints, recalls, and PQR.
Write concise, audit-ready, ALCOA+-compatible text. Avoid hallucination of batch numbers, dates, or regulatory citations not present in the context.
Use professional QA language. Prefer actionable recommendations with clear owners/next steps when relevant.
Never invent numerical metrics — only interpret the numbers provided.`;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

export async function enrichWithOpenRouter(input: {
  task: AiEnrichTask;
  context?: Record<string, unknown>;
  fallback?: Record<string, unknown>;
}): Promise<{ data: Record<string, unknown>; usedAi: boolean; error?: string }> {
  const fallback = asRecord(input.fallback);
  if (!isOpenRouterConfigured()) {
    return { data: fallback, usedAi: false, error: 'OPENROUTER_API_KEY is not configured.' };
  }

  const context = asRecord(input.context);
  const userPrompt = buildUserPrompt(input.task, context, fallback);
  const result = await openRouterChat({
    messages: [
      { role: 'system', content: PHARMA_SYSTEM },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.25,
    maxTokens: 1400,
    responseFormat: 'json',
  });

  if ('error' in result) {
    return { data: fallback, usedAi: false, error: result.error };
  }

  const parsed = safeParseJsonObject<Record<string, unknown>>(result.text);
  if (!parsed) {
    return { data: fallback, usedAi: false, error: 'Failed to parse AI JSON response.' };
  }

  return { data: mergeFallback(fallback, parsed), usedAi: true };
}

function mergeFallback(
  fallback: Record<string, unknown>,
  parsed: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...fallback };
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
    else if (Array.isArray(value) && value.length) out[key] = value;
    else if (value !== undefined && value !== null && typeof value !== 'object') out[key] = value;
  }
  return out;
}

function buildUserPrompt(
  task: AiEnrichTask,
  context: Record<string, unknown>,
  fallback: Record<string, unknown>,
): string {
  const ctx = JSON.stringify(context, null, 2);
  const fb = JSON.stringify(fallback, null, 2);

  switch (task) {
    case 'recommendations':
      return `Improve these CPV AI recommendations for QA action tracking.
Return JSON: {"recommendations":[{"finding":"...","recommendation":"...","priority":"Critical|High|Medium|Low","riskLevel":"..."}]}
Keep the same count/order when possible. Context:\n${ctx}\nFallback:\n${fb}`;

    case 'alert_intelligence':
      return `Improve CPV alert AI intelligence.
Return JSON: {"aiRootCauseSuggestion":"...","aiRecommendedActions":"...","failurePrediction":"...","riskPrediction":"..."}
Context:\n${ctx}\nFallback:\n${fb}`;

    case 'report_insights':
      return `Improve CPV report AI insights.
Return JSON: {"aiExecutiveSummary":"...","aiDailyInsights":"...","aiTrendPrediction":"...","aiRiskPrediction":"...","aiPreventiveRecommendations":"..."}
Context:\n${ctx}\nFallback:\n${fb}`;

    case 'annual_review':
      return `Improve annual CPV review AI insights.
Return JSON: {"aiExecutiveSummary":"...","aiQualityReview":"...","aiRiskPrediction":"...","aiPreventiveRecommendations":"..."}
Context:\n${ctx}\nFallback:\n${fb}`;

    case 'trend_recommendation':
      return `Improve QMS trend recommendation draft for module "${str(context.module, 'QMS')}".
Return JSON: {"recommendation_draft":"...","conclusion_draft":"...","management_summary_draft":"..."}
Only include keys that apply. Context:\n${ctx}\nFallback:\n${fb}`;

    case 'capability_recommendation':
      return `Improve process capability / SPC / risk AI recommendation text.
Return JSON: {"aiRecommendation":"..."}
Context:\n${ctx}\nFallback:\n${fb}`;

    case 'management_summary':
      return `Improve CPV AI management summary.
Return JSON: {"summary":"...","bullets":["..."]}
Context:\n${ctx}\nFallback:\n${fb}`;

    case 'pqr_narrative':
      return `Improve Product Quality Review narrative sections.
Return JSON: {"observations":"...","conclusions":"...","recommendations":["..."]}
Context:\n${ctx}\nFallback:\n${fb}`;

    case 'qms_report':
      return `Improve this pharmaceutical QMS report narrative for module "${str(context.module, 'QMS')}".
Return JSON: {"summary":"...","recommendations":"...","management_summary":"..."}
Keep recommendations actionable and numbered when multiple. Context:\n${ctx}\nFallback:\n${fb}`;

    case 'generic_text':
    default:
      return `Improve the provided pharmaceutical QMS text.
Return JSON: {"text":"..."}
Context:\n${ctx}\nFallback:\n${fb}`;
  }
}
