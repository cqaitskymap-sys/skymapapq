'use client';

import { memo, ReactNode } from 'react';
import { BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DialogLoader } from '@/components/loading/loaders';

function ChartContainerInner({
  children,
  height = 280,
  empty = false,
  loading = false,
  emptyText = 'Not enough data to render this chart.',
  className,
}: {
  children: ReactNode;
  height?: number;
  empty?: boolean;
  loading?: boolean;
  emptyText?: string;
  className?: string;
}) {
  if (loading) {
    return (
      <div className={className} style={{ height }}>
        <DialogLoader message="Loading chart..." />
      </div>
    );
  }

  if (empty) {
    return (
      <div
        className={cn('flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 text-center', className)}
        style={{ height }}
      >
        <BarChart3 className="mb-2 h-8 w-8 text-muted-foreground/60" />
        <p className="max-w-xs text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }
  return (
    <div className={cn('w-full animate-in', className)} style={{ height }}>
      {children}
    </div>
  );
}

export const ChartContainer = memo(ChartContainerInner);
