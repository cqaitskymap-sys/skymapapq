import { z } from 'zod';

export const ALERTS_COLLECTION = 'alerts';
export const ALERT_RULES_COLLECTION = 'alert_rules';
export const ALERT_NOTIFICATIONS_COLLECTION = 'alert_notifications';
export const ALERT_ESCALATIONS_COLLECTION = 'alert_escalations';
export const ALERTS_LEGACY = ['cpv_alerts'] as const;
export const CPV_ALERT_MODULE = 'CPV Alert Engine';

export const ALERT_SOURCES = [
  'CPP Monitoring',
  'CQA Monitoring',
  'Yield Monitoring',
  'Stability Monitoring',
  'Raw Material Monitoring',
  'Packing Material Monitoring',
  'Utility Monitoring',
  'Environmental Monitoring',
  'Hold Time Monitoring',
  'Process Capability',
  'Trend Analysis',
  'SPC',
  'Risk Assessment',
  'Annual CPV Review',
  'Reports & Analytics',
  'Deviation',
  'CAPA',
  'Change Control',
  'Training',
  'Calibration',
  'Maintenance',
  'Equipment',
  'Supplier',
  'Warehouse',
  'Inventory',
  'LIMS',
  'MES',
  'ERP',
  'QMS',
  'Document Management',
  'User Management',
  'Security Logs',
  'System Health',
  'AI Analytics',
  'Manual Alert',
] as const;

export const ALERT_TYPES = [
  'Alert Limit Crossed',
  'Action Limit Crossed',
  'OOT',
  'OOS',
  'OOC',
  'Excursion',
  'Temperature Excursion',
  'Humidity Excursion',
  'Differential Pressure Failure',
  'HVAC Failure',
  'Utility Failure',
  'Equipment Failure',
  'Sensor Failure',
  'Communication Failure',
  'Power Failure',
  'Low Yield',
  'Capability Drop',
  'Sigma Drop',
  'Trend Shift',
  'High Risk',
  'Critical Risk',
  'Risk Score Increased',
  'Cpk Below Limit',
  'SPC Rule Violation',
  'Western Electric Rule Violation',
  'Nelson Rule Violation',
  'Hold Time Exceeded',
  'Material Non-Compliance',
  'Packing Reconciliation Mismatch',
  'Stability Sample Missed',
  'Stability Pull Point Due',
  'Overdue Review',
  'Calibration Due',
  'Calibration Overdue',
  'Maintenance Due',
  'Maintenance Overdue',
  'Training Expired',
  'Training Due',
  'Document Expired',
  'Approval Pending',
  'Workflow Delay',
  'CAPA Overdue',
  'Deviation Overdue',
  'Repeated OOS',
  'Repeated OOT',
  'Repeated CAPA',
  'Security Login Failure',
  'Unauthorized Access',
  'System Failure',
  'Database Failure',
  'Cloud Function Failure',
  'Backup Failure',
  'API Failure',
  'AI Prediction Alert',
  'CPP Limit Exceeded',
  'CQA Limit Exceeded',
] as const;

export const ALERT_CATEGORIES = [
  'Critical',
  'High',
  'Medium',
  'Low',
  'Informational',
  'Emergency',
  'Predictive',
  'Compliance',
  'System',
  'Security',
  'Operational',
  'Maintenance',
  'Quality',
  'Environmental',
  'Utility',
  'Manufacturing',
] as const;

export const DELIVERY_CHANNELS = [
  'In-App',
  'Toast',
  'Email',
  'SMS',
  'WhatsApp',
  'Microsoft Teams',
  'Slack',
  'Push',
  'FCM',
  'Browser Push',
  'Webhook',
  'REST API',
] as const;

export const ALERT_PRIORITIES = ['Low', 'Medium', 'High', 'Critical', 'Emergency'] as const;
export const ALERT_SEVERITIES = ['Information', 'Warning', 'Major', 'Critical', 'Emergency'] as const;
export const ALERT_STATUSES = [
  'Open',
  'Acknowledged',
  'Under Investigation',
  'Linked to Deviation',
  'Linked to OOS',
  'Linked to CAPA',
  'Closed',
  'Rejected',
  'Overdue',
] as const;
export const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;

