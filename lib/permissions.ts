import {
  ADMIN_MODULES, PERMISSION_ACTIONS, ADMIN_ROLES, ADMIN_COLLECTIONS,
  ROLE_MATRIX_MODULES, ROLE_MATRIX_ACTIONS, ROLE_PRESET_OPTIONS,
} from './admin/constants';
import type { PermissionMatrix } from './admin/schemas';
import type { UserRole } from './firebase';

export type AdminRoleId = typeof ADMIN_ROLES[number]['id'];
export type AdminModule = typeof ADMIN_MODULES[number];
export type PermissionAction = typeof PERMISSION_ACTIONS[number];

/** Maps Firebase auth roles to internal admin role IDs */
const LEGACY_ROLE_MAP: Record<string, AdminRoleId> = {
  super_admin: 'super_admin',
  'super admin': 'super_admin',
  'super-admin': 'super_admin',
  superadmin: 'super_admin',
  admin: 'admin',
  qa: 'qa_manager',
  qc: 'qc_manager',
  production: 'production_manager',
  engineering: 'engineering_manager',
  warehouse: 'warehouse_manager',
  regulatory: 'regulatory_affairs',
  hr: 'hr',
  document_controller: 'document_controller',
  department_head: 'department_head',
  employee: 'employee',
  auditor: 'auditor',
  vendor: 'vendor',
  viewer: 'viewer',
  head_qa: 'head_qa',
  qa_manager: 'qa_manager',
  qc_manager: 'qc_manager',
  production_manager: 'production_manager',
  engineering_manager: 'engineering_manager',
  warehouse_manager: 'warehouse_manager',
  regulatory_affairs: 'regulatory_affairs',
  maintenance: 'maintenance',
  validation: 'validation',
  it_administrator: 'it_administrator',
  it_admin: 'it_administrator',
  'it administrator': 'it_administrator',
};

export const ROLE_DEFINITIONS: { id: UserRole; label: string; description: string }[] = [
  { id: 'super_admin', label: 'Super Admin', description: 'Full system access' },
  { id: 'admin', label: 'Admin', description: 'Admin panel and master data management' },
  { id: 'qa', label: 'QA', description: 'QMS, PQR, CPV review and approval' },
  { id: 'qc', label: 'QC', description: 'Testing, CQA, and OOS management' },
  { id: 'production', label: 'Production', description: 'Batch records, eBMR, and CPP entry' },
  { id: 'engineering', label: 'Engineering', description: 'Equipment, utility, and validation' },
  { id: 'warehouse', label: 'Warehouse', description: 'Material, inventory, and dispensing' },
  { id: 'regulatory', label: 'Regulatory', description: 'Change control, recall, and documents' },
  { id: 'hr', label: 'HR', description: 'Employee and HR administration' },
  { id: 'document_controller', label: 'Document Controller', description: 'Controlled document administration' },
  { id: 'department_head', label: 'Department Head', description: 'Department review and oversight' },
  { id: 'employee', label: 'Employee', description: 'Controlled document access' },
  { id: 'auditor', label: 'Auditor', description: 'Read-only access across modules' },
  { id: 'vendor', label: 'Vendor', description: 'Restricted vendor portal access' },
  { id: 'viewer', label: 'Viewer', description: 'Read-only viewer access' },
  { id: 'maintenance', label: 'Maintenance', description: 'Equipment maintenance operations' },
  { id: 'validation', label: 'Validation', description: 'Process and system validation' },
  { id: 'it_administrator', label: 'IT Administrator', description: 'IT administration and system support' },
];

export function normalizeRole(role?: string | null): AdminRoleId {
  if (!role) return 'viewer';
  const trimmed = role.trim();
  const lowered = trimmed.toLowerCase();
  const normalized = lowered.replace(/[\s-]+/g, '_');
  const collapsed = normalized.replace(/_/g, '');

  return (LEGACY_ROLE_MAP[trimmed]
    || LEGACY_ROLE_MAP[lowered]
    || LEGACY_ROLE_MAP[normalized]
    || LEGACY_ROLE_MAP[collapsed]
    || normalized) as AdminRoleId;
}

