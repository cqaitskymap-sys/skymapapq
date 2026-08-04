import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFirestore, getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';
import { getRecord, getRecords } from '@/lib/firestore';
import { fetchProducts, normalizeProduct } from '@/lib/admin/product-service';
import { fetchParameters, normalizeParameter } from '@/lib/admin/parameter-service';
import type { AdminProduct, Parameter } from '@/lib/admin/schemas';
import {
  CPV_PRODUCT_COLLECTION,
  buildCpvProductId,
  computeNextReviewDueDate,
  isCpvProductOperational,
  type CpvProductFormData,
  type CpvProductRecord,
  type LinkedParameterRow,
} from '@/lib/cpv-product-master';

const LEGACY_COLLECTION = 'cpv_config_products';

export interface CpvProductActor {
  id: string;
  name: string;
}

function str(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function cfErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = String((e as { message?: string }).message || '');
    if (msg) return msg.replace(/^Firebase:\s*/i, '').replace(/\s*\(.*\)$/, '').trim() || fallback;
  }
  return fallback;
}

function isProductMasterDoc(raw: Record<string, unknown>): boolean {
  // Exclude Product CPV Settings-shaped docs that may historically share the collection.
  if (raw.recordType === 'cpv_product_master') return true;
  if (raw.cpvProductId || raw.adminProductId) return true;
  if (typeof raw.cpvRequired === 'boolean' && !raw.adminProductId && !raw.cpvProductId) return false;
  return Boolean(raw.productCode && raw.productName);
}

export function normalizeCpvProduct(raw: Record<string, unknown>): CpvProductRecord {
  const productCode = str(raw.productCode);
  return {
    id: str(raw.id),
    cpvProductId: str(raw.cpvProductId, buildCpvProductId(productCode)),
    recordType: str(raw.recordType, 'cpv_product_master'),
    adminProductId: str(raw.adminProductId || raw.productId),
    productCode,
    productName: str(raw.productName),
    genericName: str(raw.genericName),
    brandName: str(raw.brandName),
    productCategory: str(raw.productCategory || raw.category),
    productFamily: str(raw.productFamily || raw.family),
    strength: str(raw.strength),
    dosageForm: str(raw.dosageForm),
    routeOfAdministration: str(raw.routeOfAdministration || raw.route),
    packSize: str(raw.packSize),
    packType: str(raw.packType),
    market: str(raw.market),
    manufacturingSite: str(raw.manufacturingSite),
    businessUnit: str(raw.businessUnit),
    department: str(raw.department),
    productOwner: str(raw.productOwner),
    lifecycleStatus: str(raw.lifecycleStatus),
    developmentStage: str(raw.developmentStage),
    validationStatus: str(raw.validationStatus),
    marketStatus: str(raw.marketStatus),
    version: str(raw.version, '1.0'),
    revision: str(raw.revision, '00'),
    effectiveDate: str(raw.effectiveDate),
    reviewDate: str(raw.reviewDate),
    expiryDate: str(raw.expiryDate),
    description: str(raw.description),
    manufacturingProcess: str(raw.manufacturingProcess),
    productionLine: str(raw.productionLine),
    manufacturingArea: str(raw.manufacturingArea),
    packagingProcess: str(raw.packagingProcess),
    shelfLife: str(raw.shelfLife),
    storageCondition: str(raw.storageCondition),
    standardBatchSize: str(raw.standardBatchSize || raw.batchSize),
    manufacturingLicenseNumber: str(
      raw.manufacturingLicenseNumber || raw.manufacturingLicenseNo,
    ),
    mfrNumber: str(raw.mfrNumber),
    bmrNumber: str(raw.bmrNumber),
    bprNumber: str(raw.bprNumber),
    specificationNumber: str(raw.specificationNumber),
    specificationVersion: str(raw.specificationVersion),
    stpNumber: str(raw.stpNumber),
    upperSpecificationLimit: str(raw.upperSpecificationLimit),
    lowerSpecificationLimit: str(raw.lowerSpecificationLimit),
    targetValue: str(raw.targetValue),
    samplingPlan: str(raw.samplingPlan),
    testingFrequency: str(raw.testingFrequency),
    cpvStatus: (str(raw.cpvStatus || raw.status, 'Draft') as CpvProductRecord['cpvStatus']),
    cpvStartDate: str(raw.cpvStartDate),
    cpvReviewFrequency: (str(raw.cpvReviewFrequency, 'Yearly') as CpvProductRecord['cpvReviewFrequency']),
    cpvOwner: str(raw.cpvOwner),
    qaReviewer: str(raw.qaReviewer),
    remarks: str(raw.remarks),
    linkedCppParameterIds: Array.isArray(raw.linkedCppParameterIds)
      ? raw.linkedCppParameterIds.map(String)
      : [],
    linkedCqaParameterIds: Array.isArray(raw.linkedCqaParameterIds)
      ? raw.linkedCqaParameterIds.map(String)
      : [],
    nextReviewDueDate: str(raw.nextReviewDueDate),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
    createdBy: str(raw.createdBy),
    updatedBy: str(raw.updatedBy),
    createdByName: str(raw.createdByName),
    updatedByName: str(raw.updatedByName),
    isDeleted: Boolean(raw.isDeleted),
    status: str(raw.status || raw.cpvStatus),
    changeReason: str(raw.changeReason),
  };
}

