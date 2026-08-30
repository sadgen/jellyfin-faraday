import { useState, useEffect, useCallback } from 'react';

const VOLUME_STORAGE_KEY = 'faraday_volume';

export function getStoredVolume() {
  if (typeof window === 'undefined') return 1;
  const raw = parseFloat(localStorage.getItem(VOLUME_STORAGE_KEY) || '');
  if (!isNaN(raw) && raw >= 0 && raw <= 1) return raw;
  return 1;
}

/**
 * 播放器音量控制 Hook：音量滑块 + 静音切换 + 音量等级记忆（localStorage）。
 * 真实音量由各播放器通过 reportPlayback({ volumeLevel }) 上报服务器。
 */
export function useVolumeControl(videoRef, { initialMuted = false } = {}) {
  const [volume, setVolumeState] = useState(getStoredVolume);
  const [isMuted, setIsMutedState] = useState(initialMuted);

  // 将音量 / 静音状态同步到 video 元素
  useEffect(() => {
    const video = videoRef?.current;
    if (!video) return;
    video.volume = volume;
    video.muted = isMuted;
  }, [videoRef, volume, isMuted]);

  const setVolume = useCallback((next) => {
    const v = Math.max(0, Math.min(1, Number(next) || 0));
    setVolumeState(v);
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(v));
    } catch {
      // ignore storage errors
    }
    const video = videoRef?.current;
    if (video) {
      video.volume = v;
      if (v > 0 && video.muted) {
        video.muted = false;
        setIsMutedState(false);
      }
    }
  }, [videoRef]);

  const setMuted = useCallback((muted) => {
    setIsMutedState(muted);
    const video = videoRef?.current;
    if (video) video.muted = muted;
  }, [videoRef]);

  const toggleMute = useCallback(() => {
    const video = videoRef?.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsMutedState(nextMuted);
  }, [videoRef]);

  return { volume, setVolume, isMuted, setIsMuted: setMuted, toggleMute };
}
