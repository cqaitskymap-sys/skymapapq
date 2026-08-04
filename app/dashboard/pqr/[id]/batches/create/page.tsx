import { redirect } from 'next/navigation';

/** Legacy Supabase batch create → Firebase batch review list */
export default async function LegacyPqrBatchCreateRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/pqr/${id}/batches`);
}
