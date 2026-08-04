import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  type QueryConstraint,
  type DocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { getFirebaseFirestore, isFirebaseConfigured, FirebaseNotConfiguredError } from './firebase';
import { auditCreate, auditUpdate, auditDelete, type AuditActor } from './audit-trail';

export { isFirebaseConfigured } from './firebase';

export interface BaseRecord {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
  status?: string;
  isDeleted?: boolean;
  [key: string]: unknown;
}

export interface DocumentActor extends AuditActor {
  id?: string;
  name?: string;
}

export interface DocumentAuditContext {
  moduleName: string;
  actor: DocumentActor;
}

export interface PaginatedResult<T> {
  items: T[];
  hasMore: boolean;
  lastDoc: DocumentSnapshot | null;
}

export interface QueryDocumentsOptions {
  constraints?: QueryConstraint[];
  pageSize?: number;
  cursor?: DocumentSnapshot | null;
  includeDeleted?: boolean;
}

function nowIso() {
  return new Date().toISOString();
}

/** Firestore rejects `undefined` field values — omit them before write (recursive). */
function stripUndefined<T>(value: T): T {
  if (value === undefined) return value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (val !== undefined) out[key] = stripUndefined(val);
  }
  return out as T;
}

function getDb() {
  if (!isFirebaseConfigured()) {
    throw new FirebaseNotConfiguredError();
  }
  return getFirebaseFirestore();
}

function withAuditFields<T extends Record<string, unknown>>(
  data: T,
  actor?: DocumentActor,
  isCreate = true,
): T & { createdAt: string; updatedAt: string; isDeleted: boolean } {
  const now = nowIso();
  return {
    ...data,
    status: (data.status as string) ?? 'active',
    isDeleted: false,
    ...(isCreate && {
      createdAt: now,
      createdBy: actor?.id || data.createdBy || 'system',
    }),
    updatedAt: now,
    updatedBy: actor?.id || data.updatedBy || actor?.id || 'system',
  } as T & { createdAt: string; updatedAt: string; isDeleted: boolean };
}

export async function createDocument<T extends BaseRecord>(
  collectionName: string,
  data: Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'isDeleted'>,
  audit?: DocumentAuditContext,
): Promise<T> {
  try {
    const db = getDb();
    const payload = withAuditFields(
      stripUndefined(data as Record<string, unknown>),
      audit?.actor,
      true,
    );
    const docRef = await addDoc(collection(db, collectionName), payload);

    if (audit) {
      await auditCreate(collectionName, docRef.id, audit.moduleName, audit.actor, payload);
    }

    return { id: docRef.id, ...payload } as unknown as T;
  } catch (error) {
    console.error(`createDocument failed [${collectionName}]:`, error);
    throw error;
  }
}

export async function getDocument<T extends BaseRecord>(
  collectionName: string,
  documentId: string,
  includeDeleted = false,
): Promise<T | null> {
  try {
    const db = getDb();
    const docSnap = await getDoc(doc(db, collectionName, documentId));
    if (!docSnap.exists()) return null;
    const data = { ...docSnap.data(), id: docSnap.id } as T;
    if (!includeDeleted && data.isDeleted) return null;
    return data;
  } catch (error) {
    console.error(`getDocument failed [${collectionName}/${documentId}]:`, error);
    return null;
  }
}

export async function getDocuments<T extends BaseRecord>(
  collectionName: string,
  constraints: QueryConstraint[] = [],
  includeDeleted = false,
): Promise<T[]> {
  try {
    const db = getDb();
    const q = query(collection(db, collectionName), ...constraints);
    const snap = await getDocs(q);
    const items = snap.docs.map((d) => ({ ...d.data(), id: d.id } as T));
    if (includeDeleted) return items;
    return items.filter((item) => !item.isDeleted);
  } catch (error) {
    console.error(`getDocuments failed [${collectionName}]:`, error);
    return [];
  }
}

