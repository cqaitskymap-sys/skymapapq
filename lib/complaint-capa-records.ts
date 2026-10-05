import { normalizeRole } from '@/lib/permissions';
import { type CapaRecord } from '@/lib/capa-types';
import { localCalendarDate } from '@/lib/qms-record-guard';
import type { ComplaintCapaLink, ComplaintImpactAssessment, ComplaintRecord } from '@/lib/complaint-types';

export const COMPLAINT_CAPA_MODULE = 'Complaint CAPA Link';

export type ComplaintCapaLinkActor = { id: string; name: string; role?: string; email?: string; department?: string };

export type ComplaintCapaLinkFormInput = {
  capa_required: boolean;
  capa_number?: string;
  capa_title?: string;
  capa_source?: string;
  root_cause: string;
  corrective_action: string;
  preventive_action: string;
  action_owner_name: string;
  department?: string;
  target_completion_date: string;
  effectiveness_check_required: boolean;
  remarks?: string;
};

export function impactYes(value?: string | boolean): boolean {
  if (typeof value === 'boolean') return value;
  return value === 'Yes';
}

export function computeComplaintCapaMandatory(
  record: ComplaintRecord,
  impact?: ComplaintImpactAssessment | null,
): boolean {
  if (record.capa_required) return true;
  if (impact?.capa_required) return true;
  if (impactYes(impact?.product_quality_impact) || impactYes(record.product_quality_impact)) return true;
  if (impactYes(impact?.patient_safety_impact) || record.product_safety_impact) return true;
  if (record.complaint_criticality === 'Critical') return true;
  if (record.is_repeat_complaint) return true;
  return false;
}

export function mapCapaRecordToComplaintDisplayStatus(capaStatus?: string, targetDate?: string | null): string {
  const s = (capaStatus || 'draft').toLowerCase();
  if (s === 'overdue') return 'Overdue';
  if (s === 'closed') return 'Closed';
  if (s !== 'rejected' && targetDate && targetDate < localCalendarDate()) return 'Overdue';
  if (s === 'approved') return 'Approved';
  if (s === 'draft') return 'Draft';
  if (['pending_verification', 'qa_review', 'verification_pending'].includes(s)) return 'Pending Verification';
  if (['effectiveness_pending', 'effectiveness_completed', 'effectiveness check pending'].includes(s)) {
    return 'Effectiveness Check Pending';
  }
  if (['under_implementation', 'implemented', 'in_progress'].includes(s)) return 'Under Implementation';
  if (['submitted', 'open', 'assigned'].includes(s)) return 'Open';
  return 'Open';
}

export function isComplaintCapaLinkOverdue(link?: ComplaintCapaLink | null): boolean {
  if (!link) return false;
  if (link.capa_status === 'Closed') return false;
  if (link.capa_status === 'Overdue') return true;
  if (!link.target_completion_date) return false;
  return link.target_completion_date < new Date().toISOString().split('T')[0];
}

export function isComplaintCapaSatisfiedForClosure(capa?: CapaRecord | null, capaRequired?: boolean): boolean {
  if (!capaRequired) return true;
  if (!capa) return false;
  if ((capa.capa_status || '').toLowerCase() !== 'closed') return false;
  if (capa.effectiveness_check_required) {
    return ['Effective', 'N/A'].includes(capa.effectiveness_result);
  }
  return true;
}

export function canCloseComplaintWithCapa(
  record: ComplaintRecord,
  link?: ComplaintCapaLink | null,
  capa?: CapaRecord | null,
  impact?: ComplaintImpactAssessment | null,
): { canClose: boolean; reason?: string } {
  const mandatory = computeComplaintCapaMandatory(record, impact);
  if (!mandatory) return { canClose: true };
  if (!record.linked_capa_number && !link?.capa_number) {
    return { canClose: false, reason: 'Mandatory CAPA must be linked before complaint closure.' };
  }
  if (!isComplaintCapaSatisfiedForClosure(capa, true)) {
    return { canClose: false, reason: 'Mandatory CAPA must be closed with effectiveness completed before complaint closure.' };
  }
  const openStatuses = ['Draft', 'Open', 'Under Implementation', 'Pending Verification', 'Effectiveness Check Pending', 'Overdue'];
  if (link && openStatuses.includes(link.capa_status)) {
    return { canClose: false, reason: 'Mandatory CAPA is still open — close CAPA before complaint closure.' };
  }
  return { canClose: true };
}

