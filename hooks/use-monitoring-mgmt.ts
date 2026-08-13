'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import {
  listAreas, listEnvironmental, listUtility, listExcursions,
  computeDashboardMetrics,
} from '@/lib/monitoring-mgmt-service';
import type {
  AreaRecord, EnvironmentalRecord, UtilityRecord, ExcursionRecord,
  AreaFilters, MonitoringFilters, MonitoringDashboardMetrics,
} from '@/lib/monitoring-mgmt-types';
import { normalizeRole } from '@/lib/permissions';

export function useMonitoring(areaFilters?: AreaFilters, monFilters?: MonitoringFilters) {
  const hasAreaFilters = areaFilters !== undefined;
  const cleanroomGrade = areaFilters?.cleanroom_grade;
  const areaStatus = areaFilters?.area_status;
  const department = areaFilters?.department;
  const areaSearch = areaFilters?.search;
  const stableAreaFilters = useMemo<AreaFilters | undefined>(
    () => hasAreaFilters ? {
      cleanroom_grade: cleanroomGrade,
      area_status: areaStatus,
      department,
      search: areaSearch,
    } : undefined,
    [hasAreaFilters, cleanroomGrade, areaStatus, department, areaSearch],
  );
  const hasMonFilters = monFilters !== undefined;
  const status = monFilters?.status;
  const monitoringType = monFilters?.monitoring_type;
  const utilityType = monFilters?.utility_type;
  const areaDocId = monFilters?.area_doc_id;
  const monSearch = monFilters?.search;
  const dateFrom = monFilters?.date_from;
  const dateTo = monFilters?.date_to;
  const stableMonFilters = useMemo<MonitoringFilters | undefined>(
    () => hasMonFilters ? {
      status,
      monitoring_type: monitoringType,
      utility_type: utilityType,
      area_doc_id: areaDocId,
      search: monSearch,
      date_from: dateFrom,
      date_to: dateTo,
    } : undefined,
    [hasMonFilters, status, monitoringType, utilityType, areaDocId, monSearch, dateFrom, dateTo],
  );
  const [areas, setAreas] = useState<AreaRecord[]>([]);
  const [environmental, setEnvironmental] = useState<EnvironmentalRecord[]>([]);
  const [utility, setUtility] = useState<UtilityRecord[]>([]);
  const [excursions, setExcursions] = useState<ExcursionRecord[]>([]);
  const [metrics, setMetrics] = useState<MonitoringDashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const settled = await Promise.allSettled([
        listAreas(stableAreaFilters),
        listEnvironmental(stableMonFilters),
        listUtility(stableMonFilters),
        listExcursions(),
      ]);
      const ar = settled[0].status === 'fulfilled' ? settled[0].value : [];
      const env = settled[1].status === 'fulfilled' ? settled[1].value : [];
      const utl = settled[2].status === 'fulfilled' ? settled[2].value : [];
      const exc = settled[3].status === 'fulfilled' ? settled[3].value : [];
      setAreas(ar);
      setEnvironmental(env);
      setUtility(utl);
      setExcursions(exc);
      setMetrics(computeDashboardMetrics(env, utl, exc));
      const firstErr = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      if (firstErr) {
        const reason = firstErr.reason;
        setError(reason instanceof Error ? reason.message : 'Failed to load monitoring data');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load monitoring data');
    } finally {
      setLoading(false);
    }
  }, [stableAreaFilters, stableMonFilters]);

  useEffect(() => { refresh(); }, [refresh]);
  return { areas, environmental, utility, excursions, metrics, loading, error, refresh };
}

export function useAreaItem(id: string) {
  const [record, setRecord] = useState<AreaRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { getAreaById } = await import('@/lib/monitoring-mgmt-service');
      setRecord(await getAreaById(id));
    } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { refresh(); }, [refresh]);
  return { record, loading, refresh };
}

export function useMonitoringActor() {
  const { user, profile } = useAuth();
  const id = user?.uid || 'anonymous';
  const name = profile?.full_name || profile?.email || 'Unknown';
  const role = normalizeRole(profile?.role);
  return useMemo(() => ({ id, name, role }), [id, name, role]);
}
