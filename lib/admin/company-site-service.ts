import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { uploadFile } from '@/lib/storage';
import { getFirebaseApp, getFirebaseAuth, getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import { ADMIN_COLLECTIONS, LOGO_ALLOWED_TYPES, LOGO_MAX_BYTES, SYSTEM_SITE_CODES } from './constants';
import type { CompanySite, CompanySiteFormData } from './schemas';

export interface CompanySiteAuditMeta {
  userId: string;
  userName: string;
  role?: string;
}

const SYSTEM_CODE_SET = new Set(SYSTEM_SITE_CODES.map((c) => c.toUpperCase()));

export function buildCompanyId(code: string): string {
  return `COMP-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

export function buildSiteRecordId(code: string): string {
  return `SITE-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

export function isSystemSite(site: Pick<CompanySite, 'siteCode' | 'isSystemSite' | 'isDefault'>): boolean {
  return Boolean(site.isSystemSite)
    || Boolean(site.isDefault)
    || SYSTEM_CODE_SET.has(String(site.siteCode || '').toUpperCase());
}

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

export function normalizeSite(site: CompanySite): CompanySite {
  const address = site.siteAddress || site.plantAddress || '';
  return {
    ...site,
    gstNo: site.gstNumber || site.gstNo || '',
    gstNumber: site.gstNumber || site.gstNo || '',
    contactNumber: site.contactPhone || site.contactNumber || '',
    contactPhone: site.contactPhone || site.contactNumber || '',
    defaultTimezone: site.timezone || site.defaultTimezone || 'Asia/Kolkata',
    timezone: site.timezone || site.defaultTimezone || 'Asia/Kolkata',
    licenseNo: site.manufacturingLicenseNumber || site.licenseNo || '',
    plantAddress: address,
    siteAddress: address,
    legalName: site.legalName || '',
    shortName: site.shortName || '',
    companyEmail: site.companyEmail || site.contactEmail || '',
    companyPhone: site.companyPhone || site.contactPhone || '',
    businessUnit: site.businessUnit || '',
    siteRecordId: site.siteRecordId || buildSiteRecordId(site.siteCode || ''),
    remarks: site.remarks || '',
    isSystemSite: isSystemSite(site),
    isDeleted: Boolean(site.isDeleted),
  };
}

export function formatDocumentHeader(site: CompanySite): string {
  if (site.documentHeaderFormat) return site.documentHeaderFormat;
  const s = normalizeSite(site);
  return [
    s.companyName,
    s.siteName,
    s.plantName ? `Plant: ${s.plantName}` : '',
    s.plantAddress,
    [s.city, s.state, s.country, s.pinZipCode].filter(Boolean).join(', '),
    s.gstNumber ? `GST: ${s.gstNumber}` : '',
    s.manufacturingLicenseNumber ? `Mfg License: ${s.manufacturingLicenseNumber}` : '',
    s.drugLicenseNumber ? `Drug License: ${s.drugLicenseNumber}` : '',
  ].filter(Boolean).join('\n');
}

export function formatDocumentFooter(site: CompanySite): string {
  if (site.documentFooterText) return site.documentFooterText;
  const s = normalizeSite(site);
  const parts = [
    s.website ? s.website : '',
    s.contactEmail ? `Email: ${s.contactEmail}` : '',
    s.contactPhone ? `Phone: ${s.contactPhone}` : '',
    'This document is confidential and intended for authorized use only.',
  ].filter(Boolean);
  return parts.join(' | ');
}

export async function fetchCompanySites(includeDeleted = false): Promise<CompanySite[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.companySites),
      orderBy('createdAt', 'desc'),
    ));
    return snapshot.docs
      .map((document) => normalizeSite({ id: document.id, ...document.data() } as CompanySite))
      .filter((site) => includeDeleted || !site.isDeleted);
  } catch (error) {
    console.error('fetchCompanySites failed:', error);
    throw new Error('Unable to load company/sites. Check your connection and permissions.');
  }
}

