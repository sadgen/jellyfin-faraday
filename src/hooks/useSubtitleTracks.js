import { useState, useEffect, useCallback, useMemo } from 'react';
import { getDefaultSubtitleIndex } from '../utils/subtitleHelper';

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
 * - 依据硬字幕识别 + IsDefault/中文优先自动选择默认字幕
 * - 将选中状态同步到 video.textTracks（选中 showing，其余 hidden）
 */
export function useSubtitleTracks({ item, playbackData, videoRef }) {
  const mediaSource = playbackData?.MediaSources?.[0] || item?.MediaSources?.[0];
  const mediaSourceId = mediaSource?.Id || item?.Id;

  const subtitleStreams = useMemo(() => {
    const streams = mediaSource?.MediaStreams || playbackData?.MediaStreams || item?.MediaStreams || [];
    return filterTextSubtitleStreams(streams);
  }, [mediaSource, playbackData, item]);

  const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState(-1);

  // 默认字幕：硬字幕（文件名含 -C / UC / 中文字幕 等）时不自动挂载，避免双字幕
  useEffect(() => {
    if (subtitleStreams.length > 0) {
      setSelectedSubtitleIndex(getDefaultSubtitleIndex(item, subtitleStreams));
    } else {
      setSelectedSubtitleIndex(-1);
    }
  }, [item, subtitleStreams]);

  // 将选择同步到 video 内的 <track> 元素（通过 data-index 精确映射，不依赖 DOM 顺序）
  const syncSubtitleModes = useCallback(() => {
    const video = videoRef?.current;
    if (!video || !video.querySelectorAll) return;
    const trackEls = video.querySelectorAll('track[data-index]');
    trackEls.forEach(el => {
      const textTrack = el.track;
      if (!textTrack) return;
      const streamIndex = Number(el.getAttribute('data-index'));
      textTrack.mode =
        selectedSubtitleIndex !== -1 && streamIndex === selectedSubtitleIndex
          ? 'showing'
          : 'hidden';
    });
  }, [selectedSubtitleIndex, videoRef]);

  useEffect(() => {
    syncSubtitleModes();
  }, [syncSubtitleModes, subtitleStreams]);

  const selectSubtitle = useCallback((index) => {
    setSelectedSubtitleIndex(Number.isFinite(index) ? index : -1);
  }, []);

  return {
    subtitleStreams,
    mediaSourceId,
    selectedSubtitleIndex,
    selectSubtitle,
    setSelectedSubtitleIndex,
    syncSubtitleModes
  };
}
