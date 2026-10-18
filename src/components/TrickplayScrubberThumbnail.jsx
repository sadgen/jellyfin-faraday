import { useMemo } from 'react';
import { getTrickplayStyle, getTrickplayInfo } from '../utils/trickplay';

export default function TrickplayScrubberThumbnail({
  item,
  hoverTime,
  hoverPercent,
  containerWidth,
  position = 'above', // 'above' | 'below'
  centerMode = false, // When true, centers thumbnail horizontally relative to container
  mode = 'scrubber',  // 'scrubber' (relative to scrubber bar) | 'window' (relative to whole floating window)
  spaceBelow = null,  // window 模式：窗口下沿以下的视口剩余像素
  spaceAbove = null,  // window 模式：窗口上沿以上的可用像素（已扣除顶栏）
  windowLeft = 0      // window 模式：窗口在视口内的横向偏移（跟随钳制按视口计算时需要）
}) {
  const tpInfo = useMemo(() => {
    return getTrickplayInfo(item);
  }, [item]);

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

  // On Mobile: compact dynamic size; On Desktop: same tiers as the library poster
  // hover preview (sm:480 / landscape lg:540, vertical sm:460) — 560-width sprites
  // justify the larger surface without upscaling blur
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const cWidth = containerWidth || 360;
  const isVertical = tpInfo.isVertical;
  const ar = tpInfo.aspectRatio || (16 / 9);

  let thumbWidth, thumbHeight;
  if (isVertical) {
    // 竖屏（9:16等）：限制高度，按宽高比自适应宽度，避免拉伸成 16:9
    thumbHeight = isMobile ? Math.min(320, Math.max(200, cWidth * 0.8)) : (vw >= 640 ? 460 : 380);
    thumbWidth = Math.max(80, Math.round(thumbHeight * ar));
  } else {
    // 横屏（16:9等）：限制宽度，按宽高比自适应高度
    thumbWidth = isMobile ? Math.min(320, Math.max(220, cWidth * 0.85)) : (vw >= 1024 ? 540 : 480);
    thumbHeight = Math.max(80, Math.round(thumbWidth / ar));
  }

  const isWindowMode = mode === 'window';
  const hasSpace = (v) => v !== null && v !== undefined;

  // window 模式上/下自适应：下方放得下挂下方；否则上方放得下挂上方；
  // 两侧都放不下 → 选空间大的一侧并按真实空间压缩缩略图高度，保证完整可见不出视口
  let isBelow = position === 'below';
  if (isWindowMode && hasSpace(spaceBelow)) {
    const need = thumbHeight + 24;
    if (spaceBelow >= need) {
      isBelow = true;
    } else if (hasSpace(spaceAbove) && spaceAbove >= need) {
      isBelow = false;
    } else {
      isBelow = !hasSpace(spaceAbove) || spaceBelow >= spaceAbove;
      const capped = Math.max(140, (isBelow ? spaceBelow : spaceAbove) - 24);
      if (capped < thumbHeight) {
        thumbHeight = Math.round(capped);
        thumbWidth = Math.max(80, Math.round(thumbHeight * ar));
      }
    }
  }

  // Exact cursor/finger position along scrubber (0px to cWidth)
  const cursorX = Math.max(0, Math.min(cWidth, (hoverPercent || 0) * cWidth));

  // window 模式：预览跟随光标横向移动，钳制在视口内（允许越出窗沿，不出页面）；
  // 视口放不下时回退为窗口居中
  const followX = isWindowMode
    ? (() => {
        const half = thumbWidth / 2 + 6;
        const wl = hasSpace(windowLeft) ? windowLeft : 0;
        const vpw = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const minX = half - wl;
        const maxX = vpw - half - wl;
        return minX <= maxX ? Math.max(minX, Math.min(maxX, cursorX)) : null;
      })()
    : null;

  // Positioning classes:
  // When mode === 'window': anchored 8px outside window boundary (top/bottom edge),
  //   horizontally follows the scrubber cursor (clamped), falls back to centering
  // When mode === 'scrubber': positioned 24px (top-6 / bottom-6) relative to scrubber,
  //   centered on cursorX (or fixed center when centerMode)
  const positionClass = isWindowMode
    ? (isBelow ? 'top-[calc(100%+8px)]' : 'bottom-[calc(100%+8px)]')
    : (isBelow ? 'top-6' : 'bottom-6');
  const isCentered = centerMode || (isWindowMode && followX === null);
  const leftClass = isCentered ? ' left-1/2' : '';
  const leftStyle = isCentered
    ? undefined
    : { left: `${isWindowMode ? followX : cursorX}px` };

  return (
    <div
      data-native-overlap={isWindowMode ? undefined : '1'}
      className={`absolute z-[99999] flex flex-col items-center pointer-events-none -translate-x-1/2 ${positionClass}${leftClass}`}
      style={leftStyle}
    >
      {/* Upward pointer arrow when positioned below scrubber or below window */}
      {isBelow && (
        <div 
          className="w-0 h-0 border-x-[6px] sm:border-x-8 border-x-transparent border-b-[6px] sm:border-b-8 border-b-cyan-400 mb-0.5"
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
        />
      )}
    </div>
  );
}
