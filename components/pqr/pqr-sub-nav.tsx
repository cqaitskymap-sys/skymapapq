'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Plus, Package, Beaker, PackageSearch, Cog, LineChart,
  AlertTriangle, TestTube, CheckSquare, RefreshCw, FileText,
  CheckCircle, FileDown, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { PqrDocumentStatus } from '@/lib/pqr-types';

const statusColors: Record<PqrDocumentStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  under_review: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  archived: 'bg-slate-200 text-slate-600',
};

export function PqrStatusBadge({ status }: { status?: PqrDocumentStatus | string }) {
  const s = (status || 'draft') as PqrDocumentStatus;
  return <Badge variant="outline" className={statusColors[s] || statusColors.draft}>{s.replace(/_/g, ' ')}</Badge>;
}

interface PqrNavProps {
  pqrId?: string;
  pqrNumber?: string;
  status?: string;
}

const globalNav = [
  { label: 'PQR Dashboard', href: '/pqr/dashboard', icon: LayoutDashboard },
  { label: 'Create PQR', href: '/pqr/create', icon: Plus },
];

function sectionNav(pqrId: string) {
  const base = `/dashboard/pqr/${pqrId}`;
  return [
    { label: 'PQR Document (Print)', href: `${base}/pdf`, icon: FileDown },
    { label: '1–5.1 Product Information', href: base, icon: LayoutDashboard },
    { label: '5.2 Batch Manufacturing', href: `${base}/batches`, icon: Package },
    { label: '5.4–5.6 Materials', href: `${base}/materials`, icon: Beaker },
    { label: '5.7–5.9 Packing Material', href: `${base}/packaging`, icon: PackageSearch },
    { label: '5.3 Equipment Qualification', href: `${base}/equipment`, icon: Cog },
    { label: '10.0 Stability Review', href: `${base}/stability`, icon: LineChart },
    { label: '9.0 Deviations', href: `${base}/deviations`, icon: AlertTriangle },
    { label: '6.0 OOS', href: `${base}/oos`, icon: TestTube },
    { label: '15.0 CAPA', href: `${base}/capa`, icon: CheckSquare },
    { label: '8.0 Change Control', href: `${base}/change-control`, icon: RefreshCw },
    { label: '24.0 Summary', href: `${base}/summary`, icon: FileText },
    { label: '31.0 PQR Approval', href: `${base}/approval`, icon: CheckCircle },
  ];
}

export function PqrSubNav({ pqrId, pqrNumber, status }: PqrNavProps) {
  const pathname = usePathname();
  const items = pqrId ? sectionNav(pqrId) : globalNav;

  const isActive = (href: string) => {
    if (href === `/dashboard/pqr/${pqrId}`) return pathname === href;
    return pathname === href || pathname.startsWith(href + '/');
  };

  return (
    <nav className="w-full lg:w-64 shrink-0 border rounded-lg bg-white dark:bg-slate-900 p-2 space-y-0.5">
      {pqrId && (
        <div className="px-3 py-2 mb-2 border-b">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Active PQR</p>
          <p className="font-mono text-sm font-semibold truncate">{pqrNumber || pqrId.slice(0, 8)}</p>
          {status && <div className="mt-1"><PqrStatusBadge status={status} /></div>}
        </div>
      )}
      {!pqrId && (
        <p className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase">PQR Management</p>
      )}
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
            isActive(item.href)
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 hover:bg-blue-50 hover:text-blue-700 dark:text-slate-300 dark:hover:bg-slate-800'
          )}
        >
          <item.icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">{item.label}</span>
          {isActive(item.href) && <ChevronRight className="h-3 w-3" />}
        </Link>
      ))}
    </nav>
  );
}

export { globalNav as pqrGlobalNav, sectionNav as pqrSectionNav };
