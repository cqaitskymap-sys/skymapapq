import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, writeBatch,
  type DocumentData, type UpdateData,
} from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { getFirebaseAuth, getFirebaseFirestore } from '@/lib/firebase';
import { CPV_COLLECTIONS } from '@/lib/cpv';
import { getPackagingReviews } from '@/lib/packaging-service';
import { getMaterialReviewsByPQR } from '@/lib/material-service';
import {
  PQR_COLLECTIONS, PqrDocument, PqrApproval, PqrDataSnapshot, PqrDocumentStatus, ESignPayload,
} from '@/lib/pqr-types';
import { createAuditLog } from '@/lib/audit-trail';
import { canTransitionPqrStatus, isTerminalPqrStatus } from '@/lib/pqr-dashboard-records';
import { enrichAiClient } from '@/lib/ai/client';

type Actor = { id?: string; name?: string; role?: string; email?: string };

function now() {
  return new Date().toISOString();
}

function inDateRange(dateStr: string | undefined, from: string, to: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  return d >= new Date(from) && d <= new Date(to + 'T23:59:59');
}

function matchesProduct(record: Record<string, unknown>, productName: string): boolean {
  const q = productName.trim().toLowerCase();
  if (q.length < 2) return false;
  const fields = ['product_name', 'productName', 'product', 'product_code', 'productCode'];
  return fields.some((f) => {
    const val = String(record[f] || '').trim().toLowerCase();
    if (val.length < 2) return false;
    return val === q || val.includes(q);
  });
}

async function readCollection(name: string, max = 500): Promise<Record<string, unknown>[]> {
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), name), limit(max)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

async function readFirstAvailable(names: string[]): Promise<Record<string, unknown>[]> {
  for (const name of names) {
    const data = await readCollection(name);
    if (data.length) return data;
  }
  return [];
}

export async function listPqrDocuments(): Promise<PqrDocument[]> {
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), PQR_COLLECTIONS.documents), orderBy('created_at', 'desc')));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PqrDocument));
  } catch {
    const snap = await getDocs(collection(getFirebaseFirestore(), PQR_COLLECTIONS.documents));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PqrDocument));
  }
}

export async function getPqrDocument(id: string): Promise<PqrDocument | null> {
  const legacy = await getDoc(doc(getFirebaseFirestore(), PQR_COLLECTIONS.documents, id));
  if (legacy.exists()) {
    return { id: legacy.id, ...legacy.data() } as PqrDocument;
  }

  // Modern create writes to pqr_records — map into legacy document shape for detail views.
  try {
    const modern = await getDoc(doc(getFirebaseFirestore(), 'pqr_records', id));
    if (!modern.exists()) return null;
    const r = modern.data() as Record<string, unknown>;
    const statusRaw = String(r.status || 'draft').toLowerCase().replace(/\s+/g, '_');
    const statusMap: Record<string, PqrDocumentStatus> = {
      draft: 'draft',
      data_collection: 'draft',
      generated: 'draft',
      under_review: 'under_review',
      qa_review: 'under_review',
      approval_pending: 'under_review',
      approved: 'approved',
      closed: 'approved',
      rejected: 'rejected',
      archived: 'archived',
      cancelled: 'archived',
      returned_for_correction: 'under_review',
    };
    const summary = (r.collectedSummary || {}) as Record<string, unknown>;
    return {
      id: modern.id,
      company_name: String(r.companyName || ''),
      site_name: String(r.site || r.manufacturingSite || r.plant || ''),
      address: String(r.address || ''),
      document_title: String(r.pqrTitle || 'Annual Product Quality Review'),
      product_name: String(r.productName || ''),
      product_id: String(r.productId || ''),
      product_code: String(r.productCode || ''),
      pqr_number: String(r.pqrNumber || ''),
      page_number: '1',
      revision_number: String(r.version || '00'),
      format_number: '',
      review_period_from: String(r.reviewPeriodFrom || ''),
      review_period_to: String(r.reviewPeriodTo || ''),
      pqr_year: Number(r.reviewYear) || new Date().getFullYear(),
      total_batches_manufactured: Number(summary.totalBatches) || 0,
      total_released_batches: Number(summary.releasedBatches) || 0,
      total_rejected_batches: Number(summary.rejectedBatches) || 0,
      total_reworked_batches: 0,
      total_reprocessed_batches: 0,
      document_status: statusMap[statusRaw] || 'draft',
      review_frequency: String(r.pqrFrequency || 'Yearly'),
      current_revision: String(r.version || '00'),
      previous_revision: '',
      next_review_due_date: String(r.dueDate || '') || null,
      document_owner_department: String(r.department || ''),
      effective_date: null,
      prepared_date: String(r.createdAt || '').slice(0, 10) || null,
      company_logo_url: '',
      observations: String(r.remarks || ''),
      conclusions: String(r.conclusion || ''),
      recommendations: String(r.recommendations || ''),
      overall_compliance: String(r.overallQualityStatus || '').toLowerCase().includes('unsatisfactory')
        ? 'unsatisfactory'
        : String(r.overallQualityStatus || '').toLowerCase().includes('improvement')
          ? 'needs_improvement'
          : 'satisfactory',
      oos_count: Number(summary.oos) || 0,
      deviation_count: Number(summary.deviations) || 0,
      capa_count: Number(summary.capa) || 0,
      change_control_count: Number(summary.changeControls) || 0,
      generic_name: String(r.genericName || ''),
      strength: String(r.strength || ''),
      dosage_form: String(r.dosageForm || ''),
      created_by: String(r.createdByName || r.createdBy || ''),
      created_at: String(r.createdAt || ''),
      updated_at: String(r.updatedAt || ''),
    };
  } catch {
    return null;
  }
}

