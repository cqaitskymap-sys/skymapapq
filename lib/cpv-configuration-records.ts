import { z } from 'zod';

export const CPV_CONFIGURATION_MODULE = 'CPV Configuration';

export const CPV_CONFIG_COLLECTIONS = {
  main: 'cpv_configuration',
  // Product CPV Settings live on dedicated config collection to avoid colliding
  // with CPV Product Master records on `cpv_products`.
  products: 'cpv_config_products',
  parameters: 'parameters',
  cppParameters: 'cpp_parameters',
  cqaParameters: 'cqa_parameters',
  reviewFrequency: 'cpv_review_frequency',
  limitRules: 'cpv_limit_rules',
  alertRules: 'cpv_alert_rules',
  reportTemplates: 'cpv_report_templates',
  workflows: 'cpv_workflows',
  integrationMapping: 'cpv_integration_mapping',
} as const;

export const LEGACY_CONFIG_COLLECTIONS = {
  products: 'cpv_config_products',
  cppMaster: 'cpv_config_cpp_master',
  cqaMaster: 'cpv_config_cqa_master',
  limits: 'cpv_config_limit_master',
  review: 'cpv_config_review',
  workflow: 'cpv_config_workflow',
} as const;

export const REVIEW_FREQUENCY_OPTIONS = ['Monthly', 'Quarterly', 'Half Yearly', 'Yearly'] as const;
export const STATUS_OPTIONS = ['Active', 'Inactive'] as const;
export const REVIEW_MODULE_OPTIONS = ['CPP', 'CQA', 'Yield', 'Stability', 'Risk', 'Annual CPV Review'] as const;
export const CRITICALITY_OPTIONS = ['Low', 'Medium', 'High', 'Critical'] as const;
export const RESULT_TYPE_OPTIONS = ['Numeric', 'Qualitative', 'Limit'] as const;
export const RISK_METHOD_OPTIONS = ['RPN', 'Matrix', 'Qualitative'] as const;
export const CHART_TYPE_OPTIONS = ['Individuals Chart', 'X-Bar R Chart', 'X-Bar S Chart', 'P Chart', 'NP Chart'] as const;

export const ANNUAL_REVIEW_SECTIONS = [
  'Product Summary', 'Batch Summary', 'CPP Review', 'CQA Review', 'Material Review',
  'Packing Review', 'Utility Review', 'Environmental Review', 'Yield Review',
  'Stability Review', 'Hold Time Review', 'Process Capability', 'Trend Analysis',
  'SPC Review', 'Risk Assessment', 'Deviation Review', 'OOS Review', 'CAPA Review',
  'Change Control Review', 'Conclusion', 'Approval',
] as const;

export type ConfigurationSectionId =
  | 'general'
  | 'global'
  | 'product'
  | 'cpp'
  | 'cqa'
  | 'limits'
  | 'review-frequency'
  | 'alert-rules'
  | 'capability'
  | 'spc'
  | 'risk'
  | 'ai'
  | 'notification'
  | 'annual-template'
  | 'workflow'
  | 'data-source'
  | 'dashboard'
  | 'export'
  | 'security'
  | 'backup'
  | 'feature-flags';

export const CONFIGURATION_SECTIONS: Array<{
  id: ConfigurationSectionId;
  label: string;
  description: string;
  collection?: keyof typeof CPV_CONFIG_COLLECTIONS;
  singleton?: boolean;
}> = [
  { id: 'general', label: 'General CPV Settings', description: 'Global CPV automation and review defaults', singleton: true },
  { id: 'global', label: 'Global / Organization', description: 'Plant, site, locale, calendar and environment', singleton: true },
  { id: 'product', label: 'Product CPV Settings', description: 'Product-level CPV scope and ownership', collection: 'products' },
  { id: 'cpp', label: 'CPP Configuration', description: 'Critical process parameter limits and rules', collection: 'cppParameters' },
  { id: 'cqa', label: 'CQA Configuration', description: 'Critical quality attribute specifications', collection: 'cqaParameters' },
  { id: 'limits', label: 'Limit & Threshold Rules', description: 'Alert/action limits and trigger rules', collection: 'limitRules' },
  { id: 'review-frequency', label: 'Review Frequency', description: 'Module review schedules and escalation', collection: 'reviewFrequency' },
  { id: 'alert-rules', label: 'Alert Rule Configuration', description: 'Automated alert generation rules', collection: 'alertRules' },
  { id: 'capability', label: 'Process Capability Settings', description: 'Cpk thresholds and automation', singleton: true },
  { id: 'spc', label: 'SPC Settings', description: 'Control chart rules and automation', singleton: true },
  { id: 'risk', label: 'Risk Scoring Settings', description: 'RPN scales and CAPA triggers', singleton: true },
  { id: 'ai', label: 'AI Configuration', description: 'Prediction engine, thresholds and module toggles', singleton: true },
  { id: 'notification', label: 'Notification Settings', description: 'Channels, templates, quiet hours and retries', singleton: true },
  { id: 'annual-template', label: 'Annual Review Template', description: 'Annual CPV review document structure', collection: 'reportTemplates' },
  { id: 'workflow', label: 'Approval Workflow Mapping', description: 'Module approval chains', collection: 'workflows' },
  { id: 'data-source', label: 'Integration / Data Mapping', description: 'CPV section to source system mapping', collection: 'integrationMapping' },
  { id: 'dashboard', label: 'Dashboard Settings', description: 'KPI widgets, role layouts and theme defaults', singleton: true },
  { id: 'export', label: 'Export & Report Settings', description: 'PDF/Excel/CSV export options', singleton: true },
  { id: 'security', label: 'Security Configuration', description: 'Session, MFA and Part 11 controls', singleton: true },
  { id: 'backup', label: 'Backup & Restore', description: 'Retention, schedule and verification', singleton: true },
  { id: 'feature-flags', label: 'Feature Flags', description: 'Module enablement and rollout controls', singleton: true },
];

