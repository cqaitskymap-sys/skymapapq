import { redirect } from 'next/navigation';

/** Alias folder — canonical Document Lifecycle screen. */
export default function DocumentManagementIndexRedirect() {
  redirect('/qms/documents/lifecycle');
}