function buildDefaultPermissions(roleId: AdminRoleId): Record<AdminModule, Record<PermissionAction, boolean>> {
  const matrix = {} as Record<AdminModule, Record<PermissionAction, boolean>>;
  const isSuperAdmin = roleId === 'super_admin';
  const isAdmin = roleId === 'admin' || isSuperAdmin;
  const isAuditor = roleId === 'auditor';
  const isQa = ['head_qa', 'qa_manager', 'qa_executive'].includes(roleId);
  const isQc = ['qc_manager', 'qc_executive'].includes(roleId);
  const isProduction = ['production_manager', 'production_executive'].includes(roleId);
  const isEngineering = ['engineering_manager', 'engineering_executive'].includes(roleId);
  const isWarehouse = ['warehouse_manager', 'warehouse_executive'].includes(roleId);
  const isRegulatory = roleId === 'regulatory_affairs';
  const isHr = roleId === 'hr';
  const isDocumentController = roleId === 'document_controller';
  const isDepartmentHead = roleId === 'department_head';
  const isEmployee = roleId === 'employee' || roleId === 'viewer';
  const isVendor = roleId === 'vendor';

  for (const mod of ADMIN_MODULES) {
    matrix[mod] = {} as Record<PermissionAction, boolean>;
    for (const action of PERMISSION_ACTIONS) {
      if (isSuperAdmin) {
        matrix[mod][action] = true;
      } else if (isAdmin) {
        matrix[mod][action] = mod !== 'Admin' || action !== 'delete';
      } else if (isAuditor) {
        matrix[mod][action] = action === 'view' || action === 'export';
      } else if (isQa) {
        matrix[mod][action] = ['Dashboard', 'PQR', 'CPV', 'CPP', 'CQA', 'Deviation', 'CAPA', 'Change Control',
          'Complaint', 'Recall', 'Stability', 'Document', 'Reports'].includes(mod)
          ? ['view', 'create', 'edit', 'review', 'approve', 'reject', 'export', 'eSign'].includes(action)
          : action === 'view' || action === 'export';
      } else if (isQc) {
        matrix[mod][action] = ['Dashboard', 'CQA', 'OOS', 'CPV', 'Batch', 'Stability', 'Reports'].includes(mod)
          ? ['view', 'create', 'edit', 'review', 'export'].includes(action)
          : action === 'view';
      } else if (isProduction) {
        matrix[mod][action] = ['Dashboard', 'Batch', 'CPP', 'CPV', 'Product'].includes(mod)
          ? ['view', 'create', 'edit', 'export'].includes(action)
          : action === 'view';
      } else if (isEngineering) {
        matrix[mod][action] = ['Dashboard', 'Equipment', 'Validation', 'CPV'].includes(mod)
          ? ['view', 'create', 'edit', 'export'].includes(action)
          : action === 'view';
      } else if (isWarehouse) {
        matrix[mod][action] = ['Dashboard', 'Material', 'Vendor', 'Batch'].includes(mod)
          ? ['view', 'create', 'edit', 'export'].includes(action)
          : action === 'view';
      } else if (isRegulatory) {
        matrix[mod][action] = ['Dashboard', 'Change Control', 'Recall', 'Document', 'PQR', 'Complaint'].includes(mod)
          ? ['view', 'create', 'edit', 'review', 'approve', 'export'].includes(action)
          : action === 'view';
      } else if (isHr) {
        matrix[mod][action] = ['Dashboard', 'Document', 'Reports'].includes(mod)
          ? ['view', 'create', 'edit', 'review', 'export'].includes(action)
          : false;
      } else if (isDocumentController) {
        matrix[mod][action] = ['Dashboard', 'Document', 'Reports'].includes(mod)
          ? ['view', 'create', 'edit', 'review', 'export', 'archive'].includes(action)
          : false;
      } else if (isDepartmentHead) {
        matrix[mod][action] = ['Dashboard', 'Document', 'Deviation', 'CAPA', 'Reports'].includes(mod)
          ? ['view', 'review', 'approve', 'export'].includes(action)
          : false;
      } else if (isEmployee) {
        matrix[mod][action] = ['Dashboard', 'Document'].includes(mod) && action === 'view';
      } else if (isVendor) {
        matrix[mod][action] = mod === 'Vendor' && action === 'view';
      } else {
        matrix[mod][action] = false;
      }
    }
  }
  return matrix;
}

