'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, ExternalLink, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EquipmentStatusBadge } from '@/components/equipment-mgmt/equipment-sub-nav';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditEquipmentMaster } from '@/lib/permissions';
import type { EquipmentRecord } from '@/lib/equipment-mgmt-types';
import { getEquipmentById, deleteEquipment } from '@/lib/equipment-mgmt-service';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium break-words text-sm">{value ?? '—'}</p>
    </div>
  );
}

export function EquipmentDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const canEdit = canEditEquipmentMaster(role);

  const [record, setRecord] = useState<EquipmentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [changeReason, setChangeReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getEquipmentById(id);
      if (!next) {
        setError('Equipment not found');
        setRecord(null);
        return;
      }
      setRecord(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load equipment');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const runDelete = async () => {
    if (!record || changeReason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return;
    }
    setActionBusy(true);
    try {
      await deleteEquipment(id, {
        id: user?.uid || 'system',
        name: profile?.full_name || profile?.email || 'Admin',
        role: role || 'admin',
      }, changeReason);
      toast.success(`Deleted ${record.equipment_id}`);
      router.push('/admin/equipment');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) return <LoadingSkeleton rows={2} />;
  if (error || !record) {
    return <ErrorCard title="Not Found" message={error || 'Equipment not found'} onRetry={load} />;
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/admin/equipment')}>
        <ArrowLeft className="h-4 w-4 mr-1" />Back to Equipment Master
      </Button>

      <PageHeader
        title={record.equipment_name}
        description={record.equipment_id}
        basePath="/admin"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/qms/equipment/${id}`}>
                <ExternalLink className="h-4 w-4 mr-1" />Open in QMS
              </Link>
            </Button>
            {canEdit && (
              <>
                <Button asChild className="bg-blue-600 hover:bg-blue-700">
                  <Link href={`/admin/equipment/${id}/edit`}>
                    <Pencil className="h-4 w-4 mr-1" />Edit Equipment
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => { setChangeReason(''); setDeleteOpen(true); }}
                >
                  <Trash2 className="h-4 w-4 mr-1" />Delete
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 items-center">
        <EquipmentStatusBadge status={record.qualification_status || '—'} />
        {record.equipment_status ? <EquipmentStatusBadge status={record.equipment_status} /> : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Equipment Profile</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Equipment ID" value={<span className="font-mono">{record.equipment_id}</span>} />
            <Field label="Name" value={record.equipment_name} />
            <Field label="Qualification Status" value={record.qualification_status || '—'} />
            <Field label="Manufacturing Line" value={record.manufacturing_line || '—'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Audit</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Created By" value={record.created_by_name || record.created_by} />
            <Field
              label="Created At"
              value={record.created_at ? new Date(record.created_at).toLocaleString() : '—'}
            />
            <Field label="Updated By" value={record.updated_by_name || record.updated_by} />
            <Field
              label="Updated At"
              value={record.updated_at ? new Date(record.updated_at).toLocaleString() : '—'}
            />
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Equipment</AlertDialogTitle>
            <AlertDialogDescription>
              Soft-delete &quot;{record.equipment_name}&quot; ({record.equipment_id})?
              The record will be hidden from the register and kept for audit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label>Change Reason *</Label>
            <Textarea
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              rows={2}
              placeholder="Why is this equipment being deleted?"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void runDelete(); }}
              disabled={actionBusy}
              className="bg-red-600 hover:bg-red-700"
            >
              {actionBusy ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
