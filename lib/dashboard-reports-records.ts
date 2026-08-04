export const DASHBOARD_REPORTS_MODULE = 'Reports & Analytics';

export interface ReportModuleLink {
  id: string;
  label: string;
  description: string;
  href: string;
  reportTypes: string[];
}

export interface ReportModuleCategory {
  id: string;
  label: string;
  description: string;
  modules: ReportModuleLink[];
}

export interface RecentReportActivity {
  id: string;
  moduleId: string;
  moduleLabel: string;
  reportType: string;
  reportNumber: string;
  generatedAt: string;
  generatedBy: string;
  status: string;
  totalRecords: number;
  href: string;
}

export interface DashboardReportsKpis {
  totalReports: number;
  generatedThisMonth: number;
  moduleCount: number;
  lastGeneratedAt: string | null;
}

export interface DashboardReportsData {
  kpis: DashboardReportsKpis;
  recentActivity: RecentReportActivity[];
  byModule: Array<{ module: string; count: number }>;
  error?: string;
}

export const REPORT_MODULE_CATALOG: ReportModuleCategory[] = [
  {
    id: 'qms-core',
    label: 'QMS Core',
    description: 'Deviation, OOS, CAPA, change control, complaints, and recall analytics.',
    modules: [
      {
        id: 'deviation',
        label: 'Deviation Reports',
        description: 'Deviation register, trend analysis, and management review exports.',
        href: '/qms/deviation/reports',
        reportTypes: ['Deviation Register', 'Trend Analysis', 'Management Review'],
      },
      {
        id: 'oos',
        label: 'OOS Reports',
        description: 'OOS register, investigation summary, and phase-wise analytics.',
        href: '/qms/oos/reports',
        reportTypes: ['OOS Register', 'Investigation Summary', 'CAPA Linked OOS'],
      },
      {
        id: 'capa',
        label: 'CAPA Reports',
        description: 'CAPA register, effectiveness review, and overdue tracking.',
        href: '/qms/capa/reports',
        reportTypes: ['CAPA Register', 'Effectiveness Review', 'Management Review'],
      },
      {
        id: 'change-control',
        label: 'Change Control Reports',
        description: 'Change register, impact assessment, and closure analytics.',
        href: '/qms/change-control/reports',
        reportTypes: ['Change Register', 'Impact Assessment', 'Closure Summary'],
      },
      {
        id: 'complaints',
        label: 'Complaint Reports',
        description: 'Complaint register, CAPA linkage, and regulatory response tracking.',
        href: '/qms/complaints/reports',
        reportTypes: ['Complaint Register', 'CAPA Linked', 'Recall Evaluation'],
      },
      {
        id: 'recall',
        label: 'Product Recall Reports',
        description: 'Recall register, regulatory notification, and effectiveness review.',
        href: '/qms/recall/reports',
        reportTypes: ['Recall Register', 'Regulatory Notification', 'Effectiveness Review'],
      },
      {
        id: 'risk',
        label: 'Risk Management Reports',
        description: 'Risk register, mitigation status, and management review.',
        href: '/qms/risk-management/reports',
        reportTypes: ['Risk Register', 'Mitigation Status', 'Management Review'],
      },
    ],
  },
  {
    id: 'process',
    label: 'Process & Manufacturing',
    description: 'CPV, PQR, stability, and batch manufacturing reports.',
    modules: [
      {
        id: 'cpv',
        label: 'CPV Reports & Analytics',
        description: 'CPP/CQA monitoring, SPC, annual CPV review, and trend analysis.',
        href: '/cpv/reports-analytics',
        reportTypes: ['CPV Dashboard Summary', 'Annual CPV Review', 'SPC Report'],
      },
      {
        id: 'pqr',
        label: 'Product Quality Review',
        description: 'Annual PQR compilation, batch review, and regulatory submission.',
        href: '/pqr/dashboard',
        reportTypes: ['Annual PQR', 'Batch Review', 'Stability Review'],
      },
      {
        id: 'stability',
        label: 'Stability Reports',
        description: 'Stability study reports, shelf-life data, and OOS/OOT summaries.',
        href: '/qms/stability/reports',
        reportTypes: ['Stability Study Report', 'Shelf-Life Data', 'OOT Summary'],
      },
      {
        id: 'ebmr',
        label: 'eBMR Reports',
        description: 'Electronic batch manufacturing records and production analytics.',
        href: '/qms/ebmr/reports',
        reportTypes: ['Batch Record Summary', 'Production Analytics'],
      },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    description: 'Equipment, warehouse, monitoring, vendor, and validation reports.',
    modules: [
      {
        id: 'equipment',
        label: 'Equipment Reports',
        description: 'Calibration schedule, PM register, and breakdown analysis.',
        href: '/qms/equipment/reports',
        reportTypes: ['Equipment Register', 'Calibration Schedule', 'Breakdown Report'],
      },
      {
        id: 'warehouse',
        label: 'Warehouse Reports',
        description: 'GRN, inventory, dispensing, and traceability registers.',
        href: '/qms/warehouse/reports',
        reportTypes: ['GRN Report', 'Inventory Report', 'Traceability Report'],
      },
      {
        id: 'monitoring',
        label: 'Environmental & Utility Reports',
        description: 'Environmental monitoring, utility compliance, and excursion reports.',
        href: '/qms/monitoring/reports',
        reportTypes: ['Environmental Monitoring', 'Utility Monitoring', 'Excursion Report'],
      },
      {
        id: 'vendor',
        label: 'Vendor Reports',
        description: 'Approved vendor list, audit status, and qualification tracking.',
        href: '/qms/vendors/reports',
        reportTypes: ['Approved Vendor List', 'Audit Status', 'Qualification Report'],
      },
      {
        id: 'validation',
        label: 'Validation Reports',
        description: 'IQ/OQ/PQ status, validation master plan, and CSV compliance.',
        href: '/qms/validation/reports',
        reportTypes: ['Validation Status', 'CSV Compliance', 'VMP Summary'],
      },
    ],
  },
  {
    id: 'compliance',
    label: 'Compliance',
    description: 'Audit, document control, and regulatory inspection reports.',
    modules: [
      {
        id: 'audit',
        label: 'Audit Reports',
        description: 'Internal audit findings, CAPA linkage, and closure tracking.',
        href: '/qms/audit/reports',
        reportTypes: ['Audit Findings', 'CAPA Linked', 'Closure Summary'],
      },
      {
        id: 'dms',
        label: 'Document Management Reports',
        description: 'Document status, periodic review, and distribution tracking.',
        href: '/qms/dms/reports',
        reportTypes: ['Document Status', 'Periodic Review', 'Distribution Report'],
      },
    ],
  },
];

export const REGULATORY_REPORT_TYPES = [
  {
    title: 'Annual Product Quality Review (APQR/PQR)',
    description: 'Consolidated annual product quality review for regulatory submission.',
    href: '/pqr/dashboard',
    regulation: 'ICH Q10 / 21 CFR 211.180(e)',
  },
  {
    title: 'Management Review Report',
    description: 'Cross-module QMS performance summary for senior management.',
    href: '/qms/capa/reports',
    regulation: 'ICH Q10 §2.6',
  },
  {
    title: 'Annual CPV Review Report',
    description: 'Continued process verification annual review and trend summary.',
    href: '/cpv/annual-review',
    regulation: 'ICH Q8 / EU GMP Annex 15',
  },
  {
    title: 'Deviation & CAPA Trend Report',
    description: 'Quality event trends for management review and inspection.',
    href: '/qms/deviation/reports',
    regulation: 'ICH Q9 / ICH Q10',
  },
  {
    title: 'OOS Investigation Summary',
    description: 'Out-of-specification investigation register and root cause analysis.',
    href: '/qms/oos/reports',
    regulation: 'FDA OOS Guidance / EU GMP',
  },
];

export interface ReportCollectionSource {
  collection: string;
  moduleId: string;
  moduleLabel: string;
  href: string;
}

export const REPORT_COLLECTION_SOURCES: ReportCollectionSource[] = [
  { collection: 'capa_reports', moduleId: 'capa', moduleLabel: 'CAPA', href: '/qms/capa/reports' },
  { collection: 'oos_reports', moduleId: 'oos', moduleLabel: 'OOS', href: '/qms/oos/reports' },
  { collection: 'deviation_reports', moduleId: 'deviation', moduleLabel: 'Deviation', href: '/qms/deviation/reports' },
  { collection: 'change_reports', moduleId: 'change-control', moduleLabel: 'Change Control', href: '/qms/change-control/reports' },
  { collection: 'complaint_reports', moduleId: 'complaints', moduleLabel: 'Complaints', href: '/qms/complaints/reports' },
  { collection: 'recall_reports', moduleId: 'recall', moduleLabel: 'Recall', href: '/qms/recall/reports' },
  { collection: 'risk_reports', moduleId: 'risk', moduleLabel: 'Risk Management', href: '/qms/risk-management/reports' },
  { collection: 'audit_reports', moduleId: 'audit', moduleLabel: 'Audit', href: '/qms/audit/reports' },
  { collection: 'validation_reports', moduleId: 'validation', moduleLabel: 'Validation', href: '/qms/validation/reports' },
  { collection: 'reports', moduleId: 'cpv', moduleLabel: 'CPV', href: '/cpv/reports-analytics' },
];
