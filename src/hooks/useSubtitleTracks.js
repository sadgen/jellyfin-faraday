import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getDefaultSubtitleIndex } from '../utils/subtitleHelper';
import {
  getDefaultSubtitle,
  subscribeSubtitleDefaultChanges,
  syncSubtitleDefaultsWithServer
} from '../utils/subtitleDefaults';

/**
 * 过滤出可渲染的文本字幕流（排除 PGS / DVD / DVB 等图像字幕，
 * 它们无法以 <track> WebVTT 形式挂载）
 */
export function filterTextSubtitleStreams(streams = []) {
  return (streams || []).filter(s =>
    s &&
    s.Type === 'Subtitle' &&
    !['pgssub', 'dvdsub', 'dvbsub'].includes(String(s.Codec || '').toLowerCase())
  );
}

/**
 * 共享字幕流管理 Hook：
 * - 从 PlaybackInfo / item 提取文本字幕流
 * - 默认选轨：用户显式指定的默认轨（subtitleDefaults，全设备同步）优先，
 *   否则按硬字幕识别 + IsDefault/中文优先启发式
 * - 将选中状态同步到 video.textTracks（选中 hidden，由 SubtitleOverlay 接管渲染）
 */
export function useSubtitleTracks({ item, playbackData, videoRef }) {
  const mediaSource = playbackData?.MediaSources?.[0] || item?.MediaSources?.[0];
  const mediaSourceId = mediaSource?.Id || item?.Id;

  const subtitleStreams = useMemo(() => {
    const streams = mediaSource?.MediaStreams || playbackData?.MediaStreams || item?.MediaStreams || [];
    return filterTextSubtitleStreams(streams);
  }, [mediaSource, playbackData, item]);

  const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState(-1);

  // 默认轨指纹：本地缓存秒读（无闪断），挂载时与服务端 KV 校正一次
  // （同账号其他端改过默认轨也能对齐），并订阅跨端变更广播
  const [storedDefault, setStoredDefault] = useState(() => getDefaultSubtitle(item?.Id));
  useEffect(() => {
    let cancelled = false;
    setStoredDefault(getDefaultSubtitle(item?.Id));
    syncSubtitleDefaultsWithServer()
      .then(map => { if (!cancelled) setStoredDefault((item?.Id && map?.[item.Id]) || null); })
      .catch(() => {});
    const unsub = subscribeSubtitleDefaultChanges(() => {
      setStoredDefault(getDefaultSubtitle(item?.Id));
    });
    return () => { cancelled = true; unsub(); };
  }, [item?.Id]);

  // 用户显式选轨标记：SubtitleModal 下载后回传的选轨、手动切轨、关闭字幕都算。
  // 显式选择一旦发生，后续 playbackData 更新不再覆盖它。
  const userSelectedRef = useRef(false);
  const selectSubtitle = useCallback((index) => {
    userSelectedRef.current = true;
    setSelectedSubtitleIndex(Number.isFinite(index) ? index : -1);
  }, []);

  // 换片（同一播放面播下一集等）重置显式选择标记，让新片重新应用默认轨
  useEffect(() => {
    userSelectedRef.current = false;
  }, [item?.Id]);

  // 默认选轨：流首次非空（或默认轨指纹跨端更新且用户尚未显式选择）时应用。
  // 注意不能在每次 playbackData 更新时重算——下载新字幕回传的显式选轨会被打回。
  useEffect(() => {
    if (userSelectedRef.current || subtitleStreams.length === 0) return;
    setSelectedSubtitleIndex(getDefaultSubtitleIndex(item, subtitleStreams, storedDefault));
  }, [item, subtitleStreams, storedDefault]);

  // 将选择同步到 video 内的 <track> 元素（通过 data-index 精确映射，不依赖 DOM 顺序）
  // 选中轨使用 hidden 模式：cue 照常加载，但不原生渲染——由 SubtitleOverlay 覆盖层
  // 按字幕样式（字号/颜色/描边/背景/延迟补偿）接管渲染
  const syncSubtitleModes = useCallback(() => {
    const video = videoRef?.current;
    if (!video || !video.querySelectorAll) return;
    const trackEls = video.querySelectorAll('track[data-index]');
    trackEls.forEach(el => {
      const textTrack = el.track;
      if (!textTrack) return;
      // 统一 hidden：cue 照常加载但不原生渲染，选中轨由 SubtitleOverlay 按样式接管
      textTrack.mode = 'hidden';
    });
  }, [selectedSubtitleIndex, videoRef]);

  useEffect(() => {
    syncSubtitleModes();
  }, [syncSubtitleModes, subtitleStreams]);

  return {
    subtitleStreams,
    mediaSourceId,
    selectedSubtitleIndex,
    selectSubtitle,
    setSelectedSubtitleIndex,
    syncSubtitleModes
  };
}
