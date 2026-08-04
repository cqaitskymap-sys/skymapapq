import { z } from 'zod';
import { displayCpvStatus } from '@/lib/cpv';

export const CPV_REPORTS_COLLECTION = 'reports';
export const CPV_REPORT_EXPORTS_COLLECTION = 'report_exports';
export const CPV_REPORTS_MODULE = 'CPV Reports & Analytics';

export const REPORT_STATUSES = ['Draft', 'Generated', 'Exported', 'Archived', 'Failed'] as const;
export const EXPORT_TYPES = ['PDF', 'Excel', 'CSV', 'Print'] as const;

export const CPV_REPORT_TYPES = [
  'CPV Dashboard Summary Report',
  'Product-wise CPV Report',
  'Batch-wise CPV Report',
  'CPP Monitoring Report',
  'CQA Monitoring Report',
  'Raw Material Monitoring Report',
  'Packing Material Monitoring Report',
  'Utility Monitoring Report',
  'Environmental Monitoring Report',
  'Yield Monitoring Report',
  'Stability Monitoring Report',
  'Hold Time Monitoring Report',
  'Process Capability Report',
  'Trend Analysis Report',
  'Statistical Process Control Report',
  'Risk Assessment Report',
  'Annual CPV Review Report',
  'OOT/OOS Summary Report',
  'CAPA Linked CPV Report',
  'Deviation Linked CPV Report',
  'Change Control Report',
  'Training Compliance Report',
  'Calibration Compliance Report',
  'Maintenance Compliance Report',
  'Supplier Performance Report',
  'Complaint Analysis Report',
  'AI Insights Report',
  'Compliance Scorecard Report',
  'Management Review Report',
  'Executive Summary Report',
] as const;

export type CpvReportType = (typeof CPV_REPORT_TYPES)[number];
export type CpvReportStatus = (typeof REPORT_STATUSES)[number];
export type CpvExportType = (typeof EXPORT_TYPES)[number];

export interface CpvReportFilters {
  productName?: string;
  productCode?: string;
  batchNumber?: string;
  reviewPeriodFrom: string;
  reviewPeriodTo: string;
  reportType: CpvReportType;
}

export interface CpvReportMetrics {
  totalBatches: number;
  releasedBatches: number;
  rejectedBatches: number;
  batchAcceptanceRate: number;
  batchRejectionRate: number;
  cppCompliancePct: number;
  cqaCompliancePct: number;
  ootCount: number;
  oosCount: number;
  deviationCount: number;
  capaCount: number;
  changeControlCount: number;
  averageCp: number;
  averageCpk: number;
  averagePp: number;
  averagePpk: number;
  sigmaLevel: number;
  averageYield: number;
  openRiskCount: number;
  highRiskCount: number;
  criticalRiskCount: number;
  riskScore: number;
  cpvCompliancePct: number;
  environmentalCompliancePct: number;
  utilityCompliancePct: number;
  stabilityCompliancePct: number;
  spcCompliancePct: number;
  trainingCompliancePct: number;
  calibrationCompliancePct: number;
  maintenanceCompliancePct: number;
  supplierPerformancePct: number;
  capaEffectivenessPct: number;
  dataIntegrityScore: number;
  healthScore: number;
  healthLabel: string;
  productHealthScore: number;
  plantHealthScore: number;
  complianceScore: number;
  confidenceScore: number;
  totalRecords: number;
  negativeTrendDetected: boolean;
  capabilityReductionDetected: boolean;
  escalationRequired: boolean;
}

export interface CpvReportAiInsights {
  aiExecutiveSummary: string;
  aiDailyInsights: string;
  aiTrendPrediction: string;
  aiRiskPrediction: string;
  aiPreventiveRecommendations: string;
  aiConfidenceScore: number;
}

