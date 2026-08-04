'use client';

import { useEffect, useState } from 'react';
import { fetchExecutiveDashboardData } from '@/lib/executive-dashboard-service';
import { LAUNCHER_MODULES } from '@/lib/launcher/module-definitions';

export interface LauncherStats {
  totalModules: number;
  pendingTasks: number;
  openCapas: number;
  openDeviations: number;
  loading: boolean;
}

export function useLauncherStats(): LauncherStats {
  const [stats, setStats] = useState<LauncherStats>({
    totalModules: LAUNCHER_MODULES.length,
    pendingTasks: 0,
    openCapas: 0,
    openDeviations: 0,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchExecutiveDashboardData();
        if (cancelled) return;
        const kpis = data.kpis;
        setStats({
          totalModules: LAUNCHER_MODULES.length,
          pendingTasks: (kpis.openCapa ?? 0) + (kpis.openDeviations ?? 0) + (kpis.openOos ?? 0),
          openCapas: kpis.openCapa ?? 0,
          openDeviations: kpis.openDeviations ?? 0,
          loading: false,
        });
      } catch {
        if (!cancelled) {
          setStats((prev) => ({ ...prev, loading: false }));
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return stats;
}
