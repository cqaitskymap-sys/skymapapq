import type { VendorMaster } from '@/lib/material-schemas';

export type DashboardVendorType = 'manufacturer' | 'supplier' | 'manufacturer_supplier';
export type DashboardAvlStatus = 'approved' | 'not_approved' | 'conditional_approved' | 'blocked';
export type DashboardRiskCategory = 'low' | 'medium' | 'high';
export type DashboardVendorStatus = 'active' | 'inactive' | 'blocked';

export interface DashboardVendorRow {
  id: string;
  vendor_code: string;
  vendor_name: string;
  vendor_type: DashboardVendorType;
  material_supplied: string;
  manufacturer_name: string;
  supplier_name: string;
  address: string;
  country: string;
  avl_status: DashboardAvlStatus;
  approval_date: string;
  approval_expiry_date: string;
  last_audit_date: string;
  next_audit_due_date: string;
  risk_category: DashboardRiskCategory;
  status: DashboardVendorStatus;
  remarks: string;
  created_at: string;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function mapVendorTypeFromRaw(raw: Record<string, unknown>): DashboardVendorType {
  const v = str(raw.vendor_type ?? raw.vendorType).toLowerCase();
  if (v.includes('manufacturer') && v.includes('supplier')) return 'manufacturer_supplier';
  if (v === 'manufacturer') return 'manufacturer';
  if (v === 'supplier') return 'supplier';
  if (raw.vendorType === 'Manufacturer + Supplier') return 'manufacturer_supplier';
  if (raw.vendorType === 'Manufacturer') return 'manufacturer';
  return 'supplier';
}

function mapAvlFromRaw(raw: Record<string, unknown>): DashboardAvlStatus {
  const v = str(raw.avl_status ?? raw.avlStatus).toLowerCase();
  if (v === 'approved') return 'approved';
  if (v.includes('conditional')) return 'conditional_approved';
  if (v === 'blocked') return 'blocked';
  return 'not_approved';
}

function mapRiskFromRaw(raw: Record<string, unknown>): DashboardRiskCategory {
  const v = str(raw.risk_category ?? raw.riskCategory).toLowerCase();
  if (v === 'low') return 'low';
  if (v === 'high') return 'high';
  return 'medium';
}

function mapStatusFromRaw(raw: Record<string, unknown>): DashboardVendorStatus {
  const v = str(raw.status).toLowerCase();
  if (v === 'inactive') return 'inactive';
  if (v === 'blocked') return 'blocked';
  return 'active';
}

/** Normalize Firestore / QMS vendor records for the dashboard Vendor Master UI. */
export function normalizeDashboardVendorRow(id: string, raw: Record<string, unknown>): DashboardVendorRow {
  return {
    id,
    vendor_code: str(raw.vendor_code ?? raw.vendorCode),
    vendor_name: str(raw.vendor_name ?? raw.vendorName),
    vendor_type: mapVendorTypeFromRaw(raw),
    material_supplied: str(raw.material_supplied ?? raw.materialSupplied),
    manufacturer_name: str(raw.manufacturer_name ?? raw.manufacturerName),
    supplier_name: str(raw.supplier_name ?? raw.supplierName),
    address: str(raw.address),
    country: str(raw.country),
    avl_status: mapAvlFromRaw(raw),
    approval_date: str(raw.approval_date ?? raw.approvalDate),
    approval_expiry_date: str(raw.approval_expiry_date ?? raw.approvalExpiryDate),
    last_audit_date: str(raw.last_audit_date ?? raw.lastAuditDate),
    next_audit_due_date: str(raw.next_audit_due_date ?? raw.nextAuditDueDate),
    risk_category: mapRiskFromRaw(raw),
    status: mapStatusFromRaw(raw),
    remarks: str(raw.remarks),
    created_at: str(raw.created_at ?? raw.createdAt),
  };
}

export function vendorMasterToDashboardRow(vendor: VendorMaster & { id: string }): DashboardVendorRow {
  return normalizeDashboardVendorRow(vendor.id, vendor as unknown as Record<string, unknown>);
}

export function dashboardVendorFormToMaster(
  form: Omit<DashboardVendorRow, 'id' | 'created_at'>,
): Omit<VendorMaster, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> {
  const vendorTypeMap: Record<DashboardVendorType, VendorMaster['vendorType']> = {
    manufacturer: 'Manufacturer',
    supplier: 'Supplier',
    manufacturer_supplier: 'Manufacturer + Supplier',
  };
  const avlMap: Record<DashboardAvlStatus, VendorMaster['avlStatus']> = {
    approved: 'Approved',
    not_approved: 'Not Approved',
    conditional_approved: 'Conditional Approved',
    blocked: 'Blocked',
  };
  const riskMap: Record<DashboardRiskCategory, VendorMaster['riskCategory']> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
  };
  const statusMap: Record<DashboardVendorStatus, VendorMaster['status']> = {
    active: 'Active',
    inactive: 'Inactive',
    blocked: 'Blocked',
  };

  return {
    vendorCode: form.vendor_code.trim(),
    vendorName: form.vendor_name.trim(),
    vendorType: vendorTypeMap[form.vendor_type],
    materialSupplied: form.material_supplied.trim() || '—',
    manufacturerName: form.manufacturer_name,
    supplierName: form.supplier_name,
    address: form.address,
    country: form.country,
    avlStatus: avlMap[form.avl_status],
    approvalDate: form.approval_date || null,
    approvalExpiryDate: form.approval_expiry_date || null,
    lastAuditDate: form.last_audit_date || null,
    nextAuditDueDate: form.next_audit_due_date || null,
    riskCategory: riskMap[form.risk_category],
    status: statusMap[form.status],
    remarks: form.remarks,
  };
}
