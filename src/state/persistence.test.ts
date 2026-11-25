import { describe, expect, it, vi } from 'vitest';
import { loadCache, mergeWithDefaults, persistCache, STORAGE_KEY, type CacheStorage } from './persistence';
import { captureProfileSettings } from './profiles';

function createStorage(values: Record<string, string> = {}): CacheStorage & { values: Record<string, string> } {
  return {
    values,
    getItem(key) {
      return this.values[key] ?? null;
    },
    setItem(key, value) {
      this.values[key] = value;
    }
  };
}

describe('settings persistence', () => {
  it('snapshots edited sound and equalizer settings without sharing mutable state', () => {
    const profile = { id: 'evening', name: 'Noite', icon: '🌙' };
    const settings = {
      noiseType: 'pink',
      masterVolume: 82,
      volume: 36,
      cutoffFreq: 740,
      polish: 95,
      timerMinutes: 45,
      nature: { rain: { enabled: true, volume: 62, tone: 34 } },
      eqGains: [1, 0, -2, 0, 1, 0]
    };

    const snapshot = captureProfileSettings(profile, settings);
    settings.nature.rain.volume = 10;
    settings.eqGains[0] = 9;

    expect(snapshot).toMatchObject({
      id: 'evening',
      name: 'Noite',
      icon: '🌙',
      noiseType: 'pink',
      masterVolume: 82,
      nature: { rain: { enabled: true, volume: 62, tone: 34 } },
      eqGains: [1, 0, -2, 0, 1, 0]
    });
  });

  it('merges nested settings while replacing saved profile arrays', () => {
    const defaults = {
      settings: { autoPlay: false, runInBackground: true },
      profiles: [{ id: 'default' }]
    };

    expect(mergeWithDefaults(defaults, {
      settings: { autoPlay: true },
      profiles: [{ id: 'custom' }]
    })).toEqual({
      settings: { autoPlay: true, runInBackground: true },
      profiles: [{ id: 'custom' }]
    });
  });

  it('migrates older cache keys and preserves defaults for newly added settings', () => {
    const storage = createStorage({
      'ruido_ambiental_cache_v6': JSON.stringify({ settings: { autoPlay: true } })
    });

    expect(loadCache({ settings: { autoPlay: false, scrollStep: 2 } }, storage))
      .toEqual({ settings: { autoPlay: true, scrollStep: 2 } });
  });

  it('restores saved profiles and per-sound adjustments', () => {
    const storage = createStorage();
    const settings = {
      profiles: [{ id: 'evening', name: 'Noite', nature: { rain: { enabled: true, volume: 68, tone: 35 } } }],
      nature: {
        rain: { enabled: false, volume: 45, tone: 55 },
        customSound: { enabled: true, volume: 72, tone: 24 }
      },
      customSounds: [{ id: 'customSound', name: 'Gravação', sourceType: 'local' }]
    };
    const defaults = {
      profiles: [{ id: 'default' }],
      nature: { rain: { enabled: false, volume: 45, tone: 55 } },
      customSounds: []
    };

    expect(persistCache(settings, storage)).toBe(true);
    expect(loadCache(defaults, storage)).toEqual({
      profiles: settings.profiles,
      nature: settings.nature,
      customSounds: settings.customSounds
    });
  });

  it('skips malformed cache data and falls back to defaults', () => {
    const storage = createStorage({ [STORAGE_KEY]: '{broken' });
    const onError = vi.fn();

    expect(loadCache({ volume: 35 }, storage, onError)).toEqual({ volume: 35 });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('writes the current settings key and reports storage failures', () => {
    const storage = createStorage();
    expect(persistCache({ volume: 42 }, storage)).toBe(true);
    expect(JSON.parse(storage.values[STORAGE_KEY])).toEqual({ volume: 42 });

    const failingStorage: CacheStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota exceeded'); }
    };
    const onError = vi.fn();

    expect(persistCache({}, failingStorage, onError)).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });
});
