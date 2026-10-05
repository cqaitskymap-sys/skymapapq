/** Shared QMS record guards. Closed records stay immutable except a controlled reopen. */

const CLOSED = 'closed';

export function localCalendarDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const next = new Date(year, (month || 1) - 1, day || 1);
  next.setDate(next.getDate() + days);
  return localCalendarDate(next);
}

export function isClosedStatus(status?: string | null): boolean {
  return (status || '').trim().toLowerCase() === CLOSED;
}

/** Formal CAPA closure. Approval is not closure. */
export function isFormallyClosedCapa(status?: string | null): boolean {
  return isClosedStatus(status);
}

/** Mandatory effectiveness is satisfied only by Effective or an explicit N/A. */
export function isAcceptableEffectiveness(result?: string | null, required?: boolean): boolean {
  if (!required) return true;
  return result === 'Effective' || result === 'N/A';
}

export function assertRecordMutable(
  status: string | undefined | null,
  options?: { reopen?: boolean },
  label = 'record',
): void {
  if (!isClosedStatus(status)) return;
  if (options?.reopen) return;
  throw new Error(`Closed ${label} cannot be modified. Use the controlled reopen workflow.`);
}

/** Firestore updateDoc rejects undefined. Drop those keys before write. */
export function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as T;
}
