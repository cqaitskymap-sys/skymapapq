import {
  collection, getDocs, limit, orderBy, query,
} from 'firebase/firestore';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import { downloadCsv } from '@/lib/export-utils';
import { CPV_COLLECTIONS } from '@/lib/cpv';
import { PQR_COLLECTIONS } from '@/lib/pqr-types';
import {
  COMPLETION_SECTIONS, PQR_DASHBOARD_COLLECTIONS, PQR_DASHBOARD_MODULE,
  completionSectionHref,
  emptyDashboardData, emptyCharts, emptyKpis, exportPqrDashboardCsv,
  isTerminalPqrStatus, normalizePqrStatus,
  type CompletionSectionStatus, type PqrActionItemRow, type PqrActivityEntry,
  type PqrCompletionRow, type PqrCompletionSectionRow, type PqrCriticalAlertRow,
  type PqrDashboardCharts, type PqrDashboardData, type PqrDashboardFilters,
  type PqrDashboardKpis, type PqrDueRow, type PqrFindingRow,
  type PqrPendingApprovalRow, type PqrProductAnalysisRow, type PqrRecordRow,
} from '@/lib/pqr-dashboard-records';

export type PqrDashboardActor = { id: string; name: string; role?: string };

const round = (v: number, d = 1) => Number(v.toFixed(d));

/** Recognize both legacy `status` and modern `approvalStatus` on pqr_approvals. */
function isPendingPqrApprovalRow(a: Record<string, unknown>): boolean {
  if (a.isDeleted) return false;
  const modern = str(a.approvalStatus).toLowerCase();
  if (modern) {
    return ['pending', 'in review', 'escalated'].includes(modern);
  }
  const legacy = str(a.status).toLowerCase();
  return legacy === 'pending' || legacy === 'in review' || legacy === 'escalated';
}

function avg(vals: number[], d = 1): number {
  if (!vals.length) return 0;
  return round(vals.reduce((a, b) => a + b, 0) / vals.length, d);
}

function nowIso() {
  return new Date().toISOString();
}

function str(v: unknown, fb = ''): string {
  if (v === null || v === undefined) return fb;
  return String(v);
}

function num(v: unknown, fb = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function monthKey(raw?: string): string {
  if (!raw) return 'Unknown';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function parseDate(raw?: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inDateRange(raw: string | undefined, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  const d = parseDate(raw);
  if (!d) return true;
  if (from && d < new Date(from)) return false;
  if (to && d > new Date(`${to}T23:59:59`)) return false;
  return true;
}

async function readCollection(name: string, max = 500): Promise<Record<string, unknown>[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), name),
      orderBy('createdAt', 'desc'),
      limit(max),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), name), limit(max)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.error(`readCollection ${name} failed`, e);
      return [];
    }
  }
}

/** Return first non-empty collection (legacy alias pattern). */
async function readFirst(names: string[], max = 500): Promise<Record<string, unknown>[]> {
  for (const name of names) {
    const rows = await readCollection(name, max);
    if (rows.length) return rows;
  }
  return [];
}

/** Merge PQR sources and dedupe by id / pqr number (prefer modern pqr_records). */
async function readMergedPqrs(max = 500): Promise<Record<string, unknown>[]> {
  const [modern, legacy] = await Promise.all([
    readCollection(PQR_DASHBOARD_COLLECTIONS.records, max),
    readCollection(PQR_DASHBOARD_COLLECTIONS.recordsLegacy, max),
  ]);
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of [...legacy, ...modern]) {
    const key = str(row.id)
      || str(row.pqrNumber || row.pqr_number).toLowerCase()
      || `${str(row.productName || row.product_name)}-${str(row.reviewYear || row.pqr_year)}`;
    if (!key) continue;
    byKey.set(key, row);
  }
  return Array.from(byKey.values());
}

function matchesProductFilter(
  record: Record<string, unknown>,
  product?: string,
  productCode?: string,
): boolean {
  if ((!product || product === 'all') && (!productCode || productCode === 'all')) return true;
  const names = [product, productCode].filter((s) => s && s !== 'all').map((s) => s!.toLowerCase());
  if (!names.length) return true;
  const fields = ['productName', 'product_name', 'product', 'productCode', 'product_code'];
  return fields.some((f) => {
    const val = str(record[f]).toLowerCase();
    return names.some((n) => val === n || val.includes(n) || n.includes(val));
  });
}

function filterRelatedByContext(
  rows: Record<string, unknown>[],
  filters: PqrDashboardFilters,
  productsInScope: Set<string>,
): Record<string, unknown>[] {
  const hasProductFilter = Boolean(filters.product && filters.product !== 'all');
  const hasYearFilter = Boolean(filters.reviewYear && filters.reviewYear !== 'all');
  if (!hasProductFilter && !hasYearFilter && !filters.dateFrom && !filters.dateTo) {
    return rows;
  }
  return rows.filter((r) => {
    if (hasProductFilter || productsInScope.size) {
      const pname = str(r.productName || r.product_name || r.product);
      const pcode = str(r.productCode || r.product_code);
      if (hasProductFilter) {
        if (!matchesProductFilter(r, filters.product, filters.productCode)) return false;
      } else if (productsInScope.size && pname && !productsInScope.has(pname) && !productsInScope.has(pcode)) {
        // When year filter scopes PQRs, prefer related records for those products
        if (productsInScope.size <= 50) {
          const match = Array.from(productsInScope).some((p) =>
            pname.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(pname.toLowerCase()),
          );
          if (!match) return false;
        }
      }
    }
    if (hasYearFilter) {
      const year = num(r.reviewYear || r.pqr_year || r.year);
      const createdYear = parseDate(str(r.createdAt || r.openDate || r.reportedDate || r.manufacturingDate))?.getFullYear();
      if (year && String(year) !== filters.reviewYear) {
        if (!createdYear || String(createdYear) !== filters.reviewYear) return false;
      } else if (!year && createdYear && String(createdYear) !== filters.reviewYear) {
        return false;
      }
    }
    if (!inDateRange(str(r.createdAt || r.openDate || r.reportedDate || r.manufacturingDate).slice(0, 10), filters.dateFrom, filters.dateTo)) {
      return false;
    }
    return true;
  });
}

