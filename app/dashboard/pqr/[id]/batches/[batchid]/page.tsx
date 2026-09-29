import { redirect } from 'next/navigation';

/** No standalone batch record — batch review list is the parent screen. */
export default async function PqrBatchRecordRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/pqr/${id}/batches`);
}