export const COMPARISON_OPERATORS = ['>', '>=', '<', '<=', '=', '!=', 'Between', 'Outside Range'] as const;
export const CONDITION_TYPES = [
  'Value Outside Limit',
  'Alert Limit Crossed',
  'Action Limit Crossed',
  'Repeated Failure',
  'Cpk Below Threshold',
  'SPC Rule Violation',
  'Overdue',
  'Missed Schedule',
  'Risk Level Critical',
] as const;

export type AlertSource = (typeof ALERT_SOURCES)[number];
export type AlertType = (typeof ALERT_TYPES)[number];
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
export type AlertPriority = (typeof ALERT_PRIORITIES)[number];
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
export type AlertStatus = (typeof ALERT_STATUSES)[number];
export type RiskLevel = (typeof RISK_LEVELS)[number];

export interface AlertTimelineEntry {
  action: string;
  user: string;
  at: string;
  remarks?: string;
}

export interface AlertAiIntelligence {
  aiConfidenceScore: number;
  aiRootCauseSuggestion: string;
  aiRecommendedActions: string;
  aiClusterId: string;
  isPredictive: boolean;
  duplicateSuppressed: boolean;
  noiseReductionApplied: boolean;
  correlatedAlertIds: string[];
  failurePrediction: string;
  riskPrediction: string;
}

export interface CpvAlertRuleRecord {
  id: string;
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  moduleName: string;
  parameterType: string;
  conditionType: (typeof CONDITION_TYPES)[number];
  thresholdValue: number;
  comparisonOperator: (typeof COMPARISON_OPERATORS)[number];
  priority: AlertPriority;
  severity: AlertSeverity;
  alertCategory: AlertCategory;
  autoCreateDeviation: boolean;
  autoCreateOos: boolean;
  autoSuggestCapa: boolean;
  notifyRole: string;
  escalationRole: string;
  deliveryChannels: DeliveryChannel[];
  slaHours: number;
  dueDays: number;
  repeatAlertSuppressionHours: number;
  status: 'Active' | 'Inactive';
  remarks: string;
  changeReason?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  isDeleted: boolean;
  [key: string]: unknown;
}

