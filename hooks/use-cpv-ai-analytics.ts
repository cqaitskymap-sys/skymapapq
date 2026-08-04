'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CPV_COLLECTIONS, CppRecord, CqaRecord, RiskRecord, UtilityRecord, YieldRecord,
} from '@/lib/cpv';
import { listCpvRecords, loadIntegrationSnapshot } from '@/lib/cpv-service';
import { runCpvAiAnalytics, type AiAnalyticsReport, type AiAnalyticsFilters } from '@/lib/cpv-ai-analytics';
import { enrichAiClient } from '@/lib/ai/client';

export function useCpvAiAnalytics(filters: AiAnalyticsFilters = {}) {
  const { product } = filters;
  const stableFilters = useMemo(() => ({ product }), [product]);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<AiAnalyticsReport | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [cpp, cqa, yields, utilities, risks, integrations] = await Promise.all([
        listCpvRecords<CppRecord>(CPV_COLLECTIONS.cpp),
        listCpvRecords<CqaRecord>(CPV_COLLECTIONS.cqa),
        listCpvRecords<YieldRecord>(CPV_COLLECTIONS.yield),
        listCpvRecords<UtilityRecord>(CPV_COLLECTIONS.utility),
        listCpvRecords<RiskRecord>(CPV_COLLECTIONS.risk),
        loadIntegrationSnapshot(),
      ]);

      let equipment: Record<string, unknown>[] = [];
      try {
        const { loadAnnualReviewSourceData } = await import('@/lib/cpv-annual-review-service');
        const source = await loadAnnualReviewSourceData(new Date().getFullYear(), product || 'all');
        equipment = source.raw?.equipment || [];
      } catch {
        equipment = [];
      }

      const base = runCpvAiAnalytics({
        cpp,
        cqa,
        yields,
        utilities,
        equipment,
        deviations: integrations.deviations,
        risks,
        filters: stableFilters,
      });

      try {
        const enriched = await enrichAiClient({
          task: 'recommendations',
          context: {
            product: product || 'all',
            riskScore: base.riskScore,
            healthScore: base.healthScore,
            detections: base.detections.slice(0, 10),
            managementSummary: base.managementSummary,
          },
          fallback: {
            recommendations: base.recommendations.map((r) => ({
              finding: r.title,
              recommendation: r.action,
              priority: r.priority,
              riskLevel: r.priority,
              rationale: r.rationale,
            })),
          },
        });
        const aiRecs = Array.isArray(enriched.data.recommendations) ? enriched.data.recommendations : [];
        if (aiRecs.length) {
          base.recommendations = base.recommendations.map((rec, index) => {
            const row = (aiRecs[index] && typeof aiRecs[index] === 'object'
              ? aiRecs[index]
              : {}) as Record<string, unknown>;
            return {
              ...rec,
              title: String(row.finding || rec.title),
              action: String(row.recommendation || rec.action),
              rationale: String(row.rationale || rec.rationale),
            };
          });
        }

        const summary = await enrichAiClient({
          task: 'management_summary',
          context: {
            product: product || 'all',
            riskScore: base.riskScore,
            healthScore: base.healthScore,
            detections: base.detections.slice(0, 8),
          },
          fallback: {
            summary: base.managementSummary,
            bullets: base.summaryBullets,
          },
        });
        if (typeof summary.data.summary === 'string' && summary.data.summary.trim()) {
          base.managementSummary = summary.data.summary.trim();
          base.summaryBullets = Array.isArray(summary.data.bullets)
            ? summary.data.bullets.map(String)
            : base.summaryBullets;
        }
      } catch {
        // Keep heuristic report if OpenRouter is unavailable.
      }

      setReport(base);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [product, stableFilters]);

  useEffect(() => { void reload(); }, [reload]);

  return { loading, report, reload };
}
