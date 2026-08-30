import { useEffect, useState } from 'react';

/**
 * 字幕文本覆盖层：用于视频元素被 WebGL Canvas 遮挡（VR 模式）时
 * 显示当前激活字幕 Cue。直接监听 video.textTracks 的 cuechange 事件。
 */
export default function SubtitleOverlay({ videoRef, visible = true }) {
  const [cueText, setCueText] = useState('');

  useEffect(() => {
    const video = videoRef?.current;
    if (!video) return;

    const handleCueChange = () => {
      let text = '';
      const tracks = video.textTracks || [];
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        if (track.mode !== 'showing' || !track.activeCues) continue;
        for (let j = 0; j < track.activeCues.length; j++) {
          const cue = track.activeCues[j];
          if (cue?.text) {
            text += (text ? '\n' : '') + cue.text.replace(/<[^>]+>/g, '').trim();
          }
        }
      }
      setCueText(text);
    };

    const listeners = [];
    const attach = () => {
      const current = video.textTracks || [];
      for (let i = 0; i < current.length; i++) {
        current[i].removeEventListener('cuechange', handleCueChange);
        current[i].addEventListener('cuechange', handleCueChange);
        listeners.push(current[i]);
      }
    };
    attach();
    // <track> 元素可能晚于本 effect 挂载，监听新增
    const interval = setInterval(attach, 500);

    return () => {
      clearInterval(interval);
      listeners.forEach(t => t.removeEventListener('cuechange', handleCueChange));
    };
  }, [videoRef]);

  if (!visible || !cueText) return null;

  return (
    <div className="absolute inset-x-0 bottom-4 z-40 flex justify-center pointer-events-none px-6">
      <div
        className="max-w-[90%] whitespace-pre-line text-center text-sm sm:text-base leading-snug font-medium text-white bg-black/70 rounded-lg px-3 py-1.5"
        style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
      >
        {cueText}
      </div>
    </div>
  );
}
