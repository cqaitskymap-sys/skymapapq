import {
  collection, doc, addDoc, getDocs, updateDoc, query, where, limit, orderBy,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { CAPA_COLLECTIONS, type CapaRecord } from '@/lib/capa-types';
import { createCapa, getCapaById, getCapaEffectiveness } from '@/lib/capa-service';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  canCloseOosWithCapa,
  capaLinkFromCapaRecord,
  computeOosCapaAutoRules,
  computeOosCapaDashboardMetrics,
  computeOosCapaMandatory,
  isOosCapaLinkOverdue,
  mapCapaRecordToOosDisplayStatus,
  type OosCapaActor,
  type OosCapaCloseInput,
  type OosCapaEffectivenessInput,
  type OosCapaFormInput,
  type OosCapaImplementationInput,
} from '@/lib/oos-capa-records';
import {
  OOS_COLLECTIONS,
  type OosCapaLink,
  type OosCapaDashboardMetrics,
  type OosRecord,
} from '@/lib/oos-types';
import {
  getAuditLogsForOos,
  getImpactAssessment,
  getOosById,
  getPhase2,
  updateOosRecord,
} from '@/lib/oos-service';

export type { OosCapaActor, OosCapaFormInput, OosCapaImplementationInput, OosCapaEffectivenessInput, OosCapaCloseInput };

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().split('T')[0];

async function audit(actor: OosCapaActor, actionType: string, oosId: string, detail?: string) {
  try {
    await createAuditLog({
      moduleName: 'OOS CAPA Management',
      collectionName: OOS_COLLECTIONS.capaLinks,
      recordId: oosId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      user: { id: actor.id, name: actor.name, role: actor.role || '' },
      status: 'Success',
    });
  } catch (e) {
    console.error('oos capa audit', e);
  }
}

async function notifyRoles(title: string, message: string, oosId: string, roles: string[]) {
  if (!isFirebaseConfigured()) return;
  for (const role of roles) {
    try {
      await addDoc(collection(getFirebaseFirestore(), OOS_COLLECTIONS.notifications), {
        title, message, module: 'OOS', record_id: oosId, target_role: role, read: false, created_at: nowIso(),
      });
    } catch (e) {
      console.error('oos capa notify', e);
    }
  }
}

async function notifyUser(title: string, message: string, oosId: string, userId: string) {
  if (!isFirebaseConfigured() || !userId) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), OOS_COLLECTIONS.notifications), {
      title, message, module: 'OOS', record_id: oosId, user_id: userId, read: false, created_at: nowIso(),
    });
  } catch (e) {
    console.error('oos capa notify user', e);
  }
}

async function findCapaByNumber(capaNumber: string): Promise<CapaRecord | null> {
  if (!isFirebaseConfigured()) return null;
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), CAPA_COLLECTIONS.records),
    where('capa_number', '==', capaNumber.trim()),
    limit(1),
  ));
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() } as CapaRecord;
}

export async function checkRepeatOos(record: OosRecord): Promise<boolean> {
  if (!isFirebaseConfigured()) return false;
  const hasRepeat = (docs: Array<{ id: string; data: () => { result_status?: unknown; test_name?: unknown } }>, testName?: string) =>
    docs.filter((d) => {
      if (d.id === record.id) return false;
      if (d.data().result_status !== 'OOS') return false;
      if (testName && String(d.data().test_name || '') !== testName) return false;
      return true;
    }).length >= 1;

  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), OOS_COLLECTIONS.records),
      where('product_name', '==', record.product_name),
      where('test_name', '==', record.test_name),
      limit(20),
    ));
    return hasRepeat(snap.docs);
  } catch {
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), OOS_COLLECTIONS.records),
        where('product_name', '==', record.product_name),
        limit(50),
      ));
      return hasRepeat(snap.docs, record.test_name);
    } catch {
      return false;
    }
  }
}

