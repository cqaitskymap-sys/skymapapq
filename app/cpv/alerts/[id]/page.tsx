import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Alias detail route — canonical alert detail lives at /cpv/alert-engine/[id] */
export default async function AlertsDetailRoutePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  redirect(`/cpv/alert-engine/${params.id}`);
}
