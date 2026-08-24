import React, { useMemo } from 'react';
import { getTrickplayStyle } from '../utils/trickplay';

export default function TrickplayScrubberThumbnail({
  item,
  hoverTime,
  hoverPercent,
  containerWidth,
  position = 'above', // 'above' | 'below'
  centerMode = false, // When true, centers thumbnail horizontally relative to container
  mode = 'scrubber'   // 'scrubber' (relative to scrubber bar) | 'window' (relative to whole floating window)
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

  // On Mobile: enlarged size (220px - 280px)
  // On Desktop: 2X enlarged size (340px - 400px)
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const cWidth = containerWidth || 360;
  const thumbWidth = isMobile ? Math.min(270, Math.max(200, cWidth * 0.85)) : Math.min(380, Math.max(260, cWidth * 0.72));
  const thumbHeight = Math.round(thumbWidth * 9 / 16);

  // Exact cursor/finger position along scrubber (0px to cWidth)
  const cursorX = Math.max(0, Math.min(cWidth, (hoverPercent || 0) * cWidth));

  // In centerMode or window mode, thumbnail is centered horizontally
  const isCentered = centerMode || mode === 'window';
  const halfThumb = thumbWidth / 2;
  const margin = 4;
  const clampedBoxLeft = isCentered
    ? cWidth / 2
    : Math.max(halfThumb + margin, Math.min(cWidth - halfThumb - margin, cursorX));

  // Arrow offset from thumbnail center (-halfThumb to +halfThumb)
  const arrowOffset = isCentered ? 0 : Math.max(-halfThumb + 14, Math.min(halfThumb - 14, cursorX - clampedBoxLeft));

  const isBelow = position === 'below';

  // Positioning classes:
  // When mode === 'window': positioned 8px outside window boundary
  // When mode === 'scrubber': positioned 24px (top-6 / bottom-6) relative to scrubber bar
  const positionClass = mode === 'window'
    ? (isBelow ? 'top-[calc(100%+8px)] left-1/2 -translate-x-1/2' : 'bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2')
    : (isBelow ? 'top-6' : 'bottom-6') + (isCentered ? ' left-1/2 -translate-x-1/2' : '');

  return (
    <div
      className={`absolute z-[99999] flex flex-col items-center pointer-events-none ${positionClass}`}
      style={!isCentered && mode !== 'window' ? { left: `${clampedBoxLeft}px` } : undefined}
    >
      {/* Upward pointer arrow when positioned below scrubber or below window */}
      {isBelow && (
        <div 
          className="w-0 h-0 border-x-[6px] sm:border-x-8 border-x-transparent border-b-[6px] sm:border-b-8 border-b-cyan-400 mb-0.5"
          style={arrowOffset !== 0 ? { transform: `translateX(${arrowOffset}px)` } : undefined}
        />
      )}

      {/* Thumbnail Window */}
      <div 
        style={{ width: `${thumbWidth}px`, height: `${thumbHeight}px` }}
        className="rounded-xl sm:rounded-2xl overflow-hidden bg-black/95 border-2 border-cyan-400 shadow-2xl shadow-cyan-500/50 flex items-center justify-center relative"
      >
        {style ? (
          <div className="w-full h-full" style={style} />
        ) : (
          <div className="text-[10px] sm:text-xs text-gray-500 font-mono">无 Trickplay 帧</div>
        )}
        
        {/* Time Stamp Badge */}
        <div className="absolute bottom-1.5 sm:bottom-2 bg-black/85 backdrop-blur-md px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-mono font-bold text-cyan-300 border border-white/20 shadow-lg">
          {formatTime(hoverTime)}
        </div>
      </div>

      {/* Downward pointer arrow when positioned above scrubber or above window */}
      {!isBelow && (
        <div 
          className="w-0 h-0 border-x-[6px] sm:border-x-8 border-x-transparent border-t-[6px] sm:border-t-8 border-t-cyan-400 mt-0.5"
          style={arrowOffset !== 0 ? { transform: `translateX(${arrowOffset}px)` } : undefined}
        />
      )}
    </div>
  );
}
