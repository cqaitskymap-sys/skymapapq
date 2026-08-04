/**
 * Company / Site Master — privileged Cloud Functions.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore, type DocumentData, type WriteBatch } from 'firebase-admin/firestore';

function initializeAdmin() {
  if (getApps().length === 0) initializeApp();
}

function requiredString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function optionalString(value: unknown, field: string, maxLength = 200): string {
  if (value == null) return '';
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function validatedPhone(value: unknown, field: string): string {
  const phone = optionalString(value, field, 40);
  if (phone && !/^\+?[\d\s\-()]{10,20}$/.test(phone)) {
    throw new HttpsError('invalid-argument', `${field} is invalid`);
  }
  return phone;
}

function validatedEmail(value: unknown, field: string): string {
  const email = optionalString(value, field, 320);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', `${field} is invalid`);
  }
  return email;
}

function assertActiveAdmin(actor: DocumentData | undefined, actorRole: string) {
  if (!actor || actor.is_active !== true || !['super_admin', 'admin'].includes(actorRole)) {
    throw new HttpsError('permission-denied', 'Active administrator access required');
  }
}

const SITE_TYPES = [
  'Manufacturing Plant', 'Corporate Office', 'R&D Site', 'Warehouse',
  'Testing Laboratory', 'Contract Manufacturing Site',
] as const;

const COMPANY_TYPES = [
  'Private Limited', 'Public Limited', 'Partnership', 'LLP', 'Government',
  'Multinational', 'Subsidiary', 'Other',
] as const;

const INDUSTRIES = [
  'Pharmaceutical', 'Biotechnology', 'Medical Devices', 'Cosmetics', 'Nutraceutical',
  'Contract Manufacturing', 'API Manufacturing', 'Vaccines', 'Other',
] as const;

const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
const TIME_FORMATS = ['24h', '12h'] as const;
const CURRENCY_OPTIONS = ['INR', 'USD', 'EUR', 'GBP'] as const;

const SYSTEM_SITE_CODES = new Set(['HQ', 'MAIN', 'DEFAULT']);

function buildCompanyId(code: string): string {
  return `COMP-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

function buildSiteRecordId(code: string): string {
  return `SITE-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

function companySiteNotification(
  targetUid: string,
  recordId: string,
  eventName: string,
  title: string,
  message: string,
  now: string,
) {
  return {
    notificationId: `NTF-${Date.now().toString(36).toUpperCase()}-${recordId.slice(0, 6)}`,
    userId: targetUid,
    recipientUserId: targetUid,
    title,
    message,
    type: 'info',
    moduleName: 'Company / Site Master',
    eventName,
    recordId,
    priority: 'High',
    notificationChannel: 'In-App',
    readStatus: 'Unread',
    sentStatus: 'Sent',
    isRead: false,
    actionLink: `/admin/company-site/${recordId}`,
    createdAt: now,
    readAt: null,
    readBy: [],
    readAtBy: {},
  };
}

function writeCompanySiteAudit(
  batch: WriteBatch,
  firestore: Firestore,
  input: {
    actorUid: string;
    actorName: string;
    recordId: string;
    action: string;
    oldValue: unknown;
    newValue: unknown;
    reason: string;
    now: string;
  },
) {
  batch.set(firestore.collection('audit_logs').doc(), {
    dateTime: input.now,
    userId: input.actorUid,
    userName: input.actorName,
    module: 'Company / Site Master',
    recordId: input.recordId,
    action: input.action,
    oldValue: typeof input.oldValue === 'string' ? input.oldValue : JSON.stringify(input.oldValue ?? ''),
    newValue: typeof input.newValue === 'string' ? input.newValue : JSON.stringify(input.newValue ?? ''),
    reason: input.reason,
    ipAddress: 'server',
    device: 'cloud-function',
    status: 'Success',
  });
  batch.set(firestore.collection('audit_trail').doc(), {
    collectionName: 'company_sites',
    documentId: input.recordId,
    action: input.action,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    userId: input.actorUid,
    userName: input.actorName,
    moduleName: 'Company / Site Master',
    reason: input.reason,
    timestamp: input.now,
  });
}

function parseSitePayload(input: Record<string, unknown>, existing?: DocumentData) {
  const companyCode = requiredString(input.companyCode ?? existing?.companyCode, 'companyCode', 32).toUpperCase();
  const companyName = requiredString(input.companyName ?? existing?.companyName, 'companyName', 200);
  const siteCode = requiredString(input.siteCode ?? existing?.siteCode, 'siteCode', 32).toUpperCase();
  const siteName = requiredString(input.siteName ?? existing?.siteName, 'siteName', 200);
  const siteType = String(input.siteType ?? existing?.siteType ?? 'Manufacturing Plant');
  if (!SITE_TYPES.includes(siteType as typeof SITE_TYPES[number])) {
    throw new HttpsError('invalid-argument', 'Invalid site type');
  }
  const companyType = optionalString(input.companyType ?? existing?.companyType, 'companyType', 64);
  if (companyType && !COMPANY_TYPES.includes(companyType as typeof COMPANY_TYPES[number])) {
    throw new HttpsError('invalid-argument', 'Invalid company type');
  }
  const industry = optionalString(input.industry ?? existing?.industry, 'industry', 64);
  if (industry && !INDUSTRIES.includes(industry as typeof INDUSTRIES[number])) {
    throw new HttpsError('invalid-argument', 'Invalid industry');
  }
  const dateFormat = String(input.dateFormat ?? existing?.dateFormat ?? 'DD/MM/YYYY');
  if (!DATE_FORMATS.includes(dateFormat as typeof DATE_FORMATS[number])) {
    throw new HttpsError('invalid-argument', 'Invalid date format');
  }
  const timeFormat = String(input.timeFormat ?? existing?.timeFormat ?? '24h');
  if (!TIME_FORMATS.includes(timeFormat as typeof TIME_FORMATS[number])) {
    throw new HttpsError('invalid-argument', 'Invalid time format');
  }
  const defaultCurrency = String(input.defaultCurrency ?? existing?.defaultCurrency ?? 'INR');
  if (!CURRENCY_OPTIONS.includes(defaultCurrency as typeof CURRENCY_OPTIONS[number])) {
    throw new HttpsError('invalid-argument', 'Invalid currency');
  }
  const plantAddress = requiredString(
    input.plantAddress ?? input.siteAddress ?? existing?.plantAddress ?? existing?.siteAddress,
    'plantAddress',
    500,
  );
  const status = String(input.status ?? existing?.status ?? 'Active') === 'Inactive' ? 'Inactive' : 'Active';
  const gstNumber = optionalString(input.gstNumber ?? existing?.gstNumber, 'gstNumber', 32);
  const manufacturingLicenseNumber = optionalString(
    input.manufacturingLicenseNumber ?? existing?.manufacturingLicenseNumber,
    'manufacturingLicenseNumber',
    80,
  );

  return {
    companyId: buildCompanyId(companyCode),
    companyName,
    companyCode,
    legalName: optionalString(input.legalName ?? existing?.legalName, 'legalName', 200),
    shortName: optionalString(input.shortName ?? existing?.shortName, 'shortName', 40),
    companyType,
    industry,
    registrationNumber: optionalString(input.registrationNumber ?? existing?.registrationNumber, 'registrationNumber', 80),
    panNumber: optionalString(input.panNumber ?? existing?.panNumber, 'panNumber', 20),
    licenseNumber: optionalString(input.licenseNumber ?? existing?.licenseNumber, 'licenseNumber', 80),
    companyEmail: validatedEmail(input.companyEmail ?? existing?.companyEmail, 'companyEmail'),
    companyPhone: validatedPhone(input.companyPhone ?? existing?.companyPhone, 'companyPhone'),
    siteName,
    siteCode,
    siteRecordId: buildSiteRecordId(siteCode),
    siteType,
    businessUnit: optionalString(input.businessUnit ?? existing?.businessUnit, 'businessUnit', 160),
    isManufacturingUnit: Boolean(input.isManufacturingUnit ?? existing?.isManufacturingUnit ?? false),
    isWarehouse: Boolean(input.isWarehouse ?? existing?.isWarehouse ?? false),
    isLaboratory: Boolean(input.isLaboratory ?? existing?.isLaboratory ?? false),
    isOffice: Boolean(input.isOffice ?? existing?.isOffice ?? false),
    plantName: optionalString(input.plantName ?? existing?.plantName, 'plantName', 160),
    plantCode: optionalString(input.plantCode ?? existing?.plantCode, 'plantCode', 32),
    plantAddress,
    siteAddress: plantAddress,
    city: optionalString(input.city ?? existing?.city, 'city', 120),
    state: optionalString(input.state ?? existing?.state, 'state', 120),
    country: optionalString(input.country ?? existing?.country, 'country', 120) || 'India',
    pinZipCode: optionalString(input.pinZipCode ?? existing?.pinZipCode, 'pinZipCode', 20),
    gstNumber,
    gstNo: gstNumber,
    manufacturingLicenseNumber,
    drugLicenseNumber: optionalString(input.drugLicenseNumber ?? existing?.drugLicenseNumber, 'drugLicenseNumber', 80),
    licenseNo: manufacturingLicenseNumber,
    contactPerson: optionalString(input.contactPerson ?? existing?.contactPerson, 'contactPerson', 160),
    contactEmail: validatedEmail(input.contactEmail ?? existing?.contactEmail, 'contactEmail'),
    contactPhone: validatedPhone(input.contactPhone ?? existing?.contactPhone, 'contactPhone'),
    contactNumber: validatedPhone(input.contactPhone ?? existing?.contactPhone, 'contactPhone'),
    siteHead: optionalString(input.siteHead ?? existing?.siteHead, 'siteHead', 160),
    siteHeadId: optionalString(input.siteHeadId ?? existing?.siteHeadId, 'siteHeadId', 128),
    qualityHead: optionalString(input.qualityHead ?? existing?.qualityHead, 'qualityHead', 160),
    qualityHeadId: optionalString(input.qualityHeadId ?? existing?.qualityHeadId, 'qualityHeadId', 128),
    website: optionalString(input.website ?? existing?.website, 'website', 320),
    timezone: optionalString(input.timezone ?? existing?.timezone, 'timezone', 64) || 'Asia/Kolkata',
    defaultTimezone: optionalString(input.timezone ?? existing?.timezone, 'timezone', 64) || 'Asia/Kolkata',
    dateFormat,
    timeFormat,
    defaultCurrency,
    documentHeaderFormat: optionalString(
      input.documentHeaderFormat ?? existing?.documentHeaderFormat,
      'documentHeaderFormat',
      2000,
    ),
    documentFooterText: optionalString(
      input.documentFooterText ?? existing?.documentFooterText,
      'documentFooterText',
      2000,
    ),
    remarks: optionalString(input.remarks ?? existing?.remarks, 'remarks', 2000),
    status,
    isDefault: Boolean(input.isDefault ?? existing?.isDefault ?? false),
    isSystemSite: SYSTEM_SITE_CODES.has(siteCode) || Boolean(existing?.isSystemSite),
  };
}

async function assertUniqueCompanySite(
  firestore: Firestore,
  payload: ReturnType<typeof parseSitePayload>,
  excludeDocId?: string,
) {
  const [codeSnap, companyNameSnap, siteCodeSnap] = await Promise.all([
    firestore.collection('company_sites').where('companyCode', '==', payload.companyCode).limit(10).get(),
    firestore.collection('company_sites').where('companyName', '==', payload.companyName).limit(10).get(),
    firestore.collection('company_sites').where('siteCode', '==', payload.siteCode).limit(10).get(),
  ]);
  if (codeSnap.docs.some((doc) => doc.id !== excludeDocId && doc.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Company code already exists');
  }
  if (companyNameSnap.docs.some((doc) => doc.id !== excludeDocId && doc.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Company name already exists');
  }
  if (siteCodeSnap.docs.some((doc) => doc.id !== excludeDocId && doc.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Site code already exists');
  }
  const siteNameSnap = await firestore.collection('company_sites')
    .where('companyCode', '==', payload.companyCode)
    .where('siteName', '==', payload.siteName)
    .limit(10)
    .get();
  if (siteNameSnap.docs.some((doc) => doc.id !== excludeDocId && doc.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Site name already exists for this company');
  }
}

async function clearDefaultSite(firestore: Firestore, excludeDocId: string, actorUid: string, now: string) {
  const defaults = await firestore.collection('company_sites').where('isDefault', '==', true).limit(20).get();
  const batch = firestore.batch();
  defaults.docs.forEach((doc) => {
    if (doc.id !== excludeDocId && doc.data().isDeleted !== true) {
      batch.update(doc.ref, { isDefault: false, updatedAt: now, updatedBy: actorUid });
    }
  });
  if (!defaults.empty) await batch.commit();
}

async function countLinkedSiteReferences(firestore: Firestore, siteDocId: string, site: DocumentData) {
  const siteNames = [site.siteName, site.siteCode, siteDocId].map((v) => String(v || '').trim()).filter(Boolean);
  let total = 0;
  const usersById = await firestore.collection('users').where('siteId', '==', siteDocId).limit(500).get();
  total += usersById.docs.filter((doc) => doc.data().isDeleted !== true).length;
  const deptsById = await firestore.collection('departments').where('siteId', '==', siteDocId).limit(500).get();
  total += deptsById.docs.filter((doc) => doc.data().isDeleted !== true).length;
  const desById = await firestore.collection('designations').where('siteId', '==', siteDocId).limit(500).get();
  total += desById.docs.filter((doc) => doc.data().isDeleted !== true).length;
  for (const name of Array.from(new Set(siteNames))) {
    const usersByName = await firestore.collection('users').where('siteName', '==', name).limit(100).get();
    total += usersByName.docs.filter((doc) => doc.data().isDeleted !== true && doc.data().siteId !== siteDocId).length;
  }
  return total;
}

async function cascadeSiteReferenceUpdates(
  firestore: Firestore,
  batch: WriteBatch,
  siteDocId: string,
  existing: DocumentData,
  payload: ReturnType<typeof parseSitePayload>,
  actorUid: string,
  now: string,
) {
  let cascadeCount = 0;
  if (String(existing.siteName || '') !== payload.siteName || String(existing.companyName || '') !== payload.companyName) {
    const users = await firestore.collection('users').where('siteId', '==', siteDocId).limit(500).get();
    users.docs.forEach((doc) => {
      if (doc.data().isDeleted === true) return;
      batch.update(doc.ref, {
        siteName: payload.siteName,
        businessUnit: payload.businessUnit || payload.companyName,
        updatedAt: now,
        updatedBy: actorUid,
      });
      cascadeCount += 1;
    });
    const depts = await firestore.collection('departments').where('siteId', '==', siteDocId).limit(500).get();
    depts.docs.forEach((doc) => {
      if (doc.data().isDeleted === true) return;
      batch.update(doc.ref, {
        siteLocation: payload.siteName,
        businessUnit: payload.businessUnit || payload.companyName,
        updatedAt: now,
        updatedBy: actorUid,
      });
      cascadeCount += 1;
    });
    const desigs = await firestore.collection('designations').where('siteId', '==', siteDocId).limit(500).get();
    desigs.docs.forEach((doc) => {
      if (doc.data().isDeleted === true) return;
      batch.update(doc.ref, {
        siteName: payload.siteName,
        businessUnit: payload.businessUnit || payload.companyName,
        updatedAt: now,
        updatedBy: actorUid,
      });
      cascadeCount += 1;
    });
  }
  return cascadeCount;
}

export const createAdminCompanySite = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  assertActiveAdmin(actor, actorRole);

  const input = request.data as Record<string, unknown>;
  const reason = requiredString(input.reason || input.changeReason, 'reason', 500);
  const payload = parseSitePayload(input);
  await assertUniqueCompanySite(firestore, payload);

  const now = new Date().toISOString();
  const ref = firestore.collection('company_sites').doc();
  if (payload.isDefault) {
    await clearDefaultSite(firestore, ref.id, request.auth.uid, now);
  }

  const record = {
    ...payload,
    isDeleted: false,
    createdBy: request.auth.uid,
    updatedBy: request.auth.uid,
    createdAt: now,
    updatedAt: now,
  };

  const batch = firestore.batch();
  batch.set(ref, record);
  writeCompanySiteAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: ref.id,
    action: 'CREATE_COMPANY_SITE',
    oldValue: null,
    newValue: record,
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    companySiteNotification(
      request.auth.uid,
      ref.id,
      'COMPANY_SITE_CREATED',
      'Company / site created',
      `Site "${payload.siteName}" (${payload.companyName}) was created.`,
      now,
    ),
  );
  await batch.commit();
  return { id: ref.id, ...record };
});

export const updateAdminCompanySite = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const input = request.data as Record<string, unknown>;
  const siteDocId = requiredString(input.siteDocId, 'siteDocId', 128);
  const reason = requiredString(input.reason || input.changeReason, 'reason', 500);
  const updates = (input.updates && typeof input.updates === 'object' && !Array.isArray(input.updates))
    ? input.updates as Record<string, unknown>
    : input;

  const ref = firestore.collection('company_sites').doc(siteDocId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Site not found');
  }
  const existing = snap.data() || {};
  const payload = parseSitePayload({ ...existing, ...updates }, existing);
  await assertUniqueCompanySite(firestore, payload, siteDocId);

  const now = new Date().toISOString();
  if (payload.isDefault && !existing.isDefault) {
    await clearDefaultSite(firestore, siteDocId, request.auth.uid, now);
  }
  if (existing.isDefault && payload.status === 'Inactive') {
    throw new HttpsError('failed-precondition', 'Cannot deactivate the default site. Set another site as default first.');
  }

  const batch = firestore.batch();
  batch.update(ref, { ...payload, updatedAt: now, updatedBy: request.auth.uid });
  const cascadeCount = await cascadeSiteReferenceUpdates(
    firestore, batch, siteDocId, existing, payload, request.auth.uid, now,
  );

  if (String(existing.status || '') !== payload.status) {
    writeCompanySiteAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: siteDocId,
      action: payload.status === 'Active' ? 'SITE_ACTIVATED' : 'SITE_DEACTIVATED',
      oldValue: existing.status,
      newValue: payload.status,
      reason,
      now,
    });
  }
  if (Boolean(existing.isDefault) !== payload.isDefault) {
    writeCompanySiteAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: siteDocId,
      action: 'SET_DEFAULT_SITE',
      oldValue: existing.isDefault,
      newValue: payload.isDefault,
      reason,
      now,
    });
  }
  if (String(existing.businessUnit || '') !== payload.businessUnit) {
    writeCompanySiteAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: siteDocId,
      action: 'BUSINESS_UNIT_CHANGED',
      oldValue: existing.businessUnit,
      newValue: payload.businessUnit,
      reason,
      now,
    });
    batch.set(
      firestore.collection('notifications').doc(),
      companySiteNotification(
        request.auth.uid,
        siteDocId,
        'BUSINESS_UNIT_UPDATED',
        'Business unit updated',
        `Business unit for "${payload.siteName}" changed to "${payload.businessUnit || '—'}".`,
        now,
      ),
    );
  }
  if (String(existing.companyName || '') !== payload.companyName
    || String(existing.companyCode || '') !== payload.companyCode) {
    writeCompanySiteAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: siteDocId,
      action: 'HIERARCHY_CHANGED',
      oldValue: { companyCode: existing.companyCode, companyName: existing.companyName },
      newValue: { companyCode: payload.companyCode, companyName: payload.companyName },
      reason,
      now,
    });
  }
  writeCompanySiteAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: siteDocId,
    action: 'EDIT_COMPANY_SITE',
    oldValue: existing,
    newValue: payload,
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    companySiteNotification(
      request.auth.uid,
      siteDocId,
      'COMPANY_SITE_UPDATED',
      'Company / site updated',
      `Site "${payload.siteName}" was updated.`,
      now,
    ),
  );
  await batch.commit();
  return { site: { id: siteDocId, ...existing, ...payload }, cascadeCount };
});

export const setAdminCompanySiteStatus = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const siteDocId = requiredString(request.data?.siteDocId, 'siteDocId', 128);
  const status = String(request.data?.status || '') === 'Inactive' ? 'Inactive' : 'Active';
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('company_sites').doc(siteDocId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Site not found');
  }
  const existing = snap.data() || {};
  if (existing.isDefault && status === 'Inactive') {
    throw new HttpsError('failed-precondition', 'Cannot deactivate the default site. Set another site as default first.');
  }

  const linkedRefs = await countLinkedSiteReferences(firestore, siteDocId, existing);
  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, { status, updatedAt: now, updatedBy: request.auth.uid });
  writeCompanySiteAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: siteDocId,
    action: status === 'Active' ? 'SITE_ACTIVATED' : 'SITE_DEACTIVATED',
    oldValue: existing.status,
    newValue: status,
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    companySiteNotification(
      request.auth.uid,
      siteDocId,
      status === 'Active' ? 'SITE_ACTIVATED' : 'SITE_DEACTIVATED',
      status === 'Active' ? 'Site activated' : 'Site deactivated',
      `Site "${String(existing.siteName || '')}" is now ${status}.`,
      now,
    ),
  );
  await batch.commit();
  return { success: true, linkedRefs };
});

export const setDefaultAdminCompanySite = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const siteDocId = requiredString(request.data?.siteDocId, 'siteDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('company_sites').doc(siteDocId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Site not found');
  }
  const existing = snap.data() || {};
  if (String(existing.status || '') !== 'Active') {
    throw new HttpsError('failed-precondition', 'Only active sites can be set as default');
  }

  const now = new Date().toISOString();
  await clearDefaultSite(firestore, siteDocId, request.auth.uid, now);
  const batch = firestore.batch();
  batch.update(ref, { isDefault: true, updatedAt: now, updatedBy: request.auth.uid });
  writeCompanySiteAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: siteDocId,
    action: 'SET_DEFAULT_SITE',
    oldValue: existing.isDefault,
    newValue: true,
    reason,
    now,
  });
  await batch.commit();
  return { success: true };
});

export const softDeleteAdminCompanySite = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  assertActiveAdmin(actor, actorRole);
  if (actorRole !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only Super Admin can soft-delete company/sites');
  }

  const siteDocId = requiredString(request.data?.siteDocId, 'siteDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('company_sites').doc(siteDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Site not found');
  const existing = snap.data() || {};
  const siteCode = String(existing.siteCode || '').toUpperCase();
  if (SYSTEM_SITE_CODES.has(siteCode) || existing.isSystemSite === true || existing.isDefault === true) {
    throw new HttpsError('failed-precondition', 'System or default sites cannot be deleted');
  }

  const linkedRefs = await countLinkedSiteReferences(firestore, siteDocId, existing);
  if (linkedRefs > 0) {
    throw new HttpsError('failed-precondition', `Cannot delete site: ${linkedRefs} linked record(s) found`);
  }

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, {
    isDeleted: true,
    status: 'Inactive',
    isDefault: false,
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  writeCompanySiteAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: siteDocId,
    action: 'DELETE_COMPANY_SITE',
    oldValue: existing,
    newValue: { isDeleted: true, status: 'Inactive' },
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    companySiteNotification(
      request.auth.uid,
      siteDocId,
      'COMPANY_SITE_DELETED',
      'Company / site deleted',
      `Site "${String(existing.siteName || '')}" was soft-deleted.`,
      now,
    ),
  );
  await batch.commit();
  return { success: true };
});

export const restoreAdminCompanySite = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const siteDocId = requiredString(request.data?.siteDocId, 'siteDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('company_sites').doc(siteDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Site not found');
  const existing = snap.data() || {};
  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, {
    isDeleted: false,
    status: 'Active',
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  writeCompanySiteAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: siteDocId,
    action: 'RESTORE_COMPANY_SITE',
    oldValue: { isDeleted: existing.isDeleted, status: existing.status },
    newValue: { isDeleted: false, status: 'Active' },
    reason,
    now,
  });
  await batch.commit();
  return { success: true };
});

export const bulkUpdateAdminCompanySites = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const siteDocIds = Array.isArray(request.data?.siteDocIds)
    ? (request.data.siteDocIds as unknown[]).map((id) => String(id)).filter(Boolean).slice(0, 50)
    : [];
  if (siteDocIds.length === 0) {
    throw new HttpsError('invalid-argument', 'Select at least one site');
  }
  const action = String(request.data?.action || '');
  if (!['activate', 'deactivate'].includes(action)) {
    throw new HttpsError('invalid-argument', 'Unsupported bulk action');
  }
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const status = action === 'activate' ? 'Active' : 'Inactive';
  const now = new Date().toISOString();
  let successCount = 0;

  for (const siteDocId of siteDocIds) {
    const ref = firestore.collection('company_sites').doc(siteDocId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.isDeleted === true) continue;
    const existing = snap.data() || {};
    if (existing.isDefault && status === 'Inactive') continue;
    const batch = firestore.batch();
    batch.update(ref, { status, updatedAt: now, updatedBy: request.auth!.uid });
    writeCompanySiteAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: siteDocId,
      action: status === 'Active' ? 'SITE_ACTIVATED' : 'SITE_DEACTIVATED',
      oldValue: existing.status,
      newValue: status,
      reason,
      now,
    });
    await batch.commit();
    successCount += 1;
  }
  return { successCount };
});

export const bulkSoftDeleteAdminCompanySites = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  assertActiveAdmin(actor, actorRole);
  if (actorRole !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only Super Admin can bulk soft-delete company/sites');
  }

  const siteDocIds = Array.isArray(request.data?.siteDocIds)
    ? (request.data.siteDocIds as unknown[]).map((id) => String(id)).filter(Boolean).slice(0, 50)
    : [];
  if (siteDocIds.length === 0) {
    throw new HttpsError('invalid-argument', 'Select at least one site');
  }
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const now = new Date().toISOString();
  let successCount = 0;
  const errors: string[] = [];

  for (const siteDocId of siteDocIds) {
    try {
      const ref = firestore.collection('company_sites').doc(siteDocId);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const existing = snap.data() || {};
      if (existing.isDeleted === true) continue;
      const siteCode = String(existing.siteCode || '').toUpperCase();
      if (SYSTEM_SITE_CODES.has(siteCode) || existing.isSystemSite === true || existing.isDefault === true) {
        errors.push(`${existing.siteName || siteDocId}: system or default site`);
        continue;
      }
      const linkedRefs = await countLinkedSiteReferences(firestore, siteDocId, existing);
      if (linkedRefs > 0) {
        errors.push(`${existing.siteName || siteDocId}: ${linkedRefs} linked record(s)`);
        continue;
      }
      const batch = firestore.batch();
      batch.update(ref, {
        isDeleted: true,
        status: 'Inactive',
        isDefault: false,
        updatedAt: now,
        updatedBy: request.auth.uid,
      });
      writeCompanySiteAudit(batch, firestore, {
        actorUid: request.auth.uid,
        actorName: String(actor?.full_name || actor?.email || 'Admin'),
        recordId: siteDocId,
        action: 'DELETE_COMPANY_SITE',
        oldValue: existing,
        newValue: { isDeleted: true, status: 'Inactive' },
        reason,
        now,
      });
      await batch.commit();
      successCount += 1;
    } catch (error) {
      errors.push(`${siteDocId}: ${(error as Error).message}`);
    }
  }
  return { successCount, errors };
});

export const importAdminCompanySites = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const reason = requiredString(request.data?.reason, 'reason', 500);
  const rows = Array.isArray(request.data?.rows) ? request.data.rows as Record<string, unknown>[] : [];
  if (rows.length === 0) throw new HttpsError('invalid-argument', 'No import rows provided');
  if (rows.length > 50) throw new HttpsError('invalid-argument', 'Maximum 50 rows per import');

  const now = new Date().toISOString();
  let successCount = 0;
  const errors: string[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    try {
      const payload = parseSitePayload(rows[index]);
      await assertUniqueCompanySite(firestore, payload);
      const ref = firestore.collection('company_sites').doc();
      const record = {
        ...payload,
        isDeleted: false,
        createdBy: request.auth.uid,
        updatedBy: request.auth.uid,
        createdAt: now,
        updatedAt: now,
      };
      const batch = firestore.batch();
      batch.set(ref, record);
      writeCompanySiteAudit(batch, firestore, {
        actorUid: request.auth.uid,
        actorName: String(actor?.full_name || actor?.email || 'Admin'),
        recordId: ref.id,
        action: 'IMPORT_COMPANY_SITE',
        oldValue: null,
        newValue: record,
        reason,
        now,
      });
      await batch.commit();
      successCount += 1;
    } catch (error) {
      errors.push(`Row ${index + 1}: ${(error as Error).message}`);
    }
  }
  return { successCount, errors };
});

export const logAdminCompanySiteExport = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const count = Number(request.data?.count || 0);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeCompanySiteAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: 'export',
    action: 'EXPORT_COMPANY_SITE_LIST',
    oldValue: null,
    newValue: { count },
    reason,
    now,
  });
  await batch.commit();
  return { success: true };
});