export function buildDefaultRoleMatrix(roleId: string): Record<string, Record<string, boolean>> {
  const matrix: Record<string, Record<string, boolean>> = {};
  const isSuper = roleId === 'super_admin';
  const isAdmin = roleId === 'admin' || roleId === 'it_administrator' || isSuper;
  const isAuditor = roleId === 'auditor' || roleId === 'viewer';

  for (const mod of ROLE_MATRIX_MODULES) {
    matrix[mod] = {};
    for (const action of ROLE_MATRIX_ACTIONS) {
      if (isSuper) {
        matrix[mod][action] = true;
      } else if (isAuditor) {
        matrix[mod][action] = action === 'View' || action === 'Read Only' || action === 'Export' || action === 'Print';
      } else if (isAdmin) {
        const denyAdminDelete = mod === 'Admin' && (action === 'Delete' || action === 'Admin');
        matrix[mod][action] = !denyAdminDelete && action !== 'Delete';
      } else {
        matrix[mod][action] = action === 'View' || action === 'Read Only';
      }
    }
  }
  return matrix;
}

export function getDefaultRolePermissionMatrix(roleId: string): PermissionMatrix {
  const preset = ROLE_PRESET_OPTIONS.find((r) => r.id === roleId);
  const legacy = ADMIN_ROLES.find((r) => r.id === roleId);
  return {
    roleId,
    roleName: preset?.name || legacy?.name || roleId,
    permissions: buildDefaultRoleMatrix(roleId),
    status: 'Active',
    createdBy: 'system',
    updatedBy: 'system',
  };
}

export function getDefaultPermissionMatrix(roleId: AdminRoleId): PermissionMatrix {
  return getDefaultRolePermissionMatrix(roleId);
}

export function canAccessAdminPanel(role?: string | null): boolean {
  const r = normalizeRole(role);
  if (['super_admin', 'admin', 'head_qa', 'auditor'].includes(r)) return true;
  // Master-data roles that have at least one scoped admin route (products, equipment, etc.)
  return canViewProducts(role) || canViewEquipmentMaster(role) || canViewBatches(role) || canViewParameters(role);
}

export function canManageRoles(role?: string | null): boolean {
  return normalizeRole(role) === 'super_admin';
}

export function canViewRoles(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'auditor'].includes(r);
}

export function canEditRoles(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canEditSuperAdminRole(role?: string | null): boolean {
  return normalizeRole(role) === 'super_admin';
}

export function canManagePermissions(role?: string | null): boolean {
  return normalizeRole(role) === 'super_admin';
}

export function canDeleteRecords(role?: string | null): boolean {
  return normalizeRole(role) === 'super_admin';
}

export function canChangeSystemSettings(role?: string | null): boolean {
  return normalizeRole(role) === 'super_admin';
}

/** View system settings (QA Head and Auditor = read-only). */
export function canViewSystemSettings(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'auditor'].includes(r);
}

export function canViewModuleConfiguration(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'auditor', 'qa_manager'].includes(r);
}

export function canEditModuleConfiguration(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canViewMasterDataImportExport(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'auditor', 'qa_manager'].includes(r);
}

