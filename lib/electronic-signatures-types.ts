export const ESIG_MODULE = 'Electronic Signatures';

export const ESIG_COLLECTIONS = {
  signatures: 'electronic_signatures',
  meanings: 'signature_meanings',
  sessions: 'signature_sessions',
  settings: 'signature_settings',
  esignRecords: 'esign_records',
  esignSettings: 'esign_settings',
  users: 'users',
  notifications: 'notifications',
  auditTrail: 'audit_trail',
} as const;

export const SIGNATURE_STATUSES = ['Signed', 'Failed', 'Pending', 'Test', 'Dual Pending', 'Verified'] as const;
export const SIGNATURE_METHODS = ['Password Re-authentication', 'Biometric', 'Token', 'Test'] as const;

export const DEFAULT_SIGNATURE_MEANINGS = [
  'I approve this document.',
  'I reviewed this record.',
  'I acknowledge this document.',
  'I authorize this change.',
  'I certify this training completion.',
  'I verify this data.',
  'I reject this request.',
  'I close this record.',
  'I release this batch.',
] as const;

export const SUPPORTED_ESIG_MODULES = [
  'Document Approval', 'Document Acknowledgement',
  'CAPA Approval', 'Deviation Approval', 'OOS Approval', 'Change Control Approval',
  'Risk Approval', 'Validation Approval', 'Batch Release', 'DMS', 'PQR', 'Deviation',
  'OOS', 'CAPA', 'Change Control', 'Complaint', 'Recall',
] as const;

export interface ElectronicSignatureRecord {
  id: string;
  signature_id: string;
  signature_number: string;
  entity_type: string;
  entity_id: string;
  reference_number: string;
  module: string;
  action: string;
  signature_meaning: string;
  reason: string;
  signer_user_id: string;
  signer_name: string;
  signer_role: string;
  department: string;
  email: string;
  signature_method: string;
  authentication_result: string;
  signed_at: string;
  ip_address: string;
  device_information: string;
  browser_information: string;
  session_id: string;
  hash_value: string;
  status: string;
  dual_signature_required: boolean;
  dual_signature_completed: boolean;
  esign_record_id: string;
  created_at: string;
}

export interface SignatureKpis {
  totalSignatures: number;
  todaysSignatures: number;
  pendingSignatures: number;
  failedAttempts: number;
  documentSignatures: number;
  trainingSignatures: number;
  approvalSignatures: number;
  dualSignatures: number;
}

export interface SignatureCharts {
  dailyTrend: { date: string; count: number }[];
  moduleWise: { name: string; value: number }[];
  meaningDistribution: { name: string; value: number }[];
  failedAuthTrend: { date: string; count: number }[];
  userActivity: { name: string; value: number }[];
}

export interface SignatureFilters {
  status?: string;
  module?: string;
  signer_id?: string;
  meaning?: string;
  search?: string;
  failed?: boolean;
  today?: boolean;
  dual?: boolean;
  document?: boolean;
  training?: boolean;
  approval?: boolean;
}

export interface SignatureActor {
  id: string;
  name: string;
  role: string;
  email?: string;
  department?: string;
}

const ADMIN = ['super_admin', 'admin'];
const QA = [...ADMIN, 'head_qa', 'qa_manager', 'qa_executive'];
const APPROVER = [...QA, 'production_manager', 'qc_manager', 'regulatory_affairs'];
const EMPLOYEE = ['employee', 'viewer'];
const AUDITOR = ['auditor'];

export function canViewSignatures(role: string): boolean {
  return role !== 'viewer';
}
export function canSignRecords(role: string): boolean {
  return APPROVER.includes(role) || ['production_executive', 'qc_executive'].includes(role);
}
export function canManageSignatures(role: string): boolean { return ADMIN.includes(role); }
export function isSignatureReadOnly(role: string): boolean { return AUDITOR.includes(role); }
export function canExportSignatures(role: string): boolean { return canViewSignatures(role); }
export function canVerifySignatures(role: string): boolean { return QA.includes(role) || ADMIN.includes(role); }

export function signatureStatusColor(status: string): string {
  const colors: Record<string, string> = {
    Signed: 'bg-green-100 text-green-800',
    Verified: 'bg-blue-100 text-blue-800',
    Failed: 'bg-red-100 text-red-700',
    Pending: 'bg-amber-100 text-amber-800',
    Test: 'bg-purple-100 text-purple-800',
    'Dual Pending': 'bg-orange-100 text-orange-800',
  };
  return colors[status] || colors.Pending;
}