export async function getActiveOosCapaLink(oosId: string): Promise<OosCapaLink | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), OOS_COLLECTIONS.capaLinks),
      where('oos_id', '==', oosId),
      where('is_active', '==', true),
      limit(1),
    ));
    if (!snap.empty) return normalizeCapaLink(snap.docs[0].id, snap.docs[0].data());
  } catch {
    /* fallback without composite index */
  }
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), OOS_COLLECTIONS.capaLinks),
    where('oos_id', '==', oosId),
    limit(10),
  ));
  const active = snap.docs.find((d) => d.data().is_active !== false) || snap.docs[0];
  if (!active) return null;
  return normalizeCapaLink(active.id, active.data());
}

function normalizeCapaLink(id: string, data: Record<string, unknown>): OosCapaLink {
  return {
    id,
    ...data,
    target_completion_date: (data.target_completion_date as string) || (data.target_date as string) || null,
    target_date: (data.target_date as string) || (data.target_completion_date as string) || null,
    effectiveness_result: (data.effectiveness_result as string) || null,
    effectiveness_check: (data.effectiveness_check as string) || '',
  } as OosCapaLink;
}

export async function getOosCapaLinkHistory(oosId: string): Promise<OosCapaLink[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), OOS_COLLECTIONS.capaLinks),
      where('oos_id', '==', oosId),
      orderBy('created_at', 'desc'),
    ));
    return snap.docs.map((d) => normalizeCapaLink(d.id, d.data()));
  } catch {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), OOS_COLLECTIONS.capaLinks),
      where('oos_id', '==', oosId),
    ));
    return snap.docs.map((d) => normalizeCapaLink(d.id, d.data()))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}

async function deactivateExistingLinks(oosId: string, actor: OosCapaActor) {
  const history = await getOosCapaLinkHistory(oosId);
  await Promise.all(history.filter((h) => h.is_active !== false).map(async (h) => {
    await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.capaLinks, h.id), {
      is_active: false,
      updated_at: nowIso(),
      updated_by: actor.id,
      updated_by_name: actor.name,
    });
  }));
}

async function syncOosCapaStatus(oosId: string, capaRequired: boolean, capa: CapaRecord | null, actor: OosCapaActor) {
  const displayStatus = capa ? mapCapaRecordToOosDisplayStatus(capa.capa_status, capa.target_completion_date) : '';
  const isOpen = capa && displayStatus !== 'Closed';
  await updateOosRecord(oosId, {
    capa_required: capaRequired,
    linked_capa_number: capa?.capa_number || null,
    linked_capa_id: capa?.id || null,
    ...(capaRequired && isOpen ? { status: 'capa_required' } : {}),
  }, { id: actor.id, name: actor.name, role: actor.role || '' }, { workflow: Boolean(capaRequired && isOpen) });
}

async function writeCapaLink(payload: Omit<OosCapaLink, 'id'>, actor: OosCapaActor, action: string): Promise<OosCapaLink> {
  const ref = await addDoc(collection(getFirebaseFirestore(), OOS_COLLECTIONS.capaLinks), payload);
  await audit(actor, action, payload.oos_id, `${payload.capa_number}: ${action}`);
  return { id: ref.id, ...payload };
}

export async function fetchOosCapaPageData(oosId: string) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const [record, link, impact, phase2, auditLogs] = await Promise.all([
      getOosById(oosId),
      getActiveOosCapaLink(oosId),
      getImpactAssessment(oosId),
      getPhase2(oosId),
      getAuditLogsForOos(oosId),
    ]);
    if (!record) return { error: 'OOS record not found.' };

    const isRepeatOos = await checkRepeatOos(record);
    let capa: CapaRecord | null = null;
    if (link?.capa_id) capa = await getCapaById(link.capa_id);
    else if (record.linked_capa_id) capa = await getCapaById(record.linked_capa_id);

    const history = await getOosCapaLinkHistory(oosId);
    const effectiveness = capa ? await getCapaEffectiveness(capa.id) : null;
    const autoRules = computeOosCapaAutoRules(record, impact, phase2, isRepeatOos);
    const closureCheck = canCloseOosWithCapa(record, link, capa, autoRules.capaMandatory);

    return {
      record,
      link: link ? {
        ...link,
        capa_status: mapCapaRecordToOosDisplayStatus(capa?.capa_status, capa?.target_completion_date) || link.capa_status,
      } : null,
      capa,
      impact,
      phase2,
      history,
      effectiveness: effectiveness ? [effectiveness] : [],
      auditLogs,
      autoRules,
      isRepeatOos,
      closureCheck,
    };
  } catch (e) {
    console.error('fetchOosCapaPageData', e);
    return { error: e instanceof Error ? e.message : 'Failed to load CAPA data' };
  }
}

