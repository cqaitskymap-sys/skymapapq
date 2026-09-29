import type { MaterialMaster } from '@/lib/material-schemas';

export type DashboardMaterialType =
  | 'api'
  | 'raw_material'
  | 'excipient'
  | 'solvent'
  | 'preservative'
  | 'buffer'
  | 'ph_adjuster'
  | 'other';

export type DashboardMaterialStatus = 'active' | 'inactive' | 'blocked';

export interface DashboardMaterialRow {
  id: string;
  material_code: string;
  material_name: string;
  material_type: DashboardMaterialType;
  grade: string;
  specification_no: string;
  stp_no: string;
  approved_vendor_required: boolean;
  storage_condition: string;
  retest_period: string;
  shelf_life: string;
  status: DashboardMaterialStatus;
  remarks: string;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function mapMaterialType(raw: Record<string, unknown>): DashboardMaterialType {
  const v = str(raw.material_type ?? raw.materialType).toLowerCase();
  if (v === 'api' || raw.materialType === 'API') return 'api';
  if (v.includes('raw')) return 'raw_material';
  if (v.includes('excipient') || raw.materialType === 'Excipient') return 'excipient';
  if (v.includes('solvent') || raw.materialType === 'Solvent') return 'solvent';
  if (v.includes('preservative') || raw.materialType === 'Preservative') return 'preservative';
  if (v.includes('buffer') || raw.materialType === 'Buffer') return 'buffer';
  if (v.includes('ph') || raw.materialType === 'pH Adjuster') return 'ph_adjuster';
  return 'other';
}

function mapMaterialStatus(raw: Record<string, unknown>): DashboardMaterialStatus {
  const v = str(raw.status).toLowerCase();
  if (v === 'inactive') return 'inactive';
  if (v === 'blocked') return 'blocked';
  return 'active';
}

export function normalizeDashboardMaterialRow(id: string, raw: Record<string, unknown>): DashboardMaterialRow {
  return {
    id,
    material_code: str(raw.material_code ?? raw.materialCode),
    material_name: str(raw.material_name ?? raw.materialName),
    material_type: mapMaterialType(raw),
    grade: str(raw.grade),
    specification_no: str(raw.specification_no ?? raw.specificationNo),
    stp_no: str(raw.stp_no ?? raw.stpNo),
    approved_vendor_required: Boolean(raw.approved_vendor_required ?? raw.approvedVendorRequired),
    storage_condition: str(raw.storage_condition ?? raw.storageCondition),
    retest_period: str(raw.retest_period ?? raw.retestPeriod),
    shelf_life: str(raw.shelf_life ?? raw.shelfLife),
    status: mapMaterialStatus(raw),
    remarks: str(raw.remarks),
  };
}

export function materialMasterToDashboardRow(material: MaterialMaster & { id: string }): DashboardMaterialRow {
  return normalizeDashboardMaterialRow(material.id, material as unknown as Record<string, unknown>);
}
