import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { getFirebaseApp, getFirebaseFirestore, getFirebaseStorage, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import { ADMIN_COLLECTIONS, PRODUCT_ATTACHMENT_MAX_BYTES, PRODUCT_LIFECYCLE_STATUSES } from './constants';
import type {
  AdminProduct, ProductFormData, ProductCompositionRow,
  ProductPackingRow, ProductAttachment,
} from './schemas';

export interface ProductAuditMeta {
  userId: string;
  userName: string;
}

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

export function buildProductId(code: string): string {
  return `PROD-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

export function normalizeProduct(p: AdminProduct): AdminProduct {
  const manufacturingLicense = p.manufacturingLicenseNumber || p.manufacturingLicenseNo || '';
  const batchSize = p.standardBatchSize || p.batchSize || '';
  const therapeuticCategory = p.therapeuticCategory || p.category || '';
  const productStatus = p.productStatus || 'Active';
  return {
    ...p,
    manufacturingLicenseNo: manufacturingLicense,
    manufacturingLicenseNumber: manufacturingLicense,
    standardBatchSize: batchSize,
    batchSize,
    therapeuticCategory,
    category: p.category || therapeuticCategory,
    status: productStatus === 'Active' ? 'Active' : 'Inactive',
    lifecycleStatus: p.lifecycleStatus || 'Commercial',
    country: p.country || 'India',
    productFamily: p.productFamily || '',
    packType: p.packType || '',
    containerClosure: p.containerClosure || '',
    manufacturingSite: p.manufacturingSite || '',
    businessUnit: p.businessUnit || '',
    department: p.department || '',
    productOwner: p.productOwner || '',
    registrationNumber: p.registrationNumber || '',
    licenseNumber: p.licenseNumber || '',
    batchPrefix: p.batchPrefix || '',
    hsnCode: p.hsnCode || '',
    gtin: p.gtin || '',
    barcode: p.barcode || '',
    qrCode: p.qrCode || '',
    description: p.description || '',
    isDeleted: Boolean(p.isDeleted),
    isArchived: p.isArchived ?? p.lifecycleStatus === 'Archived',
  };
}

function mapProductDoc(snapshot: { id: string; data: () => Record<string, unknown> }): AdminProduct {
  return normalizeProduct({ id: snapshot.id, ...snapshot.data() } as AdminProduct);
}

export async function fetchProducts(includeDeleted = false): Promise<AdminProduct[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.products),
      orderBy('createdAt', 'desc'),
    ));
    return snapshot.docs
      .map((document) => mapProductDoc(document))
      .filter((product) => includeDeleted || !product.isDeleted);
  } catch (error) {
    console.error('fetchProducts failed:', error);
    throw new Error('Unable to load products. Check your connection and permissions.');
  }
}

export function subscribeToProducts(
  includeDeleted: boolean,
  onData: (products: AdminProduct[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  const productsQuery = query(
    collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.products),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    productsQuery,
    (snapshot) => {
      const products = snapshot.docs
        .map((document) => mapProductDoc(document))
        .filter((product) => includeDeleted || !product.isDeleted);
      onData(products);
    },
    (error) => {
      console.error('subscribeToProducts failed:', error);
      onError?.(new Error(error.message || 'Unable to subscribe to products'));
    },
  );
}

export async function fetchProductById(id: string, includeDeleted = false): Promise<AdminProduct | null> {
  if (!isFirebaseConfigured() || !id) return null;
  try {
    const snapshot = await getDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.products, id));
    if (!snapshot.exists()) return null;
    const product = mapProductDoc(snapshot);
    if (product.isDeleted && !includeDeleted) return null;
    return product;
  } catch (error) {
    console.error('fetchProductById failed:', error);
    throw new Error('Unable to load product details.');
  }
}

export async function fetchProductCompositions(productId: string): Promise<ProductCompositionRow[]> {
  if (!isFirebaseConfigured() || !productId) return [];
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.productCompositions),
      where('productId', '==', productId),
    ));
    return snapshot.docs
      .map((document) => ({ id: document.id, ...document.data() } as ProductCompositionRow))
      .filter((row) => !(row as { isDeleted?: boolean }).isDeleted);
  } catch (error) {
    console.error('fetchProductCompositions failed:', error);
    return [];
  }
}

export async function fetchProductPacking(productId: string): Promise<ProductPackingRow[]> {
  if (!isFirebaseConfigured() || !productId) return [];
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.productPackingDetails),
      where('productId', '==', productId),
    ));
    return snapshot.docs
      .map((document) => ({ id: document.id, ...document.data() } as ProductPackingRow))
      .filter((row) => !(row as { isDeleted?: boolean }).isDeleted);
  } catch (error) {
    console.error('fetchProductPacking failed:', error);
    return [];
  }
}

export async function fetchProductAttachments(productId: string): Promise<ProductAttachment[]> {
  if (!isFirebaseConfigured() || !productId) return [];
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.productAttachments),
      where('productId', '==', productId),
    ));
    return snapshot.docs
      .map((document) => ({ id: document.id, ...document.data() } as ProductAttachment))
      .filter((row) => !(row as { isDeleted?: boolean }).isDeleted);
  } catch (error) {
    console.error('fetchProductAttachments failed:', error);
    return [];
  }
}

export async function isProductActiveForUse(productCodeOrId: string): Promise<boolean> {
  if (!isFirebaseConfigured() || !productCodeOrId) return false;
  try {
    const byId = await fetchProductById(productCodeOrId);
    if (byId) return byId.productStatus === 'Active' && !byId.isDeleted;
    const products = await fetchProducts();
    const product = products.find(
      (item) => item.productCode === productCodeOrId || item.productId === productCodeOrId,
    );
    if (!product) return false;
    return product.productStatus === 'Active' && !product.isDeleted;
  } catch {
    return false;
  }
}

export async function countLinkedBatches(productCode: string): Promise<number> {
  if (!isFirebaseConfigured() || !productCode) return 0;
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.batches),
      where('productCode', '==', productCode),
      limit(500),
    ));
    return snapshot.docs.filter((document) => document.data().isDeleted !== true).length;
  } catch (error) {
    console.error('countLinkedBatches failed:', error);
    return 0;
  }
}

export function buildProductCategoryGroups(products: AdminProduct[]): Array<{
  category: string;
  families: Array<{ productFamily: string; products: AdminProduct[] }>;
}> {
  const categoryMap = new Map<string, Map<string, AdminProduct[]>>();
  products.filter((p) => !p.isDeleted).forEach((product) => {
    const category = product.category || product.therapeuticCategory || 'Uncategorized';
    const family = product.productFamily || 'General';
    if (!categoryMap.has(category)) categoryMap.set(category, new Map());
    const familyMap = categoryMap.get(category)!;
    const list = familyMap.get(family) || [];
    list.push(product);
    familyMap.set(family, list);
  });
  return Array.from(categoryMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, familyMap]) => ({
      category,
      families: Array.from(familyMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([productFamily, items]) => ({
          productFamily,
          products: items.sort((a, b) => a.productName.localeCompare(b.productName)),
        })),
    }));
}

export function buildLifecycleDashboard(products: AdminProduct[]): Array<{
  lifecycleStatus: string;
  count: number;
  products: AdminProduct[];
}> {
  const map = new Map<string, AdminProduct[]>();
  PRODUCT_LIFECYCLE_STATUSES.forEach((status) => map.set(status, []));
  products.filter((p) => !p.isDeleted).forEach((product) => {
    const status = product.lifecycleStatus || 'Commercial';
    const list = map.get(status) || [];
    list.push(product);
    map.set(status, list);
  });
  return PRODUCT_LIFECYCLE_STATUSES.map((lifecycleStatus) => ({
    lifecycleStatus,
    count: (map.get(lifecycleStatus) || []).length,
    products: (map.get(lifecycleStatus) || []).sort((a, b) => a.productName.localeCompare(b.productName)),
  }));
}

export function canDeleteProductRecord(product: AdminProduct): { allowed: boolean; reason?: string } {
  if (product.isDeleted) {
    return { allowed: false, reason: 'Product is already deleted.' };
  }
  if (product.lifecycleStatus === 'Commercial' && product.productStatus === 'Active') {
    return { allowed: false, reason: 'Deactivate or archive active commercial products before deleting.' };
  }
  return { allowed: true };
}

export async function createProduct(
  data: ProductFormData,
  _meta: ProductAuditMeta,
): Promise<{ product: AdminProduct | null; error: string | null }> {
  try {
    const createFn = httpsCallable<Record<string, unknown>, AdminProduct>(
      getFirebaseFunctions(),
      'createAdminProduct',
    );
    const response = await createFn({
      ...data,
      reason: data.changeReason?.trim() || 'Product master change',
    });
    return { product: normalizeProduct(response.data), error: null };
  } catch (error) {
    return { product: null, error: callableErrorMessage(error, 'Unable to create product') };
  }
}

export async function updateProduct(
  id: string,
  data: ProductFormData,
  _existing: AdminProduct,
  _meta: ProductAuditMeta,
): Promise<{ product: AdminProduct | null; error: string | null; cascadeCount?: number }> {
  try {
    const updateFn = httpsCallable<
      Record<string, unknown>,
      { product: AdminProduct; cascadeCount: number }
    >(getFirebaseFunctions(), 'updateAdminProduct');
    const response = await updateFn({
      productDocId: id,
      updates: data,
      reason: data.changeReason?.trim() || 'Product master change',
    });
    return {
      product: normalizeProduct(response.data.product),
      error: null,
      cascadeCount: response.data.cascadeCount,
    };
  } catch (error) {
    return {
      product: null,
      error: callableErrorMessage(error, 'Unable to update product'),
    };
  }
}

export async function setProductStatus(
  id: string,
  _product: AdminProduct,
  productStatus: AdminProduct['productStatus'],
  _meta: ProductAuditMeta,
  reason = 'Product status change',
): Promise<{ success: boolean; error?: string }> {
  try {
    const setStatusFn = httpsCallable(getFirebaseFunctions(), 'setAdminProductStatus');
    await setStatusFn({ productDocId: id, productStatus, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to update product status') };
  }
}

export async function setProductLifecycle(
  id: string,
  _product: AdminProduct,
  lifecycleStatus: AdminProduct['lifecycleStatus'],
  _meta: ProductAuditMeta,
  reason = 'Product lifecycle change',
): Promise<{ success: boolean; error?: string }> {
  try {
    const setLifecycleFn = httpsCallable(getFirebaseFunctions(), 'setAdminProductLifecycle');
    await setLifecycleFn({ productDocId: id, lifecycleStatus, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to update product lifecycle') };
  }
}

export async function archiveProduct(
  id: string,
  _product: AdminProduct,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const archiveFn = httpsCallable(getFirebaseFunctions(), 'archiveAdminProduct');
    await archiveFn({ productDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to archive product') };
  }
}

export async function deleteProduct(
  id: string,
  product: AdminProduct,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const check = canDeleteProductRecord(product);
  if (!check.allowed) return { success: false, error: check.reason };

  const linkedBatches = await countLinkedBatches(product.productCode);
  if (linkedBatches > 0) {
    return {
      success: false,
      error: `Cannot delete product: ${linkedBatches} linked batch record(s) found`,
    };
  }

  try {
    const deleteFn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminProduct');
    await deleteFn({ productDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to delete product') };
  }
}

export async function restoreProduct(
  id: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const restoreFn = httpsCallable(getFirebaseFunctions(), 'restoreAdminProduct');
    await restoreFn({ productDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to restore product') };
  }
}

export async function bulkUpdateProducts(
  productIds: string[],
  action: 'activate' | 'deactivate' | 'archive',
  reason: string,
): Promise<{ successCount: number; error?: string }> {
  try {
    const bulkFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number }
    >(getFirebaseFunctions(), 'bulkUpdateAdminProducts');
    const response = await bulkFn({ productDocIds: productIds, action, reason });
    return { successCount: response.data.successCount };
  } catch (error) {
    return { successCount: 0, error: callableErrorMessage(error, 'Bulk update failed') };
  }
}

export async function bulkDeleteProducts(
  productIds: string[],
  reason: string,
): Promise<{ successCount: number; errors: string[]; error?: string }> {
  try {
    const bulkFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number; errors: string[] }
    >(getFirebaseFunctions(), 'bulkSoftDeleteAdminProducts');
    const response = await bulkFn({ productDocIds: productIds, reason });
    return response.data;
  } catch (error) {
    return { successCount: 0, errors: [], error: callableErrorMessage(error, 'Bulk delete failed') };
  }
}

export async function uploadProductAttachment(
  productId: string,
  file: File,
  attachmentType: ProductAttachment['attachmentType'],
  _meta: ProductAuditMeta,
  reason = 'Attachment registered after client upload',
): Promise<{ attachment: ProductAttachment | null; error?: string }> {
  if (file.size > PRODUCT_ATTACHMENT_MAX_BYTES) {
    return { attachment: null, error: 'File must be 10 MB or smaller' };
  }
  if (!isFirebaseConfigured()) {
    return { attachment: null, error: 'Firebase Storage is not configured' };
  }

  try {
    const path = `products/${productId}/attachments/${Date.now()}_${file.name}`;
    const storageRef = ref(getFirebaseStorage(), path);
    await uploadBytes(storageRef, file);
    const downloadUrl = await getDownloadURL(storageRef);

    const registerFn = httpsCallable<Record<string, unknown>, ProductAttachment>(
      getFirebaseFunctions(),
      'registerAdminProductAttachment',
    );
    const response = await registerFn({
      productDocId: productId,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      attachmentType,
      storagePath: path,
      downloadUrl,
      reason,
    });
    return { attachment: response.data };
  } catch (error) {
    return { attachment: null, error: callableErrorMessage(error, 'Unable to upload attachment') };
  }
}

export async function deleteProductAttachment(
  attachment: ProductAttachment,
  _meta: ProductAuditMeta,
  reason = 'Attachment deleted',
): Promise<{ success: boolean; error?: string }> {
  if (!attachment.id) {
    return { success: false, error: 'Attachment ID is required' };
  }

  try {
    const deleteFn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminProductAttachment');
    await deleteFn({ attachmentDocId: attachment.id, reason });

    if (attachment.storagePath && isFirebaseConfigured()) {
      try {
        await deleteObject(ref(getFirebaseStorage(), attachment.storagePath));
      } catch {
        /* storage file may already be removed */
      }
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to delete attachment') };
  }
}

export async function fetchProductAuditTrail(recordId: string) {
  if (!isFirebaseConfigured() || !recordId) return [];
  try {
    const db = getFirebaseFirestore();
    const [trail, logs] = await Promise.all([
      getDocs(query(
        collection(db, ADMIN_COLLECTIONS.auditTrail),
        where('documentId', '==', recordId),
        orderBy('timestamp', 'desc'),
        limit(30),
      )),
      getDocs(query(
        collection(db, ADMIN_COLLECTIONS.auditLogs),
        where('recordId', '==', recordId),
        orderBy('dateTime', 'desc'),
        limit(30),
      )),
    ]);
    return [...trail.docs, ...logs.docs]
      .map((snapshot): Record<string, unknown> => ({ id: snapshot.id, ...snapshot.data() }))
      .sort((a, b) => String(b.timestamp ?? b.dateTime).localeCompare(String(a.timestamp ?? a.dateTime)))
      .slice(0, 30);
  } catch (error) {
    console.error('fetchProductAuditTrail failed:', error);
    return [];
  }
}

export function exportProductsCsv(products: AdminProduct[]): string {
  const headers = [
    'Product ID', 'Code', 'Name', 'Generic Name', 'Brand Name', 'Product Family',
    'Therapeutic Category', 'Strength', 'Dosage Form', 'Route', 'Pack Size', 'Pack Type',
    'Container Closure', 'Market', 'Country', 'Manufacturing Site', 'Business Unit',
    'Department', 'Product Owner', 'Lifecycle', 'Shelf Life', 'Storage Condition',
    'Standard Batch Size', 'Mfg License', 'Registration No', 'License No',
    'MFR No', 'BMR No', 'BPR No', 'Specification No', 'STP No', 'Batch Prefix',
    'HSN Code', 'GTIN', 'Barcode', 'Status', 'Remarks',
  ];
  const rows = products.map((product) => [
    product.productId, product.productCode, product.productName, product.genericName,
    product.brandName, product.productFamily, product.therapeuticCategory, product.strength,
    product.dosageForm, product.routeOfAdministration, product.packSize, product.packType,
    product.containerClosure, product.market, product.country, product.manufacturingSite,
    product.businessUnit, product.department, product.productOwner, product.lifecycleStatus,
    product.shelfLife, product.storageCondition, product.standardBatchSize || product.batchSize,
    product.manufacturingLicenseNumber || product.manufacturingLicenseNo,
    product.registrationNumber, product.licenseNumber, product.mfrNumber, product.bmrNumber,
    product.bprNumber, product.specificationNumber, product.stpNumber, product.batchPrefix,
    product.hsnCode, product.gtin, product.barcode, product.productStatus, product.remarks,
  ]);
  return [headers.join(','), ...rows.map((row) =>
    row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','),
  )].join('\n');
}

export async function logProductExport(
  _meta: ProductAuditMeta,
  count: number,
  reason = 'Product list export',
) {
  try {
    const exportFn = httpsCallable(getFirebaseFunctions(), 'logAdminProductExport');
    await exportFn({ count, reason });
  } catch (error) {
    console.error('logProductExport failed:', error);
  }
}

export interface ProductImportRow extends Partial<ProductFormData> {
  mfrNumber?: string;
  bprNumber?: string;
  remarks?: string;
}

function splitImportLine(line: string): string[] {
  const hasTabs = line.includes('\t');
  if (hasTabs) return line.split('\t').map((c) => c.trim()).filter(Boolean);
  return (line
    .match(/("([^"]|"")*"|[^,]*)/g)
    ?.map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"').trim())
    .filter(Boolean) || []);
}

const IMPORT_PRODUCT_CODE = /\b([A-Z]{2,6}-\d+)\b/i;
const IMPORT_MFR = /\b(MFR\/\S+)/i;
const IMPORT_BPR = /\b(B(?:MR|PR)\/\S+)/i;

function isImportProductCode(value: string): boolean {
  return /^[A-Z]{2,6}-\d+$/i.test(value.trim());
}

function normalizeImportBprNumber(value: string): string {
  return value.trim().replace(/^BMR/i, 'BPR');
}

function parseSmartImportLine(line: string) {
  const trimmed = line.trim().replace(/^\d+\.\s*/, '');
  const codeMatch = trimmed.match(IMPORT_PRODUCT_CODE);
  const mfrMatch = trimmed.match(IMPORT_MFR);
  const bprMatch = trimmed.match(IMPORT_BPR);

  const productCode = codeMatch?.[1]?.trim() || '';
  const mfrNumber = mfrMatch?.[1]?.trim() || '';
  const bprNumber = bprMatch?.[1] ? normalizeImportBprNumber(bprMatch[1]) : '';

  let productName = trimmed;
  if (codeMatch && codeMatch.index !== undefined) {
    productName = trimmed.slice(0, codeMatch.index).trim();
  }
  productName = productName.replace(/\s+/g, ' ').trim();

  return { productCode, productName, mfrNumber, bprNumber, remarks: '' };
}

function mergeMultilineImportRows(lines: string[]): string[] {
  const merged: string[] = [];
  let buffer = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^s\.\s*no\./i.test(trimmed) || /^\d+\.\t/.test(trimmed) || /^\d+\.\s+\S/.test(trimmed)) {
      if (buffer) merged.push(buffer);
      buffer = trimmed;
      continue;
    }
    if (buffer) buffer = `${buffer} ${trimmed}`;
    else merged.push(trimmed);
  }

  if (buffer) merged.push(buffer);
  return merged;
}

export function extractStrengthFromProductName(rawName: string): { productName: string; strength: string } {
  let name = rawName.trim().replace(/\s+/g, ' ');
  let strength = '';

  const mlMatch = name.match(/(\d+(?:\.\d+)?)\s*ml\b/i);
  if (mlMatch) {
    strength = `${mlMatch[1]} ML`;
    name = name.replace(mlMatch[0], ' ').replace(/\s+/g, ' ').trim();
  }

  if (!strength) {
    const mgMatch = name.match(/(\d+(?:\.\d+)?)\s*mg\b/i);
    if (mgMatch) {
      strength = `${mgMatch[1]} MG`;
      name = name.replace(mgMatch[0], ' ').replace(/\s+/g, ' ').trim();
    }
  }

  if (!strength) {
    const ratioMatch = name.match(/\d+(?:\.\d+)?\s*mg\s*\/\s*\d+(?:\.\d+)?\s*ml/i);
    if (ratioMatch) {
      strength = ratioMatch[0].toUpperCase().replace(/\s+/g, ' ');
    }
  }

  name = name.replace(/\s*-\s*$/, '').replace(/^\s*-\s*/, '').trim();
  return { productName: name || rawName.trim(), strength: strength || 'N/A' };
}

function inferDosageForm(productName: string): ProductFormData['dosageForm'] {
  if (/\bINFUSION\b/i.test(productName)) return 'Injection';
  if (/\bINJ(ECTION)?\b/i.test(productName)) return 'Injection';
  return 'Injection';
}

function parseImportStatus(remarks: string): ProductFormData['productStatus'] {
  return /discontinue/i.test(remarks) ? 'Inactive' : 'Active';
}

function parseSmartImportColumns(cols: string[]) {
  const productCode = cols.find((c) => isImportProductCode(c))?.trim() || '';
  const mfrNumber = cols.find((c) => /^MFR\//i.test(c))?.trim() || '';
  const bprNumber = normalizeImportBprNumber(cols.find((c) => /^B(?:MR|PR)\//i.test(c)) || '');
  const codeIdx = productCode ? cols.indexOf(productCode) : -1;
  const productName = (codeIdx > 0 ? cols.slice(0, codeIdx) : cols.slice(1))
    .join(' ')
    .replace(/^\d+\.\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const remarks = cols[cols.length - 1] || '';

  return { productCode, productName, mfrNumber, bprNumber, remarks };
}

function makeUniqueImportCode(code: string, mfrNumber: string, seen: Set<string>): string {
  const base = code.trim();
  if (!base) return base;
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }

  const suffix = (mfrNumber || 'REV').replace(/^MFR\//i, '').replace(/\//g, '-');
  const alt = `${base}-${suffix}`;
  if (!seen.has(alt)) {
    seen.add(alt);
    return alt;
  }

  let i = 2;
  while (seen.has(`${alt}-${i}`)) i += 1;
  const unique = `${alt}-${i}`;
  seen.add(unique);
  return unique;
}

function defaultImportComposition(): ProductFormData['compositions'] {
  return [{
    ingredientName: 'API',
    ingredientType: 'API',
    grade: '',
    quantity: 1,
    unit: 'mg',
    functionPurpose: '',
    specificationNo: '',
    stpNo: '',
  }];
}

function rowToImportProduct(
  row: ProductImportRow,
  seenCodes: Set<string>,
): Omit<ProductFormData, 'changeReason'> | null {
  if (!row.productCode || !row.productName) return null;

  const extracted = extractStrengthFromProductName(row.productName);
  const productCode = makeUniqueImportCode(row.productCode, row.mfrNumber || '', seenCodes);

  return {
    productCode,
    productName: extracted.productName,
    genericName: row.genericName || extracted.productName,
    brandName: '',
    productFamily: '',
    category: '',
    strength: row.strength || extracted.strength,
    dosageForm: row.dosageForm || inferDosageForm(extracted.productName),
    routeOfAdministration: '',
    packSize: '',
    packType: '',
    containerClosure: '',
    market: row.market || 'Domestic',
    country: 'India',
    manufacturingSite: '',
    businessUnit: '',
    department: '',
    productOwner: '',
    lifecycleStatus: 'Commercial',
    therapeuticCategory: '',
    shelfLife: row.shelfLife || '24',
    storageCondition: '',
    standardBatchSize: '',
    manufacturingLicenseNumber: '',
    registrationNumber: '',
    licenseNumber: '',
    mfrNumber: row.mfrNumber || '',
    bmrNumber: '',
    bprNumber: row.bprNumber || '',
    specificationNumber: '',
    stpNumber: '',
    batchPrefix: '',
    hsnCode: '',
    gtin: '',
    barcode: '',
    qrCode: '',
    productStatus: row.productStatus || parseImportStatus(row.remarks || ''),
    description: '',
    remarks: row.remarks || 'Imported',
    compositions: row.compositions || defaultImportComposition(),
    packingDetails: row.packingDetails || [],
  };
}

export function parseProductImportRows(text: string): ProductImportRow[] {
  const lines = mergeMultilineImportRows(text.trim().split(/\r?\n/));
  if (lines.length === 0) return [];

  const headers = splitImportLine(lines[0]).map((h) => h.replace(/^"|"$/g, '').trim().toLowerCase());
  const isTabularHeader = headers.some((h) =>
    h.includes('product name') || h.includes('product code') || /^s\.?\s*no/.test(h),
  );
  const dataLines = isTabularHeader ? lines.slice(1) : lines;
  if (dataLines.length === 0) return [];

  const idx = (name: string) => headers.findIndex((h) => h.includes(name));
  const codeI = idx('product code') >= 0 ? idx('product code') : idx('code');
  const nameI = idx('product name') >= 0 ? idx('product name') : idx('name');
  const genericI = idx('generic');
  const strengthI = idx('strength');
  const mfrI = idx('mfr');
  const bprI = idx('bpr');
  const formI = idx('dosage');
  const marketI = idx('market');
  const shelfI = idx('shelf');
  const remarksI = idx('remark');

  return dataLines
    .map((line): ProductImportRow | null => {
      const cols = splitImportLine(line);
      const useSmart = !isTabularHeader
        || !line.includes('\t')
        || cols.some((c) => isImportProductCode(c));

      if (useSmart) {
        const smart = !line.includes('\t')
          ? parseSmartImportLine(line)
          : parseSmartImportColumns(cols);
        if (!smart.productCode || !smart.productName) return null;
        return {
          productCode: smart.productCode,
          productName: smart.productName,
          genericName: smart.productName,
          mfrNumber: smart.mfrNumber,
          bprNumber: smart.bprNumber,
          remarks: smart.remarks,
          productStatus: parseImportStatus(smart.remarks),
          dosageForm: inferDosageForm(smart.productName),
          shelfLife: '24',
          compositions: defaultImportComposition(),
          packingDetails: [],
        };
      }

      const productCode = cols[codeI] || '';
      const productName = cols[nameI] || '';
      if (!productCode || !productName) return null;

      return {
        productCode,
        productName,
        genericName: cols[genericI] || cols[nameI] || '',
        strength: cols[strengthI] || '',
        mfrNumber: cols[mfrI] || '',
        bprNumber: cols[bprI] || '',
        remarks: cols[remarksI] || '',
        productStatus: parseImportStatus(cols[remarksI] || ''),
        dosageForm: (cols[formI] || inferDosageForm(cols[nameI] || '')) as ProductFormData['dosageForm'],
        market: (cols[marketI] || 'Domestic') as ProductFormData['market'],
        shelfLife: cols[shelfI] || '24',
        compositions: defaultImportComposition(),
        packingDetails: [],
      };
    })
    .filter((r): r is ProductImportRow => r !== null);
}

export async function importProductsFromText(
  text: string,
  _meta: ProductAuditMeta,
  reason = 'Bulk product import from text',
): Promise<{ imported: number; errors: string[] }> {
  const parsedRows = parseProductImportRows(text);
  const seenCodes = new Set<string>();
  const rows = parsedRows
    .map((row) => rowToImportProduct(row, seenCodes))
    .filter((row): row is Omit<ProductFormData, 'changeReason'> => row !== null);

  if (rows.length === 0) {
    return { imported: 0, errors: [] };
  }

  try {
    const importFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number; errors: string[] }
    >(getFirebaseFunctions(), 'importAdminProducts');
    const response = await importFn({ rows, reason });
    return { imported: response.data.successCount, errors: response.data.errors };
  } catch (error) {
    return { imported: 0, errors: [callableErrorMessage(error, 'Import failed')] };
  }
}

export async function importProductsFromFile(
  file: File,
  meta: ProductAuditMeta,
  reason = 'Bulk product import from file',
): Promise<{ imported: number; errors: string[] }> {
  const text = await file.text();
  return importProductsFromText(text, meta, reason);
}