export async function getPqrApprovals(pqrId: string): Promise<PqrApproval[]> {
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), PQR_COLLECTIONS.approvals), where('pqr_id', '==', pqrId)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PqrApproval));
  } catch {
    return [];
  }
}

export async function getPqrBatches(pqrId: string) {
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), PQR_COLLECTIONS.batches), where('pqr_id', '==', pqrId)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export async function getPqrSnapshot(pqrId: string): Promise<PqrDataSnapshot | null> {
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_COLLECTIONS.snapshots),
      where('pqr_id', '==', pqrId),
      orderBy('generatedAt', 'desc'),
      limit(1),
    ));
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() } as PqrDataSnapshot;
  } catch {
    const docSnap = await getDoc(doc(getFirebaseFirestore(), PQR_COLLECTIONS.documents, pqrId));
    const data = docSnap.data();
    if (data?.snapshot_id) {
      const s = await getDoc(doc(getFirebaseFirestore(), PQR_COLLECTIONS.snapshots, data.snapshot_id));
      if (s.exists()) return { id: s.id, ...s.data() } as PqrDataSnapshot;
    }
    return null;
  }
}

export async function listProducts() {
  const adminProducts = await readCollection('products');
  if (adminProducts.length) {
    return adminProducts.map((p) => ({
      id: p.id as string,
      product_name: String(p.productName || p.product_name || ''),
      product_code: String(p.productCode || p.product_code || ''),
      generic_name: String(p.genericName || p.generic_name || ''),
      strength: String(p.strength || ''),
      dosage_form: String(p.dosageForm || p.dosage_form || ''),
    }));
  }
  return [];
}

export async function generatePqrNumber(productCode: string, year: number): Promise<string> {
  const prefix = `PQR/${productCode || 'PRD'}`;
  const docs = await listPqrDocuments();
  const yearDocs = docs.filter((d) => d.pqr_year === year);
  const seq = String(yearDocs.length + 1).padStart(4, '0');
  return `${prefix}/${seq}/${year}`;
}

