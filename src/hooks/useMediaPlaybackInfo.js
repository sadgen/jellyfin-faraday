import { useState, useEffect, useCallback, useRef } from 'react';
import { jellyfin } from '../api/jellyfinClient';

/**
 * 拉取并持有条目的 PlaybackInfo（MediaSources / MediaStreams：音轨、字幕、容器信息）。
 * 影院播放器 / VR 播放器 / 浮动窗口共用； Previously 每个播放器各自内联实现。
 */
export function useMediaPlaybackInfo(itemId) {
  const [playbackData, setPlaybackData] = useState(null);
  const reqIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!itemId || !jellyfin.auth.isConfigured) return null;
    const reqId = ++reqIdRef.current;
    try {
      const info = await jellyfin.getItemPlaybackInfo(itemId);
      if (reqId === reqIdRef.current && info) {
        setPlaybackData(info);
      }
      return info;
    } catch {
      return null;
    }
  }, [itemId]);

  useEffect(() => {
    setPlaybackData(null);
    refresh();
  }, [refresh]);

  return { playbackData, setPlaybackData, refresh };
}
