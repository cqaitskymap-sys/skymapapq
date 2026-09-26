import {
  addDoc, collection, getDocs, limit, orderBy, query, updateDoc, doc, where,
} from 'firebase/firestore';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import {
  CppRecord, CqaRecord, RiskRecord, YieldRecord, calculateAiRiskScore,
  toLegacyCppRecord, toLegacyCqaRecord, toLegacyRiskRecord, toLegacyYieldRecord,
} from '@/lib/cpv';
import { computeCapabilityAverages, countByStatus } from '@/lib/cpv-dashboard';
import { runCpvAiAnalytics } from '@/lib/cpv-ai-analytics';
import { loadIntegrationSnapshot } from '@/lib/cpv-service';
import { fetchCppResults } from '@/lib/cpv-cpp-monitoring-service';
import { fetchCqaResults } from '@/lib/cpv-cqa-monitoring-service';
import { fetchYieldRecords } from '@/lib/cpv-yield-monitoring-service';
import { fetchStabilityResults } from '@/lib/cpv-stability-monitoring-service';
import { fetchUtilityRecords } from '@/lib/cpv-utility-monitoring-service';
import { fetchEnvironmentalRecords } from '@/lib/cpv-environmental-monitoring-service';
import { fetchHoldTimeRecords } from '@/lib/cpv-hold-time-monitoring-service';
import { fetchProcessCapabilityRecords } from '@/lib/cpv-process-capability-service';
import { fetchRiskAssessmentRecords } from '@/lib/cpv-risk-assessment-service';
import {
  AI_PREDICTIONS_COLLECTION, AI_RECOMMENDATIONS_COLLECTION, CPV_AI_ANALYTICS_MODULE,
  MIN_HISTORICAL_RECORDS, generatePredictionId, generateRecommendationId,
  healthCategory, type AiAnalyticsDashboard, type AiPredictionRecord,
  type AiRecommendationRecord, type BatchFailurePrediction, type CpkForecast,
  type DeviationPattern, type ManagementInsights, type OosPrediction,
  type ProcessHealthResult, type RecommendationStatus, type RiskPrediction,
  type StabilityForecast, type YieldPrediction,
} from '@/lib/cpv-ai-analytics-records';
import { enrichAiClient } from '@/lib/ai/client';

export type AiAnalyticsActor = { id: string; name: string; role?: string };

const round = (v: number, d = 1) => Number(v.toFixed(d));

function nowIso() {
  return new Date().toISOString();
}

function safeDate(raw?: string): Date {
  const d = raw ? new Date(raw) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function linearRegression(values: number[]) {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  const sumX = values.reduce((s, _, i) => s + i, 0);
  const sumY = values.reduce((s, v) => s + v, 0);
  const sumXY = values.reduce((s, v, i) => s + i * v, 0);
  const sumXX = values.reduce((s, _, i) => s + i * i, 0);
  const denom = n * sumXX - sumX ** 2;
  const slope = denom ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function filterProduct<T extends { productName?: string }>(records: T[], product?: string): T[] {
  if (!product || product === 'all') return records;
  return records.filter((r) => r.productName === product);
}

function monthKey(raw?: string): string {
  const d = safeDate(raw);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function logAiAudit(actionType: string, recordId: string, actor: AiAnalyticsActor, newVal?: unknown) {
  try {
    await createAuditLog({
      moduleName: CPV_AI_ANALYTICS_MODULE,
      collectionName: AI_PREDICTIONS_COLLECTION,
      recordId,
      actionType,
      newValue: newVal,
      user: { id: actor.id, name: actor.name },
      status: 'Success',
    });
    await writeAuditTrail({
      collectionName: AI_PREDICTIONS_COLLECTION,
      documentId: recordId,
      action: actionType,
      oldValue: null,
      newValue: newVal,
      userId: actor.id,
      userName: actor.name,
      moduleName: CPV_AI_ANALYTICS_MODULE,
    });
  } catch (e) {
    console.error('logAiAudit failed', e);
  }
}

async function listCollection<T extends { id?: string; isDeleted?: boolean }>(
  collectionName: string,
  max = 500,
): Promise<T[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), collectionName),
      where('isDeleted', '==', false),
      orderBy('updatedAt', 'desc'),
      limit(max),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as T));
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), collectionName), limit(max)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as T)).filter((r) => r.isDeleted !== true);
    } catch (e) {
      console.error(`listCollection ${collectionName} failed`, e);
      return [];
    }
  }
}

