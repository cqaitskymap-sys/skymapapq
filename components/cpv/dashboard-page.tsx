'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  RefreshCw, Download, FileSpreadsheet, ChevronRight, AlertTriangle, FilterX,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell, PieChart, Pie,
} from 'recharts';
import {
  filterCpvRecords, filterRiskRecords, uniqueProducts, countByStatus,
  complianceTrend, productCompliance, openRiskCount, highRiskCount,
  compliancePercent, ootOosMonthlyTrend, riskLevelDistribution,
  cpkMonthlyTrend, batchReviewTrend, mapAuditToActivities,
  availableYears, filterGenericCpvRows, computeProcessHealthScore, sigmaFromCpk,
  type CpvDashboardFilters,
} from '@/lib/cpv-dashboard';
import {
  fetchCpvDashboardData, buildCppAlerts, buildCqaAlerts, pendingCpvReviews,
  pendingApprovalCount, annualReviewCount, averageCpkFromCapability,
  uniqueBatchNumbers, logCpvDashboardAudit, monitoringStatusStats, averageYieldPercent,
  batchStatusBreakdown, type CpvDashboardRawData,
} from '@/lib/cpv-dashboard-service';
import { downloadCsv, printPage } from '@/lib/export-utils';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DataState, KpiCard, StatusBadge } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';

const MONTHS = [
  { value: '01', label: 'Jan' }, { value: '02', label: 'Feb' }, { value: '03', label: 'Mar' },
  { value: '04', label: 'Apr' }, { value: '05', label: 'May' }, { value: '06', label: 'Jun' },
  { value: '07', label: 'Jul' }, { value: '08', label: 'Aug' }, { value: '09', label: 'Sep' },
  { value: '10', label: 'Oct' }, { value: '11', label: 'Nov' }, { value: '12', label: 'Dec' },
];

const CHART_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#64748b'];

function EmptyChart() {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-muted-foreground">
      No data for selected filters
    </div>
  );
}

