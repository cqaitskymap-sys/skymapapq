'use client';

import { EquipmentAccessGuard } from '@/components/admin/equipment/equipment-access-guard';
import { EquipmentListPage } from '@/components/admin/equipment/equipment-list-page';

export default function AdminEquipmentPage() {
  return (
    <EquipmentAccessGuard>
      <EquipmentListPage />
    </EquipmentAccessGuard>
  );
}