export function canEditMasterDataImportExport(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

/** Edit general, theme, file-upload sections (non-security). */
export function canEditSystemSettings(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

/** Edit security, password, session, maintenance toggle, logs config. */
export function canEditSecuritySystemSettings(role?: string | null): boolean {
  return normalizeRole(role) === 'super_admin';
}

export function canRestoreBackup(role?: string | null): boolean {
  return normalizeRole(role) === 'super_admin';
}

/** View backup dashboard, history, and download backups (QA Head = view only, Auditor = read-only). */
export function canViewBackup(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'auditor'].includes(r);
}

/** Create manual backups and configure schedule (not restore). */
export function canCreateBackup(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

/** Approve restore requests — Super Admin only. */
export function canApproveRestore(role?: string | null): boolean {
  return normalizeRole(role) === 'super_admin';
}

/** Edit backup settings (schedule, retention). */
export function canEditBackupSettings(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canManageUsers(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

/** View user list and profiles (Head QA = view only, Auditor = read-only). */
export function canViewUsers(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'auditor'].includes(r);
}

export function canAccessAdminRoute(role: string | null | undefined, pathname: string): boolean {
  if (!canAccessAdminPanel(role)) return false;
  if (pathname === '/admin' || pathname === '/dashboard/admin') return true;

  const routeChecks: Array<[string, (value?: string | null) => boolean]> = [
    ['/admin/users', canViewUsers],
    ['/admin/roles', canViewRoles],
    ['/admin/departments', canViewDepartments],
    ['/admin/designations', canViewDesignations],
    ['/admin/company-site', canViewCompanySites],
    ['/admin/products', canViewProducts],
    ['/admin/equipment', canViewEquipmentMaster],
    ['/admin/batches', canViewBatches],
    ['/admin/parameters', canViewParameters],
    ['/admin/workflows', canViewWorkflows],
    ['/admin/approval-matrix', canViewApprovalMatrix],
    ['/admin/document-numbering', canViewDocumentNumbering],
    ['/admin/audit-trail', canViewAuditTrail],
    ['/admin/login-activity', canViewLoginActivity],
    ['/admin/user-access-review', canViewAccessReview],
    ['/admin/esign-settings', canViewEsignSettings],
    ['/admin/notifications', canViewNotificationSettings],
    ['/admin/email-sms-templates', canViewEmailSmsTemplates],
    ['/admin/module-configuration', canViewModuleConfiguration],
    ['/admin/master-data-import-export', canViewMasterDataImportExport],
    ['/admin/backup', canViewBackup],
    ['/admin/system-settings', canViewSystemSettings],
    ['/admin/firebase-status', canViewSystemSettings],
    ['/admin/system-health', canViewSystemSettings],
    ['/dashboard/admin/login-activity', canViewLoginActivity],
    ['/dashboard/admin/user-access-review', canViewAccessReview],
    ['/dashboard/admin/password-policy', canViewSystemSettings],
    ['/admin/system-settings/password-policy', canViewSystemSettings],
    ['/dashboard/admin/email-sms-templates', canViewEmailSmsTemplates],
    ['/dashboard/admin/module-configuration', canViewModuleConfiguration],
    ['/dashboard/admin/master-data-import-export', canViewMasterDataImportExport],
    ['/dashboard/admin/data-backup-log', canViewBackup],
    ['/dashboard/admin/firebase-status', canViewSystemSettings],
    ['/dashboard/admin/system-health', canViewSystemSettings],
  ];
  const match = routeChecks.find(([prefix]) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return match ? match[1](role) : false;
}

export function canEditUsers(role?: string | null): boolean {
  return canManageUsers(role);
}

/** View department master (QA Head = view only, Auditor = read-only). */
export function canViewDepartments(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'auditor'].includes(r);
}

export function canEditDepartments(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

/** View designation master (QA Head = view only, Auditor = read-only). */
export function canViewDesignations(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'auditor'].includes(r);
}

export function canEditDesignations(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

/** View company/site master (QA Head = view only, Auditor = read-only). */
export function canViewCompanySites(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'auditor'].includes(r);
}

export function canEditCompanySites(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canViewProducts(role?: string | null): boolean {
  const r = normalizeRole(role);
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
    'qc_manager', 'qc_executive', 'production_manager', 'production_executive', 'auditor',
  ].includes(r);
}

export function canEditProducts(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive'].includes(r);
}

/** View equipment master register (Admin Master Data). */
export function canViewEquipmentMaster(role?: string | null): boolean {
  const r = normalizeRole(role);
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
    'engineering_manager', 'engineering_executive', 'maintenance',
    'production_manager', 'qc_manager', 'auditor',
  ].includes(r);
}

export function canEditEquipmentMaster(role?: string | null): boolean {
  const r = normalizeRole(role);
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager',
    'engineering_manager', 'engineering_executive', 'maintenance',
  ].includes(r);
}

/** Align with Cloud Function product editors + storage write rules (QC cannot register attachments). */
export function canUploadProductAttachments(role?: string | null): boolean {
  return canEditProducts(role);
}

export function canImportProducts(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canViewBatches(role?: string | null): boolean {
  const r = normalizeRole(role);
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
    'qc_manager', 'qc_executive', 'production_manager', 'production_executive',
    'warehouse_manager', 'warehouse_executive', 'auditor',
  ].includes(r);
}

export function canEditBatches(role?: string | null): boolean {
  const r = normalizeRole(role);
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
    'production_manager', 'production_executive',
  ].includes(r);
}