const requiredText = z.string().trim().min(1, 'Required');
const finiteNumber = z.coerce.number().finite();
const statusField = z.enum(STATUS_OPTIONS).default('Active');

const auditMetaSchema = z.object({
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
  isDeleted: z.boolean().optional(),
});

export const generalSettingsSchema = z.object({
  cpvEnabled: z.boolean().default(true),
  defaultReviewFrequency: z.enum(REVIEW_FREQUENCY_OPTIONS),
  defaultReviewPeriod: z.string().trim().optional().default('Calendar Year'),
  defaultProductOwnerRole: z.string().trim().default('production'),
  defaultQaReviewerRole: z.string().trim().default('qa'),
  defaultFinalApproverRole: z.string().trim().default('head_qa'),
  autoGenerateCpvReviewNumber: z.boolean().default(true),
  autoPullDataFromModules: z.boolean().default(true),
  autoCreateAlerts: z.boolean().default(true),
  autoCreateRiskRecords: z.boolean().default(true),
  autoSuggestCapa: z.boolean().default(true),
  requireESignatureForApproval: z.boolean().default(true),
  allowQaOverride: z.boolean().default(false),
  configurationVersion: z.string().trim().optional().default('1.0'),
  status: statusField,
}).merge(auditMetaSchema);

export const globalOrgSettingsSchema = z.object({
  organizationName: z.string().trim().default(''),
  companyName: z.string().trim().default(''),
  plantName: z.string().trim().default(''),
  siteName: z.string().trim().default(''),
  department: z.string().trim().default('Quality Assurance'),
  timeZone: z.string().trim().default('Asia/Kolkata'),
  language: z.string().trim().default('en-IN'),
  dateFormat: z.string().trim().default('DD-MMM-YYYY'),
  numberFormat: z.string().trim().default('en-IN'),
  currency: z.string().trim().default('INR'),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).default(4),
  environment: z.enum(['Development', 'Testing', 'Production']).default('Production'),
  businessCalendarEnabled: z.boolean().default(true),
  holidayCalendarEnabled: z.boolean().default(true),
  shiftCalendarEnabled: z.boolean().default(true),
  status: statusField,
}).merge(auditMetaSchema);

export const productCpvSettingsSchema = z.object({
  product: requiredText,
  productCode: z.string().trim().optional().default(''),
  cpvRequired: z.boolean().default(true),
  cpvStartDate: z.string().trim().optional().default(''),
  reviewFrequency: z.enum(REVIEW_FREQUENCY_OPTIONS).default('Yearly'),
  cpvOwner: z.string().trim().default('production'),
  qaReviewer: z.string().trim().default('qa'),
  finalApprover: z.string().trim().default('head_qa'),
  linkedCppParameters: z.string().trim().optional().default(''),
  linkedCqaParameters: z.string().trim().optional().default(''),
  linkedYieldParameters: z.string().trim().optional().default(''),
  linkedStabilityParameters: z.string().trim().optional().default(''),
  status: statusField,
}).merge(auditMetaSchema);

export const cppConfigurationSchema = z.object({
  parameterCode: requiredText,
  parameterName: requiredText,
  processStage: z.string().trim().default('Manufacturing'),
  targetValue: finiteNumber,
  lowerLimit: finiteNumber,
  upperLimit: finiteNumber,
  alertLimitLow: finiteNumber.optional().default(0),
  alertLimitHigh: finiteNumber.optional().default(0),
  actionLimitLow: finiteNumber.optional().default(0),
  actionLimitHigh: finiteNumber.optional().default(0),
  unit: requiredText,
  frequency: z.string().trim().default('Per Batch'),
  criticality: z.enum(CRITICALITY_OPTIONS).default('Medium'),
  autoDeviationRequired: z.boolean().default(false),
  autoCapaRequired: z.boolean().default(false),
  status: statusField,
}).merge(auditMetaSchema);

export const cqaConfigurationSchema = z.object({
  parameterCode: requiredText,
  parameterName: requiredText,
  testStage: z.string().trim().default('Finished Product Testing'),
  specificationNumber: z.string().trim().optional().default(''),
  stpNumber: z.string().trim().optional().default(''),
  targetValue: finiteNumber,
  lowerLimit: finiteNumber,
  upperLimit: finiteNumber,
  alertLimitLow: finiteNumber.optional().default(0),
  alertLimitHigh: finiteNumber.optional().default(0),
  actionLimitLow: finiteNumber.optional().default(0),
  actionLimitHigh: finiteNumber.optional().default(0),
  unit: requiredText,
  resultType: z.enum(RESULT_TYPE_OPTIONS).default('Numeric'),
  criticality: z.enum(CRITICALITY_OPTIONS).default('Medium'),
  oosRequired: z.boolean().default(true),
  autoCapaRequired: z.boolean().default(false),
  status: statusField,
}).merge(auditMetaSchema);

export const limitRuleSchema = z.object({
  ruleName: requiredText,
  parameterType: z.string().trim().default('CPP'),
  moduleName: z.string().trim().default('CPP Monitoring'),
  alertLimitPercent: finiteNumber.min(0).max(100).default(80),
  actionLimitPercent: finiteNumber.min(0).max(100).default(95),
  ootRule: z.string().trim().optional().default('Enabled'),
  oosRule: z.string().trim().optional().default('Enabled'),
  repeatedFailureCount: z.coerce.number().int().min(1).default(3),
  triggerDeviation: z.boolean().default(true),
  triggerOos: z.boolean().default(true),
  triggerCapa: z.boolean().default(false),
  status: statusField,
}).merge(auditMetaSchema);

