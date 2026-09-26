'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, Download, Eye, FileSpreadsheet, Loader2, Pencil, Plus,
  RefreshCw, Save, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuth } from '@/contexts/auth-context';
import { isFirebaseConfigured } from '@/lib/firebase';
import {
  PQR_SECTION_FLOW, pqrSectionHref, type PqrOption,
} from '@/lib/pqr-batch-review-records';
import { fetchPqrById } from '@/lib/pqr-batch-review-service';
import {
  PQR_PACKAGING_CATEGORIES, PQR_PACKAGING_TYPES, PQR_QC_STATUSES,
  buildPackagingVendorAvlRows, canAddPackagingReview, canExportPackagingReview,
  canManagePackagingReview, computePackagingSummary, filterPackagingReviewRecords,
  formatPct, formatQty, type PackagingReviewFormData, type PqrPackagingReviewRecord,
} from '@/lib/pqr-packaging-review-records';
import {
  buildPackagingCharts, createPackagingReviewRecord, exportPackagingReviewCsv,
  fetchPackagingQualityMetrics, fetchPackagingReviewRecords, fetchPqrOptions,
  getPackagingReviewNarrative, logPackagingNarrativeEdit, logPackagingReviewExport,
  logPackagingReviewView, pullPackagingData, recalculateAllPackagingCompliance,
  savePackagingSectionToPqr, softDeletePackagingReviewRecord, updatePackagingReviewRecord,
  uploadPackagingAttachment,
} from '@/lib/pqr-packaging-review-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { AttachmentUploader } from '@/components/pqr/create/attachment-uploader';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PackagingReviewAccessGuard } from './packaging-review-access-guard';
import { PackagingReviewFormDialog } from './packaging-review-form-dialog';
import {
  AvlStatusBadge, ComplianceBadge, PackagingRiskBadge, QcStatusBadge, ReconciliationBadge,
} from './packaging-review-badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ColumnDef } from '@/components/admin/admin-data-table';

const CHART_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#64748b'];

function SafeChart({ title, empty, children }: { title: string; empty?: boolean; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="h-52">
        {empty ? <EmptyState title="No data" message="No chart data available." /> : children}
      </CardContent>
    </Card>
  );
}

type TableRow = PqrPackagingReviewRecord & { srNo: number };