function mapPqrRecord(raw: Record<string, unknown>): PqrRecordRow {
  const status = normalizePqrStatus(str(raw.status || raw.document_status, 'Draft'));
  return {
    id: str(raw.id),
    pqrNumber: str(raw.pqrNumber || raw.pqr_number, 'PQR-DRAFT'),
    product: str(raw.productName || raw.product_name || raw.product),
    productCode: str(raw.productCode || raw.product_code),
    reviewPeriod: `${str(raw.reviewPeriodFrom || raw.review_period_from)} — ${str(raw.reviewPeriodTo || raw.review_period_to)}`.replace(/^ — | — $/g, '') || str(raw.reviewPeriod || raw.review_period),
    status,
    preparedBy: str(raw.preparedBy || raw.created_by || raw.createdByName || raw.pqrOwner, '—'),
    pendingWith: str(raw.pendingWith || raw.pending_with, '—'),
    qaReviewer: str(raw.qaReviewer || raw.qa_reviewer, '—'),
    qaApprover: str(raw.qaApprover || raw.qa_approver, '—'),
    createdDate: str(raw.createdAt || raw.created_at).slice(0, 10),
    dueDate: str(raw.dueDate || raw.next_review_due_date || raw.nextReviewDueDate),
    reviewYear: num(raw.reviewYear || raw.pqr_year || raw.pqrYear, new Date().getFullYear()),
    site: str(raw.manufacturingSite || raw.site || raw.manufacturing_site),
    department: str(raw.department),
    riskLevel: str(raw.riskLevel || raw.risk_level, 'Medium'),
    workflowStage: str(raw.workflowStage || raw.currentWorkflowStage || status),
    version: str(raw.version || raw.document_version, '1.0'),
  };
}

