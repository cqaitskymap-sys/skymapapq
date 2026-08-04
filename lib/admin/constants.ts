export const ADMIN_MODULES = [
  'Dashboard', 'PQR', 'CPV', 'CPP', 'CQA', 'Batch', 'Product', 'Material',
  'Vendor', 'Equipment', 'Deviation', 'OOS', 'CAPA', 'Change Control',
  'Complaint', 'Recall', 'Stability', 'Validation', 'Document',
  'Reports', 'Admin',
] as const;

export const PERMISSION_ACTIONS = [
  'view', 'create', 'edit', 'delete', 'review', 'approve', 'reject',
  'export', 'import', 'archive', 'eSign',
] as const;

/** Modules shown in Role & Permission matrix UI */
export const ROLE_MATRIX_MODULES = [
  'Dashboard', 'Admin', 'CPV', 'PQR', 'Deviation', 'OOS', 'CAPA', 'Change Control',
  'Risk Management', 'Stability', 'Complaint', 'Recall', 'DMS', 'Audit',
  'Vendor', 'Supplier', 'Validation', 'CSV', 'Equipment', 'Calibration', 'Maintenance',
  'Monitoring', 'Warehouse', 'Inventory', 'eBMR', 'Reports', 'Analytics', 'Settings',
  'Notifications', 'Audit Trail', 'Electronic Signature',
] as const;

/** Permission actions in Role & Permission matrix UI */
export const ROLE_MATRIX_ACTIONS = [
  'View', 'Create', 'Edit', 'Delete', 'Review', 'Approve', 'Reject', 'Assign',
  'Export', 'Import', 'Print', 'Archive', 'Restore', 'Close',
  'Electronic Signature', 'Admin', 'Read Only',
] as const;

/** Built-in system roles that cannot be permanently removed */
export const SYSTEM_ROLE_IDS = [
  'super_admin', 'admin', 'qa', 'qc', 'production', 'engineering', 'warehouse',
  'regulatory', 'auditor', 'department_head', 'hr',
  'document_controller', 'employee', 'vendor', 'viewer', 'maintenance',
  'validation', 'it_administrator', 'head_qa', 'qa_manager', 'qc_manager',
  'production_manager', 'warehouse_manager', 'engineering_manager',
  'regulatory_affairs',
] as const;

/** Preset role types for role management */
export const ROLE_PRESET_OPTIONS = [
  { id: 'super_admin', name: 'Super Admin', level: 100 },
  { id: 'admin', name: 'System Admin', level: 90 },
  { id: 'qa', name: 'Quality Assurance', level: 75 },
  { id: 'qc', name: 'Quality Control', level: 75 },
  { id: 'document_controller', name: 'Document Controller', level: 65 },
  { id: 'department_head', name: 'Department Head', level: 80 },
  { id: 'hr', name: 'HR', level: 65 },
  { id: 'warehouse', name: 'Warehouse', level: 70 },
  { id: 'production', name: 'Production', level: 70 },
  { id: 'engineering', name: 'Engineering', level: 70 },
  { id: 'maintenance', name: 'Maintenance', level: 65 },
  { id: 'validation', name: 'Validation', level: 65 },
  { id: 'it_administrator', name: 'IT Administrator', level: 85 },
  { id: 'auditor', name: 'Auditor', level: 50 },
  { id: 'employee', name: 'Employee', level: 30 },
  { id: 'vendor', name: 'Vendor', level: 20 },
  { id: 'viewer', name: 'Viewer', level: 10 },
  { id: 'regulatory', name: 'Regulatory', level: 70 },
  { id: 'reviewer', name: 'Reviewer', level: 55 },
  { id: 'approver', name: 'Approver', level: 60 },
] as const;

export const DATA_SCOPE_OPTIONS = [
  'Own Records',
  'Department Records',
  'Site Records',
  'Business Unit Records',
  'Organization Records',
] as const;

export const FIELD_ACCESS_LEVELS = ['Hidden', 'Read Only', 'Editable', 'Conditional'] as const;

export const ADMIN_ROLES = [
  { id: 'super_admin', name: 'Super Admin', level: 100 },
  { id: 'admin', name: 'Admin', level: 90 },
  { id: 'qa', name: 'QA', level: 65 },
  { id: 'qc', name: 'QC', level: 65 },
  { id: 'production', name: 'Production', level: 65 },
  { id: 'engineering', name: 'Engineering', level: 65 },
  { id: 'warehouse', name: 'Warehouse', level: 65 },
  { id: 'regulatory', name: 'Regulatory', level: 65 },
  { id: 'head_qa', name: 'Head QA', level: 80 },
  { id: 'qa_manager', name: 'QA Manager', level: 70 },
  { id: 'qa_executive', name: 'QA Executive', level: 60 },
  { id: 'qc_manager', name: 'QC Manager', level: 70 },
  { id: 'qc_executive', name: 'QC Executive', level: 60 },
  { id: 'production_manager', name: 'Production Manager', level: 70 },
  { id: 'production_executive', name: 'Production Executive', level: 60 },
  { id: 'warehouse_manager', name: 'Warehouse Manager', level: 70 },
  { id: 'warehouse_executive', name: 'Warehouse Executive', level: 60 },
  { id: 'engineering_manager', name: 'Engineering Manager', level: 70 },
  { id: 'engineering_executive', name: 'Engineering Executive', level: 60 },
  { id: 'regulatory_affairs', name: 'Regulatory Affairs', level: 65 },
  { id: 'hr', name: 'HR', level: 65 },
  { id: 'document_controller', name: 'Document Controller', level: 65 },
  { id: 'department_head', name: 'Department Head', level: 75 },
  { id: 'employee', name: 'Employee', level: 30 },
  { id: 'auditor', name: 'Auditor', level: 50 },
  { id: 'vendor', name: 'Vendor', level: 20 },
  { id: 'viewer', name: 'Viewer', level: 10 },
  { id: 'maintenance', name: 'Maintenance', level: 65 },
  { id: 'validation', name: 'Validation', level: 65 },
  { id: 'it_administrator', name: 'IT Administrator', level: 85 },
] as const;