export async function loadAiSourceData(product?: string) {
  const [
    cppRaw, cqaRaw, yieldRaw, stabilityRaw, utility, environmental, holdTime,
    capability, riskRaw, integrations,
  ] = await Promise.all([
    fetchCppResults(500),
    fetchCqaResults(500),
    fetchYieldRecords(500),
    fetchStabilityResults(500),
    fetchUtilityRecords(500),
    fetchEnvironmentalRecords(500),
    fetchHoldTimeRecords(500),
    fetchProcessCapabilityRecords(500),
    fetchRiskAssessmentRecords(500),
    loadIntegrationSnapshot(),
  ]);

  const cpp = cppRaw.map((r) => toLegacyCppRecord(r as unknown as Record<string, unknown>));
  const cqa = cqaRaw.map((r) => toLegacyCqaRecord(r as unknown as Record<string, unknown>));
  const yields = yieldRaw.map((r) => toLegacyYieldRecord(r as unknown as Record<string, unknown>));
  const risks = riskRaw.map((r) => toLegacyRiskRecord(r as unknown as Record<string, unknown>));
  const stability = (stabilityRaw as unknown as Record<string, unknown>[]).map((r) => ({
    ...r,
    productName: String(r.productName || r.product_name || ''),
    observedValue: r.observedValue ?? r.observedResult ?? r.resultValue,
  }));

  return {
    cpp: filterProduct(cpp, product),
    cqa: filterProduct(cqa, product),
    yields: filterProduct(yields, product),
    stability: filterProduct(stability as Array<{ productName?: string }>, product) as Record<string, unknown>[],
    utility: filterProduct(utility as Array<{ productName?: string }>, product),
    environmental: filterProduct(environmental as Array<{ productName?: string }>, product),
    holdTime: filterProduct(holdTime as Array<{ productName?: string }>, product),
    capability: filterProduct(capability as Array<{ productName?: string }>, product),
    risks: filterProduct(risks, product),
    deviations: integrations.deviations || [],
    oos: integrations.oos || [],
    capa: integrations.capa || [],
    batches: integrations.batches || [],
  };
}

function computeProcessHealth(
  cpp: CppRecord[], cqa: CqaRecord[], yields: YieldRecord[],
  risks: RiskRecord[], deviations: Record<string, unknown>[],
  oos: Record<string, unknown>[], capa: Record<string, unknown>[],
): ProcessHealthResult {
  const cppStats = countByStatus(cpp);
  const cqaStats = countByStatus(cqa);
  const cppTotal = cpp.length || 1;
  const cqaTotal = cqa.length || 1;
  const cppCompliance = round(((cppTotal - cppStats.oos - cppStats.oot) / cppTotal) * 100);
  const cqaCompliance = round(((cqaTotal - cqaStats.oos - cqaStats.oot) / cqaTotal) * 100);
  const yieldPerformance = yields.length
    ? round(yields.reduce((s, r) => s + (r.observedValue || 0), 0) / yields.length)
    : 95;
  const { averageCpk } = computeCapabilityAverages(cpp, cqa);
  const cpkPerformance = round(Math.min(100, (averageCpk / 1.33) * 100));
  const closedCapa = capa.filter((c) => String(c.status || '').toLowerCase() === 'closed').length;
  const capaEffectiveness = capa.length ? round((closedCapa / capa.length) * 100) : 85;

  const score = round(
    cppCompliance * 0.2 + cqaCompliance * 0.2 + yieldPerformance * 0.15 +
    cpkPerformance * 0.15 + capaEffectiveness * 0.1 +
    Math.max(0, 100 - risks.filter((r) => r.riskLevel === 'High' || r.riskLevel === 'Critical').length * 8) * 0.1 +
    Math.max(0, 100 - deviations.length * 3) * 0.05 +
    Math.max(0, 100 - oos.length * 5) * 0.05,
  );

  const productScores = new Map<string, number[]>();
  [...cpp, ...cqa].forEach((r) => {
    const p = r.productName || 'Unknown';
    const ok = r.status === 'Complies' ? 100 : r.status === 'OOT' ? 70 : 40;
    const list = productScores.get(p) || [];
    list.push(ok);
    productScores.set(p, list);
  });
  const productRanking = Array.from(productScores.entries())
    .map(([product, vals]) => ({ product, score: round(vals.reduce((a, b) => a + b, 0) / vals.length) }))
    .sort((a, b) => b.score - a.score);

  const monthMap = new Map<string, number[]>();
  cpp.forEach((r) => {
    const k = monthKey(r.manufacturingDate || r.createdAt);
    const list = monthMap.get(k) || [];
    list.push(r.status === 'Complies' ? 100 : 60);
    monthMap.set(k, list);
  });
  const trend = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, vals]) => ({ month, score: round(vals.reduce((a, b) => a + b, 0) / vals.length) }));

  return {
    score,
    category: healthCategory(score),
    cppCompliance,
    cqaCompliance,
    yieldPerformance,
    riskCount: risks.length,
    deviationCount: deviations.length,
    oosCount: oos.length + cppStats.oos + cqaStats.oos,
    capaEffectiveness,
    cpkPerformance,
    productRanking,
    trend,
  };
}