export const reviewFrequencySchema = z.object({
  product: requiredText,
  moduleName: z.enum(REVIEW_MODULE_OPTIONS),
  reviewFrequency: z.enum(REVIEW_FREQUENCY_OPTIONS),
  dueDay: z.coerce.number().int().min(1).max(31).default(1),
  reminderBeforeDays: z.coerce.number().int().min(0).default(7),
  escalationAfterDays: z.coerce.number().int().min(0).default(3),
  responsibleRole: z.string().trim().default('qa'),
  reviewerRole: z.string().trim().default('head_qa'),
  status: statusField,
}).merge(auditMetaSchema);

export const alertRuleConfigSchema = z.object({
  ruleCode: requiredText,
  ruleName: requiredText,
  sourceModule: z.string().trim().default('CPP Monitoring'),
  condition: z.string().trim().default('Value Outside Limit'),
  priority: z.enum(['Low', 'Medium', 'High', 'Critical']).default('High'),
  severity: z.enum(['Information', 'Warning', 'Major', 'Critical']).default('Major'),
  notifyRole: z.string().trim().default('qa'),
  escalationRole: z.string().trim().default('head_qa'),
  autoCreateDeviation: z.boolean().default(false),
  autoCreateOos: z.boolean().default(false),
  autoSuggestCapa: z.boolean().default(false),
  status: statusField,
}).merge(auditMetaSchema);

export const capabilitySettingsSchema = z.object({
  minimumSampleCount: z.coerce.number().int().min(1).default(5),
  cpkExcellentLimit: finiteNumber.default(1.67),
  cpkAcceptableLimit: finiteNumber.default(1.33),
  cpkWarningLimit: finiteNumber.default(1.0),
  cpkCriticalLimit: finiteNumber.default(1.0),
  cpRequired: z.boolean().default(true),
  ppPpkRequired: z.boolean().default(false),
  autoRiskIfCpkBelow: finiteNumber.default(1.33),
  autoCapaIfCpkBelow: finiteNumber.default(1.0),
  cpFormula: z.string().trim().optional().default('(USL-LSL)/(6*sigma)'),
  cpkFormula: z.string().trim().optional().default('min((USL-mean),(mean-LSL))/(3*sigma)'),
  ppFormula: z.string().trim().optional().default('(USL-LSL)/(6*s)'),
  ppkFormula: z.string().trim().optional().default('min((USL-mean),(mean-LSL))/(3*s)'),
  sigmaLimits: finiteNumber.default(3),
  status: statusField,
}).merge(auditMetaSchema);

export const spcSettingsSchema = z.object({
  defaultChartType: z.enum(CHART_TYPE_OPTIONS).default('Individuals Chart'),
  enableRule1OutsideControlLimit: z.boolean().default(true),
  enableRule2SevenPointsSameSide: z.boolean().default(true),
  enableRule3SixIncreasingDecreasing: z.boolean().default(true),
  enableRule4TwoOfThreeNearLimit: z.boolean().default(true),
  enableWesternElectricRules: z.boolean().default(true),
  enableNelsonRules: z.boolean().default(true),
  enableCusum: z.boolean().default(false),
  enableEwma: z.boolean().default(false),
  ewmaLambda: finiteNumber.min(0.01).max(1).default(0.2),
  samplingFrequency: z.string().trim().optional().default('Per Batch'),
  defaultSampleSize: z.coerce.number().int().min(1).default(5),
  enableAutoRiskCreation: z.boolean().default(true),
  enableCapaSuggestion: z.boolean().default(false),
  status: statusField,
}).merge(auditMetaSchema);

export const aiSettingsSchema = z.object({
  aiEnabled: z.boolean().default(true),
  enablePredictiveAlerts: z.boolean().default(true),
  enableInsights: z.boolean().default(true),
  enableRecommendations: z.boolean().default(true),
  enableRiskPrediction: z.boolean().default(true),
  enableTrendPrediction: z.boolean().default(true),
  enableRootCauseAnalysis: z.boolean().default(true),
  enablePreventiveRecommendations: z.boolean().default(true),
  confidenceThreshold: finiteNumber.min(0).max(100).default(70),
  predictionThreshold: finiteNumber.min(0).max(100).default(65),
  enableForCpp: z.boolean().default(true),
  enableForCqa: z.boolean().default(true),
  enableForYield: z.boolean().default(true),
  enableForSpc: z.boolean().default(true),
  enableForRisk: z.boolean().default(true),
  enableForAlerts: z.boolean().default(true),
  status: statusField,
}).merge(auditMetaSchema);

export const notificationSettingsSchema = z.object({
  enableInApp: z.boolean().default(true),
  enableEmail: z.boolean().default(true),
  enableSms: z.boolean().default(false),
  enableWhatsApp: z.boolean().default(false),
  enableTeams: z.boolean().default(false),
  enableSlack: z.boolean().default(false),
  enablePush: z.boolean().default(true),
  enableFcm: z.boolean().default(true),
  reminderEnabled: z.boolean().default(true),
  reminderBeforeHours: z.coerce.number().int().min(0).default(24),
  retryAttempts: z.coerce.number().int().min(0).default(3),
  retryIntervalMinutes: z.coerce.number().int().min(1).default(15),
  quietHoursEnabled: z.boolean().default(false),
  quietHoursStart: z.string().trim().optional().default('22:00'),
  quietHoursEnd: z.string().trim().optional().default('06:00'),
  defaultTemplate: z.string().trim().optional().default('CPV Alert Standard'),
  status: statusField,
}).merge(auditMetaSchema);