export interface CpvAlertRecord {
  id: string;
  alertId: string;
  alertNumber: string;
  alertTitle: string;
  alertSource: AlertSource;
  moduleName: string;
  productName: string;
  productCode: string;
  batchNumber: string;
  parameterName: string;
  observedValue: number | string;
  limitValue: number | string;
  alertType: AlertType;
  alertCategory: AlertCategory;
  alertPriority: AlertPriority;
  alertSeverity: AlertSeverity;
  alertStatus: AlertStatus;
  riskLevel: RiskLevel;
  alertMessage: string;
  detectedDateTime: string;
  assignedTo: string;
  assignedRole: string;
  dueDate: string;
  slaHours: number;
  escalatedAt: string;
  escalationLevel: number;
  acknowledgedBy: string;
  acknowledgedDateTime: string;
  closedBy: string;
  closedDateTime: string;
  closureRemarks: string;
  linkedDeviationNumber: string;
  linkedOosNumber: string;
  linkedCapaNumber: string;
  linkedRiskNumber: string;
  sourceRecordId: string;
  deliveryChannels: DeliveryChannel[];
  aiIntelligence: AlertAiIntelligence;
  changeReason: string;
  electronicSignature: boolean;
  timeline: AlertTimelineEntry[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
  [key: string]: unknown;
}

export interface CpvAlertSummary {
  total: number;
  open: number;
  critical: number;
  high: number;
  acknowledged: number;
  overdue: number;
  deviationLinked: number;
  oosLinked: number;
  capaLinked: number;
  closed: number;
}

const requiredText = z.string().trim().min(1, 'Required');

export const cpvAlertFormSchema = z.object({
  alertTitle: requiredText,
  alertSource: z.enum(ALERT_SOURCES),
  moduleName: requiredText,
  productName: requiredText,
  productCode: z.string().trim().optional().default(''),
  batchNumber: z.string().trim().optional().default(''),
  parameterName: z.string().trim().optional().default(''),
  observedValue: z.union([z.coerce.number(), z.string()]).optional().default(''),
  limitValue: z.union([z.coerce.number(), z.string()]).optional().default(''),
  alertType: z.enum(ALERT_TYPES),
  alertCategory: z.enum(ALERT_CATEGORIES).optional().default('Operational'),
  alertPriority: z.enum(ALERT_PRIORITIES),
  alertSeverity: z.enum(ALERT_SEVERITIES),
  alertMessage: requiredText,
  assignedTo: z.string().trim().optional().default(''),
  assignedRole: z.string().trim().optional().default(''),
  dueDate: z.string().trim().optional().default(''),
  deliveryChannels: z.array(z.enum(DELIVERY_CHANNELS)).optional().default(['In-App', 'Toast']),
  changeReason: z.string().trim().min(5, 'Change reason must be at least 5 characters'),
}).superRefine((data, ctx) => {
  if (['High', 'Critical', 'Emergency'].includes(data.alertPriority) && !data.assignedRole && !data.assignedTo) {
    ctx.addIssue({ code: 'custom', message: 'Assigned role or user required for High/Critical/Emergency alerts', path: ['assignedRole'] });
  }
});

export const cpvAlertRuleFormSchema = z.object({
  ruleName: requiredText,
  ruleCode: requiredText,
  moduleName: requiredText,
  parameterType: z.string().trim().optional().default(''),
  conditionType: z.enum(CONDITION_TYPES),
  thresholdValue: z.coerce.number(),
  comparisonOperator: z.enum(COMPARISON_OPERATORS),
  priority: z.enum(ALERT_PRIORITIES),
  severity: z.enum(ALERT_SEVERITIES),
  alertCategory: z.enum(ALERT_CATEGORIES).optional().default('Quality'),
  autoCreateDeviation: z.boolean().default(false),
  autoCreateOos: z.boolean().default(false),
  autoSuggestCapa: z.boolean().default(false),
  notifyRole: z.string().trim().optional().default('qa'),
  escalationRole: z.string().trim().optional().default('head_qa'),
  deliveryChannels: z.array(z.enum(DELIVERY_CHANNELS)).optional().default(['In-App', 'Email']),
  slaHours: z.coerce.number().int().min(1).default(24),
  dueDays: z.coerce.number().int().min(1).default(3),
  repeatAlertSuppressionHours: z.coerce.number().int().min(0).default(24),
  status: z.enum(['Active', 'Inactive']).default('Active'),
  remarks: z.string().trim().optional().default(''),
  changeReason: z.string().trim().min(5, 'Change reason must be at least 5 characters'),
});

export type CpvAlertFormData = z.infer<typeof cpvAlertFormSchema>;
export type CpvAlertRuleFormData = z.infer<typeof cpvAlertRuleFormSchema>;

export function emptyAlertAiIntelligence(): AlertAiIntelligence {
  return {
    aiConfidenceScore: 0,
    aiRootCauseSuggestion: '',
    aiRecommendedActions: '',
    aiClusterId: '',
    isPredictive: false,
    duplicateSuppressed: false,
    noiseReductionApplied: false,
    correlatedAlertIds: [],
    failurePrediction: '',
    riskPrediction: '',
  };
}

export function computeAlertIntelligence(input: {
  alertType: string;
  alertPriority: string;
  alertSource: string;
  observedValue?: number | string;
  limitValue?: number | string;
  productName?: string;
  parameterName?: string;
}): AlertAiIntelligence {
  const priority = input.alertPriority;
  const type = input.alertType.toLowerCase();
  let confidence = 62;
  if (['Critical', 'Emergency'].includes(priority)) confidence += 18;
  else if (priority === 'High') confidence += 10;
  if (type.includes('oos') || type.includes('ooc') || type.includes('failure')) confidence += 8;
  if (type.includes('predict') || type.includes('ai')) confidence += 5;
  confidence = Math.max(40, Math.min(99, confidence));

  const rootCauses: string[] = [];
  if (type.includes('oos') || type.includes('cqa')) rootCauses.push('Possible assay/specification drift or sampling error');
  if (type.includes('cpp') || type.includes('limit')) rootCauses.push('Process parameter drift or equipment set-point change');
  if (type.includes('environ') || type.includes('temp') || type.includes('humid')) rootCauses.push('HVAC / cleanroom control excursion');
  if (type.includes('yield')) rootCauses.push('Material loss, process inefficiency, or batch size variance');
  if (type.includes('cpk') || type.includes('capability') || type.includes('sigma')) rootCauses.push('Increased process variation or mean shift');
  if (type.includes('spc') || type.includes('western') || type.includes('nelson')) rootCauses.push('Special-cause variation detected by control chart rules');
  if (!rootCauses.length) rootCauses.push('Review source module data and recent process changes');

  const actions: string[] = [];
  if (['Critical', 'Emergency', 'High'].includes(priority)) actions.push('Acknowledge within SLA and notify QA');
  if (type.includes('oos')) actions.push('Initiate OOS investigation workflow');
  if (type.includes('deviation') || type.includes('excursion') || type.includes('hold')) actions.push('Evaluate deviation draft linkage');
  if (type.includes('capa') || type.includes('repeated')) actions.push('Review CAPA effectiveness / recurrence');
  if (type.includes('cpk') || type.includes('capability')) actions.push('Trigger process capability / risk reassessment');
  actions.push('Document ALCOA+ change reason and retain audit trail');

  const isPredictive = type.includes('ai') || type.includes('predict') || type.includes('trend') || type.includes('capability');
  const clusterSeed = `${input.alertSource}|${input.parameterName || ''}|${input.alertType}`.replace(/\s+/g, '_').slice(0, 80);

  return {
    aiConfidenceScore: confidence,
    aiRootCauseSuggestion: rootCauses.join('; '),
    aiRecommendedActions: actions.join('; '),
    aiClusterId: `CLU-${clusterSeed}`,
    isPredictive,
    duplicateSuppressed: false,
    noiseReductionApplied: true,
    correlatedAlertIds: [],
    failurePrediction: isPredictive
      ? `Elevated failure risk for ${input.parameterName || input.productName || 'process'} if untreated`
      : 'No immediate failure prediction',
    riskPrediction: ['Critical', 'Emergency'].includes(priority)
      ? 'High residual quality/compliance risk'
      : priority === 'High'
        ? 'Moderate residual risk pending mitigation'
        : 'Contained operational risk',
  };
}

export const DEFAULT_ALERT_RULES: Omit<CpvAlertRuleRecord, 'id' | 'ruleId' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'isDeleted'>[] = [
  { ruleCode: 'CPP-OOT', ruleName: 'CPP outside limit', moduleName: 'CPP Monitoring', parameterType: 'CPP', conditionType: 'Value Outside Limit', thresholdValue: 0, comparisonOperator: 'Outside Range', priority: 'High', severity: 'Major', alertCategory: 'Manufacturing', autoCreateDeviation: true, autoCreateOos: false, autoSuggestCapa: false, notifyRole: 'production', escalationRole: 'qa', deliveryChannels: ['In-App', 'Email', 'Toast'], slaHours: 24, dueDays: 3, repeatAlertSuppressionHours: 24, status: 'Active', remarks: 'CPP OOT/OOS triggers deviation draft' },
  { ruleCode: 'CQA-OOS', ruleName: 'CQA outside specification', moduleName: 'CQA Monitoring', parameterType: 'CQA', conditionType: 'Action Limit Crossed', thresholdValue: 0, comparisonOperator: 'Outside Range', priority: 'Critical', severity: 'Critical', alertCategory: 'Quality', autoCreateDeviation: false, autoCreateOos: true, autoSuggestCapa: false, notifyRole: 'qc', escalationRole: 'head_qa', deliveryChannels: ['In-App', 'Email', 'SMS', 'Toast'], slaHours: 8, dueDays: 1, repeatAlertSuppressionHours: 12, status: 'Active', remarks: 'CQA OOS triggers OOS draft' },
  { ruleCode: 'STAB-OOS', ruleName: 'Stability OOS', moduleName: 'Stability Monitoring', parameterType: 'Stability', conditionType: 'Action Limit Crossed', thresholdValue: 0, comparisonOperator: '=', priority: 'Critical', severity: 'Critical', alertCategory: 'Quality', autoCreateDeviation: false, autoCreateOos: true, autoSuggestCapa: false, notifyRole: 'qc', escalationRole: 'head_qa', deliveryChannels: ['In-App', 'Email'], slaHours: 8, dueDays: 1, repeatAlertSuppressionHours: 24, status: 'Active', remarks: '' },
  { ruleCode: 'UTIL-EXC', ruleName: 'Utility excursion', moduleName: 'Utility Monitoring', parameterType: 'Utility', conditionType: 'Alert Limit Crossed', thresholdValue: 0, comparisonOperator: 'Outside Range', priority: 'High', severity: 'Major', alertCategory: 'Utility', autoCreateDeviation: true, autoCreateOos: false, autoSuggestCapa: false, notifyRole: 'engineering', escalationRole: 'qa', deliveryChannels: ['In-App', 'Email'], slaHours: 12, dueDays: 2, repeatAlertSuppressionHours: 24, status: 'Active', remarks: '' },
  { ruleCode: 'ENV-GRA', ruleName: 'Environmental Grade A excursion', moduleName: 'Environmental Monitoring', parameterType: 'Environmental', conditionType: 'Alert Limit Crossed', thresholdValue: 0, comparisonOperator: 'Outside Range', priority: 'Critical', severity: 'Critical', alertCategory: 'Environmental', autoCreateDeviation: true, autoCreateOos: false, autoSuggestCapa: false, notifyRole: 'engineering', escalationRole: 'head_qa', deliveryChannels: ['In-App', 'Email', 'SMS'], slaHours: 4, dueDays: 1, repeatAlertSuppressionHours: 12, status: 'Active', remarks: '' },
  { ruleCode: 'HOLD-EXC', ruleName: 'Hold Time exceeded', moduleName: 'Hold Time Monitoring', parameterType: 'Hold Time', conditionType: 'Value Outside Limit', thresholdValue: 0, comparisonOperator: '>', priority: 'High', severity: 'Major', alertCategory: 'Manufacturing', autoCreateDeviation: true, autoCreateOos: false, autoSuggestCapa: false, notifyRole: 'production', escalationRole: 'qa', deliveryChannels: ['In-App', 'Toast'], slaHours: 12, dueDays: 2, repeatAlertSuppressionHours: 24, status: 'Active', remarks: '' },
  { ruleCode: 'CPK-133', ruleName: 'Cpk below 1.33', moduleName: 'Process Capability', parameterType: 'Capability', conditionType: 'Cpk Below Threshold', thresholdValue: 1.33, comparisonOperator: '<', priority: 'Medium', severity: 'Warning', alertCategory: 'Predictive', autoCreateDeviation: false, autoCreateOos: false, autoSuggestCapa: false, notifyRole: 'qa', escalationRole: 'head_qa', deliveryChannels: ['In-App'], slaHours: 48, dueDays: 7, repeatAlertSuppressionHours: 48, status: 'Active', remarks: 'Suggest risk record' },
  { ruleCode: 'CPK-100', ruleName: 'Cpk below 1.0', moduleName: 'Process Capability', parameterType: 'Capability', conditionType: 'Cpk Below Threshold', thresholdValue: 1.0, comparisonOperator: '<', priority: 'High', severity: 'Major', alertCategory: 'Predictive', autoCreateDeviation: false, autoCreateOos: false, autoSuggestCapa: true, notifyRole: 'qa', escalationRole: 'head_qa', deliveryChannels: ['In-App', 'Email'], slaHours: 24, dueDays: 3, repeatAlertSuppressionHours: 48, status: 'Active', remarks: '' },
  { ruleCode: 'SPC-WE', ruleName: 'SPC Western Electric / Nelson', moduleName: 'SPC', parameterType: 'SPC', conditionType: 'SPC Rule Violation', thresholdValue: 0, comparisonOperator: '!=', priority: 'High', severity: 'Major', alertCategory: 'Quality', autoCreateDeviation: true, autoCreateOos: false, autoSuggestCapa: false, notifyRole: 'qa', escalationRole: 'head_qa', deliveryChannels: ['In-App', 'Email'], slaHours: 24, dueDays: 2, repeatAlertSuppressionHours: 24, status: 'Active', remarks: '' },
  { ruleCode: 'PACK-MIS', ruleName: 'Packing reconciliation mismatch', moduleName: 'Packing Material Monitoring', parameterType: 'Packing', conditionType: 'Repeated Failure', thresholdValue: 0, comparisonOperator: '!=', priority: 'High', severity: 'Major', alertCategory: 'Operational', autoCreateDeviation: true, autoCreateOos: false, autoSuggestCapa: false, notifyRole: 'production', escalationRole: 'qa', deliveryChannels: ['In-App'], slaHours: 24, dueDays: 2, repeatAlertSuppressionHours: 24, status: 'Active', remarks: '' },
  { ruleCode: 'CAPA-OVD', ruleName: 'CAPA overdue', moduleName: 'CAPA', parameterType: 'CAPA', conditionType: 'Overdue', thresholdValue: 0, comparisonOperator: '>', priority: 'High', severity: 'Major', alertCategory: 'Compliance', autoCreateDeviation: false, autoCreateOos: false, autoSuggestCapa: false, notifyRole: 'qa', escalationRole: 'head_qa', deliveryChannels: ['In-App', 'Email'], slaHours: 8, dueDays: 1, repeatAlertSuppressionHours: 24, status: 'Active', remarks: '' },
  { ruleCode: 'REV-DUE', ruleName: 'CPV annual review due', moduleName: 'Annual CPV Review', parameterType: 'Review', conditionType: 'Overdue', thresholdValue: 0, comparisonOperator: '>', priority: 'Medium', severity: 'Warning', alertCategory: 'Compliance', autoCreateDeviation: false, autoCreateOos: false, autoSuggestCapa: false, notifyRole: 'qa', escalationRole: 'head_qa', deliveryChannels: ['In-App', 'Email'], slaHours: 72, dueDays: 7, repeatAlertSuppressionHours: 72, status: 'Active', remarks: '' },
  { ruleCode: 'SEC-LOGIN', ruleName: 'Security login failure cluster', moduleName: 'Security Logs', parameterType: 'Security', conditionType: 'Repeated Failure', thresholdValue: 5, comparisonOperator: '>', priority: 'Emergency', severity: 'Emergency', alertCategory: 'Security', autoCreateDeviation: false, autoCreateOos: false, autoSuggestCapa: false, notifyRole: 'admin', escalationRole: 'super_admin', deliveryChannels: ['In-App', 'Email', 'SMS'], slaHours: 1, dueDays: 1, repeatAlertSuppressionHours: 6, status: 'Active', remarks: '' },
  { ruleCode: 'SYS-HEALTH', ruleName: 'System health failure', moduleName: 'System Health', parameterType: 'System', conditionType: 'Repeated Failure', thresholdValue: 0, comparisonOperator: '!=', priority: 'Critical', severity: 'Critical', alertCategory: 'System', autoCreateDeviation: false, autoCreateOos: false, autoSuggestCapa: false, notifyRole: 'admin', escalationRole: 'super_admin', deliveryChannels: ['In-App', 'Email'], slaHours: 2, dueDays: 1, repeatAlertSuppressionHours: 6, status: 'Active', remarks: '' },
];

export function buildDefaultAlertRules(): CpvAlertRuleRecord[] {
  return DEFAULT_ALERT_RULES.map((r, i) => ({
    ...r,
    id: `default-${i}`,
    ruleId: `RULE-${r.ruleCode}`,
    createdAt: '',
    updatedAt: '',
    createdBy: 'system',
    updatedBy: 'system',
    isDeleted: false,
  })) as CpvAlertRuleRecord[];
}

export function buildAlertId(): string {
  return `ALT-${Date.now()}`;
}

export function generateAlertNumber(year: number, existingCount: number): string {
  return `ALT/${year}/${String(existingCount + 1).padStart(4, '0')}`;
}

export function summarizeAlerts(records: CpvAlertRecord[]): CpvAlertSummary {
  const active = records.filter((r) => !r.isDeleted);
  const now = new Date();
  return {
    total: active.length,
    open: active.filter((r) => r.alertStatus === 'Open').length,
    critical: active.filter((r) => ['Critical', 'Emergency'].includes(r.alertPriority) && !['Closed', 'Rejected'].includes(r.alertStatus)).length,
    high: active.filter((r) => r.alertPriority === 'High' && !['Closed', 'Rejected'].includes(r.alertStatus)).length,
    acknowledged: active.filter((r) => r.alertStatus === 'Acknowledged').length,
    overdue: active.filter((r) => {
      if (['Closed', 'Rejected'].includes(r.alertStatus)) return false;
      const due = new Date(r.dueDate);
      return !Number.isNaN(due.getTime()) && due < now;
    }).length,
    deviationLinked: active.filter((r) => r.alertStatus === 'Linked to Deviation' || r.linkedDeviationNumber).length,
    oosLinked: active.filter((r) => r.alertStatus === 'Linked to OOS' || r.linkedOosNumber).length,
    capaLinked: active.filter((r) => r.alertStatus === 'Linked to CAPA' || r.linkedCapaNumber).length,
    closed: active.filter((r) => r.alertStatus === 'Closed').length,
  };
}

export function buildAlertCharts(records: CpvAlertRecord[]) {
  const active = records.filter((r) => !r.isDeleted);
  const bySource = new Map<string, number>();
  const byPriority = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const byProduct = new Map<string, number>();
  const byParameter = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const criticalByMonth = new Map<string, number>();

  active.forEach((r) => {
    bySource.set(r.alertSource, (bySource.get(r.alertSource) || 0) + 1);
    byPriority.set(r.alertPriority, (byPriority.get(r.alertPriority) || 0) + 1);
    byStatus.set(r.alertStatus, (byStatus.get(r.alertStatus) || 0) + 1);
    byProduct.set(r.productName || 'Unknown', (byProduct.get(r.productName || 'Unknown') || 0) + 1);
    byParameter.set(r.parameterName || 'Unknown', (byParameter.get(r.parameterName || 'Unknown') || 0) + 1);
    const month = String(r.detectedDateTime || r.createdAt || '').slice(0, 7);
    if (month) {
      byMonth.set(month, (byMonth.get(month) || 0) + 1);
      if (r.alertPriority === 'Critical') criticalByMonth.set(month, (criticalByMonth.get(month) || 0) + 1);
    }
  });

  const mapToChart = (m: Map<string, number>) => Array.from(m.entries()).map(([name, value]) => ({ name, value }));

  return {
    trendByMonth: mapToChart(byMonth),
    bySource: mapToChart(bySource),
    byPriority: mapToChart(byPriority),
    byStatus: mapToChart(byStatus),
    byProduct: mapToChart(byProduct).slice(0, 10),
    byParameter: mapToChart(byParameter).slice(0, 10),
    criticalTrend: mapToChart(criticalByMonth),
  };
}

export function priorityColor(priority: string): string {
  if (priority === 'Emergency') return '#7f1d1d';
  if (priority === 'Critical') return '#991b1b';
  if (priority === 'High') return '#dc2626';
  if (priority === 'Medium') return '#d97706';
  return '#059669';
}

export function inferAlertCategory(source: string, type: string, priority: string): AlertCategory {
  if (priority === 'Emergency' || type.toLowerCase().includes('security')) return 'Security';
  if (source.includes('Environmental')) return 'Environmental';
  if (source.includes('Utility')) return 'Utility';
  if (source.includes('System') || type.toLowerCase().includes('system')) return 'System';
  if (type.toLowerCase().includes('predict') || type.toLowerCase().includes('ai') || source.includes('Capability')) return 'Predictive';
  if (source.includes('CAPA') || source.includes('Deviation') || source.includes('Annual')) return 'Compliance';
  if (source.includes('CPP') || source.includes('Yield') || source.includes('Hold')) return 'Manufacturing';
  if (['Critical', 'High'].includes(priority)) return 'Quality';
  if (priority === 'Low') return 'Informational';
  return 'Operational';
}

export function canAcknowledgeAlertSource(role: string | undefined, source: AlertSource): boolean {
  if (!role) return false;
  if (['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role)) return true;
  if (['qc', 'qc_manager'].includes(role)) return ['CQA Monitoring', 'Stability Monitoring'].includes(source);
  if (['production', 'production_manager'].includes(role)) return ['CPP Monitoring', 'Yield Monitoring'].includes(source);
  if (['engineering', 'engineering_manager'].includes(role)) return ['Utility Monitoring', 'Environmental Monitoring'].includes(source);
  return false;
}

export function canConfigureAlertRules(role?: string): boolean {
  return ['super_admin', 'admin'].includes(role || '');
}

export function canViewAlerts(role?: string): boolean {
  return [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'qc', 'qc_manager', 'production', 'production_manager',
    'engineering', 'engineering_manager', 'viewer', 'auditor',
  ].includes(role || '');
}

export function canManageAlerts(role?: string): boolean {
  return ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || '');
}

export function isAlertsViewOnly(role?: string): boolean {
  return ['viewer', 'auditor'].includes(role || '');
}

export function mapLegacySeverity(severity: string): AlertSeverity {
  const map: Record<string, AlertSeverity> = {
    Low: 'Information', Medium: 'Warning', High: 'Major', Critical: 'Critical', Emergency: 'Emergency',
    Information: 'Information', Warning: 'Warning', Major: 'Major',
  };
  return map[severity] || 'Warning';
}

export function mapLegacyPriority(severity: string): AlertPriority {
  const map: Record<string, AlertPriority> = {
    Low: 'Low', Medium: 'Medium', High: 'High', Critical: 'Critical', Emergency: 'Emergency',
  };
  return map[severity] || 'Medium';
}

export function inferAlertFromRecord(
  moduleName: AlertSource,
  record: Record<string, unknown>,
  rule?: Partial<CpvAlertRuleRecord>,
): Partial<CpvAlertFormData> | null {
  const status = String(record.status || record.result_status || record.complianceStatus || record.spcStatus || record.trendStatus || '').toLowerCase();
  const riskLevel = String(record.riskLevel || record.risk_level || '');
  const cpk = Number(record.cpk);
  const productName = String(record.productName || record.product_name || record.area || 'Unknown');
  const batchNumber = String(record.batchNumber || record.batchNo || record.batch_number || '');
  const parameterName = String(record.parameterName || record.testParameter || record.parameter_name || record.stage || '');

  if (['alert', 'action', 'oot', 'oos', 'excursion', 'exceeded', 'not capable', 'out of control', 'fail', 'does not comply'].some((s) => status.includes(s))) {
    const isOos = status.includes('oos') || status.includes('fail');
    const isCritical = riskLevel === 'Critical' || moduleName === 'Environmental Monitoring';
    return {
      alertTitle: `${moduleName} ${isOos ? 'OOS' : 'Alert'}`,
      alertSource: moduleName,
      moduleName,
      productName,
      batchNumber,
      parameterName,
      observedValue: Number(record.observedValue ?? record.actualYield ?? record.yieldPercentage ?? 0),
      limitValue: Number(record.usl ?? record.lsl ?? record.allowedHoldTime ?? 0),
      alertType: isOos ? 'OOS' : status.includes('excursion') ? 'Excursion' : 'OOT',
      alertPriority: isCritical ? 'Critical' : rule?.priority || 'High',
      alertSeverity: isCritical ? 'Critical' : rule?.severity || 'Major',
      alertMessage: `${parameterName || moduleName} status ${status} for ${productName}${batchNumber ? ` batch ${batchNumber}` : ''}`,
      assignedRole: rule?.notifyRole || 'qa',
    };
  }

  if (Number.isFinite(cpk) && cpk > 0 && cpk < (rule?.thresholdValue || 1.33)) {
    return {
      alertTitle: `Cpk below threshold (${cpk.toFixed(2)})`,
      alertSource: 'Process Capability',
      moduleName: 'Process Capability',
      productName,
      batchNumber,
      parameterName,
      observedValue: cpk,
      limitValue: rule?.thresholdValue || 1.33,
      alertType: 'Cpk Below Limit',
      alertPriority: cpk < 1.0 ? 'High' : 'Medium',
      alertSeverity: cpk < 1.0 ? 'Major' : 'Warning',
      alertMessage: `Process capability Cpk ${cpk.toFixed(2)} below threshold for ${parameterName || productName}`,
      assignedRole: 'qa',
    };
  }

  if (['High', 'Critical'].includes(riskLevel)) {
    return {
      alertTitle: `${riskLevel} risk detected`,
      alertSource: 'Risk Assessment',
      moduleName: 'Risk Assessment',
      productName,
      batchNumber,
      parameterName,
      alertType: riskLevel === 'Critical' ? 'Critical Risk' : 'High Risk',
      alertPriority: riskLevel as AlertPriority,
      alertSeverity: riskLevel === 'Critical' ? 'Critical' : 'Major',
      alertMessage: String(record.riskDescription || record.risk_description || `Risk level ${riskLevel}`),
      assignedRole: 'qa',
    };
  }

  return null;
}
