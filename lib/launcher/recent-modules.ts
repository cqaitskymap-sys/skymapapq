const STORAGE_KEY = 'skymap-recent-modules';
const FAVORITES_KEY = 'skymap-favorite-modules';
const MAX_RECENT = 6;
export const MAX_FAVORITE_MODULES = 8;
export const DEFAULT_FAVORITE_MODULES = ['manufacturing', 'qms', 'cpv'];

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
  if (typeof window === 'undefined') return DEFAULT_FAVORITE_MODULES;
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (raw === null) return DEFAULT_FAVORITE_MODULES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : DEFAULT_FAVORITE_MODULES;
  } catch {
    return DEFAULT_FAVORITE_MODULES;
  }
}

export function setFavoriteModules(moduleIds: string[]): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const unique = Array.from(new Set(moduleIds)).slice(0, MAX_FAVORITE_MODULES);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(unique));
    return unique;
  } catch {
    return getFavoriteModules();
  }
}

export function toggleFavoriteModule(moduleId: string): string[] {
  const current = getFavoriteModules();
  if (current.includes(moduleId)) {
    return setFavoriteModules(current.filter((id) => id !== moduleId));
  }
  if (current.length >= MAX_FAVORITE_MODULES) {
    return current;
  }
  return setFavoriteModules([...current, moduleId]);
}