export const dashboardSettingsSchema = z.object({
  enableExecutiveDashboard: z.boolean().default(true),
  enableRoleBasedLayouts: z.boolean().default(true),
  defaultTheme: z.enum(['System', 'Light', 'Dark']).default('System'),
  showKpiCards: z.boolean().default(true),
  showTrendCharts: z.boolean().default(true),
  showAlertFeed: z.boolean().default(true),
  showAiPanel: z.boolean().default(true),
  refreshIntervalSeconds: z.coerce.number().int().min(15).default(60),
  savedLayoutName: z.string().trim().optional().default('Default CPV Layout'),
  status: statusField,
}).merge(auditMetaSchema);

export const securitySettingsSchema = z.object({
  enforceRbac: z.boolean().default(true),
  requireMfaForCriticalChanges: z.boolean().default(false),
  sessionTimeoutMinutes: z.coerce.number().int().min(5).default(30),
  passwordMinLength: z.coerce.number().int().min(8).default(12),
  ipWhitelistEnabled: z.boolean().default(false),
  ipWhitelist: z.string().trim().optional().default(''),
  auditAllConfigChanges: z.boolean().default(true),
  encryptNotificationPayloads: z.boolean().default(true),
  requireEsignForConfig: z.boolean().default(true),
  status: statusField,
}).merge(auditMetaSchema);

export const backupSettingsSchema = z.object({
  autoBackupEnabled: z.boolean().default(true),
  backupFrequency: z.enum(['Daily', 'Weekly', 'Monthly']).default('Daily'),
  retentionDays: z.coerce.number().int().min(1).default(90),
  verifyAfterBackup: z.boolean().default(true),
  storeInCloudStorage: z.boolean().default(true),
  includeAuditTrail: z.boolean().default(true),
  disasterRecoveryEnabled: z.boolean().default(true),
  lastBackupAt: z.string().trim().optional().default(''),
  status: statusField,
}).merge(auditMetaSchema);

export const featureFlagsSchema = z.object({
  enableYieldModule: z.boolean().default(true),
  enableEnvironmentalModule: z.boolean().default(true),
  enableUtilityModule: z.boolean().default(true),
  enableHoldTimeModule: z.boolean().default(true),
  enableStabilityModule: z.boolean().default(true),
  enableSpcModule: z.boolean().default(true),
  enableCapabilityModule: z.boolean().default(true),
  enableRiskModule: z.boolean().default(true),
  enableAlertEngine: z.boolean().default(true),
  enableAiAnalytics: z.boolean().default(true),
  enableAnnualReview: z.boolean().default(true),
  enableReportsAnalytics: z.boolean().default(true),
  status: statusField,
}).merge(auditMetaSchema);

export const riskScoringSettingsSchema = z.object({
  riskMethod: z.enum(RISK_METHOD_OPTIONS).default('RPN'),
  severityScale: z.coerce.number().int().min(1).default(10),
  occurrenceScale: z.coerce.number().int().min(1).default(10),
  detectionScale: z.coerce.number().int().min(1).default(10),
  lowRiskMaxRpn: z.coerce.number().int().min(1).default(50),
  mediumRiskMaxRpn: z.coerce.number().int().min(1).default(100),
  highRiskMaxRpn: z.coerce.number().int().min(1).default(200),
  criticalRiskMinRpn: z.coerce.number().int().min(1).default(201),
  autoCapaForCriticalRisk: z.boolean().default(true),
  status: statusField,
}).merge(auditMetaSchema);

export const annualReviewTemplateSchema = z.object({
  templateName: requiredText,
  templateVersion: z.string().trim().default('1.0'),
  sectionsEnabled: z.array(z.string()).min(1, 'At least one section required'),
  defaultExecutiveSummaryText: z.string().trim().optional().default(''),
  defaultConclusionText: z.string().trim().optional().default(''),
  defaultRecommendationText: z.string().trim().optional().default(''),
  requireAllSectionsBeforeApproval: z.boolean().default(true),
  status: statusField,
}).merge(auditMetaSchema);

export const workflowMappingSchema = z.object({
  moduleName: requiredText,
  workflow: z.string().trim().default('Standard CPV Workflow'),
  approvalMatrix: z.string().trim().optional().default(''),
  approvalMode: z.enum(['Sequential', 'Parallel', 'Conditional']).default('Sequential'),
  eSignatureRequired: z.boolean().default(true),
  preparedByRole: z.string().trim().default('qa'),
  reviewedByRole: z.string().trim().default('qa_manager'),
  approvedByRole: z.string().trim().default('head_qa'),
  finalApproverRole: z.string().trim().default('head_qa'),
  escalationRole: z.string().trim().optional().default('head_qa'),
  slaHours: z.coerce.number().int().min(1).default(48),
  allowDelegation: z.boolean().default(true),
  autoApproveEnabled: z.boolean().default(false),
  autoRejectEnabled: z.boolean().default(false),
  notifyOnPending: z.boolean().default(true),
  status: statusField,
}).merge(auditMetaSchema);

export const dataSourceMappingSchema = z.object({
  cpvSection: requiredText,
  sourceCollection: requiredText,
  sourceFieldMapping: z.string().trim().optional().default(''),
  productField: z.string().trim().default('productName'),
  batchField: z.string().trim().default('batchNumber'),
  parameterField: z.string().trim().default('parameterName'),
  observedValueField: z.string().trim().default('observedValue'),
  dateField: z.string().trim().default('recordedDate'),
  statusField: z.string().trim().default('status'),
  riskField: z.string().trim().optional().default('riskLevel'),
  status: statusField,
}).merge(auditMetaSchema);

export const exportReportSettingsSchema = z.object({
  enablePdfExport: z.boolean().default(true),
  enableExcelExport: z.boolean().default(true),
  enableCsvExport: z.boolean().default(true),
  enablePrint: z.boolean().default(true),
  enableScheduledReports: z.boolean().default(false),
  enableEmailReports: z.boolean().default(false),
  reportHeaderSource: z.string().trim().default('Company Site Master'),
  showCompanyLogo: z.boolean().default(true),
  showPageNumber: z.boolean().default(true),
  showRevisionNumber: z.boolean().default(true),
  showESignatureBlock: z.boolean().default(true),
  showAuditTrailSummary: z.boolean().default(true),
  enableWatermark: z.boolean().default(true),
  watermarkText: z.string().trim().optional().default('CONTROLLED COPY'),
  customBrandingEnabled: z.boolean().default(true),
  status: statusField,
}).merge(auditMetaSchema);

