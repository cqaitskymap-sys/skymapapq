import { normalizeRole } from '@/lib/permissions';
import { type CapaRecord } from '@/lib/capa-types';
import { localCalendarDate } from '@/lib/qms-record-guard';
import {
  isCriticalOosTest,
  type OosImpactAssessment,
  type OosCapaLink,
  type OosPhase2,
  type OosRecord,
} from '@/lib/oos-types';

export type OosCapaActor = { id: string; name: string; role?: string; email?: string };

export type OosCapaFormInput = {
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

export type OosCapaImplementationInput = {
  capa_status: string;
  implementation_date?: string;
  corrective_action?: string;
  preventive_action?: string;
  remarks?: string;
};

export type OosCapaEffectivenessInput = {
  effectiveness_result: string;
  effectiveness_check_date: string;
  remarks?: string;
};

export type OosCapaCloseInput = {
  effectiveness_result?: string;
  capa_closure_date?: string;
  remarks?: string;
};

export interface OosCapaAutoRules {
  capaMandatory: boolean;
  isRepeatOos: boolean;
  warnings: string[];
}

export interface OosCapaTimelineEntry {
  date: string;
  title: string;
  description: string;
  user?: string;
}

const today = () => localCalendarDate();

export function impactYes(value?: string): boolean {
  return value === 'Yes' || Boolean(value?.toLowerCase().includes('yes'));
}

export function mapCapaRecordToOosDisplayStatus(capaStatus?: string, targetDate?: string | null): string {
  const s = (capaStatus || 'draft').toLowerCase();
  if (s === 'overdue') return 'Overdue';
  if (s === 'closed') return 'Closed';
  if (s !== 'rejected' && targetDate && targetDate < today()) return 'Overdue';
  if (s === 'approved') return 'Approved';
  if (s === 'draft') return 'Draft';
  if (['effectiveness_pending', 'effectiveness_completed'].includes(s)) return 'Effectiveness Check Pending';
  if (s === 'implemented' || s === 'qa_review') return 'Pending Verification';
  if (['under_implementation', 'assigned'].includes(s)) return 'Under Implementation';
  return 'Open';
}

export function isOosCapaLinkOverdue(link?: OosCapaLink | null): boolean {
  if (!link) return false;
  if (link.capa_status === 'Closed') return false;
  if (link.capa_status === 'Overdue') return true;
  const target = link.target_completion_date || link.target_date;
  if (!target) return false;
  return target < today();
}

export function computeOosCapaProgress(status?: string): number {
  const map: Record<string, number> = {
    Draft: 10,
    Open: 25,
    'Under Implementation': 50,
    'Pending Verification': 70,
    'Effectiveness Check Pending': 85,
    Closed: 100,
    Overdue: 40,
  };
  return map[status || 'Draft'] ?? 15;
}

export function computeOosCapaMandatory(
  record: OosRecord,
  impact?: OosImpactAssessment | null,
  phase2?: OosPhase2 | null,
  isRepeatOos = false,
): boolean {
  if (record.capa_required) return true;
  if (impactYes(impact?.product_quality_impact) || impactYes(impact?.product_impact)) return true;
  if (impactYes(impact?.patient_safety_impact)) return true;
  if (impactYes(impact?.regulatory_impact)) return true;
  const outcome = phase2?.phase2_outcome || '';
  if (/Manufacturing Root Cause Identified|Material Root Cause Identified|Equipment Root Cause Identified|Process Root Cause Identified/.test(outcome)) {
    return true;
  }
  if (isRepeatOos) return true;
  if (isCriticalOosTest(record.test_name) && record.result_status === 'OOS') return true;
  return false;
}

export function computeOosCapaAutoRules(
  record: OosRecord,
  impact?: OosImpactAssessment | null,
  phase2?: OosPhase2 | null,
  isRepeatOos = false,
): OosCapaAutoRules {
  const warnings: string[] = [];
  const capaMandatory = computeOosCapaMandatory(record, impact, phase2, isRepeatOos);

  if (impactYes(impact?.product_quality_impact) || impactYes(impact?.product_impact)) {
    warnings.push('Product quality impact — CAPA is mandatory.');
  }
  if (impactYes(impact?.patient_safety_impact)) warnings.push('Patient safety impact — CAPA is mandatory.');
  if (impactYes(impact?.regulatory_impact)) warnings.push('Regulatory impact — CAPA is mandatory.');
  if (phase2?.phase2_outcome === 'Manufacturing Root Cause Identified') {
    warnings.push('Manufacturing root cause identified — CAPA is mandatory.');
  }
  if (isRepeatOos) warnings.push('Repeat OOS detected — CAPA is mandatory.');
  if (capaMandatory) warnings.push('OOS cannot be closed while mandatory CAPA remains open.');

  return { capaMandatory, isRepeatOos, warnings };
}

export function isCapaSatisfiedForOosClosure(capa?: CapaRecord | null, link?: OosCapaLink | null, capaRequired?: boolean): boolean {
  if (!capaRequired) return true;
  if (!capa && !link?.capa_number) return false;
  const status = (link?.capa_status || mapCapaRecordToOosDisplayStatus(capa?.capa_status, capa?.target_completion_date)).toLowerCase();
  if (status !== 'closed') return false;
  const effRequired = link?.effectiveness_check_required ?? capa?.effectiveness_check_required;
  if (effRequired) {
    const result = link?.effectiveness_result || capa?.effectiveness_result || '';
    return ['Effective', 'N/A'].includes(result);
  }
  return true;
}

export function canCloseOosWithCapa(
  record: OosRecord,
  link?: OosCapaLink | null,
  capa?: CapaRecord | null,
  capaMandatory?: boolean,
): { canClose: boolean; reason?: string } {
  const mandatory = capaMandatory ?? record.capa_required;
  if (!mandatory) return { canClose: true };
  if (!record.linked_capa_number && !link?.capa_number) {
    return { canClose: false, reason: 'Mandatory CAPA must be linked before OOS closure.' };
  }
  if (!isCapaSatisfiedForOosClosure(capa, link, true)) {
    return { canClose: false, reason: 'Mandatory CAPA must be closed with effectiveness verified before OOS closure.' };
  }
  return { canClose: true };
}

export function capaLinkFromCapaRecord(
  oosId: string,
  record: OosRecord,
  capa: CapaRecord,
  capaRequired: boolean,
  actor: OosCapaActor,
  remarks = '',
): Omit<OosCapaLink, 'id'> {
  const ts = new Date().toISOString();
  const displayStatus = mapCapaRecordToOosDisplayStatus(capa.capa_status, capa.target_completion_date);
  return {
    oos_capa_link_id: `OCL-${record.oos_number}`,
    oos_id: oosId,
    oos_number: record.oos_number,
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
    department: capa.department,
    target_completion_date: capa.target_completion_date,
    target_date: capa.target_completion_date,
    capa_status: displayStatus,
    implementation_date: capa.actual_completion_date,
    effectiveness_check_required: capa.effectiveness_check_required,
    effectiveness_check_date: capa.effectiveness_check_date,
    effectiveness_check: capa.effectiveness_criteria || '',
    effectiveness_result: capa.effectiveness_result,
    remarks,
    is_active: true,
    linked_by: actor.id,
    linked_by_name: actor.name,
    linked_at: ts,
    linked_date: ts.split('T')[0],
    created_by: actor.id,
    created_by_name: actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
    created_at: ts,
    updated_at: ts,
  };
}

export function computeOosCapaDashboardMetrics(links: OosCapaLink[]): import('@/lib/oos-types').OosCapaDashboardMetrics {
  const active = links.filter((l) => l.is_active !== false);
  return {
    totalLinked: active.length,
    openCapa: active.filter((l) => !['Closed', 'Overdue'].includes(l.capa_status) && l.capa_status !== 'Draft').length,
    closedCapa: active.filter((l) => l.capa_status === 'Closed').length,
    overdueCapa: active.filter((l) => isOosCapaLinkOverdue(l)).length,
    effectivenessPending: active.filter((l) => l.capa_status === 'Effectiveness Check Pending').length,
    effectiveCapa: active.filter((l) => l.effectiveness_result === 'Effective').length,
    notEffectiveCapa: active.filter((l) => l.effectiveness_result === 'Not Effective').length,
    repeatOosCapa: active.filter((l) => l.remarks?.includes('repeat OOS')).length,
  };
}

export function mapAuditToOosCapaTimeline(logs: Record<string, unknown>[]): OosCapaTimelineEntry[] {
  const titles = [
    'CAPA Created', 'CAPA Linked', 'CAPA Updated', 'CAPA implementation started',
    'CAPA implementation completed', 'Effectiveness recorded', 'CAPA closed', 'CAPA reopened',
  ];
  return logs
    .filter((l) => /capa/i.test(String(l.action || l.actionType || '')))
    .map((l) => {
      const action = String(l.action || l.actionType || 'CAPA Event');
      const matched = titles.find((t) => action.toLowerCase().includes(t.toLowerCase().replace('capa ', '')));
      return {
        date: String(l.dateTime || l.timestamp || l.created_at || ''),
        title: matched || action,
        description: String(l.actionDescription || l.reason || '').slice(0, 200),
        user: String(l.userName || l.user_name || ''),
      };
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export function canViewOosCapa(role?: string | null): boolean {
  const r = normalizeRole(role);
  if (['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'auditor', 'viewer'].includes(r)) return true;
  return ['qc_manager', 'qc', 'production_manager', 'production'].includes(r);
}

export function canManageOosCapa(role?: string | null, ownerId?: string, actorId?: string): boolean {
  if (normalizeRole(role) === 'auditor' || normalizeRole(role) === 'viewer') return false;
  const r = normalizeRole(role);
  if (['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa'].includes(r)) return true;
  if (ownerId && ownerId === actorId) return true;
  return false;
}

export function canUpdateOosCapaActions(role?: string | null, ownerId?: string, actorId?: string): boolean {
  if (canManageOosCapa(role, ownerId, actorId)) return true;
  return ownerId === actorId;
}

export function canApproveCriticalOosCapa(role?: string | null, record?: OosRecord | null): boolean {
  if (!record || !isCriticalOosTest(record.test_name)) return canManageOosCapa(role);
  return ['super_admin', 'head_qa'].includes(normalizeRole(role));
}

export function canCloseOosCapa(role?: string | null): boolean {
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa'].includes(normalizeRole(role));
}

export function mapOosCapaFormDefaults(
  record: OosRecord,
  link?: OosCapaLink | null,
  capa?: CapaRecord | null,
  phase2?: OosPhase2 | null,
): OosCapaFormInput {
  return {
    capa_required: record.capa_required,
    capa_title: link?.capa_title || capa?.capa_title || `CAPA for ${record.oos_number}`,
    capa_source: 'OOS',
    root_cause: link?.root_cause || capa?.root_cause || phase2?.root_cause || record.root_cause || '',
    corrective_action: link?.corrective_action || capa?.corrective_action || phase2?.corrective_action || '',
    preventive_action: link?.preventive_action || capa?.preventive_action || phase2?.preventive_action || '',
    action_owner_name: link?.action_owner_name || capa?.action_owner_name || record.assigned_to_name || '',
    department: link?.department || record.department,
    target_completion_date: link?.target_completion_date || link?.target_date || capa?.target_completion_date || record.target_closure_date || '',
    effectiveness_check_required: link?.effectiveness_check_required ?? capa?.effectiveness_check_required ?? true,
    remarks: link?.remarks || '',
  };
}