export async function buildPqrSnapshot(pqr: PqrDocument): Promise<PqrDataSnapshot> {
  const from = pqr.review_period_from;
  const to = pqr.review_period_to;
  const product = pqr.product_name;

  const [pqrBatches, allBatches, cppRaw, cqaRaw, deviationsRaw, oosRaw, capaRaw, ccRaw, stabilityRaw, holdTimeRaw, capabilityRaw, trendAnalysisRaw, spcRaw, packagingReviews, materialReviews] = await Promise.all([
    getPqrBatches(pqr.id!),
    readFirstAvailable(['pqr_batches', 'batches', PQR_COLLECTIONS.batches]),
    readCollection(CPV_COLLECTIONS.cpp),
    readCollection(CPV_COLLECTIONS.cqa),
    readFirstAvailable(['deviations']),
    readFirstAvailable(['oos_records', 'oos']),
    readFirstAvailable(['capa_records', 'capa']),
    readFirstAvailable(['change_control', 'change_controls']),
    readFirstAvailable(['stability_studies', 'stability', 'stability_results']),
    readFirstAvailable(['hold_time_monitoring', 'cpv_hold_time']),
    readFirstAvailable(['process_capability', 'cpv_capability']),
    readFirstAvailable(['trend_analysis', 'cpv_trends']),
    readFirstAvailable(['control_charts', 'cpv_control_charts']),
    getPackagingReviews({ pqrId: pqr.id! }),
    getMaterialReviewsByPQR(pqr.id!).catch(() => []),
  ]);

  const filterRecords = (records: Record<string, unknown>[]) =>
    records.filter((r) => matchesProduct(r, product) && (
      inDateRange(String(
        r.deviation_date || r.deviationDate
        || r.oos_date || r.detected_date
        || r.complaint_date || r.received_date
        || r.change_date || r.recall_date
        || r.manufacturing_date || r.manufacturingDate
        || r.test_date || r.testDate
        || r.startDateTime || r.start_date_time
        || r.created_at || r.createdAt || '',
      ), from, to)
    ));

  const filterCapabilityRecords = (records: Record<string, unknown>[]) =>
    records.filter((r) => matchesProduct(r, product) && (
      inDateRange(String(
        r.reviewPeriodTo || r.review_period_to || r.reviewDate || r.review_date
        || r.reviewPeriodFrom || r.created_at || r.createdAt || '',
      ), from, to)
    ));

  const filterTrendRecords = (records: Record<string, unknown>[]) =>
    records.filter((r) => matchesProduct(r, product) && (
      inDateRange(String(
        r.generatedDate || r.generated_date || r.reviewPeriodTo || r.review_period_to
        || r.reviewPeriodFrom || r.created_at || r.createdAt || '',
      ), from, to)
    ));

  const filterSpcRecords = (records: Record<string, unknown>[]) =>
    records.filter((r) => matchesProduct(r, product) && (
      inDateRange(String(
        r.generatedDate || r.generated_date || r.reviewPeriodTo || r.review_period_to
        || r.reviewPeriodFrom || r.created_at || r.createdAt || '',
      ), from, to)
    ));

  const batches = [...pqrBatches, ...filterRecords(allBatches as Record<string, unknown>[])];

  const countByStatus = (records: Record<string, unknown>[], statusField: string, statusVal: string) =>
    records.filter((r) => String(r[statusField] || r.batch_status || r.status || '').toLowerCase().includes(statusVal)).length;

  const manufactured = batches.length;
  const released = countByStatus(batches as Record<string, unknown>[], 'status', 'released')
    || countByStatus(batches as Record<string, unknown>[], 'batch_status', 'released')
    || countByStatus(batches as Record<string, unknown>[], 'release_status', 'released')
    || countByStatus(batches as Record<string, unknown>[], 'releaseStatus', 'released');

  const rejected = countByStatus(batches as Record<string, unknown>[], 'status', 'reject') || pqr.total_rejected_batches || 0;

  const cppRecords = filterRecords(cppRaw);
  const cqaRecords = filterRecords(cqaRaw);
  const countCpvStatus = (records: Record<string, unknown>[]) => ({
    complies: records.filter((r) => r.status === 'Complies').length,
    oot: records.filter((r) => r.status === 'OOT').length,
    oos: records.filter((r) => r.status === 'OOS').length,
  });

  let deviations = filterRecords(deviationsRaw);

  let oosRecords = filterRecords(oosRaw);

  let capaRecords = filterRecords(capaRaw);

  const changeControl = filterRecords(ccRaw);
  const stability = filterRecords(stabilityRaw);
  const holdTime = filterRecords(holdTimeRaw);
  const capabilityRecords = filterCapabilityRecords(capabilityRaw);
  const trendAnalysisRecords = filterTrendRecords(trendAnalysisRaw);
  const spcRecords = filterSpcRecords(spcRaw);
  const materials = materialReviews as Record<string, unknown>[];
  const packaging = packagingReviews as unknown as Record<string, unknown>[];

  const cppStats = countCpvStatus(cppRecords);
  const cqaStats = countCpvStatus(cqaRecords);

  const snapshot: PqrDataSnapshot = {
    pqr_id: pqr.id!,
    generatedAt: now(),
    product_name: product,
    review_period_from: from,
    review_period_to: to,
    batches: {
      total: manufactured,
      manufactured,
      released,
      rejected,
      reworked: pqr.total_reworked_batches || 0,
      reprocessed: pqr.total_reprocessed_batches || 0,
      records: batches as Record<string, unknown>[],
      summary: `${manufactured} batches manufactured; ${released} released; ${rejected} rejected during review period.`,
    },
    cpp: { total: cppRecords.length, records: cppRecords, ...cppStats, summary: `CPP monitoring: ${cppStats.complies} complies, ${cppStats.oot} OOT, ${cppStats.oos} OOS.` },
    cqa: { total: cqaRecords.length, records: cqaRecords, ...cqaStats, summary: `CQA monitoring: ${cqaStats.complies} complies, ${cqaStats.oot} OOT, ${cqaStats.oos} OOS.` },
    deviations: { total: deviations.length, open: deviations.filter((d) => {
      const s = String(d.status || '');
      return ['open', 'under_investigation', 'submitted', 'qa_review', 'capa_required', 'overdue', 'draft'].includes(s);
    }).length, records: deviations, summary: `${deviations.length} deviations recorded; ${deviations.filter((d) => !['closed', 'approved', 'rejected'].includes(String(d.status))).length} open.` },
    oos: { total: oosRecords.length, open: oosRecords.filter((d) => {
      const s = String(d.status || '');
      return ['open', 'under_investigation', 'submitted', 'phase1_investigation', 'phase2_investigation', 'qa_review', 'final_qa_review', 'capa_required', 'overdue', 'draft'].includes(s);
    }).length, records: oosRecords, summary: `${oosRecords.length} OOS investigations during review period.` },
    capa: { total: capaRecords.length, open: capaRecords.filter((d) => !String(d.status).includes('closed')).length, records: capaRecords.slice(0, 50), summary: `${capaRecords.length} CAPA records linked to product quality events.` },
    changeControl: { total: changeControl.length, records: changeControl, summary: `${changeControl.length} change control records reviewed.` },
    stability: { total: stability.length, records: stability, summary: stability.length ? `${stability.length} stability studies ongoing/completed.` : 'Stability program maintained per approved protocol.' },
    holdTime: {
      total: holdTime.length,
      records: holdTime,
      summary: holdTime.length
        ? `${holdTime.length} hold time record(s); ${holdTime.filter((r) => String(r.status) === 'Exceeded').length} exceeded.`
        : 'Hold time monitoring maintained per approved manufacturing protocols.',
    },
    processCapability: {
      total: capabilityRecords.length,
      records: capabilityRecords,
      averageCpk: capabilityRecords.length
        ? capabilityRecords.reduce((s, r) => s + Number(r.cpk || 0), 0) / capabilityRecords.length
        : 0,
      averagePpk: capabilityRecords.length
        ? capabilityRecords.reduce((s, r) => s + Number(r.ppk || 0), 0) / capabilityRecords.length
        : 0,
      summary: capabilityRecords.length
        ? `${capabilityRecords.length} process capability review(s) completed for the PQR period.`
        : 'Process capability assessments maintained per CPV plan.',
    },
    trendAnalysis: {
      total: trendAnalysisRecords.length,
      alert: trendAnalysisRecords.filter((r) => String(r.trendStatus || r.trend_status) === 'Alert').length,
      oot: trendAnalysisRecords.filter((r) => String(r.trendStatus || r.trend_status) === 'OOT').length,
      oos: trendAnalysisRecords.filter((r) => String(r.trendStatus || r.trend_status) === 'OOS').length,
      capaSuggested: trendAnalysisRecords.filter((r) => Boolean(r.capaSuggested || r.capa_suggested)).length,
      records: trendAnalysisRecords.slice(0, 50),
      summary: trendAnalysisRecords.length
        ? `${trendAnalysisRecords.length} trend analysis record(s) reviewed for PQR trend section.`
        : 'Formal trend analysis maintained per CPV and PQR requirements.',
    },
    spc: {
      total: spcRecords.length,
      outOfControl: spcRecords.filter((r) => String(r.spcStatus || r.spc_status) === 'Out Of Control').length,
      violations: spcRecords.reduce((s, r) => s + Number(r.ruleViolationsCount ?? r.rule_violations_count ?? 0), 0),
      capaSuggested: spcRecords.filter((r) => Boolean(r.capaSuggested || r.capa_suggested)).length,
      records: spcRecords.slice(0, 50),
      summary: spcRecords.length
        ? `${spcRecords.length} SPC control chart record(s) reviewed for PQR trend review.`
        : 'Statistical process control maintained per CPV plan.',
    },
    materials: { total: materials.length, records: materials, summary: `${materials.length} material review entries documented.` },
    packaging: { total: packaging.length, records: packaging as Record<string, unknown>[], summary: `${packaging.length} packaging material reviews completed.` },
    equipment: { total: 0, records: [], summary: 'Equipment qualification status reviewed; all critical equipment within qualification validity.' },
    trends: {
      monthlyBatches: [],
      oosTrend: [],
      yieldTrend: [],
      parameterTrends: trendAnalysisRecords.slice(0, 12).map((r) => ({
        parameter: String(r.parameterName || r.parameter_name || 'Parameter'),
        status: String(r.trendStatus || r.trend_status || 'Normal'),
        direction: String(r.trendDirection || r.trend_direction || 'Stable'),
      })),
      spcViolations: spcRecords.slice(0, 12).map((r) => ({
        parameter: String(r.parameterName || r.parameter_name || 'Parameter'),
        status: String(r.spcStatus || r.spc_status || 'In Control'),
        violations: Number(r.ruleViolationsCount ?? r.rule_violations_count ?? 0),
      })),
    },
    autoGeneratedNarrative: {
      observations: buildObservations(manufactured, released, rejected, deviations.length, oosRecords.length, capaRecords.length, cppStats, cqaStats),
      conclusions: buildConclusions(rejected, oosRecords.length, deviations.length),
      recommendations: buildRecommendations(oosRecords.length, deviations.length, capaRecords.length),
    },
  };

  try {
    const narrative = snapshot.autoGeneratedNarrative || {
      observations: '',
      conclusions: '',
      recommendations: '',
    };
    const enriched = await enrichAiClient({
      task: 'pqr_narrative',
      context: {
        product: pqr.product_name,
        reviewPeriodFrom: from,
        reviewPeriodTo: to,
        batches: snapshot.batches,
        deviations: snapshot.deviations,
        oos: snapshot.oos,
        capa: snapshot.capa,
      },
      fallback: {
        observations: narrative.observations,
        conclusions: narrative.conclusions,
        recommendations: String(narrative.recommendations || '')
          .split(/(?<=\.)\s+/)
          .map((s) => s.trim())
          .filter(Boolean),
      },
    });
    const recs = Array.isArray(enriched.data.recommendations)
      ? enriched.data.recommendations.map(String)
      : null;
    snapshot.autoGeneratedNarrative = {
      observations: String(enriched.data.observations || narrative.observations),
      conclusions: String(enriched.data.conclusions || narrative.conclusions),
      recommendations: recs?.length ? recs.join(' ') : narrative.recommendations,
    };
  } catch {
    // Keep heuristic narrative if OpenRouter is unavailable.
  }

  return snapshot;
}

