/**
 * 安卓壳内播放器竖滑手势配置（左/右半屏各自的功能绑定）。
 * 仅在 Capacitor 壳内由原生消费；配置经 FaradayPlayer.setGestureConfig 推送，
 * 面板改动即时生效并持久化在 localStorage。
 */

const STORAGE_KEY = 'faraday_gesture_settings';

export const GESTURE_ACTIONS = [
  { id: 'brightness', label: '亮度' },
  { id: 'volume', label: '音量' },
  { id: 'speed', label: '倍速' }
];

const VALID = new Set(GESTURE_ACTIONS.map(a => a.id));
const DEFAULTS = { left: 'brightness', right: 'volume' };

export function getGestureSettings() {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        left: VALID.has(parsed.left) ? parsed.left : DEFAULTS.left,
        right: VALID.has(parsed.right) ? parsed.right : DEFAULTS.right
      };
    }
  } catch {}
  return { ...DEFAULTS };
}

export function setGestureSettings(partial) {
  if (typeof window === 'undefined') return;
  const current = getGestureSettings();
  const next = {
    left: VALID.has(partial.left) ? partial.left : current.left,
    right: VALID.has(partial.right) ? partial.right : current.right
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  if (typeof window.CustomEvent === 'function') {
    window.dispatchEvent(new window.CustomEvent('faraday:gesture_settings_changed', { detail: next }));
  }
  return next;
}
