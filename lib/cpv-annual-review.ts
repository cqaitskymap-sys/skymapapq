import type { CppRecord, CqaRecord, RiskRecord } from './cpv';
import { calculateCapability, calculateControlLimits, displayCpvStatus } from './cpv';
import { buildRiskReport } from './cpv-risk-report';
import { computeOverallAssessment, enrichCpvReviewMetrics, type CpvReviewMetrics } from './cpv-annual-review-records';

export type AnnualCpvWorkflowStatus = 'draft' | 'under_review' | 'approved' | 'archived' | 'generated' | 'rejected';

export function workflowStatusLabel(status: AnnualCpvWorkflowStatus | string): string {
  const map: Record<string, string> = {
    draft: 'Draft',
    under_review: 'Under Review',
    approved: 'Approved',
    archived: 'Archived',
    generated: 'Generated',
    rejected: 'Rejected',
    Draft: 'Draft',
    'Data Collection': 'Data Collection',
    Generated: 'Generated',
    'Under Review': 'Under Review',
    Approved: 'Approved',
    Rejected: 'Rejected',
    Archived: 'Archived',
  };
  return map[status] || String(status);
}

export interface AnnualCpvSectionSummary {
  total: number;
  open?: number;
  complies?: number;
  oot?: number;
  oos?: number;
  summary: string;
  records?: Record<string, unknown>[];
}

export interface AnnualCpvReviewInput {
  year: number;
  reviewPeriodFrom?: string;
  reviewPeriodTo?: string;
  productFilter?: string;
  productCode?: string;
  cpp: CppRecord[];
  cqa: CqaRecord[];
  risks: RiskRecord[];
  riskAssessment?: Record<string, unknown>[];
  deviations: Record<string, unknown>[];
  oos: Record<string, unknown>[];
  capa: Record<string, unknown>[];
  changeControl: Record<string, unknown>[];
  batches: Record<string, unknown>[];
  equipment: Record<string, unknown>[];
  stability?: Record<string, unknown>[];
  holdTime?: Record<string, unknown>[];
  processCapability?: Record<string, unknown>[];
  trendAnalysis?: Record<string, unknown>[];
  spc?: Record<string, unknown>[];
  rawMaterial?: Record<string, unknown>[];
  packingMaterial?: Record<string, unknown>[];
  utility?: Record<string, unknown>[];
  environmental?: Record<string, unknown>[];
  yield?: Record<string, unknown>[];
}

export interface AnnualCpvCapabilityItem {
  parameter: string;
  source: 'CPP' | 'CQA';
  count: number;
  cpk: number;
  ppk: number;
  status: string;
}

export interface AnnualCpvSnapshot {
  reviewYear: number;
  generatedAt: string;
  productFilter: string;
  cpp: AnnualCpvSectionSummary;
  cqa: AnnualCpvSectionSummary;
  capability: {
    averageCpk: number;
    averagePpk: number;
    items: AnnualCpvCapabilityItem[];
    controlViolations: number;
    summary: string;
  };
  trend: {
    oot: number;
    oos: number;
    totalObservations: number;
    trendRecords?: number;
    summary: string;
  };
  trendAnalysis: AnnualCpvSectionSummary & {
    alert?: number;
    capaSuggested?: number;
  };
  spc: AnnualCpvSectionSummary & {
    outOfControl?: number;
    violations?: number;
    capaSuggested?: number;
  };
  risk: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    summary: string;
  };
  deviations: AnnualCpvSectionSummary;
  oos: AnnualCpvSectionSummary;
  capa: AnnualCpvSectionSummary;
  changeControl: AnnualCpvSectionSummary;
  batches: {
    total: number;
    manufactured: number;
    released: number;
    rejected: number;
    records: Record<string, unknown>[];
    summary: string;
  };
  equipment: AnnualCpvSectionSummary;
  stability: AnnualCpvSectionSummary;
  holdTime: AnnualCpvSectionSummary;
  processCapability: AnnualCpvSectionSummary & { averageCpk?: number; averagePpk?: number };
  rawMaterial: AnnualCpvSectionSummary;
  packingMaterial: AnnualCpvSectionSummary;
  utility: AnnualCpvSectionSummary;
  environmental: AnnualCpvSectionSummary;
  yield: AnnualCpvSectionSummary & { averageYield?: number };
  metrics: CpvReviewMetrics;
  overallProcessStatus: 'In Control' | 'Under Control With Monitoring' | 'Needs Improvement' | 'Not In Control';
  overallRiskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  executiveSummary: string;
  conclusion: string;
  recommendations: string;
}

