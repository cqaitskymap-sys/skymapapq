'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Zap,
  Activity,
  Target,
  Package,
  TestTube,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { fetchExecutiveDashboardData, type ExecutiveDashboardData } from '@/lib/executive-dashboard-service';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';

const KPICard = ({
  icon: Icon,
  label,
  value,
  unit = '',
  trend,
  trendColor = 'text-emerald-700',
  trendBg = 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800',
  subtext,
  accent = 'from-[#2563EB] to-sky-400',
  iconBg = 'bg-blue-50 text-[#2563EB] dark:bg-blue-950/40 dark:text-blue-400',
  index = 0,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  unit?: string;
  trend?: string;
  trendColor?: string;
  trendBg?: string;
  subtext?: string;
  accent?: string;
  iconBg?: string;
  index?: number;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 14 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: index * 0.05, duration: 0.35 }}
    whileHover={{ y: -3 }}
    className="h-full"
  >
    <Card
      className={cn(
        'group relative h-full overflow-hidden border-border/40 bg-white/90 shadow-[0_4px_24px_-8px_rgba(15,23,42,0.08)]',
        'backdrop-blur-sm transition-all duration-300',
        'hover:border-[#2563EB]/25 hover:shadow-[0_16px_36px_-14px_rgba(37,99,235,0.22)]',
        'dark:bg-card/90',
      )}
    >
      <div
        aria-hidden
        className={cn('absolute inset-y-0 left-0 w-1 bg-gradient-to-b', accent)}
      />
      <CardContent className="p-5 pl-6">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div
            className={cn(
              'flex h-11 w-11 items-center justify-center rounded-xl shadow-sm ring-1 ring-black/[0.04] transition-transform duration-300 group-hover:scale-105 dark:ring-white/10',
              iconBg,
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
          {trend && (
            <Badge
              variant="outline"
              className={cn('rounded-full px-2.5 text-[11px] font-medium', trendColor, trendBg)}
            >
              {trend}
            </Badge>
          )}
        </div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums text-foreground">
          {value}
          {unit}
        </p>
        {subtext && (
          <p className="mt-2 text-xs text-muted-foreground">{subtext}</p>
        )}
      </CardContent>
    </Card>
  </motion.div>
);

function ChartEmpty({ message = 'No data available yet' }: { message?: string }) {
  return (
    <div className="flex h-[250px] items-center justify-center">
      <EmptyState title="No data" message={message} />
    </div>
  );
}

function ChartShell({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        'overflow-hidden border-border/40 bg-white/90 shadow-[0_4px_24px_-8px_rgba(15,23,42,0.08)] backdrop-blur-sm dark:bg-card/90',
        className,
      )}
    >
      <div
        aria-hidden
        className="h-[3px] bg-gradient-to-r from-[#2563EB] via-sky-400 to-indigo-400"
      />
      <CardHeader className="pb-2">
        <CardTitle className="text-lg tracking-tight">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

const tooltipStyle = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '12px',
  boxShadow: '0 8px 24px -8px rgba(15,23,42,0.18)',
};

