import { z } from 'zod';
import { normalizeRole } from '@/lib/permissions';
import { computePhase2Required } from '@/lib/oos-approval-records';
import { getCurrentPendingOosApproval } from '@/lib/oos-approval-records';
import {
  canCloseOosWithCapa,
  computeOosCapaAutoRules,
  isCapaSatisfiedForOosClosure,
} from '@/lib/oos-capa-records';
import type { CapaRecord } from '@/lib/capa-types';
import type {
  OosApproval,
  OosAttachment,
  OosCapaLink,
  OosClosure,
  OosImpactAssessment,
  OosPhase1,
  OosPhase2,
  OosRecord,
} from '@/lib/oos-types';

export const OOS_CLOSURE_MODULE = 'OOS Closure';

export type OosClosureActor = { id: string; name: string; role?: string; email?: string };

export interface OosClosureChecklistItem {
  key: string;
  label: string;
  complete: boolean;
  required: boolean;
  warning?: string;
}

export interface OosClosureReadiness {
  items: OosClosureChecklistItem[];
  completeCount: number;
  totalRequired: number;
  percent: number;
  ready: boolean;
  blockers: string[];
}

export type OosClosureFormInput = {
  batch_impact_resolved: boolean;
  product_quality_impact_resolved: boolean;
  patient_safety_impact_resolved: boolean;
  regulatory_impact_resolved: boolean;
  market_impact_resolved: boolean;
  all_attachments_reviewed: boolean;
  qa_closure_comments: string;
  final_oos_conclusion: string;
};

export function phase1IsComplete(phase1: OosPhase1 | null): boolean {
  if (!phase1) return false;
  return phase1.status === 'Completed' || Boolean(phase1.phase1_conclusion?.trim() && phase1.phase1_outcome);
}

export function phase2IsComplete(phase2: OosPhase2 | null): boolean {
  if (!phase2) return false;
  return ['Completed', 'CAPA Required'].includes(phase2.status || '');
}

export function impactAssessmentIsComplete(impact: OosImpactAssessment | null): boolean {
  if (!impact) return false;
  return impact.status === 'Approved';
}

export function rootCauseDocumented(
  record: OosRecord,
  phase1: OosPhase1 | null,
  phase2: OosPhase2 | null,
  impact: OosImpactAssessment | null,
): boolean {
  return Boolean(
    phase1?.root_cause_identified?.trim()
    || phase2?.root_cause?.trim()
    || record.root_cause?.trim()
    || impact?.scientific_justification?.trim()
    || (phase1?.phase1_outcome === 'Laboratory Error' && phase1.phase1_conclusion?.trim()),
  );
}

export function approvalWorkflowComplete(approvals: OosApproval[]): boolean {
  return !getCurrentPendingOosApproval(approvals);
}

export function hasCriticalRiskOpen(record: OosRecord, impact: OosImpactAssessment | null): boolean {
  if (record.is_critical_test && record.status !== 'approved' && record.status !== 'closed') return true;
  if (impact?.risk_level === 'Critical' && impact.status !== 'Approved') return true;
  return false;
}

export function impactResolved(value?: string, formResolved?: boolean): boolean {
  if (formResolved) return true;
  if (!value) return true;
  return value === 'No' || value === 'Not Applicable' || value === 'Under Evaluation';
}