export interface AnnualCpvSignature {
  role: 'prepared' | 'reviewed' | 'approved';
  designation: string;
  name: string;
  signatureText: string;
  signedAt: string | null;
  userId?: string;
  meaning?: string;
  reason?: string;
}

export interface AnnualCpvDocument {
  id?: string;
  documentNumber: string;
  reviewYear: number;
  productName: string;
  status: AnnualCpvWorkflowStatus;
  conclusion: string;
  recommendations: string;
  preparedBy: string;
  preparedById: string;
  signatures: AnnualCpvSignature[];
  snapshot: AnnualCpvSnapshot;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export const DEFAULT_ANNUAL_CPV_SIGNATURES: AnnualCpvSignature[] = [
  { role: 'prepared', designation: 'CPV Coordinator / QA Executive', name: '', signatureText: '', signedAt: null },
  { role: 'reviewed', designation: 'QA Manager', name: '', signatureText: '', signedAt: null },
  { role: 'approved', designation: 'Head QA', name: '', signatureText: '', signedAt: null },
];

function inYear(dateStr: string | undefined, year: number): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return !Number.isNaN(d.getTime()) && d.getFullYear() === year;
}

function inDateRange(dateStr: string | undefined, from?: string, to?: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  if (from && to) {
    const fromD = new Date(from);
    const toD = new Date(to);
    toD.setHours(23, 59, 59, 999);
    return d >= fromD && d <= toD;
  }
  return true;
}

function inReviewPeriod(dateStr: string | undefined, year: number, from?: string, to?: string): boolean {
  if (from && to) return inDateRange(dateStr, from, to);
  return inYear(dateStr, year);
}

function pickDate(record: Record<string, unknown>): string {
  return String(
    record.createdAt || record.created_at || record.manufacturingDate
    || record.manufacturing_date || record.testDate || record.test_date || '',
  );
}

function countOpen(records: Record<string, unknown>[]): number {
  return records.filter((r) => {
    const s = String(r.status || r.workflow_status || '').toLowerCase();
    return s.includes('open') || s.includes('draft') || s.includes('pending') || s.includes('investigation');
  }).length;
}

function countCppCqa(records: Array<{ status?: string }>) {
  let complies = 0; let oot = 0; let oos = 0;
  records.forEach((r) => {
    const display = displayCpvStatus(r.status || '');
    if (display === 'Pass') complies++;
    else if (display === 'OOT') oot++;
    else oos++;
  });
  return { complies, oot, oos };
}

