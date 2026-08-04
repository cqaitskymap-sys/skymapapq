import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFirestore, getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';
import { getRecord, getRecords } from '@/lib/firestore';
import { listCpvRecords } from '@/lib/cpv-service';
import { CPV_COLLECTIONS, CppRecord, CqaRecord } from '@/lib/cpv';
import { fetchStabilityResults } from '@/lib/cpv-stability-monitoring-service';
import { fetchHoldTimeRecords } from '@/lib/cpv-hold-time-monitoring-service';
import { fetchProcessCapabilityRecords } from '@/lib/cpv-process-capability-service';
import { fetchTrendAnalysisRecords } from '@/lib/cpv-trend-analysis-service';
import { fetchSpcRecords } from '@/lib/cpv-spc-service';
import { fetchRawMaterialRecords } from '@/lib/cpv-raw-material-monitoring-service';
import { fetchPackingMaterialRecords } from '@/lib/cpv-packing-material-monitoring-service';
import { fetchUtilityRecords } from '@/lib/cpv-utility-monitoring-service';
import { fetchEnvironmentalRecords } from '@/lib/cpv-environmental-monitoring-service';
import { fetchYieldRecords } from '@/lib/cpv-yield-monitoring-service';
import { fetchRiskAssessmentRecords } from '@/lib/cpv-risk-assessment-service';
import { fetchCpvReviewRecords } from '@/lib/cpv-annual-review-service';
import {
  ALERTS_COLLECTION,
  ALERTS_LEGACY,
  ALERT_RULES_COLLECTION,
  buildDefaultAlertRules,
  buildAlertId,
  computeAlertIntelligence,
  emptyAlertAiIntelligence,
  inferAlertCategory,
  inferAlertFromRecord,
  mapLegacyPriority,
  mapLegacySeverity,
  type AlertSource,
  type AlertTimelineEntry,
  type AlertType,
  type CpvAlertFormData,
  type CpvAlertRecord,
  type CpvAlertRuleFormData,
  type CpvAlertRuleRecord,
  type DeliveryChannel,
} from '@/lib/cpv-alert-records';
import { enrichAiClient } from '@/lib/ai/client';

export type CpvAlertActor = { id: string; name: string; role?: string };

function callableErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = String((e as { message?: string }).message || '');
    if (msg) return msg.replace(/^Firebase:\s*/i, '').replace(/\s*\([^)]*\)\.?$/, '').trim() || fallback;
  }
  return fallback;
}

function resolveChangeReason(primary?: string | null, fallback?: string | null, defaultReason?: string): string | null {
  const candidate = (primary || fallback || defaultReason || '').trim();
  return candidate.length >= 5 ? candidate : null;
}

function str(v: unknown, fb = ''): string {
  if (v === null || v === undefined) return fb;
  return String(v);
}