export async function listOosCapaManagement(max = 100): Promise<{
  rows: (OosRecord & { link?: OosCapaLink | null })[];
  metrics: OosCapaDashboardMetrics;
}> {
  if (!isFirebaseConfigured()) return { rows: [], metrics: computeOosCapaDashboardMetrics([]) };
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), OOS_COLLECTIONS.records),
      orderBy('updated_at', 'desc'),
      limit(max),
    ));
    const records = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as OosRecord))
      .filter((r) => r.result_status === 'OOS' && (r.capa_required || r.linked_capa_number));

    const rows = await Promise.all(records.map(async (r) => ({
      ...r,
      link: await getActiveOosCapaLink(r.id),
    })));

    const allLinks = (await Promise.all(rows.map((r) => getOosCapaLinkHistory(r.id)))).flat();
    const metrics = computeOosCapaDashboardMetrics(allLinks);

    return { rows, metrics };
  } catch (e) {
    console.error('listOosCapaManagement', e);
    return { rows: [], metrics: computeOosCapaDashboardMetrics([]) };
  }
}

export async function saveOosCapaRequirement(
  oosId: string,
  capaRequired: boolean,
  remarks: string,
  actor: OosCapaActor,
): Promise<{ error?: string }> {
  const record = await getOosById(oosId);
  if (!record) return { error: 'OOS record not found' };

  const [impact, phase2] = await Promise.all([getImpactAssessment(oosId), getPhase2(oosId)]);
  const isRepeatOos = await checkRepeatOos(record);
  const mandatory = computeOosCapaMandatory(record, impact, phase2, isRepeatOos);
  if (mandatory && !capaRequired) return { error: 'CAPA is mandatory for this OOS and cannot be set to No.' };

  try {
    await updateOosRecord(oosId, {
      capa_required: capaRequired || mandatory,
      ...(capaRequired || mandatory ? { status: 'capa_required' } : {}),
    }, { id: actor.id, name: actor.name, role: actor.role || '' }, { workflow: capaRequired || mandatory });

    const link = await getActiveOosCapaLink(oosId);
    if (link?.id) {
      await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.capaLinks, link.id), {
        capa_required: capaRequired || mandatory,
        remarks: remarks || link.remarks,
        updated_at: nowIso(),
        updated_by: actor.id,
        updated_by_name: actor.name,
      });
    }

    await audit(actor, 'CAPA Required Changed', oosId, capaRequired ? 'CAPA required' : 'CAPA not required');
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save CAPA requirement' };
  }
}

