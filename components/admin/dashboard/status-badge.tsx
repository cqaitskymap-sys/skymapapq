'use client';

import { Badge } from '@/components/ui/badge';

const STATUS_STYLES: Record<string, string> = {
  Active: 'bg-green-50 text-green-700 border-green-200',
  Inactive: 'bg-slate-100 text-slate-600 border-slate-200',
  Locked: 'bg-red-50 text-red-700 border-red-200',
  Suspended: 'bg-orange-50 text-orange-700 border-orange-200',
  'Pending Approval': 'bg-amber-50 text-amber-700 border-amber-200',
  Pending: 'bg-amber-50 text-amber-700 border-amber-200',
  Completed: 'bg-green-50 text-green-700 border-green-200',
  Overdue: 'bg-red-50 text-red-700 border-red-200',
  Success: 'bg-green-50 text-green-700 border-green-200',
  'Partial Success': 'bg-amber-50 text-amber-700 border-amber-200',
  Failed: 'bg-red-50 text-red-700 border-red-200',
  Queued: 'bg-slate-100 text-slate-600 border-slate-200',
  'Rolled Back': 'bg-orange-50 text-orange-700 border-orange-200',
  Cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
  'In Progress': 'bg-blue-50 text-blue-700 border-blue-200',
  Healthy: 'bg-green-50 text-green-700 border-green-200',
  Degraded: 'bg-amber-50 text-amber-700 border-amber-200',
  Down: 'bg-red-50 text-red-700 border-red-200',
  Connected: 'bg-green-50 text-green-700 border-green-200',
  'Not Configured': 'bg-slate-100 text-slate-600 border-slate-200',
};

export function StatusBadge({ status }: { status?: string | null }) {
  const label = status?.trim() || 'Unknown';
  return (
    <Badge variant="outline" className={STATUS_STYLES[label] || 'bg-slate-100 text-slate-600 border-slate-200'}>
      {label}
    </Badge>
  );
}
