'use client';

import { PageLoader } from '@/components/loading/loaders';

export function LoadingSkeleton(_props: { rows?: number } = {}) {
  return <PageLoader message="Loading..." />;
}
