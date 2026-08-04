import { redirect } from 'next/navigation';

/** Legacy Supabase product master → Firebase Admin Product Master */
export default function LegacyProductMasterRedirect() {
  redirect('/admin/products');
}
