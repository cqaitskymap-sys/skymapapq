'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

/** Legacy route — redirects to canonical /admin/firebase-status */
export default function LegacyFirebaseStatusRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/firebase-status');
  }, [router]);
  return <LoadingSkeleton rows={2} />;
}
