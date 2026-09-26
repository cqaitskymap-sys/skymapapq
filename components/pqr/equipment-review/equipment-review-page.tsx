'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronLeft, ChevronRight, Download, Eye, FileSpreadsheet, Loader2, Pencil, Plus, RefreshCw, Save, Trash2,
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
  MANUFACTURING_CATEGORIES, PACKING_CATEGORIES, PQR_CALIBRATION_STATUSES,
  PQR_EQUIPMENT_CATEGORIES, PQR_PM_STATUSES, PQR_QUALIFICATION_STATUSES, PQR_RISK_LEVELS,
  QC_CATEGORIES, UTILITY_CATEGORIES,
  canAddEquipmentReview, canExportEquipmentReview, canManageEquipmentReview,
  computeEquipmentSummary, filterEquipmentReviewRecords,
  type EquipmentReviewFormData, type PqrEquipmentReviewRecord,
} from '@/lib/pqr-equipment-review-records';
import {
  buildEquipmentCharts, createEquipmentReviewRecord, exportEquipmentReviewCsv,
  fetchEquipmentQualityMetrics, fetchEquipmentReviewRecords,
  fetchPqrOptions, getEquipmentReviewNarrative, logEquipmentNarrativeEdit,
  logEquipmentReviewExport, logEquipmentReviewView, pullEquipmentData,
  recalculateAllEquipmentCompliance, saveEquipmentSectionToPqr,
  softDeleteEquipmentReviewRecord, updateEquipmentReviewRecord,
} from '@/lib/pqr-equipment-review-service';
import { fetchProducts } from '@/lib/admin/product-service';
import { fetchBatches } from '@/lib/admin/batch-service';
import { fetchCpvProducts } from '@/lib/cpv-product-master-service';
import { isCpvProductOperational } from '@/lib/cpv-product-master';
import { fetchCpvBatches, filterCpvBatchesForProduct } from '@/lib/cpv-batch-registration-service';
import { listSelectableEquipment } from '@/lib/equipment-mgmt-service';
import type { EquipmentRecord } from '@/lib/equipment-mgmt-types';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EquipmentReviewAccessGuard } from './equipment-review-access-guard';
import { EquipmentReviewFormDialog } from './equipment-review-form-dialog';
import {
  CalibrationBadge, EquipmentComplianceBadge, PmBadge, QualificationBadge,
} from './equipment-review-badges';
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

type TableRow = PqrEquipmentReviewRecord & { srNo: number };