export const DEFAULT_DEPARTMENTS = [
  { departmentCode: 'QA', departmentName: 'QA', description: 'Quality Assurance' },
  { departmentCode: 'QC', departmentName: 'QC', description: 'Quality Control' },
  { departmentCode: 'PROD', departmentName: 'Production', description: 'Production Operations' },
  { departmentCode: 'WH', departmentName: 'Warehouse', description: 'Warehouse & Logistics' },
  { departmentCode: 'ENG', departmentName: 'Engineering', description: 'Engineering & Maintenance' },
  { departmentCode: 'RA', departmentName: 'Regulatory Affairs', description: 'Regulatory Affairs' },
  { departmentCode: 'IT', departmentName: 'IT', description: 'Information Technology' },
  { departmentCode: 'CQA', departmentName: 'CQA', description: 'Corporate Quality Assurance' },
  { departmentCode: 'ADMIN', departmentName: 'Admin', description: 'Administration' },
  { departmentCode: 'HR', departmentName: 'HR', description: 'Human Resources' },
  { departmentCode: 'VAL', departmentName: 'Validation', description: 'Validation' },
  { departmentCode: 'MAINT', departmentName: 'Maintenance', description: 'Maintenance' },
];

/** Built-in department codes that cannot be permanently removed */
export const SYSTEM_DEPARTMENT_CODES = DEFAULT_DEPARTMENTS.map((d) => d.departmentCode);

export const DEFAULT_DESIGNATIONS = [
  { designationCode: 'HQA', designationName: 'Head QA', department: 'QA', approvalLevel: 5 },
  { designationCode: 'QAM', designationName: 'QA Manager', department: 'QA', approvalLevel: 4 },
  { designationCode: 'QAE', designationName: 'QA Executive', department: 'QA', approvalLevel: 2 },
  { designationCode: 'QCM', designationName: 'QC Manager', department: 'QC', approvalLevel: 4 },
  { designationCode: 'QCE', designationName: 'QC Executive', department: 'QC', approvalLevel: 2 },
  { designationCode: 'PM', designationName: 'Production Manager', department: 'Production', approvalLevel: 4 },
  { designationCode: 'WM', designationName: 'Warehouse Manager', department: 'Warehouse', approvalLevel: 4 },
  { designationCode: 'EM', designationName: 'Engineering Manager', department: 'Engineering', approvalLevel: 4 },
  { designationCode: 'CQA-IT', designationName: 'CQA IT', department: 'CQA', approvalLevel: 3 },
  { designationCode: 'AUD', designationName: 'Auditor', department: 'QA', approvalLevel: 1 },
];

/** Built-in designation codes that cannot be permanently removed */
export const SYSTEM_DESIGNATION_CODES = DEFAULT_DESIGNATIONS.map((d) => d.designationCode);

export const EMPLOYMENT_CATEGORIES = [
  'Permanent', 'Contract', 'Temporary', 'Consultant', 'Intern', 'Vendor',
] as const;

export const JOB_BANDS = [
  'Band A', 'Band B', 'Band C', 'Band D', 'Band E', 'Band F', 'Unbanded',
] as const;

export const JOB_GRADES = [
  'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10',
] as const;

export const REPORTING_LEVELS = [
  'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10',
] as const;

export const PARAMETER_TYPES = [
  'CPP', 'CQA', 'IPC', 'Finished Product Test', 'Stability Test',
  'Utility Parameter', 'Environmental Parameter', 'Raw Material Test',
  'Packing Material Test', 'Yield Parameter',
] as const;

export const PARAMETER_CATEGORIES = [
  'Manufacturing', 'Quality Control', 'Microbiology', 'Stability',
  'Utility', 'Environmental', 'Packaging', 'Warehouse', 'Validation',
  'Quality Parameters', 'Manufacturing Parameters', 'Process Parameters',
  'Critical Process Parameters (CPP)', 'Critical Quality Attributes (CQA)',
  'Laboratory Parameters', 'Equipment Parameters', 'Calibration Parameters',
  'Maintenance Parameters', 'Environmental Monitoring', 'Water System', 'HVAC',
  'Utility Monitoring', 'Validation Parameters', 'Cleaning Validation',
  'Process Validation', 'Stability Parameters', 'Audit Parameters',
  'Risk Parameters', 'Custom Parameters',
] as const;

export const PARAMETER_GROUPS = [
  'CPP Group', 'CQA Group', 'IPC Group', 'Utility Group', 'Environmental Group',
  'Stability Group', 'Validation Group', 'Equipment Group', 'General',
] as const;

export const PARAMETER_MODULE_OPTIONS = [
  'CPV', 'APQR / PQR', 'Validation', 'LIMS', 'Equipment', 'Calibration',
  'Maintenance', 'Environmental Monitoring', 'Water System', 'HVAC',
  'Manufacturing', 'Quality Control', 'Quality Assurance', 'Risk Assessment',
  'CAPA', 'Deviation', 'Change Control', 'Document Management',
  'General',
] as const;

export const PARAMETER_DATA_TYPES = [
  'Numeric', 'Text', 'Boolean', 'Dropdown', 'Multi Select', 'Formula',
] as const;

export const PARAMETER_CALCULATION_TYPES = [
  'Manual', 'Formula Based', 'Auto Calculated', 'Derived',
] as const;

export const PROCESS_STAGES = [
  'Dispensing', 'Mixing', 'pH Adjustment', 'Filtration', 'Sterilization',
  'Vial Washing', 'Depyrogenation', 'Filling', 'Sealing', 'Visual Inspection',
  'Packing', 'Finished Product Testing', 'Stability Testing',
  'Utility Monitoring', 'Environmental Monitoring',
] as const;

export const CRITICALITY_OPTIONS = ['Critical', 'Major', 'Minor'] as const;

export const FREQUENCY_OPTIONS = [
  'Per Batch', 'Hourly', 'Daily', 'Weekly', 'Monthly',
  'Quarterly', 'Yearly', 'As Required',
] as const;

export const RESULT_TYPES = ['Numeric', 'Text', 'Pass/Fail', 'Complies/Does Not Comply'] as const;

export const USER_STATUSES = ['Active', 'Inactive', 'Suspended', 'Locked'] as const;
export const RECORD_STATUSES = ['Active', 'Inactive'] as const;

export const DEPARTMENT_TYPES = [
  'QA', 'QC', 'Production', 'Warehouse', 'Engineering', 'HR', 'IT',
  'Regulatory', 'Purchase', 'Microbiology', 'Validation', 'Maintenance', 'Admin', 'Other',
] as const;