export interface CpvReportRecord extends Record<string, unknown> {
  id: string;
  reportId: string;
  reportNumber: string;
  reportType: CpvReportType;
  productName: string;
  productCode: string;
  batchNumber: string;
  site: string;
  department: string;
  reviewPeriodFrom: string;
  reviewPeriodTo: string;
  generatedBy: string;
  generatedDate: string;
  reportStatus: CpvReportStatus;
  exportType: CpvExportType | '';
  fileUrl: string;
  fileName: string;
  filtersApplied: CpvReportFilters;
  totalRecords: number;
  metrics: CpvReportMetrics;
  aiInsights: CpvReportAiInsights;
  previewRows: Record<string, unknown>[];
  charts: Record<string, unknown>;
  remarks: string;
  changeReason: string;
  version: string;
  isLocked: boolean;
  approvedBy: string;
  approvalDate: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
}

export interface CpvReportExportRecord extends Record<string, unknown> {
  id?: string;
  reportId: string;
  reportNumber: string;
  exportType: CpvExportType;
  fileUrl: string;
  fileName: string;
  exportedBy: string;
  exportedAt: string;
  createdAt?: string;
  createdBy?: string;
  isDeleted?: boolean;
}

export interface CpvReportsAnalyticsSummary {
  totalReports: number;
  reportsThisMonth: number;
  failedReports: number;
  pdfExports: number;
  excelExports: number;
  highRiskProducts: number;
  oosCount: number;
  ootCount: number;
  averageCpk: number;
  cpvCompliancePct: number;
}

const requiredText = z.string().trim().min(1, 'Required');

export const cpvReportFormSchema = z.object({
  reportType: z.enum(CPV_REPORT_TYPES),
  productName: requiredText,
  productCode: z.string().trim().optional().default(''),
  batchNumber: z.string().trim().optional().default(''),
  site: z.string().trim().optional().default(''),
  department: z.string().trim().optional().default(''),
  reviewPeriodFrom: requiredText,
  reviewPeriodTo: requiredText,
  remarks: z.string().trim().optional().default(''),
  version: z.string().trim().optional().default('1.0'),
  changeReason: z.string().trim().min(5, 'Change reason must be at least 5 characters'),
}).refine((d) => new Date(d.reviewPeriodTo) >= new Date(d.reviewPeriodFrom), {
  message: 'Review period end must be on or after start date',
  path: ['reviewPeriodTo'],
});

export type CpvReportFormData = z.infer<typeof cpvReportFormSchema>;

export function buildReportId(productCode: string): string {
  const code = (productCode || 'ALL').replace(/\s+/g, '-').toUpperCase();
  return `CPV-RPT-${code}-${Date.now()}`;
}

export function generateReportNumber(year: number, existingCount: number): string {
  return `CPV-RPT/${year}/${String(existingCount + 1).padStart(4, '0')}`;
}

export function reportStatusLabel(status: string): string {
  return status || 'Draft';
}

export function healthScoreLabel(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 60) return 'Needs Attention';
  return 'Critical';
}

export function healthScoreTone(score: number): 'green' | 'blue' | 'amber' | 'red' {
  if (score >= 90) return 'green';
  if (score >= 75) return 'blue';
  if (score >= 60) return 'amber';
  return 'red';
}

