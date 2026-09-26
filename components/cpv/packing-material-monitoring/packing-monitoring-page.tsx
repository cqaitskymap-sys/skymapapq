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
  summarizePackingRecords, buildPackingChartSeries, PM_MATERIAL_TYPES, PM_MATERIAL_CATEGORIES,
  PM_QC_STATUSES, PM_COMPLIANCE_STATUSES, PM_FORM_MATERIAL_OPTIONS, packingMaterialMonitoringFormSchema,
  evaluateReconciliationStatus, isLabelCategory,
  type PackingMaterialMonitoringFormData, type PackingMaterialMonitoringRecord,
} from '@/lib/cpv-packing-material-monitoring';
import {
  fetchPackingMaterialRecords, fetchPmBatchesForProduct, fetchPackingMasterOptions, fetchPackingVendorOptions,
  createPackingMaterialRecord, updatePackingMaterialRecord, approvePackingMaterialRecord, reviewPackingMaterialRecord,
  bulkCreatePackingMaterialRecords, importPackingFromWarehouseReceipt, fetchPackingWarehouseReceipts,
  logPackingMaterialExport, softDeletePackingMaterialRecord, mapPackagingType, mapPackagingCategory,
} from '@/lib/cpv-packing-material-monitoring-service';
import type { PackagingMaterial } from '@/lib/packaging-service';
import { fetchActiveCpvProductsForBatch as fetchProducts } from '@/lib/cpv-batch-registration-service';
import type { CpvProductRecord } from '@/lib/cpv-product-master';
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
import type { PackingMaterialActor } from '@/lib/cpv-packing-material-monitoring-service';

const CHART_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed'];

type PackingSaveData = PackingMaterialMonitoringFormData;

type EsignAction = 'approve' | 'delete' | 'qa-override';

function buildPackingExportRows(records: PackingMaterialMonitoringRecord[]) {
  const headers = [
    'PM ID', 'Product Code', 'Product', 'Batch', 'Material Code', 'Material', 'Category', 'Type',
    'Vendor', 'AR No', 'GRN', 'Lot', 'Standard Qty', 'Used', 'Rejected', 'Returned', 'Balance',
    'Recon', 'Unit', 'QC Status', 'Compliance', 'Risk', 'AVL', 'Review Status', 'MFG', 'EXP',
    'Deviation', 'CAPA', 'OOS',
  ];
  const rows = records.map((r) => [
    r.packingMaterialMonitoringId,
    r.productCode,
    r.productName,
    r.batchNumber,
    r.materialCode,
    r.materialName,
    r.materialCategory,
    r.materialType,
    r.vendorName,
    r.arNumber,
    r.grnNumber || '',
    r.materialLotNumber || '',
    r.issuedQuantity,
    r.usedQuantity,
    r.rejectedQuantity,
    r.returnedQuantity,
    r.balanceQuantity,
    r.reconciliationStatus,
    r.unit,
    r.qcStatus,
    r.complianceStatus,
    r.riskLevel,
    r.avlStatus,
    r.reviewStatus,
    r.mfgDate,
    r.expDate,
    r.linkedDeviationNumber || '',
    r.linkedCapaNumber || '',
    String((r as Record<string, unknown>).linkedOosNumber || (r as Record<string, unknown>).oosRequired || ''),
  ]);
  return { headers, rows };
}

async function callReview(id: string, actor: PackingMaterialActor, changeReason = 'Submitted for QA review') {
  return reviewPackingMaterialRecord(id, actor, changeReason);
}

async function callApprove(
  id: string,
  actor: PackingMaterialActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
) {
  return approvePackingMaterialRecord(id, actor, changeReason, options);
}

