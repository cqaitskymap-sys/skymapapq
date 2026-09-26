import { z } from 'zod';
import { inOuterSpecificationBand } from '@/lib/cpv';

export const YIELD_MONITORING_COLLECTION = 'yield_monitoring';
export const YIELD_LEGACY_COLLECTIONS = ['cpv_yield_monitoring', 'cpv_yield'] as const;
export const YIELD_MODULE_NAME = 'Yield Monitoring';

export const YIELD_STAGES = [
  'Bulk Yield',
  'Filling Yield',
  'Packing Yield',
  'Overall Yield',
  'Process Yield',
  'Stage Yield',
  'Recovery Yield',
  'Packaging Yield',
] as const;

export const YIELD_STATUSES = ['Complies', 'Low Yield', 'High Yield', 'Alert', 'Action', 'OOS', 'OOT'] as const;
export const YIELD_REVIEW_STATUSES = ['Draft', 'Under Review', 'Approved'] as const;

export const DEFAULT_YIELD_LIMITS: Record<string, { lowerLimit: number; upperLimit: number; targetYield: number }> = {
  'Bulk Yield': { lowerLimit: 96, upperLimit: 100, targetYield: 98 },
  'Filling Yield': { lowerLimit: 90, upperLimit: 100, targetYield: 95 },
  'Packing Yield': { lowerLimit: 94, upperLimit: 100, targetYield: 96 },
  'Packaging Yield': { lowerLimit: 94, upperLimit: 100, targetYield: 96 },
  'Overall Yield': { lowerLimit: 90, upperLimit: 100, targetYield: 95 },
  'Process Yield': { lowerLimit: 92, upperLimit: 100, targetYield: 96 },
  'Stage Yield': { lowerLimit: 90, upperLimit: 100, targetYield: 95 },
  'Recovery Yield': { lowerLimit: 85, upperLimit: 100, targetYield: 90 },
};

const requiredText = z.string().trim().min(1, 'Required');
const optionalNum = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().optional(),
);

export const yieldMonitoringFormSchema = z.object({
  cpvProductId: requiredText,
  productName: requiredText,
  productCode: requiredText,
  productVersion: z.string().trim().default(''),
  batchNumber: requiredText,
  manufacturingDate: requiredText,
  manufacturingOrder: z.string().trim().default(''),
  workOrder: z.string().trim().default(''),
  campaign: z.string().trim().default(''),
  batchSize: z.string().trim().default(''),
  batchSizeUnit: z.string().trim().default(''),
  yieldStage: z.enum(YIELD_STAGES),
  processStep: z.string().trim().default(''),
  department: z.string().trim().default(''),
  site: z.string().trim().default(''),
  productionLine: z.string().trim().default(''),
  equipmentId: z.string().trim().default(''),
  equipmentName: z.string().trim().default(''),
  operator: z.string().trim().default(''),
  supervisor: z.string().trim().default(''),
  shift: z.string().trim().default(''),
  theoreticalQuantity: z.coerce.number().positive('Theoretical quantity must be greater than 0'),
  actualQuantity: z.coerce.number().min(0, 'Actual quantity cannot be negative'),
  rejectQuantity: z.coerce.number().min(0).default(0),
  reworkQuantity: z.coerce.number().min(0).default(0),
  scrapQuantity: z.coerce.number().min(0).default(0),
  wasteQuantity: z.coerce.number().min(0).default(0),
  releasedQuantity: optionalNum,
  materialConsumed: optionalNum,
  materialVariance: optionalNum,
  lowerLimit: z.coerce.number(),
  upperLimit: z.coerce.number(),
  targetYield: z.coerce.number(),
  unit: z.string().trim().default('units'),
  alertLimitLow: optionalNum,
  alertLimitHigh: optionalNum,
  actionLimitLow: optionalNum,
  actionLimitHigh: optionalNum,
  recordedBy: requiredText,
  reviewedBy: z.string().trim().default(''),
  reviewDate: z.string().trim().default(''),
  remarks: z.string().trim().default(''),
  autoDeviationRequired: z.boolean().default(true),
  specificationNumber: z.string().trim().default(''),
  version: z.string().trim().default('1.0'),
  calculationVersion: z.string().trim().default('1.0'),
  effectiveDate: z.string().trim().default(''),
  description: z.string().trim().default(''),
  changeReason: z.string().trim().min(5, 'Change reason must be at least 5 characters'),
}).refine((d) => d.lowerLimit < d.upperLimit, {
  message: 'Upper limit must be greater than lower limit',
  path: ['upperLimit'],
});