export function adminProductToCpvAutofill(product: AdminProduct): Partial<CpvProductFormData> {
  const p = normalizeProduct(product);
  return {
    adminProductId: p.id || '',
    productCode: p.productCode,
    productName: p.productName,
    genericName: p.genericName || '',
    brandName: p.brandName || '',
    strength: p.strength || '',
    dosageForm: p.dosageForm || '',
    routeOfAdministration: p.routeOfAdministration || '',
    packSize: p.packSize || '',
    market: p.market || '',
    shelfLife: p.shelfLife || '',
    storageCondition: p.storageCondition || '',
    standardBatchSize: p.standardBatchSize || p.batchSize || '',
    manufacturingLicenseNumber: p.manufacturingLicenseNumber || p.manufacturingLicenseNo || '',
    mfrNumber: p.mfrNumber || '',
    bmrNumber: p.bmrNumber || '',
    bprNumber: p.bprNumber || '',
    specificationNumber: p.specificationNumber || '',
    stpNumber: p.stpNumber || '',
    remarks: p.remarks || '',
    productCategory: str((p as Record<string, unknown>).productCategory || (p as Record<string, unknown>).category),
    productFamily: str((p as Record<string, unknown>).productFamily || (p as Record<string, unknown>).family),
    manufacturingSite: str((p as Record<string, unknown>).manufacturingSite),
  };
}

export function parameterToLinkedRow(p: Parameter): LinkedParameterRow {
  const n = normalizeParameter(p);
  return {
    id: n.id || '',
    parameterCode: n.parameterCode,
    parameterName: n.parameterName,
    parameterType: n.parameterType,
    processStage: n.processStage || '',
    lsl: n.lsl || n.lowerLimit || '',
    usl: n.usl || n.upperLimit || '',
    target: n.target || n.targetValue || '',
    unit: n.unit || '',
    criticality: n.criticality || '',
    status: n.status || 'Active',
  };
}

async function safeQueryCollection(name: string, max = 300): Promise<Record<string, unknown>[]> {
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
      console.warn(`CPV product master: unable to load ${name}`, e);
      return [];
    }
  }
}

export async function fetchCpvProducts(): Promise<CpvProductRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const primary = await getRecords<CpvProductRecord>(CPV_PRODUCT_COLLECTION);
    const normalized = primary
      .map((r) => normalizeCpvProduct(r as unknown as Record<string, unknown>))
      .filter((r) => !r.isDeleted && isProductMasterDoc(r as unknown as Record<string, unknown>));
    if (normalized.length > 0) return normalized;

    const legacy = await safeQueryCollection(LEGACY_COLLECTION);
    return legacy
      .filter((r) => isProductMasterDoc(r) || Boolean(r.productCode || r.product))
      .map((r) => normalizeCpvProduct({
        ...r,
        productName: r.productName || r.product,
        cpvStatus: r.status === 'Inactive' ? 'Inactive' : (r.cpvStatus || 'Active'),
        cpvStartDate: r.cpvStartDate || r.createdAt || new Date().toISOString().split('T')[0],
        cpvReviewFrequency: r.cpvReviewFrequency || r.reviewFrequency || 'Yearly',
        cpvOwner: r.cpvOwner || 'QA',
        linkedCppParameterIds: [],
        linkedCqaParameterIds: [],
      }));
  } catch (e) {
    console.error('fetchCpvProducts failed', e);
    return [];
  }
}