async function callSoftDelete(
  id: string,
  actor: PackingMaterialActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
) {
  return softDeletePackingMaterialRecord(id, actor, changeReason, options);
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

function ReconBadge({ status }: { status: string }) {
  const cls = status === 'Matched' ? 'bg-green-50 text-green-700 border-green-200'
    : status === 'Mismatch' ? 'bg-red-50 text-red-700 border-red-200'
      : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

function ComplianceBadges({ record }: { record: PackingMaterialMonitoringRecord }) {
  const raw = record as Record<string, unknown>;
  const oos = Boolean(raw.oosRequired || raw.linkedOosNumber);
  const oot = Boolean(raw.ootRequired || raw.linkedOotNumber);
  return (
    <>
      <StatusBadge status={record.complianceStatus} />
      {oos && <StatusBadge status="OOS" />}
      {oot && <StatusBadge status="OOT" />}
    </>
  );
}

const defaultFormFields = (): Partial<PackingSaveData> => ({
  changeReason: '',
  artworkVersion: '',
  barcode: '',
  qrCode: '',
  artworkVerified: '',
  barcodeVerified: '',
  packagingIntegrity: '',
  damageInspection: '',
  purchaseOrderNumber: '',
  supplierBatchNumber: '',
  warehouseLocation: '',
  acceptedQuantity: 0,
  quarantineQuantity: 0,
  testParameter: '',
  testUnit: '',
  observedResult: undefined,
  lowerLimit: undefined,
  upperLimit: undefined,
  vendorCode: '',
  retestDate: '',
  shelfLifeMonths: '',
  storageArea: '',
  site: '',
  department: 'Warehouse',
  shift: '',
  qaStatus: '',
  releaseStatus: '',
  samplingStatus: '',
  specificationVersion: '',
  rfid: '',
  labelVerified: '',
  printingVerified: '',
  dimensionCheck: '',
  sealIntegrity: '',
  effectiveDate: '',
  reviewDate: '',
  version: '1.0',
  description: '',
});

export function PackingMonitoringPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const productQuery = searchParams.get('product') || '';
  const batchQuery = searchParams.get('batch') || '';
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canCreate = cpvPermissions.canCreatePackingMaterial(role) && !cpvPermissions.isPackingMaterialViewOnly(role);
  const canReview = cpvPermissions.canReviewPackingMaterial(role);
  const canImportExport = cpvPermissions.canImportExportPackingMaterial(role);
  const canQaOverride = cpvPermissions.canReviewPackingMaterial(role);
  const isReadOnly = cpvPermissions.isReadOnly(role) || cpvPermissions.isPackingMaterialViewOnly(role);

  const [records, setRecords] = useState<PackingMaterialMonitoringRecord[]>([]);
  const [products, setProducts] = useState<CpvProductRecord[]>([]);
  const [materials, setMaterials] = useState<PackagingMaterial[]>([]);
  const [vendors, setVendors] = useState<VendorRecord[]>([]);
  const [receipts, setReceipts] = useState<Awaited<ReturnType<typeof fetchPackingWarehouseReceipts>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const [editing, setEditing] = useState<PackingMaterialMonitoringRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [approveTarget, setApproveTarget] = useState<PackingMaterialMonitoringRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PackingMaterialMonitoringRecord | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [esignOpen, setEsignOpen] = useState(false);
  const [esignAction, setEsignAction] = useState<EsignAction>('approve');

  const [search, setSearch] = useState(productQuery || batchQuery);
  const [productFilter, setProductFilter] = useState('all');
  const [batchFilter, setBatchFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [qcFilter, setQcFilter] = useState('all');
  const [complianceFilter, setComplianceFilter] = useState('all');
  const [reconFilter, setReconFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');

  const [formProductId, setFormProductId] = useState('');
  const [formBatches, setFormBatches] = useState<Awaited<ReturnType<typeof fetchPmBatchesForProduct>>>([]);
  const [form, setForm] = useState<Partial<PackingSaveData>>(defaultFormFields());
  const [bulkProductId, setBulkProductId] = useState('');
  const [bulkBatchId, setBulkBatchId] = useState('');
  const [bulkReason, setBulkReason] = useState('Bulk packing material entry');
  const [bulkRows, setBulkRows] = useState<Array<{
    material: PackagingMaterial; issued: string; used: string; rejected: string; returned: string; remarks: string;
  }>>([]);
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
        fetchPackingMaterialRecords(), fetchProducts(), fetchPackingMasterOptions(),
        fetchPackingVendorOptions(), fetchPackingWarehouseReceipts(),
      ]);
      setRecords(rows.filter((r) => !r.isDeleted));
      setProducts(prods);
      setMaterials(mats);
      setVendors(vends);
      setReceipts(rcpts);
    } catch {
      setError('Failed to load packing material records.');
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
      if (categoryFilter !== 'all' && r.materialCategory !== categoryFilter) return false;
      if (qcFilter !== 'all' && r.qcStatus !== qcFilter) return false;
      if (complianceFilter !== 'all' && r.complianceStatus !== complianceFilter) return false;
      if (reconFilter !== 'all' && r.reconciliationStatus !== reconFilter) return false;
      if (riskFilter !== 'all' && r.riskLevel !== riskFilter) return false;
      if (!q) return true;
      return r.productName.toLowerCase().includes(q) || r.batchNumber.toLowerCase().includes(q)
        || r.materialName.toLowerCase().includes(q) || r.vendorName.toLowerCase().includes(q)
        || r.arNumber.toLowerCase().includes(q) || r.grnNumber.toLowerCase().includes(q)
        || r.productCode.toLowerCase().includes(q);
    });
  }, [records, search, productFilter, batchFilter, typeFilter, categoryFilter, qcFilter, complianceFilter, reconFilter, riskFilter]);

  const clearFilters = () => {
    setSearch('');
    setProductFilter('all');
    setBatchFilter('all');
    setTypeFilter('all');
    setCategoryFilter('all');
    setQcFilter('all');
    setComplianceFilter('all');
    setReconFilter('all');
    setRiskFilter('all');
  };

  const summary = useMemo(() => summarizePackingRecords(records), [records]);
  const charts = useMemo(() => buildPackingChartSeries(filtered), [filtered]);
  const productNames = useMemo(() => Array.from(new Set(records.map((r) => r.productName))), [records]);
  const batchNumbers = useMemo(() => Array.from(new Set(records.map((r) => r.batchNumber))), [records]);

  const formRecon = useMemo(() => evaluateReconciliationStatus(
    Number(form.issuedQuantity) || 0,
    Number(form.usedQuantity) || 0,
    Number(form.rejectedQuantity) || 0,
    Number(form.returnedQuantity) || 0,
  ), [form.issuedQuantity, form.usedQuantity, form.rejectedQuantity, form.returnedQuantity]);

  const crossLinks = useMemo(() => [
    ...(productQuery
      ? [{ href: `/cpv/product-master?search=${encodeURIComponent(productQuery)}`, label: 'Product Master' }]
      : [{ href: '/cpv/product-master', label: 'Product Master' }]),
    ...(batchQuery
      ? [{ href: `/cpv/batch-registration?search=${encodeURIComponent(batchQuery)}`, label: 'Batch Master' }]
      : [{ href: '/cpv/batch-registration', label: 'Batch Master' }]),
    { href: batchQuery ? `/cpv/cpp?batch=${encodeURIComponent(batchQuery)}` : productQuery ? `/cpv/cpp?product=${encodeURIComponent(productQuery)}` : '/cpv/cpp', label: 'CPP' },
    { href: batchQuery ? `/cpv/cqa?batch=${encodeURIComponent(batchQuery)}` : productQuery ? `/cpv/cqa?product=${encodeURIComponent(productQuery)}` : '/cpv/cqa', label: 'CQA' },
    { href: batchQuery ? `/cpv/raw-material-monitoring?batch=${encodeURIComponent(batchQuery)}` : productQuery ? `/cpv/raw-material-monitoring?product=${encodeURIComponent(productQuery)}` : '/cpv/raw-material-monitoring', label: 'Raw Material' },
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
    const batches = await fetchPmBatchesForProduct(p.productName, p.id);
    setFormBatches(batches);
    if (batchQuery && batches.some((b) => b.batchNumber === batchQuery)) {
      setForm((f) => ({ ...f, batchNumber: batchQuery }));
    }
  };

  const onMaterialChange = (value: typeof PM_FORM_MATERIAL_OPTIONS[number]) => {
    const isPrimary = value === 'Primary Material';
    setForm((f) => ({
      ...f,
      materialCode: isPrimary ? 'PM-PRIMARY' : 'PM-SECONDARY',
      materialName: value,
      materialType: isPrimary ? 'Primary Packing Material' : 'Secondary Packing Material',
      manufacturerName: f.manufacturerName || value,
      supplierName: f.supplierName || value,
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
      ...defaultFormFields(),
      mfgDate: new Date().toISOString().split('T')[0],
      expDate: new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0],
      qcStatus: 'Under Test',
      coaAvailable: 'No',
      issuedQuantity: 0,
      usedQuantity: 0,
      rejectedQuantity: 0,
      returnedQuantity: 0,
      unit: 'pcs',
      vendorStatus: 'Active',
      avlStatus: 'Approved',
    });
    const preselectId = resolveProductIdFromQuery();
    if (preselectId) void onProductChange(preselectId);
    else {
      setFormProductId('');
      setFormBatches([]);
    }
    setFormOpen(true);
  };

  const parseFormData = (): PackingSaveData | null => {
    const parsed = packingMaterialMonitoringFormSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || 'Validation failed');
      return null;
    }
    return parsed.data;
  };

  const saveForm = async () => {
    const data = parseFormData();
    if (!data) return;

    const needsQaOverride = Boolean(
      (vendorWarning || labelWarning || (editing?.isLocked && editing.reviewStatus === 'Approved')) && canQaOverride,
    );
    if (needsQaOverride && (vendorWarning || (editing?.isLocked && editing.reviewStatus === 'Approved'))) {
      setEsignAction('qa-override');
      setEsignOpen(true);
      return;
    }

    if (vendorWarning && !canQaOverride) {
      toast.error('Vendor/AVL not approved — QA override required.');
      return;
    }

    setSubmitting(true);
    const payload = data;
    if (editing) {
      const { error: err } = await updatePackingMaterialRecord(
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
      const { error: err } = await createPackingMaterialRecord(payload, actor);
      if (err) toast.error(err);
      else { toast.success('Record created'); setFormOpen(false); await load(); }
    }
    setSubmitting(false);
  };

  const applyQaOverride = async () => {
    const data = parseFormData();
    if (!data) return;
    setSubmitting(true);
    const payload = data;
    if (editing) {
      const { error: err } = await updatePackingMaterialRecord(
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
      const { error: err } = await createPackingMaterialRecord(
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
    const { error: err } = await importPackingFromWarehouseReceipt(
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
    const rows: PackingMaterialMonitoringFormData[] = bulkRows.filter((r) => r.used).map((row) => ({
      cpvProductId: bulkProductId,
      productName: p.productName,
      productCode: p.productCode,
      batchNumber: batch.batchNumber,
      materialCode: row.material.materialCode,
      materialName: row.material.materialName,
      materialType: mapPackagingType(row.material.materialType),
      materialCategory: mapPackagingCategory(row.material.materialCategory),
      manufacturerName: row.material.materialName,
      supplierName: row.material.materialName,
      vendorId: '',
      vendorName: 'To be assigned',
      vendorStatus: 'Active',
      avlStatus: 'Approved',
      vendorCode: '',
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
      rejectedQuantity: Number(row.rejected) || 0,
      quarantineQuantity: 0,
      returnedQuantity: Number(row.returned) || 0,
      issuedQuantity: Number(row.issued) || Number(row.used),
      usedQuantity: Number(row.used),
      unit: row.material.unit || 'pcs',
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
      artworkVersion: '',
      barcode: '',
      qrCode: '',
      rfid: '',
      artworkVerified: '',
      barcodeVerified: '',
      labelVerified: '',
      packagingIntegrity: '',
      damageInspection: '',
      printingVerified: '',
      dimensionCheck: '',
      sealIntegrity: '',
      stpNumber: row.material.stpNo || '',
      testParameter: '',
      testUnit: '',
      testResultSummary: '',
      remarks: row.remarks || '',
      effectiveDate: '',
      reviewDate: '',
      version: '1.0',
      description: '',
      changeReason: bulkReason,
    }));
    setSubmitting(true);
    const { created, errors } = await bulkCreatePackingMaterialRecords(rows, actor, bulkReason);
    setSubmitting(false);
    if (errors.length) toast.error(errors[0]);
    toast.success(`${created} records saved`);
    setBulkOpen(false);
    await load();
  };

  const columns: ColumnDef<PackingMaterialMonitoringRecord>[] = [
    { key: 'batchNumber', header: 'Batch' },
    { key: 'materialName', header: 'Material' },
    { key: 'materialCategory', header: 'Category' },
    { key: 'usedQuantity', header: 'Used' },
    { key: 'reconciliationStatus', header: 'Recon', render: (r) => <ReconBadge status={r.reconciliationStatus} /> },
    { key: 'complianceStatus', header: 'Compliance', render: (r) => <ComplianceBadges record={r} /> },
    { key: 'riskLevel', header: 'Risk', render: (r) => <RiskBadge level={r.riskLevel} /> },
    { key: 'reviewStatus', header: 'Review' },
  ];

  const vendorWarning = form.avlStatus && !['Approved', 'Conditional Approved', 'Conditionally Approved'].includes(form.avlStatus);
  const labelWarning = form.materialCategory && isLabelCategory(form.materialCategory) && formRecon === 'Mismatch';

  const esignRecordId = esignAction === 'qa-override'
    ? (editing?.id || 'packing-material')
    : esignAction === 'delete'
      ? (deleteTarget?.id || 'packing-material')
      : (approveTarget?.id || 'packing-material');

  const esignDocNo = esignAction === 'qa-override'
    ? editing?.packingMaterialMonitoringId
    : esignAction === 'delete'
      ? deleteTarget?.packingMaterialMonitoringId
      : approveTarget?.packingMaterialMonitoringId;

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={load} /></div>;

  return (
    <div className="space-y-6">
      <CpvPageHeader
        title="Packing Material Monitoring"
        description="Monitor primary, secondary and tertiary packing materials, vendor compliance and reconciliation for CPV"
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Packing Material Monitoring' },
        ]}
        actions={
          <>
            {canImportExport && (
              <Button variant="outline" size="sm" className="gap-2 no-print" onClick={async () => {
                const { headers, rows } = buildPackingExportRows(filtered);
                downloadCsv(`packing-materials-${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
                await logPackingMaterialExport(actor, filtered.length);
                toast.success(`Exported ${filtered.length} packing material records`);
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
                    setBulkRows(materials.slice(0, 6).map((m) => ({ material: m, issued: '', used: '', rejected: '', returned: '', remarks: '' })));
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-11">
        <KpiCard label="Total Lots" value={summary.total} tone="blue" />
        <KpiCard label="Primary" value={summary.primaryLots} tone="blue" />
        <KpiCard label="Secondary" value={summary.secondaryLots} tone="green" />
        <KpiCard label="Tertiary" value={summary.tertiaryLots} tone="green" />
        <KpiCard label="Approved" value={summary.approvedLots} tone="green" />
        <KpiCard label="Rejected" value={summary.rejectedLots} tone="red" />
        <KpiCard label="AVL OK" value={summary.avlCompliant} tone="green" />
        <KpiCard label="Non-Compliant" value={summary.nonCompliant} tone="amber" />
        <KpiCard label="Recon Mismatch" value={summary.reconciliationMismatch} tone="red" />
        <KpiCard label="Expired" value={summary.expiredMaterials} tone="red" />
        <KpiCard label="Deviation" value={summary.deviationTriggered} tone="amber" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Usage Trend</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.usageTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.usageTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip />
                  <Line type="monotone" dataKey="quantity" stroke={CHART_COLORS[0]} strokeWidth={2} /></LineChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No usage data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Vendor Trend</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.vendorTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.vendorTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="vendor" tick={{ fontSize: 9 }} /><YAxis /><Tooltip /><Bar dataKey="count" fill={CHART_COLORS[1]} /></BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No vendor data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Reconciliation Mismatch</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.reconciliationMismatchTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.reconciliationMismatchTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Bar dataKey="count" fill={CHART_COLORS[2]} /></BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No mismatch data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Label Reconciliation</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.labelReconciliationTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.labelReconciliationTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Bar dataKey="count" fill={CHART_COLORS[3]} /></BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No label recon data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Approved vs Rejected Lots</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.approvedVsRejected.some((d) => d.count > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={charts.approvedVsRejected} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={70} label>
                  {charts.approvedVsRejected.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie><Tooltip /></PieChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No QC lot data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">AVL Compliance Trend</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.avlComplianceTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.avlComplianceTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis domain={[0, 100]} /><Tooltip />
                  <Line type="monotone" dataKey="rate" stroke={CHART_COLORS[4]} strokeWidth={2} /></LineChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No AVL trend data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Material Risk Distribution</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.riskDistribution.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.riskDistribution}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="level" /><YAxis /><Tooltip /><Bar dataKey="count" fill={CHART_COLORS[0]} /></BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No risk data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Material-wise Usage</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.materialUsageTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.materialUsageTrend} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis dataKey="material" type="category" width={90} tick={{ fontSize: 9 }} /><Tooltip /><Bar dataKey="quantity" fill={CHART_COLORS[1]} /></BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No material usage data" />}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="grid gap-3 lg:grid-cols-9">
            <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="lg:col-span-2" />
            <Select value={productFilter} onValueChange={setProductFilter}><SelectTrigger><SelectValue placeholder="Product" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Products</SelectItem>{productNames.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select>
            <Select value={batchFilter} onValueChange={setBatchFilter}><SelectTrigger><SelectValue placeholder="Batch" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Batches</SelectItem>{batchNumbers.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Types</SelectItem>{PM_MATERIAL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}><SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Categories</SelectItem>{PM_MATERIAL_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
            <Select value={qcFilter} onValueChange={setQcFilter}><SelectTrigger><SelectValue placeholder="QC" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All QC</SelectItem>{PM_QC_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <Select value={complianceFilter} onValueChange={setComplianceFilter}><SelectTrigger><SelectValue placeholder="Compliance" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All</SelectItem>{PM_COMPLIANCE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <Select value={reconFilter} onValueChange={setReconFilter}><SelectTrigger><SelectValue placeholder="Recon" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Recon</SelectItem>{['Matched', 'Mismatch', 'Not Applicable'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <Select value={riskFilter} onValueChange={setRiskFilter}><SelectTrigger><SelectValue placeholder="Risk" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Risk</SelectItem>{['Low', 'Medium', 'High', 'Critical'].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select>
            <Button variant="outline" size="sm" className="gap-1 lg:col-span-9 w-fit" onClick={clearFilters}><FilterX className="h-3.5 w-3.5" />Clear</Button>
          </div>
          {filtered.length === 0 ? <EmptyState title="No packing material records" /> : (
            <ResponsiveDataTable
              columns={columns}
              data={filtered}
              pageSize={10}
              onRowClick={(r) => router.push(`/cpv/packing-material-monitoring/${r.id}`)}
              actions={(row) => (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => router.push(`/cpv/packing-material-monitoring/${row.id}`)}><Eye className="h-4 w-4" /></Button>
                  {canCreate && !isReadOnly && (!row.isLocked || canQaOverride) && (
                    <Button size="icon" variant="ghost" onClick={() => {
                      setEditing(row);
                      setForm({ ...row, ...defaultFormFields(), changeReason: '' });
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
                  {canReview && !row.isDeleted && row.reviewStatus !== 'Approved' && (
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
          <SheetHeader><SheetTitle>{editing ? 'Edit Packing Record' : 'New Packing Record'}</SheetTitle></SheetHeader>
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
            {labelWarning && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                Label/package insert reconciliation mismatch — stricter QA review required.
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
            <div><Label>Material *</Label>
              <Select
                value={PM_FORM_MATERIAL_OPTIONS.includes(form.materialName as typeof PM_FORM_MATERIAL_OPTIONS[number]) ? form.materialName : ''}
                onValueChange={onMaterialChange}
                disabled={Boolean(editing)}
              >
                <SelectTrigger className="mt-1"><SelectValue placeholder="Material" /></SelectTrigger>
                <SelectContent>{PM_FORM_MATERIAL_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Category *</Label>
              <Select value={form.materialCategory || ''} onValueChange={(v) => setForm((f) => ({ ...f, materialCategory: v as PackingMaterialMonitoringFormData['materialCategory'] }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{PM_MATERIAL_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Vendor *</Label>
              <Select value={form.vendorId || ''} onValueChange={onVendorChange}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendor_name}</SelectItem>)}</SelectContent>
              </Select>
              {form.avlStatus && <div className="mt-1"><AvlBadge status={form.avlStatus} /></div>}
            </div>
            <div><Label>AR Number *</Label><Input className="mt-1" value={form.arNumber || ''} onChange={(e) => setForm((f) => ({ ...f, arNumber: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Standard Qty *</Label><Input className="mt-1" type="number" value={form.issuedQuantity ?? ''} onChange={(e) => setForm((f) => ({ ...f, issuedQuantity: Number(e.target.value) }))} /></div>
              <div><Label>Issued Qty *</Label><Input className="mt-1" type="number" value={form.usedQuantity ?? ''} onChange={(e) => setForm((f) => ({ ...f, usedQuantity: Number(e.target.value) }))} /></div>
              <div><Label>Unit *</Label><Input className="mt-1" value={form.unit || ''} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} /></div>
              <div><Label>COA *</Label>
                <Select value={form.coaAvailable || 'No'} onValueChange={(v) => setForm((f) => ({ ...f, coaAvailable: v as 'Yes' | 'No' }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Yes">Yes</SelectItem><SelectItem value="No">No</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Test Result Summary</Label><Input className="mt-1" value={form.testResultSummary || ''} onChange={(e) => setForm((f) => ({ ...f, testResultSummary: e.target.value }))} /></div>
            <div><Label>Remarks</Label><Textarea className="mt-1" value={form.remarks || ''} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} /></div>
            <div>
              <Label>Change Reason * (ALCOA+ / Part 11)</Label>
              <Textarea
                className="mt-1"
                placeholder="Describe why this create/update is being performed"
                value={form.changeReason || ''}
                onChange={(e) => setForm((f) => ({ ...f, changeReason: e.target.value }))}
              />
            </div>
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
            <div><Label>Used Quantity</Label><Input className="mt-1" type="number" value={warehouseUsedQty} onChange={(e) => setWarehouseUsedQty(e.target.value)} /></div>
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
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Bulk Packing Entry</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2 py-2">
            <div><Label>Product</Label>
              <Select value={bulkProductId} onValueChange={async (v) => {
                setBulkProductId(v);
                const p = products.find((x) => x.id === v);
                if (p) setFormBatches(await fetchPmBatchesForProduct(p.productName, p.id));
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
            <TableHeader><TableRow>
              <TableHead>Material</TableHead><TableHead>Standard</TableHead><TableHead>Used</TableHead>
              <TableHead>Rejected</TableHead><TableHead>Returned</TableHead><TableHead>Remarks</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {bulkRows.map((row, i) => (
                <TableRow key={row.material.id || i}>
                  <TableCell>{row.material.materialName}</TableCell>
                  <TableCell><Input value={row.issued} onChange={(e) => setBulkRows((rows) => rows.map((r, j) => j === i ? { ...r, issued: e.target.value } : r))} /></TableCell>
                  <TableCell><Input value={row.used} onChange={(e) => setBulkRows((rows) => rows.map((r, j) => j === i ? { ...r, used: e.target.value } : r))} /></TableCell>
                  <TableCell><Input value={row.rejected} onChange={(e) => setBulkRows((rows) => rows.map((r, j) => j === i ? { ...r, rejected: e.target.value } : r))} /></TableCell>
                  <TableCell><Input value={row.returned} onChange={(e) => setBulkRows((rows) => rows.map((r, j) => j === i ? { ...r, returned: e.target.value } : r))} /></TableCell>
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
            <DialogTitle>Approve Packing Material Record</DialogTitle>
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
            <DialogTitle>Soft Delete Packing Material Record</DialogTitle>
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
        moduleName="Packing Material Monitoring"
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
