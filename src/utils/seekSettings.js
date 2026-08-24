/**
 * 快进快退速度与寻轨步长配置（慢档 5s / 中档 15s / 快档 30s，默认中档）
 */

export const SEEK_SPEED_OPTIONS = [
  { id: 'slow', label: '慢档 (5秒)', shortLabel: '5s', stepSeconds: 5, swipeSpan: 45 },
  { id: 'medium', label: '中档 (15秒, 默认)', shortLabel: '15s', stepSeconds: 15, swipeSpan: 90 },
  { id: 'fast', label: '快档 (30秒)', shortLabel: '30s', stepSeconds: 30, swipeSpan: 180 }
];

export function getStoredSeekSpeed() {
  if (typeof window === 'undefined') return 'medium';
  const stored = localStorage.getItem('faraday_seek_speed');
  if (stored && SEEK_SPEED_OPTIONS.some(o => o.id === stored)) {
    return stored;
  }
  return 'medium';
}

export function setStoredSeekSpeed(speedId) {
  if (typeof window === 'undefined') return;
  const validId = SEEK_SPEED_OPTIONS.some(o => o.id === speedId) ? speedId : 'medium';
  localStorage.setItem('faraday_seek_speed', validId);
  if (typeof window.CustomEvent === 'function') {
    window.dispatchEvent(new window.CustomEvent('faraday:seek_speed_changed', { detail: validId }));
  }
}

export function getSeekStepSeconds(speedId = null) {
  const currentId = speedId || getStoredSeekSpeed();
  const option = SEEK_SPEED_OPTIONS.find(o => o.id === currentId);
  return option ? option.stepSeconds : 15;
}

export function getSeekSwipeSpan(speedId = null) {
  const currentId = speedId || getStoredSeekSpeed();
  const option = SEEK_SPEED_OPTIONS.find(o => o.id === currentId);
  return option ? option.swipeSpan : 90;
}
