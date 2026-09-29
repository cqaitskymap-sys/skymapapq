import { redirect } from 'next/navigation';

/** Alias folder — canonical External Documents screen. */
export default function DocumentControlIndexRedirect() {
  redirect('/qms/documents/external');
}
