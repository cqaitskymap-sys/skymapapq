import { collection, getDocs, limit, query } from 'firebase/firestore';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  REPORT_COLLECTION_SOURCES,
  REPORT_MODULE_CATALOG,
  type DashboardReportsData,
  type RecentReportActivity,
} from '@/lib/dashboard-reports-records';

function pickString(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function pickNumber(data: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

function normalizeReportRow(
  id: string,
  data: Record<string, unknown>,
  source: (typeof REPORT_COLLECTION_SOURCES)[number],
): RecentReportActivity {
  const generatedAt = pickString(data, [
    'generated_at', 'generated_date', 'generatedDate', 'created_at', 'createdAt', 'updated_at', 'updatedAt',
  ]);
  return {
    id: `${source.moduleId}-${id}`,
    moduleId: source.moduleId,
    moduleLabel: source.moduleLabel,
    reportType: pickString(data, ['report_type', 'reportType', 'report_name', 'reportName']) || 'Report',
    reportNumber: pickString(data, ['report_number', 'reportNumber', 'report_id', 'reportId']) || id.slice(0, 8),
    generatedAt,
    generatedBy: pickString(data, ['generated_by_name', 'generatedBy', 'generated_by', 'createdByName', 'createdBy']) || 'System',
    status: pickString(data, ['report_status', 'reportStatus', 'status']) || 'Generated',
    totalRecords: pickNumber(data, ['total_records', 'totalRecords']),
    href: source.href,
  };
}

function isThisMonth(isoDate: string): boolean {
  if (!isoDate) return false;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

async function fetchCollectionReports(
  source: (typeof REPORT_COLLECTION_SOURCES)[number],
): Promise<RecentReportActivity[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(
      query(collection(getFirebaseFirestore(), source.collection), limit(50)),
    );
    return snap.docs
      .map((docSnap) => normalizeReportRow(docSnap.id, docSnap.data() as Record<string, unknown>, source))
      .filter((row) => !row.reportType.toLowerCase().includes('deleted'));
  } catch (error) {
    const code = String((error as { code?: string })?.code || '');
    if (code !== 'permission-denied') {
      console.error(`fetchCollectionReports ${source.collection}`, error);
    }
    return [];
  }
}

function emptyData(error?: string): DashboardReportsData {
  const moduleCount = REPORT_MODULE_CATALOG.reduce((sum, cat) => sum + cat.modules.length, 0);
  return {
    kpis: {
      totalReports: 0,
      generatedThisMonth: 0,
      moduleCount,
      lastGeneratedAt: null,
    },
    recentActivity: [],
    byModule: [],
    error,
  };
}

export async function fetchDashboardReportsData(): Promise<DashboardReportsData> {
  const moduleCount = REPORT_MODULE_CATALOG.reduce((sum, cat) => sum + cat.modules.length, 0);

  if (!isFirebaseConfigured()) {
    return {
      ...emptyData(),
      kpis: { totalReports: 0, generatedThisMonth: 0, moduleCount, lastGeneratedAt: null },
    };
  }

  try {
    const results = await Promise.all(REPORT_COLLECTION_SOURCES.map(fetchCollectionReports));
    const allReports = results.flat();

    const sorted = [...allReports].sort((a, b) => {
      const aTime = new Date(a.generatedAt).getTime() || 0;
      const bTime = new Date(b.generatedAt).getTime() || 0;
      return bTime - aTime;
    });

    const byModuleMap = new Map<string, number>();
    for (const report of allReports) {
      byModuleMap.set(report.moduleLabel, (byModuleMap.get(report.moduleLabel) || 0) + 1);
    }

    const byModule = Array.from(byModuleMap.entries())
      .map(([module, count]) => ({ module, count }))
      .sort((a, b) => b.count - a.count);

    return {
      kpis: {
        totalReports: allReports.length,
        generatedThisMonth: allReports.filter((r) => isThisMonth(r.generatedAt)).length,
        moduleCount,
        lastGeneratedAt: sorted[0]?.generatedAt || null,
      },
      recentActivity: sorted.slice(0, 25),
      byModule,
    };
  } catch (error) {
    console.error('fetchDashboardReportsData', error);
    return emptyData('Failed to load report activity from Firestore.');
  }
}