export type YieldMonitoringFormData = z.infer<typeof yieldMonitoringFormSchema>;
export type YieldMonitoringSaveData = YieldMonitoringFormData;

export interface YieldMonitoringRecord extends YieldMonitoringFormData, Record<string, unknown> {
  id: string;
  yieldMonitoringId: string;
  lossQuantity: number;
  yieldPercentage: number;
  netYieldPercentage: number;
  variancePercentage: number;
  status: typeof YIELD_STATUSES[number] | string;
  riskLevel: string;
  deviationRequired: boolean;
  linkedDeviationNumber: string;
  capaRequired: boolean;
  linkedCapaNumber: string;
  reviewStatus: typeof YIELD_REVIEW_STATUSES[number];
  isLocked: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
  oosRequired?: boolean;
  linkedOosNumber?: string;
}

export interface YieldSummary {
  total: number;
  compliant: number;
  lowYield: number;
  highYield: number;
  oos: number;
  oot: number;
  avgBulkYield: number;
  avgFillingYield: number;
  avgPackingYield: number;
  avgOverallYield: number;
  deviationTriggered: number;
  capaSuggested: number;
}

export function buildYieldMonitoringId(batchNumber: string, yieldStage: string): string {
  return `YLD-${batchNumber}-${yieldStage}`.replace(/\s+/g, '-').toUpperCase();
}

export function calculateLossQuantity(theoretical: number, actual: number): number {
  if (!Number.isFinite(theoretical) || !Number.isFinite(actual)) return 0;
  return Math.max(0, Math.round((theoretical - actual) * 10000) / 10000);
}

export function calculateYieldPercentage(theoretical: number, actual: number): number {
  if (!Number.isFinite(theoretical) || theoretical <= 0) return 0;
  if (!Number.isFinite(actual)) return 0;
  return Math.round((actual / theoretical) * 10000) / 100;
}

/** Net yield after reject/scrap/waste deductions from actual. */
export function calculateNetYieldPercentage(
  theoretical: number,
  actual: number,
  reject = 0,
  scrap = 0,
  waste = 0,
): number {
  if (!Number.isFinite(theoretical) || theoretical <= 0) return 0;
  const net = Math.max(0, Number(actual) - Number(reject || 0) - Number(scrap || 0) - Number(waste || 0));
  return Math.round((net / theoretical) * 10000) / 100;
}

export function calculateVariancePercentage(targetYield: number, yieldPercentage: number): number {
  if (!Number.isFinite(targetYield) || !Number.isFinite(yieldPercentage)) return 0;
  return Math.round((targetYield - yieldPercentage) * 100) / 100;
}

export function evaluateYieldStatus(
  yieldPct: number,
  lowerLimit: number,
  upperLimit: number,
  alertLow?: number,
  alertHigh?: number,
  actionLow?: number,
  actionHigh?: number,
): string {
  if (!Number.isFinite(yieldPct)) return 'OOS';
  if (yieldPct < lowerLimit) return 'OOS';
  if (yieldPct > upperLimit) return 'High Yield';
  if (actionLow != null && Number.isFinite(actionLow) && yieldPct < actionLow) return 'Action';
  if (actionHigh != null && Number.isFinite(actionHigh) && yieldPct > actionHigh) return 'Action';
  if (alertLow != null && Number.isFinite(alertLow) && yieldPct < alertLow) return 'Alert';
  if (alertHigh != null && Number.isFinite(alertHigh) && yieldPct > alertHigh) return 'Alert';
  if (alertLow == null && alertHigh == null && inOuterSpecificationBand(yieldPct, lowerLimit, upperLimit)) {
    return 'OOT';
  }
  return 'Complies';
}

export function evaluateYieldRisk(
  record: Pick<YieldMonitoringRecord, 'yieldStage' | 'yieldPercentage' | 'variancePercentage' | 'status' | 'targetYield'> & {
    scrapQuantity?: number;
    wasteQuantity?: number;
    theoreticalQuantity?: number;
  },
  lowYieldBatchCount: number,
): string {
  if (lowYieldBatchCount >= 3) return 'Critical';
  const scrap = Number(record.scrapQuantity || 0);
  const waste = Number(record.wasteQuantity || 0);
  const theoretical = Number(record.theoreticalQuantity || 0);
  if (theoretical > 0 && scrap / theoretical >= 0.05) return 'High';
  if (waste > 0 && record.status === 'OOS') return 'High';

  const variance = Math.abs(record.variancePercentage);
  if (variance > 5) return 'High';
  if ((record.yieldStage === 'Packing Yield' || record.yieldStage === 'Packaging Yield') && record.yieldPercentage < 94) {
    const diff = 94 - record.yieldPercentage;
    return diff > 3 ? 'High' : 'Medium';
  }
  const criticalStages = ['Bulk Yield', 'Filling Yield', 'Process Yield'];
  if (criticalStages.includes(record.yieldStage) && ['OOS', 'Low Yield'].includes(record.status)) return 'High';
  if (['OOS', 'Low Yield', 'High Yield', 'Action'].includes(record.status)) return 'Medium';
  if (['Alert', 'OOT'].includes(record.status)) return 'Low';
  return 'Low';
}

