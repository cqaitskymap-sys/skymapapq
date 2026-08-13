export const EQUIPMENT_COLLECTIONS = {
  master: 'equipment_master',
  calibration: 'calibration_records',
  pm: 'pm_records',
  breakdown: 'breakdown_records',
  statusHistory: 'equipment_status_history',
  attachments: 'equipment_attachments',
  auditLogs: 'audit_trail',
  notifications: 'notifications',
} as const;

export const EQUIPMENT_TYPES = [
  'Manufacturing Equipment', 'Packing Equipment', 'QC Instrument', 'Utility Equipment',
  'IT System', 'HVAC', 'Water System', 'Compressed Air System',
] as const;

export const EQUIPMENT_STATUSES = ['Active', 'Inactive', 'Blocked', 'Under Maintenance', 'Retired'] as const;

export const EQUIPMENT_QUALIFICATION_STATUSES = [
  'Qualified', 'Not Qualified',
] as const;

export const EQUIPMENT_MANUFACTURING_LINES = ['A1', 'A2', 'LV', 'DPI', '3 Piece'] as const;

export const CALIBRATION_STATUSES = ['Calibrated', 'Due', 'Overdue', 'Failed', 'Not Required'] as const;

export const PM_STATUSES = ['Completed', 'Due', 'Overdue', 'Failed', 'Not Required'] as const;

export const BREAKDOWN_STATUSES = ['Open', 'In Progress', 'Closed', 'Cancelled'] as const;

export const CALIBRATION_TYPES = ['Internal', 'External', 'Vendor', 'Self'] as const;

export const PM_TYPES = ['Scheduled', 'Unscheduled', 'Annual', 'Quarterly', 'Monthly'] as const;

export const EQUIPMENT_DEPARTMENTS = [
  'Production', 'QC', 'QA', 'Engineering', 'Warehouse', 'Regulatory',
  'Microbiology', 'Packaging', 'Maintenance', 'Utilities', 'PQR', 'CPV',
] as const;

export interface EquipmentActor {
  id: string;
  name: string;
  role: string;
}

export interface EquipmentRecord {
  id: string;
  equipment_id: string;
  equipment_name: string;
  qualification_status: string;
  manufacturing_line: string;
  /** Legacy / extended fields retained for calibration, PM, and older records */
  equipment_type: string;
  department: string;
  area_room_no: string;
  make: string;
  model: string;
  serial_no: string;
  capacity: string;
  installation_date: string | null;
  calibration_required: boolean;
  pm_required: boolean;
  qualification_required: boolean;
  cleaning_required: boolean;
  equipment_status: string;
  calibration_due_date: string | null;
  calibration_status: string;
  pm_due_date: string | null;
  pm_status: string;
  validation_id: string | null;
  remarks: string;
  is_deleted?: boolean;
  created_by: string;
  created_by_name: string;
  updated_by: string;
  updated_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface CalibrationRecord {
  id: string;
  calibration_record_no: string;
  equipment_id: string;
  equipment_doc_id: string;
  equipment_name: string;
  calibration_type: string;
  calibration_date: string;
  calibration_due_date: string;
  calibration_agency: string;
  certificate_no: string;
  acceptance_criteria: string;
  observed_result: string;
  calibration_status: string;
  certificate_url: string;
  reviewed_by: string;
  reviewed_by_name: string;
  approved_by: string;
  approved_by_name: string;
  remarks: string;
  created_at: string;
  updated_at: string;
}

export interface PmRecord {
  id: string;
  pm_record_no: string;
  equipment_id: string;
  equipment_doc_id: string;
  equipment_name: string;
  pm_type: string;
  pm_date: string;
  next_pm_due_date: string;
  checklist_completed: boolean;
  observation: string;
  spare_parts_used: string;
  pm_status: string;
  done_by: string;
  done_by_name: string;
  reviewed_by: string;
  reviewed_by_name: string;
  remarks: string;
  created_at: string;
  updated_at: string;
}

export interface BreakdownRecord {
  id: string;
  breakdown_no: string;
  equipment_id: string;
  equipment_doc_id: string;
  equipment_name: string;
  breakdown_date: string;
  reported_by: string;
  reported_by_name: string;
  problem_description: string;
  impact_on_batch: boolean;
  impact_on_product_quality: boolean;
  immediate_action: string;
  root_cause: string;
  corrective_action: string;
  start_time: string;
  end_time: string;
  downtime_hours: number;
  status: string;
  capa_required: boolean;
  deviation_required: boolean;
  linked_deviation_id: string | null;
  linked_deviation_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface EquipmentStatusHistory {
  id: string;
  equipment_doc_id: string;
  equipment_id: string;
  old_status: string;
  new_status: string;
  reason: string;
  changed_by: string;
  changed_by_name: string;
  changed_at: string;
}

export interface EquipmentAttachment {
  id: string;
  equipment_doc_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  category: string;
  storage_path: string;
  download_url: string;
  uploaded_by: string;
  uploaded_by_name: string;
  uploaded_at: string;
}

export interface EquipmentFilters {
  equipment_type?: string;
  equipment_status?: string;
  department?: string;
  calibration_status?: string;
  search?: string;
}

export interface EquipmentDashboardMetrics {
  total: number;
  active: number;
  blocked: number;
  calibrationDue: number;
  calibrationOverdue: number;
  pmDue: number;
  pmOverdue: number;
  breakdownsThisMonth: number;
  availabilityPercent: number;
}

export function isEquipmentUsable(eq: Pick<EquipmentRecord, 'equipment_status' | 'calibration_status' | 'pm_status' | 'qualification_status' | 'calibration_required' | 'pm_required' | 'is_deleted'>): boolean {
  if (eq.is_deleted || eq.equipment_status !== 'Active') return false;
  if (eq.qualification_status !== 'Qualified' && eq.qualification_status !== 'Not Required') return false;
  if (eq.calibration_required && (eq.calibration_status === 'Failed' || eq.calibration_status === 'Overdue')) return false;
  if (eq.pm_required && (eq.pm_status === 'Failed' || eq.pm_status === 'Overdue')) return false;
  return true;
}

export function isEquipmentReadOnly(role: string): boolean {
  return ['auditor', 'viewer'].includes(role);
}

export function canManageEquipment(role: string): boolean {
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager',
    'engineering', 'engineering_manager', 'engineering_executive', 'maintenance',
  ].includes(role);
}

export function canApproveEquipment(role: string): boolean {
  return ['super_admin', 'admin', 'head_qa', 'qa_manager'].includes(role);
}

export function canReportBreakdown(role: string): boolean {
  return canManageEquipment(role) || ['production_manager', 'qc_manager'].includes(role);
}

export function calcDowntimeHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const diff = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(0, Math.round((diff / 3600000) * 10) / 10);
}
