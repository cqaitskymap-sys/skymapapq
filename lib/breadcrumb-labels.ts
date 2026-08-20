/** Human-readable breadcrumb labels for pharma modules */
export const BREADCRUMB_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  admin: 'Administration',
  cpv: 'Continued Process Verification',
  pqr: 'Product Quality Review',
  qms: 'Quality Management System',
  deviation: 'Deviation Management',
  oos: 'OOS Management',
  capa: 'CAPA Management',
  'change-control': 'Change Control',
  stability: 'Stability Management',
  complaints: 'Complaint Management',
  recall: 'Product Recall',
  dms: 'Document Management',
  documents: 'Document Management',
  'document-master': 'Document Master',
  lifecycle: 'Document Lifecycle',
  sop: 'SOP Management',
  'sop-management': 'SOP Management',
  'standard-operating-procedures': 'SOP Management',
  'work-instructions': 'Work Instructions',
  wi: 'Work Instructions',
  'wi-management': 'Work Instructions',
  'forms-templates': 'Forms & Templates',
  forms: 'Forms & Templates',
  templates: 'Forms & Templates',
  'forms-management': 'Forms & Templates',
  'template-library': 'Forms & Templates',
  distribution: 'Controlled Document Distribution',
  'document-distribution': 'Controlled Document Distribution',
  'controlled-distribution': 'Controlled Document Distribution',
  acknowledgements: 'Acknowledgements',
  'document-acknowledgement': 'Acknowledgements',
  'read-confirmation': 'Read Confirmation',
  'document-read-confirmation': 'Read Confirmation',
  'version-control': 'Version Control',
  versioning: 'Version Control',
  'document-versions': 'Version Control',
  'review-workflow': 'Review Workflow',
  'document-review': 'Review Workflow',
  reviews: 'Review Workflow',
  'approval-workflow': 'Approval Workflow',
  'document-approval': 'Approval Workflow',
  approvals: 'Approval Workflow',
  'effective-date-management': 'Effective Date Management',
  'effective-dates': 'Effective Date Management',
  'document-effective-dates': 'Effective Date Management',
  'effective-date': 'Effective Date Management',
  'periodic-review': 'Periodic Review Management',
  'document-review-schedule': 'Periodic Review Management',
  'training-linkage': 'Document Training Linkage',
  'document-training': 'Document Training Linkage',
  'change-impact-assessment': 'Change Impact Assessment',
  'change-impact': 'Change Impact Assessment',
  'document-impact': 'Change Impact Assessment',
  archive: 'Archive Management',
  'document-archive': 'Archive Management',
  'archive-management': 'Archive Management',
  'retention-disposal': 'Retention & Disposal Management',
  retention: 'Retention & Disposal Management',
  disposal: 'Retention & Disposal Management',
  'records-retention': 'Retention & Disposal Management',
  'document-retention': 'Retention & Disposal Management',
  external: 'External Document Management',
  'external-documents': 'External Document Management',
  'external-document-management': 'External Document Management',
  'document-control': 'Document Control',
  'print-control': 'Print Control Management',
  'controlled-printing': 'Print Control Management',
  'document-printing': 'Print Control Management',
  watermarks: 'Watermark Management',
  'document-watermarks': 'Watermark Management',
  'watermark-management': 'Watermark Management',
  'document-audit': 'Document Audit Trail',
  'document-history': 'Document Audit Trail',
  system: 'System',
  'electronic-signatures': 'Electronic Signatures',
  esignatures: 'Electronic Signatures',
  'e-signatures': 'Electronic Signatures',
  'part11-signatures': 'Electronic Signatures',
  'document-management': 'Document Management',
  integrations: 'Integrations',
  calendar: 'Calendar & Scheduler',
  scheduler: 'Calendar & Scheduler',
  workflows: 'Workflow Configuration',
  'approval-matrix': 'Approval Matrix',
  'document-numbering': 'Document Numbering',
  'audit-trail': 'Audit Trail',
  'login-activity': 'Login Activity',
  'user-access-review': 'User Access Review',
  'esign-settings': 'E-Signature Settings',
  'email-sms-templates': 'Email & SMS Templates',
  'module-configuration': 'Module Configuration',
  'master-data-import-export': 'Master Data Import / Export',
  backup: 'Backup & Restore',
  jobs: 'Backup Jobs',
  restore: 'Restore',
  audit: 'Audit Trail',
  'activity-log': 'Activity Log',
  'report-center': 'Report Center',
  reports: 'Reports & Analytics',
  'audit-management': 'Audit Management',
  vendors: 'Vendor Management',
  validation: 'Validation Management',
  csv: 'CSV Management',
  equipment: 'Equipment Management',
  'equipment-review': 'Equipment Review',
  monitoring: 'Environmental Monitoring',
  warehouse: 'Warehouse Management',
  ebmr: 'eBMR',
  batches: 'Batch Registration',
  products: 'Product Master',
  cpp: 'CPP Monitoring',
  cqa: 'CQA Monitoring',
  'raw-materials': 'Raw Material Monitoring',
  'raw-material-monitoring': 'Raw Material Monitoring',
  'packing-materials': 'Packing Material Monitoring',
  'packing-material-monitoring': 'Packing Material Monitoring',
  utility: 'Utility Monitoring',
  'utility-monitoring': 'Utility Monitoring',
  environmental: 'Environmental Monitoring',
  'environmental-monitoring': 'Environmental Monitoring',
  yield: 'Yield Monitoring',
  'yield-monitoring': 'Yield Monitoring',
  'stability-monitoring': 'Stability Monitoring',
  'hold-time': 'Hold Time Monitoring',
  'hold-time-monitoring': 'Hold Time Monitoring',
  'process-capability': 'Process Capability',
  'trend-analysis': 'Trend Analysis',
  'control-charts': 'Control Charts',
  'statistical-process-control': 'Statistical Process Control',
  'risk-assessment': 'Risk Assessment',
  'impact-assessment': 'Impact Assessment',
  'risk-management': 'Risk Management',
  fmea: 'FMEA Assessment',
  closure: 'Closure',
  approval: 'Approval Workflow',
  implementation: 'Implementation Plan',
  'implementation-plan': 'Implementation Plan',
  mitigation: 'Mitigation Plan',
  'mitigation-plan': 'Mitigation Plan',
  'review-monitoring': 'Review & Monitoring',
  'risk-review': 'Review & Monitoring',
  'annual-review': 'Annual CPV Review',
  'ai-analytics': 'AI Analytics',
  'predictive-analytics': 'AI Analytics',
  configuration: 'CPV Configuration',
  settings: 'CPV Configuration',
  'reports-analytics': 'Reports & Analytics',
  'alert-engine': 'Alert Engine',
  alerts: 'Alert Engine',
  master: 'Master Data',
  materials: 'Material Master',
  abbreviations: 'Abbreviations',
  notifications: 'Notification Settings',
  queue: 'Queue',
  profile: 'Profile',
  help: 'How to use',
  support: 'Support',
};

