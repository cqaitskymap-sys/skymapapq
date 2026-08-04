'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const COLORS: Record<string, string> = {
  Planned: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200',
  Scheduled: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-200',
  Manufacturing: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-200',
  Sampling: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-200',
  Testing: 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-200',
  'Under Review': 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-200',
  Released: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-200',
  Rejected: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-200',
  Hold: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200',
  Reprocessed: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-200',
  Closed: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-200',
  Archived: 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-300',
  'Under QC Testing': 'bg-cyan-100 text-cyan-800 border-cyan-200',
  'Under QA Review': 'bg-indigo-100 text-indigo-800 border-indigo-200',
};

export function BatchStatusBadge({ status }: { status?: string }) {
  const label = status || 'Planned';
  return (
    <Badge variant="outline" className={cn('text-xs font-medium', COLORS[label] || COLORS.Planned)}>
      {label}
    </Badge>
  );
}
