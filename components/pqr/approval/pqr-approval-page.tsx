'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, Loader2, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { isFirebaseConfigured } from '@/lib/firebase';
import type { PqrApprovalHistoryEntry, PqrApprovalRecord } from '@/lib/pqr-approval-records';
import {
  canSubmitPqrApproval,
  computeDashboardCounts,
  daysPending,
  type PqrApprovalDashboardCounts,
} from '@/lib/pqr-approval-records';
import {
  fetchAllApprovalRecords,
  fetchApprovalHistory,
  fetchPqrOptions,
  logPqrApprovalView,
  submitPqrForApproval,
} from '@/lib/pqr-approval-service';
import { PQR_SECTION_FLOW, pqrSectionHref, type PqrOption } from '@/lib/pqr-batch-review-records';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { PqrApprovalAccessGuard } from './pqr-approval-access-guard';
import { ApprovalStatusBadge, OverdueBadge, RoleBadge, WorkflowStatusBadge } from './pqr-approval-badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ColumnDef } from '@/components/admin/admin-data-table';

type PendingRow = PqrApprovalRecord & { srNo: number; daysPending: number; overdue: boolean };
type HistoryRow = PqrApprovalHistoryEntry & { srNo: number };

export function PqrApprovalPage() {
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canSubmit = canSubmitPqrApproval(role);
  const router = useRouter();
  const searchParams = useSearchParams();
  const pqrIdParam = searchParams.get('pqrId') || '';

  const [approvals, setApprovals] = useState<PqrApprovalRecord[]>([]);
  const [history, setHistory] = useState<PqrApprovalHistoryEntry[]>([]);
  const [pqrs, setPqrs] = useState<PqrOption[]>([]);
  const [counts, setCounts] = useState<PqrApprovalDashboardCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filterPqr, setFilterPqr] = useState('');
  const [filterProduct, setFilterProduct] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterOverdue, setFilterOverdue] = useState('all');
  const [submitPqrId, setSubmitPqrId] = useState('');

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'System',
    role,
    email: profile?.email || user?.email || '',
  }), [user?.uid, user?.email, profile?.full_name, profile?.email, role]);

  useEffect(() => {
    if (pqrIdParam) {
      router.replace(`/pqr/${encodeURIComponent(pqrIdParam)}/approval`);
    }
  }, [pqrIdParam, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!isFirebaseConfigured()) { setError('Firebase is not configured.'); return; }
      const [all, hist, opts] = await Promise.all([
        fetchAllApprovalRecords(),
        fetchApprovalHistory(),
        fetchPqrOptions(),
      ]);
      setApprovals(all);
      setHistory(hist);
      setPqrs(opts);
      setCounts(computeDashboardCounts(all, hist, actor.id, role));
      setSubmitPqrId((currentId) => currentId || pqrIdParam || opts[0]?.id || '');
    } catch { setError('Failed to load approval data.'); }
    finally { setLoading(false); }
  }, [actor.id, role, pqrIdParam]);

  useEffect(() => { void load(); void logPqrApprovalView(actor); }, [load, actor]);

  const pendingRows = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return approvals.filter((a) => {
      if (!['Pending', 'In Review', 'Escalated'].includes(a.approvalStatus)) return false;
      if (filterPqr && !a.pqrNumber.toLowerCase().includes(filterPqr.toLowerCase())) return false;
      if (filterProduct && !a.product.toLowerCase().includes(filterProduct.toLowerCase())) return false;
      if (filterStatus !== 'all' && a.approvalStatus !== filterStatus) return false;
      const overdue = Boolean(a.dueDate && a.dueDate < today);
      if (filterOverdue === 'overdue' && !overdue) return false;
      if (filterOverdue === 'ontrack' && overdue) return false;
      return true;
    });
  }, [approvals, filterPqr, filterProduct, filterStatus, filterOverdue]);

  const myPending = useMemo(() => pendingRows.filter((a) =>
    a.currentApproverUser === actor.id || a.currentApproverRole === role,
  ), [pendingRows, actor.id, role]);

  const pendingColumns: ColumnDef<PendingRow>[] = [
    { key: 'srNo', header: 'Sr.' },
    { key: 'pqrNumber', header: 'PQR Number' },
    { key: 'product', header: 'Product', render: (r) => <span className="line-clamp-1 max-w-[120px]">{r.product}</span> },
    { key: 'reviewPeriod', header: 'Review Period', render: (r) => `${r.reviewPeriodFrom} — ${r.reviewPeriodTo}` },
    { key: 'currentWorkflowStep', header: 'Current Step' },
    { key: 'currentApproverRole', header: 'Pending With', render: (r) => <RoleBadge role={r.currentApproverRole} /> },
    { key: 'dueDate', header: 'Due Date', render: (r) => r.dueDate || '—' },
    { key: 'daysPending', header: 'Days Pending' },
    { key: 'overdue', header: 'Priority', render: (r) => <OverdueBadge overdue={r.overdue} days={r.daysPending} /> },
    { key: 'approvalStatus', header: 'Status', render: (r) => <ApprovalStatusBadge status={r.approvalStatus} /> },
    {
      key: 'actions', header: 'Action',
      render: (r) => (
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/pqr/${r.pqrId}/approval`}><Eye className="h-4 w-4" /></Link>
        </Button>
      ),
    },
  ];

  const historyColumns: ColumnDef<HistoryRow>[] = [
    { key: 'srNo', header: 'Sr.' },
    { key: 'pqrNumber', header: 'PQR Number' },
    { key: 'action', header: 'Action' },
    { key: 'userName', header: 'User' },
    { key: 'userRole', header: 'Role', render: (r) => <RoleBadge role={r.userRole} /> },
    { key: 'createdAt', header: 'Date Time', render: (r) => r.createdAt ? new Date(r.createdAt).toLocaleString() : '—' },
    { key: 'comments', header: 'Comments', render: (r) => <span className="line-clamp-1 max-w-[160px]">{r.comments || '—'}</span> },
    { key: 'eSignatureStatus', header: 'E-Sign', render: (r) => r.eSignatureStatus },
  ];

  const toPendingTable = (rows: PqrApprovalRecord[]): PendingRow[] => {
    const today = new Date().toISOString().slice(0, 10);
    return rows.map((r, i) => ({
      ...r,
      srNo: i + 1,
      daysPending: daysPending(r),
      overdue: Boolean(r.dueDate && r.dueDate < today),
    }));
  };

  const handleSubmit = async () => {
    const pqr = pqrs.find((p) => p.id === submitPqrId);
    if (!pqr) return;
    setBusy(true);
    const { error: err, created } = await submitPqrForApproval(pqr, actor);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success(`PQR submitted — ${created} approval step(s) created`);
    await load();
  };

  if (pqrIdParam) {
    return (
      <PqrApprovalAccessGuard>
        <div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>
      </PqrApprovalAccessGuard>
    );
  }

  if (loading) return <PqrApprovalAccessGuard><div className="p-4 sm:p-6"><LoadingSkeleton rows={3} /></div></PqrApprovalAccessGuard>;
  if (error) return <PqrApprovalAccessGuard><div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={() => void load()} /></div></PqrApprovalAccessGuard>;

  return (
    <PqrApprovalAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="PQR Approval"
          description="Review, approve and electronically sign Product Quality Review documents"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'PQR Management', href: '/pqr/dashboard' },
            { label: 'PQR Approval' },
          ]}
          actions={(
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
              <RefreshCw className={`h-4 w-4 mr-1 ${busy ? 'animate-spin' : ''}`} />Refresh
            </Button>
          )}
        />

        <div className="flex flex-wrap gap-2 text-sm">
          {PQR_SECTION_FLOW.filter((s) => !['dashboard', 'create'].includes(s.key)).map((s) => (
            <Link
              key={s.key}
              href={pqrSectionHref(s.href, submitPqrId || undefined)}
              className={`rounded-md border px-2.5 py-1 ${s.key === 'approval' ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-slate-50'}`}
            >
              {s.label}
            </Link>
          ))}
        </div>

        {counts && (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
            <KpiCard label="Pending Approvals" value={counts.pendingApprovals} tone="amber" />
            <KpiCard label="My Pending" value={counts.myPendingApprovals} tone="amber" />
            <KpiCard label="Approved This Month" value={counts.approvedThisMonth} tone="green" />
            <KpiCard label="Rejected" value={counts.rejectedPqrs} tone="red" />
            <KpiCard label="Sent Back" value={counts.sentBackPqrs} tone="amber" />
            <KpiCard label="Overdue" value={counts.overdueApprovals} tone="red" />
            <KpiCard label="Escalated" value={counts.escalatedApprovals} tone="red" />
            <KpiCard label="Final Approved" value={counts.finalApprovedPqrs} tone="green" />
          </div>
        )}

        {canSubmit && (
          <Card><CardContent className="pt-6 flex flex-wrap gap-3 items-end">
            <div className="space-y-2 min-w-[240px] flex-1">
              <p className="text-sm font-medium">Submit PQR for Approval</p>
              <Select value={submitPqrId} onValueChange={setSubmitPqrId}>
                <SelectTrigger><SelectValue placeholder="Select PQR..." /></SelectTrigger>
                <SelectContent>{pqrs.map((p) => <SelectItem key={p.id} value={p.id}>{p.pqrNumber} — {p.productName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={() => void handleSubmit()} disabled={busy || !submitPqrId}>
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
              Submit for Review
            </Button>
            {submitPqrId && (
              <Button variant="outline" asChild>
                <Link href={pqrSectionHref('/pqr/summary', submitPqrId)}>← Summary</Link>
              </Button>
            )}
          </CardContent></Card>
        )}

        <Card><CardContent className="pt-6">
          <div className="flex flex-wrap gap-2 mb-4">
            <Input placeholder="PQR Number" className="w-[140px]" value={filterPqr} onChange={(e) => setFilterPqr(e.target.value)} />
            <Input placeholder="Product" className="w-[140px]" value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)} />
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
                <SelectItem value="In Review">In Review</SelectItem>
                <SelectItem value="Escalated">Escalated</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterOverdue} onValueChange={setFilterOverdue}>
              <SelectTrigger className="w-[130px]"><SelectValue placeholder="Due" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="ontrack">On Track</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Tabs defaultValue="pending">
            <TabsList>
              <TabsTrigger value="pending">Pending Approvals</TabsTrigger>
              <TabsTrigger value="mine">My Approvals</TabsTrigger>
              <TabsTrigger value="history">Approval History</TabsTrigger>
            </TabsList>
            <TabsContent value="pending" className="mt-4 overflow-x-auto">
              {pendingRows.length ? (
                <ResponsiveDataTable columns={pendingColumns} data={toPendingTable(pendingRows)} searchKeys={['pqrNumber', 'product']} mobileTitleKey="pqrNumber" mobileSubtitleKey="currentWorkflowStep" pageSize={15} />
              ) : <EmptyState title="No pending approvals" message="Submit a PQR or wait for review assignments." />}
            </TabsContent>
            <TabsContent value="mine" className="mt-4 overflow-x-auto">
              {myPending.length ? (
                <ResponsiveDataTable columns={pendingColumns} data={toPendingTable(myPending)} searchKeys={['pqrNumber']} mobileTitleKey="pqrNumber" mobileSubtitleKey="currentWorkflowStep" pageSize={15} />
              ) : <EmptyState title="No approvals assigned to you" message="You have no pending approval actions." />}
            </TabsContent>
            <TabsContent value="history" className="mt-4 overflow-x-auto">
              {history.length ? (
                <ResponsiveDataTable
                  columns={historyColumns}
                  data={history.map((r, i) => ({ ...r, srNo: i + 1 }))}
                  searchKeys={['pqrNumber', 'action', 'userName']}
                  mobileTitleKey="action"
                  mobileSubtitleKey="pqrNumber"
                  pageSize={20}
                />
              ) : <EmptyState title="No approval history" message="Approval actions will appear here." />}
            </TabsContent>
          </Tabs>
        </CardContent></Card>
      </div>
    </PqrApprovalAccessGuard>
  );
}