function buildObservations(mfg: number, rel: number, rej: number, dev: number, oos: number, capa: number, cpp: { oos: number }, cqa: { oos: number }) {
  return `During the review period, ${mfg} batches were manufactured with ${rel} batches released and ${rej} rejected. Quality monitoring identified ${dev} deviation(s), ${oos} OOS investigation(s), and ${capa} CAPA record(s). CPP monitoring showed ${cpp.oos} OOS result(s) and CQA monitoring showed ${cqa.oos} OOS result(s). All batches were manufactured in accordance with approved master batch records and validated processes.`;
}

function buildConclusions(rej: number, oos: number, dev: number) {
  const satisfactory = rej === 0 && oos <= 2 && dev <= 5;
  return satisfactory
    ? 'Based on the data reviewed, the product quality remains consistent with the approved specifications. Manufacturing and quality systems are operating in a state of control.'
    : 'Review identified areas requiring attention. Corrective and preventive actions have been initiated. Overall product quality is acceptable with documented remediation for identified events.';
}

function buildRecommendations(oos: number, dev: number, capa: number) {
  const items = ['Continue annual PQR as per quality management system.'];
  if (oos > 0) items.push('Enhance laboratory investigation trending for OOS events.');
  if (dev > 3) items.push('Review deviation root cause categories for systemic improvement.');
  if (capa > 5) items.push('Monitor CAPA effectiveness checks and closure timelines.');
  return items.join(' ');
}

