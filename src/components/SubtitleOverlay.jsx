import { useEffect, useState } from 'react';
import { getSubtitleStyle, outlineToShadow, bgToCss, SUBTITLE_STYLE_EVENT } from '../utils/subtitleStyle';

/**
 * 自定义字幕渲染层（影院 / 浮窗 / VR 共用）：
 * - 选中字幕轨由 useSubtitleTracks 置为 hidden 模式（加载 cue 但不原生渲染），
 *   本层按视频时间 + delaySec 偏移过滤活跃 Cue 并渲染，实现完整外观自定义
 *   （字号 / 颜色 / 描边 / 背景 / 延迟补偿），原生 <track> 无法做到这些。
 * - selectedSubtitleIndex 未传时（旧 VR 用法）回退：渲染 mode==='showing' 的轨。
 */
export default function SubtitleOverlay({ videoRef, visible = true, selectedSubtitleIndex }) {
  const [cueText, setCueText] = useState('');
  const [style, setStyle] = useState(() => getSubtitleStyle());
  const [containerH, setContainerH] = useState(0);

  // 样式变更即时生效（跨组件经事件广播：字幕设置弹窗 / 其他播放器实例）
  useEffect(() => {
    const handle = (e) => {
      if (e.detail) setStyle(e.detail);
    };
    window.addEventListener(SUBTITLE_STYLE_EVENT, handle);
    return () => window.removeEventListener(SUBTITLE_STYLE_EVENT, handle);
  }, []);

  // 跟随容器高度计算基准字号（窗口缩放 / 布局切换时自适应）
  useEffect(() => {
    const measure = () => {
      const video = videoRef?.current;
      if (video) setContainerH(video.clientHeight || 0);
    };
    measure();
    window.addEventListener('resize', measure);
    const interval = setInterval(measure, 1000);
    return () => {
      window.removeEventListener('resize', measure);
      clearInterval(interval);
    };
  }, [videoRef]);

  useEffect(() => {
    const video = videoRef?.current;
    if (!video) return;

    // 定位选中字幕轨的 TextTrack：
    // - 传入了 selectedSubtitleIndex：经 <track data-index> 精确映射
    // - 未传（旧 VR 用法）：回退到 mode==='showing' 的轨
    const findSelectedTrack = () => {
      if (typeof selectedSubtitleIndex === 'number' && selectedSubtitleIndex !== -1) {
        const el = Array.from(video.querySelectorAll('track[data-index]') || [])
          .find(t => Number(t.getAttribute('data-index')) === selectedSubtitleIndex);
        return el?.track || null;
      }
      return Array.from(video.textTracks || []).find(t => t.mode === 'showing') || null;
    };

    const update = () => {
      const track = findSelectedTrack();
      const cues = track?.cues;
      if (!track || !cues || cues.length === 0) {
        setCueText('');
        return;
      }
      const delay = Number(style.delaySec) || 0;
      const t = (video.currentTime || 0) - delay;
      let text = '';
      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        if (t >= cue.startTime && t < cue.endTime && cue.text) {
          text += (text ? '\n' : '') + cue.text.replace(/<[^>]+>/g, '').trim();
        }
      }
      setCueText(text);
    };

    // timeupdate 驱动（~4/s，字幕粒度足够），低频轮询兜底 cue 异步加载与换轨
    // 注意：不使用 requestAnimationFrame 防抖——后台/节流场景下 rAF 可能长期不触发
    video.addEventListener('timeupdate', update);
    video.addEventListener('seeked', update);
    update();
    const interval = setInterval(update, 500);

    return () => {
      video.removeEventListener('timeupdate', update);
      video.removeEventListener('seeked', update);
      clearInterval(interval);
    };
  }, [videoRef, selectedSubtitleIndex, style.delaySec]);

  if (!visible || !cueText) return null;

  const fontSize = Math.max(11, Math.round(Math.max(containerH, 200) * 0.052 * (style.scale || 1)));

  return (
    <div className="absolute inset-x-0 bottom-[6%] z-30 flex justify-center pointer-events-none px-6">
      <div
        className="max-w-[92%] whitespace-pre-line text-center leading-snug font-medium rounded-md px-3 py-1"
        style={{
          color: style.color,
          fontSize: `${fontSize}px`,
          textShadow: outlineToShadow(style.outline),
          background: bgToCss(style.bg)
        }}
      >
        {cueText}
      </div>
    </div>
  );
}
