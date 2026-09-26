'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Brain, Download, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuth } from '@/contexts/auth-context';
import { uniqueProducts } from '@/lib/cpv-dashboard';
import { listCpvRecords } from '@/lib/cpv-service';
import { CPV_COLLECTIONS, CppRecord, CqaRecord } from '@/lib/cpv';
import {
  MIN_HISTORICAL_RECORDS, summarizeDashboard,
  canExportAiAnalytics, canManageAiRecommendations, isAiAnalyticsViewOnly,
  type AiAnalyticsDashboard, type AiRecommendationRecord,
} from '@/lib/cpv-ai-analytics-records';
import {
  fetchAiRecommendations, generateAndPersistAiAnalytics, logAiAnalyticsExport,
  updateRecommendationStatus,
} from '@/lib/cpv-ai-analytics-service';
import { downloadCsv } from '@/lib/export-utils';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { AiAnalyticsAccessGuard } from './ai-analytics-access-guard';
import { PriorityBadge, StatusBadge } from './ai-analytics-badges';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ColumnDef } from '@/components/admin/admin-data-table';

function ScoreRing({ score, label }: { score: number; label: string }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 90 ? '#059669' : pct >= 75 ? '#2563eb' : pct >= 60 ? '#d97706' : '#dc2626';
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-28 w-28">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle cx="60" cy="60" r="52" fill="none" stroke="#e2e8f0" strokeWidth="10" />
          <circle cx="60" cy="60" r="52" fill="none" stroke={color} strokeWidth="10"
            strokeDasharray={`${(pct / 100) * 327} 327`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold">{Math.round(score)}</span>
          <span className="text-[10px] uppercase text-muted-foreground">{label}</span>
        </div>
      </div>
    </div>
  );
}

function ChartCard({ title, data, dataKey = 'value', xKey = 'month' }: {
  title: string;
  data: Array<Record<string, string | number>>;
  dataKey?: string;
  xKey?: string;
}) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="h-52">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey={dataKey} stroke="#2563eb" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState title="No trend data" message="Run analysis with sufficient historical records." />
        )}
      </CardContent>
    </Card>
  );
}