export function computeCpvHealthScore(input: {
  criticalRiskCount: number;
  highRiskCount: number;
  oosCount: number;
  ootCount: number;
  overdueCapaCount: number;
  averageCpk: number;
  batchAcceptanceRate?: number;
  cppCompliancePct?: number;
  cqaCompliancePct?: number;
}): number {
  let score = 100;
  score -= input.criticalRiskCount * 10;
  score -= input.highRiskCount * 5;
  score -= input.oosCount * 5;
  score -= input.ootCount * 3;
  score -= input.overdueCapaCount * 2;
  if (input.averageCpk > 0 && input.averageCpk < 1.33) score -= 5;
  if (input.averageCpk > 0 && input.averageCpk < 1.0) score -= 8;
  if ((input.batchAcceptanceRate || 100) < 95) score -= 6;
  if ((input.cppCompliancePct || 100) < 95) score -= 5;
  if ((input.cqaCompliancePct || 100) < 95) score -= 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function enrichCpvReportMetrics(partial: Partial<CpvReportMetrics> & Record<string, unknown>): CpvReportMetrics {
  const totalBatches = Number(partial.totalBatches || 0);
  const released = Number(partial.releasedBatches || 0);
  const rejected = Number(partial.rejectedBatches || 0);
  const batchAcceptanceRate = totalBatches > 0
    ? Math.round((released / totalBatches) * 1000) / 10
    : Number(partial.batchAcceptanceRate || 0);
  const batchRejectionRate = totalBatches > 0
    ? Math.round((rejected / totalBatches) * 1000) / 10
    : Number(partial.batchRejectionRate || 0);
  const averageCpk = Number(partial.averageCpk || 0);
  const averagePpk = Number(partial.averagePpk || 0);
  const averageCp = Number(partial.averageCp || averageCpk);
  const averagePp = Number(partial.averagePp || averagePpk);
  const sigmaLevel = averageCpk > 0
    ? Math.round(Math.min(6, Math.max(0, 0.5 + averageCpk * 1.5)) * 100) / 100
    : Number(partial.sigmaLevel || 0);
  const cpp = Number(partial.cppCompliancePct ?? 100);
  const cqa = Number(partial.cqaCompliancePct ?? 100);
  const cpvCompliancePct = Number(partial.cpvCompliancePct ?? ((cpp + cqa) / 2));
  const criticalRiskCount = Number(partial.criticalRiskCount || 0);
  const highRiskCount = Number(partial.highRiskCount || 0);
  const oosCount = Number(partial.oosCount || 0);
  const ootCount = Number(partial.ootCount || 0);
  const healthScore = computeCpvHealthScore({
    criticalRiskCount,
    highRiskCount,
    oosCount,
    ootCount,
    overdueCapaCount: Number(partial.capaCount || 0) > 0 ? Math.min(3, Number(partial.capaCount || 0)) : 0,
    averageCpk,
    batchAcceptanceRate,
    cppCompliancePct: cpp,
    cqaCompliancePct: cqa,
  });
  let riskScore = 15;
  if (criticalRiskCount > 0) riskScore = 90;
  else if (highRiskCount > 0) riskScore = 70;
  else if (oosCount > 2) riskScore = 55;
  else if (ootCount > 3) riskScore = 40;
  const capabilityReductionDetected = averageCpk > 0 && averageCpk < 1.33;
  const negativeTrendDetected = ootCount >= 3 || oosCount > 0 || Number(partial.deviationCount || 0) > 5;
  const escalationRequired = criticalRiskCount > 0 || healthScore < 60 || (averageCpk > 0 && averageCpk < 1.0);
  const productHealthScore = Math.max(0, Math.min(100, Math.round((healthScore + cpvCompliancePct + Math.min(100, batchAcceptanceRate || 100)) / 3)));
  const plantHealthScore = Math.max(0, Math.min(100, Math.round((
    healthScore
    + Number(partial.environmentalCompliancePct ?? 100)
    + Number(partial.utilityCompliancePct ?? 100)
    + Number(partial.calibrationCompliancePct ?? 100)
  ) / 4)));
  const complianceScore = Math.round(cpvCompliancePct);
  const confidenceScore = Math.max(
    45,
    Math.min(
      99,
      55
      + (totalBatches >= 10 ? 15 : totalBatches >= 3 ? 8 : 0)
      + (averageCpk > 0 ? 10 : 0)
      + (Number(partial.totalRecords || 0) >= 20 ? 10 : 0),
    ),
  );

  return {
    totalBatches,
    releasedBatches: released,
    rejectedBatches: rejected,
    batchAcceptanceRate,
    batchRejectionRate,
    cppCompliancePct: cpp,
    cqaCompliancePct: cqa,
    ootCount,
    oosCount,
    deviationCount: Number(partial.deviationCount || 0),
    capaCount: Number(partial.capaCount || 0),
    changeControlCount: Number(partial.changeControlCount || 0),
    averageCp,
    averageCpk,
    averagePp,
    averagePpk,
    sigmaLevel,
    averageYield: Number(partial.averageYield || 0),
    openRiskCount: Number(partial.openRiskCount || 0),
    highRiskCount,
    criticalRiskCount,
    riskScore,
    cpvCompliancePct: Math.round(cpvCompliancePct * 10) / 10,
    environmentalCompliancePct: Number(partial.environmentalCompliancePct ?? 100),
    utilityCompliancePct: Number(partial.utilityCompliancePct ?? 100),
    stabilityCompliancePct: Number(partial.stabilityCompliancePct ?? 100),
    spcCompliancePct: Number(partial.spcCompliancePct ?? 100),
    trainingCompliancePct: Number(partial.trainingCompliancePct ?? 100),
    calibrationCompliancePct: Number(partial.calibrationCompliancePct ?? 100),
    maintenanceCompliancePct: Number(partial.maintenanceCompliancePct ?? 100),
    supplierPerformancePct: Number(partial.supplierPerformancePct ?? 100),
    capaEffectivenessPct: Number(partial.capaEffectivenessPct ?? 100),
    dataIntegrityScore: Number(partial.dataIntegrityScore ?? Math.min(99, 70 + Math.round(confidenceScore / 5))),
    healthScore,
    healthLabel: healthScoreLabel(healthScore),
    productHealthScore,
    plantHealthScore,
    complianceScore,
    confidenceScore,
    totalRecords: Number(partial.totalRecords || 0),
    negativeTrendDetected,
    capabilityReductionDetected,
    escalationRequired,
  };
}

export function computeReportAiInsights(metrics: CpvReportMetrics, reportType: string): CpvReportAiInsights {
  const aiExecutiveSummary = [
    `${reportType}: process health ${metrics.healthScore}% (${metrics.healthLabel}).`,
    `CPP/CQA compliance ${metrics.cppCompliancePct.toFixed(1)}% / ${metrics.cqaCompliancePct.toFixed(1)}%.`,
    metrics.averageCpk > 0 ? `Mean Cpk ${metrics.averageCpk.toFixed(2)} (σ≈${metrics.sigmaLevel.toFixed(1)}).` : 'Capability data limited.',
    `Batch acceptance ${metrics.batchAcceptanceRate || 0}%; risk score ${metrics.riskScore}.`,
  ].join(' ');

  const aiDailyInsights = [
    `OOS ${metrics.oosCount}, OOT ${metrics.ootCount}, deviations ${metrics.deviationCount}, CAPA ${metrics.capaCount}.`,
    metrics.averageYield > 0 ? `Average yield ${metrics.averageYield.toFixed(1)}%.` : '',
  ].filter(Boolean).join(' ');

  const aiTrendPrediction = metrics.negativeTrendDetected
    ? 'Negative quality signals detected — intensify trend/SPC monitoring for the next campaign.'
    : 'No sustained negative trend; continue approved Stage 3 CPV monitoring cadence.';

  const aiRiskPrediction = metrics.escalationRequired
    ? 'Elevated residual risk — escalate to management review and consider CAPA/change control.'
    : metrics.capabilityReductionDetected
      ? 'Capability trending below target — review control strategy and sampling plans.'
      : 'Residual risk within acceptance for continued commercial manufacturing.';

  const tips: string[] = [];
  if (metrics.capabilityReductionDetected) tips.push('Investigate capability reduction and verify control limits.');
  if (metrics.oosCount > 0) tips.push('Link OOS events to deviation/CAPA effectiveness checks.');
  if (metrics.calibrationCompliancePct < 95) tips.push('Close calibration compliance gaps.');
  if (metrics.trainingCompliancePct < 95) tips.push('Address training compliance gaps.');
  if (!tips.length) tips.push('Continue approved CPV plan and schedule next analytics refresh.');

  return {
    aiExecutiveSummary,
    aiDailyInsights,
    aiTrendPrediction,
    aiRiskPrediction,
    aiPreventiveRecommendations: tips.join(' '),
    aiConfidenceScore: metrics.confidenceScore,
  };
}

export function countCppCqaCompliance(records: Array<{ status?: string }>) {
  let pass = 0;
  let oot = 0;
  let oos = 0;
  records.forEach((r) => {
    const d = displayCpvStatus(r.status || '');
    if (d === 'Pass') pass++;
    else if (d === 'OOT') oot++;
    else oos++;
  });
  const total = records.length;
  return {
    pass,
    oot,
    oos,
    compliancePct: total ? (pass / total) * 100 : 100,
  };
}

export function summarizeReportsAnalytics(
  reports: CpvReportRecord[],
  metrics?: CpvReportMetrics,
): CpvReportsAnalyticsSummary {
  const active = reports.filter((r) => !r.isDeleted);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    totalReports: active.length,
    reportsThisMonth: active.filter((r) => new Date(r.generatedDate || r.createdAt) >= monthStart).length,
    failedReports: active.filter((r) => r.reportStatus === 'Failed').length,
    pdfExports: active.filter((r) => r.exportType === 'PDF').length,
    excelExports: active.filter((r) => r.exportType === 'Excel').length,
    highRiskProducts: active.filter((r) => (r.metrics?.criticalRiskCount || 0) > 0 || (r.metrics?.highRiskCount || 0) > 0).length,
    oosCount: metrics?.oosCount ?? active.reduce((s, r) => s + (r.metrics?.oosCount || 0), 0),
    ootCount: metrics?.ootCount ?? active.reduce((s, r) => s + (r.metrics?.ootCount || 0), 0),
    averageCpk: metrics?.averageCpk ?? (active.length
      ? active.reduce((s, r) => s + (r.metrics?.averageCpk || 0), 0) / active.length
      : 0),
    cpvCompliancePct: metrics?.cpvCompliancePct ?? (active.length
      ? active.reduce((s, r) => s + (r.metrics?.cpvCompliancePct || 0), 0) / active.length
      : 100),
  };
}

