import { describe, it, expect } from 'vitest';
import { QUALITY_OPTIONS, PLAYBACK_SPEED_OPTIONS, SPEED_PRESETS, TOUCH_SPEED_STEPS } from '../qualityPresets';
import { QUALITY_OPTIONS as RE_EXPORTED_QUALITY, SPEED_PRESETS as RE_EXPORTED_SPEED } from '../playbackDefaults';

describe('qualityPresets single source of truth', () => {
  it('quality ids are unique and bitrate tiers descend', () => {
    const ids = QUALITY_OPTIONS.map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);

    const bitrates = QUALITY_OPTIONS.filter(q => q.bitrate > 0).map(q => q.bitrate);
    for (let i = 1; i < bitrates.length; i++) {
      expect(bitrates[i - 1]).toBeGreaterThan(bitrates[i]);
    }
  });

  it('speed options are ascending and cover presets & touch steps', () => {
    for (let i = 1; i < PLAYBACK_SPEED_OPTIONS.length; i++) {
      expect(PLAYBACK_SPEED_OPTIONS[i]).toBeGreaterThan(PLAYBACK_SPEED_OPTIONS[i - 1]);
    }
    SPEED_PRESETS.forEach(s => expect(PLAYBACK_SPEED_OPTIONS).toContain(s));
    TOUCH_SPEED_STEPS.forEach(s => expect(PLAYBACK_SPEED_OPTIONS).toContain(s));
  });

  it('playbackDefaults re-exports the same constants (backward-compatible import path)', () => {
    expect(RE_EXPORTED_QUALITY).toBe(QUALITY_OPTIONS);
    expect(RE_EXPORTED_SPEED).toBe(SPEED_PRESETS);
  });
});