export const DESIGNATION_LEVELS = [
  'Executive', 'Senior Executive', 'Assistant Manager', 'Deputy Manager',
  'Manager', 'Senior Manager', 'AGM', 'DGM', 'GM', 'Head', 'Director', 'Admin',
] as const;

export const DESIGNATION_LEVEL_APPROVAL_MAP: Record<string, number> = {
  Executive: 1,
  'Senior Executive': 2,
  'Assistant Manager': 3,
  'Deputy Manager': 3,
  Manager: 4,
  'Senior Manager': 5,
  AGM: 6,
  DGM: 7,
  GM: 8,
  Head: 9,
  Director: 10,
  Admin: 5,
};

export const DESIGNATION_PRESETS = [
  { code: 'QAE', name: 'QA Executive', department: 'QA', level: 'Executive' },
  { code: 'QAM', name: 'QA Manager', department: 'QA', level: 'Manager' },
  { code: 'HQA', name: 'Head QA', department: 'QA', level: 'Head' },
  { code: 'QCE', name: 'QC Executive', department: 'QC', level: 'Executive' },
  { code: 'QCM', name: 'QC Manager', department: 'QC', level: 'Manager' },
  { code: 'PE', name: 'Production Executive', department: 'Production', level: 'Executive' },
  { code: 'PM', name: 'Production Manager', department: 'Production', level: 'Manager' },
  { code: 'WE', name: 'Warehouse Executive', department: 'Warehouse', level: 'Executive' },
  { code: 'WM', name: 'Warehouse Manager', department: 'Warehouse', level: 'Manager' },
  { code: 'EE', name: 'Engineering Executive', department: 'Engineering', level: 'Executive' },
  { code: 'EM', name: 'Engineering Manager', department: 'Engineering', level: 'Manager' },
  { code: 'CQA-IT', name: 'CQA IT', department: 'CQA', level: 'Senior Manager' },
  { code: 'RE', name: 'Regulatory Executive', department: 'Regulatory Affairs', level: 'Executive' },
  { code: 'AUD', name: 'Auditor', department: 'QA', level: 'Executive' },
] as const;

export const NOTIFICATION_EVENTS = [
  'PQR Approval Pending', 'CPV Review Due', 'CAPA Due', 'OOS Open',
  'Deviation Open', 'Change Control Pending', 'Calibration Due',
  'Qualification Due', 'Document Review Due',
] as const;

export const NOTIFICATION_MODULES = [
  'PQR', 'CPV', 'Deviation', 'OOS', 'CAPA', 'Change Control', 'Stability',
  'Complaint', 'Recall', 'DMS', 'Document Management', 'Audit',
  'Vendor', 'Vendor Qualification', 'Supplier Qualification', 'Validation',
  'Qualification', 'CSV', 'Equipment', 'Calibration', 'Maintenance',
  'Monitoring', 'Warehouse', 'eBMR', 'Risk Assessment', 'Risk Management',
  'Workflow', 'Approval', 'Electronic Signature', 'User Management', 'Admin',
] as const;

export const NOTIFICATION_EVENT_TRIGGERS = [
  'Record Created', 'Record Submitted', 'Review Pending', 'Approval Pending',
  'Approved', 'Rejected', 'Closed', 'Overdue', 'Due Soon', 'Assigned', 'Escalated',
  'OOS Detected', 'OOT Detected', 'Deviation Created', 'CAPA Due', 'CAPA Overdue',
  'Change Implementation Due', 'Document Review Due',
  'Calibration Due', 'PM Due', 'Stability Sample Due', 'Audit Finding Assigned',
  'Recall Initiated', 'Backup Completed', 'Login Failed', 'User Locked',
  'Create', 'Update', 'Delete', 'Approve', 'Reject', 'Review', 'Issue', 'Obsolete',
  'Archive', 'Restore', 'Workflow Started', 'Workflow Completed', 'Approval Completed',
  'Approval Rejected', 'Equipment Breakdown', 'Audit Scheduled',
  'Audit Completed', 'Validation Due', 'Risk Review Due', 'Complaint Created',
  'Supplier Approved', 'User Created', 'Role Changed', 'Password Changed',
  'Account Locked', 'Electronic Signature Required', 'System Maintenance',
  'Backup Failure', 'Security Alert', 'Broadcast',
] as const;

export const NOTIFICATION_CHANNEL_TYPES = [
  'In-App', 'Email', 'SMS', 'Push', 'Desktop', 'Webhook',
  'In-App + Email', 'In-App + Email + SMS', 'Microsoft Teams', 'Slack', 'REST API',
] as const;

export const NOTIFICATION_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

export const REMINDER_FREQUENCIES = ['None', 'Daily', 'Weekly', 'Bi-Weekly', 'Monthly'] as const;

export const NOTIFICATION_READ_STATUSES = ['Unread', 'Read'] as const;

export const NOTIFICATION_SENT_STATUSES = ['Pending', 'Sent', 'Failed'] as const;

export const SIGNATURE_MEANINGS = [
  'Prepared By', 'Reviewed By', 'Approved By', 'Rejected By', 'Verified By',
] as const;

export const ESIGN_SETTING_MODULES = [
  'PQR', 'CPV Annual Review', 'Deviation', 'OOS', 'CAPA', 'Change Control',
  'Stability', 'Complaint', 'Recall', 'DMS', 'Audit',
  'Vendor Qualification', 'Validation', 'CSV', 'Equipment', 'Monitoring',
  'Warehouse', 'eBMR', 'Admin Changes',
  'CAPA Approval Workflow', 'CAPA Closure', 'Deviation Approval', 'Deviation Closure',
  'Document Release', 'Risk', 'Qualification', 'Calibration',
  'Maintenance', 'Supplier Qualification',
] as const;

export const ESIGN_ACTION_TYPES = [
  'Prepared By', 'Reviewed By', 'Verified By', 'Approved By', 'Rejected By',
  'Closed By', 'Submitted By', 'Implemented By', 'Effectiveness Checked By',
  'QA Override', 'Batch Released By', 'Document Effective By',
  'Approve', 'Reject', 'Review', 'Authorize', 'Release', 'Cancel', 'Close',
  'Complete', 'Archive', 'Delete', 'Modify', 'Revise', 'Issue', 'Obsolete', 'Void',
  'Approval', 'CAPA Closure Authorization', 'Close Deviation', 'Reopen Deviation',
  'Configuration Change', 'Policy Update',
] as const;

