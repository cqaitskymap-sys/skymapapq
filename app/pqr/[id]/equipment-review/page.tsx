import { redirect } from 'next/navigation';

export default async function PqrEquipmentReviewRedirect(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  redirect(`/pqr/equipment-review?pqrId=${encodeURIComponent(params.id)}`);
}