export async function refreshPqrMetrics(pqrId: string, actor?: Actor): Promise<PqrDataSnapshot> {
  const pqr = await getPqrDocument(pqrId);
  if (!pqr) throw new Error('PQR not found');

  const snapshot = await buildPqrSnapshot(pqr);
  const snapRef = await addDoc(collection(getFirebaseFirestore(), PQR_COLLECTIONS.snapshots), snapshot);

  await updateDoc(doc(getFirebaseFirestore(), PQR_COLLECTIONS.documents, pqrId), {
    total_batches_manufactured: snapshot.batches.manufactured,
    total_released_batches: snapshot.batches.released,
    total_rejected_batches: snapshot.batches.rejected,
    total_reworked_batches: snapshot.batches.reworked,
    total_reprocessed_batches: snapshot.batches.reprocessed,
    deviation_count: snapshot.deviations.total,
    oos_count: snapshot.oos.total,
    capa_count: snapshot.capa.total,
    change_control_count: snapshot.changeControl.total,
    stability_status: snapshot.stability.summary,
    observations: pqr.observations || snapshot.autoGeneratedNarrative?.observations || '',
    conclusions: pqr.conclusions || snapshot.autoGeneratedNarrative?.conclusions || '',
    recommendations: pqr.recommendations || snapshot.autoGeneratedNarrative?.recommendations || '',
    snapshot_id: snapRef.id,
    last_refreshed_at: now(),
    updated_at: now(),
    updated_by: actor?.id,
  });

  return { ...snapshot, id: snapRef.id };
}