export async function fetchCpvProductById(id: string): Promise<CpvProductRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const record = await getRecord<CpvProductRecord>(CPV_PRODUCT_COLLECTION, id);
    if (!record) {
      const all = await fetchCpvProducts();
      return all.find((p) => p.id === id) ?? null;
    }
    const normalized = normalizeCpvProduct(record as unknown as Record<string, unknown>);
    if (normalized.isDeleted) return null;
    return normalized;
  } catch (e) {
    console.error('fetchCpvProductById failed', e);
    return null;
  }
}

export async function isDuplicateActiveCpvProductCode(
  productCode: string,
  excludeId?: string,
): Promise<boolean> {
  const products = await fetchCpvProducts();
  return products.some((p) => {
    if (excludeId && p.id === excludeId) return false;
    if (p.productCode.toLowerCase() !== productCode.toLowerCase()) return false;
    return ['Active', 'Under Review', 'Approved', 'Draft'].includes(p.cpvStatus);
  });
}

export async function fetchAdminProductsForImport(): Promise<AdminProduct[]> {
  try {
    return await fetchProducts();
  } catch {
    return [];
  }
}

export async function fetchActiveParametersByType(type: 'CPP' | 'CQA'): Promise<Parameter[]> {
  try {
    const all = await fetchParameters();
    return all.filter((p) => {
      const n = normalizeParameter(p);
      const pt = n.parameterType?.toUpperCase();
      return pt === type && n.status === 'Active' && !n.isDeleted;
    });
  } catch {
    return [];
  }
}

export async function fetchLinkedParameters(ids: string[]): Promise<LinkedParameterRow[]> {
  if (!ids.length) return [];
  try {
    const all = await fetchParameters();
    const map = new Map(all.map((p) => [p.id, parameterToLinkedRow(p)]));
    return ids.map((id) => map.get(id)).filter(Boolean) as LinkedParameterRow[];
  } catch {
    return [];
  }
}

export async function fetchProductBatches(product: CpvProductRecord): Promise<Record<string, unknown>[]> {
  const names = [product.productName, product.productCode].filter(Boolean);
  const collections = ['batches', 'cpv_batches'];
  const merged: Record<string, unknown>[] = [];
  for (const col of collections) {
    const rows = await safeQueryCollection(col, 100);
    merged.push(...rows.filter((r) => {
      const pn = str(r.productName || r.product_name || r.product);
      const pc = str(r.productCode || r.product_code);
      const cpvId = str(r.cpvProductId || r.cpv_product_id);
      return names.some((n) => pn === n || pc === n)
        || (product.cpvProductId && cpvId === product.cpvProductId)
        || (product.id && str(r.cpvProductDocId) === product.id);
    }));
  }
  return merged.slice(0, 50);
}

export async function fetchProductCpvReviews(product: CpvProductRecord): Promise<Record<string, unknown>[]> {
  const names = [product.productName, product.productCode].filter(Boolean);
  const collections = ['cpv_reviews', 'cpv_annual_review'];
  const merged: Record<string, unknown>[] = [];
  for (const col of collections) {
    const rows = await safeQueryCollection(col, 50);
    merged.push(...rows.filter((r) => {
      const pn = str(r.productName || r.product_name || r.product);
      return names.some((n) => pn === n);
    }));
  }
  return merged;
}

export async function fetchProductAuditTrail(recordId: string): Promise<Record<string, unknown>[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), 'audit_trail'),
      where('documentId', '==', recordId),
      limit(50),
    ));
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (rows.length) return rows;
    const snap2 = await getDocs(query(
      collection(getFirebaseFirestore(), 'audit_trail'),
      where('recordId', '==', recordId),
      limit(50),
    ));
    return snap2.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    const fallback = await safeQueryCollection('audit_trail', 100);
    return fallback.filter((r) => str(r.documentId || r.recordId) === recordId);
  }
}

export async function createCpvProduct(
  data: CpvProductFormData,
  _actor: CpvProductActor,
): Promise<{ product: CpvProductRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) {
    return { product: null, error: 'Firebase is not configured.' };
  }
  try {
    if (await isDuplicateActiveCpvProductCode(data.productCode)) {
      return { product: null, error: 'An active CPV product with this code already exists.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'createAdminCpvProduct',
    );
    const result = await fn({ ...data, changeReason: data.changeReason });
    return { product: normalizeCpvProduct(result.data), error: null };
  } catch (e) {
    console.error('createCpvProduct failed', e);
    return { product: null, error: cfErrorMessage(e, 'Failed to create CPV product.') };
  }
}

