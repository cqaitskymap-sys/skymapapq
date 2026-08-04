'use client';

import { AccessReviewAccessGuard } from '@/components/admin/access-review/access-review-access-guard';
import { AccessReviewListPage } from '@/components/admin/access-review/access-review-list-page';

export default function AdminUserAccessReviewPage() {
  return (
    <AccessReviewAccessGuard>
      <AccessReviewListPage />
    </AccessReviewAccessGuard>
  );
}