export const ESIGN_SIGNATURE_MEANINGS = [
  'I am the author of this record',
  'I have reviewed this record',
  'I approve this record',
  'I reject this record',
  'I verify this activity',
  'I close this record',
  'I confirm this action',
  'I release this batch',
  'I approve this change',
  'I confirm effectiveness',
  'I authorize this action',
  'I cancel this record',
  'I archive this record',
  'I obsolete this document',
  'I void this record',
] as const;

export const ESIGN_AUTH_METHODS = [
  'Password Confirmation', 'Current Password', 'OTP', 'Email OTP', 'SMS OTP',
  'Authenticator App', 'MFA', 'Biometric (Future)', 'Hardware Token (Future)',
  'Dual Authentication',
] as const;

export const ADMIN_COLLECTIONS = {
  users: 'users',
  roles: 'roles',
  permissions: 'permissions',
  userPermissions: 'user_permissions',
  departments: 'departments',
  designations: 'designations',
  companySites: 'company_sites',
  products: 'products',
  batches: 'batches',
  parameters: 'parameters',
  workflows: 'workflows',
  approvalMatrix: 'approval_matrix',
  documentNumbering: 'document_numbering',
  auditLogs: 'audit_logs',
  auditTrail: 'audit_trail',
  auditTrailArchive: 'audit_trail_archive',
  auditExports: 'audit_exports',
  esignSettings: 'esign_settings',
  esignRecords: 'esign_records',
  notificationSettings: 'notification_settings',
  notificationTemplates: 'notification_templates',
  notificationQueue: 'notification_queue',
  notificationDeliveryLog: 'notification_delivery_log',
  notificationsArchive: 'notifications_archive',
  backupHistory: 'backup_history',
  backupRestore: 'backup_restore',
  backupSettings: 'backup_settings',
  restoreHistory: 'restore_history',
  backupJobs: 'backup_jobs',
  backupHistoryArchive: 'backup_history_archive',
  restoreHistoryArchive: 'restore_history_archive',
  systemSettings: 'system_settings',
  systemSettingsVersions: 'system_settings_versions',
  systemLogs: 'system_logs',
  loginActivity: 'login_activity',
  loginActivityArchive: 'login_activity_archive',
  accessReviews: 'access_reviews',
  accessReviewsArchive: 'access_reviews_archive',
  passwordPolicy: 'password_policy',
  moduleConfiguration: 'module_configuration',
  moduleConfigurationVersions: 'module_configuration_versions',
  emailSmsTemplates: 'email_sms_templates',
  emailSmsTemplateVersions: 'email_sms_template_versions',
  masterDataImportExport: 'master_data_import_export',
  masterDataImportExportErrors: 'master_data_import_export_errors',
  systemHealthChecks: 'system_health_checks',
  systemHealthScans: 'system_health_scans',
  productCompositions: 'product_compositions',
  productPackingDetails: 'product_packing_details',
  productAttachments: 'product_attachments',
  batchAttachments: 'batch_attachments',
  workflowSteps: 'workflow_steps',
  documentNumberSequences: 'document_numbering_sequences',
  /** @deprecated legacy client collection — prefer documentNumberSequences */
  documentNumberSequencesLegacy: 'document_number_sequences',
} as const;

export const DOCUMENT_NUMBERING_MODULES = [
  'PQR', 'CPV', 'Deviation', 'OOS', 'CAPA', 'Change Control', 'Stability',
  'Complaint', 'Recall', 'DMS', 'Audit', 'Vendor Qualification',
  'Validation', 'CSV', 'Equipment', 'Calibration', 'Maintenance', 'Warehouse',
  'eBMR', 'Admin', 'Risk Management', 'Qualification', 'Batch', 'Product',
] as const;

export const DOCUMENT_TYPE_OPTIONS = [
  'PQR Report', 'Annual PQR', 'CPV Review', 'Deviation Report', 'GMP Deviation',
  'OOS Investigation', 'CAPA Report', 'Corrective Action', 'Change Control',
  'Stability Study', 'Complaint Investigation', 'Market Complaint', 'Recall Report',
  'Product Recall', 'SOP', 'STP', 'Specification', 'Protocol', 'Report', 'Form',
  'Logbook', 'BMR', 'BPR', 'Validation Protocol', 'Validation Report',
  'CSV URS', 'CSV IQ', 'CSV OQ', 'CSV PQ', 'Audit Report',
  'Risk Assessment', 'Batch Number', 'Equipment Record', 'Calibration Certificate',
] as const;

export const NUMBERING_YEAR_FORMATS = ['YYYY', 'YY', 'None'] as const;
export const NUMBERING_MONTH_FORMATS = ['MM', 'MMM', 'None'] as const;
export const NUMBERING_SEPARATOR_OPTIONS = ['/', '-', '_', 'None'] as const;
export const NUMBERING_RESET_FREQUENCIES = ['Never', 'Yearly', 'Monthly', 'Daily'] as const;
export const REVISION_FORMAT_OPTIONS = ['00', '01', 'Rev-00', 'R00', 'V1.0', 'Custom'] as const;

export const FORMAT_TOKENS = [
  'PREFIX', 'SUFFIX', 'SITE_CODE', 'DEPARTMENT_CODE', 'PRODUCT_CODE', 'DOCUMENT_TYPE',
  'RUNNING_NUMBER', 'MONTH', 'YEAR', 'REVISION',
] as const;

export const AUDIT_TRAIL_MODULES = [
  'Admin', 'CPV', 'PQR', 'Deviation', 'OOS', 'CAPA', 'Change Control',
  'Stability', 'Complaint', 'Recall', 'DMS', 'Audit', 'Vendor',
  'Validation', 'CSV', 'Equipment', 'Monitoring', 'Warehouse', 'eBMR',
] as const;

export const AUDIT_ACTION_TYPES = [
  'Create', 'Update', 'Delete', 'Soft Delete', 'Restore', 'Archive', 'Activate', 'Deactivate',
  'Approve', 'Reject', 'Return', 'Rework', 'Resubmit', 'Review', 'Submit', 'Close', 'Reopen',
  'Login', 'Logout', 'Failed Login', 'Password Reset', 'Password Change',
  'Role Change', 'Permission Change', 'Workflow Change', 'Configuration Change',
  'File Upload', 'File Delete', 'Download', 'Export', 'Import', 'Print',
  'Status Change', 'E-Signature', 'Override', 'System Setting Change', 'Backup',
  'API Access',
] as const;

