'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { EquipmentAccessGuard } from '@/components/admin/equipment/equipment-access-guard';
import { EquipmentForm } from '@/components/equipment-mgmt/equipment-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditEquipmentMaster } from '@/lib/permissions';
import { getEquipmentById, updateEquipment } from '@/lib/equipment-mgmt-service';
import type { EquipmentCreateInput } from '@/lib/equipment-mgmt-schemas';
import { EQUIPMENT_QUALIFICATION_STATUSES, EQUIPMENT_MANUFACTURING_LINES, type EquipmentRecord } from '@/lib/equipment-mgmt-types';

function EditEquipmentContent({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [existing, setExisting] = useState<EquipmentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getEquipmentById(id)
      .then((row) => {
        setExisting(row);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (!canEditEquipmentMaster(role)) {
    return <ErrorCard accessDenied message="You do not have permission to edit equipment." />;
  }

  if (loading) return <LoadingSkeleton rows={1} />;
  if (!existing) return <ErrorCard title="Not Found" message="Equipment not found" />;

  const handleSubmit = async (data: EquipmentCreateInput) => {
    setSaving(true);
    try {
      await updateEquipment(id, data, {
        id: user?.uid || 'system',
        name: profile?.full_name || profile?.email || 'Admin',
        role: role || 'admin',
      });
      toast.success('Equipment updated');
      router.push(`/admin/equipment/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit Equipment"
        description={`${existing.equipment_id} · ${existing.equipment_name}`}
        basePath="/admin"
      />
      <Card>
        <CardContent className="p-6">
          <EquipmentForm
            defaultValues={{
              equipment_name: existing.equipment_name,
              equipment_id: existing.equipment_id,
              qualification_status: (EQUIPMENT_QUALIFICATION_STATUSES.includes(
                existing.qualification_status as (typeof EQUIPMENT_QUALIFICATION_STATUSES)[number],
              )
                ? existing.qualification_status
                : 'Not Qualified') as EquipmentCreateInput['qualification_status'],
              manufacturing_line: EQUIPMENT_MANUFACTURING_LINES.includes(
                existing.manufacturing_line as (typeof EQUIPMENT_MANUFACTURING_LINES)[number],
              )
                ? existing.manufacturing_line
                : (EQUIPMENT_MANUFACTURING_LINES[0] as string),
            }}
            onSubmit={handleSubmit}
            onCancel={() => router.push(`/admin/equipment/${id}`)}
            saving={saving}
            submitLabel="Save Changes"
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function EditEquipmentPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  return (
    <EquipmentAccessGuard>
      <EditEquipmentContent id={params.id} />
    </EquipmentAccessGuard>
  );
}
