import { redirect } from 'next/navigation';

const ADMIN_ROUTES: Record<string, string> = {
  users: '/admin/users',
  roles: '/admin/roles',
  departments: '/admin/departments',
  designations: '/admin/designations',
  'company-site': '/admin/company-site',
  'company-sites': '/admin/company-site',
  products: '/admin/products',
  batches: '/admin/batches',
  parameters: '/admin/parameters',
  workflows: '/admin/workflows',
  'approval-matrix': '/admin/approval-matrix',
  'document-numbering': '/admin/document-numbering',
  'audit-trail': '/admin/audit-trail',
  'login-activity': '/admin/login-activity',
  'user-access-review': '/admin/user-access-review',
  'password-policy': '/admin/system-settings/password-policy',
  'esign-settings': '/admin/esign-settings',
  notifications: '/admin/notifications',
  'email-sms-templates': '/admin/email-sms-templates',
  'module-configuration': '/admin/module-configuration',
  'master-data-import-export': '/admin/master-data-import-export',
  backup: '/admin/backup',
  'data-backup-log': '/admin/backup/history',
  'firebase-status': '/admin/firebase-status',
  'system-health': '/admin/system-health',
  'system-settings': '/admin/system-settings',
};

export default async function AdminSlugRedirect(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const target = ADMIN_ROUTES[params.slug];
  redirect(target || '/dashboard/admin');
}