export function subscribeToCompanySites(
  includeDeleted: boolean,
  onData: (sites: CompanySite[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  const sitesQuery = query(
    collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.companySites),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    sitesQuery,
    (snapshot) => {
      const sites = snapshot.docs
        .map((document) => normalizeSite({ id: document.id, ...document.data() } as CompanySite))
        .filter((site) => includeDeleted || !site.isDeleted);
      onData(sites);
    },
    (error) => {
      console.error('subscribeToCompanySites failed:', error);
      onError?.(new Error(error.message || 'Unable to subscribe to company/sites'));
    },
  );
}

export async function fetchCompanySiteById(id: string, includeDeleted = false): Promise<CompanySite | null> {
  if (!isFirebaseConfigured() || !id) return null;
  try {
    const snapshot = await getDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.companySites, id));
    if (!snapshot.exists()) return null;
    const site = normalizeSite({ id: snapshot.id, ...snapshot.data() } as CompanySite);
    if (site.isDeleted && !includeDeleted) return null;
    return site;
  } catch (error) {
    console.error('fetchCompanySiteById failed:', error);
    throw new Error('Unable to load site details.');
  }
}

export async function getDefaultCompanySite(): Promise<CompanySite | null> {
  const sites = await fetchCompanySites();
  const activeDefault = sites.find((site) => site.isDefault && site.status === 'Active');
  return activeDefault || sites.find((site) => site.status === 'Active') || sites[0] || null;
}

export async function isSiteActiveForRecords(siteIdOrCode: string): Promise<boolean> {
  if (!isFirebaseConfigured() || !siteIdOrCode) return true;
  try {
    const byId = await fetchCompanySiteById(siteIdOrCode);
    if (byId) return byId.status === 'Active' && !byId.isDeleted;
    const sites = await fetchCompanySites();
    const site = sites.find(
      (item) => item.siteCode === siteIdOrCode || item.companyId === siteIdOrCode,
    );
    if (!site) return true;
    return site.status === 'Active' && !site.isDeleted;
  } catch {
    return true;
  }
}

export function buildCompanyHierarchy(sites: CompanySite[]): Array<{
  companyCode: string;
  companyName: string;
  sites: CompanySite[];
}> {
  const map = new Map<string, { companyCode: string; companyName: string; sites: CompanySite[] }>();
  sites.filter((site) => !site.isDeleted).forEach((site) => {
    const key = site.companyCode || site.companyId || site.companyName;
    const group = map.get(key) || {
      companyCode: site.companyCode || '',
      companyName: site.companyName || '',
      sites: [],
    };
    group.sites.push(site);
    map.set(key, group);
  });
  return Array.from(map.values())
    .sort((a, b) => a.companyName.localeCompare(b.companyName))
    .map((group) => ({
      ...group,
      sites: group.sites.sort((a, b) => a.siteName.localeCompare(b.siteName)),
    }));
}

export function buildBusinessUnitGroups(sites: CompanySite[]): Array<{
  businessUnit: string;
  companyName: string;
  sites: CompanySite[];
}> {
  const map = new Map<string, { businessUnit: string; companyName: string; sites: CompanySite[] }>();
  sites.filter((site) => !site.isDeleted).forEach((site) => {
    const unit = site.businessUnit?.trim() || 'Unassigned';
    const key = `${site.companyCode || site.companyName}::${unit}`;
    const group = map.get(key) || {
      businessUnit: unit,
      companyName: site.companyName || '',
      sites: [],
    };
    group.sites.push(site);
    map.set(key, group);
  });
  return Array.from(map.values()).sort((a, b) => a.businessUnit.localeCompare(b.businessUnit));
}

