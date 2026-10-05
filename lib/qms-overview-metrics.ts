import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';

export interface QmsOverviewCounts {
  openDeviations: number | null;
  openOos: number | null;
  openCapas: number | null;
  openChangeControls: number | null;
  openComplaints: number | null;
}

const EMPTY: QmsOverviewCounts = {
  openDeviations: null,
  openOos: null,
  openCapas: null,
  openChangeControls: null,
  openComplaints: null,
};

async function countOpen(collectionName: string, statusField: string, closed: string[]): Promise<number | null> {
  try {
    const snap = await getCountFromServer(query(
      collection(getFirebaseFirestore(), collectionName),
      where(statusField, 'not-in', closed),
    ));
    return snap.data().count;
  } catch (error) {
    console.error(`QMS overview count failed for ${collectionName}`, error);
    return null;
  }
}

/** Live open-record counts. Null means the count could not be read — never a placeholder. */
export async function loadQmsOverviewCounts(): Promise<QmsOverviewCounts> {
  if (!isFirebaseConfigured()) return EMPTY;
  const [openDeviations, openOos, openCapas, openChangeControls, openComplaints] = await Promise.all([
    countOpen('deviations', 'status', ['closed', 'rejected']),
    countOpen('oos_records', 'status', ['closed', 'rejected']),
    countOpen('capa_records', 'capa_status', ['closed', 'rejected']),
    countOpen('change_controls', 'status', ['closed', 'cancelled', 'rejected']),
    countOpen('complaints', 'status', ['closed', 'rejected']),
  ]);
  return { openDeviations, openOos, openCapas, openChangeControls, openComplaints };
}
