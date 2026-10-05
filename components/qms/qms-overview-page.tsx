'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, BookOpen, CheckSquare, ClipboardList, Factory, FileCheck,
  LineChart, MessageSquare, Monitor, PackageSearch, RefreshCw, RotateCcw,
  ShieldAlert, ShieldCheck, TestTube, Thermometer, TruckIcon, Wrench,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { canAccessModule, type AppModule } from '@/lib/permissions';
import { loadQmsOverviewCounts, type QmsOverviewCounts } from '@/lib/qms-overview-metrics';

const QMS_MODULES: Array<{
  label: string;
  href: string;
  icon: typeof AlertTriangle;
  description: string;
  module: AppModule;
}> = [
  { label: 'Deviation Management', href: '/qms/deviation', icon: AlertTriangle, description: 'Track and investigate process deviations', module: 'deviation' },
  { label: 'OOS Management', href: '/qms/oos', icon: TestTube, description: 'Out-of-specification investigation workflow', module: 'oos' },
  { label: 'CAPA Management', href: '/qms/capa', icon: CheckSquare, description: 'Corrective and preventive action tracking', module: 'capa' },
  { label: 'Change Control', href: '/qms/change-control', icon: RefreshCw, description: 'Controlled change request and approval', module: 'change_control' },
  { label: 'Risk Management', href: '/qms/risk-management', icon: ShieldAlert, description: 'Risk assessment, FMEA, and mitigation', module: 'risk' },
  { label: 'Stability Management', href: '/qms/stability', icon: LineChart, description: 'Stability study planning and monitoring', module: 'stability' },
  { label: 'Complaint Management', href: '/qms/complaints', icon: MessageSquare, description: 'Customer complaint intake and resolution', module: 'complaints' },
  { label: 'Product Recall', href: '/qms/recall', icon: RotateCcw, description: 'Recall initiation and distribution tracking', module: 'recall' },
  { label: 'Document Management', href: '/qms/documents/master', icon: BookOpen, description: 'Controlled documents, SOPs, and forms', module: 'dms' },
  { label: 'Audit Management', href: '/qms/audit', icon: ClipboardList, description: 'Internal and external audit programs', module: 'audit' },
  { label: 'Vendor Management', href: '/qms/vendors', icon: TruckIcon, description: 'Approved vendor list and qualification', module: 'vendors' },
  { label: 'Validation Management', href: '/qms/validation', icon: FileCheck, description: 'Equipment and process validation', module: 'validation' },
  { label: 'CSV Management', href: '/qms/csv', icon: Monitor, description: 'Computer system validation lifecycle', module: 'csv' },
  { label: 'Equipment Management', href: '/qms/equipment', icon: Wrench, description: 'Equipment qualification and maintenance', module: 'equipment' },
  { label: 'Environmental & Utility Monitoring', href: '/qms/monitoring', icon: Thermometer, description: 'Cleanroom and utility monitoring', module: 'monitoring' },
  { label: 'Warehouse Management', href: '/qms/warehouse', icon: PackageSearch, description: 'Material receipt and traceability', module: 'warehouse' },
  { label: 'eBMR', href: '/qms/ebmr', icon: Factory, description: 'Electronic batch manufacturing records', module: 'ebmr' },
];

const KPI_ITEMS: Array<{ key: keyof QmsOverviewCounts; label: string; href: string; module: AppModule }> = [
  { key: 'openDeviations', label: 'Open deviations', href: '/qms/deviation', module: 'deviation' },
  { key: 'openOos', label: 'Open OOS', href: '/qms/oos', module: 'oos' },
  { key: 'openCapas', label: 'Open CAPAs', href: '/qms/capa', module: 'capa' },
  { key: 'openChangeControls', label: 'Open change controls', href: '/qms/change-control', module: 'change_control' },
  { key: 'openComplaints', label: 'Open complaints', href: '/qms/complaints', module: 'complaints' },
];

function formatCount(value: number | null, loading: boolean): string {
  if (loading) return '…';
  if (value === null) return '—';
  return value.toLocaleString();
}

export function QmsOverviewPage() {
  const { profile } = useAuth();
  const [counts, setCounts] = useState<QmsOverviewCounts | null>(null);
  const [loading, setLoading] = useState(true);

  const allowed = (module: AppModule) => canAccessModule(profile?.role, module);
  const modules = QMS_MODULES.filter((item) => allowed(item.module));
  const kpis = KPI_ITEMS.filter((item) => allowed(item.module));

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadQmsOverviewCounts()
      .then((next) => { if (active) setCounts(next); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          <span>Quality Management System</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">QMS Dashboard</h1>
        <p className="mt-1 text-muted-foreground">
          Open quality work from live records, then open the module that owns it.
        </p>
      </div>

      {kpis.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {kpis.map((kpi) => (
            <Link key={kpi.key} href={kpi.href} className="min-w-0">
              <Card className="h-full transition-colors hover:border-blue-500/50 hover:bg-muted/30">
                <CardHeader className="space-y-1 p-4 pb-2">
                  <CardDescription>{kpi.label}</CardDescription>
                  <CardTitle className="text-2xl tabular-nums" aria-live="polite">
                    {formatCount(counts?.[kpi.key] ?? null, loading)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 pt-0 text-xs text-muted-foreground">
                  {counts?.[kpi.key] === null && !loading ? 'Count unavailable' : 'Excludes closed and rejected'}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {modules.map((mod) => (
          <Link key={mod.href} href={mod.href} className="group min-w-0">
            <Card className="h-full transition-colors hover:border-blue-500/50 hover:bg-muted/30">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600/10 text-blue-600 group-hover:bg-blue-600/20">
                    <mod.icon className="h-4 w-4" aria-hidden />
                  </div>
                  <CardTitle className="text-base leading-snug">{mod.label}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>{mod.description}</CardDescription>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