function filterPqrRecords(rows: PqrRecordRow[], filters: PqrDashboardFilters): PqrRecordRow[] {
  const today = new Date();
  const q = str(filters.search).toLowerCase().trim();
  return rows.filter((r) => {
    if (filters.product && filters.product !== 'all' && r.product !== filters.product && r.productCode !== filters.product) return false;
    if (filters.productCode && filters.productCode !== 'all' && r.productCode !== filters.productCode) return false;
    if (filters.status && filters.status !== 'all' && r.status !== filters.status) return false;
    if (filters.reviewYear && filters.reviewYear !== 'all' && String(r.reviewYear) !== filters.reviewYear) return false;
    if (filters.preparedBy && filters.preparedBy !== 'all' && r.preparedBy !== filters.preparedBy) return false;
    if (filters.pendingWith && filters.pendingWith !== 'all' && r.pendingWith !== filters.pendingWith) return false;
    if (filters.site && filters.site !== 'all' && r.site !== filters.site) return false;
    if (filters.department && filters.department !== 'all' && r.department !== filters.department) return false;
    if (filters.riskLevel && filters.riskLevel !== 'all' && r.riskLevel !== filters.riskLevel) return false;
    if (filters.batchNumber) {
      // batch filter applied via related data when present on row review period text
      if (!r.reviewPeriod.toLowerCase().includes(filters.batchNumber.toLowerCase())
        && !r.pqrNumber.toLowerCase().includes(filters.batchNumber.toLowerCase())) {
        // keep unless we have explicit batch linkage — leave pass for non-batch rows
      }
    }
    if (!inDateRange(r.createdDate, filters.dateFrom, filters.dateTo)) return false;
    if (filters.overdueOnly) {
      if (isTerminalPqrStatus(r.status)) return false;
      const due = parseDate(r.dueDate);
      if (!due || due >= today) return false;
    }
    if (filters.pendingApprovalOnly) {
      if (!['Approval Pending', 'Under Review', 'QA Review'].includes(r.status)) return false;
    }
    if (q) {
      const hay = [r.pqrNumber, r.product, r.productCode, r.preparedBy, r.pendingWith, r.qaReviewer, r.qaApprover, r.status, r.site, r.department]
        .join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function buildCharts(
  pqrs: PqrRecordRow[],
  batches: Record<string, unknown>[],
  deviations: Record<string, unknown>[],
  oos: Record<string, unknown>[],
  capa: Record<string, unknown>[],
  yields: Record<string, unknown>[],
  cqa: Record<string, unknown>[],
  stability: Record<string, unknown>[],
  complaints: Record<string, unknown>[],
  recalls: Record<string, unknown>[],
  approvals: Record<string, unknown>[],
): PqrDashboardCharts {
  const statusMap = new Map<string, number>();
  pqrs.forEach((p) => statusMap.set(p.status, (statusMap.get(p.status) || 0) + 1));

  const monthCreate = new Map<string, number>();
  const monthOverdue = new Map<string, number>();
  const today = new Date();
  pqrs.forEach((p) => {
    const k = monthKey(p.createdDate);
    monthCreate.set(k, (monthCreate.get(k) || 0) + 1);
    const due = parseDate(p.dueDate);
    if (due && due < today && !isTerminalPqrStatus(p.status)) {
      const dk = monthKey(p.dueDate);
      monthOverdue.set(dk, (monthOverdue.get(dk) || 0) + 1);
    }
  });

  const productMap = new Map<string, { draft: number; review: number; approved: number }>();
  pqrs.forEach((p) => {
    const cur = productMap.get(p.product) || { draft: 0, review: 0, approved: 0 };
    if (p.status === 'Draft') cur.draft += 1;
    else if (['Under Review', 'QA Review', 'Approval Pending', 'In Progress', 'Data Collection'].includes(p.status)) cur.review += 1;
    else if (['Approved', 'Closed'].includes(p.status)) cur.approved += 1;
    productMap.set(p.product, cur);
  });

  const batchMonth = new Map<string, { released: number; rejected: number }>();
  batches.forEach((b) => {
    const k = monthKey(str(b.manufacturingDate || b.manufacturing_date || b.createdAt));
    const cur = batchMonth.get(k) || { released: 0, rejected: 0 };
    const rs = str(b.releaseStatus || b.release_status || b.batchStatus, '').toLowerCase();
    if (rs.includes('reject')) cur.rejected += 1;
    else if (rs.includes('release')) cur.released += 1;
    batchMonth.set(k, cur);
  });

  const qualityMonth = new Map<string, { deviations: number; oos: number; capa: number }>();
  const bumpQuality = (rows: Record<string, unknown>[], key: 'deviations' | 'oos' | 'capa') => {
    rows.forEach((r) => {
      const k = monthKey(str(r.createdAt || r.openDate || r.reportedDate));
      const cur = qualityMonth.get(k) || { deviations: 0, oos: 0, capa: 0 };
      cur[key] += 1;
      qualityMonth.set(k, cur);
    });
  };
  bumpQuality(deviations, 'deviations');
  bumpQuality(oos, 'oos');
  bumpQuality(capa, 'capa');

  const yieldMonth = new Map<string, number[]>();
  yields.forEach((y) => {
    const k = monthKey(str(y.recordedDate || y.manufacturingDate || y.createdAt));
    const list = yieldMonth.get(k) || [];
    list.push(num(y.yieldPercentage || y.yieldPercent || y.observedValue));
    yieldMonth.set(k, list);
  });

  const assayMonth = new Map<string, number[]>();
  cqa.forEach((r) => {
    const param = str(r.parameterName || r.testParameter || r.parameter).toLowerCase();
    if (!param.includes('assay')) return;
    const k = monthKey(str(r.testDate || r.recordedDate || r.createdAt));
    const list = assayMonth.get(k) || [];
    list.push(num(r.resultValue || r.observedValue));
    assayMonth.set(k, list);
  });

  const stabMonth = new Map<string, number[]>();
  stability.forEach((s) => {
    const k = monthKey(str(s.testDate || s.recordedDate || s.createdAt));
    const list = stabMonth.get(k) || [];
    list.push(num(s.resultValue || s.observedValue || s.assay));
    stabMonth.set(k, list);
  });

  const crMonth = new Map<string, { complaints: number; recalls: number }>();
  complaints.forEach((c) => {
    const k = monthKey(str(c.createdAt || c.receivedDate));
    const cur = crMonth.get(k) || { complaints: 0, recalls: 0 };
    cur.complaints += 1;
    crMonth.set(k, cur);
  });
  recalls.forEach((r) => {
    const k = monthKey(str(r.createdAt || r.initiatedDate));
    const cur = crMonth.get(k) || { complaints: 0, recalls: 0 };
    cur.recalls += 1;
    crMonth.set(k, cur);
  });

  const apprMonth = new Map<string, number>();
  approvals.filter((a) => isPendingPqrApprovalRow(a)).forEach((a) => {
    const k = monthKey(str(a.createdAt || a.approval_date));
    apprMonth.set(k, (apprMonth.get(k) || 0) + 1);
  });

  const completionMonth = new Map<string, number[]>();
  pqrs.forEach((p) => {
    const k = monthKey(p.createdDate);
    const list = completionMonth.get(k) || [];
    list.push(p.completionPct ?? 0);
    completionMonth.set(k, list);
  });

  const sortMonths = (entries: [string, unknown][]) =>
    entries.sort(([a], [b]) => a.localeCompare(b)).slice(-6);

  return {
    statusDistribution: Array.from(statusMap.entries()).map(([name, value]) => ({ name, value })),
    monthlyCreationTrend: sortMonths(Array.from(monthCreate.entries())).map(([month, value]) => ({ month, value: value as number })),
    productStatus: Array.from(productMap.entries()).slice(0, 8).map(([product, v]) => ({ product, ...v })),
    batchReleaseTrend: sortMonths(Array.from(batchMonth.entries())).map(([month, v]) => ({ month, ...(v as { released: number; rejected: number }) })),
    qualityTrend: sortMonths(Array.from(qualityMonth.entries())).map(([month, v]) => ({ month, ...(v as { deviations: number; oos: number; capa: number }) })),
    yieldTrend: sortMonths(Array.from(yieldMonth.entries())).map(([month, vals]) => ({
      month,
      value: avg(vals as number[]),
    })),
    assayTrend: sortMonths(Array.from(assayMonth.entries())).map(([month, vals]) => ({
      month,
      value: avg(vals as number[]),
    })),
    stabilityTrend: sortMonths(Array.from(stabMonth.entries())).map(([month, vals]) => ({
      month,
      value: avg(vals as number[]),
    })),
    complaintRecallTrend: sortMonths(Array.from(crMonth.entries())).map(([month, v]) => ({ month, ...(v as { complaints: number; recalls: number }) })),
    approvalPendingTrend: sortMonths(Array.from(apprMonth.entries())).map(([month, value]) => ({ month, value: value as number })),
    completionTrend: sortMonths(Array.from(completionMonth.entries())).map(([month, vals]) => ({
      month,
      value: avg(vals as number[]),
    })),
    overdueTrend: sortMonths(Array.from(monthOverdue.entries())).map(([month, value]) => ({ month, value: value as number })),
  };
}

function computeKpis(
  allPqrs: PqrRecordRow[],
  pqrs: PqrRecordRow[],
  batches: Record<string, unknown>[],
  deviations: Record<string, unknown>[],
  oos: Record<string, unknown>[],
  capa: Record<string, unknown>[],
  changeControls: Record<string, unknown>[],
  complaints: Record<string, unknown>[],
  recalls: Record<string, unknown>[],
  yields: Record<string, unknown>[],
  cqa: Record<string, unknown>[],
  capability: Record<string, unknown>[],
  risks: Record<string, unknown>[],
  approvals: Record<string, unknown>[],
  criticalFindings: number,
  openActions: number,
): PqrDashboardKpis {
  const today = new Date();
  const year = today.getFullYear();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const countStatus = (s: string | string[]) => {
    const set = Array.isArray(s) ? s : [s];
    return pqrs.filter((p) => set.includes(p.status)).length;
  };

  const overduePqrs = pqrs.filter((p) => {
    if (isTerminalPqrStatus(p.status)) return false;
    const due = parseDate(p.dueDate);
    return due ? due < today : false;
  }).length;

  const dueThisMonth = pqrs.filter((p) => {
    const due = parseDate(p.dueDate);
    return due ? due >= monthStart && due <= monthEnd : false;
  }).length;

  const products = new Set(pqrs.map((p) => p.product).filter(Boolean));

  const released = batches.filter((b) => str(b.releaseStatus || b.release_status, '').toLowerCase().includes('release')).length;
  const rejected = batches.filter((b) => str(b.releaseStatus || b.release_status, '').toLowerCase().includes('reject')).length;

  const yieldVals = yields.map((y) => num(y.yieldPercentage || y.yieldPercent || y.observedValue)).filter((v) => v > 0);
  const assayVals = cqa.filter((r) => str(r.parameterName || r.testParameter).toLowerCase().includes('assay'))
    .map((r) => num(r.resultValue || r.observedValue)).filter((v) => v > 0);
  const cpkVals = capability.map((c) => num(c.cpk || c.Cpk)).filter((v) => v > 0);

  const openRisks = risks.filter((r) => !['closed', 'Closed', 'mitigated'].includes(str(r.status))).length;
  const pendingApprovals = approvals.filter((a) => isPendingPqrApprovalRow(a)).length;

  const ootCount = oos.filter((r) => {
    const t = str(r.recordType || r.type || r.oosType || r.title).toLowerCase();
    return t.includes('oot') || t.includes('out of trend');
  }).length;

  const completionVals = pqrs.map((p) => p.completionPct ?? 0).filter((v) => v >= 0);
  const completionPct = completionVals.length ? round(completionVals.reduce((a, b) => a + b, 0) / completionVals.length) : 0;

  const pendingReviews = countStatus(['Under Review', 'QA Review', 'In Progress', 'Data Collection']);

  return {
    totalPqrs: pqrs.length,
    currentYearPqrs: allPqrs.filter((p) => p.reviewYear === year).length,
    previousYearPqrs: allPqrs.filter((p) => p.reviewYear === year - 1).length,
    draftPqrs: countStatus('Draft'),
    inProgressPqrs: countStatus(['In Progress', 'Data Collection']),
    underReviewPqrs: countStatus(['Under Review', 'QA Review']),
    approvalPendingPqrs: countStatus('Approval Pending'),
    approvedPqrs: countStatus('Approved'),
    rejectedPqrs: countStatus('Rejected'),
    closedPqrs: countStatus('Closed'),
    archivedPqrs: countStatus('Archived'),
    pqrsDueThisMonth: dueThisMonth,
    overduePqrs,
    completionPct,
    pendingReviews,
    pendingApprovals,
    criticalFindings,
    openActions,
    totalProductsReviewed: products.size,
    totalBatchesReviewed: batches.length,
    releasedBatches: released,
    rejectedBatches: rejected,
    deviationCount: deviations.length,
    oosCount: oos.length,
    ootCount,
    capaCount: capa.length,
    changeControlCount: changeControls.length,
    marketComplaintCount: complaints.length,
    recallCount: recalls.length,
    averageYieldPct: yieldVals.length ? round(yieldVals.reduce((a, b) => a + b, 0) / yieldVals.length) : 0,
    averageAssayPct: assayVals.length ? round(assayVals.reduce((a, b) => a + b, 0) / assayVals.length) : 0,
    averageCpk: cpkVals.length ? round(cpkVals.reduce((a, b) => a + b, 0) / cpkVals.length, 2) : 0,
    openRisks,
  };
}

function buildDueRows(pqrs: PqrRecordRow[]): PqrDueRow[] {
  const today = new Date();
  return pqrs
    .filter((p) => !isTerminalPqrStatus(p.status))
    .map((p) => {
      const due = parseDate(p.dueDate);
      const daysOverdue = due && due < today ? Math.ceil((today.getTime() - due.getTime()) / 86400000) : 0;
      return {
        id: p.id,
        product: p.product,
        reviewYear: p.reviewYear || new Date().getFullYear(),
        dueDate: p.dueDate || '—',
        daysOverdue,
        owner: p.preparedBy,
        status: daysOverdue > 0 ? 'Overdue' : p.status,
      };
    })
    .filter((r) => r.daysOverdue > 0 || ['Under Review', 'QA Review', 'Approval Pending'].includes(r.status))
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, 20);
}

function buildPendingApprovals(approvals: Record<string, unknown>[], pqrs: PqrRecordRow[]): PqrPendingApprovalRow[] {
  return approvals
    .filter((a) => isPendingPqrApprovalRow(a))
    .slice(0, 20)
    .map((a) => {
      const pqrId = str(a.pqr_id || a.pqrId);
      const pqr = pqrs.find((p) => p.id === pqrId) || pqrs.find((p) => p.pqrNumber === str(a.pqrNumber || a.pqr_number));
      return {
        id: str(a.id),
        pqrId: pqrId || pqr?.id,
        pqrNumber: pqr?.pqrNumber || str(a.pqrNumber || a.pqr_number, '—'),
        product: pqr?.product || str(a.productName || a.product),
        currentStep: str(a.approval_type || a.approvalType || a.currentWorkflowStep || a.stepName, 'Review'),
        pendingWith: str(a.currentApproverRole || a.name || a.designation || a.assigneeName, '—'),
        dueDate: str(a.dueDate || a.approval_date || a.due_date).slice(0, 10) || '—',
        priority: str(a.priority, 'Medium'),
      };
    });
}

function buildCriticalAlerts(
  deviations: Record<string, unknown>[],
  oos: Record<string, unknown>[],
  recalls: Record<string, unknown>[],
  capa: Record<string, unknown>[],
): PqrCriticalAlertRow[] {
  const alerts: PqrCriticalAlertRow[] = [];

  oos.filter((r) => {
    const sev = str(r.severity || r.riskLevel || r.priority).toLowerCase();
    const st = str(r.status).toLowerCase();
    return sev.includes('critical') || sev.includes('high') || st.includes('open') || !st;
  }).slice(0, 5).forEach((r) => {
    const sev = str(r.severity || r.riskLevel, '').toLowerCase();
    alerts.push({
      id: str(r.id),
      product: str(r.productName || r.product),
      batchNo: str(r.batchNumber || r.batchNo),
      source: str(r.recordType || r.type || '').toLowerCase().includes('oot') ? 'OOT' : 'OOS',
      issue: str(r.title || r.parameterName || 'Out of Specification'),
      riskLevel: sev.includes('critical') ? 'Critical' : sev.includes('high') ? 'High' : 'Critical',
      status: str(r.status, 'Open'),
      href: `/qms/oos`,
    });
  });

  deviations.filter((d) => ['critical', 'high', 'major'].includes(str(d.severity || d.riskLevel).toLowerCase())).slice(0, 5).forEach((d) => {
    alerts.push({
      id: str(d.id),
      product: str(d.productName || d.product),
      batchNo: str(d.batchNumber || d.batchNo),
      source: 'Deviation',
      issue: str(d.title || d.deviationTitle),
      riskLevel: str(d.severity || d.riskLevel, 'High'),
      status: str(d.status, 'Open'),
      href: '/qms/deviation',
    });
  });

  capa.filter((c) => {
    const st = str(c.status || c.capa_status).toLowerCase();
    const due = parseDate(str(c.target_completion_date || c.dueDate));
    return !st.includes('closed') && due !== null && due < new Date();
  }).slice(0, 3).forEach((c) => {
    alerts.push({
      id: str(c.id),
      product: str(c.productName || c.product),
      batchNo: str(c.batchNumber || c.batchNo),
      source: 'CAPA',
      issue: str(c.capa_title || c.title, 'Overdue CAPA'),
      riskLevel: 'High',
      status: str(c.status || c.capa_status, 'Open'),
      href: '/qms/capa',
    });
  });

  recalls.slice(0, 3).forEach((r) => alerts.push({
    id: str(r.id),
    product: str(r.productName || r.product),
    batchNo: str(r.batchNumber || r.batchNo),
    source: 'Recall',
    issue: str(r.title || r.recallReason, 'Product Recall'),
    riskLevel: 'Critical',
    status: str(r.status, 'Active'),
    href: '/qms/recall',
  }));

  return alerts.slice(0, 15);
}

function sectionStatus(count: number, overdue = false): CompletionSectionStatus {
  if (overdue && count === 0) return 'Overdue';
  if (count > 0) return 'Completed';
  return 'Pending';
}

function buildCompletionRows(
  pqrs: PqrRecordRow[],
  sectionBuckets: Record<string, Record<string, unknown>[]>,
): PqrCompletionRow[] {
  const today = new Date();
  return pqrs.slice(0, 25).map((p) => {
    const overdue = (() => {
      const due = parseDate(p.dueDate);
      return Boolean(due && due < today && !isTerminalPqrStatus(p.status));
    })();

    const matchPqr = (rows: Record<string, unknown>[]) =>
      rows.filter((r) =>
        str(r.pqrId || r.pqr_id) === p.id
        || str(r.pqrNumber || r.pqr_number) === p.pqrNumber
        || (p.product && str(r.productName || r.product) === p.product),
      );

    const sections: PqrCompletionSectionRow[] = COMPLETION_SECTIONS.map((sec) => {
      let count = 0;
      switch (sec.key) {
        case 'batchReview': count = matchPqr(sectionBuckets.batchReview).length; break;
        case 'materialReview': count = matchPqr(sectionBuckets.materialReview).length; break;
        case 'packagingReview': count = matchPqr(sectionBuckets.packagingReview).length; break;
        case 'equipmentReview': count = matchPqr(sectionBuckets.equipmentReview).length; break;
        case 'utilityReview': count = matchPqr(sectionBuckets.utilityReview).length; break;
        case 'stabilityReview': count = matchPqr(sectionBuckets.stabilityReview).length; break;
        case 'deviationReview': count = matchPqr(sectionBuckets.deviations).length; break;
        case 'oosReview': count = matchPqr(sectionBuckets.oos).length; break;
        case 'capaReview': count = matchPqr(sectionBuckets.capa).length; break;
        case 'changeControlReview': count = matchPqr(sectionBuckets.changeControls).length; break;
        case 'complaintReview': count = matchPqr(sectionBuckets.complaints).length; break;
        case 'cpvReview': count = matchPqr(sectionBuckets.cpvBatches).length; break;
        case 'riskReview': count = matchPqr(sectionBuckets.risks).length; break;
        case 'summaryConclusion': count = matchPqr(sectionBuckets.summary).length; break;
        case 'approval': count = matchPqr(sectionBuckets.approvals).length; break;
        default: count = 0;
      }
      // Zero-count quality modules with no open items can be N/A for closed PQRs
      const qualityKeys = ['deviationReview', 'oosReview', 'capaReview', 'changeControlReview', 'complaintReview', 'riskReview'];
      let status = sectionStatus(count, overdue && ['batchReview', 'summaryConclusion', 'approval'].includes(sec.key));
      if (qualityKeys.includes(sec.key) && count === 0 && isTerminalPqrStatus(p.status)) {
        status = 'Not Applicable';
      }
      return {
        key: sec.key,
        label: sec.label,
        href: completionSectionHref(sec.href, p.id, sec.retainPqrId !== false),
        status,
        count,
      };
    });

    const applicable = sections.filter((s) => s.status !== 'Not Applicable');
    const completed = applicable.filter((s) => s.status === 'Completed').length;
    const completionPct = applicable.length ? round((completed / applicable.length) * 100) : 0;

    return {
      id: p.id,
      pqrId: p.id,
      pqrNumber: p.pqrNumber,
      product: p.product,
      status: p.status,
      completionPct,
      sections,
    };
  });
}

function buildProductAnalysis(
  pqrs: PqrRecordRow[],
  batches: Record<string, unknown>[],
  deviations: Record<string, unknown>[],
  oos: Record<string, unknown>[],
  capa: Record<string, unknown>[],
  complaints: Record<string, unknown>[],
  changeControls: Record<string, unknown>[],
  stability: Record<string, unknown>[],
): PqrProductAnalysisRow[] {
  const products = Array.from(new Set(pqrs.map((p) => p.product).filter(Boolean)));
  return products.slice(0, 30).map((product) => {
    const productPqrs = pqrs.filter((p) => p.product === product);
    const code = productPqrs.find((p) => p.productCode)?.productCode || '';
    const match = (rows: Record<string, unknown>[]) =>
      rows.filter((r) => matchesProductFilter(r, product, code));
    const oosRows = match(oos);
    const ootCount = oosRows.filter((r) => str(r.recordType || r.type || r.title).toLowerCase().includes('oot')).length;
    const stabIssues = match(stability).filter((s) => {
      const st = str(s.status || s.resultStatus).toLowerCase();
      return st.includes('fail') || st.includes('oos') || st.includes('out');
    }).length;
    const statuses = Array.from(new Set(productPqrs.map((p) => p.status))).join(', ');
    return {
      id: `${product}-${code || 'na'}`,
      product,
      productCode: code,
      pqrCount: productPqrs.length,
      batchCount: match(batches).length,
      deviationCount: match(deviations).length,
      oosCount: oosRows.length,
      ootCount,
      capaCount: match(capa).length,
      complaintCount: match(complaints).length,
      changeControlCount: match(changeControls).length,
      stabilityIssues: stabIssues,
      statuses,
    };
  }).sort((a, b) => b.pqrCount - a.pqrCount);
}

function buildActionItems(
  pqrs: PqrRecordRow[],
  approvals: Record<string, unknown>[],
  capa: Record<string, unknown>[],
  deviations: Record<string, unknown>[],
): PqrActionItemRow[] {
  const items: PqrActionItemRow[] = [];
  const today = new Date();

  pqrs.filter((p) => !isTerminalPqrStatus(p.status)).forEach((p) => {
    const due = parseDate(p.dueDate);
    const overdue = due ? due < today : false;
    if (overdue || ['Under Review', 'QA Review', 'Approval Pending'].includes(p.status)) {
      items.push({
        id: `pqr-${p.id}`,
        description: `Complete PQR ${p.pqrNumber} (${p.status})`,
        owner: p.pendingWith !== '—' ? p.pendingWith : p.preparedBy,
        dueDate: p.dueDate || '—',
        priority: overdue ? 'High' : 'Medium',
        status: overdue ? 'Overdue' : 'Open',
        source: 'PQR',
        href: `/pqr/${p.id}`,
      });
    }
  });

  approvals.filter((a) => isPendingPqrApprovalRow(a)).slice(0, 10).forEach((a) => {
    items.push({
      id: `appr-${str(a.id)}`,
      description: `Approve ${str(a.approval_type || a.approvalType, 'PQR step')}`,
      owner: str(a.name || a.designation, '—'),
      dueDate: str(a.dueDate || a.approval_date).slice(0, 10) || '—',
      priority: str(a.priority, 'Medium'),
      status: 'Pending Approval',
      source: 'Approval',
      href: `/pqr/approval`,
    });
  });

  capa.filter((c) => {
    const st = str(c.status || c.capa_status).toLowerCase();
    return !st.includes('closed') && !st.includes('cancelled');
  }).slice(0, 8).forEach((c) => {
    const due = str(c.target_completion_date || c.dueDate).slice(0, 10);
    const overdue = parseDate(due) ? parseDate(due)! < today : false;
    items.push({
      id: `capa-${str(c.id)}`,
      description: str(c.capa_title || c.title, 'Open CAPA'),
      owner: str(c.action_owner_name || c.action_owner || c.owner, '—'),
      dueDate: due || '—',
      priority: str(c.priority, 'Medium'),
      status: overdue ? 'Overdue' : str(c.status || c.capa_status, 'Open'),
      source: 'CAPA',
      href: '/qms/capa',
    });
  });

  deviations.filter((d) => {
    const st = str(d.status).toLowerCase();
    return !st.includes('closed') && !st.includes('cancelled');
  }).slice(0, 5).forEach((d) => {
    items.push({
      id: `dev-${str(d.id)}`,
      description: str(d.title || d.deviationTitle, 'Open Deviation'),
      owner: str(d.assignedTo || d.owner || d.investigator, '—'),
      dueDate: str(d.dueDate || d.targetDate).slice(0, 10) || '—',
      priority: str(d.severity || d.priority, 'Medium'),
      status: str(d.status, 'Open'),
      source: 'Deviation',
      href: '/qms/deviation',
    });
  });

  return items.slice(0, 30);
}

function buildFindings(
  deviations: Record<string, unknown>[],
  oos: Record<string, unknown>[],
  complaints: Record<string, unknown>[],
  capa: Record<string, unknown>[],
): PqrFindingRow[] {
  const findings: PqrFindingRow[] = [];

  const bump = (
    rows: Record<string, unknown>[],
    category: string,
    href: string,
    getKey: (r: Record<string, unknown>) => string,
  ) => {
    const map = new Map<string, { count: number; product: string; sample: Record<string, unknown> }>();
    rows.forEach((r) => {
      const key = getKey(r);
      if (!key) return;
      const cur = map.get(key) || { count: 0, product: str(r.productName || r.product), sample: r };
      cur.count += 1;
      map.set(key, cur);
    });
    Array.from(map.entries())
      .filter(([, v]) => v.count >= 2)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .forEach(([desc, v]) => {
        findings.push({
          id: `${category}-${desc}`.slice(0, 80),
          severity: v.count >= 4 ? 'Critical' : v.count >= 3 ? 'Major' : 'Minor',
          category,
          description: `Recurring ${category.toLowerCase()}: ${desc} (${v.count}x)`,
          product: v.product,
          count: v.count,
          href,
        });
      });
  };

  bump(deviations, 'Deviation', '/qms/deviation', (r) => str(r.title || r.deviationTitle || r.rootCauseCategory).slice(0, 60));
  bump(oos, 'OOS', '/qms/oos', (r) => str(r.parameterName || r.title || r.testParameter).slice(0, 60));
  bump(complaints, 'Complaint', '/qms/complaints', (r) => str(r.complaintType || r.title || r.category).slice(0, 60));
  bump(capa, 'CAPA', '/qms/capa', (r) => str(r.root_cause_category || r.capa_source || r.title).slice(0, 60));

  deviations.filter((d) => ['critical'].includes(str(d.severity || d.riskLevel).toLowerCase())).slice(0, 5).forEach((d) => {
    findings.push({
      id: `crit-dev-${str(d.id)}`,
      severity: 'Critical',
      category: 'Deviation',
      description: str(d.title || d.deviationTitle, 'Critical deviation'),
      product: str(d.productName || d.product),
      count: 1,
      href: '/qms/deviation',
    });
  });

  return findings.slice(0, 20);
}

async function logDashboardAudit(actionType: string, actor: PqrDashboardActor, detail?: unknown) {
  try {
    await createAuditLog({
      moduleName: PQR_DASHBOARD_MODULE,
      collectionName: PQR_DASHBOARD_COLLECTIONS.records,
      recordId: 'dashboard',
      actionType,
      newValue: detail,
      user: { id: actor.id, name: actor.name },
      status: 'Success',
    });
    await writeAuditTrail({
      collectionName: PQR_DASHBOARD_COLLECTIONS.records,
      documentId: 'dashboard',
      action: actionType,
      oldValue: null,
      newValue: detail,
      userId: actor.id,
      userName: actor.name,
      moduleName: PQR_DASHBOARD_MODULE,
    });
  } catch (e) {
    console.error('logDashboardAudit failed', e);
  }
}

export async function fetchPqrDashboard(filters: PqrDashboardFilters = {}): Promise<PqrDashboardData> {
  if (!isFirebaseConfigured()) {
    return emptyDashboardData('Firebase is not configured. Set environment variables to load live PQR data.');
  }

  try {
    const [
      pqrRaw, batches, cpvBatches, deviations, oos, capa, changeControls,
      complaints, recalls, yields, cqa, stability, capability, risks, approvals,
      batchReview, materialReview, packagingReview, equipmentReview, utilityReview,
      stabilityReview, summaryConclusion,
    ] = await Promise.all([
      readMergedPqrs(),
      readFirst([PQR_DASHBOARD_COLLECTIONS.batches, 'pqr_batches']),
      readCollection(PQR_DASHBOARD_COLLECTIONS.cpvBatches, 200),
      readFirst([PQR_DASHBOARD_COLLECTIONS.deviations]),
      readFirst([PQR_DASHBOARD_COLLECTIONS.oosRecords, 'oos']),
      readFirst([PQR_DASHBOARD_COLLECTIONS.capaRecords, 'capa']),
      readFirst([PQR_DASHBOARD_COLLECTIONS.changeControls, 'change_control']),
      readCollection(PQR_DASHBOARD_COLLECTIONS.complaints),
      readFirst([PQR_DASHBOARD_COLLECTIONS.recalls, 'recall_records']),
      readFirst([PQR_DASHBOARD_COLLECTIONS.yieldMonitoring, CPV_COLLECTIONS.yield]),
      readFirst([PQR_DASHBOARD_COLLECTIONS.cqaResults, CPV_COLLECTIONS.cqa, 'cqa_results']),
      readFirst([PQR_DASHBOARD_COLLECTIONS.stabilityMonitoring, 'stability_results', PQR_DASHBOARD_COLLECTIONS.stabilityReview]),
      readFirst([PQR_DASHBOARD_COLLECTIONS.processCapability, 'process_capability']),
      readFirst([PQR_DASHBOARD_COLLECTIONS.riskAssessment, CPV_COLLECTIONS.risk]),
      readFirst([PQR_DASHBOARD_COLLECTIONS.approvals, PQR_COLLECTIONS.approvals]),
      readCollection(PQR_DASHBOARD_COLLECTIONS.batchReview, 300),
      readCollection(PQR_DASHBOARD_COLLECTIONS.materialReview, 300),
      readCollection(PQR_DASHBOARD_COLLECTIONS.packagingReview, 300),
      readCollection(PQR_DASHBOARD_COLLECTIONS.equipmentReview, 300),
      readCollection(PQR_DASHBOARD_COLLECTIONS.utilityReview, 300),
      readCollection(PQR_DASHBOARD_COLLECTIONS.stabilityReview, 300),
      readCollection(PQR_DASHBOARD_COLLECTIONS.summaryConclusion, 200),
    ]);

    const allMapped = pqrRaw.map(mapPqrRecord);
    const filterOptions = {
      products: Array.from(new Set(allMapped.map((p) => p.product).filter(Boolean))).sort(),
      years: Array.from(new Set(allMapped.map((p) => String(p.reviewYear || '')).filter(Boolean))).sort().reverse(),
      sites: Array.from(new Set(allMapped.map((p) => p.site || '').filter(Boolean))).sort(),
      departments: Array.from(new Set(allMapped.map((p) => p.department || '').filter(Boolean))).sort(),
      owners: Array.from(new Set(allMapped.map((p) => p.preparedBy).filter((v) => v && v !== '—'))).sort(),
    };

    let pqrs = filterPqrRecords(allMapped, filters);
    const productsInScope = new Set(pqrs.map((p) => p.product).filter(Boolean));

    const allBatchesRaw = [...batches, ...cpvBatches];
    const scopedBatches = filterRelatedByContext(allBatchesRaw, filters, productsInScope);
    const scopedDeviations = filterRelatedByContext(deviations, filters, productsInScope);
    const scopedOos = filterRelatedByContext(oos, filters, productsInScope);
    const scopedCapa = filterRelatedByContext(capa, filters, productsInScope);
    const scopedCc = filterRelatedByContext(changeControls, filters, productsInScope);
    const scopedComplaints = filterRelatedByContext(complaints, filters, productsInScope);
    const scopedRecalls = filterRelatedByContext(recalls, filters, productsInScope);
    const scopedYields = filterRelatedByContext(yields, filters, productsInScope);
    const scopedCqa = filterRelatedByContext(cqa, filters, productsInScope);
    const scopedStability = filterRelatedByContext(stability, filters, productsInScope);
    const scopedCapability = filterRelatedByContext(capability, filters, productsInScope);
    const scopedRisks = filterRelatedByContext(risks, filters, productsInScope);
    const scopedApprovals = filterRelatedByContext(approvals, filters, productsInScope);

    const sectionBuckets = {
      batchReview,
      materialReview,
      packagingReview,
      equipmentReview,
      utilityReview,
      stabilityReview,
      deviations: scopedDeviations,
      oos: scopedOos,
      capa: scopedCapa,
      changeControls: scopedCc,
      complaints: scopedComplaints,
      cpvBatches,
      risks: scopedRisks,
      summary: summaryConclusion,
      approvals: scopedApprovals,
    };

    const completionRows = buildCompletionRows(pqrs, sectionBuckets);
    const completionById = new Map(completionRows.map((c) => [c.pqrId, c.completionPct]));
    pqrs = pqrs.map((p) => ({ ...p, completionPct: completionById.get(p.id) ?? p.completionPct ?? 0 }));

    const criticalAlerts = buildCriticalAlerts(scopedDeviations, scopedOos, scopedRecalls, scopedCapa);
    const actionItems = buildActionItems(pqrs, scopedApprovals, scopedCapa, scopedDeviations);
    const findings = buildFindings(scopedDeviations, scopedOos, scopedComplaints, scopedCapa);
    const productAnalysis = buildProductAnalysis(
      pqrs, scopedBatches, scopedDeviations, scopedOos, scopedCapa, scopedComplaints, scopedCc, scopedStability,
    );

    const kpis = computeKpis(
      allMapped, pqrs, scopedBatches, scopedDeviations, scopedOos, scopedCapa, scopedCc,
      scopedComplaints, scopedRecalls, scopedYields, scopedCqa, scopedCapability, scopedRisks, scopedApprovals,
      findings.filter((f) => f.severity === 'Critical').length + criticalAlerts.filter((a) => a.riskLevel === 'Critical').length,
      actionItems.filter((a) => a.status !== 'Completed').length,
    );
    const charts = buildCharts(
      pqrs, scopedBatches, scopedDeviations, scopedOos, scopedCapa,
      scopedYields, scopedCqa, scopedStability, scopedComplaints, scopedRecalls, scopedApprovals,
    );

    const activity: PqrActivityEntry[] = [
      ...pqrs.slice(0, 5).map((p) => ({
        action: `PQR ${p.pqrNumber} — ${p.status}`,
        user: p.preparedBy,
        at: p.createdDate,
        detail: p.product,
      })),
      ...scopedApprovals.filter((a) => isPendingPqrApprovalRow(a)).slice(0, 3).map((a) => ({
        action: 'Approval pending',
        user: str(a.currentApproverRole || a.name || a.designation),
        at: str(a.createdAt).slice(0, 16),
        detail: str(a.currentWorkflowStep || a.approval_type || a.approvalType),
      })),
      ...actionItems.filter((a) => a.status === 'Overdue').slice(0, 3).map((a) => ({
        action: `Overdue: ${a.description}`,
        user: a.owner,
        at: a.dueDate,
        detail: a.source,
      })),
    ].slice(0, 12);

    return {
      kpis,
      charts,
      recentPqrs: pqrs.slice(0, 50),
      duePqrs: buildDueRows(pqrs),
      pendingApprovals: buildPendingApprovals(scopedApprovals, pqrs),
      criticalAlerts,
      activity,
      completionRows,
      productAnalysis,
      actionItems,
      findings,
      filterOptions,
      generatedAt: nowIso(),
    };
  } catch (e) {
    console.error('fetchPqrDashboard failed', e);
    return emptyDashboardData('Failed to load PQR dashboard data. Please retry or contact the system administrator.');
  }
}

export async function refreshPqrDashboard(actor: PqrDashboardActor, filters: PqrDashboardFilters = {}) {
  await logDashboardAudit('dashboard refreshed', actor, filters);
  return fetchPqrDashboard(filters);
}

export async function logPqrDashboardView(actor: PqrDashboardActor) {
  await logDashboardAudit('dashboard viewed', actor);
}

export async function logPqrDashboardFilter(actor: PqrDashboardActor, filters: PqrDashboardFilters) {
  await logDashboardAudit('filter applied', actor, filters);
}

export async function logPqrDashboardExport(actor: PqrDashboardActor, type: 'pdf' | 'excel' | 'csv') {
  await logDashboardAudit(
    type === 'pdf' ? 'PDF export clicked' : type === 'csv' ? 'CSV exported' : 'Excel export clicked',
    actor,
  );
}

export async function exportPqrDashboardData(
  actor: PqrDashboardActor,
  data: PqrDashboardData,
  type: 'csv' | 'excel' = 'csv',
) {
  await logPqrDashboardExport(actor, type === 'excel' ? 'excel' : 'csv');
  const { headers, rows } = exportPqrDashboardCsv(data);
  downloadCsv(`pqr-dashboard-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
}

export async function logPqrOpened(actor: PqrDashboardActor, pqrId: string) {
  await logDashboardAudit('recent PQR opened', actor, { pqrId });
}

export async function fetchPqrProductOptions(): Promise<string[]> {
  if (!isFirebaseConfigured()) return [];
  const rows = await readMergedPqrs(200);
  return Array.from(new Set(rows.map((r) => str(r.productName || r.product_name || r.product)).filter(Boolean))).sort();
}

export async function fetchPqrYearOptions(): Promise<string[]> {
  if (!isFirebaseConfigured()) return [];
  const rows = await readMergedPqrs(200);
  return Array.from(new Set(rows.map((r) => String(num(r.reviewYear || r.pqr_year || r.pqrYear) || '')).filter(Boolean))).sort().reverse();
}

export async function fetchPqrFilterOptions(): Promise<PqrDashboardData['filterOptions']> {
  if (!isFirebaseConfigured()) {
    return { products: [], years: [], sites: [], departments: [], owners: [] };
  }
  const rows = (await readMergedPqrs(300)).map(mapPqrRecord);
  return {
    products: Array.from(new Set(rows.map((p) => p.product).filter(Boolean))).sort(),
    years: Array.from(new Set(rows.map((p) => String(p.reviewYear || '')).filter(Boolean))).sort().reverse(),
    sites: Array.from(new Set(rows.map((p) => p.site || '').filter(Boolean))).sort(),
    departments: Array.from(new Set(rows.map((p) => p.department || '').filter(Boolean))).sort(),
    owners: Array.from(new Set(rows.map((p) => p.preparedBy).filter((v) => v && v !== '—'))).sort(),
  };
}