export function capaLinkFromCapaRecord(
  complaintId: string,
  complaintNumber: string,
  capa: CapaRecord,
  capaRequired: boolean,
  actor: ComplaintCapaLinkActor,
  remarks = '',
  department = 'QA',
): Omit<ComplaintCapaLink, 'id'> {
  const ts = new Date().toISOString();
  const displayStatus = mapCapaRecordToComplaintDisplayStatus(capa.capa_status, capa.target_completion_date);
  return {
    complaint_capa_link_id: `CCL-${complaintNumber}-${capa.capa_number}`,
    complaint_id: complaintId,
    complaint_number: complaintNumber,
    capa_required: capaRequired,
    capa_number: capa.capa_number,
    capa_id: capa.id,
    capa_title: capa.capa_title,
    capa_source: capa.capa_source,
    root_cause: capa.root_cause,
    corrective_action: capa.corrective_action,
    preventive_action: capa.preventive_action,
    action_owner: capa.action_owner,
    action_owner_name: capa.action_owner_name,
    department: capa.department || department,
    target_completion_date: capa.target_completion_date,
    capa_status: displayStatus,
    implementation_date: capa.actual_completion_date || null,
    effectiveness_check_required: capa.effectiveness_check_required,
    effectiveness_check_date: capa.effectiveness_check_date,
    effectiveness_result: capa.effectiveness_result,
    capa_closure_date: capa.capa_status === 'closed' ? ts.split('T')[0] : null,
    remarks,
    linked_by: actor.id,
    linked_by_name: actor.name,
    linked_date: ts.split('T')[0],
    is_active: true,
    created_at: ts,
    updated_at: ts,
    created_by: actor.id,
    created_by_name: actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
}

export function canViewComplaintCapaLink(role?: string | null): boolean {
  const r = normalizeRole(role || '');
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive',
    'qc_manager', 'qc', 'production_manager', 'production',
    'warehouse', 'regulatory_affairs', 'auditor', 'viewer',
  ].includes(r);
}

export function canManageComplaintCapaLink(role?: string | null, record?: ComplaintRecord, actorId?: string): boolean {
  if (normalizeRole(role || '') === 'auditor') return false;
  const r = normalizeRole(role || '');
  if (['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive'].includes(r)) return true;
  if (record?.assigned_to && record.assigned_to === actorId) return true;
  return false;
}

export function canUnlinkComplaintCapaLink(role?: string | null): boolean {
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa'].includes(normalizeRole(role || ''));
}

export function canApproveCriticalComplaintCapaLink(role?: string | null, criticality?: string): boolean {
  if (criticality !== 'Critical') return canUnlinkComplaintCapaLink(role);
  return ['super_admin', 'head_qa'].includes(normalizeRole(role || ''));
}

export function canUpdateComplaintCapaActionStatus(role?: string | null, ownerId?: string, actorId?: string): boolean {
  const r = normalizeRole(role || '');
  if (['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa'].includes(r)) return true;
  return ownerId === actorId;
}

export function canReviewComplaintCapaLink(role?: string | null): boolean {
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa',
    'production_manager', 'qc_manager', 'warehouse_manager',
  ].includes(normalizeRole(role || ''));
}

export function computeComplaintCapaLinkAutoRules(
  record: ComplaintRecord,
  impact?: ComplaintImpactAssessment | null,
): { capaMandatory: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const capaMandatory = computeComplaintCapaMandatory(record, impact);
  if (impactYes(impact?.product_quality_impact) || impactYes(record.product_quality_impact)) {
    warnings.push('Product quality impact — CAPA is mandatory.');
  }
  if (impactYes(impact?.patient_safety_impact) || record.product_safety_impact) {
    warnings.push('Patient safety impact — CAPA is mandatory.');
  }
  if (record.complaint_criticality === 'Critical') warnings.push('Critical complaint — CAPA is mandatory.');
  if (record.is_repeat_complaint) warnings.push('Repeat complaint — CAPA is mandatory.');
  return { capaMandatory, warnings };
}

export function mapAuditToComplaintCapaTimeline(logs: Record<string, unknown>[]) {
  return logs
    .filter((l) => /capa/i.test(String(l.action || l.actionType || '')))
    .map((l) => ({
      date: String(l.dateTime || l.created_at || l.timestamp || ''),
      title: String(l.action || l.actionType || 'CAPA Event'),
      description: String(l.reason || l.actionDescription || l.newValue || '').slice(0, 200),
      user: String(l.userName || l.user_name || ''),
    }));
}