export function CpvDashboardPage() {
  const { user, profile } = useAuth();
  const [data, setData] = useState<CpvDashboardRawData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<CpvDashboardFilters>({
    product: 'all', year: 'all', month: 'all', quarter: 'all',
    batchNo: 'all', riskLevel: 'all', status: 'all',
  });
  const viewedLogged = useRef(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    const result = await fetchCpvDashboardData();
    setData(result);
    setLoading(false);
    setRefreshing(false);
    if (result.error) toast.error(result.error);
    return result;
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (viewedLogged.current || !user?.uid || !data || data.error) return;
    viewedLogged.current = true;
    void logCpvDashboardAudit('View', {
      id: user.uid,
      name: profile?.full_name || profile?.email,
    });
  }, [user?.uid, data, profile?.full_name, profile?.email]);

  const cpp = useMemo(() => data?.cpp ?? [], [data?.cpp]);
  const cqa = useMemo(() => data?.cqa ?? [], [data?.cqa]);
  const risks = useMemo(() => data?.risks ?? [], [data?.risks]);

  const filteredCpp = useMemo(() => filterCpvRecords(cpp, filters), [cpp, filters]);
  const filteredCqa = useMemo(() => filterCpvRecords(cqa, filters), [cqa, filters]);
  const filteredRisks = useMemo(() => filterRiskRecords(risks, filters), [risks, filters]);

  const products = useMemo(() => {
    const fromData = uniqueProducts(cpp, cqa);
    const fromMaster = (data?.products || []).map((p) =>
      String(p.productName || p.product_name || p.name || ''),
    ).filter(Boolean);
    return Array.from(new Set([...fromData, ...fromMaster])).sort();
  }, [cpp, cqa, data?.products]);

  const batchNumbers = useMemo(() => uniqueBatchNumbers(cpp, cqa), [cpp, cqa]);
  const years = useMemo(() => availableYears([...cpp, ...cqa]), [cpp, cqa]);

  const cppStats = useMemo(() => countByStatus(filteredCpp), [filteredCpp]);
  const cqaStats = useMemo(() => countByStatus(filteredCqa), [filteredCqa]);
  const cppCompliancePct = compliancePercent(cppStats.complies, filteredCpp.length);
  const cqaCompliancePct = compliancePercent(cqaStats.complies, filteredCqa.length);

  const { averageCp, averageCpk, averagePpk } = useMemo(
    () => averageCpkFromCapability(data?.processCapability || [], filteredCpp, filteredCqa),
    [data?.processCapability, filteredCpp, filteredCqa],
  );

  const productsUnderCpv = filters.product && filters.product !== 'all'
    ? 1
    : Math.max(products.length, (data?.products || []).length);

  const batchesReviewed = useMemo(() => {
    const set = new Set<string>();
    filteredCpp.forEach((r) => r.batchNo && set.add(r.batchNo));
    filteredCqa.forEach((r) => r.batchNo && set.add(r.batchNo));
    return set.size;
  }, [filteredCpp, filteredCqa]);

  const stabilityStats = useMemo(() => {
    const rows = filterGenericCpvRows(data?.stabilityResults || [], filters);
    return {
      studies: filterGenericCpvRows(data?.stabilityStudies || [], filters).length,
      results: rows.length,
      oos: rows.filter((r) => String(r.status) === 'OOS').length,
      oot: rows.filter((r) => String(r.status) === 'OOT').length,
    };
  }, [data?.stabilityResults, data?.stabilityStudies, filters]);

  const holdTimeStats = useMemo(() => {
    const rows = filterGenericCpvRows(data?.holdTimeRecords || [], filters);
    return {
      total: rows.length,
      exceeded: rows.filter((r) => String(r.status) === 'Exceeded').length,
      compliant: rows.filter((r) => String(r.status) === 'Complies').length,
    };
  }, [data?.holdTimeRecords, filters]);

  const capabilityStats = useMemo(() => {
    const rows = filterGenericCpvRows(data?.processCapability || [], filters);
    const withCpk = rows.filter((r) => Number(r.cpk) > 0);
    return {
      total: rows.length,
      notCapable: rows.filter((r) => ['Not Capable', 'Poor'].includes(String(r.capabilityStatus || r.capability_status))).length,
      avgCpk: withCpk.length
        ? withCpk.reduce((s, r) => s + Number(r.cpk), 0) / withCpk.length
        : 0,
    };
  }, [data?.processCapability, filters]);

  const trendAnalysisStats = useMemo(() => {
    const rows = filterGenericCpvRows(data?.trendAnalysisRecords || [], filters);
    return {
      total: rows.length,
      alert: rows.filter((r) => String(r.trendStatus || r.trend_status) === 'Alert').length,
      oot: rows.filter((r) => String(r.trendStatus || r.trend_status) === 'OOT').length,
      oos: rows.filter((r) => String(r.trendStatus || r.trend_status) === 'OOS').length,
      highRisk: rows.filter((r) => ['High', 'Critical'].includes(String(r.riskLevel || r.risk_level))).length,
    };
  }, [data?.trendAnalysisRecords, filters]);

  const spcStats = useMemo(() => {
    const rows = filterGenericCpvRows(data?.controlChartRecords || [], filters);
    return {
      total: rows.length,
      outOfControl: rows.filter((r) => String(r.spcStatus || r.spc_status) === 'Out Of Control').length,
      violations: rows.reduce((s, r) => s + Number(r.ruleViolationsCount ?? r.rule_violations_count ?? 0), 0),
      highRisk: rows.filter((r) => ['High', 'Critical'].includes(String(r.riskLevel || r.risk_level))).length,
    };
  }, [data?.controlChartRecords, filters]);

  const rawStats = useMemo(
    () => monitoringStatusStats(filterGenericCpvRows(data?.rawMaterialRecords || [], filters)),
    [data?.rawMaterialRecords, filters],
  );
  const packingStats = useMemo(
    () => monitoringStatusStats(filterGenericCpvRows(data?.packingMaterialRecords || [], filters)),
    [data?.packingMaterialRecords, filters],
  );
  const utilityStats = useMemo(
    () => monitoringStatusStats(filterGenericCpvRows(data?.utilityRecords || [], filters)),
    [data?.utilityRecords, filters],
  );
  const envStats = useMemo(
    () => monitoringStatusStats(filterGenericCpvRows(data?.environmentalRecords || [], filters)),
    [data?.environmentalRecords, filters],
  );
  const filteredYield = useMemo(
    () => filterGenericCpvRows(data?.yieldRecords || [], filters),
    [data?.yieldRecords, filters],
  );
  const avgYield = useMemo(() => averageYieldPercent(filteredYield), [filteredYield]);
  const batchBreakdown = useMemo(
    () => batchStatusBreakdown(filterGenericCpvRows(data?.batches || [], filters)),
    [data?.batches, filters],
  );

  const kpis = useMemo(() => ({
    products: productsUnderCpv,
    batchesReviewed,
    cppParams: data?.cppParameters?.length || filteredCpp.length,
    cqaParams: data?.cqaParameters?.length || filteredCqa.length,
    cppCompliancePct,
    cqaCompliancePct,
    oot: cppStats.oot + cqaStats.oot,
    oos: cppStats.oos + cqaStats.oos,
    openRisks: openRiskCount(filteredRisks),
    highRisks: highRiskCount(filteredRisks),
    avgCp: averageCp,
    avgCpk: averageCpk,
    avgPpk: averagePpk,
    sigma: sigmaFromCpk(averageCpk),
    annualReviews: annualReviewCount(data?.cpvReviews || []),
    pendingApprovals: pendingApprovalCount(data?.cpvReviews || []),
    openCapa: data?.openCapaCount || 0,
    openDeviations: data?.openDeviationCount || 0,
    openChangeControls: data?.openChangeControlCount || 0,
    stabilityStudies: stabilityStats.studies,
    stabilityOos: stabilityStats.oos,
    holdTimeRecords: holdTimeStats.total,
    holdTimeExceeded: holdTimeStats.exceeded,
    capabilityReviews: capabilityStats.total,
    capabilityNotCapable: capabilityStats.notCapable,
    trendAnalysisTotal: trendAnalysisStats.total,
    trendAnalysisIssues: trendAnalysisStats.alert + trendAnalysisStats.oot + trendAnalysisStats.oos,
    spcTotal: spcStats.total,
    spcOutOfControl: spcStats.outOfControl,
    rawTotal: rawStats.total,
    rawOos: rawStats.oos,
    packingTotal: packingStats.total,
    packingOos: packingStats.oos,
    utilityTotal: utilityStats.total,
    utilityOos: utilityStats.oos,
    envTotal: envStats.total,
    envOos: envStats.oos,
    avgYield,
    batchesApproved: batchBreakdown.approved,
    batchesRejected: batchBreakdown.rejected,
    batchesRunning: batchBreakdown.running,
    batchesOnHold: batchBreakdown.onHold,
  }), [
    productsUnderCpv, batchesReviewed, data, filteredCpp, filteredCqa,
    cppCompliancePct, cqaCompliancePct, cppStats, cqaStats, filteredRisks,
    averageCp, averageCpk, averagePpk, stabilityStats, holdTimeStats, capabilityStats, trendAnalysisStats, spcStats,
    rawStats, packingStats, utilityStats, envStats, avgYield, batchBreakdown,
  ]);

  const healthScore = useMemo(() => computeProcessHealthScore({
    cppCompliancePct: kpis.cppCompliancePct,
    cqaCompliancePct: kpis.cqaCompliancePct,
    openHighRisks: kpis.highRisks,
    oosCount: kpis.oos,
    spcOutOfControl: kpis.spcOutOfControl,
    holdExceeded: kpis.holdTimeExceeded,
    avgCpk: kpis.avgCpk,
  }), [kpis]);

  const charts = useMemo(() => ({
    cppCompliance: complianceTrend(filteredCpp),
    cqaCompliance: complianceTrend(filteredCqa),
    ootOos: ootOosMonthlyTrend(filteredCpp, filteredCqa),
    product: productCompliance(filteredCpp, filteredCqa),
    riskDist: riskLevelDistribution(filteredRisks),
    cpkTrend: cpkMonthlyTrend(filterGenericCpvRows(data?.processCapability || [], filters).map((r) => ({
      cpk: Number(r.cpk),
      createdAt: String(r.createdAt || r.created_at || ''),
      date: String(r.date || ''),
    }))),
    batchTrend: batchReviewTrend([...filteredCpp, ...filteredCqa]),
  }), [filteredCpp, filteredCqa, filteredRisks, data?.processCapability, filters]);

  const cppAlerts = useMemo(() => buildCppAlerts(filteredCpp), [filteredCpp]);
  const cqaAlerts = useMemo(() => buildCqaAlerts(filteredCqa), [filteredCqa]);
  const pendingReviews = useMemo(() => pendingCpvReviews(data?.cpvReviews || []), [data?.cpvReviews]);
  const activities = useMemo(() => mapAuditToActivities(data?.auditTrail || []), [data?.auditTrail]);

  const setFilter = (key: keyof CpvDashboardFilters, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleRefresh = async () => {
    await load(true);
    await logCpvDashboardAudit('Refresh', {
      id: user?.uid,
      name: profile?.full_name || profile?.email,
    });
    toast.success('Dashboard refreshed');
  };

  const handleExportPdf = async () => {
    printPage();
    await logCpvDashboardAudit('Export', {
      id: user?.uid,
      name: profile?.full_name || profile?.email,
    }, 'PDF summary');
    toast.success('PDF export opened — use browser print to save');
  };

  const handleExportExcel = async () => {
    downloadCsv(
      `cpv_dashboard_${new Date().toISOString().split('T')[0]}.csv`,
      ['Metric', 'Value'],
      [
        ['Process Health Score', healthScore],
        ['Products Under CPV', kpis.products],
        ['Batches Reviewed', kpis.batchesReviewed],
        ['Batches Approved', kpis.batchesApproved],
        ['Batches Rejected', kpis.batchesRejected],
        ['Batches Running', kpis.batchesRunning],
        ['Batches On Hold', kpis.batchesOnHold],
        ['CPP Parameters', kpis.cppParams],
        ['CQA Parameters', kpis.cqaParams],
        ['CPP Compliant %', kpis.cppCompliancePct],
        ['CQA Compliant %', kpis.cqaCompliancePct],
        ['OOT Count', kpis.oot],
        ['OOS Count (CPP+CQA)', kpis.oos],
        ['Open Risks', kpis.openRisks],
        ['High Risk Count', kpis.highRisks],
        ['Average Cp', kpis.avgCp.toFixed(2)],
        ['Average Cpk', kpis.avgCpk.toFixed(2)],
        ['Average Ppk', kpis.avgPpk.toFixed(2)],
        ['Approx Sigma', kpis.sigma.toFixed(2)],
        ['Average Yield %', kpis.avgYield],
        ['Open CAPA', kpis.openCapa],
        ['Open Deviations', kpis.openDeviations],
        ['Open Change Controls', kpis.openChangeControls],
        ['Annual CPV Reviews', kpis.annualReviews],
        ['Pending Approvals', kpis.pendingApprovals],
        ['SPC Out Of Control', kpis.spcOutOfControl],
        ['Raw Material OOS', kpis.rawOos],
        ['Packing OOS', kpis.packingOos],
        ['Utility OOS', kpis.utilityOos],
        ['Environmental OOS', kpis.envOos],
        ['Hold Time Exceeded', kpis.holdTimeExceeded],
        ['Fetched At', data?.fetchedAt || ''],
      ],
    );
    await logCpvDashboardAudit('Export', {
      id: user?.uid,
      name: profile?.full_name || profile?.email,
    }, 'Excel / CSV summary');
    toast.success('Dashboard summary exported');
  };

  const cpkTone = averageCpk >= 1.33 ? 'green' : averageCpk >= 1 ? 'amber' : 'red';
  const healthTone = healthScore >= 85 ? 'green' : healthScore >= 70 ? 'amber' : 'red';

  if (loading && !data) {
    return <DataState loading empty={false} />;
  }

  if (data?.error && !cpp.length && !cqa.length) {
    return (
      <ErrorCard message={data.error} onRetry={() => load(true)} />
    );
  }

  const quickLinks = [
    { href: '/cpv/product-master', label: 'Product' },
    { href: '/cpv/batch-registration', label: 'Batch' },
    { href: '/cpv/equipment-review', label: 'Process / Equipment' },
    { href: '/cpv/cpp', label: 'CPP' },
    { href: '/cpv/cqa', label: 'CQA' },
    { href: '/cpv/trend-analysis', label: 'Trend' },
    { href: '/cpv/control-charts', label: 'SPC' },
    { href: '/cpv/alert-engine', label: 'Alarms' },
    { href: '/cpv/process-capability', label: 'Capability' },
    { href: '/cpv/risk-assessment', label: 'Risk' },
    { href: '/cpv/reports-analytics', label: 'Reports' },
    { href: '/cpv/ai-analytics', label: 'Analytics' },
    { href: '/admin/audit-trail', label: 'Audit Trail' },
    { href: '/qms/capa', label: 'CAPA' },
    { href: '/qms/deviation', label: 'Deviation' },
    { href: '/qms/change-control', label: 'Change Control' },
    { href: '/qms/equipment', label: 'Equipment' },
    { href: '/qms/equipment/calibration-schedule', label: 'Calibration' },
    { href: '/qms/equipment/preventive-maintenance', label: 'Maintenance' },
  ];

  return (
    <div id="cpv-dashboard-root" className="space-y-6">
      {/* Breadcrumb */}
      <nav className="no-print flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <Link href="/dashboard" className="hover:text-blue-600">Dashboard</Link>
        <ChevronRight className="h-3 w-3" />
        <Link href="/cpv" className="hover:text-blue-600">Continued Process Verification</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="font-medium text-slate-900 dark:text-slate-100">CPV Dashboard</span>
      </nav>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">CPV Dashboard</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Stage 3 Continued Process Verification — process health, CPP/CQA, capability, SPC, and risk overview
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPdf}>
            <Download className="h-4 w-4 mr-1" />Export PDF
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportExcel}>
            <FileSpreadsheet className="h-4 w-4 mr-1" />Export Excel
          </Button>
        </div>
      </div>

      {data?.truncated && (
        <Card className="no-print border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="p-3 text-sm text-amber-800 dark:text-amber-200">
            Large datasets are truncated at query limits (≤500 rows per collection). Refine filters or open submodule pages for full detail.
          </CardContent>
        </Card>
      )}

      <div className="no-print flex flex-wrap gap-1.5">
        {quickLinks.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900"
          >
            {l.label}
          </Link>
        ))}
      </div>

      <Card className={`border-l-4 shadow-sm ${healthTone === 'green' ? 'border-l-emerald-500' : healthTone === 'amber' ? 'border-l-amber-500' : 'border-l-red-500'}`}>
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Overall Process Health Score</p>
            <p className="text-3xl font-bold">{healthScore}</p>
            <p className="text-xs text-muted-foreground">
              Weighted from CPP/CQA compliance, Cpk, OOS, SPC, hold-time, and high risks
              {data?.fetchedAt ? ` · Synced ${new Date(data.fetchedAt).toLocaleString()}` : ''}
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
            <div className="rounded border px-3 py-2"><p className="text-muted-foreground">Approved</p><p className="font-semibold">{kpis.batchesApproved}</p></div>
            <div className="rounded border px-3 py-2"><p className="text-muted-foreground">Running</p><p className="font-semibold">{kpis.batchesRunning}</p></div>
            <div className="rounded border px-3 py-2"><p className="text-muted-foreground">On Hold</p><p className="font-semibold">{kpis.batchesOnHold}</p></div>
            <div className="rounded border px-3 py-2"><p className="text-muted-foreground">Rejected</p><p className="font-semibold">{kpis.batchesRejected}</p></div>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card className="no-print border-slate-200 shadow-sm">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Filters</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setFilters({
                product: 'all', year: 'all', month: 'all', quarter: 'all',
                batchNo: 'all', riskLevel: 'all', status: 'all',
              });
              void logCpvDashboardAudit('Filter', {
                id: user?.uid,
                name: profile?.full_name || profile?.email,
              }, 'Cleared all filters');
            }}
          >
            <FilterX className="h-3.5 w-3.5 mr-1" />
            Clear
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            <Select value={filters.product || 'all'} onValueChange={(v) => setFilter('product', v)}>
              <SelectTrigger><SelectValue placeholder="Product" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Products</SelectItem>
                {products.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.year || 'all'} onValueChange={(v) => setFilter('year', v)}>
              <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.month || 'all'} onValueChange={(v) => setFilter('month', v)}>
              <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {MONTHS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.quarter || 'all'} onValueChange={(v) => setFilter('quarter', v)}>
              <SelectTrigger><SelectValue placeholder="Quarter" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Quarters</SelectItem>
                <SelectItem value="Q1">Q1</SelectItem>
                <SelectItem value="Q2">Q2</SelectItem>
                <SelectItem value="Q3">Q3</SelectItem>
                <SelectItem value="Q4">Q4</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.batchNo || 'all'} onValueChange={(v) => setFilter('batchNo', v)}>
              <SelectTrigger><SelectValue placeholder="Batch" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Batches</SelectItem>
                {batchNumbers.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.riskLevel || 'all'} onValueChange={(v) => setFilter('riskLevel', v)}>
              <SelectTrigger><SelectValue placeholder="Risk" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Risk Levels</SelectItem>
                {['Low', 'Medium', 'High', 'Critical'].map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.status || 'all'} onValueChange={(v) => setFilter('status', v)}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Complies">Complies</SelectItem>
                <SelectItem value="OOT">OOT</SelectItem>
                <SelectItem value="OOS">OOS</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <KpiCard label="Products Under CPV" value={kpis.products} tone="blue" />
        <KpiCard label="Batches Reviewed" value={kpis.batchesReviewed} tone="blue" />
        <KpiCard label="CPP Parameters" value={kpis.cppParams} tone="blue" />
        <KpiCard label="CQA Parameters" value={kpis.cqaParams} tone="blue" />
        <KpiCard label="CPP Compliant %" value={`${kpis.cppCompliancePct}%`} tone={kpis.cppCompliancePct >= 95 ? 'green' : 'amber'} />
        <KpiCard label="CQA Compliant %" value={`${kpis.cqaCompliancePct}%`} tone={kpis.cqaCompliancePct >= 95 ? 'green' : 'amber'} />
        <KpiCard label="OOT Count" value={kpis.oot} tone={kpis.oot ? 'amber' : 'green'} />
        <KpiCard label="OOS Count" value={kpis.oos} tone={kpis.oos ? 'red' : 'green'} />
        <KpiCard label="Open Risks" value={kpis.openRisks} tone={kpis.openRisks ? 'amber' : 'green'} />
        <KpiCard label="High Risk Count" value={kpis.highRisks} tone={kpis.highRisks ? 'red' : 'green'} />
        <KpiCard label="Average Cp" value={kpis.avgCp.toFixed(2)} tone={cpkTone} />
        <KpiCard label="Average Cpk" value={kpis.avgCpk.toFixed(2)} tone={cpkTone} />
        <KpiCard label="Average Ppk" value={kpis.avgPpk.toFixed(2)} tone={cpkTone} />
        <KpiCard label="Approx Sigma" value={kpis.sigma.toFixed(2)} tone={cpkTone} />
        <KpiCard label="Avg Yield %" value={kpis.avgYield ? `${kpis.avgYield}%` : '—'} tone={kpis.avgYield >= 95 ? 'green' : kpis.avgYield ? 'amber' : 'blue'} />
        <Link href="/qms/capa" className="block">
          <KpiCard label="Open CAPA" value={kpis.openCapa} tone={kpis.openCapa ? 'amber' : 'green'} />
        </Link>
        <Link href="/qms/deviation" className="block">
          <KpiCard label="Open Deviations" value={kpis.openDeviations} tone={kpis.openDeviations ? 'amber' : 'green'} />
        </Link>
        <Link href="/qms/change-control" className="block">
          <KpiCard label="Open Change Controls" value={kpis.openChangeControls} tone={kpis.openChangeControls ? 'amber' : 'green'} />
        </Link>
        <KpiCard label="Annual CPV Reviews" value={kpis.annualReviews} tone="blue" />
        <KpiCard label="Pending Approvals" value={kpis.pendingApprovals} tone={kpis.pendingApprovals ? 'amber' : 'green'} />
        <Link href="/cpv/stability-monitoring" className="block">
          <KpiCard label="Stability Studies" value={kpis.stabilityStudies} tone="blue" />
        </Link>
        <Link href="/cpv/stability-monitoring" className="block">
          <KpiCard label="Stability OOS" value={kpis.stabilityOos} tone={kpis.stabilityOos ? 'red' : 'green'} />
        </Link>
        <Link href="/cpv/hold-time-monitoring" className="block">
          <KpiCard label="Hold Time Records" value={kpis.holdTimeRecords} tone="blue" />
        </Link>
        <Link href="/cpv/hold-time-monitoring" className="block">
          <KpiCard label="Hold Time Exceeded" value={kpis.holdTimeExceeded} tone={kpis.holdTimeExceeded ? 'red' : 'green'} />
        </Link>
        <Link href="/cpv/process-capability" className="block">
          <KpiCard label="Capability Reviews" value={kpis.capabilityReviews} tone="blue" />
        </Link>
        <Link href="/cpv/process-capability" className="block">
          <KpiCard label="Not Capable" value={kpis.capabilityNotCapable} tone={kpis.capabilityNotCapable ? 'red' : 'green'} />
        </Link>
        <Link href="/cpv/trend-analysis" className="block">
          <KpiCard label="Trend Analysis" value={kpis.trendAnalysisTotal} tone="blue" />
        </Link>
        <Link href="/cpv/trend-analysis" className="block">
          <KpiCard label="Trend Issues" value={kpis.trendAnalysisIssues} tone={kpis.trendAnalysisIssues ? 'amber' : 'green'} />
        </Link>
        <Link href="/cpv/control-charts" className="block">
          <KpiCard label="SPC Charts" value={kpis.spcTotal} tone="blue" />
        </Link>
        <Link href="/cpv/control-charts" className="block">
          <KpiCard label="SPC Out Of Control" value={kpis.spcOutOfControl} tone={kpis.spcOutOfControl ? 'red' : 'green'} />
        </Link>
        <Link href="/cpv/raw-material-monitoring" className="block">
          <KpiCard label="Raw Material Records" value={kpis.rawTotal} tone="blue" />
        </Link>
        <Link href="/cpv/raw-material-monitoring" className="block">
          <KpiCard label="Raw Material OOS" value={kpis.rawOos} tone={kpis.rawOos ? 'red' : 'green'} />
        </Link>
        <Link href="/cpv/packing-material-monitoring" className="block">
          <KpiCard label="Packing OOS" value={kpis.packingOos} tone={kpis.packingOos ? 'red' : 'green'} />
        </Link>
        <Link href="/cpv/utility-monitoring" className="block">
          <KpiCard label="Utility OOS" value={kpis.utilityOos} tone={kpis.utilityOos ? 'red' : 'green'} />
        </Link>
        <Link href="/cpv/environmental-monitoring" className="block">
          <KpiCard label="Environmental OOS" value={kpis.envOos} tone={kpis.envOos ? 'red' : 'green'} />
        </Link>
        <Link href="/cpv/yield-monitoring" className="block">
          <KpiCard label="Yield Records" value={filteredYield.length} tone="blue" />
        </Link>
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">CPP Compliance Trend</CardTitle></CardHeader>
          <CardContent className="h-[280px]">
            {charts.cppCompliance.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.cppCompliance}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`${v}%`, 'Compliance']} />
                  <Line type="monotone" dataKey="rate" stroke="#059669" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">CQA Compliance Trend</CardTitle></CardHeader>
          <CardContent className="h-[280px]">
            {charts.cqaCompliance.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.cqaCompliance}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`${v}%`, 'Compliance']} />
                  <Line type="monotone" dataKey="rate" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Monthly OOT/OOS Trend</CardTitle></CardHeader>
          <CardContent className="h-[280px]">
            {charts.ootOos.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.ootOos}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip /><Legend />
                  <Bar dataKey="oot" name="OOT" fill="#d97706" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="oos" name="OOS" fill="#dc2626" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Risk Level Distribution</CardTitle></CardHeader>
          <CardContent className="h-[280px]">
            {charts.riskDist.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={charts.riskDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                    {charts.riskDist.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip /><Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </CardContent>
        </Card>

        <Card className="shadow-sm lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Product-wise CPV Compliance</CardTitle></CardHeader>
          <CardContent className="h-[300px]">
            {charts.product.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.product} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => [`${v}%`, 'Compliance']} />
                  <Bar dataKey="rate" name="Compliance %" radius={[0, 4, 4, 0]}>
                    {charts.product.map((entry) => (
                      <Cell key={entry.name} fill={entry.rate >= 95 ? '#059669' : entry.rate >= 80 ? '#d97706' : '#dc2626'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Average Cpk Trend</CardTitle></CardHeader>
          <CardContent className="h-[280px]">
            {charts.cpkTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.cpkTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="cpk" name="Cpk" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Batch Review Trend</CardTitle></CardHeader>
          <CardContent className="h-[280px]">
            {charts.batchTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.batchTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="batches" name="Batches" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </CardContent>
        </Card>
      </div>

      {/* Tables */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Recent CPP Alerts</CardTitle>
            <CardDescription>OOT/OOS critical process parameters</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>Alert Date</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Parameter</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Limit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Risk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cppAlerts.length ? cppAlerts.map((a) => (
                  <TableRow key={a.id || `${a.batchNo}-${a.parameter}`}>
                    <TableCell className="text-xs whitespace-nowrap">{a.alertDate ? new Date(a.alertDate).toLocaleDateString() : '—'}</TableCell>
                    <TableCell className="text-sm">
                      <Link href="/cpv/cpp" className="text-blue-600 hover:underline">{a.productName}</Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{a.batchNo}</TableCell>
                    <TableCell className="text-sm">{a.parameter}</TableCell>
                    <TableCell className="font-mono text-sm">{a.observedValue}</TableCell>
                    <TableCell className="text-xs">{a.limit}</TableCell>
                    <TableCell><StatusBadge status={a.status} /></TableCell>
                    <TableCell><StatusBadge status={a.riskLevel} /></TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No CPP alerts</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Recent CQA Alerts</CardTitle>
            <CardDescription>Out-of-trend / out-of-specification quality attributes</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>Alert Date</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Parameter</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Specification</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Risk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cqaAlerts.length ? cqaAlerts.map((a) => (
                  <TableRow key={a.id || `${a.batchNo}-${a.parameter}`}>
                    <TableCell className="text-xs whitespace-nowrap">{a.alertDate ? new Date(a.alertDate).toLocaleDateString() : '—'}</TableCell>
                    <TableCell className="text-sm">
                      <Link href="/cpv/cqa" className="text-blue-600 hover:underline">{a.productName}</Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{a.batchNo}</TableCell>
                    <TableCell className="text-sm">{a.parameter}</TableCell>
                    <TableCell className="font-mono text-sm">{a.observedValue}</TableCell>
                    <TableCell className="text-xs">{a.limit}</TableCell>
                    <TableCell><StatusBadge status={a.status} /></TableCell>
                    <TableCell><StatusBadge status={a.riskLevel} /></TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No CQA alerts</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Pending CPV Reviews
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>Review No</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Review Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pending With</TableHead>
                <TableHead>Due Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingReviews.length ? pendingReviews.map((r) => (
                <TableRow key={r.id || r.reviewNo}>
                  <TableCell className="font-mono text-xs">
                    <Link href={r.id ? `/cpv/annual-review/${r.id}` : '/cpv/annual-review'} className="text-blue-600 hover:underline">
                      {r.reviewNo}
                    </Link>
                  </TableCell>
                  <TableCell>{r.productName}</TableCell>
                  <TableCell>{r.reviewPeriod}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell>{r.pendingWith || '—'}</TableCell>
                  <TableCell>{r.dueDate ? new Date(r.dueDate).toLocaleDateString() : '—'}</TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No pending CPV reviews</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {activities.length > 0 && (
        <Card className="no-print shadow-sm">
          <CardHeader><CardTitle className="text-sm">Recent Audit Activity</CardTitle></CardHeader>
          <CardContent className="max-h-48 overflow-y-auto text-xs text-muted-foreground space-y-1">
            {activities.slice(0, 8).map((a) => (
              <p key={a.id || a.timestamp}>{new Date(a.timestamp).toLocaleString()} — {a.action} ({a.module})</p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
