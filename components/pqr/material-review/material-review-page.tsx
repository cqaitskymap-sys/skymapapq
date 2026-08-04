'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  PQR_MATERIAL_TYPES, PQR_QC_STATUSES, buildVendorAvlRows,
  canAddMaterialReview, canExportMaterialReview, canManageMaterialReview,
  computeMaterialSummary, filterMaterialReviewRecords, formatQty, formatVariance,
  type MaterialReviewFormData, type PqrMaterialReviewRecord,
} from '@/lib/pqr-material-review-records';
import {
  buildMaterialCharts, createMaterialReviewRecord, exportMaterialReviewCsv,
  fetchMaterialQualityMetrics, fetchMaterialReviewRecords, fetchPqrOptions,
  getMaterialReviewNarrative, logMaterialNarrativeEdit, logMaterialReviewExport,
  logMaterialReviewView, pullMaterialData, recalculateAllCompliance,
  saveMaterialSectionToPqr, softDeleteMaterialReviewRecord, updateMaterialReviewRecord,
  uploadMaterialAttachment,
} from '@/lib/pqr-material-review-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { AttachmentUploader } from '@/components/pqr/create/attachment-uploader';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { MaterialReviewAccessGuard } from './material-review-access-guard';
import { MaterialReviewFormDialog } from './material-review-form-dialog';
import { AvlStatusBadge, ComplianceBadge, MaterialRiskBadge, QcStatusBadge } from './material-review-badges';
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

type TableRow = PqrMaterialReviewRecord & { srNo: number };