export async function queryDocuments<T extends BaseRecord>(
  collectionName: string,
  options: QueryDocumentsOptions = {},
): Promise<PaginatedResult<T>> {
  const {
    constraints = [],
    pageSize = 25,
    cursor = null,
    includeDeleted = false,
  } = options;

  try {
    const db = getDb();
    const base: QueryConstraint[] = [
      orderBy('createdAt', 'desc'),
      ...constraints,
      limit((pageSize + 1) * (includeDeleted ? 1 : 2)),
    ];

    const q = cursor
      ? query(collection(db, collectionName), ...base, startAfter(cursor))
      : query(collection(db, collectionName), ...base);

    const snap = await getDocs(q);
    const allDocs = snap.docs
      .map((d) => ({ ...d.data(), id: d.id } as T))
      .filter((item) => includeDeleted || !item.isDeleted);

    const hasMore = allDocs.length > pageSize;
    const items = hasMore ? allDocs.slice(0, pageSize) : allDocs;
    const lastDoc = items.length
      ? snap.docs.find((d) => d.id === (items[items.length - 1] as BaseRecord).id) ?? null
      : null;

    return { items, hasMore, lastDoc };
  } catch (error) {
    console.error(`queryDocuments failed [${collectionName}]:`, error);
    return { items: [], hasMore: false, lastDoc: null };
  }
}

export async function updateDocument<T extends BaseRecord>(
  collectionName: string,
  documentId: string,
  updates: Partial<Omit<T, 'id' | 'createdAt' | 'createdBy'>>,
  audit?: DocumentAuditContext,
): Promise<T | null> {
  try {
    const db = getDb();
    const existing = await getDocument<T>(collectionName, documentId, true);
    if (!existing) return null;

    const now = nowIso();
    const payload = stripUndefined({
      ...updates,
      updatedAt: now,
      ...(audit?.actor?.id && { updatedBy: audit.actor.id }),
    } as Record<string, unknown>);

    await updateDoc(doc(db, collectionName, documentId), payload as DocumentData);

    if (audit) {
      const action = updates.status && updates.status !== existing.status ? 'STATUS_CHANGE' : 'UPDATE';
      await auditUpdate(collectionName, documentId, audit.moduleName, audit.actor, existing, payload, action);
    }

    return getDocument<T>(collectionName, documentId);
  } catch (error) {
    console.error(`updateDocument failed [${collectionName}/${documentId}]:`, error);
    return null;
  }
}

/** Soft delete — sets isDeleted: true */
export async function deleteDocument(
  collectionName: string,
  documentId: string,
  audit?: DocumentAuditContext,
): Promise<boolean> {
  try {
    const db = getDb();
    const existing = await getDocument(collectionName, documentId, true);
    if (!existing) return false;

    const now = nowIso();
    await updateDoc(doc(db, collectionName, documentId), {
      isDeleted: true,
      updatedAt: now,
      ...(audit?.actor?.id && { updatedBy: audit.actor.id }),
      status: 'deleted',
    });

    if (audit) {
      await auditDelete(collectionName, documentId, audit.moduleName, audit.actor, existing);
    }
    return true;
  } catch (error) {
    console.error(`deleteDocument failed [${collectionName}/${documentId}]:`, error);
    return false;
  }
}

export async function documentExists(
  collectionName: string,
  documentId: string,
): Promise<boolean> {
  try {
    const record = await getDocument(collectionName, documentId);
    return record !== null;
  } catch {
    return false;
  }
}

// ── Backward-compatible aliases ──
export const createRecord = createDocument;
export const getRecord = getDocument;
export const getRecords = getDocuments;
export const updateRecord = updateDocument;
export const deleteRecord = deleteDocument;
export const recordExists = documentExists;
export const getRecordsPaginated = <T extends BaseRecord>(
  collectionName: string,
  pageSize = 25,
  cursor: DocumentSnapshot | null = null,
  constraints: QueryConstraint[] = [],
) => queryDocuments<T>(collectionName, { pageSize, cursor, constraints });

export const timestampNow = nowIso;