function num(v: unknown, fb = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function val(v: unknown, fb: string | number = ''): string | number {
  if (v === null || v === undefined) return fb;
  if (typeof v === 'number' || typeof v === 'string') return v;
  return String(v);
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function asChannels(raw: unknown): DeliveryChannel[] {
  if (!Array.isArray(raw)) return ['In-App', 'Toast'];
  return raw.map((c) => String(c) as DeliveryChannel).filter(Boolean);
}


export function normalizeAlertRecord(raw: Record<string, unknown>): CpvAlertRecord {
  const legacyModule = str(raw.module || raw.moduleName || raw.module_name, 'Manual Alert');
  const legacySeverity = str(raw.severity || raw.alertSeverity, 'Medium');
  const legacyStatus = str(raw.status || raw.alertStatus, 'Open');
  const statusMap: Record<string, CpvAlertRecord['alertStatus']> = {
    Open: 'Open', Acknowledged: 'Acknowledged', Closed: 'Closed',
  };
  const alertType = str(raw.alertType || raw.alert_type, 'Alert Limit Crossed') as CpvAlertRecord['alertType'];
  const alertPriority = str(raw.alertPriority || raw.alert_priority, mapLegacyPriority(legacySeverity)) as CpvAlertRecord['alertPriority'];
  const alertSource = str(raw.alertSource || raw.alert_source, legacyModule) as AlertSource;
  const aiRaw = (raw.aiIntelligence && typeof raw.aiIntelligence === 'object')
    ? raw.aiIntelligence as Record<string, unknown>
    : null;

  return {
    id: str(raw.id),
    alertId: str(raw.alertId || raw.alert_id, buildAlertId()),
    alertNumber: str(raw.alertNumber || raw.alert_number, `ALT/DRAFT/${Date.now()}`),
    alertTitle: str(raw.alertTitle || raw.alert_title || raw.message, 'CPV Alert'),
    alertSource,
    moduleName: str(raw.moduleName || raw.module_name || raw.module, legacyModule),
    productName: str(raw.productName || raw.product_name),
    productCode: str(raw.productCode || raw.product_code),
    batchNumber: str(raw.batchNumber || raw.batch_number || raw.batchNo),
    parameterName: str(raw.parameterName || raw.parameter_name),
    observedValue: val(raw.observedValue ?? raw.observed_value),
    limitValue: val(raw.limit ?? raw.limitValue ?? raw.limit_value),
    alertType,
    alertCategory: (str(raw.alertCategory, inferAlertCategory(alertSource, alertType, alertPriority)) as CpvAlertRecord['alertCategory']),
    alertPriority,
    alertSeverity: str(raw.alertSeverity || raw.alert_severity, mapLegacySeverity(legacySeverity)) as CpvAlertRecord['alertSeverity'],
    alertStatus: statusMap[legacyStatus] || str(raw.alertStatus, 'Open') as CpvAlertRecord['alertStatus'],
    riskLevel: str(raw.riskLevel || raw.risk_level, mapLegacyPriority(legacySeverity) === 'Emergency' ? 'Critical' : mapLegacyPriority(legacySeverity)) as CpvAlertRecord['riskLevel'],
    alertMessage: str(raw.alertMessage || raw.alert_message || raw.message),
    detectedDateTime: str(raw.detectedDateTime || raw.detected_date_time || raw.createdAt),
    assignedTo: str(raw.assignedTo || raw.assigned_to),
    assignedRole: str(raw.assignedRole || raw.assigned_role, 'qa'),
    dueDate: str(raw.dueDate || raw.due_date),
    slaHours: num(raw.slaHours, 24),
    escalatedAt: str(raw.escalatedAt),
    escalationLevel: num(raw.escalationLevel ?? raw.escalateLevel),
    acknowledgedBy: str(raw.acknowledgedBy || raw.acknowledged_by),
    acknowledgedDateTime: str(raw.acknowledgedDateTime || raw.acknowledged_date_time),
    closedBy: str(raw.closedBy || raw.closed_by),
    closedDateTime: str(raw.closedDateTime || raw.closed_date_time),
    closureRemarks: str(raw.closureRemarks || raw.closure_remarks),
    linkedDeviationNumber: str(raw.linkedDeviationNumber || raw.linked_deviation_number),
    linkedOosNumber: str(raw.linkedOosNumber || raw.linked_oos_number),
    linkedCapaNumber: str(raw.linkedCapaNumber || raw.linked_capa_number),
    linkedRiskNumber: str(raw.linkedRiskNumber || raw.linked_risk_number),
    sourceRecordId: str(raw.sourceRecordId || raw.source_record_id || raw.recordId),
    deliveryChannels: asChannels(raw.deliveryChannels),
    aiIntelligence: aiRaw ? {
      ...emptyAlertAiIntelligence(),
      aiConfidenceScore: num(aiRaw.aiConfidenceScore),
      aiRootCauseSuggestion: str(aiRaw.aiRootCauseSuggestion),
      aiRecommendedActions: str(aiRaw.aiRecommendedActions),
      aiClusterId: str(aiRaw.aiClusterId),
      isPredictive: Boolean(aiRaw.isPredictive),
      duplicateSuppressed: Boolean(aiRaw.duplicateSuppressed),
      noiseReductionApplied: Boolean(aiRaw.noiseReductionApplied),
      correlatedAlertIds: Array.isArray(aiRaw.correlatedAlertIds) ? aiRaw.correlatedAlertIds.map(String) : [],
      failurePrediction: str(aiRaw.failurePrediction),
      riskPrediction: str(aiRaw.riskPrediction),
    } : emptyAlertAiIntelligence(),
    changeReason: str(raw.changeReason),
    electronicSignature: Boolean(raw.electronicSignature),
    timeline: Array.isArray(raw.timeline) ? raw.timeline as AlertTimelineEntry[] : [],
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
    createdBy: str(raw.createdBy),
    updatedBy: str(raw.updatedBy),
    createdByName: str(raw.createdByName || raw.createdBy),
    updatedByName: str(raw.updatedByName || raw.updatedBy),
    isDeleted: Boolean(raw.isDeleted),
  };
}

function duplicateKey(moduleName: string, recordId: string, alertType: string) {
  return `${moduleName}|${recordId}|${alertType}`;
}

export async function fetchCpvAlerts(max = 500): Promise<CpvAlertRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const map = new Map<string, CpvAlertRecord>();
    const load = async (collectionName: string) => {
      try {
        const rows = await getRecords<Record<string, unknown>>(collectionName, [orderBy('createdAt', 'desc'), limit(max)]);
        rows.forEach((r) => {
          const n = normalizeAlertRecord({ ...r, id: r.id });
          if (!n.isDeleted) map.set(n.id || duplicateKey(n.moduleName, n.sourceRecordId, n.alertType), n);
        });
      } catch {
        const rows = await getRecords<Record<string, unknown>>(collectionName, [limit(max)]);
        rows.forEach((r) => {
          const n = normalizeAlertRecord({ ...r, id: r.id });
          if (!n.isDeleted) map.set(n.id || duplicateKey(n.moduleName, n.sourceRecordId, n.alertType), n);
        });
      }
    };
    await load(ALERTS_COLLECTION);
    for (const legacy of ALERTS_LEGACY) await load(legacy);
    return Array.from(map.values()).sort((a, b) =>
      String(b.detectedDateTime || b.createdAt).localeCompare(String(a.detectedDateTime || a.createdAt)),
    );
  } catch (e) {
    console.error('fetchCpvAlerts failed', e);
    return [];
  }
}

