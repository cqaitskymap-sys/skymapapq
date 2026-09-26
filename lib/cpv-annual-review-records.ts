import { z } from 'zod';

export const CPV_REVIEW_COLLECTION = 'cpv_reviews';
export const CPV_REVIEW_SECTIONS_COLLECTION = 'cpv_review_sections';
export const CPV_REVIEW_APPROVALS_COLLECTION = 'cpv_review_approvals';
export const CPV_REVIEW_LEGACY = ['cpv_annual_review'] as const;
export const CPV_REVIEW_MODULE = 'Annual CPV Review';

export const CPV_REVIEW_STATUSES = [
  'Draft',
  'Data Collection',
  'Generated',
  'Under Review',
  'Approved',
  'Rejected',
  'Archived',
] as const;

export const OVERALL_PROCESS_STATUSES = [
  'In Control',
  'Under Control With Monitoring',
  'Needs Improvement',
  'Not In Control',
] as const;

export const OVERALL_RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;

export const REPORT_SECTION_KEYS = [
  'executiveSummary',
  'productBatchSummary',
  'cppReview',
  'cqaReview',
  'rawMaterialReview',
  'packingMaterialReview',
  'utilityReview',
  'environmentalReview',
  'yieldReview',
  'stabilityReview',
  'holdTimeReview',
  'processCapabilityReview',
  'trendAnalysisReview',
  'spcReview',
  'riskAssessmentSummary',
  'deviationReview',
  'oosReview',
  'capaReview',
  'changeControlReview',
  'recommendations',
  'finalConclusion',
  'approvalPage',
] as const;

export const REPORT_SECTION_LABELS: Record<(typeof REPORT_SECTION_KEYS)[number], string> = {
  executiveSummary: '1. Executive Summary',
  productBatchSummary: '2. Product and Batch Summary',
  cppReview: '3. CPP Review',
  cqaReview: '4. CQA Review',
  rawMaterialReview: '5. Raw Material Review',
  packingMaterialReview: '6. Packing Material Review',
  utilityReview: '7. Utility Review',
  environmentalReview: '8. Environmental Review',
  yieldReview: '9. Yield Review',
  stabilityReview: '10. Stability Review',
  holdTimeReview: '11. Hold Time Review',
  processCapabilityReview: '12. Process Capability Review',
  trendAnalysisReview: '13. Trend Analysis Review',
  spcReview: '14. Statistical Process Control Review',
  riskAssessmentSummary: '15. Risk Assessment Summary',
  deviationReview: '16. Deviation Review',
  oosReview: '17. OOS Review',
  capaReview: '18. CAPA Review',
  changeControlReview: '19. Change Control Review',
  recommendations: '20. Recommendations',
  finalConclusion: '21. Final Conclusion',
  approvalPage: '22. Approval Page',
};

export type CpvReviewStatus = (typeof CPV_REVIEW_STATUSES)[number];
export type OverallProcessStatus = (typeof OVERALL_PROCESS_STATUSES)[number];
export type OverallRiskLevel = (typeof OVERALL_RISK_LEVELS)[number];

export interface CpvReviewMetrics {
  totalBatchesReviewed: number;
  releasedBatches: number;
  rejectedBatches: number;
  holdBatches: number;
  batchAcceptanceRate: number;
  cppCompliancePct: number;
  cqaCompliancePct: number;
  yieldAverage: number;
  ootCount: number;
  oosCount: number;
  deviationCount: number;
  capaCount: number;
  changeControlCount: number;
  openRiskCount: number;
  highRiskCount: number;
  criticalOpenRiskCount: number;
  criticalOosOpen: number;
  repeatedOot: boolean;
  repeatedDeviation: boolean;
  sterilityEndotoxinFailure: boolean;
  averageCp: number;
  averageCpk: number;
  averagePp: number;
  averagePpk: number;
  sigmaLevel: number;
  overallCompliancePct: number;
  calibrationCompliancePct: number;
  trainingCompliancePct: number;
  maintenanceEffectivenessPct: number;
  supplierPerformancePct: number;
  complaintRate: number;
  capaEffectivenessPct: number;
}

export interface CpvReviewAiInsights {
  processHealthScore: number;
  productHealthScore: number;
  complianceScore: number;
  confidenceScore: number;
  riskScore: number;
  aiExecutiveSummary: string;
  aiQualityReview: string;
  aiRiskPrediction: string;
  aiPreventiveRecommendations: string;
  capabilityReductionDetected: boolean;
  negativeTrendDetected: boolean;
  escalationRequired: boolean;
}

