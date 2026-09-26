import { z } from 'zod';
import type { RiskLevel } from '@/lib/cpv';

export const RISK_ASSESSMENT_COLLECTION = 'risk_assessment';
export const RISK_CONTROLS_COLLECTION = 'risk_controls';
export const RISK_REVIEWS_COLLECTION = 'risk_reviews';
export const RISK_ASSESSMENT_LEGACY = ['cpv_risk_assessment'] as const;
export const RISK_ASSESSMENT_MODULE = 'CPV Risk Assessment Worksheet';

export const RISK_CATEGORIES = [
  'CPP Risk',
  'CQA Risk',
  'Yield Risk',
  'Stability Risk',
  'Raw Material Risk',
  'Packing Material Risk',
  'Utility Risk',
  'Environmental Risk',
  'Hold Time Risk',
  'Process Capability Risk',
  'Vendor Risk',
  'Equipment Risk',
  'Process Risk',
  'Quality Risk',
  'Personnel Risk',
  'Microbiological Risk',
  'Data Integrity Risk',
  'Computer System Risk',
  'Cybersecurity Risk',
  'Regulatory Risk',
  'Validation Risk',
  'Business Continuity Risk',
  'Supplier Risk',
  'Material Risk',
] as const;

export const RISK_METHODOLOGIES = [
  'FMEA',
  'FMECA',
  'HACCP',
  'HAZOP',
  'Fault Tree Analysis',
  'Fishbone Diagram',
  'Bow-Tie Analysis',
  '5 Why Analysis',
  'Risk Matrix 5x5',
  'Risk Matrix 3x3',
] as const;

export const RISK_SOURCES = [
  'Manual Assessment',
  'CPP Monitoring',
  'CQA Monitoring',
  'Yield Monitoring',
  'Stability Monitoring',
  'Raw Material Monitoring',
  'Packing Material Monitoring',
  'Utility Monitoring',
  'Environmental Monitoring',
  'Hold Time Monitoring',
  'Trend Analysis',
  'SPC',
  'Process Capability',
  'Deviation',
  'OOS',
  'CAPA',
] as const;

export const PARAMETER_TYPES = [
  'CPP',
  'CQA',
  'Yield',
  'Stability',
  'Raw Material',
  'Packing Material',
  'Utility',
  'Environmental',
  'Hold Time',
  'Process Capability',
] as const;

export const RISK_STATUSES = [
  'Draft',
  'Open',
  'Under Review',
  'Mitigation In Progress',
  'Pending Approval',
  'Effectiveness Check Pending',
  'Approved',
  'Closed',
  'Accepted',
  'Rejected',
  'Overdue',
] as const;

export const WORKFLOW_STATUSES = [
  'Draft',
  'Review',
  'Approval',
  'Mitigation',
  'Effectiveness Check',
  'Closure',
] as const;

export const EFFECTIVENESS_STATUSES = [
  'Pending',
  'Effective',
  'Partially Effective',
  'Not Effective',
] as const;

export const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;

const requiredText = z.string().trim().min(1, 'Required');

export const riskAssessmentFormSchema = z.object({
  cpvProductId: z.string().trim().min(1, 'CPV product is required'),
  productName: requiredText,
  productCode: z.string().trim().optional().default(''),
  productVersion: z.string().trim().optional().default(''),
  batchNumber: z.string().trim().optional().default(''),
  title: z.string().trim().optional().default(''),
  methodology: z.enum(RISK_METHODOLOGIES).default('FMEA'),
  riskCategory: z.enum(RISK_CATEGORIES).default('Process Risk'),
  riskSource: z.enum(RISK_SOURCES).default('Manual Assessment'),
  processStage: z.string().trim().optional().default(''),
  process: z.string().trim().optional().default(''),
  processStep: z.string().trim().optional().default(''),
  department: z.string().trim().optional().default(''),
  site: z.string().trim().optional().default(''),
  equipmentId: z.string().trim().optional().default(''),
  equipmentName: z.string().trim().optional().default(''),
  machine: z.string().trim().optional().default(''),
  material: z.string().trim().optional().default(''),
  supplier: z.string().trim().optional().default(''),
  utility: z.string().trim().optional().default(''),
  environmentalCondition: z.string().trim().optional().default(''),
  parameterType: z.enum(PARAMETER_TYPES).optional().default('CPP'),
  parameterName: z.string().trim().optional().default(''),
  riskDescription: requiredText,
  potentialImpact: z.string().trim().optional().default(''),
  potentialCause: z.string().trim().optional().default(''),
  existingControls: z.string().trim().optional().default(''),
  severityScore: z.coerce.number().int().min(1).max(10),
  occurrenceScore: z.coerce.number().int().min(1).max(10),
  detectionScore: z.coerce.number().int().min(1).max(10),
  residualSeverity: z.coerce.number().int().min(0).max(10).optional().default(0),
  residualOccurrence: z.coerce.number().int().min(0).max(10).optional().default(0),
  residualDetection: z.coerce.number().int().min(0).max(10).optional().default(0),
  riskOwner: requiredText,
  mitigationAction: z.string().trim().optional().default(''),
  targetCompletionDate: requiredText,
  assessmentDate: z.string().trim().optional().default(''),
  reviewFrequency: z.string().trim().optional().default(''),
  priority: z.string().trim().optional().default(''),
  version: z.string().trim().optional().default('1.0'),
  effectivenessCheckRequired: z.boolean().default(true),
  linkedCapaNumber: z.string().trim().optional().default(''),
  linkedDeviationNumber: z.string().trim().optional().default(''),
  linkedOosNumber: z.string().trim().optional().default(''),
  linkedChangeControlNumber: z.string().trim().optional().default(''),
  remarks: z.string().trim().optional().default(''),
  changeReason: z.string().trim().min(5, 'Change reason must be at least 5 characters'),
});

