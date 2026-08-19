import React, { useMemo } from 'react';
import { getTrickplayStyle, getTrickplayInfo } from '../utils/trickplay';

export default function TrickplayScrubberThumbnail({
  item,
  hoverTime,
  hoverPercent,
  containerWidth
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

  // Calculate safe X coordinate so thumbnail doesn't overflow container boundaries
  const thumbWidth = 140;
  const rawX = (hoverPercent || 0) * (containerWidth || 300);
  const left = Math.max(thumbWidth / 2, Math.min((containerWidth || 300) - thumbWidth / 2, rawX));

  return (
    <div
      className="absolute bottom-6 z-40 -translate-x-1/2 flex flex-col items-center pointer-events-none transition-all duration-75"
      style={{ left: `${left}px` }}
    >
      {/* Thumbnail Window */}
      <div className="w-[140px] h-[80px] rounded-lg overflow-hidden bg-black/90 border border-cyan-400/50 shadow-2xl flex items-center justify-center relative">
        {style ? (
          <div className="w-full h-full" style={style} />
        ) : (
          <div className="text-[10px] text-gray-500 font-mono">无 Trickplay 帧</div>
        )}
        
        {/* Time Stamp Pill */}
        <div className="absolute bottom-1 bg-black/75 backdrop-blur-xs px-2 py-0.5 rounded text-[10px] font-mono text-cyan-300 border border-white/10">
          {formatTime(hoverTime)}
        </div>
      </div>

      {/* Downward pointer triangle */}
      <div className="w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-cyan-400/50 mt-0.5" />
    </div>
  );
}
