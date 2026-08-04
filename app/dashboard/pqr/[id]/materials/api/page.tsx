import { redirect } from 'next/navigation';

/** Legacy Supabase API materials → Firebase material review */
export default async function LegacyPqrApiMaterialsRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/pqr/${id}/materials`);
}
