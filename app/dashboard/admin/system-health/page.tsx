'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

/** Legacy route — redirects to canonical /admin/system-health */
export default function LegacySystemHealthRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/system-health');
  }, [router]);
  return <LoadingSkeleton rows={2} />;
}
