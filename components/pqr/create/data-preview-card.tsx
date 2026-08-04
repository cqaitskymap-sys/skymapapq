'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DataLoadState } from '@/lib/pqr-create-records';

export function DataPreviewCard({
  title,
  items,
  loadState = 'ok',
  emptyMessage = 'No records found',
  errorMessage = 'Failed to load data',
}: {
  title: string;
  items: Array<{ label: string; value: string | number }>;
  loadState?: DataLoadState;
  emptyMessage?: string;
  errorMessage?: string;
}) {
  if (loadState === 'loading') {
    return (
      <Card className="shadow-sm">
        <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
        <CardContent><p className="text-xs text-muted-foreground">Loading…</p></CardContent>
      </Card>
    );
  }
  if (loadState === 'error') {
    return (
      <Card className="shadow-sm border-red-200">
        <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
        <CardContent><p className="text-xs text-red-700" role="alert">{errorMessage}</p></CardContent>
      </Card>
    );
  }

  const hasPositive = items.some((i) => Number(i.value) > 0);
  const showEmpty = loadState === 'empty' || !hasPositive;

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {showEmpty && !hasPositive ? (
          <p className="text-xs text-muted-foreground">{emptyMessage}</p>
        ) : null}
        <dl className="grid grid-cols-2 gap-2 text-sm">
          {items.map((item) => (
            <div key={item.label}>
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd className="font-semibold tabular-nums">{item.value}</dd>
            </div>
          ))}
        </dl>
        {hasPositive ? null : showEmpty ? null : (
          <p className="mt-2 text-xs text-muted-foreground">Actual zero — no matching records.</p>
        )}
      </CardContent>
    </Card>
  );
}
