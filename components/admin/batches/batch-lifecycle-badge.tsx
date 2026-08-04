'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { BATCH_STATUSES } from '@/lib/admin/constants';

const COLORS: Record<string, string> = {
  Planned: 'border-slate-300 bg-slate-50',
  Scheduled: 'border-violet-300 bg-violet-50',
  Manufacturing: 'border-blue-300 bg-blue-50',
  Sampling: 'border-sky-300 bg-sky-50',
  Testing: 'border-cyan-300 bg-cyan-50',
  'Under Review': 'border-indigo-300 bg-indigo-50',
  Released: 'border-green-300 bg-green-50',
  Rejected: 'border-red-300 bg-red-50',
  Hold: 'border-amber-300 bg-amber-50',
  Reprocessed: 'border-orange-300 bg-orange-50',
  Closed: 'border-gray-300 bg-gray-50',
  Archived: 'border-zinc-300 bg-zinc-50',
};

export function BatchLifecycleBadge({ status }: { status?: string }) {
  const label = status || 'Planned';
  return (
    <Badge variant="outline" className={cn('text-xs', COLORS[label] || COLORS.Planned)}>
      {label}
    </Badge>
  );
}

export function BatchLifecycleTimeline({ currentStatus, auditTrail }: {
  currentStatus?: string;
  auditTrail: Record<string, unknown>[];
}) {
  const current = currentStatus || 'Planned';
  const currentIndex = BATCH_STATUSES.indexOf(current as typeof BATCH_STATUSES[number]);
  const eventDates = new Map<string, string>();
  auditTrail.forEach((entry) => {
    if (!['STATUS_CHANGE', 'CREATE_BATCH', 'RELEASE_BATCH', 'ARCHIVE_BATCH', 'CLOSE_BATCH'].includes(String(entry.action))) return;
    const newValue = entry.newValue;
    let stage = '';
    if (typeof newValue === 'string') stage = newValue;
    else if (newValue && typeof newValue === 'object' && 'batchStatus' in (newValue as object)) {
      stage = String((newValue as { batchStatus?: string }).batchStatus || '');
    }
    if (stage) eventDates.set(stage, String(entry.timestamp || entry.dateTime || ''));
  });

  return (
    <div className="space-y-2">
      {BATCH_STATUSES.map((stage, index) => {
        const completed = index <= currentIndex || eventDates.has(stage);
        const isCurrent = stage === current;
        return (
          <div key={stage} className={cn(
            'flex items-center gap-3 p-2 rounded border text-sm',
            completed ? 'border-blue-200 bg-blue-50/50 dark:bg-blue-950/20' : 'border-muted opacity-60',
            isCurrent && 'ring-1 ring-blue-400',
          )}>
            <div className={cn(
              'h-2.5 w-2.5 rounded-full shrink-0',
              completed ? 'bg-blue-600' : 'bg-muted-foreground/30',
            )} />
            <div className="flex-1">
              <p className="font-medium">{stage}</p>
              {eventDates.get(stage) && (
                <p className="text-xs text-muted-foreground">{eventDates.get(stage)}</p>
              )}
            </div>
            {isCurrent && <Badge variant="secondary" className="text-xs">Current</Badge>}
          </div>
        );
      })}
    </div>
  );
}