export function buildSiteMap(sites: CompanySite[]): Array<{
  country: string;
  states: Array<{ state: string; sites: CompanySite[] }>;
}> {
  const countryMap = new Map<string, Map<string, CompanySite[]>>();
  sites.filter((site) => !site.isDeleted).forEach((site) => {
    const country = site.country?.trim() || 'Unknown';
    const state = site.state?.trim() || 'Unknown';
    if (!countryMap.has(country)) countryMap.set(country, new Map());
    const stateMap = countryMap.get(country)!;
    const list = stateMap.get(state) || [];
    list.push(site);
    stateMap.set(state, list);
  });
  return Array.from(countryMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([country, stateMap]) => ({
      country,
      states: Array.from(stateMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([state, stateSites]) => ({
          state,
          sites: stateSites.sort((a, b) => a.siteName.localeCompare(b.siteName)),
        })),
    }));
}

export function canDeleteCompanySiteRecord(site: CompanySite): { allowed: boolean; reason?: string } {
  if (isSystemSite(site)) {
    return { allowed: false, reason: 'System or default sites cannot be deleted. Deactivate instead.' };
  }
  return { allowed: true };
}

export function validateLogoFile(file: File): { valid: boolean; error?: string } {
  if (!LOGO_ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: 'Logo must be PNG, JPG, JPEG, or WEBP' };
  }
  if (file.size > LOGO_MAX_BYTES) {
    return { valid: false, error: 'Logo must be 2 MB or smaller' };
  }
  return { valid: true };
}

