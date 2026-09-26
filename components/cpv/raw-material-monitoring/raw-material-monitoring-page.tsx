'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Plus, Download, Eye, Pencil, CheckCircle, Layers, Warehouse, FilterX, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie } from 'recharts';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  summarizeRawMaterialRecords, buildRawMaterialChartSeries, RM_MATERIAL_TYPES, RM_QC_STATUSES,
  RM_COMPLIANCE_STATUSES, rawMaterialMonitoringFormSchema,
  type RawMaterialMonitoringFormData, type RawMaterialMonitoringRecord,
} from '@/lib/cpv-raw-material-monitoring';
import {
  fetchRawMaterialRecords, fetchRmBatchesForProduct, fetchMaterialMasterOptions, fetchVendorOptions,
  createRawMaterialRecord, updateRawMaterialRecord, approveRawMaterialRecord, reviewRawMaterialRecord,
  bulkCreateRawMaterialRecords, importFromWarehouseReceipt, fetchWarehouseReceiptsForImport,
  logRawMaterialExport, softDeleteRawMaterialRecord,
} from '@/lib/cpv-raw-material-monitoring-service';
import { fetchActiveCpvProductsForBatch as fetchProducts } from '@/lib/cpv-batch-registration-service';
import type { CpvProductRecord } from '@/lib/cpv-product-master';
import type { MaterialMaster } from '@/lib/material-schemas';
import type { VendorRecord } from '@/lib/vendor-mgmt-types';
import { downloadCsv, printPage } from '@/lib/export-utils';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { KpiCard, StatusBadge } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ElectronicSignatureDialog } from '@/components/electronic-signatures';
import type { ColumnDef } from '@/components/admin/admin-data-table';
import type { RawMaterialActor } from '@/lib/cpv-raw-material-monitoring-service';

const CHART_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed'];
const FORM_CATEGORY_OPTIONS: Array<{ label: string; value: RawMaterialMonitoringFormData['materialType'] }> = [
  { label: 'API', value: 'API' },
  { label: 'Excipients', value: 'Excipient' },
];

type RawMaterialSaveData = RawMaterialMonitoringFormData & { changeReason: string };

type EsignAction = 'approve' | 'delete' | 'qa-override';

function buildRawMaterialExportRows(records: RawMaterialMonitoringRecord[]) {
  const headers = [
    'RM ID', 'Product Code', 'Product', 'Batch', 'Material Code', 'Material', 'Type',
    'Vendor', 'AR No', 'GRN', 'Lot', 'Issue Qty', 'Unit', 'QC Status', 'Compliance',
    'Risk', 'AVL', 'Review Status', 'MFG', 'EXP', 'Retest', 'OOS Ref', 'Deviation', 'CAPA',
  ];
  const rows = records.map((r) => [
    r.rawMaterialMonitoringId,
    r.productCode,
    r.productName,
    r.batchNumber,
    r.materialCode,
    r.materialName,
    r.materialType,
    r.vendorName,
    r.arNumber,
    r.grnNumber || '',
    r.materialLotNumber || '',
    r.usedQuantity,
    r.unit,
    r.qcStatus,
    r.complianceStatus,
    r.riskLevel,
    r.avlStatus,
    r.reviewStatus,
    r.mfgDate,
    r.expDate,
    r.retestDate || '',
    r.linkedOosNumber || '',
    r.linkedDeviationNumber || '',
    r.linkedCapaNumber || '',
  ]);
  return { headers, rows };
}

async function callReview(id: string, actor: RawMaterialActor, changeReason = 'Submitted for QA review') {
  return reviewRawMaterialRecord(id, actor, changeReason);
}

async function callApprove(
  id: string,
  actor: RawMaterialActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
) {
  return approveRawMaterialRecord(id, actor, changeReason, options);
}

async function callSoftDelete(
  id: string,
  actor: RawMaterialActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
) {
  return softDeleteRawMaterialRecord(id, actor, changeReason, options);
}

async function callLogExport(count: number, actor: RawMaterialActor) {
  await logRawMaterialExport(actor, count);
}

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

function AvlBadge({ status }: { status: string }) {
  const ok = ['Approved', 'Conditional Approved', 'Conditionally Approved'].includes(status);
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>{status}</span>;
}

function mapMaterialType(t: string): RawMaterialMonitoringFormData['materialType'] {
  const map: Record<string, RawMaterialMonitoringFormData['materialType']> = {
    API: 'API', Excipient: 'Excipient', Preservative: 'Preservative', Solvent: 'Solvent',
    Buffer: 'Buffer', 'pH Adjuster': 'pH Adjuster', 'Raw Material': 'Raw Material', Other: 'Other',
  };
  return map[t] || 'Other';
}