export const AUDIT_LOG_STATUSES = ['Success', 'Failed', 'Pending', 'System Generated'] as const;

export const ADMIN_AUDIT_MODULES = [
  'Admin', 'Document', 'User', 'Role', 'Department', 'Designation', 'Company Site',
  'Product', 'Batch', 'Parameter', 'Workflow', 'Approval Matrix', 'Document Numbering',
  'System Settings', 'Backup', 'Login Activity',
] as const;

export const QMS_AUDIT_MODULES = [
  'PQR', 'CPV', 'Deviation', 'OOS', 'CAPA', 'Change Control', 'Stability',
  'Complaint', 'Recall', 'DMS', 'Audit', 'Vendor', 'Validation',
  'CSV', 'Equipment', 'Monitoring', 'Warehouse', 'eBMR',
] as const;

export const CRITICAL_AUDIT_ACTIONS = [
  'Delete', 'Soft Delete', 'Approve', 'Reject', 'Role Change', 'Permission Change',
  'E-Signature', 'Override', 'System Setting Change', 'Configuration Change',
  'Backup', 'Restore', 'Failed Login', 'Password Reset', 'Password Change',
] as const;

export const WORKFLOW_MODULE_OPTIONS = [
  'PQR', 'CPV', 'Deviation', 'OOS', 'CAPA', 'Change Control', 'Stability',
  'Complaint', 'Recall', 'DMS', 'Audit', 'Vendor', 'Validation',
  'CSV', 'Equipment', 'Monitoring', 'Warehouse', 'eBMR', 'Admin',
  'Risk Management', 'Qualification', 'Calibration', 'Maintenance',
  'Supplier Qualification', 'Employee Management',
] as const;

export const WORKFLOW_TYPES = [
  'Single Level Approval',
  'Multi Level Approval',
  'Parallel Review',
  'Sequential Review',
  'Conditional Routing',
  'Review + Approval',
  'Investigation + Approval',
  'Execution + Review + Approval',
] as const;

export const WORKFLOW_CATEGORIES = [
  'Approval', 'Investigation', 'Execution', 'Review', 'Notification',
  'Escalation', 'Quality', 'Compliance', 'Custom',
] as const;

export const WORKFLOW_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

export const WORKFLOW_STEP_TYPES = [
  'Prepare', 'Submit', 'Review', 'Investigate', 'Execute', 'Verify',
  'Approve', 'Final Approve', 'Close',
  'Decision', 'Condition', 'Notification', 'Timer', 'End',
] as const;

export const APPROVAL_WORKFLOW_TYPES = [
  'Single Level Approval',
  'Multi Level Approval',
  'Conditional Routing',
  'Review + Approval',
  'Investigation + Approval',
  'Execution + Review + Approval',
] as const;

export const APPROVAL_MATRIX_MODULES = [
  'PQR', 'CPV Annual Review', 'Deviation', 'OOS', 'CAPA', 'Change Control',
  'Stability', 'Complaint', 'Recall', 'DMS', 'Audit',
  'Vendor Qualification', 'Validation', 'CSV', 'Equipment', 'Monitoring',
  'Warehouse', 'eBMR', 'Admin Changes',
  'Risk Management', 'Qualification', 'Calibration', 'Maintenance',
  'Supplier Qualification', 'Employee Management', 'CPV',
] as const;

export const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical', 'All'] as const;

export const APPROVAL_MATRIX_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

export const APPROVAL_MODES = [
  'Sequential', 'Parallel', 'Conditional', 'Quorum', 'Majority', 'Consensus',
] as const;

export const APPROVAL_ACTION_OPTIONS = [
  'Approve', 'Reject', 'Return', 'Send Back', 'Rework', 'Resubmit',
  'Cancel', 'Delegate', 'Escalate', 'Skip', 'Auto Approve', 'Auto Reject',
] as const;

export const BACKUP_STATUSES = [
  'Pending', 'In Progress', 'Completed', 'Failed', 'Verified', 'Restored',
  'Success', // legacy
] as const;

export const BACKUP_TYPES = [
  'Manual Backup',
  'Scheduled Backup',
  'Pre-Restore Backup',
  'System Backup',
  'Incremental Backup',
  'Configuration Backup',
] as const;

export const BACKUP_SCOPES = [
  'Full System',
  'Admin Data',
  'QMS Data',
  'PQR Data',
  'CPV Data',
  'Master Data',
  'Audit Trail',
  'Selected Collections',
] as const;

export const BACKUP_FREQUENCIES = [
  'Hourly',
  'Daily',
  'Weekly',
  'Monthly',
  'Quarterly',
  'Yearly',
  'Manual Only',
] as const;

export const RESTORE_TYPES = [
  'Full Restore',
  'Selected Collection Restore',
  'Rollback Restore',
  'Dry Run Restore',
] as const;

export const RESTORE_STATUSES = [
  'Requested',
  'Approved',
  'In Progress',
  'Completed',
  'Failed',
  'Cancelled',
] as const;

export const BACKUP_ENCRYPTION_ALGORITHMS = [
  'AES-256-GCM',
  'Platform AES-256 (at-rest)',
] as const;

export const BACKUP_STORAGE_PROVIDERS = [
  'Firebase Cloud Storage',
  'Google Cloud Storage',
  'AWS S3 (Future)',
  'Azure Blob (Future)',
  'Local (Development)',
] as const;

export const BACKUP_INTEGRITY_STATUSES = [
  'Pending', 'Verified', 'Failed', 'Expired', 'Unknown',
] as const;

