'use client';

import { FirebaseStatusAccessGuard } from '@/components/admin/firebase-status/firebase-status-access-guard';
import { FirebaseStatusDashboardPage } from '@/components/admin/firebase-status/firebase-status-dashboard-page';

export default function AdminFirebaseStatusPage() {
  return (
    <FirebaseStatusAccessGuard>
      <FirebaseStatusDashboardPage section="dashboard" />
    </FirebaseStatusAccessGuard>
  );
}