export async function updateCpvProduct(
  id: string,
  data: Partial<CpvProductFormData>,
  _actor: CpvProductActor,
  existing: CpvProductRecord,
): Promise<{ product: CpvProductRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) {
    return { product: null, error: 'Firebase is not configured.' };
  }
  try {
    if (data.productCode && await isDuplicateActiveCpvProductCode(data.productCode, id)) {
      return { product: null, error: 'An active CPV product with this code already exists.' };
    }
    const changeReason = data.changeReason || existing.changeReason || '';
    if (!changeReason || changeReason.trim().length < 5) {
      return { product: null, error: 'Change reason (min 5 characters) is required.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'updateAdminCpvProduct',
    );
    const result = await fn({
      ...existing,
      ...data,
      id,
      changeReason,
    });
    return { product: normalizeCpvProduct(result.data), error: null };
  } catch (e) {
    console.error('updateCpvProduct failed', e);
    return { product: null, error: cfErrorMessage(e, 'Failed to update CPV product.') };
  }
}

export async function setCpvProductStatus(
  id: string,
  cpvStatus: CpvProductRecord['cpvStatus'],
  _actor: CpvProductActor,
  _existing: CpvProductRecord,
  options?: { changeReason?: string; esignConfirmed?: boolean },
): Promise<{ product: CpvProductRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) {
    return { product: null, error: 'Firebase is not configured.' };
  }
  try {
    const reason = options?.changeReason || '';
    if (reason.trim().length < 5) {
      return { product: null, error: 'Change reason (min 5 characters) is required.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'setAdminCpvProductStatus',
    );
    const result = await fn({
      id,
      cpvStatus,
      changeReason: reason,
      esignConfirmed: options?.esignConfirmed === true,
    });
    return { product: normalizeCpvProduct(result.data), error: null };
  } catch (e) {
    console.error('setCpvProductStatus failed', e);
    return { product: null, error: cfErrorMessage(e, 'Failed to update product status.') };
  }
}

export async function linkCpvParameter(
  productId: string,
  parameterId: string,
  type: 'CPP' | 'CQA',
  _actor: CpvProductActor,
  _existing: CpvProductRecord,
): Promise<{ product: CpvProductRecord | null; error: string | null }> {
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'linkAdminCpvParameter',
    );
    const result = await fn({
      id: productId,
      parameterId,
      type,
      changeReason: `Link ${type} parameter`,
    });
    return { product: normalizeCpvProduct(result.data), error: null };
  } catch (e) {
    console.error('linkCpvParameter failed', e);
    return { product: null, error: cfErrorMessage(e, 'Failed to link parameter.') };
  }
}

export async function unlinkCpvParameter(
  productId: string,
  parameterId: string,
  type: 'CPP' | 'CQA',
  _actor: CpvProductActor,
  _existing: CpvProductRecord,
): Promise<{ product: CpvProductRecord | null; error: string | null }> {
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'unlinkAdminCpvParameter',
    );
    const result = await fn({
      id: productId,
      parameterId,
      type,
      changeReason: `Unlink ${type} parameter`,
    });
    return { product: normalizeCpvProduct(result.data), error: null };
  } catch (e) {
    console.error('unlinkCpvParameter failed', e);
    return { product: null, error: cfErrorMessage(e, 'Failed to unlink parameter.') };
  }
}

export async function importCpvProductFromAdmin(
  adminProductId: string,
  cpvFields: Pick<CpvProductFormData, 'cpvStartDate' | 'cpvReviewFrequency' | 'cpvOwner' | 'qaReviewer' | 'cpvStatus' | 'remarks' | 'changeReason'>,
  _actor: CpvProductActor,
): Promise<{ product: CpvProductRecord | null; error: string | null }> {
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'importAdminCpvProduct',
    );
    const result = await fn({
      adminProductId,
      ...cpvFields,
      changeReason: cpvFields.changeReason || 'Import from Admin Product Master',
    });
    return { product: normalizeCpvProduct(result.data), error: null };
  } catch (e) {
    console.error('importCpvProductFromAdmin failed', e);
    return { product: null, error: cfErrorMessage(e, 'Failed to import product.') };
  }
}

