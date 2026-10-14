'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import {
  listStudies, getStudyById, computeDashboardMetrics, syncSampleDueNotifications,
  listAllSamplePulls, listAllResults,
} from '@/lib/stability-service';
import type {
  StabilityStudy, StabilityFilters, StabilityDashboardMetrics,
  StabilitySamplePull, StabilityResult,
} from '@/lib/stability-types';
import { normalizeRole } from '@/lib/permissions';

export function useStabilityStudies(filters?: StabilityFilters) {
  const hasFilters = filters !== undefined;
  const product = filters?.product;
  const batchNumber = filters?.batch_number;
  const studyType = filters?.study_type;
  const storageCondition = filters?.storage_condition;
  const interval = filters?.interval;
  const status = filters?.status;
  const dateFrom = filters?.date_from;
  const dateTo = filters?.date_to;
  const search = filters?.search;
  const stableFilters = useMemo<StabilityFilters | undefined>(
    () => hasFilters ? {
      product,
      batch_number: batchNumber,
      study_type: studyType,
      storage_condition: storageCondition,
      interval,
      status,
      date_from: dateFrom,
      date_to: dateTo,
      search,
    } : undefined,
    [
      hasFilters, product, batchNumber, studyType, storageCondition, interval,
      status, dateFrom, dateTo, search,
    ],
  );
  const [records, setRecords] = useState<StabilityStudy[]>([]);
  const [pulls, setPulls] = useState<StabilitySamplePull[]>([]);
  const [results, setResults] = useState<StabilityResult[]>([]);
  const [metrics, setMetrics] = useState<StabilityDashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, pullData, resultData] = await Promise.all([
        listStudies(stableFilters), listAllSamplePulls(), listAllResults(),
      ]);
      void syncSampleDueNotifications().catch(() => undefined);
      setRecords(data);
      setPulls(pullData);
      setResults(resultData);
      setMetrics(computeDashboardMetrics(data, pullData, resultData));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stability studies');
    } finally {
      setLoading(false);
    }
  }, [stableFilters]);

  useEffect(() => { refresh(); }, [refresh]);

  return { records, pulls, results, metrics, loading, error, refresh };
}

export function useStabilityStudy(id: string) {
  const [record, setRecord] = useState<StabilityStudy | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setRecord(await getStudyById(id));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  return { record, loading, refresh };
}

export function useStabilityActor() {
  const { user, profile } = useAuth();
  const id = user?.uid || 'anonymous';
  const name = profile?.full_name || profile?.email || 'Unknown User';
  const role = normalizeRole(profile?.role);
  return useMemo(() => ({ id, name, role }), [id, name, role]);
}