export function formatBreadcrumbLabel(segment: string, pathname?: string): string {
  if (pathname && segment === 'master' && pathname.includes('/documents/')) {
    return 'Document Master';
  }
  if (pathname && segment === 'training' && pathname.includes('/dms/')) {
    return 'Document Training Linkage';
  }
  if (pathname && segment === 'impact-assessment' && (pathname.includes('/documents/') || pathname === '/qms/impact-assessment')) {
    return 'Change Impact Assessment';
  }
  if (pathname && segment === 'change-impact' && pathname.includes('/dms/')) {
    return 'Change Impact Assessment';
  }
  if (pathname && segment === 'archive' && pathname.includes('/dms/')) {
    return 'Archive Management';
  }
  if (pathname && segment === 'retention' && pathname.includes('/dms/')) {
    return 'Retention & Disposal Management';
  }
  if (pathname && segment === 'external' && pathname.includes('/dms/')) {
    return 'External Document Management';
  }
  if (pathname && segment === 'print-control' && pathname.includes('/dms/')) {
    return 'Print Control Management';
  }
  if (pathname && segment === 'watermarks' && pathname.includes('/dms/')) {
    return 'Watermark Management';
  }
  if (pathname && segment === 'audit' && pathname.includes('/dms/')) {
    return 'Document Audit Trail';
  }
  if (pathname && segment === 'audit-trail' && pathname.includes('/documents/')) {
    return 'Document Audit Trail';
  }
  if (pathname && (segment === 'create' || segment === 'new')) {
    if (pathname.includes('/change-control/')) return 'Create Change Control';
    if (pathname.includes('/risk-management/')) return 'Create Risk Assessment';
  }
  if (pathname && segment === 'dashboard' && pathname.includes('/change-control/')) {
    return 'Dashboard';
  }
  if (pathname && segment === 'notifications' && !pathname.includes('/admin/')) {
    return 'Notifications';
  }
  if (pathname && segment === 'history' && pathname.includes('/admin/notifications')) {
    return 'Notification History';
  }
  if (pathname && segment === 'queue' && pathname.includes('/admin/notifications')) {
    return 'Notification Queue';
  }
  if (pathname && segment === 'versions' && pathname.includes('/admin/email-sms-templates')) {
    return 'Version History';
  }
  if (pathname && segment === 'versions' && pathname.includes('/admin/module-configuration')) {
    return 'Version History';
  }
  return BREADCRUMB_LABELS[segment] ?? segment.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
