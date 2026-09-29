import { redirect } from 'next/navigation';

/** Grouping path only — Master Data home is Product Master. */
export default function MasterDataIndexRedirect() {
  redirect('/admin/products');
}