export async function linkExistingCapaToOos(
  oosId: string,
  capaNumber: string,
  remarks: string,
  actor: OosCapaActor,
): Promise<{ link?: OosCapaLink; error?: string }> {
  if (!capaNumber.trim()) return { error: 'CAPA number is required' };
  const record = await getOosById(oosId);
  if (!record) return { error: 'OOS record not found' };

  const capa = await findCapaByNumber(capaNumber);
  if (!capa) return { error: `CAPA ${capaNumber} not found` };

  try {
    await deactivateExistingLinks(oosId, actor);
    const [impact, phase2] = await Promise.all([getImpactAssessment(oosId), getPhase2(oosId)]);
    const isRepeatOos = await checkRepeatOos(record);
    const capaRequired = record.capa_required || computeOosCapaMandatory(record, impact, phase2, isRepeatOos);
    const payload = capaLinkFromCapaRecord(oosId, record, capa, capaRequired, actor, remarks);
    const link = await writeCapaLink(payload, actor, 'CAPA Linked');

    await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.records, capa.id), {
      oos_id: oosId,
      updated_at: nowIso(),
    });

    await syncOosCapaStatus(oosId, capaRequired, capa, actor);
    await notifyUser('CAPA Linked to OOS', `${capa.capa_number} linked to ${record.oos_number}`, oosId, capa.action_owner);
    await notifyRoles('CAPA Linked', `${capa.capa_number} linked to OOS ${record.oos_number}`, oosId, ['qa_manager', 'qa']);
    if (isCriticalOos(record)) await notifyRoles('Critical OOS CAPA Linked', record.oos_number, oosId, ['head_qa']);

    return { link };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to link CAPA' };
  }
}

function isCriticalOos(record: OosRecord): boolean {
  return Boolean(record.is_critical_test) || /sterility|endotoxin|assay/i.test(record.test_name);
}

export async function createOosCapaFromRecord(
  oosId: string,
  input: OosCapaFormInput,
  actor: OosCapaActor,
): Promise<{ link?: OosCapaLink; capa?: CapaRecord; error?: string }> {
  const record = await getOosById(oosId);
  if (!record) return { error: 'OOS record not found' };

  const [impact, phase2] = await Promise.all([getImpactAssessment(oosId), getPhase2(oosId)]);
  const isRepeatOos = await checkRepeatOos(record);
  const capaRequired = input.capa_required || computeOosCapaMandatory(record, impact, phase2, isRepeatOos);

  if (!input.capa_title?.trim()) return { error: 'CAPA title is required' };
  if (!input.corrective_action.trim()) return { error: 'Corrective action is required' };
  if (!input.preventive_action.trim()) return { error: 'Preventive action is required' };
  if (!input.action_owner_name.trim()) return { error: 'Action owner is required' };
  if (!input.target_completion_date) return { error: 'Target completion date is required' };

  try {
    const capa = await createCapa({
      capa_date: today(),
      capa_source: input.capa_source || 'OOS',
      source_reference_number: record.oos_number,
      department: input.department || record.department || 'QA',
      product_name: record.product_name || '',
      batch_number: record.batch_number || '',
      capa_title: input.capa_title,
      problem_description: `${record.test_name} OOS: observed ${record.observed_result} ${record.unit} (spec ${record.spec_lower_limit}-${record.spec_upper_limit})`,
      root_cause: input.root_cause || phase2?.root_cause || record.root_cause || '',
      corrective_action: input.corrective_action,
      preventive_action: input.preventive_action,
      action_owner: actor.id,
      action_owner_name: input.action_owner_name,
      target_completion_date: input.target_completion_date,
      effectiveness_check_required: input.effectiveness_check_required,
      effectiveness_criteria: 'Confirm OOS root cause eliminated; verify next batches meet specification',
      priority: isCriticalOos(record) ? 'critical' : 'high',
      qa_remarks: input.remarks || '',
    }, { id: actor.id, name: actor.name, role: actor.role || 'qa' }, {
      status: 'submitted',
      oos_id: oosId,
    });

    await deactivateExistingLinks(oosId, actor);
    const remarkText = [input.remarks, isRepeatOos ? 'repeat OOS' : ''].filter(Boolean).join('; ');
    const payload = capaLinkFromCapaRecord(oosId, record, capa, capaRequired, actor, remarkText);
    const link = await writeCapaLink(payload, actor, 'CAPA Created');

    await syncOosCapaStatus(oosId, capaRequired, capa, actor);
    await audit(actor, 'CAPA Created', oosId, capa.capa_number);
    await notifyUser('CAPA Created from OOS', `${capa.capa_number} assigned — ${record.oos_number}`, oosId, capa.action_owner);
    await notifyRoles('CAPA Created from OOS', `${capa.capa_number} for ${record.oos_number}`, oosId, ['qa_manager', 'qa']);
    if (isCriticalOos(record)) await notifyRoles('Critical OOS CAPA Created', record.oos_number, oosId, ['head_qa']);

    return { link, capa };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to create CAPA' };
  }
}