export function buildReportCharts(metrics: CpvReportMetrics, previewRows: Record<string, unknown>[]) {
  const productMap = new Map<string, { cpp: number; cqa: number; total: number; pass: number }>();
  previewRows.forEach((row) => {
    const product = String(row.productName || row.product_name || 'Unknown');
    const mod = String(row._module || row.module || '');
    const entry = productMap.get(product) || { cpp: 0, cqa: 0, total: 0, pass: 0 };
    entry.total++;
    if (displayCpvStatus(String(row.status || '')) === 'Pass') entry.pass++;
    if (mod === 'CPP') entry.cpp++;
    if (mod === 'CQA') entry.cqa++;
    productMap.set(product, entry);
  });

  return {
    productCompliance: Array.from(productMap.entries()).map(([name, v]) => ({
      name,
      compliance: v.total ? Math.round((v.pass / v.total) * 100) : 100,
    })),
    cppVsCqa: [
      { name: 'CPP', value: metrics.cppCompliancePct },
      { name: 'CQA', value: metrics.cqaCompliancePct },
    ],
    ootOosTrend: [
      { name: 'OOT', value: metrics.ootCount },
      { name: 'OOS', value: metrics.oosCount },
    ],
    riskDistribution: [
      { name: 'Critical', value: metrics.criticalRiskCount },
      { name: 'High', value: metrics.highRiskCount },
      { name: 'Open', value: metrics.openRiskCount },
    ],
    cpkByProduct: [{ name: 'Average', value: Number(metrics.averageCpk.toFixed(2)) }],
    yieldSummary: [{ name: 'Yield Avg %', value: Number(metrics.averageYield.toFixed(1)) }],
    reportGenerationTrend: [{ name: 'Records', value: metrics.totalRecords }],
  };
}

export function canGenerateReportType(role: string | undefined, reportType: CpvReportType): boolean {
  if (!role) return false;
  if (['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role)) return true;
  if (['viewer', 'auditor'].includes(role)) return false;
  if (['qc', 'qc_manager'].includes(role)) {
    return ['CQA Monitoring Report', 'Stability Monitoring Report', 'OOT/OOS Summary Report', 'Product-wise CPV Report'].includes(reportType);
  }
  if (['production', 'production_manager'].includes(role)) {
    return ['CPP Monitoring Report', 'Yield Monitoring Report', 'Batch-wise CPV Report', 'Product-wise CPV Report'].includes(reportType);
  }
  if (['engineering', 'engineering_manager'].includes(role)) {
    return ['Utility Monitoring Report', 'Environmental Monitoring Report', 'Product-wise CPV Report'].includes(reportType);
  }
  return reportType === 'CPV Dashboard Summary Report' || reportType === 'Management Review Report';
}

export function reportTypeRequiresProduct(reportType: CpvReportType): boolean {
  return ![
    'CPV Dashboard Summary Report',
    'Management Review Report',
    'Executive Summary Report',
    'AI Insights Report',
    'Compliance Scorecard Report',
  ].includes(reportType);
}
