import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Alias route — canonical SPC list lives at /cpv/statistical-process-control */
export default function ControlChartsRoutePage() {
  redirect('/cpv/statistical-process-control');
}