/** All Firestore collections supported for backup export */
export const BACKUP_EXPORT_COLLECTIONS = [
  'users', 'roles', 'permissions', 'departments', 'designations', 'company_sites',
  'products', 'batches', 'parameters', 'workflows', 'approval_matrix', 'document_numbering',
  'esign_settings', 'notification_settings', 'module_configuration', 'email_sms_templates',
  'system_settings', 'cpv_reviews', 'cpp_parameters', 'cpp_results',
  'cqa_parameters', 'cqa_results', 'pqr_records', 'deviations', 'oos_records', 'capa_records',
  'change_controls', 'stability_studies', 'complaints', 'recalls', 'documents',
  'training_records', 'training_master', 'training_assignments', 'training_assessments',
  'training_effectiveness', 'training_matrix', 'training_attendance', 'competency_records',
  'document_training_links', 'audits', 'vendors', 'validation_records', 'csv_systems',
  'equipment_master', 'monitoring_records', 'warehouse_materials', 'ebmr_records',
  'audit_trail', 'notifications', 'master_data_import_export',
] as const;

export const BACKUP_SCOPE_COLLECTIONS: Record<string, readonly string[]> = {
  'Full System': BACKUP_EXPORT_COLLECTIONS,
  'Admin Data': [
    'users', 'roles', 'permissions', 'departments', 'designations', 'company_sites',
    'workflows', 'approval_matrix', 'document_numbering', 'esign_settings',
    'notification_settings', 'system_settings', 'module_configuration', 'email_sms_templates',
  ],
  'QMS Data': [
    'deviations', 'oos_records', 'capa_records', 'change_controls', 'stability_studies',
    'complaints', 'recalls', 'documents', 'training_records', 'training_master',
    'training_assignments', 'training_assessments', 'training_effectiveness', 'training_matrix',
    'training_attendance', 'competency_records', 'audits', 'vendors',
    'validation_records', 'csv_systems', 'equipment_master', 'monitoring_records',
    'warehouse_materials', 'ebmr_records',
  ],
  'PQR Data': ['pqr_records'],
  'CPV Data': ['cpv_reviews', 'cpp_parameters', 'cpp_results', 'cqa_parameters', 'cqa_results'],
  'Master Data': [
    'users', 'roles', 'departments', 'designations', 'company_sites', 'products',
    'batches', 'parameters',
  ],
  'Audit Trail': ['audit_trail'],
  'Selected Collections': [],
};
export const LOGIN_STATUSES = ['Success', 'Failed', 'Locked'] as const;

export const LOGIN_EVENT_TYPES = [
  'Successful Login', 'Logout', 'Failed Login', 'Invalid Password', 'Invalid Username',
  'Password Reset', 'Password Change', 'Account Lock', 'Account Unlock',
  'Session Timeout', 'Session Expired', 'Remember Me Login',
  'MFA Success', 'MFA Failure', 'New Device Login', 'New Browser Login',
  'Multiple Concurrent Login', 'Forced Logout', 'Administrator Logout',
] as const;

export const LOGIN_RISK_LEVELS = ['Info', 'Low', 'Medium', 'High', 'Critical'] as const;
export const ACCESS_REVIEW_STATUSES = [
  'Draft', 'Pending', 'In Progress', 'Self Review', 'Manager Review',
  'QA Review', 'IT Review', 'Pending Approval', 'Completed', 'Rejected',
  'Changes Requested', 'Closed', 'Overdue', 'Archived',
] as const;

export const ACCESS_REVIEW_DECISIONS = [
  'Maintain Access', 'Modify Access', 'Revoke Access', 'Disable Account',
  'Lock Account', 'Extend Temporary Access',
] as const;

export const ACCESS_REVIEW_RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;

export const ACCESS_REVIEW_RECOMMENDATIONS = [
  'No Change', 'Reduce Privileges', 'Remove Unused Modules', 'Enforce MFA',
  'Disable Account', 'Investigate SoD Conflict', 'Schedule Follow-up',
] as const;
export const TEMPLATE_TYPES = [
  'Email', 'SMS', 'In-App', 'Push', 'WhatsApp', 'Microsoft Teams', 'Slack',
  'Webhook', 'System Notification',
] as const;

export const TEMPLATE_CATEGORIES = [
  'Document Management', 'SOP', 'CAPA', 'Deviation', 'Change Control',
  'Risk Assessment', 'Audit', 'Validation', 'Qualification', 'Equipment',
  'Calibration', 'Maintenance', 'Complaint', 'Supplier Qualification',
  'Vendor Qualification', 'User Management', 'Role Management',
  'Workflow Configuration', 'Approval Matrix', 'Login Activity', 'Password Reset',
  'Account Lock', 'User Access Review', 'Electronic Signature', 'Notifications',
  'System Alerts', 'Backup Alerts', 'Security Alerts', 'General',
] as const;

export const TEMPLATE_LANGUAGES = [
  'en', 'en-US', 'en-IN', 'hi', 'es', 'fr', 'de', 'zh', 'ar', 'pt',
] as const;

export const TEMPLATE_APPROVAL_STATUSES = [
  'Draft', 'Under Review', 'Approved', 'Published', 'Archived', 'Obsolete',
] as const;

export const TEMPLATE_PLACEHOLDERS = [
  'UserName', 'EmployeeName', 'EmployeeID', 'Department', 'Designation',
  'Company', 'Site', 'DocumentNo', 'DocumentTitle', 'DocumentVersion',
  'BatchNumber', 'ProductName', 'WorkflowName', 'ApprovalLevel', 'Approver',
  'Reviewer', 'DueDate', 'EffectiveDate',
  'CAPANumber', 'DeviationNumber', 'ChangeControlNumber', 'AuditNumber',
  'EquipmentID', 'CalibrationDue', 'CurrentDate', 'CurrentTime', 'SystemURL',
  'moduleName', 'eventName', 'status', 'assignedTo', 'createdBy',
] as const;

export const SITE_TYPES = [
  'Manufacturing Plant',
  'Corporate Office',
  'R&D Site',
  'Warehouse',
  'Testing Laboratory',
  'Contract Manufacturing Site',
] as const;

export const COMPANY_TYPES = [
  'Private Limited',
  'Public Limited',
  'Partnership',
  'LLP',
  'Government',
  'Multinational',
  'Subsidiary',
  'Other',
] as const;

export const INDUSTRIES = [
  'Pharmaceutical',
  'Biotechnology',
  'Medical Devices',
  'Cosmetics',
  'Nutraceutical',
  'Contract Manufacturing',
  'API Manufacturing',
  'Vaccines',
  'Other',
] as const;

/** Protected site codes — cannot be soft-deleted. */
export const SYSTEM_SITE_CODES = ['HQ', 'MAIN', 'DEFAULT'] as const;

