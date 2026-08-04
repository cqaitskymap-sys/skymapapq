'use client';

import { use } from 'react';
import { FirebaseStatusAccessGuard } from '@/components/admin/firebase-status/firebase-status-access-guard';
import { FirebaseStatusDashboardPage } from '@/components/admin/firebase-status/firebase-status-dashboard-page';
import type { FirebaseStatusSectionId } from '@/lib/admin/firebase-status-service';

const SECTION_MAP: Record<string, FirebaseStatusSectionId> = {
  authentication: 'authentication',
  firestore: 'firestore',
  storage: 'storage',
  functions: 'functions',
  hosting: 'hosting',
  performance: 'performance',
  security: 'security',
  activity: 'activity',
  reports: 'reports',
  audit: 'audit',
};

export default function AdminFirebaseStatusSectionPage(props: {
  params: Promise<{ section: string }>;
}) {
  const params = use(props.params);
  const section = SECTION_MAP[params.section] || 'dashboard';

  return (
    <FirebaseStatusAccessGuard>
      <FirebaseStatusDashboardPage section={section} />
    </FirebaseStatusAccessGuard>
  );
}