export function canImportBatches(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canReleaseBatches(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'qa_manager'].includes(r);
}

export function canQcUpdateBatches(role?: string | null): boolean {
  const r = normalizeRole(role);
  return canReleaseBatches(role) || ['qc_manager', 'qc_executive'].includes(r);
}

export function canQaOverrideBatch(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'head_qa'].includes(r);
}

export function canProductionCreateBatches(role?: string | null): boolean {
  const r = normalizeRole(role);
  return canEditBatches(role);
}

export function canViewParameters(role?: string | null): boolean {
  const r = normalizeRole(role);
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
    'qc_manager', 'qc_executive', 'production_manager', 'production_executive',
    'engineering_manager', 'engineering_executive', 'auditor',
  ].includes(r);
}

export function canEditParameters(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive'].includes(r);
}

export function canEditQcParameters(role?: string | null): boolean {
  const r = normalizeRole(role);
  return canEditParameters(role) || ['qc_manager', 'qc_executive'].includes(r);
}

export function canEditUtilityParameters(role?: string | null): boolean {
  const r = normalizeRole(role);
  return canEditParameters(role) || ['engineering_manager', 'engineering_executive'].includes(r);
}

export function canImportParameters(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canActivateParameters(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canViewCppParametersOnly(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['production_manager', 'production_executive'].includes(r);
}

const QC_PARAMETER_TYPES = [
  'CQA', 'IPC', 'Finished Product Test', 'Stability Test',
  'Raw Material Test', 'Packing Material Test',
] as const;

const UTILITY_PARAMETER_TYPES = ['Utility Parameter', 'Environmental Parameter'] as const;

export function canCreateParameters(role?: string | null): boolean {
  return canEditParameters(role) || canEditQcParameters(role) || canEditUtilityParameters(role);
}

export function canEditParameterType(role?: string | null, parameterType?: string): boolean {
  if (!parameterType) return canCreateParameters(role);
  if (canEditParameters(role)) return true;
  const r = normalizeRole(role);
  if (['qc_manager', 'qc_executive'].includes(r) && QC_PARAMETER_TYPES.includes(parameterType as typeof QC_PARAMETER_TYPES[number])) return true;
  if (['engineering_manager', 'engineering_executive'].includes(r) && UTILITY_PARAMETER_TYPES.includes(parameterType as typeof UTILITY_PARAMETER_TYPES[number])) return true;
  return false;
}

export function canViewWorkflows(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'auditor'].includes(r);
}

export function canEditWorkflows(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canActivateWorkflows(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canRecommendWorkflowChanges(role?: string | null): boolean {
  const r = normalizeRole(role);
  return r === 'head_qa';
}

export function canViewApprovalMatrix(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'auditor'].includes(r);
}

export function canEditApprovalMatrix(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canActivateApprovalMatrix(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canViewDocumentNumbering(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'auditor'].includes(r);
}

export function canEditDocumentNumbering(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canManualOverrideDocumentNumber(role?: string | null): boolean {
  return canEditDocumentNumbering(role);
}

export function canViewNotificationSettings(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'auditor', 'qa_manager'].includes(r);
}

export function canEditNotificationSettings(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canViewEmailSmsTemplates(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'auditor', 'qa_manager'].includes(r);
}

export function canEditEmailSmsTemplates(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canApproveEmailSmsTemplates(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa'].includes(r);
}

export function canViewEsignSettings(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'auditor'].includes(r);
}

export function canEditEsignSettings(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canRecommendEsignChanges(role?: string | null): boolean {
  const r = normalizeRole(role);
  return r === 'head_qa';
}

export function canViewAuditTrail(role?: string | null): boolean {
  const r = normalizeRole(role);
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive', 'qa',
    'regulatory_affairs', 'regulatory', 'auditor',
  ].includes(r);
}

export function canViewLoginActivity(role?: string | null): boolean {
  return canViewAuditTrail(role);
}

export function canManageLoginSessions(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canExportLoginActivity(role?: string | null): boolean {
  return canExportAuditTrail(role);
}

export function canArchiveLoginActivity(role?: string | null): boolean {
  return canArchiveAuditTrail(role);
}

export function canViewAccessReview(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive', 'qa', 'auditor', 'regulatory_affairs', 'regulatory'].includes(r);
}

export function canManageAccessReview(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'qa_manager'].includes(r);
}

export function canCompleteAccessReview(role?: string | null): boolean {
  return canManageAccessReview(role);
}

export function canGenerateAccessReviewCampaign(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canExportAccessReview(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'auditor', 'head_qa'].includes(r);
}

export function canArchiveAccessReview(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canExportAuditTrail(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'auditor'].includes(r);
}

export function canArchiveAuditTrail(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canVerifyAuditIntegrity(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'auditor', 'head_qa'].includes(r);
}

export function canViewAllAuditTrail(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'auditor'].includes(r);
}

export function canViewAdminAuditTrail(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin'].includes(r);
}

export function canViewQmsAuditTrail(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'head_qa', 'auditor'].includes(r);
}

export function canManageMasterData(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'qa_manager'].includes(r);
}

