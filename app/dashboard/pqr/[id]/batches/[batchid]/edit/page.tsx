import { redirect } from 'next/navigation';

/** Legacy Supabase batch edit → Firebase batch review list */
export default async function LegacyPqrBatchEditRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/pqr/${id}/batches`);
}
