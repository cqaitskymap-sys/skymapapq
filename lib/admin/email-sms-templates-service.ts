import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import { applyTemplateVariables } from '@/lib/notification-service';
import { ADMIN_COLLECTIONS, TEMPLATE_PLACEHOLDERS } from './constants';
import type { EmailSmsTemplate, EmailSmsTemplateFormData } from './schemas';

export interface EmailSmsTemplateAuditMeta {
  userId: string;
  userName: string;
}

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

export function buildTemplateId(code: string): string {
  return `TMPL-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

export function extractPlaceholders(text: string): string[] {
  const found = new Set<string>();
  const re = /\{\{(\w+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) found.add(m[1]);
  return Array.from(found);
}

export function normalizeEmailSmsTemplate(t: EmailSmsTemplate): EmailSmsTemplate {
  return {
    ...t,
    templateId: t.templateId || buildTemplateId(t.templateCode || 'TMPL'),
    placeholders: Array.isArray(t.placeholders)
      ? t.placeholders
      : extractPlaceholders(`${t.subject || ''}\n${t.body || ''}\n${t.smsBody || ''}`),
    smsBody: t.smsBody || (t.templateType === 'SMS' ? t.body : ''),
    isHtml: t.isHtml ?? false,
    language: t.language || 'en',
    category: t.category || 'General',
    approvalStatus: t.approvalStatus || (t.status === 'Active' ? 'Published' : 'Draft'),
    version: Number(t.version || 1),
    priority: t.priority || 'Medium',
    channel: t.channel || t.templateType,
  };
}

export function isTemplatePublishable(t: EmailSmsTemplate): boolean {
  return t.status === 'Active'
    && !t.isDeleted
    && (t.approvalStatus === 'Published' || t.approvalStatus === 'Approved');
}

export function getEmailSmsTemplatesSummary(templates: EmailSmsTemplate[]) {
  return {
    total: templates.length,
    active: templates.filter((t) => t.status === 'Active').length,
    published: templates.filter((t) => t.approvalStatus === 'Published').length,
    draft: templates.filter((t) => t.approvalStatus === 'Draft' || t.approvalStatus === 'Under Review').length,
    email: templates.filter((t) => t.templateType === 'Email').length,
    sms: templates.filter((t) => t.templateType === 'SMS').length,
  };
}

export async function fetchEmailSmsTemplates(): Promise<EmailSmsTemplate[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.emailSmsTemplates),
      orderBy('updatedAt', 'desc'),
      limit(400),
    ));
    return snap.docs
      .map((d) => normalizeEmailSmsTemplate({ id: d.id, ...d.data() } as EmailSmsTemplate))
      .filter((t) => !t.isDeleted);
  } catch {
    try {
      const snap = await getDocs(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.emailSmsTemplates));
      return snap.docs
        .map((d) => normalizeEmailSmsTemplate({ id: d.id, ...d.data() } as EmailSmsTemplate))
        .filter((t) => !t.isDeleted)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    } catch {
      return [];
    }
  }
}

export function subscribeToEmailSmsTemplates(
  onData: (rows: EmailSmsTemplate[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  return onSnapshot(
    query(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.emailSmsTemplates), limit(400)),
    (snapshot) => {
      onData(snapshot.docs
        .map((d) => normalizeEmailSmsTemplate({ id: d.id, ...d.data() } as EmailSmsTemplate))
        .filter((t) => !t.isDeleted)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))));
    },
    (error) => onError?.(new Error(error.message)),
  );
}

export async function fetchEmailSmsTemplateById(id: string): Promise<EmailSmsTemplate | null> {
  if (!isFirebaseConfigured() || !id) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.emailSmsTemplates, id));
    if (!snap.exists() || snap.data().isDeleted === true) return null;
    return normalizeEmailSmsTemplate({ id: snap.id, ...snap.data() } as EmailSmsTemplate);
  } catch {
    return null;
  }
}

export async function fetchTemplateVersions(templateDocId: string): Promise<Array<Record<string, unknown>>> {
  if (!isFirebaseConfigured() || !templateDocId) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.emailSmsTemplateVersions),
      where('templateDocId', '==', templateDocId),
      orderBy('version', 'desc'),
      limit(50),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    try {
      const snap = await getDocs(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.emailSmsTemplateVersions));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>))
        .filter((v) => v.templateDocId === templateDocId)
        .sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
    } catch {
      return [];
    }
  }
}

function formToCallable(data: EmailSmsTemplateFormData, changeReason: string) {
  return {
    templateCode: data.templateCode,
    templateName: data.templateName,
    description: data.description,
    category: data.category,
    module: data.module,
    subModule: data.subModule,
    workflow: data.workflow,
    templateType: data.templateType,
    subject: data.subject,
    body: data.body,
    smsBody: data.smsBody || (data.templateType === 'SMS' ? data.body : ''),
    isHtml: data.isHtml,
    variables: data.variables,
    priority: data.priority,
    language: data.language,
    company: data.company,
    businessUnit: data.businessUnit,
    site: data.site,
    department: data.department,
    effectiveDate: data.effectiveDate,
    reviewDate: data.reviewDate,
    expiryDate: data.expiryDate,
    approvalStatus: data.approvalStatus,
    remarks: data.remarks,
    changeReason,
  };
}

export async function createEmailSmsTemplate(
  data: EmailSmsTemplateFormData,
  meta: EmailSmsTemplateAuditMeta,
): Promise<{ template: EmailSmsTemplate | null; error: string | null }> {
  try {
    const reason = data.changeReason || `Created by ${meta.userName}`;
    if (reason.trim().length < 5) return { template: null, error: 'Change reason is required (min 5 characters)' };
    const fn = httpsCallable(getFirebaseFunctions(), 'createAdminEmailSmsTemplate');
    const result = await fn(formToCallable(data, reason));
    const id = (result.data as { id?: string })?.id;
    return { template: id ? await fetchEmailSmsTemplateById(id) : null, error: null };
  } catch (e) {
    return { template: null, error: callableErrorMessage(e, 'Unable to create template') };
  }
}

export async function updateEmailSmsTemplate(
  id: string,
  data: EmailSmsTemplateFormData,
  meta: EmailSmsTemplateAuditMeta,
): Promise<{ template: EmailSmsTemplate | null; error: string | null }> {
  try {
    const reason = data.changeReason || `Updated by ${meta.userName}`;
    if (reason.trim().length < 5) return { template: null, error: 'Change reason is required (min 5 characters)' };
    const fn = httpsCallable(getFirebaseFunctions(), 'updateAdminEmailSmsTemplate');
    await fn({ id, ...formToCallable(data, reason) });
    return { template: await fetchEmailSmsTemplateById(id), error: null };
  } catch (e) {
    return { template: null, error: callableErrorMessage(e, 'Unable to update template') };
  }
}

export async function setEmailSmsTemplateStatus(
  id: string,
  status: 'Active' | 'Inactive',
  meta: EmailSmsTemplateAuditMeta,
  changeReason = '',
): Promise<{ success: boolean; error?: string }> {
  try {
    const reason = changeReason || `${status === 'Active' ? 'Activated' : 'Deactivated'} by ${meta.userName}`;
    const fn = httpsCallable(getFirebaseFunctions(), 'setAdminEmailSmsTemplateStatus');
    await fn({ id, status, changeReason: reason });
    return { success: true };
  } catch (e) {
    return { success: false, error: callableErrorMessage(e, 'Unable to update status') };
  }
}

export async function transitionEmailSmsTemplate(
  id: string,
  approvalStatus: string,
  meta: EmailSmsTemplateAuditMeta,
  changeReason = '',
): Promise<{ success: boolean; error?: string }> {
  try {
    const reason = changeReason || `Transition to ${approvalStatus} by ${meta.userName}`;
    const fn = httpsCallable(getFirebaseFunctions(), 'transitionAdminEmailSmsTemplate');
    await fn({ id, approvalStatus, changeReason: reason });
    return { success: true };
  } catch (e) {
    return { success: false, error: callableErrorMessage(e, 'Unable to transition template') };
  }
}

export async function softDeleteEmailSmsTemplate(
  id: string,
  meta: EmailSmsTemplateAuditMeta,
  changeReason = '',
): Promise<{ success: boolean; error?: string }> {
  try {
    const reason = changeReason || `Soft-deleted by ${meta.userName}`;
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminEmailSmsTemplate');
    await fn({ id, changeReason: reason });
    return { success: true };
  } catch (e) {
    return { success: false, error: callableErrorMessage(e, 'Unable to delete template') };
  }
}

export async function seedDefaultEmailSmsTemplates(
  meta: EmailSmsTemplateAuditMeta,
): Promise<{ created: number; skipped: number }> {
  try {
    const fn = httpsCallable<
      { changeReason: string },
      { created: number; skipped: number }
    >(getFirebaseFunctions(), 'seedAdminEmailSmsTemplates');
    const result = await fn({ changeReason: `Seeded by ${meta.userName}` });
    return { created: result.data.created || 0, skipped: result.data.skipped || 0 };
  } catch {
    return { created: 0, skipped: 0 };
  }
}

export function previewTemplateLocally(
  template: Partial<EmailSmsTemplate>,
  vars?: Record<string, string>,
): { subject: string; body: string; smsBody: string; smsLength: number } {
  const sample: Record<string, string> = {
    UserName: 'Jane Doe',
    EmployeeName: 'Jane Doe',
    EmployeeID: 'EMP-1001',
    Department: 'QA',
    Designation: 'QA Executive',
    Company: 'SkyMap Pharma',
    Site: 'HMF Plant',
    DocumentNo: 'DOC-2026-0001',
    DocumentTitle: 'SOP Example',
    DocumentVersion: '01',
    BatchNumber: 'BTH-2026-0042',
    ProductName: 'Amoxicillin 500mg',
    WorkflowName: 'CAPA Approval',
    ApprovalLevel: 'Level 2',
    Approver: 'Head QA',
    Reviewer: 'QA Manager',
    DueDate: '2026-08-15',
    EffectiveDate: '2026-07-01',
    CAPANumber: 'CAPA-2026-0012',
    DeviationNumber: 'DEV-2026-0008',
    ChangeControlNumber: 'CC-2026-0003',
    AuditNumber: 'AUD-2026-0001',
    EquipmentID: 'EQ-HPLC-01',
    CalibrationDue: '2026-09-01',
    moduleName: template.module || 'CAPA',
    eventName: 'Due Soon',
    status: 'Open',
    assignedTo: 'QA Executive',
    createdBy: 'Admin User',
    documentNumber: 'DOC-2026-0001',
    SystemURL: 'https://skymap.example',
    CurrentDate: new Date().toISOString().slice(0, 10),
    CurrentTime: new Date().toISOString().slice(11, 19),
    ...vars,
  };
  const subject = applyTemplateVariables(template.subject || '', sample);
  const body = applyTemplateVariables(template.body || '', sample);
  const smsBody = applyTemplateVariables(template.smsBody || template.body || '', sample);
  return { subject, body, smsBody, smsLength: smsBody.length };
}

export async function previewEmailSmsTemplateRemote(
  id: string,
  logTest = false,
): Promise<{ subject: string; body: string; smsBody: string; smsLength: number; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'previewAdminEmailSmsTemplate');
    const result = await fn({ id, logTest, changeReason: logTest ? 'Template test send' : 'Preview' });
    const data = result.data as { subject: string; body: string; smsBody: string; smsLength: number };
    return data;
  } catch (e) {
    return { subject: '', body: '', smsBody: '', smsLength: 0, error: callableErrorMessage(e, 'Preview failed') };
  }
}

export async function resolveEmailSmsTemplate(payload: {
  templateCode?: string;
  module?: string;
  templateType?: string;
  variables?: Record<string, string>;
}) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'resolveAdminEmailSmsTemplate');
    const result = await fn(payload);
    return { data: result.data as Record<string, unknown>, error: null as string | null };
  } catch (e) {
    return { data: null, error: callableErrorMessage(e, 'Unable to resolve template') };
  }
}

export function exportEmailSmsTemplatesCsv(templates: EmailSmsTemplate[]): string {
  const headers = [
    'Code', 'Name', 'Type', 'Category', 'Module', 'Language', 'Approval', 'Status', 'Version', 'Subject',
  ];
  const rows = templates.map((t) => [
    t.templateCode, t.templateName, t.templateType, t.category, t.module,
    t.language, t.approvalStatus, t.status, t.version, t.subject,
  ].map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
  return `\uFEFF${[headers.join(','), ...rows].join('\n')}`;
}

export async function logEmailSmsTemplatesExport(
  meta: EmailSmsTemplateAuditMeta,
  count: number,
): Promise<void> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminEmailSmsTemplatesExport');
    await fn({ format: 'CSV', count, userName: meta.userName });
  } catch (error) {
    console.error('EMAIL_SMS_TEMPLATES_FAILURE: export log', error);
  }
}

export function knownPlaceholderList(): string[] {
  return [...TEMPLATE_PLACEHOLDERS];
}

export function templateToFormData(t: EmailSmsTemplate): Partial<EmailSmsTemplateFormData> {
  return {
    templateCode: t.templateCode,
    templateName: t.templateName,
    description: t.description || '',
    category: t.category || 'General',
    module: t.module || '',
    subModule: t.subModule || '',
    workflow: t.workflow || '',
    templateType: t.templateType,
    subject: t.subject || '',
    body: t.body || '',
    smsBody: t.smsBody || '',
    isHtml: t.isHtml || false,
    variables: t.variables || (t.placeholders || []).join(', '),
    priority: t.priority || 'Medium',
    language: t.language || 'en',
    company: t.company || '',
    businessUnit: t.businessUnit || '',
    site: t.site || '',
    department: t.department || '',
    effectiveDate: t.effectiveDate || '',
    reviewDate: t.reviewDate || '',
    expiryDate: t.expiryDate || '',
    approvalStatus: t.approvalStatus || 'Draft',
    remarks: t.remarks || '',
    changeReason: '',
  };
}
