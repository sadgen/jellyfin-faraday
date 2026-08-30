import { useState, useEffect, useRef } from 'react';
import { Timer, X } from 'lucide-react';
import { SLEEP_TIMER_OPTIONS, useSleepTimer } from '../hooks/useSleepTimer';

function formatCountdown(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * 睡眠定时器按钮：倒计时结束触发 onExpire（通常暂停播放）。
 * 影院播放器 / VR 播放器 / 浮动窗口共用。
 */
export default function SleepTimerButton({ onExpire, className = '' }) {
  const { remainingSeconds, isActive, start, stop } = useSleepTimer();
  const [showMenu, setShowMenu] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!showMenu) return;
    const handleOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    window.addEventListener('mousedown', handleOutside, true);
    return () => window.removeEventListener('mousedown', handleOutside, true);
  }, [showMenu]);

  const handleSelect = (minutes) => {
    if (minutes === 0) {
      stop();
    } else {
      start(minutes, onExpire);
    }
    setShowMenu(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        onClick={() => setShowMenu(prev => !prev)}
        className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-bold transition ${
          isActive
            ? 'bg-purple-500/25 border-purple-400/50 text-purple-300'
            : 'bg-black/40 border-white/10 text-gray-300 hover:text-cyan-300 hover:bg-white/10'
        }`}
        title={isActive ? `睡眠定时：剩余 ${formatCountdown(remainingSeconds)}` : '睡眠定时（到时自动暂停播放）'}
      >
        <Timer size={13} className={isActive ? 'text-purple-300' : 'text-gray-400'} />
        {isActive && (
          <span className="font-mono text-[11px]">{formatCountdown(remainingSeconds)}</span>
        )}
      </button>

      {showMenu && (
        <div
          className="absolute right-0 top-[calc(100%+6px)] w-36 bg-[#0d131f] border border-white/15 rounded-xl shadow-2xl py-1 z-50 text-xs text-gray-200 divide-y divide-white/5 animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          {SLEEP_TIMER_OPTIONS.map(opt => (
            <button
              key={opt.minutes}
              onClick={() => handleSelect(opt.minutes)}
              className="w-full px-3 py-1.5 text-left hover:bg-white/10 transition"
            >
              {opt.label}
            </button>
          ))}
          {isActive && (
            <button
              onClick={() => handleSelect(0)}
              className="w-full px-3 py-1.5 text-left hover:bg-white/10 transition flex items-center gap-2 text-red-300"
            >
              <X size={12} />
              <span>取消定时</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
