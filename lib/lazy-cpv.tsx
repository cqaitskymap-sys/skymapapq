'use client';

import dynamic from 'next/dynamic';
import { KpiSkeleton } from '@/components/ui/table-skeleton';

const dashboardLoading = () => <KpiSkeleton count={8} />;

export const LazyCpvDashboard = dynamic(
  () => import('@/components/cpv/dashboard-page').then((m) => m.CpvDashboardPage),
  { loading: dashboardLoading, ssr: false },
);
