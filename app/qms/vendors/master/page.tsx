'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { VendorFiltersBar } from '@/components/vendor-mgmt/vendor-filters';
import { VendorForm } from '@/components/vendor-mgmt/vendor-form';
import { ApprovalBadge, RiskBadge } from '@/components/vendor-mgmt/vendor-sub-nav';
import { useVendors, useVendorActor } from '@/hooks/use-vendor-mgmt';
import { createVendor } from '@/lib/vendor-mgmt-service';
import type { VendorFilters } from '@/lib/vendor-mgmt-types';
import type { VendorCreateInput } from '@/lib/vendor-mgmt-schemas';
import { canManageVendors } from '@/lib/vendor-mgmt-types';

export default function VendorMasterPage() {
  const [filters, setFilters] = useState<VendorFilters>({});
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { vendors, loading, error, refresh } = useVendors(filters);
  const actor = useVendorActor();

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && typeof document !== 'undefined') {
      const active = document.activeElement as HTMLElement | null;
      active?.blur();
    }
    setOpen(nextOpen);
  };

  const handleCreate = async (data: VendorCreateInput) => {
    setSaving(true);
    try {
      await createVendor(data, actor);
      toast.success('Vendor created');
      handleOpenChange(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Vendor Master</h1>
          <p className="text-muted-foreground text-sm">Create and manage supplier profiles</p>
        </div>
        {canManageVendors(actor.role) && (
          <Button className="bg-blue-600 hover:bg-blue-700 gap-2" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New Vendor</Button>
        )}
      </div>
      <VendorFiltersBar filters={filters} onChange={setFilters} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? <LoadingSpinner /> : (
        <Card><CardHeader><CardTitle>All Vendors ({vendors.length})</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table><TableHeader><TableRow>
              <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead>
              <TableHead>Material / Service</TableHead><TableHead>Approval</TableHead><TableHead>Risk</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader><TableBody>
              {vendors.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No vendors — create your first vendor</TableCell></TableRow>
                : vendors.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono text-sm">{v.vendor_code}</TableCell>
                    <TableCell>{v.vendor_name}</TableCell>
                    <TableCell className="text-xs">{v.vendor_type}</TableCell>
                    <TableCell className="max-w-[180px] truncate text-xs">{v.material_service_supplied}</TableCell>
                    <TableCell><ApprovalBadge status={v.approval_status} /></TableCell>
                    <TableCell><RiskBadge level={v.risk_category} /></TableCell>
                    <TableCell>{v.vendor_status}</TableCell>
                    <TableCell><Link href={`/qms/vendors/${v.id}`}><Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button></Link></TableCell>
                  </TableRow>
                ))}
            </TableBody></Table>
          </CardContent></Card>
      )}
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader><SheetTitle>Create Vendor</SheetTitle></SheetHeader>
          <div className="mt-6"><VendorForm onSubmit={handleCreate} onCancel={() => handleOpenChange(false)} saving={saving} submitLabel="Create Vendor" /></div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