export function EquipmentReviewPage() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isCpvContext = pathname?.startsWith('/cpv') ?? false;
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canManage = canManageEquipmentReview(role);
  const canAdd = canAddEquipmentReview(role);
  const canExport = canExportEquipmentReview(role);

  const [pqrs, setPqrs] = useState<PqrOption[]>([]);
  const [selectedPqrId, setSelectedPqrId] = useState('');
  const [records, setRecords] = useState<PqrEquipmentReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [narrative, setNarrative] = useState('');
  const [narrativeDirty, setNarrativeDirty] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<PqrEquipmentReviewRecord | null>(null);
  const [detailRecord, setDetailRecord] = useState<PqrEquipmentReviewRecord | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [filterCategory, setFilterCategory] = useState('all');
  const [filterQual, setFilterQual] = useState('all');
  const [filterCal, setFilterCal] = useState('all');
  const [filterPm, setFilterPm] = useState('all');
  const [filterRisk, setFilterRisk] = useState('all');
  const [filterDept, setFilterDept] = useState('');
  const [filterName, setFilterName] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [qualityMetrics, setQualityMetrics] = useState({
    equipmentDeviations: 0, equipmentOos: 0, equipmentCapa: 0, equipmentChangeControls: 0,
  });
  const [productNames, setProductNames] = useState<string[]>([]);
  const [equipmentMaster, setEquipmentMaster] = useState<EquipmentRecord[]>([]);
  const [batchByProduct, setBatchByProduct] = useState<Record<string, string[]>>({});

  const narrativeAuditTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'System',
    role,
  }), [user?.uid, profile?.full_name, profile?.email, role]);

  const selectedPqr = useMemo(() => pqrs.find((p) => p.id === selectedPqrId) || null, [pqrs, selectedPqrId]);

  const syncPqrIdToUrl = useCallback((pqrId: string) => {
    if (!pqrId || isCpvContext) return;
    const params = new URLSearchParams(searchParams?.toString() || '');
    if (params.get('pqrId') === pqrId) return;
    params.set('pqrId', pqrId);
    router.replace(`/pqr/equipment-review?${params.toString()}`, { scroll: false });
  }, [router, searchParams, isCpvContext]);

  const loadPqrs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!isFirebaseConfigured()) { setError('Firebase is not configured.'); return; }
      if (isCpvContext) {
        const products = (await fetchCpvProducts()).filter((p) => isCpvProductOperational(p.cpvStatus));
        const year = new Date().getFullYear();
        const opts: PqrOption[] = products.map((p) => ({
          id: `cpv:${p.id}`,
          pqrNumber: p.productCode || p.productName,
          productName: p.productName,
          productCode: p.productCode,
          genericName: p.genericName || '',
          strength: p.strength || '',
          dosageForm: p.dosageForm || '',
          reviewPeriodFrom: '',
          reviewPeriodTo: '',
          reviewYear: year,
          status: p.cpvStatus,
        }));
        setPqrs(opts);
        setProductNames(products.map((p) => p.productName).filter(Boolean).sort((a, b) => a.localeCompare(b)));
        const batches = await fetchCpvBatches();
        const map: Record<string, string[]> = {};
        products.forEach((p) => {
          const numbers = filterCpvBatchesForProduct(batches, p.productName, p.id)
            .map((b) => b.batchNumber)
            .filter(Boolean);
          if (p.productName) map[p.productName] = numbers;
        });
        setBatchByProduct(map);
        if (!selectedPqrId && opts.length) setSelectedPqrId(opts[0].id);
        return;
      }
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
    } catch { setError(isCpvContext ? 'Failed to load CPV products.' : 'Failed to load PQR records.'); }
    finally { setLoading(false); }
  }, [selectedPqrId, searchParams, syncPqrIdToUrl, isCpvContext]);

  const loadRecords = useCallback(async (pqrId: string, pqr?: PqrOption | null) => {
    if (!pqrId) return;
    setBusy(true);
    try {
      const rows = await fetchEquipmentReviewRecords(pqrId);
      setRecords(rows);
      setNarrative(getEquipmentReviewNarrative(rows));
      setNarrativeDirty(false);
      if (pqr) {
        const metrics = await fetchEquipmentQualityMetrics(pqr, rows);
        setQualityMetrics(metrics);
      }
    } catch { toast.error('Failed to load equipment records'); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void loadPqrs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const viewLogged = useRef(false);
  useEffect(() => {
    if (viewLogged.current || actor.id === 'system') return;
    viewLogged.current = true;
    void logEquipmentReviewView(actor);
  }, [actor]);

  useEffect(() => {
    const loadProductMaster = async () => {
      if (isCpvContext) return;
      try {
        const products = await fetchProducts();
        setProductNames(
          Array.from(new Set(
            products
              .map((item) => item.productName?.trim())
              .filter((name): name is string => Boolean(name)),
          )).sort((a, b) => a.localeCompare(b)),
        );
      } catch {
        setProductNames([]);
      }
    };
    void loadProductMaster();
  }, [isCpvContext]);

  useEffect(() => {
    const loadEquipmentMaster = async () => {
      try {
        const rows = await listSelectableEquipment();
        setEquipmentMaster(rows);
      } catch {
        setEquipmentMaster([]);
      }
    };
    void loadEquipmentMaster();
  }, []);

  useEffect(() => {
    const loadBatches = async () => {
      if (isCpvContext) return;
      try {
        const rows = await fetchBatches();
        const map: Record<string, string[]> = {};
        rows.forEach((row) => {
          const productName = (row.productName || '').trim();
          const batchNumber = (row.batchNumber || '').trim();
          if (!productName || !batchNumber) return;
          if (!map[productName]) map[productName] = [];
          if (!map[productName].includes(batchNumber)) map[productName].push(batchNumber);
        });
        Object.keys(map).forEach((key) => map[key].sort((a, b) => b.localeCompare(a)));
        setBatchByProduct(map);
      } catch {
        setBatchByProduct({});
      }
    };
    void loadBatches();
  }, [isCpvContext]);

  useEffect(() => {
    if (selectedPqrId) {
      void loadRecords(selectedPqrId, selectedPqr);
      syncPqrIdToUrl(selectedPqrId);
    }
  }, [selectedPqrId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (narrativeAuditTimer.current) clearTimeout(narrativeAuditTimer.current);
  }, []);

  const filtered = useMemo(() => filterEquipmentReviewRecords(records, {
    category: filterCategory,
    qualification: filterQual,
    calibration: filterCal,
    pm: filterPm,
    risk: filterRisk,
    department: filterDept,
    name: filterName,
    search: filterSearch,
  }), [records, filterCategory, filterQual, filterCal, filterPm, filterRisk, filterDept, filterName, filterSearch]);

  const mfgRecords = useMemo(() => filtered.filter((r) => MANUFACTURING_CATEGORIES.includes(r.equipmentCategory)), [filtered]);
  const packRecords = useMemo(() => filtered.filter((r) => PACKING_CATEGORIES.includes(r.equipmentCategory)), [filtered]);
  const utilityRecords = useMemo(() => filtered.filter((r) => UTILITY_CATEGORIES.includes(r.equipmentCategory)), [filtered]);
  const qcRecords = useMemo(() => filtered.filter((r) => QC_CATEGORIES.includes(r.equipmentCategory)), [filtered]);
  const summary = useMemo(() => computeEquipmentSummary(filtered, {
    equipmentDeviations: qualityMetrics.equipmentDeviations,
    equipmentCapa: qualityMetrics.equipmentCapa,
    equipmentChangeControls: qualityMetrics.equipmentChangeControls,
  }), [filtered, qualityMetrics]);
  const charts = useMemo(() => buildEquipmentCharts(filtered), [filtered]);

  const sectionNav = useMemo(() => {
    const idx = PQR_SECTION_FLOW.findIndex((s) => s.key === 'equipment');
    const prev = PQR_SECTION_FLOW[idx - 1];
    const next = PQR_SECTION_FLOW[idx + 1];
    return {
      prev: prev ? { ...prev, href: pqrSectionHref(prev.href, selectedPqrId) } : null,
      next: next ? { ...next, href: pqrSectionHref(next.href, selectedPqrId) } : null,
    };
  }, [selectedPqrId]);

  const resetFilters = () => {
    setFilterCategory('all');
    setFilterQual('all');
    setFilterCal('all');
    setFilterPm('all');
    setFilterRisk('all');
    setFilterDept('');
    setFilterName('');
    setFilterSearch('');
  };

  const tableColumns: ColumnDef<TableRow>[] = [
    { key: 'srNo', header: 'Sr. No.' },
    { key: 'product', header: 'Product Name' },
    { key: 'batchNumber', header: 'Batch Number', render: (r) => r.batchNumber || (r.batchesUsed?.[0] || '—') },
    { key: 'manufacturingLine', header: 'Manufacturing Line', render: (r) => r.manufacturingLine || '—' },
    { key: 'equipmentName', header: 'Equipment Name' },
    { key: 'equipmentId', header: 'Equipment ID' },
    { key: 'qualificationStatus', header: 'Qualification', render: (r) => <QualificationBadge status={r.qualificationStatus} /> },
    {
      key: 'actions', header: 'Action',
      render: (r) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label={`View ${r.equipmentName}`} onClick={() => setDetailRecord(r)}><Eye className="h-4 w-4" /></Button>
          {canManage && (
            <>
              <Button variant="ghost" size="icon" aria-label={`Edit ${r.equipmentName}`} onClick={() => { setEditRecord(r); setFormOpen(true); }}><Pencil className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" aria-label={`Remove ${r.equipmentName}`} onClick={() => setDeleteId(r.id || null)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const toTable = (rows: PqrEquipmentReviewRecord[]): TableRow[] => rows.map((r, i) => ({ ...r, srNo: i + 1 }));
  const renderTable = (rows: PqrEquipmentReviewRecord[], emptyTitle: string) => (
    rows.length ? (
      <ResponsiveDataTable columns={tableColumns} data={toTable(rows)} searchKeys={['equipmentName', 'equipmentId', 'product', 'batchNumber', 'manufacturingLine']} mobileTitleKey="equipmentName" mobileSubtitleKey="equipmentId" pageSize={15} />
    ) : <EmptyState title={emptyTitle} message="Pull equipment data or add manually." />
  );

  const handlePull = async () => {
    if (!selectedPqr) return;
    setBusy(true);
    const { created, skipped, error: err } = await pullEquipmentData(selectedPqr, actor);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success(`${created} equipment record(s) pulled (${skipped} skipped)`);
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const handleSaveForm = async (data: EquipmentReviewFormData): Promise<void> => {
    if (!selectedPqr) return;
    setBusy(true);
    const result = editRecord?.id
      ? await updateEquipmentReviewRecord(editRecord.id, selectedPqr, data, actor)
      : await createEquipmentReviewRecord(selectedPqr, data, actor);
    setBusy(false);
    if (result.error) { toast.error(result.error); return; }
    toast.success(editRecord ? 'Equipment updated' : 'Equipment added');
    setFormOpen(false);
    setEditRecord(null);
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const handleSaveSection = async () => {
    if (!selectedPqr) return;
    setBusy(true);
    const { error: err } = await saveEquipmentSectionToPqr(selectedPqr.id, narrative, records, actor);
    setBusy(false);
    if (err) toast.error(err);
    else {
      setNarrativeDirty(false);
      toast.success('Equipment section saved to PQR');
    }
  };

  const handleRecalc = async () => {
    if (!selectedPqr) return;
    setBusy(true);
    const { updated, error: err } = await recalculateAllEquipmentCompliance(selectedPqr.id, actor);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success(`Compliance and risk recalculated for ${updated} equipment item(s)`);
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleteId || !selectedPqr) return;
    setBusy(true);
    const { error: err } = await softDeleteEquipmentReviewRecord(deleteId, actor);
    setBusy(false);
    setDeleteId(null);
    if (err) { toast.error(err); return; }
    toast.success('Equipment record removed');
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const exportCsv = () => {
    if (!filtered.length) return toast.info('No equipment records to export');
    exportEquipmentReviewCsv(filtered, selectedPqr?.pqrNumber);
    void logEquipmentReviewExport(actor, 'csv');
    toast.success('Equipment review exported as CSV');
  };

  const onNarrativeChange = (value: string) => {
    setNarrative(value);
    setNarrativeDirty(true);
    if (!selectedPqr) return;
    if (narrativeAuditTimer.current) clearTimeout(narrativeAuditTimer.current);
    narrativeAuditTimer.current = setTimeout(() => {
      void logEquipmentNarrativeEdit(actor, selectedPqr.id);
    }, 1500);
  };

  if (loading) return <EquipmentReviewAccessGuard><div className="p-4 sm:p-6"><LoadingSkeleton rows={3} /></div></EquipmentReviewAccessGuard>;
  if (error) return <EquipmentReviewAccessGuard><div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={() => void loadPqrs()} /></div></EquipmentReviewAccessGuard>;

  return (
    <EquipmentReviewAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="Equipment Review"
          description={isCpvContext
            ? 'Review qualification, calibration, and performance of equipment used for the selected CPV product and its batches.'
            : 'Review qualification, calibration, maintenance and performance of equipment used during the PQR period'}
          trail={isCpvContext
            ? [
                { label: 'Continued Process Verification', href: '/cpv/dashboard' },
                { label: 'Equipment Review' },
              ]
            : [
                { label: 'Dashboard', href: '/dashboard' },
                { label: 'PQR Management', href: '/pqr/dashboard' },
                { label: 'Equipment Review' },
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
                    Pull Equipment
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void handleRecalc()} disabled={busy}>Recalc</Button>
                </>
              )}
              {canAdd && selectedPqr && (
                <Button size="sm" onClick={() => { setEditRecord(null); setFormOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add</Button>
              )}
            </>
          )}
        />

        {isCpvContext ? (
          <div className="no-print flex flex-wrap gap-1.5">
            {[
              { href: '/cpv/product-master', label: 'Product' },
              { href: '/cpv/batch-registration', label: 'Batch' },
              { href: '/cpv/cpp', label: 'CPP' },
              { href: '/cpv/cqa', label: 'CQA' },
              { href: '/cpv/utility-monitoring', label: 'Utility' },
              { href: '/cpv/environmental-monitoring', label: 'Environmental' },
              { href: '/qms/equipment', label: 'Equipment Master' },
              { href: '/admin/audit-trail', label: 'Audit Trail' },
            ].map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900"
              >
                {link.label}
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 text-sm">
            {PQR_SECTION_FLOW.filter((s) => !['dashboard', 'create'].includes(s.key)).map((s) => (
              <Link
                key={s.key}
                href={pqrSectionHref(s.href, selectedPqrId)}
                className={`rounded-md border px-2.5 py-1 ${s.key === 'equipment' ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-slate-50'}`}
              >
                {s.label}
              </Link>
            ))}
          </div>
        )}

        <Card>
          <CardContent className="pt-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="pqr-select-equipment">{isCpvContext ? 'CPV Product *' : 'PQR Number *'}</Label>
                <Select
                  value={selectedPqrId}
                  onValueChange={(id) => {
                    setSelectedPqrId(id);
                    syncPqrIdToUrl(id);
                  }}
                >
                  <SelectTrigger id="pqr-select-equipment"><SelectValue placeholder={isCpvContext ? 'Select CPV product...' : 'Select PQR...'} /></SelectTrigger>
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
                  {selectedPqr.site && (
                    <div>
                      <Label className="text-muted-foreground">Manufacturing Site</Label>
                      <p className="text-sm font-medium">{selectedPqr.site}</p>
                    </div>
                  )}
                  {selectedPqr.status && (
                    <div>
                      <Label className="text-muted-foreground">{isCpvContext ? 'CPV Status' : 'PQR Status'}</Label>
                      <p className="text-sm font-medium capitalize">{selectedPqr.status.replace(/_/g, ' ')}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {!selectedPqr ? (
          <EmptyState title="Select a PQR" message="Choose a PQR to review equipment for the annual review period." />
        ) : (
          <>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-12">
              <KpiCard label="Total Equipment" value={summary.totalEquipmentReviewed} />
              <KpiCard label="Qualified" value={summary.qualifiedEquipment} tone="green" />
              <KpiCard label="Qual Due" value={summary.qualificationDue} tone="amber" />
              <KpiCard label="Cal Due" value={summary.calibrationDue} tone="amber" />
              <KpiCard label="Cal Overdue" value={summary.calibrationOverdue} tone="red" />
              <KpiCard label="PM Due" value={summary.pmDue} tone="amber" />
              <KpiCard label="PM Overdue" value={summary.pmOverdue} tone="red" />
              <KpiCard label="Breakdowns" value={summary.breakdownCount} />
              <KpiCard label="Downtime (h)" value={summary.totalDowntimeHours ?? 0} />
              <KpiCard label="Deviations" value={summary.equipmentDeviations} />
              <KpiCard label="OOS / CAPA" value={`${qualityMetrics.equipmentOos}/${summary.equipmentCapa}`} />
              <KpiCard label="Critical Risks" value={summary.criticalEquipmentRisks} tone="red" />
            </div>

            <Card><CardContent className="pt-6">
              <div className="flex flex-wrap gap-2">
                <Input
                  placeholder="Search equipment"
                  className="w-full sm:w-[180px]"
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  aria-label="Search equipment"
                />
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger className="w-[170px]" aria-label="Filter category"><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All Categories</SelectItem>{PQR_EQUIPMENT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={filterQual} onValueChange={setFilterQual}>
                  <SelectTrigger className="w-[150px]" aria-label="Filter qualification"><SelectValue placeholder="Qualification" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All Qual</SelectItem>{PQR_QUALIFICATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={filterCal} onValueChange={setFilterCal}>
                  <SelectTrigger className="w-[150px]" aria-label="Filter calibration"><SelectValue placeholder="Calibration" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All Cal</SelectItem>{PQR_CALIBRATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={filterPm} onValueChange={setFilterPm}>
                  <SelectTrigger className="w-[130px]" aria-label="Filter PM"><SelectValue placeholder="PM" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All PM</SelectItem>{PQR_PM_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={filterRisk} onValueChange={setFilterRisk}>
                  <SelectTrigger className="w-[120px]" aria-label="Filter risk"><SelectValue placeholder="Risk" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All Risk</SelectItem>{PQR_RISK_LEVELS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder="Equipment" className="w-[130px]" value={filterName} onChange={(e) => setFilterName(e.target.value)} aria-label="Filter equipment name" />
                <Input placeholder="Department" className="w-[120px]" value={filterDept} onChange={(e) => setFilterDept(e.target.value)} aria-label="Filter department" />
                <Button variant="outline" size="sm" onClick={resetFilters}>Reset</Button>
                <Button variant="outline" size="icon" aria-label="Refresh" onClick={() => void loadRecords(selectedPqrId, selectedPqr)} disabled={busy}>
                  <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </CardContent></Card>

            <Tabs defaultValue="mfg">
              <TabsList className="flex flex-wrap h-auto">
                <TabsTrigger value="mfg">Manufacturing</TabsTrigger>
                <TabsTrigger value="pack">Packing</TabsTrigger>
                <TabsTrigger value="utility">Utility</TabsTrigger>
                <TabsTrigger value="qc">QC Equipment</TabsTrigger>
                <TabsTrigger value="qual">Qualification</TabsTrigger>
                <TabsTrigger value="cal">Calibration</TabsTrigger>
                <TabsTrigger value="pm">PM Review</TabsTrigger>
                <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
                <TabsTrigger value="compliance">Compliance</TabsTrigger>
                <TabsTrigger value="charts">Charts</TabsTrigger>
                <TabsTrigger value="narrative">Narrative</TabsTrigger>
              </TabsList>

              <TabsContent value="mfg" className="mt-4"><Card><CardContent className="pt-6 overflow-x-auto">{renderTable(mfgRecords, 'No manufacturing equipment')}</CardContent></Card></TabsContent>
              <TabsContent value="pack" className="mt-4"><Card><CardContent className="pt-6 overflow-x-auto">{renderTable(packRecords, 'No packing equipment')}</CardContent></Card></TabsContent>
              <TabsContent value="utility" className="mt-4"><Card><CardContent className="pt-6 overflow-x-auto">{renderTable(utilityRecords, 'No utility equipment')}</CardContent></Card></TabsContent>
              <TabsContent value="qc" className="mt-4"><Card><CardContent className="pt-6 overflow-x-auto">{renderTable(qcRecords, 'No QC equipment')}</CardContent></Card></TabsContent>

              <TabsContent value="qual" className="mt-4">
                <Card><CardHeader><CardTitle className="text-base">Qualification Review</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b bg-slate-50">
                        {['Equipment', 'IQ', 'OQ', 'PQ', 'Status'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {filtered.map((r) => (
                          <tr key={r.id} className="border-b">
                            <td className="px-3 py-2">{r.equipmentName}</td>
                            <td className="px-3 py-2">{r.iqStatus || '—'}</td>
                            <td className="px-3 py-2">{r.oqStatus || '—'}</td>
                            <td className="px-3 py-2">{r.pqStatus || '—'}</td>
                            <td className="px-3 py-2"><QualificationBadge status={r.qualificationStatus} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!filtered.length && <EmptyState title="No qualification data" message="Pull equipment data to populate qualification review." />}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="cal" className="mt-4">
                <Card><CardHeader><CardTitle className="text-base">Calibration Review</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b bg-slate-50">
                        {['Equipment', 'Last Cal', 'Next Cal', 'Status'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {filtered.map((r) => (
                          <tr key={r.id} className="border-b">
                            <td className="px-3 py-2">{r.equipmentName}</td>
                            <td className="px-3 py-2">{r.lastCalibrationDate || '—'}</td>
                            <td className="px-3 py-2">{r.nextCalibrationDate || '—'}</td>
                            <td className="px-3 py-2"><CalibrationBadge status={r.calibrationStatus} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!filtered.length && <EmptyState title="No calibration data" message="Pull equipment data to populate calibration review." />}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="pm" className="mt-4">
                <Card><CardHeader><CardTitle className="text-base">PM Review</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b bg-slate-50">
                        {['Equipment', 'Last PM', 'Next PM', 'Status'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {filtered.map((r) => (
                          <tr key={r.id} className="border-b">
                            <td className="px-3 py-2">{r.equipmentName}</td>
                            <td className="px-3 py-2">{r.lastPmDate || '—'}</td>
                            <td className="px-3 py-2">{r.nextPmDate || '—'}</td>
                            <td className="px-3 py-2"><PmBadge status={r.pmStatus} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!filtered.length && <EmptyState title="No PM data" message="Pull equipment data to populate PM review." />}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="breakdown" className="mt-4">
                <Card><CardHeader><CardTitle className="text-base">Breakdown Analysis</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {filtered.filter((r) => r.breakdownCount > 0).map((r) => (
                      <p key={r.id}>{r.equipmentName}: {r.breakdownCount} breakdown(s), {r.downtimeHours}h downtime — {r.impactOnProduct}</p>
                    ))}
                    {!filtered.some((r) => r.breakdownCount > 0) && (
                      <p className="text-muted-foreground">No breakdowns recorded during the review period.</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="compliance" className="mt-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Card><CardHeader><CardTitle className="text-sm">Compliant Equipment</CardTitle></CardHeader>
                    <CardContent>{filtered.filter((r) => r.complianceStatus === 'Complies').length} of {filtered.length}</CardContent></Card>
                  <Card><CardHeader><CardTitle className="text-sm">Observation Summary</CardTitle></CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {['Complies', 'Observation', 'Major Observation', 'Critical Observation'].map((s) => (
                        <p key={s}>{s}: {filtered.filter((r) => r.complianceStatus === s).length}</p>
                      ))}
                      {(summary.cleaningIssues ?? 0) > 0 && <p>Cleaning issues: {summary.cleaningIssues}</p>}
                      {(summary.validationIssues ?? 0) > 0 && <p>Validation issues: {summary.validationIssues}</p>}
                      <p>Change controls: {summary.equipmentChangeControls}</p>
                    </CardContent></Card>
                </div>
              </TabsContent>

              <TabsContent value="charts" className="mt-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <SafeChart title="Qualification Status" empty={!charts.qualificationStatus.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart><Pie data={charts.qualificationStatus} dataKey="value" nameKey="name" outerRadius={70} label>
                        {charts.qualificationStatus.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie><Tooltip /></PieChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Calibration Compliance Trend" empty={!charts.calibrationComplianceTrend.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={charts.calibrationComplianceTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Legend />
                        <Line type="monotone" dataKey="compliant" stroke="#059669" /><Line type="monotone" dataKey="nonCompliant" stroke="#dc2626" /></LineChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="PM Compliance Trend" empty={!charts.pmComplianceTrend.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={charts.pmComplianceTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Legend />
                        <Line type="monotone" dataKey="completed" stroke="#059669" /><Line type="monotone" dataKey="overdue" stroke="#dc2626" /></LineChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Breakdown Trend" empty={!charts.breakdownTrend.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={charts.breakdownTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Line type="monotone" dataKey="count" stroke="#d97706" /></LineChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Risk Distribution" empty={!charts.riskDistribution.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart><Pie data={charts.riskDistribution} dataKey="value" nameKey="name" outerRadius={70} label>
                        {charts.riskDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie><Tooltip /></PieChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Equipment Category Review" empty={!charts.categoryReview.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={charts.categoryReview}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 9 }} /><YAxis /><Tooltip /><Bar dataKey="value" fill="#2563eb" /></BarChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Downtime Trend" empty={!charts.downtimeTrend.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={charts.downtimeTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Line type="monotone" dataKey="hours" stroke="#7c3aed" /></LineChart>
                    </ResponsiveContainer>
                  </SafeChart>
                </div>
              </TabsContent>

              <TabsContent value="narrative" className="mt-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">PQR Section Narrative — Equipment Review</CardTitle>
                    {canManage && !isCpvContext && (
                      <Button size="sm" onClick={() => void handleSaveSection()} disabled={busy || !narrativeDirty}>
                        <Save className="h-4 w-4 mr-1" />Save to PQR
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      className="min-h-[140px]"
                      value={narrative}
                      readOnly={!canManage || isCpvContext}
                      aria-label="Equipment review narrative"
                      onChange={(e) => onNarrativeChange(e.target.value)}
                    />
                    {narrativeDirty && <p className="mt-2 text-xs text-amber-700">Unsaved narrative changes</p>}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              {!isCpvContext && sectionNav.prev ? (
                <Button variant="outline" asChild>
                  <Link href={sectionNav.prev.href}><ChevronLeft className="h-4 w-4 mr-1" />{sectionNav.prev.label}</Link>
                </Button>
              ) : <span />}
              <div className="flex flex-wrap gap-2 text-xs">
                <Link className="text-blue-600 hover:underline" href="/qms/equipment/master">Equipment Master</Link>
                <Link className="text-blue-600 hover:underline" href="/qms/equipment/calibration-records">Calibration</Link>
                <Link className="text-blue-600 hover:underline" href="/qms/equipment/preventive-maintenance">Maintenance</Link>
                <Link className="text-blue-600 hover:underline" href="/qms/equipment/breakdown">Breakdowns</Link>
                <Link className="text-blue-600 hover:underline" href={isCpvContext ? '/cpv/dashboard' : pqrSectionHref('/pqr/dashboard', selectedPqrId)}>{isCpvContext ? 'CPV Dashboard' : 'PQR Dashboard'}</Link>
                <Link className="text-blue-600 hover:underline" href="/qms/deviation">Deviations</Link>
                <Link className="text-blue-600 hover:underline" href="/qms/oos">OOS</Link>
                <Link className="text-blue-600 hover:underline" href="/qms/capa">CAPA</Link>
              </div>
              {!isCpvContext && sectionNav.next ? (
                <Button variant="outline" asChild>
                  <Link href={sectionNav.next.href}>{sectionNav.next.label}<ChevronRight className="h-4 w-4 ml-1" /></Link>
                </Button>
              ) : <span />}
            </div>
          </>
        )}

        {selectedPqr && (
          <EquipmentReviewFormDialog
            open={formOpen}
            onOpenChange={setFormOpen}
            pqr={selectedPqr}
            record={editRecord}
            onSubmit={handleSaveForm}
            loading={busy}
            productNames={productNames}
            equipmentMaster={equipmentMaster}
            batchByProduct={batchByProduct}
          />
        )}

        <Dialog open={!!detailRecord} onOpenChange={() => setDetailRecord(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{detailRecord?.equipmentName}</DialogTitle></DialogHeader>
            {detailRecord && (
              <div className="space-y-4">
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    ['Product Name', detailRecord.product],
                    ['Batch Number', detailRecord.batchNumber || (detailRecord.batchesUsed || []).join(', ') || '—'],
                    ['Manufacturing Line', detailRecord.manufacturingLine || '—'],
                    ['Equipment Name', detailRecord.equipmentName],
                    ['Equipment ID', detailRecord.equipmentId],
                    ['Qualification Status', detailRecord.qualificationStatus],
                  ].map(([k, v]) => (
                    <div key={String(k)}><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{String(v)}</dd></div>
                  ))}
                </dl>
                <div className="flex flex-wrap gap-2">
                  <QualificationBadge status={detailRecord.qualificationStatus} />
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <ConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Remove Equipment Record"
          description="This will soft-delete the equipment review record." confirmLabel="Remove" destructive loading={busy} onConfirm={handleDelete} />
      </div>
    </EquipmentReviewAccessGuard>
  );
}
