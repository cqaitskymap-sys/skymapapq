import { normalizeRole } from '@/lib/permissions';
import { type CapaRecord } from '@/lib/capa-types';
import { localCalendarDate } from '@/lib/qms-record-guard';
import { computeCapaRequired, type DeviationCapaLink, type DeviationRecord } from '@/lib/deviation-types';

export type CapaLinkActor = { id: string; name: string; role?: string; email?: string };

export type CapaLinkFormInput = {
  capa_required: boolean;
  capa_number?: string;
  capa_title?: string;
  capa_source?: string;
  root_cause: string;
  corrective_action: string;
  preventive_action: string;
  responsible_person_name: string;
  target_completion_date: string;
  effectiveness_check_required: boolean;
  remarks?: string;
};

export function computeCapaMandatory(record: Partial<DeviationRecord>): boolean {
  return computeCapaRequired(record);
}

export function mapCapaRecordToDisplayStatus(capaStatus?: string, targetDate?: string | null): string {
  const s = (capaStatus || 'draft').toLowerCase();
  if (s === 'overdue') return 'Overdue';
  if (s === 'closed') return 'Closed';
  if (s !== 'rejected' && targetDate && targetDate < localCalendarDate()) return 'Overdue';
  if (s === 'approved') return 'Approved';
  if (s === 'draft') return 'Draft';
  if (['effectiveness_pending', 'effectiveness_completed'].includes(s)) return 'Effectiveness Pending';
  if (['under_implementation', 'implemented'].includes(s)) return 'Under Implementation';
  return 'Open';
}

export function isCapaLinkOverdue(link?: DeviationCapaLink | null): boolean {
  if (!link) return false;
  if (link.capa_status === 'Closed') return false;
  if (link.capa_status === 'Overdue') return true;
  if (!link.target_completion_date) return false;
  return link.target_completion_date < new Date().toISOString().split('T')[0];
}

export function isCapaSatisfiedForClosure(capa?: CapaRecord | null, capaRequired?: boolean): boolean {
  if (!capaRequired) return true;
  if (!capa) return false;
  if ((capa.capa_status || '').toLowerCase() !== 'closed') return false;
  if (capa.effectiveness_check_required) {
    return ['Effective', 'N/A'].includes(capa.effectiveness_result);
  }
  return true;
}

export function canCloseDeviationWithCapa(
  record: DeviationRecord,
  link?: DeviationCapaLink | null,
  capa?: CapaRecord | null,
): { canClose: boolean; reason?: string } {
  const mandatory = computeCapaMandatory(record);
  if (!mandatory) return { canClose: true };
  if (!record.linked_capa_number && !link?.capa_number) {
    return { canClose: false, reason: 'Mandatory CAPA must be linked before deviation closure.' };
  }
  if (!isCapaSatisfiedForClosure(capa, true)) {
    return { canClose: false, reason: 'Mandatory CAPA must be closed with effectiveness completed before deviation closure.' };
  }
  return { canClose: true };
}

export function capaLinkFromCapaRecord(
  deviationId: string,
  deviationNumber: string,
  capa: CapaRecord,
  capaRequired: boolean,
  actor: CapaLinkActor,
  remarks = '',
): Omit<DeviationCapaLink, 'id'> {
  const ts = new Date().toISOString();
  const displayStatus = mapCapaRecordToDisplayStatus(capa.capa_status, capa.target_completion_date);
  return {
    deviation_id: deviationId,
    deviation_number: deviationNumber,
    capa_required: capaRequired,
    capa_number: capa.capa_number,
    capa_id: capa.id,
    capa_title: capa.capa_title,
    capa_source: capa.capa_source,
    root_cause: capa.root_cause,
    corrective_action: capa.corrective_action,
    preventive_action: capa.preventive_action,
    responsible_person: capa.action_owner,
    responsible_person_name: capa.action_owner_name,
    target_completion_date: capa.target_completion_date,
    capa_status: displayStatus,
    effectiveness_check_required: capa.effectiveness_check_required,
    effectiveness_check_date: capa.effectiveness_check_date,
    effectiveness_result: capa.effectiveness_result,
    linked_by: actor.id,
    linked_by_name: actor.name,
    linked_date: ts.split('T')[0],
    remarks,
    is_active: true,
    created_at: ts,
    updated_at: ts,
    created_by: actor.id,
    created_by_name: actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
}

export function canViewCapaLink(role?: string | null): boolean {
  const r = normalizeRole(role);
  if (['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'auditor', 'viewer'].includes(r)) return true;
  return ['qc_manager', 'qc', 'production_manager', 'production', 'engineering_manager', 'engineering',
    'warehouse_manager', 'warehouse'].includes(r);
}

export function canManageCapaLink(role: string | null | undefined, record: DeviationRecord, actorId: string): boolean {
  if (normalizeRole(role) === 'auditor') return false;
  const r = normalizeRole(role);
  if (['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa'].includes(r)) return true;
  if (record.assigned_investigator === actorId) return true;
  return false;
}

export function canUnlinkCapaLink(role?: string | null): boolean {
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa'].includes(normalizeRole(role));
}

export function canApproveCriticalCapaLink(role?: string | null, criticality?: string): boolean {
  if (criticality !== 'Critical') return canUnlinkCapaLink(role);
  return ['super_admin', 'head_qa'].includes(normalizeRole(role));
}

export function canUpdateCapaActionStatus(role?: string | null, ownerId?: string, actorId?: string): boolean {
  const r = normalizeRole(role);
  if (['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa'].includes(r)) return true;
  return ownerId === actorId;
}

export function computeCapaLinkAutoRules(record: DeviationRecord): { capaMandatory: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const capaMandatory = computeCapaMandatory(record);
  if (record.product_quality_impacted || record.product_quality_impact === 'Yes') {
    warnings.push('Product quality impact — CAPA is mandatory.');
  }
  if (record.repeat_deviation) warnings.push('Repeat deviation — CAPA is mandatory.');
  if (record.criticality === 'Critical') warnings.push('Critical deviation — CAPA is mandatory.');
  return { capaMandatory, warnings };
}

export function mapAuditToCapaTimeline(logs: Record<string, unknown>[]) {
  return logs
    .filter((l) => {
      const action = String(l.action || l.actionType || '').toLowerCase();
      return action.includes('capa');
    })
    .map((l) => ({
      date: String(l.dateTime || l.created_at || ''),
      title: String(l.action || l.actionType || 'CAPA Event'),
      description: String(l.reason || l.actionDescription || l.newValue || '').slice(0, 200),
      user: String(l.userName || l.user_name || ''),
    }));
}
