'use client';

import { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { PqrSubNav } from './pqr-sub-nav';
import { usePqrData } from '@/hooks/use-pqr-data';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';

interface PqrSectionPageProps {
  pqrId: string;
  title: string;
  description?: string;
  children: (ctx: ReturnType<typeof usePqrData>) => ReactNode;
  showRefresh?: boolean;
}

export function PqrSectionPage({ pqrId, title, description, children, showRefresh = true }: PqrSectionPageProps) {
  const ctx = usePqrData(pqrId);
  const { profile } = useAuth();

  const handleRefresh = async () => {
    await ctx.refreshData({ id: profile?.id, name: profile?.full_name, role: profile?.role });
    toast.success('PQR data refreshed from all modules');
  };

  if (ctx.loading) return <LoadingSpinner label="Loading PQR data..." />;

  if (!ctx.document) {
    return <EmptyState title="PQR Not Found" description="The requested PQR document could not be loaded." actionLabel="Back to PQR Dashboard" actionHref="/dashboard/pqr" />;
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <PqrSubNav pqrId={pqrId} pqrNumber={ctx.document.pqr_number} status={ctx.document.document_status} />
      <div className="flex-1 min-w-0 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
            <p className="text-xs text-muted-foreground mt-1 font-mono">{ctx.document.pqr_number} | {ctx.document.product_name}</p>
          </div>
          {showRefresh && (
            <Button variant="outline" onClick={handleRefresh} disabled={ctx.refreshing} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${ctx.refreshing ? 'animate-spin' : ''}`} />
              {ctx.refreshing ? 'Refreshing...' : 'Refresh Data'}
            </Button>
          )}
        </div>
        {ctx.error && (
          <Card className="border-red-200 bg-red-50"><CardContent className="p-3 text-sm text-red-700">{ctx.error}</CardContent></Card>
        )}
        {children(ctx)}
      </div>
    </div>
  );
}

export function PqrSummaryCard({ title, value, subtitle }: { title: string; value: string | number; subtitle?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle></CardHeader>
      <CardContent><p className="text-2xl font-bold">{value}</p>{subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}</CardContent>
    </Card>
  );
}

export function PqrRecordsTable({ columns, records }: { columns: { key: string; label: string }[]; records: Record<string, unknown>[] }) {
  if (!records.length) {
    return <EmptyState title="No Records" description="No data available for this section. Click Refresh Data to pull from modules." />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b">
          <tr>{columns.map((c) => <th key={c.key} className="px-3 py-2 text-left font-semibold">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {records.slice(0, 50).map((row, i) => (
            <tr key={i} className="border-b hover:bg-slate-50/50">
              {columns.map((c) => <td key={c.key} className="px-3 py-2">{String(row[c.key] ?? '—')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