export function AiAnalyticsPage() {
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canExport = canExportAiAnalytics(role);
  const canManage = canManageAiRecommendations(role);
  const readOnly = isAiAnalyticsViewOnly(role);

  const [productFilter, setProductFilter] = useState('all');
  const [products, setProducts] = useState<string[]>([]);
  const [dashboard, setDashboard] = useState<AiAnalyticsDashboard | null>(null);
  const [recommendations, setRecommendations] = useState<AiRecommendationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'System',
    role,
  }), [user?.uid, profile?.full_name, profile?.email, role]);

  const summary = useMemo(() => summarizeDashboard(dashboard), [dashboard]);

  const loadProducts = useCallback(async () => {
    const [cpp, cqa] = await Promise.all([
      listCpvRecords<CppRecord>(CPV_COLLECTIONS.cpp),
      listCpvRecords<CqaRecord>(CPV_COLLECTIONS.cqa),
    ]);
    setProducts(uniqueProducts(cpp, cqa));
  }, []);

  const loadRecommendations = useCallback(async () => {
    setRecommendations(await fetchAiRecommendations());
  }, []);

  const runAnalysis = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const { dashboard: result, error: err } = await generateAndPersistAiAnalytics(actor, productFilter);
      setDashboard(result);
      await loadRecommendations();
      if (err) toast.error(err);
      else if (result.insufficientData) {
        toast.warning(`Insufficient historical data for prediction (minimum ${MIN_HISTORICAL_RECORDS} records).`);
      } else toast.success('AI analytics generated');
    } catch {
      setError('Failed to run AI analytics.');
    } finally {
      setRunning(false);
      setLoading(false);
    }
  }, [actor, productFilter, loadRecommendations]);

  useEffect(() => { void loadProducts(); }, [loadProducts]);
  useEffect(() => { void runAnalysis(); }, [runAnalysis]);

  const exportReport = () => {
    if (!dashboard) return;
    downloadCsv('cpv-ai-analytics.csv',
      ['Metric', 'Value'],
      [
        ['Health Score', dashboard.summary.healthScore],
        ['Health Category', dashboard.summary.healthCategory],
        ['Predicted Risks', dashboard.summary.predictedRisks],
        ['Predicted OOS', dashboard.summary.predictedOos],
        ['Critical Alerts', dashboard.summary.criticalAlerts],
        ['Top Risk Product', dashboard.summary.topRiskProduct],
      ],
    );
    void logAiAnalyticsExport(actor, 'analytics-report');
    toast.success('Analytics report exported');
  };

  const exportRecommendations = () => {
    downloadCsv('cpv-ai-recommendations.csv',
      ['ID', 'Product', 'Finding', 'Recommendation', 'Priority', 'Status'],
      recommendations.map((r) => [r.recommendationId, r.product, r.finding, r.recommendation, r.priority, r.status]),
    );
    void logAiAnalyticsExport(actor, 'recommendations');
    toast.success('Recommendations exported');
  };

  const recColumns: ColumnDef<AiRecommendationRecord>[] = [
    { key: 'recommendationId', header: 'ID' },
    { key: 'product', header: 'Product' },
    { key: 'finding', header: 'Finding', render: (r) => <span className="line-clamp-2 max-w-[200px]">{r.finding}</span> },
    { key: 'priority', header: 'Priority', render: (r) => <PriorityBadge priority={String(r.priority)} /> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> },
    ...(canManage ? [{
      key: 'actions', header: '',
      render: (r: AiRecommendationRecord) => (
        <Select value={String(r.status)} onValueChange={async (status) => {
          const { error: err } = await updateRecommendationStatus(r.id, status as AiRecommendationRecord['status'], actor);
          if (err) return toast.error(err);
          toast.success('Recommendation updated');
          await loadRecommendations();
        }}>
          <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['Open', 'Reviewed', 'Implemented', 'Closed'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      ),
    }] : []),
  ];

  if (loading && !dashboard) {
    return <div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>;
  }
  if (error) {
    return <div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={() => void runAnalysis()} /></div>;
  }

  return (
    <div className="space-y-6">
      <CpvPageHeader
        title="AI Analytics"
        description="Predictive Intelligence and Advanced CPV Insights"
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'AI Analytics' },
        ]}
        actions={(
          <>
            <Select value={productFilter} onValueChange={setProductFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Product" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Products</SelectItem>
                {products.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            {!readOnly && (
              <Button variant="outline" size="sm" onClick={() => void runAnalysis()} disabled={running}>
                <RefreshCw className={`h-4 w-4 mr-1 ${running ? 'animate-spin' : ''}`} />Run Analysis
              </Button>
            )}
            {canExport && (
              <>
                <Button variant="outline" size="sm" onClick={exportReport} disabled={!dashboard || dashboard.insufficientData}>
                  <Download className="h-4 w-4 mr-1" />Export Report
                </Button>
                <Button variant="outline" size="sm" onClick={exportRecommendations} disabled={!recommendations.length}>
                  <Download className="h-4 w-4 mr-1" />Export Recommendations
                </Button>
              </>
            )}
          </>
        )}
      />

      {readOnly && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-3 text-sm text-amber-900">Read-only access — AI insights cannot be modified.</CardContent>
        </Card>
      )}

      {dashboard?.insufficientData ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-center gap-3 py-6 text-sm text-amber-900">
            <Sparkles className="h-5 w-5 shrink-0" />
            Insufficient historical data for prediction ({dashboard.dataPointCount}/{MIN_HISTORICAL_RECORDS} records). Add more CPV monitoring data and run analysis again.
          </CardContent>
        </Card>
      ) : dashboard ? (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            <KpiCard label="Health Score" value={summary.healthScore} tone={summary.healthScore >= 75 ? 'green' : 'amber'} />
            <KpiCard label="Predicted Risks" value={summary.predictedRisks} tone={summary.predictedRisks ? 'red' : 'green'} />
            <KpiCard label="Predicted OOS" value={summary.predictedOos} tone="red" />
            <KpiCard label="Yield Loss Alerts" value={summary.predictedYieldLoss} tone="amber" />
            <KpiCard label="Cpk Failures" value={summary.predictedCpkFailure} tone="amber" />
            <KpiCard label="Open Recommendations" value={recommendations.filter((r) => r.status === 'Open').length || summary.openRecommendations} tone="blue" />
            <KpiCard label="Critical Alerts" value={summary.criticalAlerts} tone="red" />
            <KpiCard label="Top Risk Product" value={summary.topRiskProduct} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Brain className="h-4 w-4 text-violet-600" />Process Health Score</CardTitle></CardHeader>
              <CardContent className="flex flex-col items-center gap-3 pb-6">
                <ScoreRing score={dashboard.processHealth?.score || 0} label="Health" />
                <p className="text-sm font-medium">{dashboard.processHealth?.category}</p>
                <div className="grid w-full gap-1 text-xs text-muted-foreground">
                  <p>CPP Compliance: {dashboard.processHealth?.cppCompliance}%</p>
                  <p>CQA Compliance: {dashboard.processHealth?.cqaCompliance}%</p>
                  <p>Cpk Performance: {dashboard.processHealth?.cpkPerformance}%</p>
                </div>
              </CardContent>
            </Card>
            <ChartCard title="Health Score Trend" data={dashboard.healthScoreTrend} dataKey="score" />
            <Card>
              <CardHeader><CardTitle className="text-sm">Product Ranking</CardTitle></CardHeader>
              <CardContent className="h-52 overflow-y-auto">
                {(dashboard.processHealth?.productRanking || []).slice(0, 8).map((p) => (
                  <div key={p.product} className="mb-2 flex items-center justify-between text-sm">
                    <span>{p.product}</span>
                    <span className="font-medium">{p.score}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="predictions">
            <TabsList className="flex h-auto flex-wrap">
              <TabsTrigger value="predictions">Predictions</TabsTrigger>
              <TabsTrigger value="forecasts">Forecasts</TabsTrigger>
              <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
              <TabsTrigger value="management">Management Insights</TabsTrigger>
              <TabsTrigger value="charts">Analytics Charts</TabsTrigger>
            </TabsList>

            <TabsContent value="predictions" className="space-y-4 mt-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle className="text-sm">Risk Predictions</CardTitle></CardHeader>
                  <CardContent>
                    {dashboard.riskPredictions.length ? dashboard.riskPredictions.map((r) => (
                      <div key={`${r.product}-${r.module}`} className="mb-3 rounded-md border p-3 text-sm">
                        <div className="flex justify-between"><span className="font-medium">{r.product}</span><PriorityBadge priority={r.riskLevel} /></div>
                        <p className="text-violet-700 font-semibold">{r.predictedRiskPct}% predicted risk</p>
                        <p className="text-muted-foreground">{r.reason}</p>
                      </div>
                    )) : <EmptyState title="No risk predictions" message="Process appears stable." />}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-sm">OOS Predictions</CardTitle></CardHeader>
                  <CardContent>
                    {dashboard.oosPredictions.length ? dashboard.oosPredictions.map((o) => (
                      <div key={`${o.product}-${o.parameter}`} className="mb-3 rounded-md border p-3 text-sm">
                        <p className="font-medium">{o.product} — {o.parameter}</p>
                        <p className="text-red-700 font-semibold">{o.predictedOosPct}% OOS probability</p>
                        <p className="text-muted-foreground">{o.recommendedAction}</p>
                      </div>
                    )) : <EmptyState title="No OOS predictions" message="No OOS trajectory detected." />}
                  </CardContent>
                </Card>
                <Card className="lg:col-span-2">
                  <CardHeader><CardTitle className="text-sm">Batch Failure Predictions</CardTitle></CardHeader>
                  <CardContent>
                    {dashboard.batchFailurePredictions.length ? (
                      <ResponsiveDataTable
                        columns={[
                          { key: 'batchNumber', header: 'Batch' },
                          { key: 'product', header: 'Product' },
                          { key: 'failureProbability', header: 'Failure %' },
                          { key: 'category', header: 'Category', render: (r) => <PriorityBadge priority={String(r.category)} /> },
                          { key: 'reason', header: 'Reason' },
                        ]}
                        data={dashboard.batchFailurePredictions.map((b) => ({ ...b, id: b.batchNumber }))}
                        searchKeys={['batchNumber', 'product']}
                      />
                    ) : <EmptyState title="No batch failure predictions" message="Batches within acceptable risk." />}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="forecasts" className="space-y-4 mt-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle className="text-sm">Yield Predictions</CardTitle></CardHeader>
                  <CardContent>
                    {dashboard.yieldPredictions.map((y) => (
                      <div key={y.product} className="mb-3 rounded-md border p-3 text-sm">
                        <p className="font-medium">{y.product}</p>
                        <p>Expected Yield: {y.expectedYieldPct}% (confidence {y.confidencePct}%)</p>
                        <p className={y.alert ? 'text-red-600' : 'text-muted-foreground'}>Expected Loss: {y.expectedLossPct}%</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-sm">Cpk Forecast</CardTitle></CardHeader>
                  <CardContent>
                    {dashboard.cpkForecasts.map((c) => (
                      <div key={`${c.product}-${c.parameter}`} className="mb-3 rounded-md border p-3 text-sm">
                        <p className="font-medium">{c.product} — {c.parameter}</p>
                        <p>Current: {c.currentCpk} → Predicted: {c.predictedCpk}</p>
                        {c.alert && <p className="text-amber-700">Alert: predicted Cpk below 1.33</p>}
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card className="lg:col-span-2">
                  <CardHeader><CardTitle className="text-sm">Stability Forecast</CardTitle></CardHeader>
                  <CardContent>
                    {dashboard.stabilityForecasts.length ? dashboard.stabilityForecasts.map((s) => (
                      <div key={`${s.product}-${s.parameter}`} className="mb-3 rounded-md border p-3 text-sm">
                        <p className="font-medium">{s.product} — {s.parameter}</p>
                        <p>3M: {s.forecast3M} · 6M: {s.forecast6M} · 12M: {s.forecast12M}</p>
                        {s.alert && <p className="text-red-600">Potential OOT/OOS trajectory</p>}
                      </div>
                    )) : <EmptyState title="No stability forecasts" message="Add stability monitoring data." />}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="recommendations" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">AI Recommendations</CardTitle>
                  <CardDescription>CAPA and corrective action suggestions from CPV intelligence engines</CardDescription>
                </CardHeader>
                <CardContent>
                  {recommendations.length ? (
                    <ResponsiveDataTable columns={recColumns} data={recommendations} searchKeys={['product', 'finding', 'recommendationId']} />
                  ) : (
                    <EmptyState title="No recommendations" message="Run analysis to generate AI recommendations." />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="management" className="mt-4">
              <div className="grid gap-4 lg:grid-cols-2">
                {[
                  ['Top Risks', dashboard.managementInsights?.topRisks],
                  ['Top OOS Causes', dashboard.managementInsights?.topOosCauses],
                  ['Top Deviations', dashboard.managementInsights?.topDeviations],
                  ['Worst Performing Products', dashboard.managementInsights?.worstProducts],
                  ['Best Performing Products', dashboard.managementInsights?.bestProducts],
                  ['Trending Risks', dashboard.managementInsights?.trendingRisks],
                ].map(([title, items]) => (
                  <Card key={String(title)}>
                    <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
                    <CardContent>
                      <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                        {(items as string[] | undefined)?.length
                          ? (items as string[]).map((item) => <li key={item}>{item}</li>)
                          : <li>No data</li>}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
                <Card>
                  <CardHeader><CardTitle className="text-sm">Overall Plant Health</CardTitle></CardHeader>
                  <CardContent className="flex items-center gap-6">
                    <ScoreRing score={dashboard.managementInsights?.overallPlantHealth || 0} label="Plant" />
                    <div className="text-sm">
                      <p>CAPA Effectiveness: {dashboard.managementInsights?.capaEffectivenessPct}%</p>
                      <p className="text-muted-foreground mt-2">Generated {new Date(dashboard.generatedAt).toLocaleString()}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="charts" className="mt-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Risk Prediction Trend" data={dashboard.riskTrend} />
                <ChartCard title="Yield Prediction Trend" data={dashboard.yieldTrend} />
                <ChartCard title="Cpk Forecast Trend" data={dashboard.cpkTrend} />
                <ChartCard title="OOS Forecast Trend" data={dashboard.oosTrend} />
                <ChartCard title="Stability Forecast Trend" data={dashboard.stabilityTrend} />
                <Card>
                  <CardHeader><CardTitle className="text-sm">Deviation Pattern</CardTitle></CardHeader>
                  <CardContent className="h-52">
                    {dashboard.deviationTrend.length ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dashboard.deviationTrend}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                          <YAxis />
                          <Tooltip />
                          <Bar dataKey="value" fill="#7c3aed" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : <EmptyState title="No deviation patterns" message="No recurring deviation data." />}
                  </CardContent>
                </Card>
                <ChartCard title="CAPA Effectiveness" data={dashboard.capaEffectivenessTrend} />
              </div>
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}

export function AiAnalyticsPageWithGuard() {
  return (
    <AiAnalyticsAccessGuard>
      <AiAnalyticsPage />
    </AiAnalyticsAccessGuard>
  );
}