export default function DashboardPage() {
  const [data, setData] = useState<ExecutiveDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchExecutiveDashboardData();
    setData(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="relative space-y-6">
        <div className="overflow-hidden rounded-3xl border border-border/40 bg-white/80 p-6 shadow-sm backdrop-blur-sm dark:bg-card/80">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Skymap QMS Dashboard</h1>
          <p className="mt-1 text-muted-foreground">Loading live metrics from your QMS data...</p>
        </div>
        <LoadingSkeleton rows={2} />
      </div>
    );
  }

  if (!data) return null;

  const { kpis } = data;

  return (
    <div className="relative space-y-6">
      {/* Atmospheric accents within AppShell content */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-20 -top-10 h-64 w-64 rounded-full bg-[#2563EB]/[0.06] blur-3xl" />
        <div className="absolute right-0 top-40 h-56 w-56 rounded-full bg-sky-400/10 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative overflow-hidden rounded-3xl border border-white/70 bg-white/75 p-5 shadow-[0_8px_40px_-12px_rgba(37,99,235,0.12)] backdrop-blur-xl dark:border-border/50 dark:bg-card/70 sm:p-6"
      >
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#2563EB] via-sky-400 to-indigo-400"
        />
        <h1 className="bg-gradient-to-r from-foreground to-[#2563EB] bg-clip-text text-2xl font-bold tracking-tight text-transparent sm:text-3xl">
          Skymap QMS Dashboard
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          Skymap Pharmaceuticals — live GMP compliance, manufacturing metrics &amp; regulatory intelligence
        </p>
      </motion.div>

      {data.error && <ErrorCard message={data.error} onRetry={load} />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard
          icon={Package}
          label="Total Batches (YTD)"
          value={kpis.totalBatches}
          trend={kpis.releaseRateTrend ?? undefined}
          subtext={`${kpis.batchesMTD} this month`}
          accent="from-[#2563EB] to-sky-400"
          iconBg="bg-blue-50 text-[#2563EB] dark:bg-blue-950/40 dark:text-blue-400"
          index={0}
        />
        <KPICard
          icon={TrendingUp}
          label="Release Rate"
          value={kpis.releaseRate}
          unit="%"
          trendColor={kpis.releaseRate >= 95 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}
          trendBg={
            kpis.releaseRate >= 95
              ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800'
              : 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800'
          }
          trend={kpis.releaseRate >= 95 ? 'On target' : 'Below 95% target'}
          subtext="Target: 95%"
          accent="from-emerald-500 to-teal-400"
          iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
          index={1}
        />
        <KPICard
          icon={Target}
          label="Avg Yield"
          value={kpis.avgYield || '—'}
          unit={kpis.avgYield ? '%' : ''}
          subtext={kpis.avgYield ? 'From yield monitoring records' : 'No yield data recorded'}
          accent="from-violet-500 to-purple-400"
          iconBg="bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400"
          index={2}
        />
        <KPICard
          icon={Activity}
          label="Compliance Score"
          value={kpis.complianceScore || '—'}
          unit={kpis.complianceScore ? '%' : ''}
          trendColor="text-[#2563EB] dark:text-blue-400"
          trendBg="bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:border-blue-800"
          trend={kpis.complianceScore >= 90 ? 'Strong' : kpis.complianceScore ? 'Needs attention' : undefined}
          accent="from-sky-500 to-cyan-400"
          iconBg="bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400"
          index={3}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KPICard
          icon={AlertTriangle}
          label="Open Deviations"
          value={kpis.openDeviations}
          trend={kpis.criticalDeviations ? `${kpis.criticalDeviations} critical` : undefined}
          trendColor="text-rose-700 dark:text-rose-400"
          trendBg="bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-800"
          accent="from-rose-500 to-orange-400"
          iconBg="bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400"
          index={4}
        />
        <KPICard
          icon={TestTube}
          label="OOS Records"
          value={kpis.openOos}
          trendColor="text-amber-700 dark:text-amber-400"
          trendBg="bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800"
          trend={kpis.openOos ? 'Under investigation' : 'No open records'}
          accent="from-amber-500 to-orange-400"
          iconBg="bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
          index={5}
        />
        <KPICard
          icon={CheckCircle}
          label="Active CAPAs"
          value={kpis.openCapa}
          subtext={`${kpis.openCapa} open, ${kpis.closedCapaYtd} closed YTD`}
          accent="from-teal-500 to-emerald-400"
          iconBg="bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400"
          index={6}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartShell
          title="Batch Manufacturing Trend"
          description="Released, rejected, and in-process batches"
        >
          {data.batchTrend.some((r) => r.released || r.rejected || r.inProcess) ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={data.batchTrend}>
                <defs>
                  <linearGradient id="releasedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="rejectedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="inProcessGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="month" className="text-xs" tickLine={false} axisLine={false} />
                <YAxis className="text-xs" tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Area type="monotone" dataKey="released" stackId="1" stroke="#10b981" fill="url(#releasedGrad)" name="Released" />
                <Area type="monotone" dataKey="rejected" stackId="1" stroke="#ef4444" fill="url(#rejectedGrad)" name="Rejected" />
                <Area type="monotone" dataKey="inProcess" stackId="1" stroke="#2563EB" fill="url(#inProcessGrad)" name="In Process" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty message="Register batches in CPV Batch Registration to see manufacturing trends." />
          )}
        </ChartShell>

        <ChartShell
          title="Average Yield Trend"
          description="Monthly manufacturing efficiency"
        >
          {data.yieldTrend.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.yieldTrend}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="month" className="text-xs" tickLine={false} axisLine={false} />
                <YAxis className="text-xs" domain={['auto', 'auto']} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="yield"
                  stroke="#2563EB"
                  strokeWidth={2.5}
                  dot={{ fill: '#2563EB', r: 4, strokeWidth: 2, stroke: '#fff' }}
                  activeDot={{ r: 6 }}
                  name="Yield %"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty message="Record yield monitoring data to see efficiency trends." />
          )}
        </ChartShell>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <ChartShell title="Deviations by Type" description="YTD breakdown">
          {data.deviationsByType.length ? (
            <div className="flex justify-center">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={data.deviationsByType}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name} (${value})`}
                    outerRadius={80}
                    innerRadius={48}
                    paddingAngle={2}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {data.deviationsByType.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <ChartEmpty message="No deviation records found." />
          )}
        </ChartShell>

        <ChartShell title="CAPA Status" description="Actions by stage">
          {data.capaStatus.length ? (
            <div className="flex justify-center">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={data.capaStatus}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name} (${value})`}
                    outerRadius={80}
                    innerRadius={48}
                    paddingAngle={2}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {data.capaStatus.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <ChartEmpty message="No CAPA records found." />
          )}
        </ChartShell>

        <ChartShell title="OOS Investigations" description="Monthly trend">
          {data.oosTrend.some((r) => r.count > 0) ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.oosTrend}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="month" className="text-xs" tickLine={false} axisLine={false} />
                <YAxis className="text-xs" tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="#ef4444" radius={[6, 6, 0, 0]} name="OOS Count" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty message="No OOS records found." />
          )}
        </ChartShell>
      </div>

      <ChartShell
        title="Module Compliance Scores"
        description="GMP compliance across active modules"
      >
        {data.complianceScores.length ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.complianceScores} layout="vertical">
              <defs>
                <linearGradient id="complianceGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#2563EB" />
                  <stop offset="100%" stopColor="#38bdf8" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
              <XAxis type="number" className="text-xs" domain={[0, 100]} tickLine={false} axisLine={false} />
              <YAxis dataKey="module" type="category" className="text-xs" width={72} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="score" fill="url(#complianceGrad)" radius={[0, 6, 6, 0]} name="Compliance %" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ChartEmpty message="Compliance scores appear once module data is recorded." />
        )}
      </ChartShell>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartShell title="Recent Batches" description="Latest manufacturing records">
          {data.recentBatches.length ? (
            <div className="space-y-2.5">
              {data.recentBatches.map((batch) => (
                <div
                  key={batch.id}
                  className="flex min-w-0 items-start justify-between gap-2 rounded-xl border border-border/40 bg-muted/20 p-3.5 transition-colors hover:border-[#2563EB]/25 hover:bg-[#2563EB]/[0.04]"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-mono text-sm font-semibold">{batch.batch_number}</p>
                    <p className="text-xs text-muted-foreground">{batch.product_name}</p>
                  </div>
                  <Badge
                    variant={
                      batch.status === 'released'
                        ? 'default'
                        : batch.status === 'in_process'
                          ? 'outline'
                          : 'destructive'
                    }
                    className="shrink-0 rounded-full text-xs capitalize"
                  >
                    {batch.status.replace(/_/g, ' ')}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <ChartEmpty message="No batch records found." />
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-4 w-full rounded-xl border-[#2563EB]/20 text-[#2563EB] hover:bg-[#2563EB]/5 hover:text-[#1d4ed8]"
            asChild
          >
            <Link href="/cpv/batch-registration">View All Batches</Link>
          </Button>
        </ChartShell>

        <ChartShell title="Recent Deviations" description="Latest quality issues">
          {data.recentDeviations.length ? (
            <div className="space-y-2.5">
              {data.recentDeviations.map((dev) => (
                <div
                  key={dev.id}
                  className="flex min-w-0 items-start justify-between gap-2 rounded-xl border border-border/40 bg-muted/20 p-3.5 transition-colors hover:border-rose-200 hover:bg-rose-50/40 dark:hover:bg-rose-950/20"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-mono text-sm font-semibold">{dev.deviation_number}</p>
                    <p className="text-xs text-muted-foreground">{dev.title}</p>
                  </div>
                  <Badge
                    variant={
                      dev.deviation_type === 'critical'
                        ? 'destructive'
                        : dev.deviation_type === 'major'
                          ? 'outline'
                          : 'secondary'
                    }
                    className="shrink-0 rounded-full text-xs capitalize"
                  >
                    {dev.deviation_type}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <ChartEmpty message="No deviation records found." />
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-4 w-full rounded-xl border-[#2563EB]/20 text-[#2563EB] hover:bg-[#2563EB]/5 hover:text-[#1d4ed8]"
            asChild
          >
            <Link href="/qms/deviation">View All Deviations</Link>
          </Button>
        </ChartShell>
      </div>

      <Card className="overflow-hidden border-border/40 bg-white/90 shadow-[0_4px_24px_-8px_rgba(15,23,42,0.08)] backdrop-blur-sm dark:bg-card/90">
        <div
          aria-hidden
          className="h-[3px] bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400"
        />
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg tracking-tight">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/40">
              <Zap className="h-4 w-4 text-amber-500" />
            </div>
            Active Alerts &amp; Insights
          </CardTitle>
          <CardDescription>
            Live alerts from CPV, deviations, OOS, and CAPA modules
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.alerts.length ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {data.alerts.map((insight) => (
                <div
                  key={insight.id}
                  className={cn(
                    'rounded-xl border border-border/40 bg-muted/30 p-4 border-l-4',
                    insight.type === 'warning'
                      ? 'border-l-amber-500'
                      : insight.type === 'error'
                        ? 'border-l-red-500'
                        : insight.type === 'success'
                          ? 'border-l-green-500'
                          : 'border-l-[#2563EB]',
                  )}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <h4 className="text-sm font-semibold">{insight.title}</h4>
                    <Badge variant="outline" className="rounded-full text-xs">
                      {insight.module}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{insight.description}</p>
                </div>
              ))}
            </div>
          ) : (
            <ChartEmpty message="No active alerts. All systems operating within limits." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
