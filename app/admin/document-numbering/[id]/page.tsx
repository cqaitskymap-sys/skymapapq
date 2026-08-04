'use client';

import { useParams } from 'next/navigation';
import { DocumentNumberingAccessGuard } from '@/components/admin/document-numbering/document-numbering-access-guard';
import { DocumentNumberingDetailView } from '@/components/admin/document-numbering/document-numbering-detail-view';

export default function DocumentNumberingDetailPage() {
  const params = useParams();
  const id = params.id as string;

  return (
    <DocumentNumberingAccessGuard>
      <DocumentNumberingDetailView id={id} />
    </DocumentNumberingAccessGuard>
  );
}
