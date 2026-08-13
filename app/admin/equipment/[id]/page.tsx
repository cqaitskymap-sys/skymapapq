'use client';

import { use } from 'react';
import { EquipmentAccessGuard } from '@/components/admin/equipment/equipment-access-guard';
import { EquipmentDetailView } from '@/components/admin/equipment/equipment-detail-view';

export default function AdminEquipmentDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  return (
    <EquipmentAccessGuard>
      <EquipmentDetailView id={params.id} />
    </EquipmentAccessGuard>
  );
}
