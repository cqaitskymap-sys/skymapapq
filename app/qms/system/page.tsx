import { redirect } from 'next/navigation';

/** Alias folder — electronic signatures register. */
export default function SystemIndexRedirect() {
  redirect('/qms/system/electronic-signatures');
}
