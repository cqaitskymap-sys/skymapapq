/**
 * Lightweight pure-logic checks for PQR Dashboard (no test runner required).
 * Run: npx tsx scripts/validate-pqr-dashboard-logic.ts
 */
import {
  canTransitionPqrStatus,
  emptyKpis,
  exportPqrDashboardCsv,
  normalizePqrStatus,
  type PqrDashboardData,
} from '../lib/pqr-dashboard-records';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(normalizePqrStatus('under_review') === 'Under Review', 'normalize under_review');
assert(normalizePqrStatus('Generated') === 'In Progress', 'normalize Generated');
assert(normalizePqrStatus('pending approval') === 'Approval Pending', 'normalize pending approval');
assert(normalizePqrStatus('closed') === 'Closed', 'normalize closed');

assert(canTransitionPqrStatus('Draft', 'Under Review'), 'Draft → Under Review');
assert(canTransitionPqrStatus('Approval Pending', 'Approved'), 'Approval Pending → Approved');
assert(!canTransitionPqrStatus('Draft', 'Approved'), 'Draft cannot jump to Approved');
assert(canTransitionPqrStatus('Approved', 'Under Review'), 'Approved can reopen');
assert(canTransitionPqrStatus('Under Review', 'Draft'), 'Send-back to Draft');

const kpis = emptyKpis();
assert(kpis.totalPqrs === 0 && kpis.completionPct === 0, 'empty KPIs are zeroed');

const sample: PqrDashboardData = {
  kpis,
  charts: {
    statusDistribution: [], monthlyCreationTrend: [], productStatus: [], batchReleaseTrend: [],
    qualityTrend: [], yieldTrend: [], assayTrend: [], stabilityTrend: [],
    complaintRecallTrend: [], approvalPendingTrend: [], completionTrend: [], overdueTrend: [],
  },
  recentPqrs: [{
    id: '1', pqrNumber: 'PQR/AMI/0001/2026', product: 'Amikacin', productCode: 'AMI',
    reviewPeriod: '2025', status: 'Draft', preparedBy: 'QA', pendingWith: '—',
    qaReviewer: '—', qaApprover: '—', createdDate: '2026-01-01', reviewYear: 2026,
  }],
  duePqrs: [], pendingApprovals: [], criticalAlerts: [], activity: [],
  completionRows: [], productAnalysis: [], actionItems: [], findings: [],
  filterOptions: { products: [], years: [], sites: [], departments: [], owners: [] },
  generatedAt: new Date().toISOString(),
};

const csv = exportPqrDashboardCsv(sample);
assert(csv.headers.includes('PQR Number'), 'CSV headers');
assert(csv.rows[0][0] === 'PQR/AMI/0001/2026', 'CSV row');

console.log('PQR dashboard logic validation passed.');
