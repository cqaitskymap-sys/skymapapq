/** Optional client-provided AI recommendation override for Cloud Functions. */
export function withAiRecommendationOverride<T extends { aiRecommendation: string }>(
  calc: T,
  data: Record<string, unknown>,
): T {
  const override = typeof data.aiRecommendation === 'string' ? data.aiRecommendation.trim() : '';
  if (override.length >= 20) {
    return { ...calc, aiRecommendation: override };
  }
  return calc;
}
