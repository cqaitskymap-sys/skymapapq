import { redirect } from 'next/navigation';

/** Legacy Supabase raw-material list → Firebase material review */
export default async function LegacyPqrRawMaterialRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/pqr/${id}/materials`);
}