export function isReadOnlyRole(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['auditor', 'viewer'].includes(r);
}

const ACTION_ALIASES: Record<PermissionAction, string[]> = {
  view: ['View', 'view', 'Read Only'],
  create: ['Create', 'create'],
  edit: ['Edit', 'edit'],
  delete: ['Delete', 'delete'],
  review: ['Review', 'review'],
  approve: ['Approve', 'approve'],
  reject: ['Reject', 'reject'],
  export: ['Export', 'export', 'Print'],
  import: ['Import', 'import'],
  archive: ['Archive', 'Close', 'archive'],
  eSign: ['Electronic Signature', 'eSign', 'e-sign'],
};

const MODULE_ALIASES: Record<string, string[]> = {
  Dashboard: ['Admin', 'Dashboard'],
  Document: ['DMS'],
  Reports: ['Admin', 'Reports'],
  CPP: ['CPV'],
  CQA: ['CPV'],
  Batch: ['Warehouse', 'eBMR', 'Inventory'],
  Product: ['CPV'],
  Material: ['Warehouse', 'Inventory'],
  Complaint: ['Complaint'],
  Settings: ['Admin', 'Settings'],
  Notifications: ['Notifications'],
};

function matrixHasAction(
  modPerms: Record<string, boolean> | undefined,
  action: PermissionAction,
): boolean {
  if (!modPerms) return false;
  const aliases = ACTION_ALIASES[action] || [action];
  return aliases.some((a) => modPerms[a] === true);
}

export function hasPermission(
  permissions: PermissionMatrix | null | undefined,
  module: AdminModule,
  action: PermissionAction,
  role?: string | null,
): boolean {
  if (canManagePermissions(role)) return true;
  if (isReadOnlyRole(role)) return action === 'view' || action === 'export';

  const perms = permissions?.permissions;
  if (perms) {
    if (matrixHasAction(perms[module], action)) return true;
    const aliases = MODULE_ALIASES[module] || [];
    for (const alias of aliases) {
      if (matrixHasAction(perms[alias], action)) return true;
    }
  }

  if (!perms?.[module]) {
    const defaults = buildDefaultPermissions(normalizeRole(role));
    return defaults[module]?.[action] ?? false;
  }
  return perms[module]?.[action] ?? false;
}