export async function softDeleteCpvProduct(
  id: string,
  options: { changeReason: string; esignConfirmed: boolean },
): Promise<{ success: boolean; error: string | null }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminCpvProduct');
    await fn({
      id,
      changeReason: options.changeReason,
      esignConfirmed: options.esignConfirmed,
    });
    return { success: true, error: null };
  } catch (e) {
    console.error('softDeleteCpvProduct failed', e);
    return { success: false, error: cfErrorMessage(e, 'Failed to archive product.') };
  }
}

export function buildCpvProductsExportRows(products: CpvProductRecord[]): {
  headers: string[];
  rows: (string | number)[][];
} {
  const headers = [
    'CPV Product ID', 'Product Code', 'Product Name', 'Generic Name', 'Brand Name',
    'Category', 'Family', 'Strength', 'Dosage Form', 'Pack Size', 'Pack Type',
    'Market', 'Site', 'Business Unit', 'Department', 'Lifecycle', 'Version', 'Revision',
    'CPV Status', 'Review Frequency', 'Next Review Due', 'Owner', 'QA Reviewer',
    'Specification', 'Spec Version', 'LSL', 'USL', 'Target', 'CPP Links', 'CQA Links',
  ];
  const rows = products.map((p) => [
    p.cpvProductId,
    p.productCode,
    p.productName,
    p.genericName,
    p.brandName,
    p.productCategory || '',
    p.productFamily || '',
    p.strength,
    p.dosageForm,
    p.packSize,
    p.packType || '',
    p.market,
    p.manufacturingSite || '',
    p.businessUnit || '',
    p.department || '',
    p.lifecycleStatus || '',
    p.version || '',
    p.revision || '',
    p.cpvStatus,
    p.cpvReviewFrequency,
    p.nextReviewDueDate || computeNextReviewDueDate(p.cpvStartDate, p.cpvReviewFrequency),
    p.cpvOwner,
    p.qaReviewer,
    p.specificationNumber,
    p.specificationVersion || '',
    p.lowerSpecificationLimit || '',
    p.upperSpecificationLimit || '',
    p.targetValue || '',
    p.linkedCppParameterIds?.length || 0,
    p.linkedCqaParameterIds?.length || 0,
  ]);
  return { headers, rows };
}

/** @deprecated Use buildCpvProductsExportRows */
export function exportCpvProductsCsvPlaceholder(products: CpvProductRecord[]): string {
  const { headers, rows } = buildCpvProductsExportRows(products);
  return [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

export async function logCpvProductExport(actor: CpvProductActor, count: number, format = 'CSV'): Promise<void> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminCpvProductExport');
    await fn({ count, format, changeReason: `Export by ${actor.name}` });
  } catch (e) {
    console.warn('logCpvProductExport CF failed (non-blocking)', e);
  }
}

/**
 * Gate for CPP/CQA/batch entry.
 * If the product is registered in CPV Product Master, it must be operational.
 * Unknown products are allowed only when the master list is empty (bootstrap).
 */
export async function isCpvProductActiveForEntry(productCodeOrName: string): Promise<boolean> {
  if (!productCodeOrName) return true;
  const products = await fetchCpvProducts();
  if (!products.length) return true;
  const match = products.find((p) =>
    p.productCode.toLowerCase() === productCodeOrName.toLowerCase()
    || p.productName.toLowerCase() === productCodeOrName.toLowerCase(),
  );
  if (!match) return false;
  return isCpvProductOperational(match.cpvStatus);
}

export async function fetchCppCqaParameterCollections(
  product: CpvProductRecord,
): Promise<{ cpp: Record<string, unknown>[]; cqa: Record<string, unknown>[] }> {
  const names = [product.productName, product.productCode].filter(Boolean);
  const cppRows = await safeQueryCollection('cpp_parameters', 200);
  const cqaRows = await safeQueryCollection('cqa_parameters', 200);
  const matchProduct = (r: Record<string, unknown>) => {
    const link = str(r.productLink || r.product || r.productName || r.product_name);
    return names.some((n) => link === n);
  };
  return {
    cpp: cppRows.filter(matchProduct),
    cqa: cqaRows.filter(matchProduct),
  };
}
