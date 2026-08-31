/**
 * Global default playback settings (Stream Quality, Playback Speed, Pinned Poster PIP, Auto Refill, Smart Start, Patrol Mode)
 */

// 画质 / 倍速档位统一从 qualityPresets 引用并转发（历史导入路径兼容）
export { QUALITY_OPTIONS, SPEED_PRESETS, PLAYBACK_SPEED_OPTIONS } from './qualityPresets';

const STORAGE_KEY = 'faraday_playback_defaults';

export const PATROL_INTERVALS = [30, 45, 60, 90];

export function getPlaybackDefaults() {
  if (typeof window === 'undefined') {
    return {
      quality: 'direct',
      speed: 1.0,
      showPinnedPoster: true,
      autoRefill: false,
      smartStart: false,
      patrolMode: false,
      patrolIntervalSeconds: 45
    };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        quality: parsed.quality || 'direct',
        speed: typeof parsed.speed === 'number' ? parsed.speed : 1.0,
        showPinnedPoster: parsed.showPinnedPoster !== undefined ? !!parsed.showPinnedPoster : true,
        autoRefill: !!parsed.autoRefill,
        smartStart: !!parsed.smartStart,
        patrolMode: !!parsed.patrolMode,
        patrolIntervalSeconds: Number(parsed.patrolIntervalSeconds) || 45
      };
    }
  } catch {}
  return {
    quality: 'direct',
    speed: 1.0,
    showPinnedPoster: true,
    autoRefill: false,
    smartStart: false,
    patrolMode: false,
    patrolIntervalSeconds: 45
  };
}

export function setPlaybackDefaults(partial) {
  if (typeof window === 'undefined') return;
  const current = getPlaybackDefaults();
  const next = { ...current, ...partial };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  if (typeof window.CustomEvent === 'function') {
    window.dispatchEvent(new window.CustomEvent('faraday:playback_defaults_changed', { detail: next }));
  }
  return next;
}