export async function fetchCpvAlertById(id: string): Promise<CpvAlertRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const record = await getRecord<Record<string, unknown>>(ALERTS_COLLECTION, id);
    if (record) return normalizeAlertRecord(record);
    for (const legacy of ALERTS_LEGACY) {
      const legacyRecord = await getRecord<Record<string, unknown>>(legacy, id);
      if (legacyRecord) return normalizeAlertRecord(legacyRecord);
    }
    return null;
  } catch (e) {
    console.error('fetchCpvAlertById failed', e);
    return null;
  }
}

export async function fetchAlertRules(): Promise<CpvAlertRuleRecord[]> {
  if (!isFirebaseConfigured()) return buildDefaultAlertRules();
  try {
    const rows = await getRecords<CpvAlertRuleRecord>(ALERT_RULES_COLLECTION, [limit(100)]);
    if (rows.length) return rows.map((r) => ({ ...r, id: r.id || r.ruleId }));
    return buildDefaultAlertRules();
  } catch (e) {
    console.error('fetchAlertRules failed', e);
    return [];
  }
}

export async function fetchAlertAuditTrail(alertId: string) {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), 'audit_trail'), where('documentId', '==', alertId), limit(50)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), 'audit_trail'), limit(100)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((r: Record<string, unknown>) => String(r.documentId || r.recordId) === alertId);
    } catch (e) {
      console.error('fetchAlertAuditTrail failed', e);
      return [];
    }
  }
}

async function isDuplicateAlert(
  moduleName: string,
  sourceRecordId: string,
  alertType: string,
  suppressionHours: number,
  existing: CpvAlertRecord[],
): Promise<boolean> {
  const key = duplicateKey(moduleName, sourceRecordId, alertType);
  const match = existing.find((a) =>
    duplicateKey(a.moduleName, a.sourceRecordId, a.alertType) === key
    && !['Closed', 'Rejected'].includes(a.alertStatus),
  );
  if (!match) return false;
  if (!suppressionHours) return true;
  const created = new Date(match.detectedDateTime || match.createdAt);
  const hours = (Date.now() - created.getTime()) / (1000 * 60 * 60);
  return hours < suppressionHours;
}

