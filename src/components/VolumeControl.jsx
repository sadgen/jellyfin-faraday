import { useState, useRef, useEffect } from 'react';
import { Volume2, Volume1, VolumeX } from 'lucide-react';

function formatPercent(volume) {
  return `${Math.round(volume * 100)}%`;
}

/**
 * 桌面端悬停弹出 / 点击展开的音量滑块（影院播放器 / VR 播放器共用）。
 * 音量等级持久化到 localStorage 并随 reportPlayback 上报服务器。
 */
export default function VolumeControl({ volume, setVolume, isMuted, toggleMute, compact = false }) {
  const [showSlider, setShowSlider] = useState(false);
  const containerRef = useRef(null);
  const hideTimerRef = useRef(null);

  useEffect(() => () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, []);

  const scheduleHide = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowSlider(false), 250);
  };

  const cancelHide = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  };

  const Icon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  const effective = isMuted ? 0 : volume;

  return (
    <div
      ref={containerRef}
      className="relative flex items-center"
      onMouseEnter={() => { cancelHide(); setShowSlider(true); }}
      onMouseLeave={scheduleHide}
    >
      <button
        onClick={toggleMute}
        className="p-2 rounded-xl bg-black/40 hover:bg-white/10 text-gray-300 transition"
        title={isMuted ? '取消静音' : '静音'}
      >
        <Icon size={14} className={isMuted ? 'text-gray-400' : 'text-cyan-400'} />
      </button>

      {(showSlider || compact) && (
        <div
          className={`flex items-center gap-1.5 bg-black/60 rounded-xl border border-white/10 transition-all ${
            compact ? 'px-1.5' : 'px-2 ml-0.5'
          }`}
          style={compact ? undefined : { width: '110px' }}
          onClick={(e) => e.stopPropagation()}
        >
          {!compact && (
            <span className="text-[10px] font-mono text-cyan-300 w-7 text-right flex-shrink-0">
              {formatPercent(effective)}
            </span>
          )}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={effective}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-14 sm:w-16 accent-cyan-400 h-1 bg-white/20 rounded-lg cursor-pointer appearance-none"
            title={`音量 ${formatPercent(effective)}`}
          />
          {compact && (
            <span className="text-[9px] font-mono text-cyan-300 w-6 text-right flex-shrink-0">
              {formatPercent(effective)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