export function computeOosClosureReadiness(input: {
  record: OosRecord;
  phase1: OosPhase1 | null;
  phase2: OosPhase2 | null;
  impact: OosImpactAssessment | null;
  capa: CapaRecord | null;
  capaLink: OosCapaLink | null;
  approvals: OosApproval[];
  attachments: OosAttachment[];
  isRepeatOos?: boolean;
  form?: Partial<OosClosureFormInput>;
}): OosClosureReadiness {
  const { record, phase1, phase2, impact, capa, capaLink, approvals, attachments, form } = input;
  const phase2Required = computePhase2Required(phase1);
  const capaRules = computeOosCapaAutoRules(record, impact, phase2, input.isRepeatOos ?? false);
  const capaRequired = capaRules.capaMandatory || record.capa_required || Boolean(impact?.capa_required);
  const capaLinked = Boolean(record.linked_capa_number || capaLink?.capa_number);
  const capaOk = isCapaSatisfiedForOosClosure(capa, capaLink, capaRequired);
  const capaDecisionDone = record.capa_required !== undefined || impact?.capa_required !== undefined || phase2?.capa_required !== undefined;
  const effectivenessRequired = Boolean(capa?.effectiveness_check_required || capaLink?.effectiveness_check_required);
  const effectivenessOk = !effectivenessRequired
    || ['Effective', 'N/A'].includes(capaLink?.effectiveness_result || capa?.effectiveness_result || '');
  const qaApprovalDone = approvalWorkflowComplete(approvals) && record.status === 'approved';
  const attachmentsOk = attachments.length > 0 && form?.all_attachments_reviewed !== false;
  const noCriticalRisk = !hasCriticalRiskOpen(record, impact);
  const capaClosureCheck = canCloseOosWithCapa(record, capaLink, capa, capaRequired);

  const items: OosClosureChecklistItem[] = [
    { key: 'phase1', label: 'Phase-I investigation completed', complete: phase1IsComplete(phase1), required: true },
    {
      key: 'phase2',
      label: 'Phase-II completed if required',
      complete: !phase2Required || phase2IsComplete(phase2),
      required: phase2Required,
      warning: phase2Required ? 'Phase-II mandatory based on Phase-I outcome' : undefined,
    },
    { key: 'impact', label: 'Impact assessment completed', complete: impactAssessmentIsComplete(impact), required: true },
    { key: 'root_cause', label: 'Root cause documented or scientifically justified', complete: rootCauseDocumented(record, phase1, phase2, impact), required: true },
    { key: 'capa_decision', label: 'CAPA decision completed', complete: capaDecisionDone, required: true },
    { key: 'capa_linked', label: 'Mandatory CAPA linked', complete: !capaRequired || capaLinked, required: capaRequired },
    { key: 'capa_implemented', label: 'CAPA implemented if required', complete: !capaRequired || capaOk, required: capaRequired, warning: capaClosureCheck.reason },
    { key: 'effectiveness', label: 'Effectiveness check completed if required', complete: effectivenessOk, required: Boolean(capa?.effectiveness_check_required || capaLink?.effectiveness_check_required) },
    { key: 'qa_approval', label: 'QA approval completed', complete: qaApprovalDone, required: true },
    { key: 'attachments', label: 'All attachments reviewed', complete: attachmentsOk, required: true },
    { key: 'critical_risk', label: 'No open critical risk', complete: noCriticalRisk, required: true },
    { key: 'pending_approval', label: 'No pending approval', complete: approvalWorkflowComplete(approvals), required: true },
  ];

  const required = items.filter((i) => i.required);
  const completeCount = required.filter((i) => i.complete).length;
  const blockers = required.filter((i) => !i.complete).map((i) => i.label);
  const percent = required.length ? Math.round((completeCount / required.length) * 100) : 0;

  return {
    items,
    completeCount,
    totalRequired: required.length,
    percent,
    ready: blockers.length === 0 && capaClosureCheck.canClose,
    blockers: capaClosureCheck.canClose ? blockers : [...blockers, capaClosureCheck.reason || 'CAPA closure requirements not met'],
  };
}