function computeRiskPredictions(
  cpp: CppRecord[], cqa: CqaRecord[], yields: YieldRecord[],
  risks: RiskRecord[], report: ReturnType<typeof runCpvAiAnalytics>,
): RiskPrediction[] {
  const products = new Set<string>();
  [...cpp, ...cqa, ...yields, ...risks].forEach((r) => r.productName && products.add(r.productName));

  return Array.from(products).slice(0, 10).map((product) => {
    const productRisks = risks.filter((r) => r.productName === product);
    const highCritical = productRisks.filter((r) => r.riskLevel === 'High' || r.riskLevel === 'Critical').length;
    const detections = report.detections.filter((d) => d.product === product);
    const ootCount = filterProduct(cpp, product).filter((r) => r.status === 'OOT').length +
      filterProduct(cqa, product).filter((r) => r.status === 'OOT').length;
    const cpkTrend = detections.some((d) => d.type === 'process_drift') ? 15 : 0;
    const predictedRiskPct = round(Math.min(95, highCritical * 18 + ootCount * 8 + cpkTrend + detections.length * 5));
    const riskLevel = predictedRiskPct >= 75 ? 'Critical' : predictedRiskPct >= 50 ? 'High' : predictedRiskPct >= 25 ? 'Medium' : 'Low';
    const reasons: string[] = [];
    if (ootCount) reasons.push(`${ootCount} OOT event(s)`);
    if (detections.some((d) => d.type === 'process_drift')) reasons.push('Increasing CPP variability');
    if (highCritical) reasons.push(`${highCritical} high/critical risk record(s)`);
    if (detections.some((d) => d.type === 'future_oos')) reasons.push('Cpk falling trend');

    return {
      product,
      module: 'CPV Composite',
      predictedRiskPct,
      riskLevel,
      confidenceScore: round(Math.min(92, 50 + detections.length * 6 + productRisks.length * 4)),
      reason: reasons.length ? reasons.join('; ') : 'Stable historical performance',
    };
  }).filter((r) => r.predictedRiskPct >= 20);
}

function computeOosPredictions(cpp: CppRecord[], cqa: CqaRecord[], report: ReturnType<typeof runCpvAiAnalytics>): OosPrediction[] {
  return report.detections
    .filter((d) => d.type === 'future_oos')
    .map((d) => ({
      product: d.product,
      parameter: d.parameter,
      predictedOosPct: d.confidence,
      riskLevel: d.severity === 'critical' ? 'Critical' : d.severity === 'high' ? 'High' : 'Medium',
      recommendedAction: 'Initiate pre-OOS investigation and tighten in-process controls.',
      confidenceScore: d.confidence,
    }));
}

function computeYieldPredictions(yields: YieldRecord[]): YieldPrediction[] {
  const byProduct = new Map<string, YieldRecord[]>();
  yields.forEach((r) => {
    const list = byProduct.get(r.productName) || [];
    list.push(r);
    byProduct.set(r.productName, list);
  });

  return Array.from(byProduct.entries()).map(([product, records]) => {
    const sorted = records.slice().sort(
      (a, b) => safeDate(a.manufacturingDate || a.createdAt).getTime() - safeDate(b.manufacturingDate || b.createdAt).getTime(),
    );
    const values = sorted.map((r) => r.observedValue || 0);
    const { slope, intercept } = linearRegression(values);
    const expectedYieldPct = round(Math.max(0, intercept + slope * values.length));
    const targetYield = 95;
    const expectedLossPct = round(Math.max(0, targetYield - expectedYieldPct));
    return {
      product,
      expectedYieldPct,
      confidencePct: round(Math.min(90, 55 + sorted.length * 3)),
      expectedLossPct,
      targetYield,
      alert: expectedYieldPct < targetYield,
    };
  });
}