export function PackagingReviewPage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const role = profile?.role;
  const canAdd = canAddPackagingReview(role);
  const canManage = canManagePackagingReview(role);
  const canExport = canExportPackagingReview(role);

  const [pqrs, setPqrs] = useState<PqrOption[]>([]);
  const [selectedPqrId, setSelectedPqrId] = useState('');
  const [records, setRecords] = useState<PqrPackagingReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [narrative, setNarrative] = useState('');
  const [narrativeDirty, setNarrativeDirty] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<PqrPackagingReviewRecord | null>(null);
  const [detailRecord, setDetailRecord] = useState<PqrPackagingReviewRecord | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [filterType, setFilterType] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterQc, setFilterQc] = useState('all');
  const [filterCompliance, setFilterCompliance] = useState('all');
  const [filterRecon, setFilterRecon] = useState('all');
  const [filterAvl, setFilterAvl] = useState('all');
  const [filterRisk, setFilterRisk] = useState('all');
  const [filterMaterial, setFilterMaterial] = useState('');
  const [filterBatch, setFilterBatch] = useState('');
  const [filterManufacturer, setFilterManufacturer] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [qualityMetrics, setQualityMetrics] = useState({
    packagingOosCount: 0, packagingDeviationCount: 0, packagingCapaCount: 0,
  });

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'System',
    role,
  }), [user?.uid, profile?.full_name, profile?.email, role]);

  const selectedPqr = useMemo(() => pqrs.find((p) => p.id === selectedPqrId) || null, [pqrs, selectedPqrId]);

  const syncPqrIdToUrl = useCallback((pqrId: string) => {
    if (!pqrId) return;
    const params = new URLSearchParams(searchParams?.toString() || '');
    if (params.get('pqrId') === pqrId) return;
    params.set('pqrId', pqrId);
    router.replace(`/pqr/packaging?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const loadPqrs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!isFirebaseConfigured()) { setError('Firebase is not configured.'); return; }
      const opts = await fetchPqrOptions();
      setPqrs(opts);
      const fromUrl = searchParams?.get('pqrId') || '';
      let nextId = selectedPqrId;
      if (fromUrl && opts.some((p) => p.id === fromUrl)) {
        nextId = fromUrl;
      } else if (fromUrl) {
        const direct = await fetchPqrById(fromUrl);
        if (direct) {
          setPqrs((prev) => (prev.some((p) => p.id === direct.id) ? prev : [direct, ...prev]));
          nextId = direct.id;
        } else if (!nextId && opts.length) nextId = opts[0].id;
      } else if (!nextId && opts.length) {
        nextId = opts[0].id;
      }
      if (nextId) {
        setSelectedPqrId(nextId);
        syncPqrIdToUrl(nextId);
      }
    } catch { setError('Failed to load PQR records.'); }
    finally { setLoading(false); }
  }, [selectedPqrId, searchParams, syncPqrIdToUrl]);

  const loadRecords = useCallback(async (pqrId: string, pqr?: PqrOption | null) => {
    if (!pqrId) return;
    setBusy(true);
    try {
      const rows = await fetchPackagingReviewRecords(pqrId);
      setRecords(rows);
      setNarrative(getPackagingReviewNarrative(rows));
      setNarrativeDirty(false);
      if (pqr) {
        const metrics = await fetchPackagingQualityMetrics(pqr, rows);
        setQualityMetrics(metrics);
      }
    } catch { toast.error('Failed to load packaging records'); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void loadPqrs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const viewLogged = useRef(false);
  useEffect(() => {
    if (viewLogged.current || actor.id === 'system') return;
    viewLogged.current = true;
    void logPackagingReviewView(actor);
  }, [actor]);

  useEffect(() => {
    if (selectedPqrId) {
      void loadRecords(selectedPqrId, selectedPqr);
      syncPqrIdToUrl(selectedPqrId);
    }
  }, [selectedPqrId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => filterPackagingReviewRecords(records, {
    packagingType: filterType,
    category: filterCategory,
    qcStatus: filterQc,
    complianceStatus: filterCompliance,
    reconciliationStatus: filterRecon,
    avlStatus: filterAvl,
    riskLevel: filterRisk,
    material: filterMaterial,
    batch: filterBatch,
    manufacturer: filterManufacturer,
    supplier: filterSupplier,
    search: filterSearch,
  }), [records, filterType, filterCategory, filterQc, filterCompliance, filterRecon, filterAvl, filterRisk, filterMaterial, filterBatch, filterManufacturer, filterSupplier, filterSearch]);

  const primaryRecords = useMemo(() => filtered.filter((r) => r.packagingMaterialType === 'Primary Packaging Material'), [filtered]);
  const secondaryRecords = useMemo(() => filtered.filter((r) => r.packagingMaterialType === 'Secondary Packaging Material'), [filtered]);
  const tertiaryRecords = useMemo(() => filtered.filter((r) => r.packagingMaterialType === 'Tertiary Packaging Material'), [filtered]);
  const summary = useMemo(() => computePackagingSummary(filtered, qualityMetrics), [filtered, qualityMetrics]);
  const charts = useMemo(() => buildPackagingCharts(filtered), [filtered]);
  const vendorRows = useMemo(() => buildPackagingVendorAvlRows(filtered), [filtered]);

  const resetFilters = () => {
    setFilterType('all');
    setFilterCategory('all');
    setFilterQc('all');
    setFilterCompliance('all');
    setFilterRecon('all');
    setFilterAvl('all');
    setFilterRisk('all');
    setFilterMaterial('');
    setFilterBatch('');
    setFilterManufacturer('');
    setFilterSupplier('');
    setFilterSearch('');
  };

  const tableColumns: ColumnDef<TableRow>[] = [
    { key: 'srNo', header: 'Sr. No.' },
    { key: 'materialName', header: 'Packaging Material' },
    { key: 'packagingMaterialType', header: 'Type', render: (r) => <span className="text-xs">{r.packagingMaterialType.replace(' Packaging Material', '')}</span> },
    { key: 'manufacturerName', header: 'Manufacturer' },
    { key: 'supplierName', header: 'Supplier' },
    { key: 'arNumber', header: 'AR No.' },
    { key: 'materialLotNumber', header: 'Batch / Lot No.', render: (r) => r.materialLotNumber || r.batchNumber || '—' },
    { key: 'usedQuantity', header: 'Used Qty', render: (r) => formatQty(r.usedQuantity, r.unit) },
    { key: 'rejectedQuantity', header: 'Rejected Qty', render: (r) => formatQty(r.rejectedQuantity, r.unit) },
    { key: 'balanceQuantity', header: 'Balance Qty', render: (r) => formatQty(r.balanceQuantity, r.unit) },
    { key: 'reconciliationStatus', header: 'Recon', render: (r) => <ReconciliationBadge status={r.reconciliationStatus} /> },
    { key: 'rejectionPct', header: 'Rejection %', render: (r) => formatPct(r.rejectionPct) },
    { key: 'qcStatus', header: 'QC Status', render: (r) => <QcStatusBadge status={r.qcStatus} /> },
    { key: 'vendorAvlStatus', header: 'AVL', render: (r) => <AvlStatusBadge status={r.vendorAvlStatus} /> },
    { key: 'complianceStatus', header: 'Compliance', render: (r) => <ComplianceBadge status={r.complianceStatus} /> },
    { key: 'riskLevel', header: 'Risk', render: (r) => <PackagingRiskBadge level={r.riskLevel} /> },
    {
      key: 'actions', header: 'Action',
      render: (r) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label={`View ${r.materialName}`} onClick={() => setDetailRecord(r)}><Eye className="h-4 w-4" /></Button>
          {canManage && (
            <>
              <Button variant="ghost" size="icon" aria-label={`Edit ${r.materialName}`} onClick={() => { setEditRecord(r); setFormOpen(true); }}><Pencil className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" aria-label={`Remove ${r.materialName}`} onClick={() => setDeleteId(r.id || null)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const toTable = (rows: PqrPackagingReviewRecord[]): TableRow[] => rows.map((r, i) => ({ ...r, srNo: i + 1 }));

  const handlePull = async () => {
    if (!selectedPqr) return;
    setBusy(true);
    const { created, skipped, error: err } = await pullPackagingData(selectedPqr, actor);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success(`${created} packaging lot(s) pulled (${skipped} skipped)`);
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const handleSaveForm = async (data: PackagingReviewFormData): Promise<void> => {
    if (!selectedPqr) return;
    setBusy(true);
    const result = editRecord?.id
      ? await updatePackagingReviewRecord(editRecord.id, selectedPqr, data, actor)
      : await createPackagingReviewRecord(selectedPqr, data, actor);
    setBusy(false);
    if (result.error) { toast.error(result.error); return; }
    toast.success(editRecord ? 'Packaging record updated' : 'Packaging record added');
    setFormOpen(false);
    setEditRecord(null);
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const handleSaveSection = async () => {
    if (!selectedPqr) return;
    setBusy(true);
    const { error: err } = await savePackagingSectionToPqr(selectedPqr.id, narrative, records, actor);
    setBusy(false);
    if (err) toast.error(err);
    else {
      setNarrativeDirty(false);
      toast.success('Packaging section saved to PQR');
    }
  };

  const handleRecalc = async () => {
    if (!selectedPqr) return;
    setBusy(true);
    const { updated, error: err } = await recalculateAllPackagingCompliance(selectedPqr.id, actor);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success(`Compliance recalculated for ${updated} lot(s)`);
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleteId || !selectedPqr) return;
    setBusy(true);
    const { error: err } = await softDeletePackagingReviewRecord(deleteId, actor);
    setBusy(false);
    setDeleteId(null);
    if (err) { toast.error(err); return; }
    toast.success('Packaging record removed');
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const exportCsv = () => {
    if (!filtered.length) return toast.info('No packaging records to export');
    exportPackagingReviewCsv(filtered, selectedPqr?.pqrNumber);
    void logPackagingReviewExport(actor, 'csv');
    toast.success('Packaging review exported as CSV');
  };

  const sectionNav = useMemo(() => {
    const idx = PQR_SECTION_FLOW.findIndex((s) => s.key === 'packaging');
    const prev = PQR_SECTION_FLOW[idx - 1];
    const next = PQR_SECTION_FLOW[idx + 1];
    return {
      prev: prev ? { ...prev, href: pqrSectionHref(prev.href, selectedPqrId) } : null,
      next: next ? { ...next, href: pqrSectionHref(next.href, selectedPqrId) } : null,
    };
  }, [selectedPqrId]);

  const renderTable = (rows: PqrPackagingReviewRecord[], emptyTitle: string) => (
    rows.length ? (
      <ResponsiveDataTable columns={tableColumns} data={toTable(rows)} searchKeys={['materialName', 'arNumber', 'manufacturerName']} mobileTitleKey="materialName" mobileSubtitleKey="arNumber" pageSize={15} />
    ) : <EmptyState title={emptyTitle} message="Pull packaging data or add manually." />
  );

  if (loading) return <PackagingReviewAccessGuard><div className="p-4 sm:p-6"><LoadingSkeleton rows={3} /></div></PackagingReviewAccessGuard>;
  if (error) return <PackagingReviewAccessGuard><div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={() => void loadPqrs()} /></div></PackagingReviewAccessGuard>;

  return (
    <PackagingReviewAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="Packaging Review"
          description="Review primary, secondary and tertiary packaging materials used during the PQR period"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'PQR Management', href: '/pqr/dashboard' },
            { label: 'Packaging Review' },
          ]}
          actions={(
            <>
              {canExport && (
                <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
                  <FileSpreadsheet className="h-4 w-4 mr-1" />Export CSV
                </Button>
              )}
              {canManage && selectedPqr && (
                <>
                  <Button variant="outline" size="sm" onClick={() => void handlePull()} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                    Pull Packaging
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void handleRecalc()} disabled={busy}>Recalc Compliance</Button>
                </>
              )}
              {canAdd && selectedPqr && (
                <Button size="sm" onClick={() => { setEditRecord(null); setFormOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Packaging</Button>
              )}
            </>
          )}
        />

        <div className="flex flex-wrap gap-2 text-sm">
          {PQR_SECTION_FLOW.filter((s) => !['dashboard', 'create'].includes(s.key)).map((s) => (
            <Link
              key={s.key}
              href={pqrSectionHref(s.href, selectedPqrId)}
              className={`rounded-md border px-2.5 py-1 ${s.key === 'packaging' ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-slate-50'}`}
            >
              {s.label}
            </Link>
          ))}
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="pqr-select">PQR Number *</Label>
                <Select
                  value={selectedPqrId}
                  onValueChange={(id) => {
                    setSelectedPqrId(id);
                    syncPqrIdToUrl(id);
                  }}
                >
                  <SelectTrigger id="pqr-select"><SelectValue placeholder="Select PQR..." /></SelectTrigger>
                  <SelectContent>
                    {pqrs.map((p) => <SelectItem key={p.id} value={p.id}>{p.pqrNumber} — {p.productName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {selectedPqr && (
                <>
                  <div>
                    <Label className="text-muted-foreground">Product / Code</Label>
                    <p className="text-sm font-medium">{selectedPqr.productName}</p>
                    <p className="text-xs text-muted-foreground">{selectedPqr.productCode}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Review Period</Label>
                    <p className="text-sm font-medium">{selectedPqr.reviewPeriodFrom || '—'} — {selectedPqr.reviewPeriodTo || '—'}</p>
                  </div>
                  {(selectedPqr.strength || selectedPqr.dosageForm) && (
                    <div>
                      <Label className="text-muted-foreground">Strength / Dosage Form</Label>
                      <p className="text-sm font-medium">{[selectedPqr.strength, selectedPqr.dosageForm].filter(Boolean).join(' / ')}</p>
                    </div>
                  )}
                  {selectedPqr.status && (
                    <div>
                      <Label className="text-muted-foreground">PQR Status</Label>
                      <p className="text-sm font-medium capitalize">{selectedPqr.status.replace(/_/g, ' ')}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {!selectedPqr ? (
          <EmptyState title="Select a PQR" message="Choose a PQR to review packaging materials for the annual review period." />
        ) : (
          <>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-12">
              <KpiCard label="Total Lots" value={summary.totalPackagingLots} />
              <KpiCard label="Materials" value={summary.uniqueMaterials} />
              <KpiCard label="Primary Lots" value={summary.primaryPackagingLots} />
              <KpiCard label="Secondary Lots" value={summary.secondaryPackagingLots} />
              <KpiCard label="Tertiary Lots" value={summary.tertiaryPackagingLots} />
              <KpiCard label="Approved" value={summary.approvedLots} tone="green" />
              <KpiCard label="Rejected" value={summary.rejectedLots} tone="red" />
              <KpiCard label="Pending" value={summary.pendingLots} tone="amber" />
              <KpiCard label="Accept %" value={`${summary.acceptancePct}%`} tone="green" />
              <KpiCard label="Non-Compliant" value={summary.nonCompliantLots} tone="red" />
              <KpiCard label="Recon Mismatch" value={summary.reconciliationMismatchCount} tone="amber" />
              <KpiCard label="OOS / Dev / CAPA" value={`${summary.packagingOosCount}/${summary.packagingDeviationCount}/${summary.packagingCapaCount}`} />
            </div>

            <Card><CardContent className="pt-6">
              <div className="flex flex-wrap gap-2">
                <Input
                  placeholder="Search material / AR / lot"
                  className="w-full sm:w-[200px]"
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  aria-label="Search packaging materials"
                />
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-[170px]" aria-label="Filter packaging type"><SelectValue placeholder="Packaging Type" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All Types</SelectItem>{PQR_PACKAGING_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(' Packaging Material', '')}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger className="w-[150px]" aria-label="Filter category"><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All Categories</SelectItem>{PQR_PACKAGING_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={filterQc} onValueChange={setFilterQc}>
                  <SelectTrigger className="w-[130px]" aria-label="Filter QC status"><SelectValue placeholder="QC Status" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All QC</SelectItem>{PQR_QC_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={filterCompliance} onValueChange={setFilterCompliance}>
                  <SelectTrigger className="w-[150px]" aria-label="Filter compliance"><SelectValue placeholder="Compliance" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Compliance</SelectItem>
                    <SelectItem value="Complies">Complies</SelectItem>
                    <SelectItem value="Does Not Comply">Does Not Comply</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterRecon} onValueChange={setFilterRecon}>
                  <SelectTrigger className="w-[150px]" aria-label="Filter reconciliation"><SelectValue placeholder="Reconciliation" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Recon</SelectItem>
                    <SelectItem value="Matched">Matched</SelectItem>
                    <SelectItem value="Mismatch">Mismatch</SelectItem>
                    <SelectItem value="Not Applicable">Not Applicable</SelectItem>
                  </SelectContent>
                </Select>
                <Input placeholder="Material" className="w-[120px]" value={filterMaterial} onChange={(e) => setFilterMaterial(e.target.value)} aria-label="Filter material name" />
                <Input placeholder="Batch/lot" className="w-[110px]" value={filterBatch} onChange={(e) => setFilterBatch(e.target.value)} aria-label="Filter batch or lot" />
                <Input placeholder="Manufacturer" className="w-[120px]" value={filterManufacturer} onChange={(e) => setFilterManufacturer(e.target.value)} aria-label="Filter manufacturer" />
                <Input placeholder="Supplier" className="w-[110px]" value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)} aria-label="Filter supplier" />
                <Select value={filterAvl} onValueChange={setFilterAvl}>
                  <SelectTrigger className="w-[140px]" aria-label="Filter AVL"><SelectValue placeholder="AVL Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All AVL</SelectItem>
                    <SelectItem value="Approved">Approved</SelectItem>
                    <SelectItem value="Not Approved">Not Approved</SelectItem>
                    <SelectItem value="Conditional Approved">Conditional</SelectItem>
                    <SelectItem value="Blocked">Blocked</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterRisk} onValueChange={setFilterRisk}>
                  <SelectTrigger className="w-[120px]" aria-label="Filter risk"><SelectValue placeholder="Risk" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Risk</SelectItem>
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={resetFilters}>Reset</Button>
                <Button variant="outline" size="icon" aria-label="Reload" onClick={() => void loadRecords(selectedPqrId, selectedPqr)} disabled={busy}>
                  <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </CardContent></Card>

            <Tabs defaultValue="primary">
              <TabsList className="flex flex-wrap h-auto">
                <TabsTrigger value="primary">Primary Packaging Review ({primaryRecords.length})</TabsTrigger>
                <TabsTrigger value="secondary">Secondary Packaging Review ({secondaryRecords.length})</TabsTrigger>
                <TabsTrigger value="tertiary">Tertiary Packaging Review ({tertiaryRecords.length})</TabsTrigger>
                <TabsTrigger value="vendor">Vendor AVL Review</TabsTrigger>
                <TabsTrigger value="reconciliation">Reconciliation Summary</TabsTrigger>
                <TabsTrigger value="compliance">Compliance Summary</TabsTrigger>
                <TabsTrigger value="charts">Charts</TabsTrigger>
                <TabsTrigger value="narrative">Narrative</TabsTrigger>
              </TabsList>

              <TabsContent value="primary" className="mt-4">
                <Card><CardContent className="pt-6 overflow-x-auto">{renderTable(primaryRecords, 'No primary packaging records')}</CardContent></Card>
              </TabsContent>
              <TabsContent value="secondary" className="mt-4">
                <Card><CardContent className="pt-6 overflow-x-auto">{renderTable(secondaryRecords, 'No secondary packaging records')}</CardContent></Card>
              </TabsContent>
              <TabsContent value="tertiary" className="mt-4">
                <Card><CardContent className="pt-6 overflow-x-auto">{renderTable(tertiaryRecords, 'No tertiary packaging records')}</CardContent></Card>
              </TabsContent>

              <TabsContent value="vendor" className="mt-4">
                <Card><CardHeader><CardTitle className="text-base">Vendor AVL Review</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    {vendorRows.length ? (
                      <table className="w-full text-sm">
                        <thead><tr className="border-b bg-slate-50">
                          {['Supplier', 'Manufacturer', 'Material Lots', 'AVL Status', 'Compliant', 'Non-Compliant'].map((h) => (
                            <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {vendorRows.map((v) => (
                            <tr key={v.id} className="border-b">
                              <td className="px-3 py-2">{v.supplierName || '—'}</td>
                              <td className="px-3 py-2">{v.manufacturerName || '—'}</td>
                              <td className="px-3 py-2">{v.materialCount}</td>
                              <td className="px-3 py-2"><AvlStatusBadge status={v.avlStatus} /></td>
                              <td className="px-3 py-2">{v.compliantLots}</td>
                              <td className="px-3 py-2">{v.nonCompliantLots}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : <EmptyState title="No vendor data" message="Packaging records will populate vendor AVL summary." />}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="reconciliation" className="mt-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Card><CardHeader><CardTitle className="text-sm">Matched Lots</CardTitle></CardHeader>
                    <CardContent>{filtered.filter((r) => r.reconciliationStatus === 'Matched').length} of {filtered.length}</CardContent></Card>
                  <Card><CardHeader><CardTitle className="text-sm">Mismatch Details</CardTitle></CardHeader>
                    <CardContent className="space-y-2 text-sm max-h-48 overflow-y-auto">
                      {filtered.filter((r) => r.reconciliationStatus === 'Mismatch').map((r) => (
                        <p key={r.id}>{r.materialName} — Balance: {formatQty(r.balanceQuantity, r.unit)}</p>
                      ))}
                      {!filtered.some((r) => r.reconciliationStatus === 'Mismatch') && (
                        <p className="text-muted-foreground">All packaging reconciliation matched.</p>
                      )}
                    </CardContent></Card>
                </div>
              </TabsContent>

              <TabsContent value="compliance" className="mt-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Card><CardHeader><CardTitle className="text-sm">Compliant Lots</CardTitle></CardHeader>
                    <CardContent>{filtered.filter((r) => r.complianceStatus === 'Complies').length} of {filtered.length} ({summary.acceptancePct}% QC approved)</CardContent></Card>
                  <Card><CardHeader><CardTitle className="text-sm">Non-Compliant Reasons</CardTitle></CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {Array.from(new Set(filtered.flatMap((r) => r.complianceReasons || []))).map((reason) => (
                        <p key={reason}>• {reason}: {filtered.filter((r) => (r.complianceReasons || []).includes(reason)).length}</p>
                      ))}
                      {!filtered.some((r) => (r.complianceReasons || []).length) && <p className="text-muted-foreground">All packaging materials comply.</p>}
                    </CardContent></Card>
                </div>
              </TabsContent>

              <TabsContent value="charts" className="mt-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <SafeChart title="Packaging Type Distribution" empty={!charts.packagingTypeDistribution.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart><Pie data={charts.packagingTypeDistribution} dataKey="value" nameKey="name" outerRadius={70} label>
                        {charts.packagingTypeDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie><Tooltip /></PieChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Approved vs Rejected Lots" empty={!charts.approvedVsRejected.some((d) => d.value > 0)}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={charts.approvedVsRejected}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="value" fill="#2563eb" /></BarChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Vendor-wise Packaging Usage" empty={!charts.vendorUsage.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={charts.vendorUsage}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="vendor" tick={{ fontSize: 10 }} /><YAxis /><Tooltip /><Bar dataKey="count" fill="#059669" /></BarChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="AVL Compliance Trend" empty={!charts.avlComplianceTrend.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={charts.avlComplianceTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Legend />
                        <Line type="monotone" dataKey="compliant" stroke="#059669" /><Line type="monotone" dataKey="nonCompliant" stroke="#dc2626" /></LineChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Reconciliation Mismatch Trend" empty={!charts.reconciliationMismatchTrend.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={charts.reconciliationMismatchTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Line type="monotone" dataKey="count" stroke="#d97706" /></LineChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Packaging Risk Distribution" empty={!charts.riskDistribution.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart><Pie data={charts.riskDistribution} dataKey="value" nameKey="name" outerRadius={70} label>
                        {charts.riskDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie><Tooltip /></PieChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Label Reconciliation Trend" empty={!charts.labelReconciliationTrend.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={charts.labelReconciliationTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Legend />
                        <Line type="monotone" dataKey="matched" stroke="#059669" /><Line type="monotone" dataKey="mismatch" stroke="#dc2626" /></LineChart>
                    </ResponsiveContainer>
                  </SafeChart>
                </div>
              </TabsContent>

              <TabsContent value="narrative" className="mt-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <CardTitle className="text-base">PQR Section Narrative — Packing Material Review</CardTitle>
                    {canManage && (
                      <Button size="sm" onClick={() => void handleSaveSection()} disabled={busy || !narrativeDirty}>
                        <Save className="h-4 w-4 mr-1" />Save to PQR
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      className="min-h-[140px]"
                      value={narrative}
                      readOnly={!canManage}
                      aria-label="Packaging review narrative"
                      onChange={(e) => {
                        setNarrative(e.target.value);
                        setNarrativeDirty(true);
                        if (selectedPqr) logPackagingNarrativeEdit(actor, selectedPqr.id);
                      }}
                    />
                    {narrativeDirty && <p className="mt-2 text-xs text-amber-700">Unsaved narrative changes</p>}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              {sectionNav.prev ? (
                <Button variant="outline" asChild>
                  <Link href={sectionNav.prev.href}><ArrowLeft className="h-4 w-4 mr-1" />{sectionNav.prev.label}</Link>
                </Button>
              ) : <span />}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" asChild><Link href="/pqr/dashboard">PQR Dashboard</Link></Button>
                <Button variant="outline" asChild><Link href="/qms/deviation">Deviations</Link></Button>
                <Button variant="outline" asChild><Link href="/qms/oos">OOS</Link></Button>
                <Button variant="outline" asChild><Link href="/qms/capa">CAPA</Link></Button>
                <Button variant="outline" asChild><Link href="/qms/vendors">Suppliers</Link></Button>
              </div>
              {sectionNav.next ? (
                <Button asChild>
                  <Link href={sectionNav.next.href}>{sectionNav.next.label}<ArrowRight className="h-4 w-4 ml-1" /></Link>
                </Button>
              ) : <span />}
            </div>
          </>
        )}

        {selectedPqr && (
          <PackagingReviewFormDialog open={formOpen} onOpenChange={setFormOpen} pqr={selectedPqr} record={editRecord} onSubmit={handleSaveForm} loading={busy} />
        )}

        <Dialog open={!!detailRecord} onOpenChange={() => setDetailRecord(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{detailRecord?.materialName}</DialogTitle></DialogHeader>
            {detailRecord && (
              <div className="space-y-4">
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    ['PQR', detailRecord.pqrNumber || selectedPqr?.pqrNumber],
                    ['Product', detailRecord.product],
                    ['Type', detailRecord.packagingMaterialType],
                    ['Category', detailRecord.packagingMaterialCategory],
                    ['Material Code', detailRecord.materialCode || '—'],
                    ['FP Batch', detailRecord.batchNumber || '—'],
                    ['Lot No.', detailRecord.materialLotNumber || '—'],
                    ['Manufacturer', detailRecord.manufacturerName],
                    ['Supplier', detailRecord.supplierName],
                    ['AR No.', detailRecord.arNumber],
                    ['GRN', detailRecord.grnNumber || '—'],
                    ['Issued', formatQty(detailRecord.issuedQuantity, detailRecord.unit)],
                    ['Used', formatQty(detailRecord.usedQuantity, detailRecord.unit)],
                    ['Rejected', formatQty(detailRecord.rejectedQuantity, detailRecord.unit)],
                    ['Returned', formatQty(detailRecord.returnedQuantity, detailRecord.unit)],
                    ['Balance', formatQty(detailRecord.balanceQuantity, detailRecord.unit)],
                    ['Rejection %', formatPct(detailRecord.rejectionPct)],
                    ['MFG / EXP', `${detailRecord.mfgDate || '—'} / ${detailRecord.expDate || '—'}`],
                    ['Specification', detailRecord.specificationNumber || '—'],
                    ['COA', detailRecord.coaAvailable === 'Yes' ? (detailRecord.coaNumber || 'Yes') : 'No'],
                    ['Source', detailRecord.sourceType || 'manual'],
                  ].map(([k, v]) => (
                    <div key={String(k)}><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{String(v)}</dd></div>
                  ))}
                </dl>
                <div className="flex flex-wrap gap-2">
                  <QcStatusBadge status={detailRecord.qcStatus} />
                  <AvlStatusBadge status={detailRecord.vendorAvlStatus} />
                  <ReconciliationBadge status={detailRecord.reconciliationStatus} />
                  <ComplianceBadge status={detailRecord.complianceStatus} />
                  <PackagingRiskBadge level={detailRecord.riskLevel} />
                </div>
                {(detailRecord.complianceReasons || []).length > 0 && (
                  <p className="text-sm text-red-600">Reasons: {detailRecord.complianceReasons.join(', ')}</p>
                )}
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/qms/deviation?batch=${encodeURIComponent(detailRecord.batchNumber || '')}`}>Deviations</Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/qms/oos?batch=${encodeURIComponent(detailRecord.batchNumber || '')}`}>OOS</Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/qms/capa">CAPA</Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/qms/vendors">Suppliers</Link>
                  </Button>
                </div>
                {detailRecord.id && canManage && selectedPqr && (
                  <AttachmentUploader
                    onUpload={(file) => uploadPackagingAttachment(selectedPqr.id, detailRecord.id!, file, actor)}
                  />
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        <ConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Remove Packaging Record"
          description="This will soft-delete the packaging review record." confirmLabel="Remove" destructive loading={busy} onConfirm={handleDelete} />
      </div>
    </PackagingReviewAccessGuard>
  );
}