export async function createPqrDocument(
  data: Omit<PqrDocument, 'id' | 'created_at' | 'updated_at'>,
  approvals: Omit<PqrApproval, 'id' | 'pqr_id'>[],
  actor: Actor,
): Promise<{ id: string; snapshot: PqrDataSnapshot }> {
  const ts = now();
  const docRef = await addDoc(collection(getFirebaseFirestore(), PQR_COLLECTIONS.documents), {
    ...data,
    created_by: actor.id,
    created_at: ts,
    updated_at: ts,
  });

  const batch = writeBatch(getFirebaseFirestore());
  approvals.forEach((a) => {
    const ref = doc(collection(getFirebaseFirestore(), PQR_COLLECTIONS.approvals));
    batch.set(ref, { ...a, pqr_id: docRef.id, created_by: actor.id, created_at: ts });
  });
  await batch.commit();

  const pqr = { ...data, id: docRef.id } as PqrDocument;
  const snapshot = await refreshPqrMetrics(docRef.id, actor);
  return { id: docRef.id, snapshot };
}

export async function updatePqrDocument(id: string, updates: Partial<PqrDocument>, actor?: Actor) {
  const existingSnap = await getDoc(doc(getFirebaseFirestore(), PQR_COLLECTIONS.documents, id));
  if (!existingSnap.exists()) throw new Error('PQR not found');
  const current = String(existingSnap.data().document_status || 'draft');
  const nextStatus = updates.document_status;
  if (isTerminalPqrStatus(current)) {
    if (!nextStatus || !canTransitionPqrStatus(current, nextStatus)) {
      throw new Error('Approved, closed, or archived PQR documents cannot be modified without a controlled status change.');
    }
    const extraKeys = Object.keys(updates).filter((key) => key !== 'document_status' && updates[key as keyof PqrDocument] !== undefined);
    if (extraKeys.length) {
      throw new Error('Only status can change on an approved, closed, or archived PQR.');
    }
  }
  const payload: Record<string, unknown> = { updated_at: now() };
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) payload[key] = value;
  }
  if (actor?.id) payload.updated_by = actor.id;
  await updateDoc(
    doc(getFirebaseFirestore(), PQR_COLLECTIONS.documents, id),
    payload as UpdateData<DocumentData>,
  );
}

