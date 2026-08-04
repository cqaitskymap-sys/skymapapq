import { redirect } from 'next/navigation';

/** Legacy Supabase PQR editor → Firebase PQR overview */
export default async function LegacyPqrEditRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/pqr/${id}`);
}