export type GeneralSettings = z.infer<typeof generalSettingsSchema> & { id?: string };
export type GlobalOrgSettings = z.infer<typeof globalOrgSettingsSchema> & { id?: string };
export type ProductCpvSettings = z.infer<typeof productCpvSettingsSchema> & { id?: string };
export type CppConfiguration = z.infer<typeof cppConfigurationSchema> & { id?: string };
export type CqaConfiguration = z.infer<typeof cqaConfigurationSchema> & { id?: string };
export type LimitRule = z.infer<typeof limitRuleSchema> & { id?: string };
export type ReviewFrequencyConfig = z.infer<typeof reviewFrequencySchema> & { id?: string };
export type AlertRuleConfig = z.infer<typeof alertRuleConfigSchema> & { id?: string };
export type CapabilitySettings = z.infer<typeof capabilitySettingsSchema> & { id?: string };
export type SpcSettings = z.infer<typeof spcSettingsSchema> & { id?: string };
export type RiskScoringSettings = z.infer<typeof riskScoringSettingsSchema> & { id?: string };
export type AiSettings = z.infer<typeof aiSettingsSchema> & { id?: string };
export type NotificationSettings = z.infer<typeof notificationSettingsSchema> & { id?: string };
export type DashboardSettings = z.infer<typeof dashboardSettingsSchema> & { id?: string };
export type SecuritySettings = z.infer<typeof securitySettingsSchema> & { id?: string };
export type BackupSettings = z.infer<typeof backupSettingsSchema> & { id?: string };
export type FeatureFlags = z.infer<typeof featureFlagsSchema> & { id?: string };
export type AnnualReviewTemplate = z.infer<typeof annualReviewTemplateSchema> & { id?: string };
export type WorkflowMapping = z.infer<typeof workflowMappingSchema> & { id?: string };
export type DataSourceMapping = z.infer<typeof dataSourceMappingSchema> & { id?: string };
export type ExportReportSettings = z.infer<typeof exportReportSettingsSchema> & { id?: string };

export interface CpvConfigurationBundle {
  general: GeneralSettings | null;
  global: GlobalOrgSettings | null;
  products: ProductCpvSettings[];
  cppParameters: CppConfiguration[];
  cqaParameters: CqaConfiguration[];
  limitRules: LimitRule[];
  reviewFrequency: ReviewFrequencyConfig[];
  alertRules: AlertRuleConfig[];
  capability: CapabilitySettings | null;
  spc: SpcSettings | null;
  risk: RiskScoringSettings | null;
  ai: AiSettings | null;
  notification: NotificationSettings | null;
  annualTemplates: AnnualReviewTemplate[];
  workflows: WorkflowMapping[];
  dataSourceMappings: DataSourceMapping[];
  dashboard: DashboardSettings | null;
  exportSettings: ExportReportSettings | null;
  security: SecuritySettings | null;
  backup: BackupSettings | null;
  featureFlags: FeatureFlags | null;
}

export interface ConfigurationValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  completenessPct: number;
}

export const DEFAULT_GENERAL_SETTINGS: Omit<GeneralSettings, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'isDeleted'> = {
  cpvEnabled: true,
  defaultReviewFrequency: 'Yearly',
  defaultReviewPeriod: 'Calendar Year',
  defaultProductOwnerRole: 'production',
  defaultQaReviewerRole: 'qa',
  defaultFinalApproverRole: 'head_qa',
  autoGenerateCpvReviewNumber: true,
  autoPullDataFromModules: true,
  autoCreateAlerts: true,
  autoCreateRiskRecords: true,
  autoSuggestCapa: true,
  requireESignatureForApproval: true,
  allowQaOverride: false,
  configurationVersion: '1.0',
  status: 'Active',
};

export const DEFAULT_GLOBAL_ORG_SETTINGS: Omit<GlobalOrgSettings, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'isDeleted'> = {
  organizationName: 'SkyMap Pharma',
  companyName: 'SkyMap',
  plantName: '',
  siteName: '',
  department: 'Quality Assurance',
  timeZone: 'Asia/Kolkata',
  language: 'en-IN',
  dateFormat: 'DD-MMM-YYYY',
  numberFormat: 'en-IN',
  currency: 'INR',
  fiscalYearStartMonth: 4,
  environment: 'Production',
  businessCalendarEnabled: true,
  holidayCalendarEnabled: true,
  shiftCalendarEnabled: true,
  status: 'Active',
};

export const DEFAULT_CAPABILITY_SETTINGS: Omit<CapabilitySettings, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'isDeleted'> = {
  minimumSampleCount: 5,
  cpkExcellentLimit: 1.67,
  cpkAcceptableLimit: 1.33,
  cpkWarningLimit: 1.0,
  cpkCriticalLimit: 1.0,
  cpRequired: true,
  ppPpkRequired: false,
  autoRiskIfCpkBelow: 1.33,
  autoCapaIfCpkBelow: 1.0,
  cpFormula: '(USL-LSL)/(6*sigma)',
  cpkFormula: 'min((USL-mean),(mean-LSL))/(3*sigma)',
  ppFormula: '(USL-LSL)/(6*s)',
  ppkFormula: 'min((USL-mean),(mean-LSL))/(3*s)',
  sigmaLimits: 3,
  status: 'Active',
};

