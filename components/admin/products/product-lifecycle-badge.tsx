'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const COLORS: Record<string, string> = {
  Development: 'bg-purple-100 text-purple-800 border-purple-200',
  'Technology Transfer': 'bg-indigo-100 text-indigo-800 border-indigo-200',
  Validation: 'bg-amber-100 text-amber-800 border-amber-200',
  Commercial: 'bg-green-100 text-green-800 border-green-200',
  Discontinued: 'bg-red-100 text-red-800 border-red-200',
  Archived: 'bg-gray-100 text-gray-700 border-gray-200',
};

export function ProductLifecycleBadge({ status }: { status?: string }) {
  const label = status || 'Commercial';
  return (
    <Badge variant="outline" className={cn('text-xs font-medium', COLORS[label] || COLORS.Commercial)}>
      {label}
    </Badge>
  );
}