function computeCpkForecasts(cpp: CppRecord[], cqa: CqaRecord[], capability: Record<string, unknown>[]): CpkForecast[] {
  const results: CpkForecast[] = [];
  capability.slice(0, 20).forEach((cap) => {
    const currentCpk = Number(cap.cpk ?? cap.Cpk ?? cap.cpkValue ?? 0);
    if (!currentCpk) return;
    const predictedCpk = round(Math.max(0.5, currentCpk - 0.05));
    results.push({
      product: String(cap.productName || 'All Products'),
      parameter: String(cap.parameterName || cap.parameter || 'Parameter'),
      currentCpk: round(currentCpk, 2),
      predictedCpk,
      expectedRisk: predictedCpk < 1.0 ? 'Critical' : predictedCpk < 1.33 ? 'High' : 'Low',
      alert: predictedCpk < 1.33,
    });
  });

  if (!results.length) {
    const { averageCpk } = computeCapabilityAverages(cpp, cqa);
    if (averageCpk > 0) {
      results.push({
        product: cpp[0]?.productName || cqa[0]?.productName || 'All Products',
        parameter: 'Composite',
        currentCpk: round(averageCpk, 2),
        predictedCpk: round(Math.max(0.8, averageCpk - 0.08), 2),
        expectedRisk: averageCpk < 1.33 ? 'High' : 'Low',
        alert: averageCpk < 1.33,
      });
    }
  }
  return results;
}

function computeStabilityForecasts(stability: Record<string, unknown>[]): StabilityForecast[] {
  const params = ['Assay', 'pH', 'Related Substance', 'Preservative'];
  const results: StabilityForecast[] = [];

  stability.slice(0, 30).forEach((row) => {
    const param = String(row.parameterName || row.testParameter || row.parameter || '');
    if (!params.some((p) => param.toLowerCase().includes(p.toLowerCase()))) return;
    const currentValue = Number(row.observedValue ?? row.resultValue ?? row.assay ?? 0);
    if (!currentValue) return;
    const drift = Number(row.trendSlope ?? 0) || -0.1;
    results.push({
      product: String(row.productName || 'Unknown'),
      parameter: param,
      currentValue: round(currentValue, 2),
      forecast3M: round(currentValue + drift * 3, 2),
      forecast6M: round(currentValue + drift * 6, 2),
      forecast12M: round(currentValue + drift * 12, 2),
      alert: currentValue + drift * 6 < Number(row.lsl ?? row.lowerLimit ?? 0) ||
        currentValue + drift * 6 > Number(row.usl ?? row.upperLimit ?? 999),
      reason: 'Linear trend extrapolation from stability monitoring data',
    });
  });
  return results.slice(0, 10);
}

function computeDeviationPatterns(deviations: Record<string, unknown>[]): DeviationPattern[] {
  const map = new Map<string, DeviationPattern>();
  deviations.forEach((d) => {
    const issue = String(d.title || d.deviationTitle || d.rootCause || d.category || 'Unclassified');
    const dept = String(d.department || d.assignedDepartment || 'QA');
    const month = monthKey(String(d.createdAt || d.openDate));
    const key = `${issue}|${dept}|${month}`;
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, { issue, count: 1, department: dept, month });
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 15);
}

function computeBatchFailurePredictions(
  cpp: CppRecord[], cqa: CqaRecord[], yields: YieldRecord[],
  utility: Record<string, unknown>[], environmental: Record<string, unknown>[],
): BatchFailurePrediction[] {
  const batches = new Set<string>();
  [...cpp, ...cqa, ...yields].forEach((r) => r.batchNo && batches.add(r.batchNo));

  return Array.from(batches).slice(0, 20).map((batchNumber) => {
    const cppHits = cpp.filter((r) => r.batchNo === batchNumber);
    const cqaHits = cqa.filter((r) => r.batchNo === batchNumber);
    const yieldHit = yields.find((r) => r.batchNo === batchNumber);
    const oos = [...cppHits, ...cqaHits].filter((r) => r.status === 'OOS').length;
    const oot = [...cppHits, ...cqaHits].filter((r) => r.status === 'OOT').length;
    const utilIssues = utility.filter((u) => String(u.batchNumber || u.batchNo) === batchNumber).length;
    const envIssues = environmental.filter((e) => String(e.batchNumber || e.batchNo) === batchNumber).length;
    const lowYield = yieldHit && (yieldHit.observedValue || 100) < 90 ? 15 : 0;
    const failureProbability = round(Math.min(95, oos * 25 + oot * 12 + utilIssues * 8 + envIssues * 8 + lowYield));
    const category = failureProbability >= 75 ? 'Critical' : failureProbability >= 50 ? 'High' : failureProbability >= 25 ? 'Medium' : 'Low';
    const reasons: string[] = [];
    if (oos) reasons.push(`${oos} OOS result(s)`);
    if (oot) reasons.push(`${oot} OOT result(s)`);
    if (lowYield) reasons.push('Low yield');
    if (utilIssues) reasons.push('Utility excursion');
    if (envIssues) reasons.push('Environmental excursion');

    return {
      batchNumber,
      product: cppHits[0]?.productName || cqaHits[0]?.productName || 'Unknown',
      failureProbability,
      category,
      reason: reasons.join('; ') || 'Within acceptable limits',
    };
  }).filter((b) => b.failureProbability >= 20);
}

