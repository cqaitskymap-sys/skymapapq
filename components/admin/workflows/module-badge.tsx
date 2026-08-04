'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const COLORS: Record<string, string> = {
  PQR: 'bg-blue-100 text-blue-800 border-blue-200',
  CPV: 'bg-cyan-100 text-cyan-800 border-cyan-200',
  Deviation: 'bg-orange-100 text-orange-800 border-orange-200',
  OOS: 'bg-red-100 text-red-800 border-red-200',
  CAPA: 'bg-purple-100 text-purple-800 border-purple-200',
  'Change Control': 'bg-indigo-100 text-indigo-800 border-indigo-200',
  DMS: 'bg-slate-100 text-slate-700 border-slate-200',
  Admin: 'bg-gray-100 text-gray-700 border-gray-200',
};

export function ModuleBadge({ module }: { module?: string }) {
  const label = module || 'Admin';
  return (
    <Badge variant="outline" className={cn('text-xs font-medium', COLORS[label] || 'bg-slate-100 text-slate-700 border-slate-200')}>
      {label}
    </Badge>
  );
}