export const DEFAULT_SPC_SETTINGS: Omit<SpcSettings, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'isDeleted'> = {
  defaultChartType: 'Individuals Chart',
  enableRule1OutsideControlLimit: true,
  enableRule2SevenPointsSameSide: true,
  enableRule3SixIncreasingDecreasing: true,
  enableRule4TwoOfThreeNearLimit: true,
  enableWesternElectricRules: true,
  enableNelsonRules: true,
  enableCusum: false,
  enableEwma: false,
  ewmaLambda: 0.2,
  samplingFrequency: 'Per Batch',
  defaultSampleSize: 5,
  enableAutoRiskCreation: true,
  enableCapaSuggestion: false,
  status: 'Active',
};

export const DEFAULT_RISK_SETTINGS: Omit<RiskScoringSettings, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'isDeleted'> = {
  riskMethod: 'RPN',
  severityScale: 10,
  occurrenceScale: 10,
  detectionScale: 10,
  lowRiskMaxRpn: 50,
  mediumRiskMaxRpn: 100,
  highRiskMaxRpn: 200,
  criticalRiskMinRpn: 201,
  autoCapaForCriticalRisk: true,
  status: 'Active',
};

export const DEFAULT_AI_SETTINGS: Omit<AiSettings, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'isDeleted'> = {
  aiEnabled: true,
  enablePredictiveAlerts: true,
  enableInsights: true,
  enableRecommendations: true,
  enableRiskPrediction: true,
  enableTrendPrediction: true,
  enableRootCauseAnalysis: true,
  enablePreventiveRecommendations: true,
  confidenceThreshold: 70,
  predictionThreshold: 65,
  enableForCpp: true,
  enableForCqa: true,
  enableForYield: true,
  enableForSpc: true,
  enableForRisk: true,
  enableForAlerts: true,
  status: 'Active',
};

export const DEFAULT_NOTIFICATION_SETTINGS: Omit<NotificationSettings, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'isDeleted'> = {
  enableInApp: true,
  enableEmail: true,
  enableSms: false,
  enableWhatsApp: false,
  enableTeams: false,
  enableSlack: false,
  enablePush: true,
  enableFcm: true,
  reminderEnabled: true,
  reminderBeforeHours: 24,
  retryAttempts: 3,
  retryIntervalMinutes: 15,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '06:00',
  defaultTemplate: 'CPV Alert Standard',
  status: 'Active',
};

export const DEFAULT_DASHBOARD_SETTINGS: Omit<DashboardSettings, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'isDeleted'> = {
  enableExecutiveDashboard: true,
  enableRoleBasedLayouts: true,
  defaultTheme: 'System',
  showKpiCards: true,
  showTrendCharts: true,
  showAlertFeed: true,
  showAiPanel: true,
  refreshIntervalSeconds: 60,
  savedLayoutName: 'Default CPV Layout',
  status: 'Active',
};

export const DEFAULT_SECURITY_SETTINGS: Omit<SecuritySettings, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'isDeleted'> = {
  enforceRbac: true,
  requireMfaForCriticalChanges: false,
  sessionTimeoutMinutes: 30,
  passwordMinLength: 12,
  ipWhitelistEnabled: false,
  ipWhitelist: '',
  auditAllConfigChanges: true,
  encryptNotificationPayloads: true,
  requireEsignForConfig: true,
  status: 'Active',
};

export const DEFAULT_BACKUP_SETTINGS: Omit<BackupSettings, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'isDeleted'> = {
  autoBackupEnabled: true,
  backupFrequency: 'Daily',
  retentionDays: 90,
  verifyAfterBackup: true,
  storeInCloudStorage: true,
  includeAuditTrail: true,
  disasterRecoveryEnabled: true,
  lastBackupAt: '',
  status: 'Active',
};

export const DEFAULT_FEATURE_FLAGS: Omit<FeatureFlags, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'isDeleted'> = {
  enableYieldModule: true,
  enableEnvironmentalModule: true,
  enableUtilityModule: true,
  enableHoldTimeModule: true,
  enableStabilityModule: true,
  enableSpcModule: true,
  enableCapabilityModule: true,
  enableRiskModule: true,
  enableAlertEngine: true,
  enableAiAnalytics: true,
  enableAnnualReview: true,
  enableReportsAnalytics: true,
  status: 'Active',
};

export const DEFAULT_EXPORT_SETTINGS: Omit<ExportReportSettings, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'isDeleted'> = {
  enablePdfExport: true,
  enableExcelExport: true,
  enableCsvExport: true,
  enablePrint: true,
  enableScheduledReports: false,
  enableEmailReports: false,
  reportHeaderSource: 'Company Site Master',
  showCompanyLogo: true,
  showPageNumber: true,
  showRevisionNumber: true,
  showESignatureBlock: true,
  showAuditTrailSummary: true,
  enableWatermark: true,
  watermarkText: 'CONTROLLED COPY',
  customBrandingEnabled: true,
  status: 'Active',
};

export const DEFAULT_LIMIT_RULES: Omit<LimitRule, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'isDeleted'>[] = [
  {
    ruleName: 'Default Alert Limit',
    parameterType: 'All',
    moduleName: 'All Modules',
    alertLimitPercent: 80,
    actionLimitPercent: 95,
    ootRule: 'Enabled',
    oosRule: 'Enabled',
    repeatedFailureCount: 3,
    triggerDeviation: true,
    triggerOos: true,
    triggerCapa: false,
    status: 'Active',
  },
  {
    ruleName: 'Cpk Alert Threshold',
    parameterType: 'Capability',
    moduleName: 'Process Capability',
    alertLimitPercent: 0,
    actionLimitPercent: 0,
    ootRule: 'Cpk < 1.33',
    oosRule: 'Cpk < 1.00',
    repeatedFailureCount: 3,
    triggerDeviation: false,
    triggerOos: false,
    triggerCapa: true,
    status: 'Active',
  },
];

