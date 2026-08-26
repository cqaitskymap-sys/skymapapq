'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Factory, FlaskConical, Package, Plus, FileText, ClipboardList, ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canProductionCreateBatches, canViewBatches, canViewProducts } from '@/lib/permissions';
import { subscribeToBatches, getBatchSummaryCounts } from '@/lib/admin/batch-service';
import { subscribeToProducts } from '@/lib/admin/product-service';
import type { AdminBatch, AdminProduct } from '@/lib/admin/schemas';
import { ManufacturingAccessGuard } from '@/components/manufacturing/manufacturing-access-guard';
import { KpiCard } from '@/components/admin/dashboard/kpi-card';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { BatchStatusBadge } from '@/components/admin/batches/batch-status-badge';
import { ReleaseStatusBadge } from '@/components/admin/batches/release-status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const QUICK_LINKS = [
  { label: 'Batch Management', href: '/dashboard/batches', icon: Package, description: 'Open, filter, and release manufacturing batches' },
  { label: 'Product Master', href: '/dashboard/products', icon: FlaskConical, description: 'Codes, strengths, and formulations used on the shop floor' },
  { label: 'eBMR', href: '/qms/ebmr', icon: FileText, description: 'Execute electronic batch manufacturing records' },
  { label: 'CPV Batch Registration', href: '/cpv/batch-registration', icon: ClipboardList, description: 'Register commercial batches for process verification' },
] as const;

function batchYield(batch: AdminBatch): string {
  const planned = Number(batch.plannedQuantity);
  const actual = Number(batch.actualQuantity);
  if (!Number.isFinite(planned) || planned <= 0 || !Number.isFinite(actual)) return '—';
  return `${((actual / planned) * 100).toFixed(1)}%`;
}

function ManufacturingDashboardContent() {
  const { profile } = useAuth();
  const { role } = useAdminPermissions();
  const canCreate = canProductionCreateBatches(role);
  const showBatches = canViewBatches(role);
  const showProducts = canViewProducts(role);

  const [batches, setBatches] = useState<AdminBatch[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unsubBatches = subscribeToBatches(
      false,
      (next) => {
        if (cancelled) return;
        setBatches(next);
        setError(null);
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      },
    );
    const unsubProducts = subscribeToProducts(false, (next) => {
      if (!cancelled) setProducts(next);
    });

    return () => {
      cancelled = true;
      unsubBatches();
      unsubProducts();
    };
  }, []);

  const stats = useMemo(() => getBatchSummaryCounts(batches), [batches]);
  const activeProducts = useMemo(
    () => products.filter((p) => !p.isDeleted && p.productStatus !== 'Inactive').length,
    [products],
  );
  const recentBatches = useMemo(() => {
    return [...batches]
      .filter((b) => !b.isDeleted)
      .sort((a, b) => (b.manufacturingDate || b.createdAt || '').localeCompare(a.manufacturingDate || a.createdAt || ''))
      .slice(0, 8);
  }, [batches]);

  if (loading) return <LoadingSkeleton rows={3} />;
  if (error) return <ErrorCard title="Unable to load manufacturing data" message={error} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Factory className="h-4 w-4" />
            <span>Manufacturing</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Production overview</h1>
          <p className="mt-1 text-muted-foreground">
            Live batch status, product catalog, and shop-floor shortcuts
            {profile?.full_name ? ` for ${profile.full_name}` : ''}.
          </p>
        </div>
        {canCreate && (
          <Button asChild className="bg-blue-600 hover:bg-blue-700">
            <Link href="/admin/batches/create">
              <Plus className="mr-2 h-4 w-4" />
              New Batch
            </Link>
          </Button>
        )}
      </div>

      {showBatches && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Total batches" value={stats.total} icon={Package} />
          <KpiCard label="Manufacturing" value={stats.manufacturing} accent="border-l-orange-500" />
          <KpiCard label="Testing" value={stats.testing} accent="border-l-cyan-500" />
          <KpiCard label="Released" value={stats.released} accent="border-l-green-600" />
          <KpiCard label="On hold" value={stats.hold} accent="border-l-amber-500" />
          <KpiCard
            label="Active products"
            value={showProducts ? activeProducts : '—'}
            icon={FlaskConical}
            accent="border-l-violet-500"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {QUICK_LINKS.map((item) => (
          <Link key={item.href} href={item.href} className="group">
            <Card className="h-full transition-colors hover:border-blue-500/50 hover:bg-muted/30">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500/10 text-orange-600 group-hover:bg-orange-500/20">
                    <item.icon className="h-4 w-4" />
                  </div>
                  <CardTitle className="text-base leading-snug">{item.label}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="flex items-end justify-between gap-2">
                <CardDescription>{item.description}</CardDescription>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Recent batches</CardTitle>
            <CardDescription>Latest manufacturing records from product master</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/batches">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Batch Number</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Mfg Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Release</TableHead>
                  <TableHead className="text-right">Yield</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentBatches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <EmptyState
                        title="No batches yet"
                        message="Register a manufacturing batch to start tracking production."
                        actionLabel={canCreate ? 'Create batch' : undefined}
                        actionHref={canCreate ? '/admin/batches/create' : undefined}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  recentBatches.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell>
                        <Link href={`/admin/batches/${batch.id}`} className="font-mono text-sm font-medium hover:underline">
                          {batch.batchNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{batch.productName || '—'}</div>
                        <div className="text-xs text-muted-foreground">{batch.productCode}</div>
                      </TableCell>
                      <TableCell className="text-sm">{batch.manufacturingDate || '—'}</TableCell>
                      <TableCell><BatchStatusBadge status={batch.batchStatus} /></TableCell>
                      <TableCell><ReleaseStatusBadge status={batch.releaseStatus} /></TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{batchYield(batch)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ManufacturingDashboardPage() {
  return (
    <ManufacturingAccessGuard>
      <ManufacturingDashboardContent />
    </ManufacturingAccessGuard>
  );
}
