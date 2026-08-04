import { redirect } from 'next/navigation';

export default function DashboardLoginActivityRedirect() {
  redirect('/admin/login-activity');
}