export async function createCpvAlert(
  form: CpvAlertFormData,
  _actor: CpvAlertActor,
  _existingCount = 0,
  options?: { sourceRecordId?: string; autoCreated?: boolean; changeReason?: string },
): Promise<{ result: CpvAlertRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  const changeReason = resolveChangeReason(
    form.changeReason || options?.changeReason,
    null,
    options?.autoCreated ? 'Auto-generated from CPV source scan' : 'Manual CPV alert created',
  );
  if (!changeReason) return { result: null, error: 'Change reason must be at least 5 characters.' };
  try {
    const baseIntelligence = computeAlertIntelligence({
      alertType: form.alertType,
      alertPriority: form.alertPriority,
      alertSource: form.alertSource,
      observedValue: form.observedValue,
      limitValue: form.limitValue,
      productName: form.productName,
      parameterName: form.parameterName,
    });
    let aiIntelligence = baseIntelligence;
    try {
      const enriched = await enrichAiClient({
        task: 'alert_intelligence',
        context: {
          alertType: form.alertType,
          alertPriority: form.alertPriority,
          alertSource: form.alertSource,
          observedValue: form.observedValue,
          limitValue: form.limitValue,
          productName: form.productName,
          parameterName: form.parameterName,
        },
        fallback: { ...baseIntelligence },
      });
      aiIntelligence = {
        ...baseIntelligence,
        aiRootCauseSuggestion: String(
          enriched.data.aiRootCauseSuggestion || baseIntelligence.aiRootCauseSuggestion,
        ),
        aiRecommendedActions: String(
          enriched.data.aiRecommendedActions || baseIntelligence.aiRecommendedActions,
        ),
        failurePrediction: String(enriched.data.failurePrediction || baseIntelligence.failurePrediction),
        riskPrediction: String(enriched.data.riskPrediction || baseIntelligence.riskPrediction),
      };
    } catch {
      aiIntelligence = baseIntelligence;
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'createAdminCpvAlert',
    );
    const result = await fn({
      ...form,
      moduleName: form.moduleName || form.alertSource,
      alertCategory: form.alertCategory || inferAlertCategory(form.alertSource, form.alertType, form.alertPriority),
      deliveryChannels: form.deliveryChannels || ['In-App', 'Toast'],
      changeReason,
      sourceRecordId: options?.sourceRecordId || '',
      autoCreated: options?.autoCreated === true,
      aiIntelligence,
    });
    return { result: normalizeAlertRecord(result.data), error: null };
  } catch (e) {
    console.error('createCpvAlert failed', e);
    return { result: null, error: callableErrorMessage(e, 'Failed to create alert.') };
  }
}

export async function acknowledgeCpvAlert(
  id: string,
  _actor: CpvAlertActor,
  existing: CpvAlertRecord,
  changeReason = 'Alert acknowledged by responsible user',
) {
  try {
    const reason = resolveChangeReason(changeReason, existing.changeReason, 'Alert acknowledged by responsible user');
    if (!reason) return { error: 'Change reason must be at least 5 characters.' };
    const fn = httpsCallable(getFirebaseFunctions(), 'acknowledgeAdminCpvAlert');
    await fn({ id, changeReason: reason, alertSource: existing.alertSource });
    return { error: null };
  } catch (e) {
    console.error('acknowledgeCpvAlert failed', e);
    return { error: callableErrorMessage(e, 'Acknowledge failed.') };
  }
}

export async function assignCpvAlert(
  id: string,
  assignedTo: string,
  assignedRole: string,
  _actor: CpvAlertActor,
  existing: CpvAlertRecord,
  changeReason = 'Alert assignment updated',
) {
  try {
    const reason = resolveChangeReason(changeReason, existing.changeReason, 'Alert assignment updated');
    if (!reason) return { error: 'Change reason must be at least 5 characters.' };
    const fn = httpsCallable(getFirebaseFunctions(), 'assignAdminCpvAlert');
    await fn({ id, assignedTo, assignedRole, changeReason: reason });
    return { error: null };
  } catch (e) {
    console.error('assignCpvAlert failed', e);
    return { error: callableErrorMessage(e, 'Assign failed.') };
  }
}

export async function linkCpvAlert(
  id: string,
  linkType: 'linkedDeviationNumber' | 'linkedOosNumber' | 'linkedCapaNumber' | 'linkedRiskNumber',
  linkValue: string,
  _actor: CpvAlertActor,
  existing: CpvAlertRecord,
  changeReason = 'Alert linked to QMS record',
) {
  try {
    const reason = resolveChangeReason(changeReason, existing.changeReason, 'Alert linked to QMS record');
    if (!reason) return { error: 'Change reason must be at least 5 characters.' };
    const fn = httpsCallable(getFirebaseFunctions(), 'linkAdminCpvAlert');
    await fn({ id, linkType, linkValue, changeReason: reason });
    return { error: null };
  } catch (e) {
    console.error('linkCpvAlert failed', e);
    return { error: callableErrorMessage(e, 'Link failed.') };
  }
}