function computeManagementInsights(
  processHealth: ProcessHealthResult,
  riskPredictions: RiskPrediction[],
  deviationPatterns: DeviationPattern[],
  report: ReturnType<typeof runCpvAiAnalytics>,
  capa: Record<string, unknown>[],
): ManagementInsights {
  const closedCapa = capa.filter((c) => String(c.status || '').toLowerCase() === 'closed').length;
  return {
    topRisks: riskPredictions.slice(0, 5).map((r) => `${r.product}: ${r.predictedRiskPct}% (${r.riskLevel})`),
    topOosCauses: report.detections.filter((d) => d.type === 'future_oos').slice(0, 5).map((d) => `${d.parameter} on ${d.product}`),
    topDeviations: deviationPatterns.slice(0, 5).map((d) => `${d.issue} (${d.count})`),
    worstProducts: processHealth.productRanking.slice(-3).reverse().map((p) => `${p.product} (${p.score})`),
    bestProducts: processHealth.productRanking.slice(0, 3).map((p) => `${p.product} (${p.score})`),
    trendingRisks: riskPredictions.filter((r) => r.riskLevel === 'High' || r.riskLevel === 'Critical').slice(0, 5).map((r) => r.product),
    trendingImprovements: processHealth.productRanking.filter((p) => p.score >= 90).slice(0, 3).map((p) => p.product),
    capaEffectivenessPct: processHealth.capaEffectiveness,
    overallPlantHealth: processHealth.score,
  };
}

function buildTrendFromRecords(records: Array<{ date?: string; value: number }>): Array<{ month: string; value: number }> {
  const map = new Map<string, number[]>();
  records.forEach((r) => {
    const k = monthKey(r.date);
    const list = map.get(k) || [];
    list.push(r.value);
    map.set(k, list);
  });
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6)
    .map(([month, vals]) => ({ month, value: round(vals.reduce((a, b) => a + b, 0) / vals.length) }));
}

