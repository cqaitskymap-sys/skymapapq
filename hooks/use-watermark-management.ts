'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { normalizeRole } from '@/lib/permissions';
import { fetchWatermarkDashboardData } from '@/lib/watermark-service';
import type {
  WatermarkTemplateRecord, WatermarkRuleRecord, WatermarkHistoryRecord,
  DocumentWatermarkRecord, WatermarkKpis, WatermarkCharts, WatermarkFilters, WatermarkActor,
} from '@/lib/watermark-types';
import {
  canViewWatermarks, canManageWatermarkTemplates, canManageWatermarks,
  canApproveWatermarkRules, isWatermarkReadOnly, canExportWatermarks, isDeptHeadWatermarkView,
} from '@/lib/watermark-types';
import { emptyWatermarkKpis, emptyWatermarkCharts } from '@/lib/watermark-records';

const PAGE_SIZE = 20;

export function useWatermarkManagement(initialFilters?: WatermarkFilters) {
  const { user, profile } = useAuth();
  const role = normalizeRole(profile?.role);
  const [filters, setFilters] = useState<WatermarkFilters>(initialFilters || {});
  const [templates, setTemplates] = useState<WatermarkTemplateRecord[]>([]);
  const [rules, setRules] = useState<WatermarkRuleRecord[]>([]);
  const [history, setHistory] = useState<WatermarkHistoryRecord[]>([]);
  const [docWatermarks, setDocWatermarks] = useState<DocumentWatermarkRecord[]>([]);
  const [metrics, setMetrics] = useState<WatermarkKpis>(emptyWatermarkKpis());
  const [charts, setCharts] = useState<WatermarkCharts>(emptyWatermarkCharts());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const actor: WatermarkActor = useMemo(() => ({
    id: user?.uid || 'anonymous',
    name: profile?.full_name || profile?.email || 'Unknown User',
    role,
    department: profile?.department || '',
  }), [user?.uid, profile?.full_name, profile?.email, profile?.department, role]);

  const deptOnly = isDeptHeadWatermarkView(role);

  const refresh = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      if (!canViewWatermarks(role)) {
        setTemplates([]); setRules([]); setHistory([]); setDocWatermarks([]);
        setMetrics(emptyWatermarkKpis()); setCharts(emptyWatermarkCharts());
        return;
      }
      const appliedFilters = deptOnly && actor.department
        ? { ...filters, department_only: actor.department }
        : filters;
      const data = await fetchWatermarkDashboardData(appliedFilters);
      setTemplates(data.templates);
      setRules(data.rules);
      setHistory(data.history);
      setDocWatermarks(data.docWatermarks);
      setMetrics(data.metrics);
      setCharts(data.charts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load watermark data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filters, role, deptOnly, actor]);

  useEffect(() => { void refresh(); }, [refresh]);

  const totalPages = Math.max(1, Math.ceil(templates.length / PAGE_SIZE));
  const paginatedTemplates = templates.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return {
    templates, paginatedTemplates, rules, history, docWatermarks, metrics, charts,
    filters, setFilters, loading, refreshing, error, refresh, actor,
    page, setPage, pageSize: PAGE_SIZE, totalPages,
    pagination: { page, pageSize: PAGE_SIZE, total: templates.length, totalPages },
    selectedIds,
    toggleSelect: (id: string) => setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]),
    toggleSelectAll: () => {
      const pageIds = paginatedTemplates.map((t) => t.id);
      const all = pageIds.every((id) => selectedIds.includes(id));
      setSelectedIds(all ? selectedIds.filter((id) => !pageIds.includes(id)) : Array.from(new Set([...selectedIds, ...pageIds])));
    },
    clearSelection: () => setSelectedIds([]),
    canManageTemplates: canManageWatermarkTemplates(role),
    canManage: canManageWatermarks(role),
    canApprove: canApproveWatermarkRules(role),
    canExport: canExportWatermarks(role),
    isReadOnly: isWatermarkReadOnly(role),
    canView: canViewWatermarks(role),
    deptOnly,
  };
}
