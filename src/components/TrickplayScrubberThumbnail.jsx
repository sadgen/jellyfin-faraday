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

  // Larger Trickplay Preview (240px x 135px 16:9)
  const thumbWidth = 240;
  const rawX = (hoverPercent || 0) * (containerWidth || 300);
  const left = Math.max(thumbWidth / 2 + 8, Math.min((containerWidth || 300) - thumbWidth / 2 - 8, rawX));

  const isBelow = position === 'below';

  return (
    <div
      className={`absolute z-40 -translate-x-1/2 flex flex-col items-center pointer-events-none transition-all duration-75 animate-in fade-in zoom-in-95 duration-100 ${
        isBelow ? 'top-7' : 'bottom-7'
      }`}
      style={{ left: `${left}px` }}
    >
      {/* Upward pointer arrow when positioned below scrubber */}
      {isBelow && (
        <div className="w-0 h-0 border-x-6 border-x-transparent border-b-6 border-b-cyan-400 mb-0.5" />
      )}

      {/* Large Thumbnail Window */}
      <div className="w-[240px] h-[135px] rounded-xl overflow-hidden bg-black/95 border-2 border-cyan-400 shadow-2xl shadow-cyan-500/30 flex items-center justify-center relative">
        {style ? (
          <div className="w-full h-full" style={style} />
        ) : (
          <div className="text-xs text-gray-500 font-mono">无 Trickplay 帧</div>
        )}
        
        {/* Time Stamp Badge */}
        <div className="absolute bottom-2 bg-black/85 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-mono font-bold text-cyan-300 border border-white/20 shadow-lg">
          {formatTime(hoverTime)}
        </div>
      </div>

      {/* Downward pointer arrow when positioned above scrubber */}
      {!isBelow && (
        <div className="w-0 h-0 border-x-6 border-x-transparent border-t-6 border-t-cyan-400 mt-0.5" />
      )}
    </div>
  );
}