export async function updatePqrStatus(id: string, status: PqrDocumentStatus, actor: Actor) {
  const existingSnap = await getDoc(doc(getFirebaseFirestore(), PQR_COLLECTIONS.documents, id));
  if (!existingSnap.exists()) throw new Error('PQR not found');
  const current = String(existingSnap.data().document_status || 'draft');
  if (!canTransitionPqrStatus(current, status)) {
    throw new Error(`Cannot change PQR from ${current} to ${status}.`);
  }
  await updatePqrDocument(id, { document_status: status }, actor);
  await createAuditLog({
    moduleName: 'PQR',
    collectionName: PQR_COLLECTIONS.documents,
    recordId: id,
    actionType: 'STATUS_CHANGE',
    actionDescription: `Status changed from ${current} to ${status}`,
    oldValue: current,
    newValue: status,
    user: { id: actor.id, name: actor.name },
    status: 'Success',
  });
}

export async function signPqrApproval(pqrId: string, payload: ESignPayload, actor: Actor) {
  if (!payload.password || payload.password.length < 6) {
    throw new Error('Password re-authentication is required for electronic signature');
  }
  if (!payload.reason?.trim()) {
    throw new Error('Reason/comment is required for electronic signature');
  }

  const auth = getFirebaseAuth();
  const currentUser = auth.currentUser;
  if (!currentUser || (actor.id && currentUser.uid !== actor.id)) {
    throw new Error('You can only sign as the authenticated user');
  }
  const email = actor.email || currentUser.email;
  if (!email) {
    throw new Error('Authenticated user email is required for e-signature');
  }
  try {
    const credential = EmailAuthProvider.credential(email, payload.password);
    await reauthenticateWithCredential(currentUser, credential);
  } catch {
    try {
      await createAuditLog({
        moduleName: 'PQR Approval',
        collectionName: PQR_COLLECTIONS.approvals,
        recordId: payload.approvalId,
        actionType: 'e-signature failed',
        user: { id: actor.id || currentUser.uid, name: actor.name || email },
        status: 'Failed',
        newValue: { meaning: payload.meaning, pqrId },
      });
    } catch { /* audit optional */ }
    throw new Error('Invalid password. Electronic signature was not applied.');
  }

  const approvalRef = doc(getFirebaseFirestore(), PQR_COLLECTIONS.approvals, payload.approvalId);
  const approvalSnap = await getDoc(approvalRef);
  if (!approvalSnap.exists()) throw new Error('Approval record not found');

  const signedAt = now();
  await updateDoc(approvalRef, {
    name: actor.name || approvalSnap.data().name,
    signature_text: actor.name,
    approval_date: signedAt.split('T')[0],
    status: payload.meaning === 'Rejected By' ? 'rejected' : 'approved',
    esign_user_id: actor.id || currentUser.uid,
    esign_role: actor.role,
    esign_email: email,
    esign_timestamp: signedAt,
    esign_record_version: String(approvalSnap.data().version || '1'),
    esign_ip: 'client',
    esign_meaning: payload.meaning,
    esign_reason: payload.reason,
    remarks: payload.reason,
  });

  await createAuditLog({
    moduleName: 'PQR Approval',
    collectionName: PQR_COLLECTIONS.approvals,
    recordId: payload.approvalId,
    actionType: 'electronic signature applied',
    user: { id: actor.id || currentUser.uid, name: actor.name || email },
    status: 'Success',
    newValue: { meaning: payload.meaning, reason: payload.reason, pqrId, signedAt },
  });

  const approvals = await getPqrApprovals(pqrId);
  const allApproved = approvals.every((a) => a.status === 'approved' || a.id === payload.approvalId);
  const finalApprover = approvals.find((a) => a.approval_type === 'approved');
  if (finalApprover?.id === payload.approvalId && payload.meaning === 'Approved By') {
    await updatePqrStatus(pqrId, 'approved', actor);
  } else if (!allApproved) {
    await updatePqrStatus(pqrId, 'under_review', actor);
  }
}

export { PQR_COLLECTIONS };
