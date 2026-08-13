'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Wrench, Calendar, FileCheck, Settings, AlertTriangle, Activity, FileDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const STATIC_SEGMENTS = new Set([
  'master', 'calibration-schedule', 'calibration-records', 'preventive-maintenance',
  'breakdown', 'status', 'reports',
]);

const items = [
  { label: 'Equipment Dashboard', href: '/qms/equipment', icon: LayoutDashboard, exact: true },
  { label: 'Equipment Master', href: '/qms/equipment/master', icon: Wrench },
  { label: 'Calibration Schedule', href: '/qms/equipment/calibration-schedule', icon: Calendar },
  { label: 'Calibration Records', href: '/qms/equipment/calibration-records', icon: FileCheck },
  { label: 'Preventive Maintenance', href: '/qms/equipment/preventive-maintenance', icon: Settings },
  { label: 'Breakdown Maintenance', href: '/qms/equipment/breakdown', icon: AlertTriangle },
  { label: 'Equipment Status', href: '/qms/equipment/status', icon: Activity },
  { label: 'Reports', href: '/qms/equipment/reports', icon: FileDown },
];

export function EquipmentSubNav() {
  const pathname = usePathname();
  const segment = pathname.match(/^\/qms\/equipment\/([^/]+)/)?.[1];
  const isDetailRoute = segment && !STATIC_SEGMENTS.has(segment);

  return (
    <nav className="w-full lg:w-56 shrink-0">
      <div className="rounded-lg border bg-card p-2 space-y-0.5">
        <p className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Equipment Management</p>
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href) && !isDetailRoute;
          return (
            <Link key={item.href} href={item.href}
              className={cn('flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                active ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
              <Icon className="h-4 w-4 shrink-0" /><span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function EquipmentStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Active: 'bg-green-100 text-green-800', Inactive: 'bg-gray-100 text-gray-600',
    Blocked: 'bg-red-100 text-red-800', 'Under Maintenance': 'bg-amber-100 text-amber-800', Retired: 'bg-slate-100 text-slate-600',
    Calibrated: 'bg-green-100 text-green-800', Due: 'bg-amber-100 text-amber-800',
    Overdue: 'bg-red-100 text-red-800', Failed: 'bg-red-100 text-red-800', 'Not Required': 'bg-gray-100 text-gray-600',
    Completed: 'bg-green-100 text-green-800', Open: 'bg-red-100 text-red-800', Closed: 'bg-green-100 text-green-800',
    Qualified: 'bg-green-100 text-green-800', 'Not Qualified': 'bg-red-100 text-red-800',
  };
  return <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', colors[status] || colors.Active)}>{status}</span>;
}