export async function runAiAnalyticsDashboard(product = 'all'): Promise<AiAnalyticsDashboard> {
  const data = await loadAiSourceData(product);
  const dataPointCount = data.cpp.length + data.cqa.length + data.yields.length + data.stability.length;

  if (dataPointCount < MIN_HISTORICAL_RECORDS) {
    return {
      generatedAt: nowIso(),
      insufficientData: true,
      dataPointCount,
      productFilter: product,
      processHealth: null,
      riskPredictions: [],
      oosPredictions: [],
      yieldPredictions: [],
      cpkForecasts: [],
      stabilityForecasts: [],
      deviationPatterns: [],
      batchFailurePredictions: [],
      managementInsights: null,
      healthScoreTrend: [],
      riskTrend: [],
      yieldTrend: [],
      cpkTrend: [],
      oosTrend: [],
      stabilityTrend: [],
      deviationTrend: [],
      capaEffectivenessTrend: [],
      summary: {
        healthScore: 0,
        healthCategory: '—',
        predictedRisks: 0,
        predictedOos: 0,
        predictedYieldLoss: 0,
        predictedCpkFailure: 0,
        openRecommendations: 0,
        criticalAlerts: 0,
        topRiskProduct: '—',
      },
    };
  }

  let equipment: Record<string, unknown>[] = [];
  try {
    const { loadAnnualReviewSourceData } = await import('@/lib/cpv-annual-review-service');
    const source = await loadAnnualReviewSourceData(new Date().getFullYear(), product === 'all' ? 'all' : product);
    equipment = source.raw?.equipment || [];
  } catch {
    equipment = [];
  }

  const report = runCpvAiAnalytics({
    cpp: data.cpp,
    cqa: data.cqa,
    yields: data.yields,
    utilities: data.utility as never[],
    equipment,
    deviations: data.deviations,
    risks: data.risks,
    filters: { product: product === 'all' ? undefined : product },
  });

  const processHealth = computeProcessHealth(
    data.cpp, data.cqa, data.yields, data.risks, data.deviations, data.oos, data.capa,
  );
  const riskPredictions = computeRiskPredictions(data.cpp, data.cqa, data.yields, data.risks, report);
  const oosPredictions = computeOosPredictions(data.cpp, data.cqa, report);
  const yieldPredictions = computeYieldPredictions(data.yields);
  const cpkForecasts = computeCpkForecasts(data.cpp, data.cqa, data.capability);
  const stabilityForecasts = computeStabilityForecasts(data.stability);
  const deviationPatterns = computeDeviationPatterns(data.deviations);
  const batchFailurePredictions = computeBatchFailurePredictions(
    data.cpp, data.cqa, data.yields, data.utility, data.environmental,
  );
  const managementInsights = computeManagementInsights(
    processHealth, riskPredictions, deviationPatterns, report, data.capa,
  );

  const healthScoreTrend = processHealth.trend;
  const riskTrend = buildTrendFromRecords(riskPredictions.map((r, i) => ({ date: nowIso(), value: r.predictedRiskPct - i })));
  const yieldTrend = buildTrendFromRecords(data.yields.map((r) => ({
    date: r.manufacturingDate || r.createdAt,
    value: r.observedValue || 0,
  })));
  const cpkTrend = buildTrendFromRecords(cpkForecasts.map((c) => ({ date: nowIso(), value: c.predictedCpk })));
  const oosTrend = buildTrendFromRecords(oosPredictions.map((o) => ({ date: nowIso(), value: o.predictedOosPct })));
  const stabilityTrend = buildTrendFromRecords(stabilityForecasts.map((s) => ({ date: nowIso(), value: s.forecast6M })));
  const deviationTrend = deviationPatterns.slice(0, 8).map((d) => ({ name: d.issue.slice(0, 24), value: d.count }));
  const capaEffectivenessTrend = buildTrendFromRecords([{ date: nowIso(), value: processHealth.capaEffectiveness }]);

  const predictedYieldLoss = yieldPredictions.filter((y) => y.alert).length;
  const predictedCpkFailure = cpkForecasts.filter((c) => c.alert).length;
  const criticalAlerts = report.detections.filter((d) => d.severity === 'critical').length +
    batchFailurePredictions.filter((b) => b.category === 'Critical').length;
  const topRiskProduct = riskPredictions.sort((a, b) => b.predictedRiskPct - a.predictedRiskPct)[0]?.product || '—';

  return {
    generatedAt: nowIso(),
    insufficientData: false,
    dataPointCount,
    productFilter: product,
    processHealth,
    riskPredictions,
    oosPredictions,
    yieldPredictions,
    cpkForecasts,
    stabilityForecasts,
    deviationPatterns,
    batchFailurePredictions,
    managementInsights,
    healthScoreTrend,
    riskTrend,
    yieldTrend,
    cpkTrend,
    oosTrend,
    stabilityTrend,
    deviationTrend,
    capaEffectivenessTrend,
    summary: {
      healthScore: processHealth.score,
      healthCategory: processHealth.category,
      predictedRisks: riskPredictions.length,
      predictedOos: oosPredictions.length,
      predictedYieldLoss,
      predictedCpkFailure,
      openRecommendations: 0,
      criticalAlerts,
      topRiskProduct,
    },
  };
}

