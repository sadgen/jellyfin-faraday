import { useState, useEffect, useRef, useCallback } from 'react';

export const SLEEP_TIMER_OPTIONS = [
  { minutes: 15, label: '15 分钟' },
  { minutes: 30, label: '30 分钟' },
  { minutes: 45, label: '45 分钟' },
  { minutes: 60, label: '60 分钟' },
  { minutes: 90, label: '90 分钟' }
];

/**
 * 睡眠定时器 Hook：倒计时结束后触发回调（通常为暂停播放）。
 * 供影院播放器 / VR 播放器 / 浮动窗口共用。
 */
export function useSleepTimer() {
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const deadlineRef = useRef(null);
  const timerRef = useRef(null);

  const stop = useCallback(() => {
    deadlineRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRemainingSeconds(0);
  }, []);

  const start = useCallback((minutes, onExpire) => {
    stop();
    if (!minutes || minutes <= 0) return;
    deadlineRef.current = Date.now() + minutes * 60 * 1000;
    setRemainingSeconds(minutes * 60);
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        stop();
        if (typeof onExpire === 'function') onExpire();
      }
    }, 1000);
  }, [stop]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  return {
    remainingSeconds,
    isActive: remainingSeconds > 0,
    start,
    stop
  };
}
