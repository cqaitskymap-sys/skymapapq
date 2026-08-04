import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Launcher/dashboard entry — use the live CPV AI Analytics engine. */
export default function AIAnalyticsPage() {
  redirect('/cpv/ai-analytics');
}