export async function generateAndPersistAiAnalytics(
  actor: AiAnalyticsActor,
  product = 'all',
): Promise<{ dashboard: AiAnalyticsDashboard; error: string | null }> {
  const dashboard = await runAiAnalyticsDashboard(product);
  if (dashboard.insufficientData) {
    return { dashboard, error: null };
  }
  if (!isFirebaseConfigured()) return { dashboard, error: null };

  try {
    const existingPreds = await listCollection<AiPredictionRecord>(AI_PREDICTIONS_COLLECTION, 1);
    const existingRecs = await listCollection<AiRecommendationRecord>(AI_RECOMMENDATIONS_COLLECTION, 1);
    let predCount = existingPreds.length;
    let recCount = existingRecs.length;
    const now = nowIso();

    const savePrediction = async (
      engineType: AiPredictionRecord['engineType'],
      payload: Partial<AiPredictionRecord>,
    ) => {
      const doc = {
        predictionId: generatePredictionId(predCount++),
        engineType,
        product: payload.product || 'All Products',
        module: payload.module || 'CPV',
        parameter: payload.parameter || '',
        batchNumber: payload.batchNumber || '',
        predictedValue: payload.predictedValue ?? 0,
        confidenceScore: payload.confidenceScore ?? 0,
        riskLevel: payload.riskLevel || 'Medium',
        reason: payload.reason || '',
        recommendedAction: payload.recommendedAction || '',
        generatedDate: now,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.id,
        updatedBy: actor.id,
        isDeleted: false,
      };
      const ref = await addDoc(collection(getFirebaseFirestore(), AI_PREDICTIONS_COLLECTION), doc);
      await logAiAudit('Generate Prediction', ref.id, actor, doc);
    };

    await savePrediction('process_health', {
      product: product === 'all' ? 'All Products' : product,
      module: 'CPV Dashboard',
      predictedValue: dashboard.processHealth?.score || 0,
      confidenceScore: 85,
      riskLevel: dashboard.processHealth?.category || 'Good',
      reason: 'Composite CPV health score',
    });

    for (const r of dashboard.riskPredictions.slice(0, 5)) {
      await savePrediction('risk_prediction', {
        product: r.product,
        module: r.module,
        predictedValue: r.predictedRiskPct,
        confidenceScore: r.confidenceScore,
        riskLevel: r.riskLevel,
        reason: r.reason,
      });
    }

    for (const o of dashboard.oosPredictions.slice(0, 5)) {
      await savePrediction('oos_prediction', {
        product: o.product,
        parameter: o.parameter,
        predictedValue: o.predictedOosPct,
        confidenceScore: o.confidenceScore,
        riskLevel: o.riskLevel,
        recommendedAction: o.recommendedAction,
        reason: 'OOS trajectory detected',
      });
    }

    for (const rec of dashboard.yieldPredictions.filter((y) => y.alert).slice(0, 3)) {
      await savePrediction('yield_prediction', {
        product: rec.product,
        module: 'Yield Monitoring',
        predictedValue: rec.expectedYieldPct,
        confidenceScore: rec.confidencePct,
        riskLevel: rec.alert ? 'High' : 'Low',
        reason: `Expected loss ${rec.expectedLossPct}%`,
      });
    }

    for (const cap of dashboard.cpkForecasts.filter((c) => c.alert).slice(0, 3)) {
      await savePrediction('cpk_forecast', {
        product: cap.product,
        parameter: cap.parameter,
        module: 'Process Capability',
        predictedValue: cap.predictedCpk,
        confidenceScore: 78,
        riskLevel: cap.expectedRisk,
        reason: `Current Cpk ${cap.currentCpk}, predicted ${cap.predictedCpk}`,
        recommendedAction: 'Review process centering and update control strategy',
      });
    }

    let builtRecommendations: Array<{ finding: string; recommendation: string; priority: AiRecommendationRecord['priority']; riskLevel: string }> = [
      ...dashboard.riskPredictions.filter((r) => r.riskLevel === 'High' || r.riskLevel === 'Critical').map((r) => ({
        finding: `Elevated risk on ${r.product}`,
        recommendation: `Investigate: ${r.reason}. Assign QA owner and due date.`,
        priority: (r.riskLevel === 'Critical' ? 'Critical' : 'High') as AiRecommendationRecord['priority'],
        riskLevel: r.riskLevel,
      })),
      ...dashboard.yieldPredictions.filter((y) => y.alert).map((y) => ({
        finding: `Low Filling Yield — ${y.product}`,
        recommendation: 'Review filling machine calibration, operator training, and filling speed.',
        priority: 'High' as const,
        riskLevel: 'High',
      })),
      ...dashboard.cpkForecasts.filter((c) => c.alert).map((c) => ({
        finding: `Cpk below target for ${c.parameter}`,
        recommendation: 'Initiate CAPA for process capability improvement and SPC review.',
        priority: 'Medium' as const,
        riskLevel: c.expectedRisk,
      })),
      ...dashboard.oosPredictions.slice(0, 3).map((o) => ({
        finding: `Predicted OOS on ${o.parameter}`,
        recommendation: o.recommendedAction,
        priority: 'Critical' as const,
        riskLevel: o.riskLevel,
      })),
    ].slice(0, 8);

    try {
      const enriched = await enrichAiClient({
        task: 'recommendations',
        context: {
          product,
          processHealth: dashboard.processHealth,
          summary: dashboard.summary,
          riskPredictions: dashboard.riskPredictions.slice(0, 5),
          oosPredictions: dashboard.oosPredictions.slice(0, 5),
          yieldPredictions: dashboard.yieldPredictions.filter((y) => y.alert).slice(0, 3),
          cpkForecasts: dashboard.cpkForecasts.filter((c) => c.alert).slice(0, 3),
          managementInsights: dashboard.managementInsights,
        },
        fallback: { recommendations: builtRecommendations },
      });
      const aiRecs = enriched.data.recommendations;
      if (Array.isArray(aiRecs) && aiRecs.length) {
        builtRecommendations = aiRecs.slice(0, 8).map((item, index) => {
          const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
          const base = builtRecommendations[index] || builtRecommendations[0];
          const priorityRaw = String(row.priority || base?.priority || 'Medium');
          const priority = (
            ['Critical', 'High', 'Medium', 'Low'].includes(priorityRaw) ? priorityRaw : 'Medium'
          ) as AiRecommendationRecord['priority'];
          return {
            finding: String(row.finding || base?.finding || 'AI finding'),
            recommendation: String(row.recommendation || base?.recommendation || ''),
            priority,
            riskLevel: String(row.riskLevel || base?.riskLevel || priority),
          };
        });
      }

      if (dashboard.managementInsights) {
        const mgmt = await enrichAiClient({
          task: 'management_summary',
          context: {
            product,
            processHealth: dashboard.processHealth,
            summary: dashboard.summary,
            insights: dashboard.managementInsights,
          },
          fallback: {
            summary: `Overall plant health ${dashboard.managementInsights.overallPlantHealth}/100 with CAPA effectiveness ${dashboard.managementInsights.capaEffectivenessPct}%.`,
            bullets: dashboard.managementInsights.topRisks,
          },
        });
        const summaryText = typeof mgmt.data.summary === 'string' ? mgmt.data.summary.trim() : '';
        const bullets = Array.isArray(mgmt.data.bullets) ? mgmt.data.bullets.map(String).filter(Boolean) : [];
        if (summaryText || bullets.length) {
          dashboard.managementInsights = {
            ...dashboard.managementInsights,
            topRisks: summaryText
              ? [summaryText, ...dashboard.managementInsights.topRisks].slice(0, 6)
              : dashboard.managementInsights.topRisks,
            trendingRisks: bullets.length ? bullets.slice(0, 6) : dashboard.managementInsights.trendingRisks,
          };
        }
      }
    } catch (enrichError) {
      console.warn('OpenRouter enrich skipped for AI analytics', enrichError);
    }

    for (const rec of builtRecommendations) {
      const doc = {
        recommendationId: generateRecommendationId(recCount++),
        product: product === 'all' ? 'All Products' : product,
        module: 'CPV AI Analytics',
        finding: rec.finding,
        riskLevel: rec.riskLevel,
        recommendation: rec.recommendation,
        priority: rec.priority,
        status: 'Open' as const,
        generatedDate: now,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.id,
        updatedBy: actor.id,
        isDeleted: false,
      };
      const ref = await addDoc(collection(getFirebaseFirestore(), AI_RECOMMENDATIONS_COLLECTION), doc);
      await logAiAudit('Generate Recommendation', ref.id, actor, doc);
    }

    await logAiAudit('Generate Prediction', 'dashboard-run', actor, { product, generatedAt: now });
    dashboard.summary.openRecommendations = builtRecommendations.length;
    return { dashboard, error: null };
  } catch (e) {
    console.error('generateAndPersistAiAnalytics failed', e);
    return { dashboard, error: 'Failed to persist AI analytics.' };
  }
}

