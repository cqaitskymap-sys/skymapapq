import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Alias detail route — canonical SPC detail lives at /cpv/statistical-process-control/[id] */
export default async function ControlChartsDetailRoutePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  redirect(`/cpv/statistical-process-control/${params.id}`);
}
