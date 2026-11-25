export const STORAGE_KEY = 'ruido_ambiental_cache_v7';

const LEGACY_STORAGE_KEYS = [
  'ruido_ambiental_cache_v6',
  'ruido_ambiental_cache_v5'
];

export interface CacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => cloneValue(item)) as T;
  }
  if (isRecord(value)) {
    const clone: Record<string, unknown> = {};
    Object.keys(value).forEach(key => {
      if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
        clone[key] = cloneValue(value[key]);
      }
    });
    return clone as T;
  }
  return value;
}

export function mergeWithDefaults<T>(defaults: T, stored: unknown): T {
  if (isRecord(defaults)) {
    if (!isRecord(stored)) return cloneValue(defaults);

    const merged = cloneValue(defaults) as Record<string, unknown>;
    Object.keys(stored).forEach(key => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
      const storedValue = stored[key];
      merged[key] = mergeWithDefaults(merged[key], storedValue);
    });
    return merged as T;
  }

  if (Array.isArray(defaults)) {
    return (Array.isArray(stored) ? cloneValue(stored) : cloneValue(defaults)) as T;
  }
  return cloneValue(stored) as T;
}

export function loadCache<T>(
  defaults: T,
  storage: CacheStorage = window.localStorage,
  onError: (error: unknown) => void = error => console.warn('Não foi possível ler as configurações salvas.', error)
): T {
  for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
    try {
      const raw = storage.getItem(key);
      if (!raw) continue;

      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) {
        onError(new TypeError(`Conteúdo inválido na chave ${key}.`));
        continue;
      }
      return mergeWithDefaults(defaults, parsed);
    } catch (error) {
      onError(error);
    }
  }
  return cloneValue(defaults);
}

export function persistCache(
  value: unknown,
  storage: CacheStorage = window.localStorage,
  onError: (error: unknown) => void = error => console.error('Não foi possível salvar as configurações.', error)
): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}
