const STORAGE_KEY = 'skymap-recent-modules';
const FAVORITES_KEY = 'skymap-favorite-modules';
const MAX_RECENT = 6;

export function getRecentModules(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function addRecentModule(moduleId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getRecentModules().filter((id) => id !== moduleId);
    const updated = [moduleId, ...current].slice(0, MAX_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore storage errors
  }
}

export function getFavoriteModules(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function toggleFavoriteModule(moduleId: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const current = getFavoriteModules();
    const updated = current.includes(moduleId)
      ? current.filter((id) => id !== moduleId)
      : [...current, moduleId];
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return getFavoriteModules();
  }
}
