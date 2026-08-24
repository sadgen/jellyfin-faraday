/**
 * Global default playback settings (Stream Quality, Playback Speed, Pinned Poster PIP, Auto Refill)
 */

export const QUALITY_OPTIONS = [
  { id: 'direct', label: '原画直出 (无损)', shortLabel: '原画' },
  { id: '8000000', label: '8 Mbps (1080p 高清)', shortLabel: '8M' },
  { id: '4000000', label: '4 Mbps (720p 标清)', shortLabel: '4M' },
  { id: '2000000', label: '2 Mbps (480p 流畅)', shortLabel: '2M' },
  { id: '1000000', label: '1 Mbps (极速低码率)', shortLabel: '1M' }
];

export const SPEED_PRESETS = [0.75, 1.0, 1.25, 1.5, 2.0];

const STORAGE_KEY = 'faraday_playback_defaults';

export function getPlaybackDefaults() {
  if (typeof window === 'undefined') {
    return {
      quality: 'direct',
      speed: 1.0,
      showPinnedPoster: true,
      autoRefill: false
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
        autoRefill: !!parsed.autoRefill
      };
    }
  } catch (_) {}
  return {
    quality: 'direct',
    speed: 1.0,
    showPinnedPoster: true,
    autoRefill: false
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
