export interface ProfileSettingsSnapshot {
  noiseType: string;
  masterVolume: number;
  volume: number;
  cutoffFreq: number;
  polish: number;
  timerMinutes: number;
  nature: Record<string, unknown>;
  eqGains: number[];
}

export function captureProfileSettings<TProfile extends Record<string, unknown>>(
  profile: TProfile,
  settings: ProfileSettingsSnapshot
): TProfile & ProfileSettingsSnapshot {
  return {
    ...profile,
    ...settings,
    nature: JSON.parse(JSON.stringify(settings.nature)) as Record<string, unknown>,
    eqGains: settings.eqGains.slice()
  };
}
