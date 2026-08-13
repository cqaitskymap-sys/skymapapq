/** QMS Environmental & Utility Monitoring — dedicated collections (not CPV CF-locked names). */
export const MONITORING_COLLECTIONS = {
  areaMaster: 'monitoring_area_master',
  environmental: 'monitoring_environmental',
  utility: 'monitoring_utility',
  excursions: 'monitoring_excursions',
  trends: 'monitoring_trends',
  attachments: 'monitoring_attachments',
  auditLogs: 'audit_logs',
  notifications: 'notifications',
} as const;

export const CLEANROOM_GRADES = [
  'Grade A', 'Grade B', 'Grade C', 'Grade D', 'Controlled Area', 'Unclassified',
] as const;

export const CRITICAL_GRADES = ['Grade A', 'Grade B'] as const;

export const MONITORING_TYPES = [
  'Temperature', 'Relative Humidity', 'Differential Pressure', 'Non-Viable Particle',
  'Viable Particle', 'Surface Monitoring', 'Personnel Monitoring', 'Settle Plate', 'Active Air Sampling',
] as const;

export const UTILITY_TYPES = [
  'Purified Water', 'Water for Injection', 'Compressed Air', 'Clean Steam',
  'Nitrogen', 'HVAC', 'Chilled Water', 'Boiler Steam',
] as const;

export const UTILITY_PARAMETERS = [
  'Conductivity', 'TOC', 'pH', 'Microbial Count', 'Endotoxin', 'Pressure',
  'Temperature', 'Dew Point', 'Oil Content', 'Particle Count',
] as const;

export const MONITORING_STATUSES = [
  'Complies', 'Alert', 'Action', 'Excursion', 'Under Review', 'Closed',
] as const;

export const EXCURSION_STATUSES = ['Open', 'Under Review', 'Closed'] as const;

export const AREA_STATUSES = ['Active', 'Inactive', 'Under Qualification', 'Retired'] as const;

export const MONITORING_DEPARTMENTS = [
  'Production', 'QC', 'QA', 'Engineering', 'Microbiology', 'Packaging', 'Maintenance', 'Utilities', 'PQR', 'CPV',
] as const;

export interface MonitoringActor {
  id: string;
  name: string;
  role: string;
}

export interface AreaRecord {
  id: string;
  area_code: string;
  area_name: string;
  department: string;
  room_number: string;
  cleanroom_grade: string;
  process_area: string;
  monitoring_required: boolean;
  temperature_limit_lower: number | null;
  temperature_limit_upper: number | null;
  rh_limit_lower: number | null;
  rh_limit_upper: number | null;
  dp_limit_lower: number | null;
  dp_limit_upper: number | null;
  area_status: string;
  remarks: string;
  created_by: string;
  created_by_name: string;
  updated_by: string;
  updated_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface EnvironmentalRecord {
  id: string;
  monitoring_number: string;
  monitoring_date: string;
  monitoring_time: string;
  area_doc_id: string;
  area_name: string;
  room_number: string;
  cleanroom_grade: string;
  product_name: string;
  batch_number: string;
  monitoring_type: string;
  parameter_name: string;
  observed_value: number;
  lower_limit: number;
  upper_limit: number;
  unit: string;
  status: string;
  recorded_by: string;
  recorded_by_name: string;
  reviewed_by: string;
  reviewed_by_name: string;
  remarks: string;
  linked_excursion_id: string | null;
  linked_deviation_id: string | null;
  linked_deviation_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface UtilityRecord {
  id: string;
  utility_record_no: string;
  monitoring_date: string;
  monitoring_time: string;
  utility_type: string;
  sampling_point: string;
  parameter_name: string;
  observed_value: number;
  lower_limit: number;
  upper_limit: number;
  unit: string;
  status: string;
  recorded_by: string;
  recorded_by_name: string;
  reviewed_by: string;
  reviewed_by_name: string;
  remarks: string;
  linked_excursion_id: string | null;
  linked_deviation_id: string | null;
  linked_deviation_number: string | null;
  capa_recommended: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExcursionRecord {
  id: string;
  excursion_number: string;
  source_type: 'environmental' | 'utility';
  source_record_id: string;
  source_record_no: string;
  area_name: string;
  parameter_name: string;
  observed_value: number;
  lower_limit: number;
  upper_limit: number;
  unit: string;
  cleanroom_grade: string;
  excursion_date: string;
  status: string;
  is_critical_area: boolean;
  is_repeated: boolean;
  linked_deviation_id: string | null;
  linked_deviation_number: string | null;
  capa_recommended: boolean;
  closed_by: string;
  closed_by_name: string;
  closed_at: string | null;
  remarks: string;
  created_at: string;
  updated_at: string;
}

export interface MonitoringAttachment {
  id: string;
  area_doc_id: string;
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

export interface AreaFilters {
  cleanroom_grade?: string;
  area_status?: string;
  department?: string;
  search?: string;
}

export interface MonitoringFilters {
  status?: string;
  monitoring_type?: string;
  utility_type?: string;
  area_doc_id?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
}

export interface MonitoringDashboardMetrics {
  totalRecords: number;
  compliant: number;
  alert: number;
  action: number;
  excursions: number;
  openExcursions: number;
  closedExcursions: number;
  repeatedExcursions: number;
}

export function classifyMonitoringValue(
  observed: number, lower: number, upper: number,
): 'Complies' | 'Alert' | 'Excursion' {
  if (observed < lower || observed > upper) return 'Excursion';
  const range = upper - lower || 1;
  const margin = range * 0.1;
  if (observed <= lower + margin || observed >= upper - margin) return 'Alert';
  return 'Complies';
}

export function isCriticalGrade(grade: string): boolean {
  return (CRITICAL_GRADES as readonly string[]).includes(grade);
}

export function isMonitoringReadOnly(role: string): boolean {
  return ['auditor', 'viewer'].includes(role);
}

export function canManageMonitoring(role: string): boolean {
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'engineering', 'maintenance'].includes(role);
}

export function canEnterEnvironmental(role: string): boolean {
  return canManageMonitoring(role) || ['qc_manager', 'microbiology', 'production_manager'].includes(role);
}

export function canEnterUtility(role: string): boolean {
  return canManageMonitoring(role) || ['qc_manager', 'engineering'].includes(role);
}

export function canEnterMicrobial(role: string): boolean {
  return canManageMonitoring(role) || ['microbiology', 'qc_manager'].includes(role);
}

export function canReviewExcursions(role: string): boolean {
  return ['super_admin', 'admin', 'head_qa', 'qa_manager'].includes(role);
}
