import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Alias detail route — canonical report detail lives at /cpv/reports-analytics/[id] */
export default async function ReportsDetailRoutePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  redirect(`/cpv/reports-analytics/${params.id}`);
}
