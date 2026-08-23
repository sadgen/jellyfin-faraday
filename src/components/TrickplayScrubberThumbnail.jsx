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

  // On Mobile: enlarged size (240px - 280px)
  // On Desktop: 2X enlarged size (360px - 420px)
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const cWidth = containerWidth || 400;
  const thumbWidth = isMobile ? Math.min(280, Math.max(200, cWidth * 0.85)) : Math.min(420, Math.max(280, cWidth * 0.75));
  const thumbHeight = Math.round(thumbWidth * 9 / 16);

  // Directly follow hoverPercent (0% to 100%) so the pointer aligns precisely with cursor/finger at extreme ends (0px to 100%), allowing the thumbnail to naturally protrude outside the frame
  const left = Math.max(0, Math.min(cWidth, (hoverPercent || 0) * cWidth));

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
        <div className="w-0 h-0 border-x-[6px] sm:border-x-8 border-x-transparent border-b-[6px] sm:border-b-8 border-b-cyan-400 mb-0.5" />
      )}

      {/* Thumbnail Window */}
      <div 
        style={{ width: `${thumbWidth}px`, height: `${thumbHeight}px` }}
        className="rounded-xl sm:rounded-2xl overflow-hidden bg-black/95 border-2 border-cyan-400 shadow-2xl shadow-cyan-500/35 flex items-center justify-center relative"
      >
        {style ? (
          <div className="w-full h-full" style={style} />
        ) : (
          <div className="text-[10px] sm:text-xs text-gray-500 font-mono">无 Trickplay 帧</div>
        )}
        
        {/* Time Stamp Badge */}
        <div className="absolute bottom-1.5 sm:bottom-2.5 bg-black/85 backdrop-blur-md px-2.5 sm:px-3.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-mono font-bold text-cyan-300 border border-white/20 shadow-lg">
          {formatTime(hoverTime)}
        </div>
      </div>

      {/* Downward pointer arrow when positioned above scrubber */}
      {!isBelow && (
        <div className="w-0 h-0 border-x-[6px] sm:border-x-8 border-x-transparent border-t-[6px] sm:border-t-8 border-t-cyan-400 mt-0.5" />
      )}
    </div>
  );
}