export type RiskAssessmentFormData = z.infer<typeof riskAssessmentFormSchema>;

export interface RiskControlRecord {
  controlId: string;
  controlDescription: string;
  controlType: string;
  owner: string;
  targetDate: string;
  status: string;
  effectiveness: string;
}

export interface RiskReviewRecord {
  reviewDate: string;
  reviewer: string;
  comments: string;
  decision: string;
  status: string;
}

export interface RiskAssessmentRecord extends RiskAssessmentFormData, Record<string, unknown> {
  id: string;
  riskAssessmentId: string;
  riskNumber: string;
  rpnScore: number;
  riskLevel: RiskLevel;
  residualRpn: number;
  residualRiskLevel: string;
  riskReductionPercent: number;
  criticality: number;
  probability: number;
  impact: number;
  likelihood: number;
  healthScore: number;
  confidenceScore: number;
  aiRecommendation: string;
  repeatedRiskDetected: boolean;
  missingControls: boolean;
  mitigationOverdue: boolean;
  riskStatus: typeof RISK_STATUSES[number];
  workflowStatus: typeof WORKFLOW_STATUSES[number];
  effectivenessStatus: typeof EFFECTIVENESS_STATUSES[number];
  capaSuggested: boolean;
  deviationRequired: boolean;
  isAutoGenerated: boolean;
  isLocked: boolean;
  reviewedBy: string;
  reviewDate: string;
  approvedBy: string;
  approvalDate: string;
  closedBy: string;
  closedDate: string;
  controls: RiskControlRecord[];
  reviews: RiskReviewRecord[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
}

export interface RiskAssessmentSummary {
  total: number;
  open: number;
  closed: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  capaLinked: number;
  overdue: number;
}

function round(n: number) {
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

export function generateRiskNumber(existingCount: number): string {
  const year = new Date().getFullYear();
  return `RISK/${year}/${String(existingCount + 1).padStart(4, '0')}`;
}

export function buildRiskAssessmentId(productCode: string): string {
  const year = new Date().getFullYear();
  return `RA-${productCode || 'PRD'}-${year}`.replace(/\s+/g, '-').toUpperCase().slice(0, 80);
}

export function calculateRiskAssessment(
  severity: number,
  occurrence: number,
  detection: number,
  residual?: { severity?: number; occurrence?: number; detection?: number },
): {
  rpnScore: number;
  riskLevel: RiskLevel;
  residualRpn: number;
  residualRiskLevel: string;
  riskReductionPercent: number;
  criticality: number;
  probability: number;
  impact: number;
  likelihood: number;
  healthScore: number;
  confidenceScore: number;
  aiRecommendation: string;
  capaSuggested: boolean;
  deviationRequired: boolean;
} {
  const s = Math.min(10, Math.max(1, Math.round(severity)));
  const o = Math.min(10, Math.max(1, Math.round(occurrence)));
  const d = Math.min(10, Math.max(1, Math.round(detection)));
  const rpnScore = s * o * d;
  let riskLevel: RiskLevel = 'Low';
  if (rpnScore >= 201 || s >= 9) riskLevel = 'Critical';
  else if (rpnScore >= 101 || s >= 7) riskLevel = 'High';
  else if (rpnScore >= 51) riskLevel = 'Medium';

  const rs = residual?.severity && residual.severity > 0 ? Math.min(10, Math.max(1, Math.round(residual.severity))) : 0;
  const ro = residual?.occurrence && residual.occurrence > 0 ? Math.min(10, Math.max(1, Math.round(residual.occurrence))) : 0;
  const rd = residual?.detection && residual.detection > 0 ? Math.min(10, Math.max(1, Math.round(residual.detection))) : 0;
  const residualRpn = rs > 0 && ro > 0 && rd > 0 ? rs * ro * rd : 0;
  let residualRiskLevel = '';
  if (residualRpn > 0) {
    if (residualRpn >= 201 || rs >= 9) residualRiskLevel = 'Critical';
    else if (residualRpn >= 101 || rs >= 7) residualRiskLevel = 'High';
    else if (residualRpn >= 51) residualRiskLevel = 'Medium';
    else residualRiskLevel = 'Low';
  }
  const riskReductionPercent = residualRpn > 0 && rpnScore > 0
    ? Math.max(0, Math.min(100, Math.round(((rpnScore - residualRpn) / rpnScore) * 100)))
    : 0;

  const criticality = Math.round((s * o) / 10);
  const probability = o;
  const impact = s;
  const likelihood = Math.round((o + (11 - d)) / 2);

  let healthScore = 100;
  if (riskLevel === 'Critical') healthScore -= 45;
  else if (riskLevel === 'High') healthScore -= 30;
  else if (riskLevel === 'Medium') healthScore -= 15;
  if (residualRpn > 0 && residualRpn >= rpnScore) healthScore -= 10;
  healthScore = Math.max(0, Math.min(100, healthScore));
  const confidenceScore = Math.max(40, Math.min(99, 55 + (residualRpn > 0 ? 15 : 0) + (s >= 7 ? 5 : 10)));

  const tips: string[] = [];
  if (riskLevel === 'Critical') tips.push('Critical RPN — escalate to QA and consider deviation/CAPA.');
  else if (riskLevel === 'High') tips.push('High risk — implement mitigation controls and schedule effectiveness check.');
  if (d >= 8) tips.push('High detection score indicates weak detectability — strengthen monitoring controls.');
  if (residualRpn > 0 && residualRpn >= 101) tips.push(`Residual RPN ${residualRpn} remains elevated after mitigation.`);
  if (riskReductionPercent >= 50) tips.push(`Risk reduced by ${riskReductionPercent}% — verify effectiveness.`);
  if (!tips.length) tips.push(`RPN ${rpnScore} (${riskLevel}) — continue routine ICH Q9 risk monitoring.`);

  return {
    rpnScore,
    riskLevel,
    residualRpn,
    residualRiskLevel,
    riskReductionPercent,
    criticality,
    probability,
    impact,
    likelihood,
    healthScore,
    confidenceScore,
    aiRecommendation: tips.join(' '),
    capaSuggested: riskLevel === 'Critical' || riskLevel === 'High',
    deviationRequired: riskLevel === 'Critical' || (s >= 9 && o >= 5),
  };
}

export function severityBand(score: number): RiskLevel {
  if (score >= 9) return 'Critical';
  if (score >= 7) return 'High';
  if (score >= 4) return 'Medium';
  return 'Low';
}

export function matrixSeverity(score: number): number {
  return Math.min(5, Math.max(1, Math.ceil(score / 2)));
}

export function matrixOccurrence(score: number): number {
  return Math.min(5, Math.max(1, Math.ceil(score / 2)));
}

export function matrixCellLevel(severity: number, occurrence: number): RiskLevel {
  const rpn = severity * occurrence * 5;
  if (rpn >= 60) return 'Critical';
  if (rpn >= 35) return 'High';
  if (rpn >= 15) return 'Medium';
  return 'Low';
}

export function riskLevelColor(level: RiskLevel): string {
  const map: Record<RiskLevel, string> = {
    Low: '#059669',
    Medium: '#d97706',
    High: '#ea580c',
    Critical: '#dc2626',
  };
  return map[level];
}

export function isOverdue(record: RiskAssessmentRecord): boolean {
  if (!record.targetCompletionDate) return false;
  if (['Closed', 'Accepted', 'Rejected'].includes(record.riskStatus)) return false;
  return new Date(`${record.targetCompletionDate}T23:59:59`) < new Date();
}

export function summarizeRiskAssessments(records: RiskAssessmentRecord[]): RiskAssessmentSummary {
  return {
    total: records.length,
    open: records.filter((r) => !['Closed', 'Accepted', 'Rejected'].includes(r.riskStatus)).length,
    closed: records.filter((r) => ['Closed', 'Accepted'].includes(r.riskStatus)).length,
    critical: records.filter((r) => r.riskLevel === 'Critical').length,
    high: records.filter((r) => r.riskLevel === 'High').length,
    medium: records.filter((r) => r.riskLevel === 'Medium').length,
    low: records.filter((r) => r.riskLevel === 'Low').length,
    capaLinked: records.filter((r) => Boolean(r.linkedCapaNumber)).length,
    overdue: records.filter(isOverdue).length,
  };
}

export interface RiskMatrixCell {
  severity: number;
  occurrence: number;
  count: number;
  maxRpn: number;
  level: RiskLevel;
}

export function buildRiskAssessmentMatrix(records: RiskAssessmentRecord[]): RiskMatrixCell[] {
  const cells: RiskMatrixCell[] = [];
  for (let severity = 5; severity >= 1; severity--) {
    for (let occurrence = 1; occurrence <= 5; occurrence++) {
      const cellRecords = records.filter(
        (r) => matrixSeverity(r.severityScore) === severity
          && matrixOccurrence(r.occurrenceScore) === occurrence,
      );
      const maxRpn = cellRecords.length ? Math.max(...cellRecords.map((r) => r.rpnScore)) : 0;
      cells.push({
        severity,
        occurrence,
        count: cellRecords.length,
        maxRpn,
        level: cellRecords.length
          ? cellRecords.reduce((worst, r) => {
            const order = ['Critical', 'High', 'Medium', 'Low'];
            return order.indexOf(r.riskLevel) < order.indexOf(worst) ? r.riskLevel : worst;
          }, 'Low' as RiskLevel)
          : matrixCellLevel(severity, occurrence),
      });
    }
  }
  return cells;
}

export interface RiskHeatCell extends RiskMatrixCell {
  intensity: number;
}

export function buildRiskAssessmentHeatMap(records: RiskAssessmentRecord[]): RiskHeatCell[] {
  const matrix = buildRiskAssessmentMatrix(records);
  const maxCount = Math.max(1, ...matrix.map((c) => c.count));
  return matrix.map((cell) => ({ ...cell, intensity: cell.count / maxCount }));
}

export function buildRiskAssessmentCharts(records: RiskAssessmentRecord[]) {
  const levelMap = new Map<string, number>();
  records.forEach((r) => levelMap.set(r.riskLevel, (levelMap.get(r.riskLevel) || 0) + 1));
  const levelDistribution = Array.from(levelMap.entries()).map(([level, count]) => ({ level, count }));

  const statusMap = new Map<string, number>();
  records.forEach((r) => statusMap.set(r.riskStatus, (statusMap.get(r.riskStatus) || 0) + 1));
  const statusTrend = Array.from(statusMap.entries()).map(([status, count]) => ({ status, count }));

  const catMap = new Map<string, number>();
  records.forEach((r) => catMap.set(r.riskCategory, (catMap.get(r.riskCategory) || 0) + 1));
  const categoryTrend = Array.from(catMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const byMonth = new Map<string, number>();
  records.forEach((r) => {
    const key = (r.createdAt || '').slice(0, 7);
    if (key) byMonth.set(key, (byMonth.get(key) || 0) + 1);
  });
  const monthlyTrend = Array.from(byMonth.entries())
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const topRisks = [...records].sort((a, b) => b.rpnScore - a.rpnScore).slice(0, 10);

  return { levelDistribution, statusTrend, categoryTrend, monthlyTrend, topRisks };
}

export function inferRiskFromSignal(input: {
  riskSource: typeof RISK_SOURCES[number];
  riskCategory: typeof RISK_CATEGORIES[number];
  parameterName?: string;
  description: string;
  severity?: number;
  occurrence?: number;
  detection?: number;
}): Pick<RiskAssessmentFormData, 'riskSource' | 'riskCategory' | 'riskDescription' | 'severityScore' | 'occurrenceScore' | 'detectionScore' | 'potentialImpact'> {
  const param = (input.parameterName || '').toLowerCase();
  let severity = input.severity ?? 5;
  let occurrence = input.occurrence ?? 4;
  let detection = input.detection ?? 5;

  if (param.includes('sterility') || input.description.toLowerCase().includes('sterility')) {
    severity = 10; occurrence = 3; detection = 4;
  } else if (param.includes('endotoxin')) {
    severity = 10; occurrence = 3; detection = 4;
  } else if (input.description.toLowerCase().includes('oos') && param.includes('assay')) {
    severity = 8; occurrence = 5; detection = 4;
  } else if (input.riskCategory === 'Environmental Risk' && input.description.toLowerCase().includes('grade a')) {
    severity = 10; occurrence = 4; detection = 3;
  } else if (input.riskSource === 'Process Capability') {
    severity = input.description.includes('1.0') ? 8 : 6;
  } else if (input.description.toLowerCase().includes('oot')) {
    severity = 6; occurrence = 6;
  }

  return {
    riskSource: input.riskSource,
    riskCategory: input.riskCategory,
    riskDescription: input.description,
    severityScore: severity,
    occurrenceScore: occurrence,
    detectionScore: detection,
    potentialImpact: input.description,
  };
}