export function buildAnnualCpvSnapshot(input: AnnualCpvReviewInput): AnnualCpvSnapshot {
  const productFilter = input.productFilter || 'all';
  const productCode = input.productCode || '';
  const matchProduct = (r: Record<string, unknown>) => {
    if (productFilter === 'all') return true;
    const p = String(r.productName || r.product_name || r.product || '');
    const code = String(r.productCode || r.product_code || '');
    return p === productFilter || (productCode && code === productCode);
  };

  const inPeriod = (dateStr: string | undefined) =>
    inReviewPeriod(dateStr, input.year, input.reviewPeriodFrom, input.reviewPeriodTo);

  const cppYear = input.cpp.filter((r) =>
    inPeriod(r.createdAt || r.manufacturingDate) && (productFilter === 'all' || r.productName === productFilter),
  );
  const cqaYear = input.cqa.filter((r) =>
    inPeriod(r.testDate || r.createdAt) && (productFilter === 'all' || r.productName === productFilter),
  );
  const riskRows = (input.riskAssessment?.length ? input.riskAssessment : input.risks) as Array<Record<string, unknown>>;
  const riskYear = riskRows.filter((r) =>
    inPeriod(String(r.createdAt || r.created_at || '')) && matchProduct(r),
  );

  const deviations = input.deviations.filter((r) => inPeriod(pickDate(r)) && matchProduct(r));
  const oosEvents = input.oos.filter((r) => inPeriod(pickDate(r)) && matchProduct(r));
  const capa = input.capa.filter((r) => inPeriod(pickDate(r)) && matchProduct(r));
  const changeControl = input.changeControl.filter((r) => inPeriod(pickDate(r)) && matchProduct(r));
  const batches = input.batches.filter((r) => inPeriod(pickDate(r)) && matchProduct(r));
  const equipment = input.equipment.filter((r) => inPeriod(pickDate(r)));
  const stabilityRows = (input.stability || []).filter((r) =>
    inPeriod(String(r.testDate || r.test_date || r.createdAt || r.created_at || '')) && matchProduct(r),
  );
  const stabilityStats = {
    complies: stabilityRows.filter((r) => String(r.status || r.result_status) === 'Complies').length,
    oot: stabilityRows.filter((r) => String(r.status || r.result_status) === 'OOT').length,
    oos: stabilityRows.filter((r) => String(r.status || r.result_status) === 'OOS').length,
  };
  const holdTimeRows = (input.holdTime || []).filter((r) =>
    inPeriod(String(r.startDateTime || r.start_date_time || r.createdAt || r.created_at || '')) && matchProduct(r),
  );
  const holdTimeStats = {
    complies: holdTimeRows.filter((r) => String(r.status || r.complianceStatus) === 'Complies').length,
    alert: holdTimeRows.filter((r) => String(r.status) === 'Alert').length,
    action: holdTimeRows.filter((r) => String(r.status) === 'Action').length,
    exceeded: holdTimeRows.filter((r) => String(r.status) === 'Exceeded').length,
  };

  const cppStats = countCppCqa(cppYear);
  const cqaStats = countCppCqa(cqaYear);
  const allCpv = [...cppYear, ...cqaYear];
  const oot = allCpv.filter((r) => r.status === 'OOT').length;
  const oos = allCpv.filter((r) => r.status === 'OOS').length;

  const grouped = new Map<string, Array<CppRecord | CqaRecord>>();
  allCpv.forEach((record) => {
    const key = `${'parameterName' in record ? 'CPP' : 'CQA'}::${'parameterName' in record ? record.parameterName : record.testParameter}`;
    grouped.set(key, [...(grouped.get(key) || []), record]);
  });

  const capabilityItems: AnnualCpvCapabilityItem[] = Array.from(grouped.entries())
    .map(([key, records]) => {
      const [source, parameter] = key.split('::') as ['CPP' | 'CQA', string];
      const cap = calculateCapability(records.map((r) => r.observedValue), records[0].lsl, records[0].usl);
      return {
        parameter,
        source,
        count: cap.count,
        cpk: cap.cpk,
        ppk: cap.ppk,
        status: cap.status,
      };
    })
    .filter((item) => item.count >= 2);

  const validCaps = capabilityItems.filter((i) => i.status !== 'Insufficient Data');
  const averageCpk = validCaps.length
    ? validCaps.reduce((s, i) => s + i.cpk, 0) / validCaps.length
    : 0;
  const averagePpk = validCaps.length
    ? validCaps.reduce((s, i) => s + i.ppk, 0) / validCaps.length
    : 0;

  const capabilityRows = (input.processCapability || []).filter((r) =>
    inPeriod(String(r.reviewPeriodTo || r.review_period_to || r.reviewDate || r.createdAt || ''))
    && matchProduct(r),
  );
  const validCapsFromRecords = capabilityRows.filter((r) => Number(r.cpk) > 0);
  const capAvgCpk = validCapsFromRecords.length
    ? validCapsFromRecords.reduce((s, r) => s + Number(r.cpk), 0) / validCapsFromRecords.length
    : averageCpk;
  const capAvgPpk = validCapsFromRecords.length
    ? validCapsFromRecords.reduce((s, r) => s + Number(r.ppk || 0), 0) / validCapsFromRecords.length
    : averagePpk;

  const trendAnalysisRows = (input.trendAnalysis || []).filter((r) =>
    inPeriod(String(r.generatedDate || r.generated_date || r.reviewPeriodTo || r.createdAt || ''))
    && matchProduct(r),
  );
  const trendAnalysisStats = {
    alert: trendAnalysisRows.filter((r) => String(r.trendStatus || r.trend_status) === 'Alert').length,
    oot: trendAnalysisRows.filter((r) => String(r.trendStatus || r.trend_status) === 'OOT').length,
    oos: trendAnalysisRows.filter((r) => String(r.trendStatus || r.trend_status) === 'OOS').length,
    capaSuggested: trendAnalysisRows.filter((r) => Boolean(r.capaSuggested || r.capa_suggested)).length,
  };

  const spcRows = (input.spc || []).filter((r) =>
    inPeriod(String(r.generatedDate || r.generated_date || r.reviewPeriodTo || r.createdAt || ''))
    && matchProduct(r),
  );

  const filterMonitoring = (rows: Record<string, unknown>[] = []) =>
    rows.filter((r) => inPeriod(pickDate(r)) && matchProduct(r));

  const rawMaterialRows = filterMonitoring(input.rawMaterial);
  const packingMaterialRows = filterMonitoring(input.packingMaterial);
  const utilityRows = filterMonitoring(input.utility);
  const environmentalRows = filterMonitoring(input.environmental);
  const yieldRows = filterMonitoring(input.yield);

  const yieldValues = yieldRows
    .map((r) => Number(r.yieldPercentage ?? r.yield_percentage ?? r.actualYield ?? 0))
    .filter((n) => Number.isFinite(n) && n > 0);
  const yieldAverage = yieldValues.length
    ? yieldValues.reduce((s, n) => s + n, 0) / yieldValues.length
    : 0;
  const spcStats = {
    outOfControl: spcRows.filter((r) => String(r.spcStatus || r.spc_status) === 'Out Of Control').length,
    warning: spcRows.filter((r) => String(r.spcStatus || r.spc_status) === 'Warning').length,
    violations: spcRows.reduce((s, r) => s + Number(r.ruleViolationsCount ?? r.rule_violations_count ?? 0), 0),
    capaSuggested: spcRows.filter((r) => Boolean(r.capaSuggested || r.capa_suggested)).length,
  };

  const controlViolations = Array.from(grouped.values()).reduce(
    (sum, records) => sum + calculateControlLimits(records.map((r) => r.observedValue)).points.filter((p) => p.outOfControl).length,
    0,
  );

  const riskReport = buildRiskReport(riskYear as unknown as RiskRecord[]);
  const riskLevel = (r: Record<string, unknown>) => String(r.riskLevel || r.risk_level || '');
  const riskStatus = (r: Record<string, unknown>) => String(r.riskStatus || r.risk_status || r.status || '');
  const criticalRisks = riskYear.filter((r) => riskLevel(r) === 'Critical').length;
  const highRisks = riskYear.filter((r) => riskLevel(r) === 'High').length;
  const openRisks = riskYear.filter((r) => !['Closed', 'Accepted'].includes(riskStatus(r))).length;
  const criticalOpenRisks = riskYear.filter((r) =>
    riskLevel(r) === 'Critical' && !['Closed', 'Accepted'].includes(riskStatus(r)),
  ).length;

  const holdBatches = batches.filter((b) => String(b.status || b.batch_status || '').toLowerCase().includes('hold')).length;

  const released = batches.filter((b) => String(b.status || b.batch_status || '').toLowerCase().includes('release')).length;
  const rejected = batches.filter((b) => String(b.status || b.batch_status || '').toLowerCase().includes('reject')).length;

  const cppCompliancePct = cppYear.length ? (cppStats.complies / cppYear.length) * 100 : 100;
  const cqaCompliancePct = cqaYear.length ? (cqaStats.complies / cqaYear.length) * 100 : 100;
  const criticalOosOpen = oosEvents.filter((r) => {
    const s = String(r.status || r.workflow_status || '').toLowerCase();
    const critical = String(r.severity || r.risk_level || r.test_parameter || '').toLowerCase();
    return (s.includes('open') || s.includes('investigation')) && (critical.includes('sterility') || critical.includes('endotoxin') || critical.includes('critical'));
  }).length;
  const sterilityEndotoxinFailure = [...cppYear, ...cqaYear].some((r) => {
    const param = String('parameterName' in r ? r.parameterName : r.testParameter).toLowerCase();
    return (param.includes('sterility') || param.includes('endotoxin')) && r.status === 'OOS';
  }) || stabilityRows.some((r) => {
    const param = String(r.parameterName || r.parameter_name || '').toLowerCase();
    return (param.includes('sterility') || param.includes('endotoxin')) && String(r.status) === 'OOS';
  });

  const metrics = enrichCpvReviewMetrics({
    totalBatchesReviewed: batches.length,
    releasedBatches: released || Math.max(0, batches.length - rejected - holdBatches),
    rejectedBatches: rejected,
    holdBatches,
    cppCompliancePct: Number(cppCompliancePct.toFixed(1)),
    cqaCompliancePct: Number(cqaCompliancePct.toFixed(1)),
    yieldAverage: Number(yieldAverage.toFixed(2)),
    ootCount: oot + trendAnalysisStats.oot,
    oosCount: oos + oosEvents.length,
    deviationCount: deviations.length,
    capaCount: capa.length,
    changeControlCount: changeControl.length,
    openRiskCount: openRisks,
    highRiskCount: highRisks,
    criticalOpenRiskCount: criticalOpenRisks,
    criticalOosOpen,
    repeatedOot: (oot + trendAnalysisStats.oot) >= 3,
    repeatedDeviation: deviations.length >= 5,
    sterilityEndotoxinFailure,
    averageCp: Number((capAvgCpk * 0.98).toFixed(3)),
    averageCpk: Number(capAvgCpk.toFixed(3)),
    averagePp: Number((capAvgPpk * 0.98).toFixed(3)),
    averagePpk: Number(capAvgPpk.toFixed(3)),
  });

  const assessment = computeOverallAssessment(metrics);

  const equipmentQualified = equipment.filter((e) =>
    String(e.status || e.qualification_status || '').toLowerCase().includes('qual'),
  ).length;

  const stable = assessment.overallProcessStatus === 'In Control';

  const periodLabel = input.reviewPeriodFrom && input.reviewPeriodTo
    ? `${input.reviewPeriodFrom} to ${input.reviewPeriodTo}`
    : `calendar year ${input.year}`;

  const executiveSummary = `Annual Continued Process Verification review for ${periodLabel}. `
    + `${cppYear.length} CPP and ${cqaYear.length} CQA observations were evaluated. `
    + `Quality system integration captured ${deviations.length} deviation(s), ${oosEvents.length} OOS investigation(s), `
    + `${capa.length} CAPA record(s), and ${changeControl.length} change control record(s). `
    + `${batches.length} batch record(s) and ${equipment.length} equipment qualification record(s) were reviewed. `
    + `${stabilityRows.length} stability result(s) were evaluated. `
    + `${holdTimeRows.length} hold time record(s) were reviewed. `
    + `${capabilityRows.length} formal process capability review(s) were completed. `
    + `${trendAnalysisRows.length} trend analysis record(s) were generated. `
    + `${spcRows.length} statistical process control chart(s) were reviewed. `
    + `${rawMaterialRows.length} raw material, ${packingMaterialRows.length} packing material, ${utilityRows.length} utility, `
    + `${environmentalRows.length} environmental, and ${yieldRows.length} yield monitoring record(s) were reviewed. `
    + `Overall process status: ${assessment.overallProcessStatus}. Overall risk level: ${assessment.overallRiskLevel}. `
    + `Process capability average Cpk was ${capAvgCpk.toFixed(2)} with ${controlViolations} control-chart special-cause signal(s).`;

  const conclusion = stable
    ? 'Based on the aggregated CPP, CQA, capability, trend, risk, and quality system data, the manufacturing process remains in a state of statistical control and continued process verification supports ongoing commercial manufacturing under the approved control strategy.'
    : 'The annual CPV review identifies signals requiring enhanced monitoring, investigation, or corrective action. OOS events, elevated risk assessments, capability concerns, or control-chart violations should be formally linked to deviation, OOS, and CAPA workflows.';

  const recommendations = stable
    ? 'Continue routine CPP and CQA monitoring per the approved CPV plan. Maintain batch-wise data collection, capability assessment, and annual CPV review. No immediate change to the control strategy is recommended.'
    : 'Implement targeted CAPA for identified OOS/OOT trends. Review control limits and sampling plans. Escalate high/critical CPV risk assessments. Update validation or requalification commitments where equipment or process drift is evident.';

  return {
    reviewYear: input.year,
    generatedAt: new Date().toISOString(),
    productFilter,
    cpp: {
      total: cppYear.length,
      ...cppStats,
      summary: `CPP monitoring: ${cppStats.complies} pass, ${cppStats.oot} OOT, ${cppStats.oos} OOS from ${cppYear.length} observations.`,
      records: cppYear.slice(0, 20) as unknown as Record<string, unknown>[],
    },
    cqa: {
      total: cqaYear.length,
      ...cqaStats,
      summary: `CQA monitoring: ${cqaStats.complies} pass, ${cqaStats.oot} OOT, ${cqaStats.oos} OOS from ${cqaYear.length} results.`,
      records: cqaYear.slice(0, 20) as unknown as Record<string, unknown>[],
    },
    capability: {
      averageCpk: Number(averageCpk.toFixed(3)),
      averagePpk: Number(averagePpk.toFixed(3)),
      items: capabilityItems,
      controlViolations,
      summary: validCaps.length
        ? `Capability assessed for ${validCaps.length} parameter(s). Average Cpk ${averageCpk.toFixed(2)}, average Ppk ${averagePpk.toFixed(2)}.`
        : 'Insufficient repeated parameter data for formal capability assessment.',
    },
    trend: {
      oot,
      oos,
      totalObservations: allCpv.length,
      trendRecords: trendAnalysisRows.length,
      summary: trendAnalysisRows.length
        ? `Trend review of ${allCpv.length} CPP/CQA observations and ${trendAnalysisRows.length} formal trend analysis record(s) identified ${oot + trendAnalysisStats.oot} OOT and ${oos + trendAnalysisStats.oos} OOS signals.`
        : `Trend review of ${allCpv.length} CPP/CQA observations identified ${oot} OOT and ${oos} OOS results.`,
    },
    trendAnalysis: {
      total: trendAnalysisRows.length,
      alert: trendAnalysisStats.alert,
      oot: trendAnalysisStats.oot,
      oos: trendAnalysisStats.oos,
      capaSuggested: trendAnalysisStats.capaSuggested,
      summary: trendAnalysisRows.length
        ? `${trendAnalysisRows.length} trend analysis record(s): ${trendAnalysisStats.alert} alert, ${trendAnalysisStats.oot} OOT, ${trendAnalysisStats.oos} OOS; ${trendAnalysisStats.capaSuggested} CAPA suggested.`
        : 'No formal trend analysis records for the review period.',
      records: trendAnalysisRows.slice(0, 15),
    },
    spc: {
      total: spcRows.length,
      outOfControl: spcStats.outOfControl,
      oot: spcStats.warning,
      oos: spcStats.outOfControl,
      violations: spcStats.violations,
      capaSuggested: spcStats.capaSuggested,
      summary: spcRows.length
        ? `${spcRows.length} SPC record(s): ${spcStats.outOfControl} out of control, ${spcStats.violations} rule violations; ${spcStats.capaSuggested} CAPA suggested.`
        : 'No formal SPC control chart records for the review period.',
      records: spcRows.slice(0, 15),
    },
    risk: {
      total: riskYear.length,
      critical: criticalRisks,
      high: highRisks,
      medium: riskReport.byLevel.Medium,
      low: riskReport.byLevel.Low,
      summary: `${riskYear.length} CPV risk assessment(s) reviewed; ${criticalRisks} critical and ${highRisks} high risk rating(s).`,
    },
    deviations: {
      total: deviations.length,
      open: countOpen(deviations),
      summary: `${deviations.length} deviation(s) within review period; ${countOpen(deviations)} open.`,
      records: deviations.slice(0, 15),
    },
    oos: {
      total: oosEvents.length,
      open: countOpen(oosEvents),
      summary: `${oosEvents.length} OOS investigation(s); ${countOpen(oosEvents)} open.`,
      records: oosEvents.slice(0, 15),
    },
    capa: {
      total: capa.length,
      open: countOpen(capa),
      summary: `${capa.length} CAPA record(s); ${countOpen(capa)} open.`,
      records: capa.slice(0, 15),
    },
    changeControl: {
      total: changeControl.length,
      open: countOpen(changeControl),
      summary: `${changeControl.length} change control record(s) reviewed.`,
      records: changeControl.slice(0, 15),
    },
    batches: {
      total: batches.length,
      manufactured: batches.length,
      released: released || Math.max(0, batches.length - rejected),
      rejected,
      records: batches.slice(0, 20),
      summary: `${batches.length} batch(es) in scope; ${released || 0} released, ${rejected} rejected.`,
    },
    equipment: {
      total: equipment.length,
      open: equipment.length - equipmentQualified,
      summary: equipment.length
        ? `${equipmentQualified} of ${equipment.length} equipment record(s) within qualified/calibrated status.`
        : 'Equipment qualification data reviewed; maintain calibration and requalification per schedule.',
      records: equipment.slice(0, 15),
    },
    stability: {
      total: stabilityRows.length,
      ...stabilityStats,
      summary: stabilityRows.length
        ? `Stability monitoring: ${stabilityStats.complies} compliant, ${stabilityStats.oot} OOT, ${stabilityStats.oos} OOS from ${stabilityRows.length} result(s).`
        : 'No stability results recorded for the review period.',
      records: stabilityRows.slice(0, 15),
    },
    holdTime: {
      total: holdTimeRows.length,
      complies: holdTimeStats.complies,
      oot: holdTimeStats.alert,
      oos: holdTimeStats.exceeded,
      summary: holdTimeRows.length
        ? `Hold time monitoring: ${holdTimeStats.complies} compliant, ${holdTimeStats.alert} alert, ${holdTimeStats.action} action, ${holdTimeStats.exceeded} exceeded.`
        : 'No hold time records for the review period.',
      records: holdTimeRows.slice(0, 15),
    },
    processCapability: {
      total: capabilityRows.length,
      summary: capabilityRows.length
        ? `${capabilityRows.length} capability review(s); average Cpk ${capAvgCpk.toFixed(2)}, average Ppk ${capAvgPpk.toFixed(2)}.`
        : validCaps.length
          ? `Capability assessed for ${validCaps.length} parameter(s). Average Cpk ${averageCpk.toFixed(2)}, average Ppk ${averagePpk.toFixed(2)}.`
          : 'Insufficient repeated parameter data for formal capability assessment.',
      records: capabilityRows.slice(0, 15),
      averageCpk: Number(capAvgCpk.toFixed(3)),
      averagePpk: Number(capAvgPpk.toFixed(3)),
    },
    rawMaterial: {
      total: rawMaterialRows.length,
      summary: rawMaterialRows.length
        ? `${rawMaterialRows.length} raw material monitoring record(s) reviewed for the review period.`
        : 'No raw material monitoring records for the review period.',
      records: rawMaterialRows.slice(0, 15),
    },
    packingMaterial: {
      total: packingMaterialRows.length,
      summary: packingMaterialRows.length
        ? `${packingMaterialRows.length} packing material monitoring record(s) reviewed.`
        : 'No packing material monitoring records for the review period.',
      records: packingMaterialRows.slice(0, 15),
    },
    utility: {
      total: utilityRows.length,
      oot: utilityRows.filter((r) => String(r.status) === 'OOT' || String(r.complianceStatus) === 'Excursion').length,
      summary: utilityRows.length
        ? `${utilityRows.length} utility monitoring record(s) reviewed.`
        : 'No utility monitoring records for the review period.',
      records: utilityRows.slice(0, 15),
    },
    environmental: {
      total: environmentalRows.length,
      oot: environmentalRows.filter((r) => String(r.status) === 'OOT' || String(r.complianceStatus) === 'Excursion').length,
      summary: environmentalRows.length
        ? `${environmentalRows.length} environmental monitoring record(s) reviewed.`
        : 'No environmental monitoring records for the review period.',
      records: environmentalRows.slice(0, 15),
    },
    yield: {
      total: yieldRows.length,
      averageYield: Number(yieldAverage.toFixed(2)),
      summary: yieldRows.length
        ? `${yieldRows.length} yield record(s); average yield ${yieldAverage.toFixed(1)}%.`
        : 'No yield monitoring records for the review period.',
      records: yieldRows.slice(0, 15),
    },
    metrics,
    overallProcessStatus: assessment.overallProcessStatus,
    overallRiskLevel: assessment.overallRiskLevel,
    executiveSummary,
    conclusion,
    recommendations,
  };
}

export function generateAnnualCpvNumber(year: number, existingCount: number): string {
  return `CPV/${year}/${String(existingCount + 1).padStart(4, '0')}`;
}