export async function updateOosCapaImplementation(
  oosId: string,
  input: OosCapaImplementationInput,
  actor: OosCapaActor,
): Promise<{ error?: string }> {
  const link = await getActiveOosCapaLink(oosId);
  if (!link?.capa_id) return { error: 'No linked CAPA found' };

  const statusMap: Record<string, string> = {
    Open: 'submitted',
    'Under Implementation': 'under_implementation',
    'Pending Verification': 'implemented',
    'Effectiveness Check Pending': 'effectiveness_pending',
    Closed: 'closed',
    Overdue: 'overdue',
    Draft: 'draft',
  };

  try {
    const ts = nowIso();
    const capaUpdates: Partial<CapaRecord> & { updated_at: string; updated_by: string; updated_by_name: string } = {
      capa_status: statusMap[input.capa_status] || input.capa_status.toLowerCase(),
      updated_at: ts,
      updated_by: actor.id,
      updated_by_name: actor.name,
    };
    if (input.corrective_action) capaUpdates.corrective_action = input.corrective_action;
    if (input.preventive_action) capaUpdates.preventive_action = input.preventive_action;
    if (input.implementation_date) capaUpdates.actual_completion_date = input.implementation_date;

    await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.records, link.capa_id), capaUpdates);
    await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.capaLinks, link.id), {
      capa_status: input.capa_status,
      implementation_date: input.implementation_date || link.implementation_date,
      corrective_action: input.corrective_action || link.corrective_action,
      preventive_action: input.preventive_action || link.preventive_action,
      remarks: input.remarks || link.remarks,
      updated_at: ts,
      updated_by: actor.id,
      updated_by_name: actor.name,
    });

    const actionLabel = input.capa_status === 'Under Implementation'
      ? 'CAPA Implementation Started'
      : input.capa_status === 'Pending Verification'
        ? 'CAPA Implementation Completed'
        : 'CAPA Updated';
    await audit(actor, actionLabel, oosId, input.capa_status);

    const capa = await getCapaById(link.capa_id);
    const record = await getOosById(oosId);
    if (record && capa) await syncOosCapaStatus(oosId, record.capa_required, capa, actor);

    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to update implementation' };
  }
}

export async function recordOosCapaEffectiveness(
  oosId: string,
  input: OosCapaEffectivenessInput,
  actor: OosCapaActor,
): Promise<{ error?: string }> {
  if (!input.effectiveness_result) return { error: 'Effectiveness result is required' };
  if (!input.effectiveness_check_date) return { error: 'Effectiveness check date is required' };

  const link = await getActiveOosCapaLink(oosId);
  if (!link?.capa_id) return { error: 'No linked CAPA found' };

  try {
    const ts = nowIso();
    await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.records, link.capa_id), {
      effectiveness_result: input.effectiveness_result,
      effectiveness_check_date: input.effectiveness_check_date,
      capa_status: input.effectiveness_result === 'Not Effective' ? 'effectiveness_pending' : 'effectiveness_completed',
      updated_at: ts,
      updated_by: actor.id,
      updated_by_name: actor.name,
    });

    const newStatus = input.effectiveness_result === 'Not Effective'
      ? 'Effectiveness Check Pending'
      : 'Pending Verification';

    await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.capaLinks, link.id), {
      effectiveness_result: input.effectiveness_result,
      effectiveness_check_date: input.effectiveness_check_date,
      capa_status: newStatus,
      remarks: input.remarks || link.remarks,
      updated_at: ts,
      updated_by: actor.id,
      updated_by_name: actor.name,
    });

    await audit(actor, 'Effectiveness Recorded', oosId, `${input.effectiveness_result} on ${input.effectiveness_check_date}`);
    await notifyRoles('CAPA Effectiveness Recorded', `${link.capa_number}: ${input.effectiveness_result}`, oosId, ['qa_manager', 'qa']);

    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to record effectiveness' };
  }
}