export const DEFAULT_DATA_SOURCE_MAPPINGS: Omit<DataSourceMapping, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'isDeleted'>[] = [
  { cpvSection: 'CPP Review', sourceCollection: 'cpp_results', sourceFieldMapping: '', productField: 'productName', batchField: 'batchNumber', parameterField: 'parameterName', observedValueField: 'observedValue', dateField: 'recordedDate', statusField: 'status', riskField: 'riskLevel', status: 'Active' },
  { cpvSection: 'CQA Review', sourceCollection: 'cqa_results', sourceFieldMapping: '', productField: 'productName', batchField: 'batchNumber', parameterField: 'testParameter', observedValueField: 'resultValue', dateField: 'testDate', statusField: 'status', riskField: 'riskLevel', status: 'Active' },
  { cpvSection: 'Yield Review', sourceCollection: 'yield_monitoring', sourceFieldMapping: '', productField: 'productName', batchField: 'batchNumber', parameterField: 'stage', observedValueField: 'yieldPercent', dateField: 'recordedDate', statusField: 'status', riskField: 'riskLevel', status: 'Active' },
  { cpvSection: 'Risk Review', sourceCollection: 'risk_assessment', sourceFieldMapping: '', productField: 'productName', batchField: 'batchNumber', parameterField: 'riskTitle', observedValueField: 'rpn', dateField: 'assessmentDate', statusField: 'status', riskField: 'riskLevel', status: 'Active' },
  { cpvSection: 'Annual CPV Review', sourceCollection: 'cpv_reviews', sourceFieldMapping: '', productField: 'productName', batchField: 'batchNumber', parameterField: 'reviewSection', observedValueField: 'complianceScore', dateField: 'reviewDate', statusField: 'status', riskField: 'riskLevel', status: 'Active' },
];

export const DEFAULT_ANNUAL_TEMPLATE: Omit<AnnualReviewTemplate, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'isDeleted'> = {
  templateName: 'Standard Annual CPV Review',
  templateVersion: '1.0',
  sectionsEnabled: [...ANNUAL_REVIEW_SECTIONS],
  defaultExecutiveSummaryText: 'This annual CPV review summarizes process performance, quality attributes, and risk for the review period.',
  defaultConclusionText: 'Based on the data reviewed, the process remains in a state of control.',
  defaultRecommendationText: 'Continue routine CPV monitoring and address identified gaps through the quality system.',
  requireAllSectionsBeforeApproval: true,
  status: 'Active',
};

/** In-memory defaults so the configuration UI works before Firestore is seeded. */
export function buildDefaultCpvConfigurationBundle(): CpvConfigurationBundle {
  return {
    general: { id: 'general_settings', ...DEFAULT_GENERAL_SETTINGS },
    global: { id: 'global_org_settings', ...DEFAULT_GLOBAL_ORG_SETTINGS },
    products: [],
    cppParameters: [],
    cqaParameters: [],
    limitRules: DEFAULT_LIMIT_RULES.map((rule, index) => ({ id: `default-limit-${index + 1}`, ...rule })),
    reviewFrequency: [],
    alertRules: [],
    capability: { id: 'process_capability_settings', ...DEFAULT_CAPABILITY_SETTINGS },
    spc: { id: 'spc_settings', ...DEFAULT_SPC_SETTINGS },
    risk: { id: 'risk_scoring_settings', ...DEFAULT_RISK_SETTINGS },
    ai: { id: 'ai_settings', ...DEFAULT_AI_SETTINGS },
    notification: { id: 'notification_settings', ...DEFAULT_NOTIFICATION_SETTINGS },
    annualTemplates: [{ id: 'default-annual-template', ...DEFAULT_ANNUAL_TEMPLATE }],
    workflows: [],
    dataSourceMappings: DEFAULT_DATA_SOURCE_MAPPINGS.map((row, index) => ({
      id: `default-datasource-${index + 1}`,
      ...row,
    })),
    dashboard: { id: 'dashboard_settings', ...DEFAULT_DASHBOARD_SETTINGS },
    exportSettings: { id: 'export_report_settings', ...DEFAULT_EXPORT_SETTINGS },
    security: { id: 'security_settings', ...DEFAULT_SECURITY_SETTINGS },
    backup: { id: 'backup_settings', ...DEFAULT_BACKUP_SETTINGS },
    featureFlags: { id: 'feature_flags', ...DEFAULT_FEATURE_FLAGS },
  };
}

/** Fill any missing singleton/list sections from defaults without overwriting stored values. */
export function withConfigurationDefaults(bundle: CpvConfigurationBundle): CpvConfigurationBundle {
  const defaults = buildDefaultCpvConfigurationBundle();
  return {
    general: bundle.general ?? defaults.general,
    global: bundle.global ?? defaults.global,
    products: bundle.products,
    cppParameters: bundle.cppParameters,
    cqaParameters: bundle.cqaParameters,
    limitRules: bundle.limitRules.length ? bundle.limitRules : defaults.limitRules,
    reviewFrequency: bundle.reviewFrequency,
    alertRules: bundle.alertRules,
    capability: bundle.capability ?? defaults.capability,
    spc: bundle.spc ?? defaults.spc,
    risk: bundle.risk ?? defaults.risk,
    ai: bundle.ai ?? defaults.ai,
    notification: bundle.notification ?? defaults.notification,
    annualTemplates: bundle.annualTemplates.length ? bundle.annualTemplates : defaults.annualTemplates,
    workflows: bundle.workflows,
    dataSourceMappings: bundle.dataSourceMappings.length
      ? bundle.dataSourceMappings
      : defaults.dataSourceMappings,
    dashboard: bundle.dashboard ?? defaults.dashboard,
    exportSettings: bundle.exportSettings ?? defaults.exportSettings,
    security: bundle.security ?? defaults.security,
    backup: bundle.backup ?? defaults.backup,
    featureFlags: bundle.featureFlags ?? defaults.featureFlags,
  };
}

