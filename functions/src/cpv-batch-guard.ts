import { type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

const OPERATIONAL_PRODUCT_STATUSES = new Set(['active', 'under review', 'approved']);

export async function assertOperationalCpvProduct(firestore: Firestore, cpvProductId: string) {
  if (!cpvProductId.trim()) {
    throw new HttpsError('invalid-argument', 'CPV product is required');
  }
  const snap = await firestore.collection('cpv_products').doc(cpvProductId).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('failed-precondition', 'CPV product not found');
  }
  const status = String(snap.data()?.cpvStatus || '').trim().toLowerCase();
  if (!OPERATIONAL_PRODUCT_STATUSES.has(status)) {
    throw new HttpsError('failed-precondition', 'Selected CPV product is not operational');
  }
  return snap.data() || {};
}

const BLOCKED_BATCH_STATUSES = new Set(['rejected', 'archived']);

/**
 * Monitoring results must reference a CPV batch that belongs to the selected product.
 * Rejected and archived batches cannot receive new results.
 */
export async function assertCpvBatchForProduct(
  firestore: Firestore,
  cpvProductId: string,
  batchNumber: string,
): Promise<void> {
  const batch = batchNumber.trim();
  if (!cpvProductId.trim()) {
    throw new HttpsError('invalid-argument', 'CPV product is required');
  }
  if (!batch) {
    throw new HttpsError('invalid-argument', 'Batch number is required');
  }

  const snap = await firestore.collection('cpv_batches')
    .where('batchNumber', '==', batch)
    .limit(15)
    .get();

  const match = snap.docs.find((doc) => {
    const data = doc.data();
    if (data.isDeleted === true || data.is_deleted === true) return false;
    const productId = String(data.cpvProductId || data.productId || '');
    return productId === cpvProductId;
  });

  if (!match) {
    throw new HttpsError(
      'failed-precondition',
      'Batch does not belong to the selected CPV product',
    );
  }

  const status = String(match.data().batchStatus || match.data().status || '').trim().toLowerCase();
  if (BLOCKED_BATCH_STATUSES.has(status)) {
    throw new HttpsError(
      'failed-precondition',
      'Rejected or archived batches cannot receive new monitoring results',
    );
  }
}