export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
export const TIME_FORMATS = ['24h', '12h'] as const;
export const CURRENCY_OPTIONS = ['INR', 'USD', 'EUR', 'GBP'] as const;
export const TIMEZONE_OPTIONS = [
  'Asia/Kolkata', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC',
] as const;

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

export const DOSAGE_FORMS = [
  'Injection', 'Tablet', 'Capsule', 'Syrup', 'Suspension', 'Ointment',
  'Cream', 'Gel', 'Drops', 'Powder', 'Other',
] as const;

export const ROUTE_OPTIONS = ['IV', 'IM', 'Oral', 'Topical', 'Ophthalmic', 'Nasal', 'Other'] as const;
export const MARKET_OPTIONS = ['Domestic', 'Export', 'Both'] as const;

export const PRODUCT_STATUSES = [
  'Active', 'Inactive', 'Discontinued', 'Under Development',
] as const;

export const PRODUCT_LIFECYCLE_STATUSES = [
  'Development',
  'Technology Transfer',
  'Validation',
  'Commercial',
  'Discontinued',
  'Archived',
] as const;

export const PRODUCT_CATEGORIES = [
  'Antibiotic', 'Analgesic', 'Antiviral', 'Vaccine', 'Oncology', 'Nutraceutical', 'API', 'Other',
] as const;

export const PACK_TYPES = [
  'Vial', 'Ampoule', 'Blister', 'Bottle', 'Strip', 'Tube', 'Sachet', 'Cartridge', 'Other',
] as const;

export const CONTAINER_CLOSURE_TYPES = [
  'Rubber Stopper', 'Aluminium Seal', 'Flip-off Cap', 'Screw Cap', 'Child-resistant Cap', 'Other',
] as const;

export const INGREDIENT_TYPES = [
  'API', 'Excipient', 'Preservative', 'Solvent', 'Buffer', 'pH Adjuster', 'Vehicle', 'Other',
] as const;

export const PACKING_MATERIAL_TYPES = [
  'Primary Packing', 'Secondary Packing', 'Tertiary Packing',
] as const;

export const PRODUCT_ATTACHMENT_TYPES = ['specification', 'stp', 'other'] as const;

export const PRODUCT_PRESET = {
  productName: 'Amikacin Injection IP',
  genericName: 'Amikacin Sulphate',
  strength: '500 mg / 2 ml',
  dosageForm: 'Injection',
  routeOfAdministration: 'IM / IV',
  shelfLife: '24',
  storageCondition: 'Store below 25°C',
  standardBatchSize: '10000 Vials',
  productStatus: 'Active' as const,
};

export const PRODUCT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const BATCH_STATUSES = [
  'Planned', 'Scheduled', 'Manufacturing', 'Sampling', 'Testing', 'Under Review',
  'Released', 'Rejected', 'Hold', 'Reprocessed', 'Closed', 'Archived',
] as const;

/** Maps legacy batch status values stored in Firestore to the current workflow. */
export const BATCH_LEGACY_STATUS_MAP: Record<string, typeof BATCH_STATUSES[number]> = {
  'Under QC Testing': 'Testing',
  'Under QA Review': 'Under Review',
  Reworked: 'Reprocessed',
  Cancelled: 'Closed',
};

export const BATCH_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  Planned: ['Scheduled', 'Manufacturing', 'Hold', 'Closed'],
  Scheduled: ['Planned', 'Manufacturing', 'Hold'],
  Manufacturing: ['Sampling', 'Hold', 'Rejected'],
  Sampling: ['Testing', 'Hold', 'Rejected'],
  Testing: ['Under Review', 'Hold', 'Rejected'],
  'Under Review': ['Released', 'Rejected', 'Hold'],
  Released: ['Hold', 'Closed', 'Archived'],
  Rejected: ['Reprocessed', 'Closed', 'Archived'],
  Hold: ['Planned', 'Scheduled', 'Manufacturing', 'Sampling', 'Testing', 'Under Review'],
  Reprocessed: ['Manufacturing', 'Testing', 'Sampling'],
  Closed: ['Archived'],
  Archived: [],
};

export const RELEASE_STATUSES = [
  'Pending', 'Released', 'Rejected', 'On Hold', 'Not Applicable',
] as const;

export const QC_STATUSES = [
  'Pending', 'In Progress', 'Approved', 'Rejected', 'On Hold', 'Not Applicable',
] as const;

export const QA_STATUSES = [
  'Pending', 'In Review', 'Approved', 'Rejected', 'On Hold', 'Not Applicable',
] as const;

export const BATCH_SIZE_UNITS = ['Vials', 'Tablets', 'Capsules', 'Bottles', 'Kg', 'L', 'Units'] as const;

export const BATCH_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const ADMIN_NAV_ITEMS = [
  { label: 'Admin Dashboard', href: '/admin', icon: 'LayoutDashboard' },
  { label: 'User Management', href: '/admin/users', icon: 'Users' },
  { label: 'Role & Permission', href: '/admin/roles', icon: 'Shield' },
  { label: 'Department Master', href: '/admin/departments', icon: 'Building2' },
  { label: 'Designation Master', href: '/admin/designations', icon: 'BadgeCheck' },
  { label: 'Company / Site Master', href: '/admin/company-site', icon: 'Factory' },
  { label: 'Product Master', href: '/admin/products', icon: 'FlaskConical' },
  { label: 'Batch Master', href: '/admin/batches', icon: 'Package' },
  { label: 'Parameter Master', href: '/admin/parameters', icon: 'SlidersHorizontal' },
  { label: 'Workflow Configuration', href: '/admin/workflows', icon: 'GitBranch' },
  { label: 'Approval Matrix', href: '/admin/approval-matrix', icon: 'CheckSquare' },
  { label: 'Document Numbering', href: '/admin/document-numbering', icon: 'Hash' },
  { label: 'Audit Trail', href: '/admin/audit-trail', icon: 'FileSearch' },
  { label: 'Login Activity', href: '/admin/login-activity', icon: 'LogIn' },
  { label: 'User Access Review', href: '/admin/user-access-review', icon: 'UserCheck' },
  { label: 'Password Policy', href: '/admin/system-settings/password-policy', icon: 'KeyRound' },
  { label: 'E-Signature Settings', href: '/admin/esign-settings', icon: 'PenLine' },
  { label: 'Notification Settings', href: '/admin/notifications', icon: 'Bell' },
  { label: 'Email/SMS Templates', href: '/admin/email-sms-templates', icon: 'Mail' },
  { label: 'Module Configuration', href: '/admin/module-configuration', icon: 'Blocks' },
  { label: 'Master Data Import/Export', href: '/admin/master-data-import-export', icon: 'FileUp' },
  { label: 'Backup & Restore', href: '/admin/backup', icon: 'Database' },
  { label: 'Backup History', href: '/admin/backup/history', icon: 'HardDrive' },
  { label: 'Firebase Status', href: '/admin/firebase-status', icon: 'Cloud' },
  { label: 'System Health Check', href: '/admin/system-health', icon: 'Activity' },
  { label: 'System Settings', href: '/admin/system-settings', icon: 'Settings' },
] as const;

