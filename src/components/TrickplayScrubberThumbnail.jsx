import React, { useMemo } from 'react';
import { getTrickplayStyle } from '../utils/trickplay';

export default function TrickplayScrubberThumbnail({
  item,
  hoverTime,
  hoverPercent,
  containerWidth,
  position = 'above' // 'above' | 'below'
}) {
  const style = useMemo(() => {
    return getTrickplayStyle(item, hoverTime);
  }, [item, hoverTime]);

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!item || hoverTime === null) return null;

  // 2X-Enlarged Trickplay Preview (380px x 214px 16:9, responsive)
  const cWidth = containerWidth || 400;
  const thumbWidth = Math.min(380, Math.max(240, typeof window !== 'undefined' ? Math.min(window.innerWidth * 0.85, 380) : 380));
  const thumbHeight = Math.round(thumbWidth * 9 / 16);

  const rawX = (hoverPercent || 0) * cWidth;
  const left = Math.max(thumbWidth / 2 + 4, Math.min(cWidth - thumbWidth / 2 - 4, rawX));

  const isBelow = position === 'below';

  return (
    <div
      className={`absolute z-50 -translate-x-1/2 flex flex-col items-center pointer-events-none transition-all duration-75 animate-in fade-in zoom-in-95 duration-100 ${
        isBelow ? 'top-6' : 'bottom-6'
      }`}
      style={{ left: `${left}px` }}
    >
      {/* Upward pointer arrow when positioned below scrubber */}
      {isBelow && (
        <div className="w-0 h-0 border-x-8 border-x-transparent border-b-8 border-b-cyan-400 mb-0.5" />
      )}

      {/* 2X-Enlarged Thumbnail Window */}
      <div 
        style={{ width: `${thumbWidth}px`, height: `${thumbHeight}px` }}
        className="rounded-2xl overflow-hidden bg-black/95 border-2 border-cyan-400 shadow-2xl shadow-cyan-500/35 flex items-center justify-center relative"
      >
        {style ? (
          <div className="w-full h-full" style={style} />
        ) : (
          <div className="text-xs text-gray-500 font-mono">无 Trickplay 帧</div>
        )}
        
        {/* Time Stamp Badge */}
        <div className="absolute bottom-2.5 bg-black/85 backdrop-blur-md px-3.5 py-1 rounded-full text-xs font-mono font-bold text-cyan-300 border border-white/20 shadow-lg">
          {formatTime(hoverTime)}
        </div>
      </div>

      {/* Downward pointer arrow when positioned above scrubber */}
      {!isBelow && (
        <div className="w-0 h-0 border-x-8 border-x-transparent border-t-8 border-t-cyan-400 mt-0.5" />
      )}
    </div>
  );
}
