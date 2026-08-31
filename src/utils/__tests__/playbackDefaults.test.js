import { describe, it, expect, beforeEach } from 'vitest';
import { getPlaybackDefaults, setPlaybackDefaults, QUALITY_OPTIONS, SPEED_PRESETS } from '../playbackDefaults';

describe('playbackDefaults preferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('provides sensible defaults on fresh start', () => {
    const defaults = getPlaybackDefaults();
    expect(defaults.quality).toBe('direct');
    expect(defaults.speed).toBe(1.0);
    expect(defaults.showPinnedPoster).toBe(true);
    expect(defaults.autoRefill).toBe(false);
    expect(defaults.smartStart).toBe(false);
    expect(defaults.patrolMode).toBe(false);
    expect(defaults.patrolIntervalSeconds).toBe(45);
  });

  it('updates preferences and persists to localStorage', () => {
    const updated = setPlaybackDefaults({
      quality: '4000000',
      speed: 1.5,
      showPinnedPoster: false,
      autoRefill: true,
      smartStart: true,
      patrolMode: true,
      patrolIntervalSeconds: 60
    });

    expect(updated.quality).toBe('4000000');
    expect(updated.speed).toBe(1.5);
    expect(updated.showPinnedPoster).toBe(false);
    expect(updated.autoRefill).toBe(true);
    expect(updated.smartStart).toBe(true);
    expect(updated.patrolMode).toBe(true);
    expect(updated.patrolIntervalSeconds).toBe(60);

    const reloaded = getPlaybackDefaults();
    expect(reloaded.quality).toBe('4000000');
    expect(reloaded.speed).toBe(1.5);
    expect(reloaded.smartStart).toBe(true);
    expect(reloaded.patrolMode).toBe(true);
    expect(reloaded.patrolIntervalSeconds).toBe(60);
  });

  it('has valid quality options and speed presets', () => {
    expect(QUALITY_OPTIONS.length).toBeGreaterThanOrEqual(4);
    expect(SPEED_PRESETS).toContain(1.0);
    expect(SPEED_PRESETS).toContain(1.5);
  });
});