export async function investigateCpvAlert(
  id: string,
  existing: CpvAlertRecord,
  changeReason = 'Alert moved under investigation',
) {
  try {
    const reason = resolveChangeReason(changeReason, existing.changeReason, 'Alert moved under investigation');
    if (!reason) return { error: 'Change reason must be at least 5 characters.' };
    const fn = httpsCallable(getFirebaseFunctions(), 'investigateAdminCpvAlert');
    await fn({ id, changeReason: reason });
    return { error: null };
  } catch (e) {
    console.error('investigateCpvAlert failed', e);
    return { error: callableErrorMessage(e, 'Investigation update failed.') };
  }
}

export async function closeCpvAlert(
  id: string,
  closureRemarks: string,
  _actor: CpvAlertActor,
  existing: CpvAlertRecord,
  options?: { changeReason?: string; esignConfirmed?: boolean },
) {
  if (!closureRemarks.trim() || closureRemarks.trim().length < 5) {
    return { error: 'Closure remarks must be at least 5 characters.' };
  }
  try {
    const reason = resolveChangeReason(options?.changeReason, existing.changeReason, 'Alert closed with justification');
    if (!reason) return { error: 'Change reason must be at least 5 characters.' };
    const fn = httpsCallable(getFirebaseFunctions(), 'closeAdminCpvAlert');
    await fn({
      id,
      closureRemarks,
      changeReason: reason,
      esignConfirmed: options?.esignConfirmed !== false,
    });
    return { error: null };
  } catch (e) {
    console.error('closeCpvAlert failed', e);
    return { error: callableErrorMessage(e, 'Close failed.') };
  }
}

export async function rejectCpvAlert(
  id: string,
  remarks: string,
  _actor: CpvAlertActor,
  existing: CpvAlertRecord,
  options?: { changeReason?: string; esignConfirmed?: boolean },
) {
  try {
    const reason = resolveChangeReason(options?.changeReason, existing.changeReason, 'Alert rejected with justification');
    if (!reason) return { error: 'Change reason must be at least 5 characters.' };
    const fn = httpsCallable(getFirebaseFunctions(), 'rejectAdminCpvAlert');
    await fn({
      id,
      remarks: remarks || 'Rejected',
      changeReason: reason,
      esignConfirmed: options?.esignConfirmed !== false,
    });
    return { error: null };
  } catch (e) {
    console.error('rejectCpvAlert failed', e);
    return { error: callableErrorMessage(e, 'Reject failed.') };
  }
}

export async function escalateCpvAlert(
  id: string,
  _actor: CpvAlertActor,
  existing: CpvAlertRecord,
  escalationRole = 'head_qa',
  options?: { changeReason?: string; esignConfirmed?: boolean },
) {
  try {
    const reason = resolveChangeReason(options?.changeReason, existing.changeReason, 'Alert escalated per SLA matrix');
    if (!reason) return { error: 'Change reason must be at least 5 characters.' };
    const fn = httpsCallable(getFirebaseFunctions(), 'escalateAdminCpvAlert');
    await fn({
      id,
      escalationRole,
      changeReason: reason,
      esignConfirmed: options?.esignConfirmed !== false,
    });
    return { error: null };
  } catch (e) {
    console.error('escalateCpvAlert failed', e);
    return { error: callableErrorMessage(e, 'Escalation failed.') };
  }
}

export async function saveAlertRule(form: CpvAlertRuleFormData, _actor: CpvAlertActor, existingId?: string) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  const reason = resolveChangeReason(form.changeReason, null, 'Alert rule configuration updated');
  if (!reason) return { error: 'Change reason must be at least 5 characters.' };
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'saveAdminAlertRule');
    await fn({
      ...form,
      changeReason: reason,
      existingId: existingId && !existingId.startsWith('default-') ? existingId : undefined,
    });
    return { error: null };
  } catch (e) {
    console.error('saveAlertRule failed', e);
    return { error: callableErrorMessage(e, 'Save rule failed.') };
  }
}