export function summarizeYieldRecords(records: YieldMonitoringRecord[]): YieldSummary {
  const avg = (stage: string) => {
    const rows = records.filter((r) => r.yieldStage === stage);
    if (!rows.length) return 0;
    return Math.round(rows.reduce((s, r) => s + r.yieldPercentage, 0) / rows.length * 100) / 100;
  };
  const isLow = (s: string) => s === 'Low Yield' || s === 'OOS';
  return {
    total: records.length,
    compliant: records.filter((r) => r.status === 'Complies').length,
    lowYield: records.filter((r) => isLow(r.status)).length,
    highYield: records.filter((r) => r.status === 'High Yield').length,
    oos: records.filter((r) => r.status === 'OOS' || r.status === 'Low Yield').length,
    oot: records.filter((r) => r.status === 'OOT' || r.status === 'Alert').length,
    avgBulkYield: avg('Bulk Yield'),
    avgFillingYield: avg('Filling Yield'),
    avgPackingYield: avg('Packing Yield') || avg('Packaging Yield'),
    avgOverallYield: avg('Overall Yield'),
    deviationTriggered: records.filter((r) => r.deviationRequired || r.linkedDeviationNumber).length,
    capaSuggested: records.filter((r) => r.capaRequired).length,
  };
}

export function buildYieldChartSeries(records: YieldMonitoringRecord[]) {
  const stageTrend = (stage: string) =>
    records
      .filter((r) => r.yieldStage === stage)
      .sort((a, b) => (a.manufacturingDate || a.createdAt).localeCompare(b.manufacturingDate || b.createdAt))
      .map((r) => ({
        label: r.batchNumber,
        yield: r.yieldPercentage,
        target: r.targetYield,
        lower: r.lowerLimit,
        upper: r.upperLimit,
      }));

  const batchMap = new Map<string, { batch: string; yield: number; stage: string }[]>();
  records.forEach((r) => {
    const list = batchMap.get(r.batchNumber) || [];
    list.push({ batch: r.batchNumber, yield: r.yieldPercentage, stage: r.yieldStage });
    batchMap.set(r.batchNumber, list);
  });
  const batchComparison = Array.from(batchMap.entries()).map(([batch, stages]) => {
    const overall = stages.find((s) => s.stage === 'Overall Yield');
    const bulk = stages.find((s) => s.stage === 'Bulk Yield');
    return {
      batch,
      overall: overall?.yield ?? bulk?.yield ?? 0,
    };
  }).slice(0, 15);

  const varianceByMonth = new Map<string, number>();
  records.forEach((r) => {
    const key = (r.manufacturingDate || r.createdAt || '').slice(0, 7) || 'unknown';
    const entries = varianceByMonth.get(key);
    const v = Math.abs(r.variancePercentage);
    if (!entries) varianceByMonth.set(key, v);
    else varianceByMonth.set(key, (entries + v) / 2);
  });
  const varianceTrend = Array.from(varianceByMonth.entries())
    .map(([month, variance]) => ({ month, variance: Math.round(variance * 100) / 100 }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const riskMap = new Map<string, number>();
  records.forEach((r) => riskMap.set(r.riskLevel || 'Low', (riskMap.get(r.riskLevel || 'Low') || 0) + 1));
  const riskDistribution = Array.from(riskMap.entries()).map(([level, count]) => ({ level, count }));

  return {
    bulkYieldTrend: stageTrend('Bulk Yield'),
    fillingYieldTrend: stageTrend('Filling Yield'),
    packingYieldTrend: stageTrend('Packing Yield'),
    overallYieldTrend: stageTrend('Overall Yield'),
    batchComparison,
    varianceTrend,
    riskDistribution,
  };
}

export function defaultLimitsForStage(stage: string) {
  return DEFAULT_YIELD_LIMITS[stage] || DEFAULT_YIELD_LIMITS['Overall Yield'];
}
