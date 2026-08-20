export type ScreenField = {
  label: string;
  required: boolean;
  control: string;
  hint: string;
};

const SKIP_LABELS = new Set([
  'search',
  'search modules and workflows…',
  'search modules, workflows…',
  'search modules…',
  'open navigation menu',
  'how to use',
  'how to use this screen',
]);

function cleanText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').replace(/\*$/, '').trim();
}

function controlType(el: Element | null): string {
  if (!el) return 'field';
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'dropdown';
  if (tag === 'button' && el.getAttribute('role') === 'combobox') return 'dropdown';
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type || 'text';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'choice';
    if (type === 'date' || type === 'datetime-local') return 'date';
    if (type === 'file') return 'file';
    if (type === 'number') return 'number';
    return 'text';
  }
  if (el.getAttribute('role') === 'combobox') return 'dropdown';
  return tag;
}

function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest('[data-guide-coach="true"]')) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function fieldFromControl(control: Element, labelText: string): ScreenField | null {
  const label = cleanText(labelText);
  if (!label || label.length < 2 || label.length > 80) return null;
  if (SKIP_LABELS.has(label.toLowerCase())) return null;
  if (/^sky?map$/i.test(label)) return null;

  const required =
    control.hasAttribute('required')
    || control.getAttribute('aria-required') === 'true'
    || /\*/.test(labelText)
    || Boolean(control.closest('[aria-required="true"]'));

  const hint = cleanText(
    control.getAttribute('placeholder')
    || control.getAttribute('aria-description')
    || '',
  );

  return {
    label,
    required,
    control: controlType(control),
    hint: hint.slice(0, 120),
  };
}

/** Collect labels of visible form fields. Does not send entered values. */
export function collectScreenFields(): ScreenField[] {
  if (typeof document === 'undefined') return [];
  const root = document.querySelector('main') || document.body;
  const seen = new Set<string>();
  const fields: ScreenField[] = [];

  const push = (field: ScreenField | null) => {
    if (!field) return;
    const key = field.label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    fields.push(field);
  };

  root.querySelectorAll('label').forEach((label) => {
    if (!isVisible(label)) return;
    const forId = label.getAttribute('for');
    const control = forId
      ? document.getElementById(forId)
      : label.querySelector('input, textarea, select, [role="combobox"]');
    if (!control || !isVisible(control)) {
      const text = cleanText(label.textContent);
      if (text) push({ label: text.replace(/\*$/, '').trim(), required: /\*/.test(label.textContent || ''), control: 'field', hint: '' });
      return;
    }
    push(fieldFromControl(control, label.textContent || control.getAttribute('aria-label') || ''));
  });

  root.querySelectorAll('input, textarea, select, [role="combobox"]').forEach((control) => {
    if (!isVisible(control)) return;
    const named = cleanText(
      control.getAttribute('aria-label')
      || control.getAttribute('placeholder')
      || (control as HTMLInputElement).name,
    );
    if (!named) return;
    push(fieldFromControl(control, named));
  });

  return fields.slice(0, 40);
}

export function resolveFieldFromElement(target: EventTarget | null): ScreenField | null {
  if (!(target instanceof Element)) return null;
  if (target.closest('[data-guide-coach="true"]')) return null;
  if (!target.closest('main')) return null;
  const control = target.closest('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select, [role="combobox"]');
  if (!control || !isVisible(control)) return null;

  const id = control.getAttribute('id');
  let labelled: Element | null = null;
  if (id) {
    try {
      labelled = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    } catch {
      labelled = document.querySelector(`label[for="${id.replace(/"/g, '')}"]`);
    }
  }
  const label = labelled || control.closest('label');
  const text =
    (label?.textContent || '')
    || control.getAttribute('aria-label')
    || control.getAttribute('placeholder')
    || '';
  return fieldFromControl(control, text);
}

export const COMMON_FIELD_HINTS: Array<{ match: RegExp; why: string; enter: string }> = [
  { match: /batch/i, why: 'The record must be traceable to a manufactured lot for GMP and recall.', enter: 'Select the registered batch number. Do not type a number that is not in master data.' },
  { match: /product/i, why: 'Quality events and CPV/PQR are product-scoped.', enter: 'Choose the product from master data (code / name / strength).' },
  { match: /site|location|plant/i, why: 'Records are site-scoped for permissions, numbering, and inspections.', enter: 'Select your manufacturing / QC site from the list.' },
  { match: /department|area/i, why: 'Routes the workflow to the right owners and approval matrix.', enter: 'Pick the department where the event occurred or the action belongs.' },
  { match: /date|time/i, why: 'ALCOA+ requires when the event happened, not when it was typed.', enter: 'Enter the actual occurrence / sample / effective date. Do not back-date without a documented reason.' },
  { match: /reason|justification|comment|remark/i, why: 'Regulated actions need a contemporaneous reason for the audit trail.', enter: 'Write a factual reason. Do not copy passwords or speculate missing data.' },
  { match: /description|details|observation|narrative/i, why: 'The investigation and later PQR/CPV reviews need a clear fact record.', enter: 'Describe what was seen, where, and immediate action. Facts only.' },
  { match: /root cause|rca|5-?why/i, why: 'CAPA and deviation closure are invalid without a cause.', enter: 'State the confirmed cause after investigation — not a guess.' },
  { match: /severity|critical|priority|class/i, why: 'Drives due dates, notification, and whether recall/hold is assessed.', enter: 'Use the SOP scale (e.g. Critical / Major / Minor). If unsure, choose the higher class and ask QA.' },
  { match: /attachment|upload|file|evidence/i, why: 'Evidence supports the e-signed conclusion.', enter: 'Attach allowed files (PDF, image, Word/Excel as the screen allows). Do not upload credentials.' },
  { match: /e-?sign|password|pin/i, why: '21 CFR Part 11 meaning: the signature is the legal approval.', enter: 'Use only your own credentials. Never share or enter someone else’s password.' },
  { match: /owner|assigned|responsible/i, why: 'Every GMP action needs a named owner and due date.', enter: 'Select the person who will execute the next step.' },
  { match: /due|target date/i, why: 'Overdue items escalate in notifications and dashboards.', enter: 'Set a realistic date from the SOP / risk class.' },
  { match: /specification|limit|lsl|usl|acceptance/i, why: 'OOS/OOT and CPV capability compare results to approved limits.', enter: 'Use the approved specification from the method / CPV plan — do not invent limits.' },
  { match: /result|value|reading|count/i, why: 'This is the measured data the module will trend and alert on.', enter: 'Enter the instrument / lab value exactly as recorded. Do not round away OOS.' },
  { match: /capa/i, why: 'Shown when the event can recur or already requires systemic action.', enter: 'Link an existing CAPA or create one. Leave blank only if QA disposition says no CAPA.' },
  { match: /impact/i, why: 'QA must know if other batches, patients, or filings are affected.', enter: 'Answer product / process / regulatory impact based on facts from the investigation.' },
];

export function fallbackFieldAnswer(question: string, fieldLabel?: string): string | null {
  const blob = `${fieldLabel || ''} ${question}`;
  const hit = COMMON_FIELD_HINTS.find((h) => h.match.test(blob));
  if (!hit) return null;
  const name = fieldLabel || 'This field';
  return `${name}: ${hit.why}\n\nWhat to enter: ${hit.enter}`;
}
