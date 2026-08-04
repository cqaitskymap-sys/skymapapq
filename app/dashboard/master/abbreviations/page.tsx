import { redirect } from 'next/navigation';

/** Legacy Supabase abbreviations (no Firebase replacement) → Admin products */
export default function LegacyAbbreviationsRedirect() {
  redirect('/admin/products');
}
