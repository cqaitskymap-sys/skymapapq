'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { normalizeRole } from '@/lib/permissions';
import { fetchSignatureDashboardData, logSignatureDashboardViewed } from '@/lib/electronic-signatures-service';
import type {
  ElectronicSignatureRecord, SignatureKpis, SignatureCharts, SignatureFilters, SignatureActor,
} from '@/lib/electronic-signatures-types';
import {
  canViewSignatures, canSignRecords, canManageSignatures, canExportSignatures,
  isSignatureReadOnly, canVerifySignatures,
} from '@/lib/electronic-signatures-types';
import { emptySignatureKpis, emptySignatureCharts } from '@/lib/electronic-signatures-records';

const PAGE_SIZE = 20;

export function useElectronicSignatures(initialFilters?: SignatureFilters) {
  const { user, profile } = useAuth();
  const role = normalizeRole(profile?.role);
  const [filters, setFilters] = useState<SignatureFilters>(initialFilters || {});
  const [records, setRecords] = useState<ElectronicSignatureRecord[]>([]);
  const [metrics, setMetrics] = useState<SignatureKpis>(emptySignatureKpis());
  const [charts, setCharts] = useState<SignatureCharts>(emptySignatureCharts());
  const [meanings, setMeanings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const actor: SignatureActor = useMemo(() => ({
    id: user?.uid || 'anonymous',
    name: profile?.full_name || profile?.email || 'Unknown User',
    role,
    email: profile?.email || user?.email || '',
    department: profile?.department || '',
  }), [user?.uid, user?.email, profile?.full_name, profile?.email, profile?.department, role]);

  const refresh = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      if (!canViewSignatures(role)) {
        setRecords([]); setMetrics(emptySignatureKpis()); setCharts(emptySignatureCharts());
        return;
      }
      const data = await fetchSignatureDashboardData(filters);
      setRecords(data.records);
      setMetrics(data.metrics);
      setCharts(data.charts);
      setMeanings(data.meanings);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load signatures');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filters, role]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
  }, [filters]);

  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedRecords = records.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return {
    records, paginatedRecords, metrics, charts, meanings, filters, setFilters,
    loading, refreshing, error, refresh, actor,
    page: safePage, setPage, pageSize: PAGE_SIZE, totalPages,
    pagination: { page: safePage, pageSize: PAGE_SIZE, total: records.length, totalPages },
    selectedIds,
    toggleSelect: (id: string) => setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]),
    toggleSelectAll: () => {
      const pageIds = paginatedRecords.map((r) => r.id);
      const all = pageIds.every((id) => selectedIds.includes(id));
      setSelectedIds(all ? selectedIds.filter((id) => !pageIds.includes(id)) : Array.from(new Set([...selectedIds, ...pageIds])));
    },
    clearSelection: () => setSelectedIds([]),
    canSign: canSignRecords(role),
    canManage: canManageSignatures(role),
    canExport: canExportSignatures(role),
    canVerify: canVerifySignatures(role),
    isReadOnly: isSignatureReadOnly(role),
    canView: canViewSignatures(role),
    logViewed: useCallback(() => logSignatureDashboardViewed(actor), [actor]),
  };
}
