import { redirect } from 'next/navigation';

/** Record index — FMEA is the assessment workspace for a risk record. */
export default async function RiskRecordIndexRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/qms/risk-management/${id}/fmea`);
}