export function summarizeConfiguration(bundle: CpvConfigurationBundle) {
  const listCounts = [
    bundle.products.length,
    bundle.cppParameters.length,
    bundle.cqaParameters.length,
    bundle.limitRules.length,
    bundle.reviewFrequency.length,
    bundle.alertRules.length,
    bundle.annualTemplates.length,
    bundle.workflows.length,
    bundle.dataSourceMappings.length,
  ];
  const singletonCount = [
    bundle.general, bundle.global, bundle.capability, bundle.spc, bundle.risk,
    bundle.ai, bundle.notification, bundle.dashboard, bundle.exportSettings,
    bundle.security, bundle.backup, bundle.featureFlags,
  ].filter(Boolean).length;
  const totalRecords = listCounts.reduce((a, b) => a + b, 0) + singletonCount;
  const activeSections = CONFIGURATION_SECTIONS.filter((section) => {
    if (section.singleton) {
      const key = section.id === 'general' ? bundle.general
        : section.id === 'global' ? bundle.global
          : section.id === 'capability' ? bundle.capability
            : section.id === 'spc' ? bundle.spc
              : section.id === 'risk' ? bundle.risk
                : section.id === 'ai' ? bundle.ai
                  : section.id === 'notification' ? bundle.notification
                    : section.id === 'dashboard' ? bundle.dashboard
                      : section.id === 'security' ? bundle.security
                        : section.id === 'backup' ? bundle.backup
                          : section.id === 'feature-flags' ? bundle.featureFlags
                            : bundle.exportSettings;
      return Boolean(key);
    }
    const map: Partial<Record<ConfigurationSectionId, unknown[]>> = {
      product: bundle.products,
      cpp: bundle.cppParameters,
      cqa: bundle.cqaParameters,
      limits: bundle.limitRules,
      'review-frequency': bundle.reviewFrequency,
      'alert-rules': bundle.alertRules,
      'annual-template': bundle.annualTemplates,
      workflow: bundle.workflows,
      'data-source': bundle.dataSourceMappings,
    };
    return (map[section.id]?.length || 0) > 0;
  }).length;
  return { totalRecords, activeSections, sectionCount: CONFIGURATION_SECTIONS.length };
}

export function validateConfiguration(bundle: CpvConfigurationBundle): ConfigurationValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!bundle.general?.cpvEnabled && bundle.general?.cpvEnabled !== false) {
    errors.push('General CPV settings are missing.');
  } else if (!bundle.general?.defaultReviewFrequency) {
    errors.push('Default Review Frequency is required.');
  }

  if (bundle.capability && bundle.capability.minimumSampleCount < 1) {
    errors.push('Minimum sample count must be at least 1.');
  }

  if (bundle.annualTemplates.some((t) => !t.sectionsEnabled?.length)) {
    errors.push('Annual review template must include at least one section.');
  }

  if (!bundle.dataSourceMappings.some((m) => m.cpvSection === 'Annual CPV Review' && m.status === 'Active')) {
    errors.push('Data source mapping for Annual CPV Review is required.');
  }

  if (!bundle.cppParameters.length) warnings.push('No CPP parameters configured.');
  if (!bundle.cqaParameters.length) warnings.push('No CQA parameters configured.');
  if (!bundle.limitRules.length) warnings.push('No limit/threshold rules configured.');
  if (!bundle.alertRules.length) warnings.push('No alert rules configured.');

  if (bundle.ai && (bundle.ai.confidenceThreshold < 0 || bundle.ai.confidenceThreshold > 100)) {
    errors.push('AI confidence threshold must be between 0 and 100.');
  }

  if (!bundle.security?.enforceRbac) {
    warnings.push('RBAC enforcement is disabled in security configuration.');
  }

  if (!bundle.global?.organizationName) warnings.push('Organization name is not configured.');
  if (!bundle.ai?.aiEnabled) warnings.push('AI engine is disabled.');

  const checks = [
    Boolean(bundle.general),
    Boolean(bundle.global),
    bundle.products.length > 0,
    bundle.cppParameters.length > 0,
    bundle.cqaParameters.length > 0,
    bundle.limitRules.length > 0,
    bundle.reviewFrequency.length > 0,
    bundle.alertRules.length > 0,
    Boolean(bundle.capability),
    Boolean(bundle.spc),
    Boolean(bundle.risk),
    Boolean(bundle.ai),
    Boolean(bundle.notification),
    bundle.annualTemplates.length > 0,
    bundle.workflows.length > 0,
    bundle.dataSourceMappings.length > 0,
    Boolean(bundle.dashboard),
    Boolean(bundle.exportSettings),
    Boolean(bundle.security),
    Boolean(bundle.backup),
    Boolean(bundle.featureFlags),
  ];
  const completenessPct = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  return { valid: errors.length === 0, errors, warnings, completenessPct };
}

export function canViewCpvConfiguration(role?: string): boolean {
  return [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager', 'auditor', 'viewer',
  ].includes(role || '');
}

export function canEditCpvConfiguration(role?: string): boolean {
  return ['super_admin', 'admin'].includes(role || '');
}

export function canSuggestCpvConfiguration(role?: string): boolean {
  return ['qa', 'head_qa', 'qa_manager'].includes(role || '');
}

export function canApproveCpvConfiguration(role?: string): boolean {
  return ['super_admin', 'head_qa'].includes(role || '');
}

export function canImportExportCpvConfiguration(role?: string): boolean {
  return ['super_admin', 'admin'].includes(role || '');
}

export function isCpvConfigurationViewOnly(role?: string): boolean {
  return ['auditor', 'viewer'].includes(role || '');
}