export async function closeOosCapaLink(
  oosId: string,
  input: OosCapaCloseInput,
  actor: OosCapaActor,
): Promise<{ error?: string }> {
  const link = await getActiveOosCapaLink(oosId);
  if (!link?.capa_id) return { error: 'No linked CAPA found' };

  const capa = await getCapaById(link.capa_id);
  const record = await getOosById(oosId);
  if (!record) return { error: 'OOS record not found' };

  const effRequired = link.effectiveness_check_required ?? capa?.effectiveness_check_required;
  if (effRequired && !input.effectiveness_result && !link.effectiveness_result) {
    return { error: 'Effectiveness result is required before CAPA closure' };
  }

  try {
    const ts = nowIso();
    const closureDate = input.capa_closure_date || today();
    const effResult = input.effectiveness_result || link.effectiveness_result;

    await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.records, link.capa_id), {
      capa_status: 'closed',
      actual_completion_date: closureDate,
      effectiveness_result: effResult,
      updated_at: ts,
      updated_by: actor.id,
      updated_by_name: actor.name,
    });

    await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.capaLinks, link.id), {
      capa_status: 'Closed',
      capa_closure_date: closureDate,
      effectiveness_result: effResult,
      remarks: input.remarks || link.remarks,
      updated_at: ts,
      updated_by: actor.id,
      updated_by_name: actor.name,
    });

    await audit(actor, 'CAPA Closed', oosId, closureDate);
    await syncOosCapaStatus(oosId, record.capa_required, { ...capa!, capa_status: 'closed' }, actor);
    await notifyRoles('CAPA Closed', `${link.capa_number} closed for ${record.oos_number}`, oosId, ['qa_manager', 'qa']);

    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to close CAPA' };
  }
}

export async function refreshOosCapaLinkStatus(oosId: string, actor: OosCapaActor): Promise<void> {
  const link = await getActiveOosCapaLink(oosId);
  if (!link?.capa_id) return;
  const capa = await getCapaById(link.capa_id);
  if (!capa) return;

  const displayStatus = mapCapaRecordToOosDisplayStatus(capa.capa_status, capa.target_completion_date);
  await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.capaLinks, link.id), {
    capa_status: displayStatus,
    effectiveness_check_date: capa.effectiveness_check_date,
    effectiveness_result: capa.effectiveness_result,
    corrective_action: capa.corrective_action,
    preventive_action: capa.preventive_action,
    updated_at: nowIso(),
  });

  const record = await getOosById(oosId);
  if (record) await syncOosCapaStatus(oosId, record.capa_required, capa, actor);

  if (displayStatus === 'Overdue') {
    await audit(actor, 'CAPA Status Update', oosId, 'Overdue');
    await notifyUser('CAPA Overdue', `${link.capa_number} is overdue for OOS ${record?.oos_number}`, oosId, capa.action_owner);
    await notifyRoles('CAPA Overdue Alert', `${link.capa_number} overdue`, oosId, ['qa_manager', 'qa']);
  }
}

export async function validateOosCanClose(oosId: string): Promise<{ canClose: boolean; reason?: string }> {
  const record = await getOosById(oosId);
  if (!record) return { canClose: false, reason: 'OOS not found' };
  const [link, impact, phase2] = await Promise.all([
    getActiveOosCapaLink(oosId),
    getImpactAssessment(oosId),
    getPhase2(oosId),
  ]);
  const isRepeatOos = await checkRepeatOos(record);
  const mandatory = computeOosCapaMandatory(record, impact, phase2, isRepeatOos);
  const capa = link?.capa_id ? await getCapaById(link.capa_id) : null;
  return canCloseOosWithCapa(record, link, capa, mandatory);
}

export async function logOosCapaPageViewed(oosId: string, actor: OosCapaActor, oosNumber?: string) {
  await audit(actor, 'CAPA page viewed', oosId, oosNumber);
}