export const SYSTEM_ENVIRONMENTS = ['Production', 'Staging', 'Development', 'UAT', 'Testing'] as const;

export const MODULE_CONFIG_CATEGORIES = [
  'Core Admin', 'QMS', 'Document Management', 'Equipment',
  'Quality Control', 'Supply Chain', 'Analytics', 'Integration', 'Security',
] as const;

export const MODULE_LICENSE_STATUSES = [
  'Licensed', 'Trial', 'Expired', 'Not Licensed', 'Enterprise',
] as const;

export const MODULE_FEATURE_STATUSES = [
  'GA', 'Beta', 'Experimental', 'Deprecated', 'Hidden',
] as const;

export const MODULE_VISIBILITY_STATUSES = [
  'Visible', 'Hidden', 'Menu Only', 'Route Only',
] as const;

/** Critical modules that cannot be fully disabled or uninstalled */
export const CRITICAL_MODULE_CODES = [
  'ADMIN', 'USERS', 'ROLES', 'AUDIT_TRAIL', 'ESIGN', 'SYSTEM_SETTINGS',
] as const;

export const MASTER_DATA_IMPORT_EXPORT_TYPES = [
  { code: 'departments', label: 'Department Master', collection: 'departments', uniqueKey: 'departmentCode', required: ['departmentCode', 'departmentName'] },
  { code: 'designations', label: 'Designation Master', collection: 'designations', uniqueKey: 'designationCode', required: ['designationCode', 'designationName'] },
  { code: 'company_sites', label: 'Company / Site Master', collection: 'company_sites', uniqueKey: 'siteCode', required: ['siteCode', 'siteName'] },
  { code: 'products', label: 'Product Master', collection: 'products', uniqueKey: 'productCode', required: ['productCode', 'productName'] },
  { code: 'batches', label: 'Batch Master', collection: 'batches', uniqueKey: 'batchNumber', required: ['batchNumber'] },
  { code: 'parameters', label: 'Parameter Master', collection: 'parameters', uniqueKey: 'parameterCode', required: ['parameterCode', 'parameterName'] },
  { code: 'workflows', label: 'Workflow Configuration', collection: 'workflows', uniqueKey: 'workflowCode', required: ['workflowCode', 'workflowName'] },
  { code: 'approval_matrix', label: 'Approval Matrix', collection: 'approval_matrix', uniqueKey: 'matrixCode', required: ['matrixCode'] },
  { code: 'document_numbering', label: 'Document Numbering', collection: 'document_numbering', uniqueKey: 'numberingCode', required: ['numberingCode'] },
  { code: 'notification_settings', label: 'Notification Settings', collection: 'notification_settings', uniqueKey: 'notificationCode', required: ['notificationCode', 'eventName'] },
  { code: 'email_sms_templates', label: 'Email & SMS Templates', collection: 'email_sms_templates', uniqueKey: 'templateCode', required: ['templateCode', 'templateName', 'body'] },
  { code: 'module_configuration', label: 'Module Configuration', collection: 'module_configuration', uniqueKey: 'moduleCode', required: ['moduleCode', 'moduleName'] },
] as const;

export const MASTER_DATA_IMPORT_MODES = [
  'Insert Only', 'Update Only', 'Insert + Update', 'Dry Run',
] as const;

export const MASTER_DATA_EXPORT_FORMATS = ['JSON', 'CSV'] as const;

export const MASTER_DATA_OPERATION_STATUSES = [
  'Queued', 'In Progress', 'Success', 'Partial Success', 'Failed', 'Rolled Back', 'Cancelled',
] as const;

export const FINANCIAL_YEAR_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export const SIDEBAR_MODES = ['Expanded', 'Collapsed', 'Auto'] as const;
export const LOGO_DISPLAY_MODES = ['Full Logo', 'Icon Only', 'Text Only'] as const;

export const SYSTEM_SETTINGS_TABS = [
  { id: 'general', label: 'General', href: '/admin/system-settings/general' },
  { id: 'organization', label: 'Organization', href: '/admin/system-settings/organization' },
  { id: 'branding', label: 'Branding', href: '/admin/system-settings/branding' },
  { id: 'localization', label: 'Localization', href: '/admin/system-settings/localization' },
  { id: 'security', label: 'Security', href: '/admin/system-settings/security' },
  { id: 'authentication', label: 'Authentication', href: '/admin/system-settings/authentication' },
  { id: 'password-policy', label: 'Password Policy', href: '/admin/system-settings/password-policy' },
  { id: 'session', label: 'Sessions', href: '/admin/system-settings/session' },
  { id: 'compliance', label: 'Compliance', href: '/admin/system-settings/compliance' },
  { id: 'file-upload', label: 'Storage', href: '/admin/system-settings/file-upload' },
  { id: 'theme', label: 'Theme', href: '/admin/system-settings/theme' },
  { id: 'performance', label: 'Performance', href: '/admin/system-settings/performance' },
  { id: 'api', label: 'API', href: '/admin/system-settings/api' },
  { id: 'integrations', label: 'Integrations', href: '/admin/system-settings/integrations' },
  { id: 'maintenance', label: 'Maintenance', href: '/admin/system-settings/maintenance' },
  { id: 'firebase', label: 'Firebase', href: '/admin/system-settings/firebase' },
  { id: 'logs', label: 'Logging', href: '/admin/system-settings/logs' },
  { id: 'versions', label: 'Versions', href: '/admin/system-settings/versions' },
  { id: 'reports', label: 'Reports', href: '/admin/system-settings/reports' },
] as const;