export function MaterialReviewPage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const role = profile?.role;
  const canAdd = canAddMaterialReview(role);
  const canManage = canManageMaterialReview(role);
  const canExport = canExportMaterialReview(role);

  const [pqrs, setPqrs] = useState<PqrOption[]>([]);
  const [selectedPqrId, setSelectedPqrId] = useState('');
  const [records, setRecords] = useState<PqrMaterialReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [narrative, setNarrative] = useState('');
  const [narrativeDirty, setNarrativeDirty] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<PqrMaterialReviewRecord | null>(null);
  const [detailRecord, setDetailRecord] = useState<PqrMaterialReviewRecord | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [filterType, setFilterType] = useState('all');
  const [filterQc, setFilterQc] = useState('all');
  const [filterCompliance, setFilterCompliance] = useState('all');
  const [filterMaterial, setFilterMaterial] = useState('');
  const [filterBatch, setFilterBatch] = useState('');
  const [filterManufacturer, setFilterManufacturer] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterAvl, setFilterAvl] = useState('all');
  const [filterRisk, setFilterRisk] = useState('all');
  const [filterSearch, setFilterSearch] = useState('');
  const [qualityMetrics, setQualityMetrics] = useState({
    materialOosCount: 0, materialDeviationCount: 0, materialCapaCount: 0,
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
    router.replace(`/pqr/materials?${params.toString()}`, { scroll: false });
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
      const rows = await fetchMaterialReviewRecords(pqrId);
      setRecords(rows);
      setNarrative(getMaterialReviewNarrative(rows));
      setNarrativeDirty(false);
      if (pqr) {
        const metrics = await fetchMaterialQualityMetrics(pqr, rows);
        setQualityMetrics(metrics);
      }
    } catch { toast.error('Failed to load material records'); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void loadPqrs(); void logMaterialReviewView(actor); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedPqrId) {
      void loadRecords(selectedPqrId, selectedPqr);
      syncPqrIdToUrl(selectedPqrId);
    }
  }, [selectedPqrId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => filterMaterialReviewRecords(records, {
    materialType: filterType,
    qcStatus: filterQc,
    complianceStatus: filterCompliance,
    avlStatus: filterAvl,
    riskLevel: filterRisk,
    material: filterMaterial,
    batch: filterBatch,
    manufacturer: filterManufacturer,
    supplier: filterSupplier,
    search: filterSearch,
  }), [records, filterType, filterQc, filterCompliance, filterAvl, filterRisk, filterMaterial, filterBatch, filterManufacturer, filterSupplier, filterSearch]);

  const apiRecords = useMemo(() => filtered.filter((r) => r.materialType === 'API' || r.materialType.toLowerCase().includes('active')), [filtered]);
  const rawRecords = useMemo(() => filtered.filter((r) => r.materialType !== 'API' && !r.materialType.toLowerCase().includes('active')), [filtered]);
  const summary = useMemo(() => computeMaterialSummary(filtered, qualityMetrics), [filtered, qualityMetrics]);
  const charts = useMemo(() => buildMaterialCharts(filtered), [filtered]);
  const vendorRows = useMemo(() => buildVendorAvlRows(filtered), [filtered]);

  const resetFilters = () => {
    setFilterType('all');
    setFilterQc('all');
    setFilterCompliance('all');
    setFilterMaterial('');
    setFilterBatch('');
    setFilterManufacturer('');
    setFilterSupplier('');
    setFilterAvl('all');
    setFilterRisk('all');
    setFilterSearch('');
  };

  const tableColumns: ColumnDef<TableRow>[] = [
    { key: 'srNo', header: 'Sr. No.' },
    { key: 'materialName', header: 'Material Name' },
    { key: 'materialType', header: 'Type' },
    { key: 'manufacturerName', header: 'Manufacturer' },
    { key: 'supplierName', header: 'Supplier' },
    { key: 'arNumber', header: 'AR No.' },
    { key: 'materialLotNumber', header: 'Lot No.', render: (r) => r.materialLotNumber || '—' },
    { key: 'batchNumber', header: 'FP Batch', render: (r) => r.batchNumber || '—' },
    { key: 'usedQuantity', header: 'Qty Used', render: (r) => formatQty(r.usedQuantity, r.unit) },
    { key: 'variancePct', header: 'Variance %', render: (r) => formatVariance(r.variancePct) },
    { key: 'qcStatus', header: 'QC Status', render: (r) => <QcStatusBadge status={r.qcStatus} /> },
    { key: 'vendorAvlStatus', header: 'AVL', render: (r) => <AvlStatusBadge status={r.vendorAvlStatus} /> },
    { key: 'complianceStatus', header: 'Compliance', render: (r) => <ComplianceBadge status={r.complianceStatus} /> },
    { key: 'riskLevel', header: 'Risk', render: (r) => <MaterialRiskBadge level={r.riskLevel} /> },
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

  const toTable = (rows: PqrMaterialReviewRecord[]): TableRow[] => rows.map((r, i) => ({ ...r, srNo: i + 1 }));

  const handlePull = async () => {
    if (!selectedPqr) return;
    setBusy(true);
    const { created, skipped, error: err } = await pullMaterialData(selectedPqr, actor);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success(`${created} material lot(s) pulled (${skipped} already linked)`);
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const handleSaveForm = async (data: MaterialReviewFormData): Promise<void> => {
    if (!selectedPqr) return;
    setBusy(true);
    const result = editRecord?.id
      ? await updateMaterialReviewRecord(editRecord.id, selectedPqr, data, actor)
      : await createMaterialReviewRecord(selectedPqr, data, actor);
    setBusy(false);
    if (result.error) { toast.error(result.error); return; }
    toast.success(editRecord ? 'Material updated' : 'Material added');
    setFormOpen(false);
    setEditRecord(null);
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const handleSaveSection = async () => {
    if (!selectedPqr) return;
    setBusy(true);
    const { error: err } = await saveMaterialSectionToPqr(selectedPqr.id, narrative, records, actor);
    setBusy(false);
    if (err) toast.error(err);
    else {
      setNarrativeDirty(false);
      toast.success('Material section saved to PQR');
    }
  };

  const handleRecalc = async () => {
    if (!selectedPqr) return;
    setBusy(true);
    const { updated, error: err } = await recalculateAllCompliance(selectedPqr.id, actor);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success(`Compliance recalculated for ${updated} lot(s)`);
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleteId || !selectedPqr) return;
    setBusy(true);
    const { error: err } = await softDeleteMaterialReviewRecord(deleteId, actor);
    setBusy(false);
    setDeleteId(null);
    if (err) { toast.error(err); return; }
    toast.success('Material record removed');
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const exportCsv = () => {
    if (!filtered.length) return toast.info('No material records to export');
    exportMaterialReviewCsv(filtered, selectedPqr?.pqrNumber);
    void logMaterialReviewExport(actor, 'csv');
    toast.success('Material review exported as CSV');
  };

  const sectionNav = useMemo(() => {
    const idx = PQR_SECTION_FLOW.findIndex((s) => s.key === 'materials');
    const prev = PQR_SECTION_FLOW[idx - 1];
    const next = PQR_SECTION_FLOW[idx + 1];
    return {
      prev: prev ? { ...prev, href: pqrSectionHref(prev.href, selectedPqrId) } : null,
      next: next ? { ...next, href: pqrSectionHref(next.href, selectedPqrId) } : null,
    };
  }, [selectedPqrId]);

  if (loading) return <MaterialReviewAccessGuard><div className="p-4 sm:p-6"><LoadingSkeleton rows={3} /></div></MaterialReviewAccessGuard>;
  if (error) return <MaterialReviewAccessGuard><div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={() => void loadPqrs()} /></div></MaterialReviewAccessGuard>;

  return (
    <MaterialReviewAccessGuard>
      <div className="space-y-6 p-4 sm:p-6">
        <CpvPageHeader
          title="Material Review"
          description="Review API and raw materials for the selected Annual PQR using Material Master, warehouse, and linked QMS records"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'PQR Management', href: '/pqr/dashboard' },
            { label: 'Material Review' },
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
                    Pull Materials
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void handleRecalc()} disabled={busy}>Recalc Compliance</Button>
                </>
              )}
              {canAdd && selectedPqr && (
                <Button size="sm" onClick={() => { setEditRecord(null); setFormOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Material</Button>
              )}
            </>
          )}
        />

        <div className="flex flex-wrap gap-2 text-sm">
          {PQR_SECTION_FLOW.filter((s) => !['dashboard', 'create'].includes(s.key)).map((s) => (
            <Link
              key={s.key}
              href={pqrSectionHref(s.href, selectedPqrId)}
              className={`rounded-md border px-2.5 py-1 ${s.key === 'materials' ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-slate-50'}`}
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
          <EmptyState title="Select a PQR" message="Choose a PQR to review materials for the annual review period." />
        ) : (
          <>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-12">
              <KpiCard label="Total Lots" value={summary.totalMaterialLots} />
              <KpiCard label="Materials" value={summary.uniqueMaterials} />
              <KpiCard label="API Lots" value={summary.totalApiLots} />
              <KpiCard label="Raw Lots" value={summary.totalRawMaterialLots} />
              <KpiCard label="Approved" value={summary.approvedLots} tone="green" />
              <KpiCard label="Rejected" value={summary.rejectedLots} tone="red" />
              <KpiCard label="Pending" value={summary.pendingLots} tone="amber" />
              <KpiCard label="Accept %" value={`${summary.acceptancePct}%`} tone="green" />
              <KpiCard label="Non-Compliant" value={summary.nonCompliantLots} tone="red" />
              <KpiCard label="Expired/Retest" value={summary.expiredMaterials + summary.retestDueMaterials} tone="amber" />
              <KpiCard label="OOS / Dev / CAPA" value={`${summary.materialOosCount}/${summary.materialDeviationCount}/${summary.materialCapaCount}`} />
              <KpiCard label="Suppliers" value={summary.uniqueSuppliers} />
            </div>

            <Card><CardContent className="pt-6">
              <div className="flex flex-wrap gap-2">
                <Input
                  placeholder="Search material / AR / lot"
                  className="w-full sm:w-[200px]"
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  aria-label="Search materials"
                />
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-[160px]" aria-label="Filter material type"><SelectValue placeholder="Material Type" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All Types</SelectItem>{PQR_MATERIAL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={filterQc} onValueChange={setFilterQc}>
                  <SelectTrigger className="w-[140px]" aria-label="Filter QC status"><SelectValue placeholder="QC Status" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All QC</SelectItem>{PQR_QC_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={filterCompliance} onValueChange={setFilterCompliance}>
                  <SelectTrigger className="w-[160px]" aria-label="Filter compliance"><SelectValue placeholder="Compliance" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Compliance</SelectItem>
                    <SelectItem value="Complies">Complies</SelectItem>
                    <SelectItem value="Does Not Comply">Does Not Comply</SelectItem>
                  </SelectContent>
                </Select>
                <Input placeholder="Material name" className="w-[140px]" value={filterMaterial} onChange={(e) => setFilterMaterial(e.target.value)} />
                <Input placeholder="Batch / lot" className="w-[130px]" value={filterBatch} onChange={(e) => setFilterBatch(e.target.value)} />
                <Input placeholder="Manufacturer" className="w-[130px]" value={filterManufacturer} onChange={(e) => setFilterManufacturer(e.target.value)} />
                <Input placeholder="Supplier" className="w-[120px]" value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)} />
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

            <Tabs defaultValue="api">
              <TabsList className="flex flex-wrap h-auto">
                <TabsTrigger value="api">API Review ({apiRecords.length})</TabsTrigger>
                <TabsTrigger value="raw">Raw Material Review ({rawRecords.length})</TabsTrigger>
                <TabsTrigger value="vendor">Vendor AVL</TabsTrigger>
                <TabsTrigger value="compliance">Compliance</TabsTrigger>
                <TabsTrigger value="charts">Charts</TabsTrigger>
                <TabsTrigger value="narrative">Narrative</TabsTrigger>
              </TabsList>

              <TabsContent value="api" className="mt-4">
                <Card><CardContent className="pt-6 overflow-x-auto">
                  {apiRecords.length ? (
                    <ResponsiveDataTable columns={tableColumns} data={toTable(apiRecords)} searchKeys={['materialName', 'arNumber', 'manufacturerName']} mobileTitleKey="materialName" mobileSubtitleKey="arNumber" pageSize={15} />
                  ) : <EmptyState title="No API records" message="Pull materials from monitoring/warehouse for linked batches, or add manually." />}
                </CardContent></Card>
              </TabsContent>

              <TabsContent value="raw" className="mt-4">
                <Card><CardContent className="pt-6 overflow-x-auto">
                  {rawRecords.length ? (
                    <ResponsiveDataTable columns={tableColumns} data={toTable(rawRecords)} searchKeys={['materialName', 'arNumber', 'supplierName']} mobileTitleKey="materialName" mobileSubtitleKey="supplierName" pageSize={15} />
                  ) : <EmptyState title="No raw material records" message="Pull materials or add manually." />}
                </CardContent></Card>
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
                    ) : <EmptyState title="No vendor data" message="Material records will populate vendor AVL summary." />}
                  </CardContent>
                </Card>
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
                      {!filtered.some((r) => (r.complianceReasons || []).length) && <p className="text-muted-foreground">All materials comply.</p>}
                    </CardContent></Card>
                </div>
              </TabsContent>

              <TabsContent value="charts" className="mt-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <SafeChart title="Material Type Distribution" empty={!charts.materialTypeDistribution.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart><Pie data={charts.materialTypeDistribution} dataKey="value" nameKey="name" outerRadius={70} label>
                        {charts.materialTypeDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie><Tooltip /></PieChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Approved / Rejected / Pending" empty={!charts.approvedVsRejected.some((d) => d.value > 0)}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={charts.approvedVsRejected}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="value" fill="#2563eb" /></BarChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Vendor-wise Material Usage" empty={!charts.vendorUsage.length}>
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
                  <SafeChart title="Material Risk Distribution" empty={!charts.riskDistribution.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart><Pie data={charts.riskDistribution} dataKey="value" nameKey="name" outerRadius={70} label>
                        {charts.riskDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie><Tooltip /></PieChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Retest Due Trend" empty={!charts.retestDueTrend.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={charts.retestDueTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Line type="monotone" dataKey="count" stroke="#d97706" /></LineChart>
                    </ResponsiveContainer>
                  </SafeChart>
                </div>
              </TabsContent>

              <TabsContent value="narrative" className="mt-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <CardTitle className="text-base">PQR Section Narrative — API / Raw Material Review</CardTitle>
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
                      aria-label="Material review narrative"
                      onChange={(e) => {
                        setNarrative(e.target.value);
                        setNarrativeDirty(true);
                        if (selectedPqr) logMaterialNarrativeEdit(actor, selectedPqr.id);
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
          <MaterialReviewFormDialog open={formOpen} onOpenChange={setFormOpen} pqr={selectedPqr} record={editRecord} onSubmit={handleSaveForm} loading={busy} />
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
                    ['Material Type', detailRecord.materialType],
                    ['Material Code', detailRecord.materialCode || '—'],
                    ['FP Batch', detailRecord.batchNumber || '—'],
                    ['Lot No.', detailRecord.materialLotNumber || '—'],
                    ['Manufacturer', detailRecord.manufacturerName],
                    ['Supplier', detailRecord.supplierName],
                    ['AR No.', detailRecord.arNumber],
                    ['GRN', detailRecord.grnNumber || '—'],
                    ['Received', formatQty(detailRecord.receivedQuantity, detailRecord.unit)],
                    ['Issued', formatQty(detailRecord.issuedQuantity, detailRecord.unit)],
                    ['Used', formatQty(detailRecord.usedQuantity, detailRecord.unit)],
                    ['Variance %', formatVariance(detailRecord.variancePct)],
                    ['MFG / EXP', `${detailRecord.mfgDate || '—'} / ${detailRecord.expDate || '—'}`],
                    ['Retest', detailRecord.retestDate || '—'],
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
                  <ComplianceBadge status={detailRecord.complianceStatus} />
                  <MaterialRiskBadge level={detailRecord.riskLevel} />
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
                </div>
                {detailRecord.id && canManage && selectedPqr && (
                  <AttachmentUploader
                    onUpload={(file) => uploadMaterialAttachment(selectedPqr.id, detailRecord.id!, file, actor)}
                  />
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        <ConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Remove Material Record"
          description="This will soft-delete the material review record." confirmLabel="Remove" destructive loading={busy} onConfirm={handleDelete} />
      </div>
    </MaterialReviewAccessGuard>
  );
}
