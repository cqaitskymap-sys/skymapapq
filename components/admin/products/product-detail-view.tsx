'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, AlertTriangle, History, Link2, Layers } from 'lucide-react';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { DosageFormBadge } from './dosage-form-badge';
import { ProductStatusBadge } from './product-status-badge';
import { ProductLifecycleBadge } from './product-lifecycle-badge';
import { CompositionTable } from './composition-table';
import { PackingTable } from './packing-table';
import { ProductAttachmentsSection } from './product-attachments-section';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditProducts, canUploadProductAttachments } from '@/lib/permissions';
import { PRODUCT_LIFECYCLE_STATUSES } from '@/lib/admin/constants';
import type { AdminProduct, ProductAttachment } from '@/lib/admin/schemas';
import {
  fetchProductById, fetchProductCompositions, fetchProductPacking,
  fetchProductAttachments, fetchProductAuditTrail, countLinkedBatches,
  exportProductsCsv,
} from '@/lib/admin/product-service';

export function ProductDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const canEdit = canEditProducts(role);
  const canUpload = canUploadProductAttachments(role);

  const [product, setProduct] = useState<AdminProduct | null>(null);
  const [compositions, setCompositions] = useState<Awaited<ReturnType<typeof fetchProductCompositions>>>([]);
  const [packing, setPacking] = useState<Awaited<ReturnType<typeof fetchProductPacking>>>([]);
  const [attachments, setAttachments] = useState<ProductAttachment[]>([]);
  const [auditTrail, setAuditTrail] = useState<Record<string, unknown>[]>([]);
  const [linkedBatches, setLinkedBatches] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  };

  const load = useCallback(async () => {
    try {
      const p = await fetchProductById(id, true);
      if (!p) {
        setError('Product not found');
        return;
      }
      setProduct(p);
      setCompositions(await fetchProductCompositions(id));
      setPacking(await fetchProductPacking(id));
      setAttachments(await fetchProductAttachments(id));
      setAuditTrail(await fetchProductAuditTrail(id));
      setLinkedBatches(await countLinkedBatches(p.productCode));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const lifecycleTimeline = useMemo(() => {
    const current = product?.lifecycleStatus || 'Commercial';
    const currentIndex = PRODUCT_LIFECYCLE_STATUSES.indexOf(current as typeof PRODUCT_LIFECYCLE_STATUSES[number]);
    const lifecycleEvents = auditTrail.filter((entry) =>
      ['LIFECYCLE_CHANGED', 'CREATE_PRODUCT', 'ARCHIVE_PRODUCT', 'RESTORE_PRODUCT'].includes(String(entry.action)),
    );
    const eventDates = new Map<string, string>();
    lifecycleEvents.forEach((entry) => {
      const newValue = entry.newValue;
      let stage = '';
      if (typeof newValue === 'string') {
        try {
          const parsed = JSON.parse(newValue) as { lifecycleStatus?: string };
          stage = parsed.lifecycleStatus || newValue;
        } catch {
          stage = newValue;
        }
      } else if (newValue && typeof newValue === 'object' && 'lifecycleStatus' in (newValue as object)) {
        stage = String((newValue as { lifecycleStatus?: string }).lifecycleStatus || '');
      }
      if (stage) eventDates.set(stage, String(entry.timestamp || entry.dateTime || ''));
    });
    return PRODUCT_LIFECYCLE_STATUSES.map((stage, index) => ({
      stage,
      completed: index <= currentIndex || eventDates.has(stage),
      current: stage === current,
      date: eventDates.get(stage),
    }));
  }, [product?.lifecycleStatus, auditTrail]);

  if (loading) return <LoadingSkeleton rows={2} />;
  if (error || !product) return <ErrorCard title="Not Found" message={error || 'Product not found'} />;

  const overviewFields = [
    { label: 'Product ID', value: product.productId },
    { label: 'Product Code', value: product.productCode },
    { label: 'Generic Name', value: product.genericName },
    { label: 'Brand Name', value: product.brandName },
    { label: 'Product Family', value: product.productFamily },
    { label: 'Category', value: product.category || product.therapeuticCategory },
    { label: 'Strength', value: product.strength },
    { label: 'Route', value: product.routeOfAdministration },
    { label: 'Pack Size', value: product.packSize },
    { label: 'Pack Type', value: product.packType },
    { label: 'Container Closure', value: product.containerClosure },
    { label: 'Market', value: product.market },
    { label: 'Country', value: product.country },
    { label: 'Manufacturing Site', value: product.manufacturingSite },
    { label: 'Business Unit', value: product.businessUnit },
    { label: 'Department', value: product.department },
    { label: 'Product Owner', value: product.productOwner },
    { label: 'Shelf Life (months)', value: product.shelfLife },
    { label: 'Storage', value: product.storageCondition },
    { label: 'Batch Size', value: product.standardBatchSize || product.batchSize },
    { label: 'Batch Prefix', value: product.batchPrefix },
    { label: 'Mfg License', value: product.manufacturingLicenseNumber },
    { label: 'Registration No.', value: product.registrationNumber },
    { label: 'License No.', value: product.licenseNumber },
    { label: 'MFR', value: product.mfrNumber },
    { label: 'BMR / BPR', value: `${product.bmrNumber || '-'} / ${product.bprNumber || '-'}` },
    { label: 'Specification No.', value: product.specificationNumber },
    { label: 'STP No.', value: product.stpNumber },
    { label: 'HSN Code', value: product.hsnCode },
    { label: 'GTIN', value: product.gtin },
    { label: 'Barcode', value: product.barcode },
    { label: 'QR Code', value: product.qrCode },
    { label: 'Created By', value: product.createdBy },
    { label: 'Created At', value: product.createdAt ? new Date(product.createdAt).toLocaleString() : '-' },
    { label: 'Updated By', value: product.updatedBy },
    { label: 'Updated At', value: product.updatedAt ? new Date(product.updatedAt).toLocaleString() : '-' },
  ];

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/admin/products')}>
        <ArrowLeft className="h-4 w-4 mr-1" />Back to Products
      </Button>

      <PageHeader
        title={product.productName}
        description={product.productId || product.productCode}
        basePath="/admin"
        actions={
          canEdit && !product.isDeleted ? (
            <Button asChild className="bg-blue-600 hover:bg-blue-700">
              <Link href={`/admin/products/${id}/edit`}><Pencil className="h-4 w-4 mr-1" />Edit Product</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-2 items-center">
        <ProductStatusBadge status={product.productStatus} />
        <ProductLifecycleBadge status={product.lifecycleStatus} />
        <DosageFormBadge form={product.dosageForm} />
        {product.isDeleted && <Badge variant="destructive">Deleted</Badge>}
        {product.productStatus !== 'Active' && (
          <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200">
            <AlertTriangle className="h-3 w-3" />
            Inactive — new PQR/CPV records blocked
          </span>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="composition">Composition</TabsTrigger>
          <TabsTrigger value="packing">Packing</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader><CardTitle className="text-base">Product Profile</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {overviewFields.map((field) => (
                <div key={field.label}>
                  <p className="text-xs text-muted-foreground">{field.label}</p>
                  <p className="font-medium break-words">{String(field.value ?? '-')}</p>
                </div>
              ))}
              {product.description && (
                <div className="sm:col-span-2 md:col-span-3">
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p className="font-medium">{product.description}</p>
                </div>
              )}
              {product.remarks && (
                <div className="sm:col-span-2 md:col-span-3">
                  <p className="text-xs text-muted-foreground">Remarks</p>
                  <p className="font-medium">{product.remarks}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="composition">
          <Card>
            <CardHeader><CardTitle className="text-base">Composition</CardTitle></CardHeader>
            <CardContent>
              <CompositionTable rows={compositions} onChange={() => {}} readOnly />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="packing">
          <Card>
            <CardHeader><CardTitle className="text-base">Packing Details</CardTitle></CardHeader>
            <CardContent>
              <PackingTable rows={packing} onChange={() => {}} readOnly />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <ProductAttachmentsSection
            productId={id}
            attachments={attachments}
            canUpload={canUpload && !product.isDeleted}
            auditMeta={auditMeta}
            onRefresh={load}
          />
        </TabsContent>

        <TabsContent value="integrations">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Link2 className="h-4 w-4" />Linked Records</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p><span className="font-medium">{linkedBatches}</span> linked batch record(s) reference this product.</p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline"><Link href={`/admin/batches?productCode=${product.productCode}`}>Batch Master</Link></Button>
                <Button asChild size="sm" variant="outline"><Link href="/pqr/batches">PQR Batches</Link></Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Product name and generic name changes cascade automatically to linked batch records when updated via Cloud Functions.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lifecycle">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Layers className="h-4 w-4" />Lifecycle Timeline</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Current:</span>
                <ProductLifecycleBadge status={product.lifecycleStatus} />
              </div>
              <div className="space-y-3">
                {lifecycleTimeline.map((step) => (
                  <div key={step.stage} className="flex items-start gap-3">
                    <div className={`mt-1 h-3 w-3 rounded-full shrink-0 ${step.current ? 'bg-blue-600 ring-4 ring-blue-100' : step.completed ? 'bg-green-600' : 'bg-gray-300'}`} />
                    <div>
                      <p className={`font-medium text-sm ${step.current ? 'text-blue-700' : ''}`}>{step.stage}</p>
                      {step.date && <p className="text-xs text-muted-foreground">{new Date(step.date).toLocaleString()}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports">
          <Card>
            <CardHeader><CardTitle className="text-base">Product Reports</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-3">
              <p>Linked batches: <span className="font-medium">{linkedBatches}</span></p>
              <p>Lifecycle: <span className="font-medium">{product.lifecycleStatus}</span></p>
              <p>Status: <span className="font-medium">{product.productStatus}</span></p>
              <p>Category: <span className="font-medium">{product.category || product.therapeuticCategory || '—'}</span></p>
              <p className="text-muted-foreground">
                Export product configuration or use Audit Trail for formal Part 11 / ALCOA+ evidence.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const csv = exportProductsCsv([product]);
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = `product-${product.productCode || product.id}-report.csv`;
                    anchor.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Export Product Report
                </Button>
                <Button asChild size="sm" variant="outline"><Link href="/admin/audit-trail">Audit Trail Report</Link></Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader><CardTitle className="text-base">Audit Trail</CardTitle></CardHeader>
            <CardContent>
              {auditTrail.length === 0 ? (
                <EmptyState message="No audit events for this product." />
              ) : (
                <div className="space-y-2 text-sm max-h-96 overflow-y-auto">
                  {auditTrail.map((entry, index) => (
                    <div key={String(entry.id || index)} className="p-3 border rounded">
                      <p className="font-medium">{String(entry.action)}</p>
                      <p className="text-xs text-muted-foreground">
                        {String(entry.timestamp || entry.dateTime)} — {String(entry.userName || '')}
                      </p>
                      {entry.reason ? <p className="text-xs mt-1">Reason: {String(entry.reason)}</p> : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" />Change History</CardTitle></CardHeader>
            <CardContent>
              {auditTrail.length === 0 ? (
                <EmptyState message="No history recorded yet." />
              ) : (
                <div className="space-y-2 text-sm">
                  {auditTrail.map((entry, index) => (
                    <div key={`history-${String(entry.id || index)}`} className="flex justify-between gap-4 border-b pb-2">
                      <span>{String(entry.action)}</span>
                      <span className="text-muted-foreground">{String(entry.timestamp || entry.dateTime)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