export function mapReadinessToOosClosureFields(
  readiness: OosClosureReadiness,
  record: OosRecord,
  phase1: OosPhase1 | null,
  form: OosClosureFormInput,
): Omit<OosClosure, 'id' | 'created_at' | 'updated_at'> {
  const get = (key: string) => readiness.items.find((i) => i.key === key)?.complete ?? false;
  const phase2Required = computePhase2Required(phase1);
  return {
    closure_id: '',
    oos_id: record.id,
    oos_number: record.oos_number,
    closure_date: null,
    closed_by: '',
    department: record.department,
    phase1_completed: get('phase1'),
    phase2_required: phase2Required,
    phase2_completed: get('phase2'),
    impact_assessment_completed: get('impact'),
    root_cause_identified: get('root_cause'),
    capa_required: record.capa_required,
    capa_linked: get('capa_linked'),
    capa_completed: get('capa_implemented'),
    effectiveness_check_completed: get('effectiveness'),
    batch_impact_resolved: form.batch_impact_resolved,
    product_quality_impact_resolved: form.product_quality_impact_resolved,
    patient_safety_impact_resolved: form.patient_safety_impact_resolved,
    regulatory_impact_resolved: form.regulatory_impact_resolved,
    market_impact_resolved: form.market_impact_resolved,
    all_attachments_reviewed: form.all_attachments_reviewed,
    final_oos_conclusion: form.final_oos_conclusion,
    qa_closure_comments: form.qa_closure_comments,
    closure_status: readiness.ready ? 'Ready For Closure' : 'Pending',
    e_signature_required: true,
    signed_by: '',
    signed_date: null,
    readiness_percent: readiness.percent,
    created_by: '',
    updated_by: '',
    is_deleted: false,
  };
}

export function canViewOosClosure(role?: string | null): boolean {
  const r = normalizeRole(role);
  if (['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'auditor', 'viewer'].includes(r)) return true;
  return ['qc_manager', 'qc', 'production_manager', 'production'].includes(r);
}

export function canReviewOosClosure(role?: string | null): boolean {
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa'].includes(normalizeRole(role));
}

export function canCloseOosClosureRecord(role?: string | null, record?: OosRecord | null): boolean {
  const r = normalizeRole(role);
  if (['super_admin', 'admin'].includes(r)) return true;
  const critical = record?.is_critical_test || /sterility|endotoxin/i.test(record?.test_name || '');
  if (critical) return r === 'head_qa';
  return ['head_qa', 'qa_manager', 'qa'].includes(r);
}

export function canReopenOosClosure(role?: string | null): boolean {
  return ['super_admin', 'head_qa'].includes(normalizeRole(role));
}

export function oosClosureStatusColor(status: string): string {
  const map: Record<string, string> = {
    Pending: 'bg-slate-100 text-slate-700 border-slate-200',
    'Ready For Closure': 'bg-blue-100 text-blue-800 border-blue-200',
    'QA Review': 'bg-purple-100 text-purple-800 border-purple-200',
    Closed: 'bg-green-100 text-green-800 border-green-200',
    Rejected: 'bg-red-100 text-red-800 border-red-200',
    Reopened: 'bg-amber-100 text-amber-800 border-amber-200',
  };
  return map[status] || map.Pending;
}

export function mapOosClosureHistory(auditLogs: Record<string, unknown>[]) {
  return auditLogs
    .filter((l) => /closure|close|reopen|e-sign|batch release/i.test(String(l.action || l.actionType || '')))
    .map((l) => ({
      date: String(l.dateTime || l.created_at || ''),
      title: String(l.action || l.actionType || 'Event'),
      description: String(l.reason || l.actionDescription || ''),
      user: String(l.userName || l.user_name || ''),
    }));
}

export const oosClosureDraftSchema = z.object({
  batch_impact_resolved: z.boolean(),
  product_quality_impact_resolved: z.boolean(),
  patient_safety_impact_resolved: z.boolean(),
  regulatory_impact_resolved: z.boolean(),
  market_impact_resolved: z.boolean(),
  all_attachments_reviewed: z.boolean(),
  qa_closure_comments: z.string().optional().default(''),
  final_oos_conclusion: z.string().optional().default(''),
});

export const oosClosureFormSchema = oosClosureDraftSchema.extend({
  qa_closure_comments: z.string().min(1, 'QA closure comments are required'),
  final_oos_conclusion: z.string().min(10, 'Final OOS conclusion is required'),
});

export type OosClosureDraftInput = z.infer<typeof oosClosureDraftSchema>;
export type OosClosureFormValidated = z.infer<typeof oosClosureFormSchema>;