export async function fetchAiRecommendations(max = 100): Promise<AiRecommendationRecord[]> {
  return listCollection<AiRecommendationRecord>(AI_RECOMMENDATIONS_COLLECTION, max);
}

export async function fetchAiPredictions(max = 100): Promise<AiPredictionRecord[]> {
  return listCollection<AiPredictionRecord>(AI_PREDICTIONS_COLLECTION, max);
}

export async function updateRecommendationStatus(
  id: string,
  status: RecommendationStatus,
  actor: AiAnalyticsActor,
) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const payload = { status, updatedAt: nowIso(), updatedBy: actor.id };
    await updateDoc(doc(getFirebaseFirestore(), AI_RECOMMENDATIONS_COLLECTION, id), payload);
    const action = status === 'Closed' ? 'Close Recommendation' : status === 'Reviewed' ? 'Approve Recommendation' : 'edit configuration';
    await logAiAudit(action, id, actor, payload);
    return { error: null };
  } catch (e) {
    console.error('updateRecommendationStatus failed', e);
    return { error: 'Failed to update recommendation.' };
  }
}

export async function logAiAnalyticsExport(actor: AiAnalyticsActor, type: string) {
  await logAiAudit('Export Analytics', type, actor);
}

export async function logAiReportView(actor: AiAnalyticsActor) {
  await logAiAudit('View AI Report', 'dashboard', actor);
}