export async function uploadCompanyLogo(
  siteId: string,
  file: File,
  meta: CompanySiteAuditMeta,
  existingLogo?: string,
): Promise<{ url: string | null; error?: string }> {
  const check = validateLogoFile(file);
  if (!check.valid) return { url: null, error: check.error };

  if (!isFirebaseConfigured()) {
    return { url: null, error: 'Firebase Storage is not configured' };
  }

  const authUser = getFirebaseAuth().currentUser;
  if (!authUser) {
    return { url: null, error: 'You must be signed in to upload a logo.' };
  }

  try {
    await authUser.getIdToken(true);
    const safeName = `${Date.now()}_logo_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const uploaded = await uploadFile({
      moduleName: 'company-sites',
      documentId: siteId,
      file,
      fileName: safeName,
      uploadedBy: meta.userId,
    });
    if (!uploaded?.fileUrl) {
      return { url: null, error: 'Logo upload failed. Deploy storage rules: npm run deploy:storage' };
    }
    return { url: uploaded.fileUrl };
  } catch (error) {
    return { url: null, error: (error as Error).message };
  }
}

export async function updateCompanyLogoViaCallable(
  siteDocId: string,
  logoUrl: string,
  existing: CompanySite,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const updateFn = httpsCallable(getFirebaseFunctions(), 'updateAdminCompanySite');
    await updateFn({
      siteDocId,
      updates: { ...existing, companyLogo: logoUrl },
      reason: reason || 'Company logo updated',
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to update logo') };
  }
}

export async function createCompanySite(
  data: CompanySiteFormData,
  _meta: CompanySiteAuditMeta,
): Promise<{ site: CompanySite | null; error: string | null }> {
  try {
    const createFn = httpsCallable<Record<string, unknown>, CompanySite>(
      getFirebaseFunctions(),
      'createAdminCompanySite',
    );
    const response = await createFn({
      ...data,
      reason: data.changeReason,
    });
    return { site: normalizeSite(response.data), error: null };
  } catch (error) {
    return { site: null, error: callableErrorMessage(error, 'Unable to create company/site') };
  }
}

export async function updateCompanySite(
  id: string,
  data: CompanySiteFormData,
  _existing: CompanySite,
  _meta: CompanySiteAuditMeta,
): Promise<{ site: CompanySite | null; error: string | null; cascadeCount?: number }> {
  try {
    const updateFn = httpsCallable<
      Record<string, unknown>,
      { site: CompanySite; cascadeCount: number }
    >(getFirebaseFunctions(), 'updateAdminCompanySite');
    const response = await updateFn({
      siteDocId: id,
      updates: data,
      reason: data.changeReason,
    });
    return {
      site: normalizeSite(response.data.site),
      error: null,
      cascadeCount: response.data.cascadeCount,
    };
  } catch (error) {
    return {
      site: null,
      error: callableErrorMessage(error, 'Unable to update company/site'),
    };
  }
}

export async function setCompanySiteStatus(
  id: string,
  site: CompanySite,
  status: 'Active' | 'Inactive',
  _meta: CompanySiteAuditMeta,
  reason = 'Company/site status change',
): Promise<{ success: boolean; error?: string; linkedRefs?: number }> {
  try {
    const setStatusFn = httpsCallable<
      Record<string, unknown>,
      { success: boolean; linkedRefs: number }
    >(getFirebaseFunctions(), 'setAdminCompanySiteStatus');
    const response = await setStatusFn({ siteDocId: id, status, reason });
    return { success: true, linkedRefs: response.data.linkedRefs };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to update site status') };
  }
}

export async function setDefaultCompanySite(
  id: string,
  _site: CompanySite,
  _meta: CompanySiteAuditMeta,
  reason = 'Set default site',
): Promise<{ success: boolean; error?: string }> {
  try {
    const setDefaultFn = httpsCallable(getFirebaseFunctions(), 'setDefaultAdminCompanySite');
    await setDefaultFn({ siteDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to set default site') };
  }
}

export async function deleteCompanySite(
  id: string,
  site: CompanySite,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const check = canDeleteCompanySiteRecord(site);
  if (!check.allowed) return { success: false, error: check.reason };

  try {
    const deleteFn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminCompanySite');
    await deleteFn({ siteDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to delete site') };
  }
}

export async function restoreCompanySite(
  id: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const restoreFn = httpsCallable(getFirebaseFunctions(), 'restoreAdminCompanySite');
    await restoreFn({ siteDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to restore site') };
  }
}

export async function bulkUpdateCompanySites(
  siteIds: string[],
  action: 'activate' | 'deactivate',
  reason: string,
): Promise<{ successCount: number; error?: string }> {
  try {
    const bulkFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number }
    >(getFirebaseFunctions(), 'bulkUpdateAdminCompanySites');
    const response = await bulkFn({ siteDocIds: siteIds, action, reason });
    return { successCount: response.data.successCount };
  } catch (error) {
    return { successCount: 0, error: callableErrorMessage(error, 'Bulk update failed') };
  }
}

export async function bulkDeleteCompanySites(
  siteIds: string[],
  reason: string,
): Promise<{ successCount: number; errors: string[]; error?: string }> {
  try {
    const bulkFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number; errors: string[] }
    >(getFirebaseFunctions(), 'bulkSoftDeleteAdminCompanySites');
    const response = await bulkFn({ siteDocIds: siteIds, reason });
    return response.data;
  } catch (error) {
    return { successCount: 0, errors: [], error: callableErrorMessage(error, 'Bulk delete failed') };
  }
}

export async function importCompanySites(
  rows: Array<Record<string, string>>,
  reason: string,
): Promise<{ successCount: number; errors: string[]; error?: string }> {
  try {
    const importFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number; errors: string[] }
    >(getFirebaseFunctions(), 'importAdminCompanySites');
    const response = await importFn({ rows, reason });
    return response.data;
  } catch (error) {
    return { successCount: 0, errors: [], error: callableErrorMessage(error, 'Import failed') };
  }
}

export async function countLinkedSiteReferences(siteId: string): Promise<number> {
  if (!isFirebaseConfigured() || !siteId) return 0;
  try {
    const db = getFirebaseFirestore();
    const [users, depts, desigs] = await Promise.all([
      getDocs(query(collection(db, ADMIN_COLLECTIONS.users), where('siteId', '==', siteId), limit(500))),
      getDocs(query(collection(db, ADMIN_COLLECTIONS.departments), where('siteId', '==', siteId), limit(500))),
      getDocs(query(collection(db, ADMIN_COLLECTIONS.designations), where('siteId', '==', siteId), limit(500))),
    ]);
    return [users, depts, desigs].reduce(
      (total, snapshot) => total + snapshot.docs.filter((doc) => doc.data().isDeleted !== true).length,
      0,
    );
  } catch (error) {
    console.error('countLinkedSiteReferences failed:', error);
    return 0;
  }
}

export async function fetchCompanySiteAuditTrail(recordId: string) {
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
    console.error('fetchCompanySiteAuditTrail failed:', error);
    return [];
  }
}

export function exportCompanySitesCsv(sites: CompanySite[]): string {
  const headers = [
    'Company ID', 'Company Code', 'Company Name', 'Legal Name', 'Short Name', 'Company Type', 'Industry',
    'Site Code', 'Site Name', 'Site Type', 'Business Unit', 'City', 'State', 'Country',
    'GST', 'Contact Person', 'Contact Email', 'Contact Phone', 'Site Head', 'Quality Head',
    'Status', 'Default', 'System', 'Remarks',
  ];
  const rows = sites.map((site) => [
    site.companyId, site.companyCode, site.companyName, site.legalName, site.shortName,
    site.companyType, site.industry, site.siteCode, site.siteName, site.siteType, site.businessUnit,
    site.city, site.state, site.country, site.gstNumber, site.contactPerson, site.contactEmail,
    site.contactPhone, site.siteHead, site.qualityHead, site.status, site.isDefault ? 'Yes' : 'No',
    isSystemSite(site) ? 'Yes' : 'No', site.remarks,
  ]);
  return [headers.join(','), ...rows.map((row) =>
    row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','),
  )].join('\n');
}

export function parseCompanySiteImportCsv(csvText: string): Array<Record<string, string>> {
  const lines = csvText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((header) => header.replace(/^"|"$/g, '').trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cols = line.match(/("([^"]|"")*"|[^,]*)/g)?.map((col) =>
      col.replace(/^"|"$/g, '').replace(/""/g, '"').trim(),
    ) || [];
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cols[index] || '';
    });
    return {
      companyCode: row['company code'] || row.companycode || row.code || '',
      companyName: row['company name'] || row.companyname || '',
      siteCode: row['site code'] || row.sitecode || '',
      siteName: row['site name'] || row.sitename || '',
      siteType: row['site type'] || row.sitetype || 'Manufacturing Plant',
      plantAddress: row.address || row['plant address'] || row.plantaddress || row['site address'] || '',
      city: row.city || '',
      state: row.state || '',
      country: row.country || 'India',
      businessUnit: row['business unit'] || row.businessunit || '',
      gstNumber: row.gst || row['gst number'] || row.gstnumber || '',
      contactPerson: row['contact person'] || row.contactperson || '',
      contactEmail: row['contact email'] || row.contactemail || row.email || '',
      contactPhone: row['contact phone'] || row.contactphone || row.phone || '',
    };
  }).filter((row) => row.companyCode && row.companyName && row.siteCode && row.siteName && row.plantAddress);
}

export async function logCompanySiteExport(_meta: CompanySiteAuditMeta, count: number, reason = 'Company/site list export') {
  try {
    const exportFn = httpsCallable(getFirebaseFunctions(), 'logAdminCompanySiteExport');
    await exportFn({ count, reason });
  } catch (error) {
    console.error('logCompanySiteExport failed:', error);
  }
}

/** @deprecated Use updateCompanyLogoViaCallable */
export async function updateCompanyLogo(
  id: string,
  logoUrl: string,
  existing: CompanySite,
  meta: CompanySiteAuditMeta,
): Promise<void> {
  await updateCompanyLogoViaCallable(id, logoUrl, existing, 'Company logo updated');
  void meta;
}