export async function deactivateAlertRule(id: string, _actor: CpvAlertActor, changeReason = 'Alert rule deactivated') {
  try {
    const reason = resolveChangeReason(changeReason, null, 'Alert rule deactivated');
    if (!reason) return { error: 'Change reason must be at least 5 characters.' };
    const fn = httpsCallable(getFirebaseFunctions(), 'deactivateAdminAlertRule');
    await fn({ id, changeReason: reason });
    return { error: null };
  } catch (e) {
    console.error('deactivateAlertRule failed', e);
    return { error: callableErrorMessage(e, 'Deactivate failed.') };
  }
}

export async function softDeleteCpvAlert(id: string, existing: CpvAlertRecord, changeReason: string) {
  try {
    const reason = resolveChangeReason(changeReason, existing.changeReason);
    if (!reason) return { error: 'Change reason must be at least 5 characters.' };
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminCpvAlert');
    await fn({ id, changeReason: reason });
    return { error: null };
  } catch (e) {
    console.error('softDeleteCpvAlert failed', e);
    return { error: callableErrorMessage(e, 'Delete failed.') };
  }
}

export async function scanAndCreateAlerts(actor: CpvAlertActor): Promise<{ created: number; error: string | null }> {
  if (!isFirebaseConfigured()) return { created: 0, error: 'Firebase is not configured.' };
  try {
    const [existing, rules, cpp, cqa, stability, holdTime, capability, spc, riskAssessment, utility, environmental, yieldRows, rawMaterial, packingMaterial, cpvReviews] = await Promise.all([
      fetchCpvAlerts(500),
      fetchAlertRules(),
      listCpvRecords<CppRecord>(CPV_COLLECTIONS.cpp, 500),
      listCpvRecords<CqaRecord>(CPV_COLLECTIONS.cqa, 500),
      fetchStabilityResults(300),
      fetchHoldTimeRecords(300),
      fetchProcessCapabilityRecords(300),
      fetchSpcRecords(300),
      fetchRiskAssessmentRecords(300),
      fetchUtilityRecords(300),
      fetchEnvironmentalRecords(300),
      fetchYieldRecords(300),
      fetchRawMaterialRecords(300),
      fetchPackingMaterialRecords(300),
      fetchCpvReviewRecords(100),
    ]);

    // Keep trend scan available for future correlation (read path retained).
    void fetchTrendAnalysisRecords(100).catch(() => []);

    const scans: Array<{ source: AlertSource; records: Record<string, unknown>[]; ruleModule: string }> = [
      { source: 'CPP Monitoring', records: cpp as unknown as Record<string, unknown>[], ruleModule: 'CPP Monitoring' },
      { source: 'CQA Monitoring', records: cqa as unknown as Record<string, unknown>[], ruleModule: 'CQA Monitoring' },
      { source: 'Stability Monitoring', records: stability as unknown as Record<string, unknown>[], ruleModule: 'Stability Monitoring' },
      { source: 'Hold Time Monitoring', records: holdTime as unknown as Record<string, unknown>[], ruleModule: 'Hold Time Monitoring' },
      { source: 'Process Capability', records: capability as unknown as Record<string, unknown>[], ruleModule: 'Process Capability' },
      { source: 'SPC', records: spc as unknown as Record<string, unknown>[], ruleModule: 'SPC' },
      { source: 'Risk Assessment', records: riskAssessment as unknown as Record<string, unknown>[], ruleModule: 'Risk Assessment' },
      { source: 'Utility Monitoring', records: utility as unknown as Record<string, unknown>[], ruleModule: 'Utility Monitoring' },
      { source: 'Environmental Monitoring', records: environmental as unknown as Record<string, unknown>[], ruleModule: 'Environmental Monitoring' },
      { source: 'Yield Monitoring', records: yieldRows as unknown as Record<string, unknown>[], ruleModule: 'Yield Monitoring' },
      { source: 'Raw Material Monitoring', records: rawMaterial as unknown as Record<string, unknown>[], ruleModule: 'Raw Material Monitoring' },
      { source: 'Packing Material Monitoring', records: packingMaterial as unknown as Record<string, unknown>[], ruleModule: 'Packing Material Monitoring' },
    ];

    let created = 0;
    for (const scan of scans) {
      const rule = rules.find((r) => r.moduleName === scan.ruleModule && r.status === 'Active');
      for (const record of scan.records.slice(0, 50)) {
        const inferred = inferAlertFromRecord(scan.source, record, rule);
        if (!inferred) continue;
        const recordId = str(record.id);
        const alertType = inferred.alertType as AlertType;
        const dup = await isDuplicateAlert(scan.source, recordId, alertType, rule?.repeatAlertSuppressionHours || 24, existing);
        if (dup) continue;
        const formPayload = {
          alertTitle: inferred.alertTitle || `${scan.source} alert`,
          alertSource: inferred.alertSource || scan.source,
          moduleName: inferred.moduleName || scan.source,
          productName: inferred.productName || 'Unknown',
          productCode: inferred.productCode || '',
          batchNumber: inferred.batchNumber || '',
          parameterName: inferred.parameterName || '',
          observedValue: inferred.observedValue ?? '',
          limitValue: inferred.limitValue ?? '',
          alertType: inferred.alertType || 'Alert Limit Crossed',
          alertCategory: inferAlertCategory(
            String(inferred.alertSource || scan.source),
            String(inferred.alertType || 'Alert Limit Crossed'),
            String(inferred.alertPriority || 'High'),
          ),
          alertPriority: inferred.alertPriority || 'High',
          alertSeverity: inferred.alertSeverity || 'Major',
          alertMessage: inferred.alertMessage || `${scan.source} alert`,
          assignedTo: inferred.assignedTo || '',
          assignedRole: inferred.assignedRole || rule?.notifyRole || 'qa',
          dueDate: inferred.dueDate || '',
          deliveryChannels: rule?.deliveryChannels || ['In-App', 'Toast'],
          changeReason: `Auto-scan from ${scan.source}`,
        } as CpvAlertFormData;
        const { result } = await createCpvAlert(formPayload, actor, existing.length + created, {
          sourceRecordId: recordId,
          autoCreated: true,
          changeReason: formPayload.changeReason,
        });
        if (result) {
          created++;
          existing.push(result);
        }
      }
    }

    const now = new Date();
    for (const review of cpvReviews) {
      if (['Approved', 'Archived'].includes(String(review.reviewStatus))) continue;
      const due = new Date(review.reviewPeriodTo || review.createdAt);
      if (due >= now) continue;
      const inferred: CpvAlertFormData = {
        alertTitle: 'CPV annual review overdue',
        alertSource: 'Annual CPV Review',
        moduleName: 'Annual CPV Review',
        productName: review.productName,
        productCode: review.productCode || '',
        batchNumber: '',
        parameterName: 'Annual Review',
        observedValue: '',
        limitValue: '',
        alertType: 'Overdue Review',
        alertCategory: 'Compliance',
        alertPriority: 'Medium',
        alertSeverity: 'Warning',
        alertMessage: `Annual CPV review ${review.cpvReviewNumber} is overdue`,
        assignedRole: 'qa',
        assignedTo: '',
        dueDate: addDays(7),
        deliveryChannels: ['In-App', 'Email'],
        changeReason: 'Auto-scan annual CPV review overdue',
      };
      const dup = await isDuplicateAlert('Annual CPV Review', review.id, 'Overdue Review', 72, existing);
      if (dup) continue;
      const { result } = await createCpvAlert(inferred, actor, existing.length + created, {
        sourceRecordId: review.id,
        autoCreated: true,
        changeReason: inferred.changeReason,
      });
      if (result) { created++; existing.push(result); }
    }

    return { created, error: null };
  } catch (e) {
    console.error('scanAndCreateAlerts failed', e);
    return { created: 0, error: callableErrorMessage(e, 'Scan failed.') };
  }
}

export async function logAlertExport(actor: CpvAlertActor, count: number) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminCpvAlertExport');
    await fn({
      count,
      changeReason: 'Alert register export',
      documentNumber: `EXPORT-${count}`,
      actorName: actor.name,
    });
  } catch (e) {
    console.error('logAlertExport failed', e);
  }
}

/* Legacy compatibility */
export async function listAlerts(max = 200) {
  return fetchCpvAlerts(max);
}

export async function acknowledgeAlert(id: string, actor: { id?: string; name?: string }) {
  const existing = await fetchCpvAlertById(id);
  if (!existing) return;
  return acknowledgeCpvAlert(id, { id: actor.id || 'system', name: actor.name || 'System' }, existing);
}

export async function closeAlert(id: string, actor: { id?: string; name?: string }) {
  const existing = await fetchCpvAlertById(id);
  if (!existing) return;
  return closeCpvAlert(id, 'Closed via legacy action', { id: actor.id || 'system', name: actor.name || 'System' }, existing);
}
