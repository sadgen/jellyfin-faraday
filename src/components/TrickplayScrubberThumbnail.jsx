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

  // On Mobile: 1X compact standard size (180px x 101px)
  // On Desktop: 2X enlarged size (380px x 214px)
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const cWidth = containerWidth || 400;
  const thumbWidth = isMobile ? 180 : Math.min(380, Math.max(260, cWidth * 0.75));
  const thumbHeight = Math.round(thumbWidth * 9 / 16);

  const rawX = (hoverPercent || 0) * cWidth;
  // 窄容器时 min/max 边界可能倒挂（cWidth < thumbWidth），先归一化再 clamp，防止气泡溢出进度条左侧
  const halfThumb = Math.min(thumbWidth / 2 + 4, cWidth / 2);
  const left = Math.max(halfThumb, Math.min(cWidth - halfThumb, rawX));

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