export interface CpvReviewSectionRecord {
  id?: string;
  cpvReviewId: string;
  sectionKey: (typeof REPORT_SECTION_KEYS)[number];
  sectionTitle: string;
  content: string;
  summary: string;
  data?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface CpvReviewApprovalRecord {
  id?: string;
  cpvReviewId: string;
  role: 'prepared' | 'reviewed' | 'approved';
  designation: string;
  name: string;
  signatureText: string;
  meaning: string;
  reason: string;
  signedAt: string | null;
  userId?: string;
  status: string;
}

export interface CpvAnnualReviewRecord extends Record<string, unknown> {
  id: string;
  cpvReviewId: string;
  cpvReviewNumber: string;
  cpvProductId: string;
  productName: string;
  productCode: string;
  productFamily: string;
  productVersion: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  site: string;
  plant: string;
  department: string;
  batchRange: string;
  manufacturingCampaign: string;
  reviewPeriodFrom: string;
  reviewPeriodTo: string;
  reviewYear: number;
  reviewOwner: string;
  effectiveDate: string;
  approvalDate: string;
  nextReviewDate: string;
  version: string;
  description: string;
  changeReason: string;
  totalBatchesReviewed: number;
  totalCppParametersReviewed: number;
  totalCqaParametersReviewed: number;
  totalDeviations: number;
  totalOos: number;
  totalCapa: number;
  totalChangeControls: number;
  averageCpk: number;
  averagePpk: number;
  overallProcessStatus: OverallProcessStatus;
  overallRiskLevel: OverallRiskLevel;
  processHealthScore: number;
  productHealthScore: number;
  complianceScore: number;
  confidenceScore: number;
  riskScore: number;
  aiInsights: CpvReviewAiInsights;
  executiveSummary: string;
  conclusion: string;
  recommendations: string;
  preparedBy: string;
  reviewedBy: string;
  approvedBy: string;
  reviewStatus: CpvReviewStatus;
  isLocked: boolean;
  metrics: CpvReviewMetrics;
  snapshot: Record<string, unknown>;
  sections: CpvReviewSectionRecord[];
  signatures: CpvReviewApprovalRecord[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
}

export interface CpvReviewListSummary {
  total: number;
  draft: number;
  underReview: number;
  approved: number;
  rejected: number;
  due: number;
  highRisk: number;
  averageHealthScore: number;
}

const requiredText = z.string().trim().min(1, 'Required');

export const cpvReviewFormSchema = z.object({
  cpvProductId: requiredText,
  productName: requiredText,
  productCode: z.string().trim().optional().default(''),
  productFamily: z.string().trim().optional().default(''),
  productVersion: z.string().trim().optional().default(''),
  genericName: z.string().trim().optional().default(''),
  strength: z.string().trim().optional().default(''),
  dosageForm: z.string().trim().optional().default(''),
  site: z.string().trim().optional().default(''),
  plant: z.string().trim().optional().default(''),
  department: z.string().trim().optional().default(''),
  batchRange: z.string().trim().optional().default(''),
  manufacturingCampaign: z.string().trim().optional().default(''),
  reviewPeriodFrom: requiredText,
  reviewPeriodTo: requiredText,
  reviewOwner: z.string().trim().optional().default(''),
  effectiveDate: z.string().trim().optional().default(''),
  nextReviewDate: z.string().trim().optional().default(''),
  version: z.string().trim().optional().default('1.0'),
  description: z.string().trim().optional().default(''),
  executiveSummary: z.string().trim().optional().default(''),
  conclusion: z.string().trim().optional().default(''),
  recommendations: z.string().trim().optional().default(''),
  changeReason: z.string().trim().min(5, 'Change reason must be at least 5 characters'),
}).refine((d) => new Date(d.reviewPeriodTo) >= new Date(d.reviewPeriodFrom), {
  message: 'Review period end must be on or after start date',
  path: ['reviewPeriodTo'],
});

export type CpvReviewFormData = z.infer<typeof cpvReviewFormSchema>;

export function buildCpvReviewId(productCode: string): string {
  const code = (productCode || 'ALL').replace(/\s+/g, '-').toUpperCase();
  return `CPV-REV-${code}-${Date.now()}`;
}

export function generateCpvReviewNumber(year: number, existingCount: number): string {
  return `CPV/${year}/${String(existingCount + 1).padStart(4, '0')}`;
}

export function reviewStatusLabel(status: string): string {
  const legacy: Record<string, string> = {
    draft: 'Draft',
    under_review: 'Under Review',
    approved: 'Approved',
    archived: 'Archived',
  };
  return legacy[status] || status;
}

export function enrichCpvReviewMetrics(partial: Partial<CpvReviewMetrics>): CpvReviewMetrics {
  const totalBatches = Number(partial.totalBatchesReviewed || 0);
  const released = Number(partial.releasedBatches || 0);
  const rejected = Number(partial.rejectedBatches || 0);
  const hold = Number(partial.holdBatches || 0);
  const batchAcceptanceRate = totalBatches > 0
    ? Math.round((released / totalBatches) * 1000) / 10
    : Number(partial.batchAcceptanceRate || 0);
  const cpp = Number(partial.cppCompliancePct ?? 100);
  const cqa = Number(partial.cqaCompliancePct ?? 100);
  const averageCpk = Number(partial.averageCpk || 0);
  const averagePpk = Number(partial.averagePpk || 0);
  const averageCp = Number(partial.averageCp || averageCpk);
  const averagePp = Number(partial.averagePp || averagePpk);
  const sigmaLevel = averageCpk > 0
    ? Math.round(Math.min(6, Math.max(0, averageCpk * 3)) * 100) / 100
    : Number(partial.sigmaLevel || 0);
  const overallCompliancePct = Math.round(((cpp + cqa) / 2) * 10) / 10;

  return {
    totalBatchesReviewed: totalBatches,
    releasedBatches: released,
    rejectedBatches: rejected,
    holdBatches: hold,
    batchAcceptanceRate,
    cppCompliancePct: cpp,
    cqaCompliancePct: cqa,
    yieldAverage: Number(partial.yieldAverage || 0),
    ootCount: Number(partial.ootCount || 0),
    oosCount: Number(partial.oosCount || 0),
    deviationCount: Number(partial.deviationCount || 0),
    capaCount: Number(partial.capaCount || 0),
    changeControlCount: Number(partial.changeControlCount || 0),
    openRiskCount: Number(partial.openRiskCount || 0),
    highRiskCount: Number(partial.highRiskCount || 0),
    criticalOpenRiskCount: Number(partial.criticalOpenRiskCount || 0),
    criticalOosOpen: Number(partial.criticalOosOpen || 0),
    repeatedOot: Boolean(partial.repeatedOot),
    repeatedDeviation: Boolean(partial.repeatedDeviation),
    sterilityEndotoxinFailure: Boolean(partial.sterilityEndotoxinFailure),
    averageCp,
    averageCpk,
    averagePp,
    averagePpk,
    sigmaLevel,
    overallCompliancePct,
    calibrationCompliancePct: Number(partial.calibrationCompliancePct ?? 100),
    trainingCompliancePct: Number(partial.trainingCompliancePct ?? 100),
    maintenanceEffectivenessPct: Number(partial.maintenanceEffectivenessPct ?? 100),
    supplierPerformancePct: Number(partial.supplierPerformancePct ?? 100),
    complaintRate: Number(partial.complaintRate || 0),
    capaEffectivenessPct: Number(partial.capaEffectivenessPct ?? 100),
  };
}

export function computeOverallAssessment(metrics: CpvReviewMetrics): {
  overallProcessStatus: OverallProcessStatus;
  overallRiskLevel: OverallRiskLevel;
} {
  if (metrics.criticalOosOpen || metrics.criticalOpenRiskCount > 0 || metrics.sterilityEndotoxinFailure) {
    return { overallProcessStatus: 'Not In Control', overallRiskLevel: 'Critical' };
  }
  if (metrics.averageCpk < 1.33 || metrics.repeatedOot || metrics.highRiskCount > 0 || metrics.repeatedDeviation) {
    return {
      overallProcessStatus: 'Needs Improvement',
      overallRiskLevel: metrics.highRiskCount > 0 || metrics.repeatedDeviation ? 'High' : 'Medium',
    };
  }
  if (
    metrics.cppCompliancePct >= 95
    && metrics.cqaCompliancePct >= 95
    && metrics.criticalOpenRiskCount === 0
    && metrics.averageCpk >= 1.33
    && !metrics.criticalOosOpen
  ) {
    return { overallProcessStatus: 'In Control', overallRiskLevel: 'Low' };
  }
  return { overallProcessStatus: 'Under Control With Monitoring', overallRiskLevel: 'Medium' };
}

export function computeProcessHealthScore(metrics: CpvReviewMetrics): number {
  let score = 100;
  if (metrics.cppCompliancePct < 95) score -= 10;
  if (metrics.cqaCompliancePct < 95) score -= 10;
  if (metrics.averageCpk < 1.33) score -= 15;
  if (metrics.averageCpk > 0 && metrics.averageCpk < 1.0) score -= 10;
  if (metrics.oosCount > 0) score -= Math.min(20, metrics.oosCount * 5);
  if (metrics.ootCount > 3) score -= 8;
  if (metrics.openRiskCount > 0) score -= 5;
  if (metrics.highRiskCount > 0) score -= 10;
  if (metrics.criticalOpenRiskCount > 0) score -= 25;
  if (metrics.batchAcceptanceRate > 0 && metrics.batchAcceptanceRate < 95) score -= 8;
  if (metrics.calibrationCompliancePct < 95) score -= 5;
  if (metrics.trainingCompliancePct < 95) score -= 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function computeAiInsights(
  metrics: CpvReviewMetrics,
  assessment: { overallProcessStatus: OverallProcessStatus; overallRiskLevel: OverallRiskLevel },
): CpvReviewAiInsights {
  const processHealthScore = computeProcessHealthScore(metrics);
  const complianceScore = Math.round(metrics.overallCompliancePct);
  const productHealthScore = Math.max(
    0,
    Math.min(100, Math.round((processHealthScore + complianceScore + Math.min(100, metrics.batchAcceptanceRate || 100)) / 3)),
  );
  let riskScore = 20;
  if (assessment.overallRiskLevel === 'Critical') riskScore = 95;
  else if (assessment.overallRiskLevel === 'High') riskScore = 75;
  else if (assessment.overallRiskLevel === 'Medium') riskScore = 45;
  else riskScore = 15;
  if (metrics.oosCount > 2) riskScore = Math.min(100, riskScore + 10);
  if (metrics.repeatedDeviation) riskScore = Math.min(100, riskScore + 8);

  const capabilityReductionDetected = metrics.averageCpk > 0 && metrics.averageCpk < 1.33;
  const negativeTrendDetected = metrics.repeatedOot || metrics.oosCount > 0 || metrics.deviationCount > 5;
  const escalationRequired = assessment.overallRiskLevel === 'Critical'
    || assessment.overallProcessStatus === 'Not In Control'
    || metrics.criticalOpenRiskCount > 0;

  const confidenceScore = Math.max(
    45,
    Math.min(
      99,
      55
      + (metrics.totalBatchesReviewed >= 10 ? 15 : metrics.totalBatchesReviewed >= 3 ? 8 : 0)
      + (metrics.averageCpk > 0 ? 10 : 0)
      + (metrics.cppCompliancePct > 0 ? 5 : 0),
    ),
  );

  const aiExecutiveSummary = [
    `Annual process health ${processHealthScore}% (${assessment.overallProcessStatus}).`,
    `CPP/CQA compliance ${metrics.cppCompliancePct.toFixed(1)}% / ${metrics.cqaCompliancePct.toFixed(1)}%.`,
    metrics.averageCpk > 0 ? `Mean Cpk ${metrics.averageCpk.toFixed(2)} (σ≈${metrics.sigmaLevel.toFixed(1)}).` : 'Capability data limited.',
    `Risk posture: ${assessment.overallRiskLevel}.`,
  ].join(' ');

  const aiQualityReview = [
    `Batch acceptance ${metrics.batchAcceptanceRate || 0}%; OOS ${metrics.oosCount}; OOT ${metrics.ootCount}; deviations ${metrics.deviationCount}; CAPA ${metrics.capaCount}.`,
    metrics.yieldAverage > 0 ? `Average yield ${metrics.yieldAverage.toFixed(1)}%.` : '',
  ].filter(Boolean).join(' ');

  const aiRiskPrediction = escalationRequired
    ? 'Elevated residual risk — escalate to management review and consider CAPA/change control.'
    : capabilityReductionDetected
      ? 'Capability trending below target — intensify CPP/CQA monitoring and trend review.'
      : 'Residual risk within acceptance for continued Stage 3 CPV monitoring.';

  const tips: string[] = [];
  if (capabilityReductionDetected) tips.push('Investigate capability reduction and verify control strategy.');
  if (metrics.oosCount > 0) tips.push('Link OOS events to deviation/CAPA effectiveness checks.');
  if (metrics.repeatedDeviation) tips.push('Repeated deviations detected — initiate risk assessment.');
  if (metrics.calibrationCompliancePct < 95) tips.push('Close calibration compliance gaps.');
  if (metrics.trainingCompliancePct < 95) tips.push('Address training compliance gaps before next campaign.');
  if (!tips.length) tips.push('Continue approved CPV plan; schedule next annual review.');

  return {
    processHealthScore,
    productHealthScore,
    complianceScore,
    confidenceScore,
    riskScore,
    aiExecutiveSummary,
    aiQualityReview,
    aiRiskPrediction,
    aiPreventiveRecommendations: tips.join(' '),
    capabilityReductionDetected,
    negativeTrendDetected,
    escalationRequired,
  };
}

export function summarizeCpvReviews(records: CpvAnnualReviewRecord[]): CpvReviewListSummary {
  const active = records.filter((r) => !r.isDeleted);
  const now = new Date();
  return {
    total: active.length,
    draft: active.filter((r) => ['Draft', 'Data Collection', 'Generated'].includes(r.reviewStatus)).length,
    underReview: active.filter((r) => r.reviewStatus === 'Under Review').length,
    approved: active.filter((r) => r.reviewStatus === 'Approved').length,
    rejected: active.filter((r) => r.reviewStatus === 'Rejected').length,
    due: active.filter((r) => {
      if (['Approved', 'Archived', 'Rejected'].includes(r.reviewStatus)) return false;
      const to = new Date(r.reviewPeriodTo);
      return !Number.isNaN(to.getTime()) && to < now;
    }).length,
    highRisk: active.filter((r) => ['High', 'Critical'].includes(r.overallRiskLevel)).length,
    averageHealthScore: active.length
      ? Math.round(active.reduce((s, r) => s + (r.processHealthScore || computeProcessHealthScore(r.metrics)), 0) / active.length)
      : 0,
  };
}

export function buildCpvReviewCharts(snapshot: Record<string, unknown>) {
  const cpp = snapshot.cpp as { total?: number; complies?: number; oot?: number; oos?: number } | undefined;
  const cqa = snapshot.cqa as { total?: number; complies?: number; oot?: number; oos?: number } | undefined;
  const risk = snapshot.risk as { critical?: number; high?: number; medium?: number; low?: number } | undefined;
  const metrics = snapshot.metrics as CpvReviewMetrics | undefined;

  return {
    cppCompliance: [
      { name: 'Pass', value: cpp?.complies ?? 0 },
      { name: 'OOT', value: cpp?.oot ?? 0 },
      { name: 'OOS', value: cpp?.oos ?? 0 },
    ],
    cqaCompliance: [
      { name: 'Pass', value: cqa?.complies ?? 0 },
      { name: 'OOT', value: cqa?.oot ?? 0 },
      { name: 'OOS', value: cqa?.oos ?? 0 },
    ],
    riskDistribution: [
      { name: 'Critical', value: risk?.critical ?? 0 },
      { name: 'High', value: risk?.high ?? 0 },
      { name: 'Medium', value: risk?.medium ?? 0 },
      { name: 'Low', value: risk?.low ?? 0 },
    ],
    deviationTrend: [{ name: 'Deviations', value: metrics?.deviationCount ?? 0 }],
    oosTrend: [{ name: 'OOS', value: metrics?.oosCount ?? 0 }],
    capaTrend: [{ name: 'CAPA', value: metrics?.capaCount ?? 0 }],
    cpkTrend: [{ name: 'Avg Cpk', value: Number((metrics?.averageCpk ?? 0).toFixed(2)) }],
    yieldTrend: [{ name: 'Yield Avg %', value: Number((metrics?.yieldAverage ?? 0).toFixed(1)) }],
  };
}

export function riskLevelColor(level: string): string {
  if (level === 'Critical') return '#991b1b';
  if (level === 'High') return '#dc2626';
  if (level === 'Medium') return '#d97706';
  return '#059669';
}

export function processStatusColor(status: string): 'green' | 'amber' | 'red' | 'blue' {
  if (status === 'In Control') return 'green';
  if (status === 'Not In Control') return 'red';
  if (status === 'Needs Improvement') return 'amber';
  return 'blue';
}