export function RawMaterialMonitoringPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const productQuery = searchParams.get('product') || '';
  const batchQuery = searchParams.get('batch') || '';
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canCreate = cpvPermissions.canCreateRawMaterial(role) && !cpvPermissions.isRawMaterialViewOnly(role);
  const canReview = cpvPermissions.canReviewRawMaterial(role);
  const canImportExport = cpvPermissions.canImportExportRawMaterial(role);
  const canQaOverride = cpvPermissions.canReviewRawMaterial(role);
  const isReadOnly = cpvPermissions.isReadOnly(role) || cpvPermissions.isRawMaterialViewOnly(role);

  const [records, setRecords] = useState<RawMaterialMonitoringRecord[]>([]);
  const [products, setProducts] = useState<CpvProductRecord[]>([]);
  const [materials, setMaterials] = useState<MaterialMaster[]>([]);
  const [vendors, setVendors] = useState<VendorRecord[]>([]);
  const [receipts, setReceipts] = useState<Awaited<ReturnType<typeof fetchWarehouseReceiptsForImport>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const [editing, setEditing] = useState<RawMaterialMonitoringRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [approveTarget, setApproveTarget] = useState<RawMaterialMonitoringRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RawMaterialMonitoringRecord | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [esignOpen, setEsignOpen] = useState(false);
  const [esignAction, setEsignAction] = useState<EsignAction>('approve');

  const [search, setSearch] = useState(productQuery || batchQuery);
  const [productFilter, setProductFilter] = useState('all');
  const [batchFilter, setBatchFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [qcFilter, setQcFilter] = useState('all');
  const [complianceFilter, setComplianceFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');

  const [formProductId, setFormProductId] = useState('');
  const [formBatches, setFormBatches] = useState<Awaited<ReturnType<typeof fetchRmBatchesForProduct>>>([]);
  const [form, setForm] = useState<Partial<RawMaterialSaveData>>({ changeReason: '' });
  const [bulkProductId, setBulkProductId] = useState('');
  const [bulkBatchId, setBulkBatchId] = useState('');
  const [bulkReason, setBulkReason] = useState('Bulk raw material entry');
  const [bulkRows, setBulkRows] = useState<Array<{ material: MaterialMaster; used: string; remarks: string }>>([]);
  const [warehouseReceiptId, setWarehouseReceiptId] = useState('');
  const [warehouseUsedQty, setWarehouseUsedQty] = useState('');
  const [warehouseReason, setWarehouseReason] = useState('Warehouse receipt import');

  const actor = { id: user?.uid || 'system', name: profile?.full_name || 'System', role: role || '' };

  useEffect(() => {
    if (productQuery) setSearch(productQuery);
    else if (batchQuery) setSearch(batchQuery);
  }, [productQuery, batchQuery]);

  useEffect(() => {
    if (batchQuery) setBatchFilter(batchQuery);
    if (productQuery) setProductFilter(productQuery);
  }, [batchQuery, productQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, prods, mats, vends, rcpts] = await Promise.all([
        fetchRawMaterialRecords(), fetchProducts(), fetchMaterialMasterOptions(),
        fetchVendorOptions(), fetchWarehouseReceiptsForImport(),
      ]);
      setRecords(rows);
      setProducts(prods);
      setMaterials(mats);
      setVendors(vends);
      setReceipts(rcpts);
    } catch {
      setError('Failed to load raw material records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return records.filter((r) => {
      if (productFilter !== 'all' && r.productName !== productFilter && r.productCode !== productFilter) return false;
      if (batchFilter !== 'all' && r.batchNumber !== batchFilter) return false;
      if (typeFilter !== 'all' && r.materialType !== typeFilter) return false;
      if (qcFilter !== 'all' && r.qcStatus !== qcFilter) return false;
      if (complianceFilter !== 'all' && r.complianceStatus !== complianceFilter) return false;
      if (riskFilter !== 'all' && r.riskLevel !== riskFilter) return false;
      if (!q) return true;
      return r.productName.toLowerCase().includes(q) || r.batchNumber.toLowerCase().includes(q)
        || r.materialName.toLowerCase().includes(q) || r.vendorName.toLowerCase().includes(q)
        || r.arNumber.toLowerCase().includes(q) || r.grnNumber.toLowerCase().includes(q)
        || r.productCode.toLowerCase().includes(q);
    });
  }, [records, search, productFilter, batchFilter, typeFilter, qcFilter, complianceFilter, riskFilter]);

  const clearFilters = () => {
    setSearch('');
    setProductFilter('all');
    setBatchFilter('all');
    setTypeFilter('all');
    setQcFilter('all');
    setComplianceFilter('all');
    setRiskFilter('all');
  };

  const summary = useMemo(() => summarizeRawMaterialRecords(records), [records]);
  const charts = useMemo(() => buildRawMaterialChartSeries(filtered), [filtered]);
  const productNames = useMemo(() => Array.from(new Set(records.map((r) => r.productName))), [records]);
  const batchNumbers = useMemo(() => Array.from(new Set(records.map((r) => r.batchNumber))), [records]);
  const filteredMaterials = useMemo(() => {
    if (!form.materialType || !FORM_CATEGORY_OPTIONS.some((o) => o.value === form.materialType)) return materials;
    return materials.filter((m) => mapMaterialType(m.materialType) === form.materialType);
  }, [materials, form.materialType]);

  const crossLinks = useMemo(() => [
    ...(productQuery
      ? [{ href: `/cpv/product-master?search=${encodeURIComponent(productQuery)}`, label: 'Product Master' }]
      : [{ href: '/cpv/product-master', label: 'Product Master' }]),
    ...(batchQuery
      ? [{ href: `/cpv/batch-registration?search=${encodeURIComponent(batchQuery)}`, label: 'Batch Master' }]
      : [{ href: '/cpv/batch-registration', label: 'Batch Master' }]),
    { href: batchQuery ? `/cpv/cpp?batch=${encodeURIComponent(batchQuery)}` : productQuery ? `/cpv/cpp?product=${encodeURIComponent(productQuery)}` : '/cpv/cpp', label: 'CPP' },
    { href: batchQuery ? `/cpv/cqa?batch=${encodeURIComponent(batchQuery)}` : productQuery ? `/cpv/cqa?product=${encodeURIComponent(productQuery)}` : '/cpv/cqa', label: 'CQA' },
    { href: '/qms/deviation', label: 'Deviation' },
    { href: '/qms/capa', label: 'CAPA' },
    { href: '/admin/audit-trail', label: 'Audit Trail' },
    { href: '/cpv/reports-analytics', label: 'Reports' },
  ], [productQuery, batchQuery]);

  const resolveProductIdFromQuery = useCallback(() => {
    if (!productQuery) return '';
    const match = products.find((p) => p.productCode === productQuery || p.productName === productQuery);
    return match?.id || '';
  }, [productQuery, products]);

  const onProductChange = async (productId: string) => {
    setFormProductId(productId);
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setForm((f) => ({ ...f, cpvProductId: productId, productName: p.productName, productCode: p.productCode }));
    const batches = await fetchRmBatchesForProduct(p.productName);
    setFormBatches(batches);
    if (batchQuery && batches.some((b) => b.batchNumber === batchQuery)) {
      setForm((f) => ({ ...f, batchNumber: batchQuery }));
    }
  };

  const onMaterialChange = (materialId: string) => {
    const m = materials.find((x) => x.id === materialId);
    if (!m) return;
    setForm((f) => ({
      ...f,
      materialCode: m.materialCode,
      materialName: m.materialName,
      materialType: mapMaterialType(m.materialType),
      materialGrade: m.grade,
      specificationNumber: m.specificationNo,
      stpNumber: '',
      unit: f.unit || 'kg',
    }));
  };

  const onVendorChange = (vendorId: string) => {
    const v = vendors.find((x) => x.id === vendorId);
    if (!v) return;
    setForm((f) => ({
      ...f,
      vendorId,
      vendorName: v.vendor_name,
      vendorStatus: v.vendor_status === 'Active' ? 'Active' : v.vendor_status,
      avlStatus: v.approval_status,
      manufacturerName: v.manufacturer_name || f.manufacturerName || v.vendor_name,
      supplierName: v.supplier_name || f.supplierName || v.vendor_name,
    }));
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      mfgDate: '',
      expDate: '',
      retestDate: '',
      grnNumber: '',
      coaNumber: '',
      materialLotNumber: '',
      storageCondition: '',
      testParameter: '',
      testUnit: '',
      lowerLimit: undefined,
      upperLimit: undefined,
      receivedQuantity: 0,
      qcStatus: 'Under Test',
      coaAvailable: 'No',
      issuedQuantity: 0,
      usedQuantity: 0,
      unit: 'kg',
      vendorStatus: 'Active',
      avlStatus: 'Approved',
      changeReason: '',
    });
    const preselectId = resolveProductIdFromQuery();
    if (preselectId) void onProductChange(preselectId);
    else {
      setFormProductId('');
      setFormBatches([]);
    }
    setFormOpen(true);
  };

  const parseFormData = (): RawMaterialSaveData | null => {
    const parsed = rawMaterialMonitoringFormSchema.safeParse({
      ...form,
      changeReason: form.changeReason || (editing ? 'Record updated' : 'Record created'),
      observedResult: undefined,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || 'Validation failed');
      return null;
    }
    return { ...parsed.data, changeReason: parsed.data.changeReason };
  };

  const saveForm = async () => {
    const data = parseFormData();
    if (!data) return;

    const needsQaOverride = Boolean(
      (vendorWarning || (editing?.isLocked && editing.reviewStatus === 'Approved')) && canQaOverride,
    );
    if (needsQaOverride) {
      setEsignAction('qa-override');
      setEsignOpen(true);
      return;
    }

    if (vendorWarning) {
      toast.error('Vendor/AVL not approved — QA override required.');
      return;
    }

    setSubmitting(true);
    const payload = data as RawMaterialMonitoringFormData & { changeReason: string };
    if (editing) {
      const { error: err } = await updateRawMaterialRecord(
        editing.id,
        payload,
        actor,
        editing,
        editing.attachments,
        false,
      );
      if (err) toast.error(err);
      else { toast.success('Record updated'); setFormOpen(false); await load(); }
    } else {
      const { error: err } = await createRawMaterialRecord(payload, actor);
      if (err) toast.error(err);
      else { toast.success('Record created'); setFormOpen(false); await load(); }
    }
    setSubmitting(false);
  };

  const applyQaOverride = async () => {
    const data = parseFormData();
    if (!data) return;
    setSubmitting(true);
    const payload = data as RawMaterialMonitoringFormData & { changeReason: string };
    if (editing) {
      const { error: err } = await updateRawMaterialRecord(
        editing.id,
        payload,
        actor,
        editing,
        editing.attachments,
        true,
        { esignConfirmed: true },
      );
      if (err) toast.error(err);
      else {
        toast.success('Record updated (QA override)');
        setFormOpen(false);
        await load();
      }
    } else {
      const { error: err } = await createRawMaterialRecord(
        payload,
        actor,
        [],
        true,
        { esignConfirmed: true },
      );
      if (err) toast.error(err);
      else {
        toast.success('Record created (QA override)');
        setFormOpen(false);
        await load();
      }
    }
    setSubmitting(false);
    setEsignOpen(false);
  };

  const confirmApprove = () => {
    if (!approveTarget) return;
    if (actionReason.trim().length < 5) {
      toast.error('Change reason must be at least 5 characters');
      return;
    }
    setEsignAction('approve');
    setEsignOpen(true);
  };

  const applyApprove = async () => {
    if (!approveTarget) return;
    setSubmitting(true);
    const { error: err } = await callApprove(approveTarget.id, actor, actionReason, { esignConfirmed: true });
    setSubmitting(false);
    setEsignOpen(false);
    setApproveTarget(null);
    setActionReason('');
    if (err) toast.error(err);
    else {
      toast.success('Record approved');
      await load();
    }
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    if (actionReason.trim().length < 5) {
      toast.error('Change reason must be at least 5 characters');
      return;
    }
    setEsignAction('delete');
    setEsignOpen(true);
  };

  const applyDelete = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    const { error: err } = await callSoftDelete(deleteTarget.id, actor, actionReason, { esignConfirmed: true });
    setSubmitting(false);
    setEsignOpen(false);
    setDeleteTarget(null);
    setActionReason('');
    if (err) toast.error(err);
    else {
      toast.success('Record soft-deleted');
      await load();
    }
  };

  const saveWarehouseImport = async () => {
    const p = products.find((x) => x.id === formProductId);
    const batch = formBatches.find((b) => b.id === bulkBatchId);
    if (!p || !batch || !warehouseReceiptId) { toast.error('Select product, batch and receipt'); return; }
    if (warehouseReason.trim().length < 5) {
      toast.error('Change reason must be at least 5 characters');
      return;
    }
    setSubmitting(true);
    const { error: err } = await importFromWarehouseReceipt(
      warehouseReceiptId, p.id, p.productName, p.productCode, batch.batchNumber,
      Number(warehouseUsedQty) || 0, actor, warehouseReason,
    );
    setSubmitting(false);
    if (err) toast.error(err);
    else { toast.success('Imported from warehouse'); setWarehouseOpen(false); await load(); }
  };

  const saveBulk = async () => {
    const p = products.find((x) => x.id === bulkProductId);
    const batch = formBatches.find((b) => b.id === bulkBatchId);
    if (!p || !batch) { toast.error('Select product and batch'); return; }
    if (bulkReason.trim().length < 5) {
      toast.error('Bulk change reason must be at least 5 characters');
      return;
    }
    const rows: RawMaterialMonitoringFormData[] = bulkRows.filter((r) => r.used).map((row) => ({
      cpvProductId: bulkProductId,
      productName: p.productName,
      productCode: p.productCode,
      batchNumber: batch.batchNumber,
      materialCode: row.material.materialCode,
      materialName: row.material.materialName,
      materialType: mapMaterialType(row.material.materialType),
      materialGrade: row.material.grade || '',
      materialCategory: mapMaterialType(row.material.materialType),
      manufacturerName: row.material.materialName,
      supplierName: row.material.materialName,
      vendorId: '',
      vendorName: 'To be assigned',
      vendorStatus: 'Active',
      avlStatus: 'Approved',
      vendorCode: '',
      pharmacopoeiaStandard: '',
      grnNumber: '',
      purchaseOrderNumber: '',
      arNumber: `AR-${Date.now()}-${row.material.materialCode}`,
      coaNumber: '',
      materialLotNumber: '',
      supplierBatchNumber: '',
      mfgDate: new Date().toISOString().split('T')[0],
      expDate: new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0],
      retestDate: '',
      shelfLifeMonths: '',
      receivedQuantity: 0,
      acceptedQuantity: 0,
      rejectedQuantity: 0,
      quarantineQuantity: 0,
      issuedQuantity: Number(row.used),
      usedQuantity: Number(row.used),
      unit: 'kg',
      storageCondition: row.material.storageCondition || '',
      warehouseLocation: '',
      storageArea: '',
      site: '',
      department: 'Warehouse',
      shift: '',
      qcStatus: 'Under Test',
      qaStatus: '',
      releaseStatus: '',
      samplingStatus: '',
      coaAvailable: 'No',
      specificationNumber: row.material.specificationNo || '',
      specificationVersion: '',
      stpNumber: '',
      testParameter: '',
      testUnit: '',
      testResultSummary: '',
      remarks: row.remarks || '',
      effectiveDate: '',
      version: '1.0',
      changeReason: bulkReason,
    }));
    setSubmitting(true);
    const { created, errors } = await bulkCreateRawMaterialRecords(rows, actor, bulkReason);
    setSubmitting(false);
    if (errors.length) toast.error(errors[0]);
    toast.success(`${created} records saved`);
    setBulkOpen(false);
    await load();
  };

  const columns: ColumnDef<RawMaterialMonitoringRecord>[] = [
    { key: 'batchNumber', header: 'Batch' },
    { key: 'materialName', header: 'Material' },
    { key: 'vendorName', header: 'Vendor' },
    { key: 'arNumber', header: 'AR No' },
    { key: 'usedQuantity', header: 'Issue Qty' },
    { key: 'complianceStatus', header: 'Compliance', render: (r) => <StatusBadge status={r.complianceStatus} /> },
    { key: 'riskLevel', header: 'Risk', render: (r) => <RiskBadge level={r.riskLevel} /> },
    { key: 'avlStatus', header: 'AVL', render: (r) => <AvlBadge status={r.avlStatus} /> },
    { key: 'reviewStatus', header: 'Review' },
  ];

  const vendorWarning = form.avlStatus && !['Approved', 'Conditional Approved', 'Conditionally Approved'].includes(form.avlStatus);

  const esignRecordId = esignAction === 'qa-override'
    ? (editing?.id || 'raw-material')
    : esignAction === 'delete'
      ? (deleteTarget?.id || 'raw-material')
      : (approveTarget?.id || 'raw-material');

  const esignDocNo = esignAction === 'qa-override'
    ? editing?.rawMaterialMonitoringId
    : esignAction === 'delete'
      ? deleteTarget?.rawMaterialMonitoringId
      : approveTarget?.rawMaterialMonitoringId;

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={load} /></div>;

  return (
    <div className="space-y-6">
      <CpvPageHeader
        title="Raw Material Monitoring"
        description="Monitor API and raw material quality, vendor compliance and batch-wise usage for CPV"
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Raw Material Monitoring' },
        ]}
        actions={
          <>
            {canImportExport && (
              <Button variant="outline" size="sm" className="gap-2 no-print" onClick={async () => {
                const { headers, rows } = buildRawMaterialExportRows(filtered);
                downloadCsv(`raw-materials-${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
                await callLogExport(filtered.length, actor);
                toast.success(`Exported ${filtered.length} raw material records`);
              }}>
                <Download className="h-4 w-4" />Export
              </Button>
            )}
            <Button variant="outline" size="sm" className="gap-2 no-print" onClick={() => printPage()}>
              <Printer className="h-4 w-4" />Print
            </Button>
            {canCreate && (
              <Button variant="outline" size="sm" className="gap-2 no-print" onClick={() => {
                setWarehouseOpen(true);
                const preselectId = resolveProductIdFromQuery() || products[0]?.id;
                if (preselectId) void onProductChange(preselectId);
              }}>
                <Warehouse className="h-4 w-4" />From Warehouse
              </Button>
            )}
            {canCreate && !isReadOnly && (
              <>
                <Button variant="outline" size="sm" className="gap-2 no-print" onClick={() => {
                  const preselectId = resolveProductIdFromQuery() || products[0]?.id;
                  if (preselectId) {
                    setBulkProductId(preselectId);
                    void onProductChange(preselectId);
                    setBulkRows(materials.slice(0, 5).map((m) => ({ material: m, used: '', remarks: '' })));
                    setBulkOpen(true);
                  }
                }}>
                  <Layers className="h-4 w-4" />Bulk Entry
                </Button>
                <Button size="sm" className="gap-2 no-print" onClick={openCreate}><Plus className="h-4 w-4" />New Record</Button>
              </>
            )}
          </>
        }
      />

      <div className="no-print flex flex-wrap gap-1.5">
        {crossLinks.map((l) => (
          <Link
            key={l.href + l.label}
            href={l.href}
            className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900"
          >
            {l.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-9">
        <KpiCard label="Total Lots" value={summary.total} tone="blue" />
        <KpiCard label="API Lots" value={summary.apiLots} tone="blue" />
        <KpiCard label="Excipient Lots" value={summary.excipientLots} tone="green" />
        <KpiCard label="Approved" value={summary.approvedLots} tone="green" />
        <KpiCard label="Rejected" value={summary.rejectedLots} tone="red" />
        <KpiCard label="AVL Compliant" value={summary.avlCompliant} tone="green" />
        <KpiCard label="Non-Compliant" value={summary.nonCompliant} tone="amber" />
        <KpiCard label="Expired/Retest" value={summary.expiredRetestDue} tone="red" />
        <KpiCard label="OOS Triggered" value={summary.oosTriggered} tone="amber" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Usage Trend</CardTitle></CardHeader>
          <CardContent className="h-[240px]">
            {charts.usageTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.usageTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip />
                  <Line type="monotone" dataKey="quantity" stroke={CHART_COLORS[0]} strokeWidth={2} /></LineChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No usage data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Vendor Trend</CardTitle></CardHeader>
          <CardContent className="h-[240px]">
            {charts.vendorTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.vendorTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="vendor" tick={{ fontSize: 9 }} /><YAxis /><Tooltip /><Bar dataKey="count" fill={CHART_COLORS[1]} /></BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No vendor data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Approved vs Rejected</CardTitle></CardHeader>
          <CardContent className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={charts.approvedVsRejected} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={70} label>
                {charts.approvedVsRejected.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Pie><Tooltip /></PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Risk Distribution</CardTitle></CardHeader>
          <CardContent className="h-[240px]">
            {charts.riskDistribution.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={charts.riskDistribution} dataKey="count" nameKey="level" cx="50%" cy="50%" outerRadius={70} label>
                  {charts.riskDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Pie><Tooltip /></PieChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No risk data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">AVL Compliance Trend</CardTitle></CardHeader>
          <CardContent className="h-[240px]">
            {charts.avlComplianceTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.avlComplianceTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis domain={[0, 100]} /><Tooltip />
                  <Line type="monotone" dataKey="rate" name="AVL %" stroke={CHART_COLORS[3]} strokeWidth={2} /></LineChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No AVL trend" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Retest Due Trend</CardTitle></CardHeader>
          <CardContent className="h-[240px]">
            {charts.retestDueTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.retestDueTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Bar dataKey="count" fill={CHART_COLORS[4]} /></BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No retest due data" />}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="grid gap-3 lg:grid-cols-8">
            <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="lg:col-span-2" />
            <Select value={productFilter} onValueChange={setProductFilter}><SelectTrigger><SelectValue placeholder="Product" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Products</SelectItem>{productNames.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select>
            <Select value={batchFilter} onValueChange={setBatchFilter}><SelectTrigger><SelectValue placeholder="Batch" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Batches</SelectItem>{batchNumbers.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Types</SelectItem>{RM_MATERIAL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
            <Select value={qcFilter} onValueChange={setQcFilter}><SelectTrigger><SelectValue placeholder="QC" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All QC</SelectItem>{RM_QC_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <Select value={complianceFilter} onValueChange={setComplianceFilter}><SelectTrigger><SelectValue placeholder="Compliance" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All</SelectItem>{RM_COMPLIANCE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <Select value={riskFilter} onValueChange={setRiskFilter}><SelectTrigger><SelectValue placeholder="Risk" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Risk</SelectItem>{['Low', 'Medium', 'High', 'Critical'].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select>
            <Button variant="outline" size="sm" className="gap-1" onClick={clearFilters}><FilterX className="h-3.5 w-3.5" />Clear</Button>
          </div>
          {filtered.length === 0 ? <EmptyState title="No raw material records" /> : (
            <ResponsiveDataTable
              columns={columns}
              data={filtered}
              pageSize={10}
              onRowClick={(r) => router.push(`/cpv/raw-material-monitoring/${r.id}`)}
              actions={(row) => (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => router.push(`/cpv/raw-material-monitoring/${row.id}`)}><Eye className="h-4 w-4" /></Button>
                  {canCreate && !isReadOnly && (!row.isLocked || canQaOverride) && (
                    <Button size="icon" variant="ghost" onClick={() => {
                      setEditing(row);
                      setForm({ ...row, changeReason: '' });
                      setFormProductId(row.cpvProductId);
                      void onProductChange(row.cpvProductId);
                      setFormOpen(true);
                    }}><Pencil className="h-4 w-4" /></Button>
                  )}
                  {canReview && row.reviewStatus === 'Draft' && (
                    <Button size="icon" variant="ghost" onClick={async () => {
                      const { error: err } = await callReview(row.id, actor);
                      if (err) toast.error(err);
                      else { toast.success('Submitted for review'); await load(); }
                    }}><CheckCircle className="h-4 w-4" /></Button>
                  )}
                  {canReview && (row.reviewStatus === 'Under Review' || row.reviewStatus === 'Draft') && (
                    <Button size="sm" variant="outline" onClick={() => {
                      setApproveTarget(row);
                      setActionReason('');
                      setEsignAction('approve');
                    }}>Approve</Button>
                  )}
                  {canReview && !row.isDeleted && (
                    <Button size="icon" variant="ghost" className="text-red-600" onClick={() => {
                      setDeleteTarget(row);
                      setActionReason('');
                      setEsignAction('delete');
                    }}><Trash2 className="h-4 w-4" /></Button>
                  )}
                </div>
              )}
            />
          )}
        </CardContent>
      </Card>

      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader><SheetTitle>{editing ? 'Edit Raw Material Record' : 'New Raw Material Record'}</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-3">
            {vendorWarning && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                Vendor/AVL not approved. Save blocked unless QA override.
                {canQaOverride && (
                  <Button variant="link" className="h-auto p-0 ml-2" onClick={() => {
                    setEsignAction('qa-override');
                    setEsignOpen(true);
                  }}>QA Override</Button>
                )}
              </div>
            )}
            {!editing && (
              <div><Label>CPV Product *</Label>
                <Select value={formProductId} onValueChange={(v) => void onProductChange(v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Product" /></SelectTrigger>
                  <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div><Label>Batch *</Label>
              <Select value={form.batchNumber || ''} onValueChange={(v) => setForm((f) => ({ ...f, batchNumber: v }))} disabled={Boolean(editing?.isLocked && !canQaOverride)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{formBatches.map((b) => <SelectItem key={b.id} value={b.batchNumber}>{b.batchNumber}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Category *</Label>
              <Select
                value={FORM_CATEGORY_OPTIONS.some((o) => o.value === form.materialType) ? form.materialType : ''}
                onValueChange={(v) => setForm((f) => ({
                  ...f,
                  materialType: v as RawMaterialMonitoringFormData['materialType'],
                  materialCode: '',
                  materialName: '',
                }))}
              >
                <SelectTrigger className="mt-1"><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  {FORM_CATEGORY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Material *</Label>
              <Select value={materials.find((m) => m.materialCode === form.materialCode)?.id || ''} onValueChange={onMaterialChange} disabled={Boolean(editing)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Material" /></SelectTrigger>
                <SelectContent>{filteredMaterials.map((m) => <SelectItem key={m.id} value={m.id || ''}>{m.materialName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Material Grade</Label><Input className="mt-1" value={form.materialGrade || ''} onChange={(e) => setForm((f) => ({ ...f, materialGrade: e.target.value }))} /></div>
            <div><Label>Vendor *</Label>
              <Select value={form.vendorId || ''} onValueChange={onVendorChange}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Vendor" /></SelectTrigger>
                <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendor_name}</SelectItem>)}</SelectContent>
              </Select>
              {form.avlStatus && <div className="mt-1"><AvlBadge status={form.avlStatus} /></div>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Manufacturer</Label><Input className="mt-1" value={form.manufacturerName || ''} onChange={(e) => setForm((f) => ({ ...f, manufacturerName: e.target.value }))} /></div>
              <div><Label>Supplier</Label><Input className="mt-1" value={form.supplierName || ''} onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))} /></div>
            </div>
            <div><Label>AR Number *</Label><Input className="mt-1" value={form.arNumber || ''} onChange={(e) => setForm((f) => ({ ...f, arNumber: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Standard Qty</Label><Input className="mt-1" type="number" value={form.issuedQuantity ?? ''} onChange={(e) => setForm((f) => ({ ...f, issuedQuantity: Number(e.target.value) }))} /></div>
              <div><Label>Issue Qty *</Label><Input className="mt-1" type="number" value={form.usedQuantity ?? ''} onChange={(e) => setForm((f) => ({ ...f, usedQuantity: Number(e.target.value) }))} /></div>
              <div><Label>Unit *</Label><Input className="mt-1" value={form.unit || ''} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} /></div>
              <div><Label>COA Available *</Label>
                <Select value={form.coaAvailable || 'No'} onValueChange={(v) => setForm((f) => ({ ...f, coaAvailable: v as 'Yes' | 'No' }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Yes">Yes</SelectItem><SelectItem value="No">No</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Spec No</Label><Input className="mt-1" value={form.specificationNumber || ''} onChange={(e) => setForm((f) => ({ ...f, specificationNumber: e.target.value }))} /></div>
              <div><Label>STP No</Label><Input className="mt-1" value={form.stpNumber || ''} onChange={(e) => setForm((f) => ({ ...f, stpNumber: e.target.value }))} /></div>
            </div>
            <div><Label>Test Result Summary</Label><Input className="mt-1" value={form.testResultSummary || ''} onChange={(e) => setForm((f) => ({ ...f, testResultSummary: e.target.value }))} /></div>
            <div><Label>Remarks</Label><Textarea className="mt-1" value={form.remarks || ''} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} /></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button onClick={() => void saveForm()} disabled={submitting}>{submitting ? 'Saving...' : 'Save'}</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={warehouseOpen} onOpenChange={setWarehouseOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Import from Warehouse Receipt</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Product</Label>
              <Select value={formProductId} onValueChange={(v) => void onProductChange(v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Batch</Label>
              <Select value={bulkBatchId} onValueChange={setBulkBatchId}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{formBatches.map((b) => <SelectItem key={b.id} value={b.id}>{b.batchNumber}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Warehouse Receipt</Label>
              <Select value={warehouseReceiptId} onValueChange={setWarehouseReceiptId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select receipt" /></SelectTrigger>
                <SelectContent>{receipts.map((r) => <SelectItem key={r.id} value={r.id}>{r.grn_number} — {r.material_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Issue Quantity</Label><Input className="mt-1" type="number" value={warehouseUsedQty} onChange={(e) => setWarehouseUsedQty(e.target.value)} /></div>
            <div>
              <Label>Change Reason *</Label>
              <Input className="mt-1" value={warehouseReason} onChange={(e) => setWarehouseReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWarehouseOpen(false)}>Cancel</Button>
            <Button onClick={() => void saveWarehouseImport()} disabled={submitting}>Import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Bulk Raw Material Entry</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2 py-2">
            <div><Label>Product</Label>
              <Select value={bulkProductId} onValueChange={async (v) => {
                setBulkProductId(v);
                const p = products.find((x) => x.id === v);
                if (p) setFormBatches(await fetchRmBatchesForProduct(p.productName));
              }}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Batch</Label>
              <Select value={bulkBatchId} onValueChange={setBulkBatchId}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{formBatches.map((b) => <SelectItem key={b.id} value={b.id}>{b.batchNumber}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Material</TableHead><TableHead>Issue Qty</TableHead><TableHead>Remarks</TableHead></TableRow></TableHeader>
            <TableBody>
              {bulkRows.map((row, i) => (
                <TableRow key={row.material.id || i}>
                  <TableCell>{row.material.materialName}</TableCell>
                  <TableCell><Input value={row.used} onChange={(e) => setBulkRows((rows) => rows.map((r, j) => j === i ? { ...r, used: e.target.value } : r))} /></TableCell>
                  <TableCell><Input value={row.remarks} onChange={(e) => setBulkRows((rows) => rows.map((r, j) => j === i ? { ...r, remarks: e.target.value } : r))} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DialogFooter>
            <div className="mr-auto w-full max-w-sm">
              <Label className="text-xs">Change Reason *</Label>
              <Input className="mt-1" value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} placeholder="Bulk entry reason" />
            </div>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button onClick={() => void saveBulk()} disabled={submitting}>Save All</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(approveTarget) && !esignOpen} onOpenChange={(o) => { if (!o) setApproveTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Raw Material Record</DialogTitle>
            <DialogDescription>Electronic signature is required. Change reason is mandatory (ALCOA+ / Part 11).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} placeholder="Why is this record being approved?" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>Cancel</Button>
            <Button disabled={submitting} onClick={() => void confirmApprove()}>Continue to E-Sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget) && !esignOpen} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Soft Delete Raw Material Record</DialogTitle>
            <DialogDescription>Electronic signature is required. Change reason is mandatory (ALCOA+ / Part 11).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} placeholder="Why is this record being deleted?" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" disabled={submitting} onClick={() => void confirmDelete()}>Continue to E-Sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ElectronicSignatureDialog
        open={esignOpen}
        onOpenChange={(v) => {
          setEsignOpen(v);
          if (!v) setSubmitting(false);
        }}
        moduleName="Raw Material Monitoring"
        recordId={esignRecordId}
        documentNumber={esignDocNo}
        actionType={esignAction === 'qa-override' ? 'QA Override' : esignAction === 'delete' ? 'Soft Delete' : 'Approve'}
        onSuccess={() => {
          if (esignAction === 'qa-override') void applyQaOverride();
          else if (esignAction === 'delete') void applyDelete();
          else void applyApprove();
        }}
        onCancel={() => setEsignOpen(false)}
      />
    </div>
  );
}
