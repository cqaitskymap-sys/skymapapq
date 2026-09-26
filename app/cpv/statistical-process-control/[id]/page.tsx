import { SpcAccessGuard } from '@/components/cpv/statistical-process-control/spc-access-guard';
import { SpcDetailView } from '@/components/cpv/statistical-process-control/spc-detail-view';

export const dynamic = 'force-dynamic';

export default async function StatisticalProcessControlDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return (
    <SpcAccessGuard>
      <SpcDetailView id={params.id} />
    </SpcAccessGuard>
  );
}