export function canViewDepartmentUsers(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qc_manager',
    'production_manager', 'warehouse_manager', 'engineering_manager'].includes(r);
}

export type AppModule =
  | 'admin' | 'cpv' | 'pqr' | 'qms' | 'deviation' | 'oos' | 'capa' | 'change_control'
  | 'stability' | 'complaints' | 'recall' | 'dms' | 'audit' | 'vendors' | 'risk'
  | 'validation' | 'csv' | 'equipment' | 'monitoring' | 'warehouse' | 'ebmr';

const MODULE_ROLE_ACCESS: Record<AppModule, AdminRoleId[]> = {
  admin: ['super_admin', 'admin'],
  cpv: ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qc_manager', 'production_manager', 'engineering_manager'],
  pqr: [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
    'qc_manager', 'qc_executive', 'production_manager', 'production_executive',
    'engineering_manager', 'engineering_executive', 'warehouse_manager',
    'regulatory_affairs', 'department_head',
  ],
  qms: ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qc_manager', 'production_manager',
    'warehouse_manager', 'engineering_manager', 'regulatory_affairs'],
  deviation: ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qc_manager', 'production_manager',
    'warehouse_manager', 'engineering_manager', 'regulatory_affairs'],
  oos: ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qc_manager'],
  capa: ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qc_manager', 'production_manager'],
  change_control: ['super_admin', 'admin', 'head_qa', 'qa_manager', 'regulatory_affairs'],
  risk: ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qc_manager', 'regulatory_affairs'],
  stability: ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qc_manager'],
  complaints: ['super_admin', 'admin', 'head_qa', 'qa_manager', 'regulatory_affairs'],
  recall: ['super_admin', 'admin', 'head_qa', 'qa_manager', 'regulatory_affairs'],
  dms: ['super_admin', 'admin', 'head_qa', 'qa_manager', 'regulatory_affairs',
    'document_controller', 'department_head', 'employee', 'hr'],
  audit: ['super_admin', 'admin', 'head_qa', 'qa_manager', 'auditor'],
  vendors: ['super_admin', 'admin', 'head_qa', 'qa_manager', 'warehouse_manager', 'vendor'],
  validation: ['super_admin', 'admin', 'head_qa', 'qa_manager', 'engineering_manager'],
  csv: ['super_admin', 'admin', 'head_qa', 'qa_manager', 'engineering_manager'],
  equipment: ['super_admin', 'admin', 'engineering_manager', 'production_manager'],
  monitoring: ['super_admin', 'admin', 'engineering_manager', 'qc_manager'],
  warehouse: ['super_admin', 'admin', 'warehouse_manager', 'production_manager'],
  ebmr: ['super_admin', 'admin', 'production_manager', 'warehouse_manager', 'head_qa', 'qa_manager', 'qc_manager', 'engineering_manager'],
};

export function canAccessModule(role: string | null | undefined, module: AppModule): boolean {
  const r = normalizeRole(role);
  if (r === 'super_admin') return true;
  if (['auditor', 'viewer'].includes(r)) {
    return ['audit', 'qms', 'pqr', 'dms', 'stability', 'complaints', 'recall',
      'deviation', 'oos', 'capa', 'change_control', 'risk', 'cpv', 'vendors', 'validation', 'csv',
      'equipment', 'monitoring', 'warehouse', 'ebmr'].includes(module);
  }
  if (r === 'document_controller') return module === 'dms';
  if (r === 'hr') return module === 'dms';
  if (r === 'department_head') return ['dms', 'deviation', 'capa'].includes(module);
  if (r === 'employee') return module === 'dms';
  if (r === 'vendor') return module === 'vendors';
  return MODULE_ROLE_ACCESS[module]?.includes(r) ?? false;
}

export function canEditModule(role: string | null | undefined, module: AppModule): boolean {
  if (isReadOnlyRole(role) || ['employee', 'vendor', 'department_head'].includes(normalizeRole(role))) return false;
  return canAccessModule(role, module);
}

export { ADMIN_COLLECTIONS, ADMIN_MODULES, PERMISSION_ACTIONS, ADMIN_ROLES };
