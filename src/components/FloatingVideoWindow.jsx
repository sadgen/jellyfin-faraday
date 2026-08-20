import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Hls from 'hls.js';
import { jellyfin } from '../api/jellyfinClient';
import { getTrickplayStyle } from '../utils/trickplay';
import { calculateSlotStyle } from '../utils/windowLayout';
import { useExternalPlayer } from '../hooks/useExternalPlayer';
import TrickplayScrubberThumbnail from './TrickplayScrubberThumbnail';
import { 
  Play, Pause, SkipForward, Volume2, VolumeX, Maximize, 
  X, ExternalLink, Move, Film, Star, Eye
} from 'lucide-react';

export default function FloatingVideoWindow({
  windowData,
  onClose,
  onSkip,
  onExpand,
  onBringToFront
}) {
  const { id, slotIndex, item } = windowData;

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const containerRef = useRef(null);
  const scrubberRef = useRef(null);

  // Initialize position and size using exact Tampermonkey slot formula
  const [layout, setLayout] = useState(() => calculateSlotStyle(slotIndex));
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });

  // Update layout on window resize
  useEffect(() => {
    const handleResize = () => {
      if (!isDragging) {
        setLayout(calculateSlotStyle(slotIndex));
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [slotIndex, isDragging]);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Progress & Duration
  const [progress, setProgress] = useState(0);
  const [currentTimeText, setCurrentTimeText] = useState('00:00');
  const [durationText, setDurationText] = useState('00:00');
  const [rawDuration, setRawDuration] = useState(0);

  // Trickplay Hover Scrubber State
  const [hoverScrubberTime, setHoverScrubberTime] = useState(null);
  const [hoverScrubberPercent, setHoverScrubberPercent] = useState(0);
  const [scrubberWidth, setScrubberWidth] = useState(300);

  // Scrubber Dragging State
  const isDraggingScrubberRef = useRef(false);

  // Mouse Wheel Seek State
  const [isWheelSeeking, setIsWheelSeeking] = useState(false);
  const wheelTimerRef = useRef(null);
  const wheelSeekingTimeRef = useRef(null);

  const { launchPlayer } = useExternalPlayer();

  // Load and play video when item changes
  useEffect(() => {
    if (!item?.Id) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setHasError(false);
    setProgress(0);
    setHoverScrubberTime(null);
    setIsWheelSeeking(false);

    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const directStreamUrl = jellyfin.getStreamUrl(item.Id);
    const hlsUrl = jellyfin.getHlsUrl(item.Id);

    const setupDirectPlay = () => {
      videoEl.src = directStreamUrl;
      videoEl.muted = isMuted;
      videoEl.play().catch(() => {
        videoEl.muted = true;
        setIsMuted(true);
        videoEl.play().catch(() => {});
      });
    };

    const setupHlsPlay = () => {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 30
        });
        hlsRef.current = hls;
        hls.loadSource(hlsUrl);
        hls.attachMedia(videoEl);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoEl.play().catch(() => {
            videoEl.muted = true;
            setIsMuted(true);
            videoEl.play().catch(() => {});
          });
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            setHasError(true);
          }
        });
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = hlsUrl;
        videoEl.play().catch(() => {});
      } else {
        setupDirectPlay();
      }
    };

    const handleDirectError = () => {
      setupHlsPlay();
    };

    videoEl.addEventListener('error', handleDirectError, { once: true });
    setupDirectPlay();

    return () => {
      videoEl.removeEventListener('error', handleDirectError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      videoEl.removeAttribute('src');
      videoEl.load();
    };
  }, [item?.Id]);

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !video.duration || isDraggingScrubberRef.current) return;
    setRawDuration(video.duration);
    const p = (video.currentTime / video.duration) * 100;
    setProgress(p);
    setCurrentTimeText(formatTime(video.currentTime));
    setDurationText(formatTime(video.duration));
  };

  // Dragging the floating window
  const handleMouseDownHeader = (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    if (onBringToFront) onBringToFront(id);

    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: layout.left,
      posY: layout.top
    };

    const handleMouseMove = (moveEvent) => {
      const dx = moveEvent.clientX - dragStartRef.current.mouseX;
      const dy = moveEvent.clientY - dragStartRef.current.mouseY;
      const newX = Math.max(0, Math.min(window.innerWidth - layout.width, dragStartRef.current.posX + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 100, dragStartRef.current.posY + dy));
      setLayout(prev => ({ ...prev, left: newX, top: newY }));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Mouse Wheel Fast-Forward (Down) / Rewind (Up) with Direct Scrubber Trickplay
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const video = videoRef.current;
    if (!video || !video.duration) return;

    const duration = video.duration;
    const step = 5;
    const delta = e.deltaY > 0 ? step : -step;
    
    const baseTime = wheelSeekingTimeRef.current !== null ? wheelSeekingTimeRef.current : video.currentTime;
    const nextTime = Math.max(0, Math.min(duration, baseTime + delta));
    
    wheelSeekingTimeRef.current = nextTime;
    video.currentTime = nextTime;

    const percent = nextTime / duration;
    setProgress(percent * 100);
    setCurrentTimeText(formatTime(nextTime));
    setHoverScrubberTime(nextTime);
    setHoverScrubberPercent(percent);
    setIsWheelSeeking(true);

    if (scrubberRef.current) {
      setScrubberWidth(scrubberRef.current.getBoundingClientRect().width);
    }

    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = setTimeout(() => {
      wheelSeekingTimeRef.current = null;
      setIsWheelSeeking(false);
      setHoverScrubberTime(null);
    }, 750);
  }, []);

  // Scrubber Mouse Drag Seeking
  const updateScrubberDrag = useCallback((clientX) => {
    if (!scrubberRef.current || !videoRef.current) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const duration = videoRef.current.duration || (item?.RunTimeTicks ? item.RunTimeTicks / 10000000 : 0);
    if (!duration) return;

    const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetTime = duration * p;

    setProgress(p * 100);
    setCurrentTimeText(formatTime(targetTime));
    setHoverScrubberTime(targetTime);
    setHoverScrubberPercent(p);
    setScrubberWidth(rect.width);
    videoRef.current.currentTime = targetTime;
  }, [item?.RunTimeTicks]);

  const handleScrubberMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingScrubberRef.current = true;
    updateScrubberDrag(e.clientX);

    const handleWindowMouseMove = (moveEvent) => {
      if (isDraggingScrubberRef.current) {
        updateScrubberDrag(moveEvent.clientX);
      }
    };

    const handleWindowMouseUp = (upEvent) => {
      if (isDraggingScrubberRef.current) {
        isDraggingScrubberRef.current = false;
        updateScrubberDrag(upEvent.clientX);
      }
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
  }, [updateScrubberDrag]);

  const handleScrubberMouseMove = (e) => {
    if (isDraggingScrubberRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const duration = videoRef.current?.duration || (item?.RunTimeTicks ? item.RunTimeTicks / 10000000 : 0);
    
    setHoverScrubberTime(duration * p);
    setHoverScrubberPercent(p);
    setScrubberWidth(rect.width);
  };

  const handleScrubberMouseLeave = () => {
    if (!isDraggingScrubberRef.current && !isWheelSeeking) {
      setHoverScrubberTime(null);
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = (e) => {
    if (e) e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  // Middle Click to Skip
  const handleAuxClick = (e) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      if (onSkip) onSkip(slotIndex);
    }
  };

  const backdropUrl = item?.Id ? (jellyfin.getImageUrl(item.Id, item.ImageTags?.Backdrop || item.ImageTags?.Primary, 'Backdrop', 600, 80) || jellyfin.getImageUrl(item.Id, item.ImageTags?.Primary, 'Primary', 400, 80)) : null;

  return (
    <div
      ref={containerRef}
      onMouseDown={() => onBringToFront && onBringToFront(id)}
      onAuxClick={handleAuxClick}
      onWheel={handleWheel}
      style={{
        left: `${layout.left}px`,
        top: `${layout.top}px`,
        width: `${layout.width}px`,
        zIndex: 50 + slotIndex
      }}
      className={`fixed rounded-2xl overflow-hidden shadow-2xl border bg-[#0d1117] flex flex-col group select-none transition-shadow ${
        slotIndex === 0 
          ? 'border-cyan-400/60 shadow-cyan-500/25' 
          : 'border-white/15 shadow-black/80'
      } ${
        isDragging ? 'shadow-cyan-500/50 opacity-95 scale-[1.01]' : 'hover:border-cyan-400'
      }`}
    >
      {/* Draggable Header */}
      <div
        onMouseDown={handleMouseDownHeader}
        className={`px-3 py-2 border-b border-white/10 flex items-center justify-between cursor-move text-xs ${
          slotIndex === 0 ? 'bg-cyan-950/80 text-cyan-200' : 'bg-slate-950/90 text-gray-300'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 pr-2">
          <span className={`w-2 h-2 rounded-full ${slotIndex === 0 ? 'bg-cyan-400 animate-pulse' : 'bg-amber-400'}`} />
          <span className="font-bold text-white text-xs truncate max-w-[200px]" title={item?.Name}>
            {item?.Name || '视频预览'}
          </span>
          <span className="px-1.5 py-0.2 rounded bg-white/10 text-[10px] font-mono text-cyan-300 font-bold">
            {slotIndex === 0 ? '主窗' : `副窗 #${slotIndex}`}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* External player button */}
          <button
            onClick={() => launchPlayer('mpv', item)}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-cyan-300 transition"
            title="MPV 打开"
          >
            <ExternalLink size={13} />
          </button>

          {/* Expand to full theater */}
          <button
            onClick={() => onExpand && onExpand(item)}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-cyan-300 transition"
            title="放大影院全屏"
          >
            <Maximize size={13} />
          </button>

          {/* Skip next */}
          <button
            onClick={() => onSkip && onSkip(slotIndex)}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-cyan-300 transition"
            title="换一个 (中键)"
          >
            <SkipForward size={13} />
          </button>

          {/* Close */}
          <button
            onClick={() => onClose && onClose(slotIndex)}
            className="p-1 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition"
            title="关闭窗口"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Video Viewport (16:9) */}
      <div className="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden">
        {/* Backdrop Thumbnail */}
        {backdropUrl && (
          <img
            src={backdropUrl}
            alt=""
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 pointer-events-none ${
              isLoading ? 'opacity-60 blur-xs' : 'opacity-0'
            }`}
          />
        )}

        <video
          ref={videoRef}
          playsInline
          className="w-full h-full object-contain cursor-pointer z-10"
          onClick={togglePlay}
          onWaiting={() => setIsLoading(true)}
          onPlaying={() => {
            setIsLoading(false);
            setIsPlaying(true);
          }}
          onPause={() => setIsPlaying(false)}
          onEnded={() => onSkip && onSkip(slotIndex)}
          onTimeUpdate={handleTimeUpdate}
        />

        {/* Loading Spinner */}
        {isLoading && !hasError && (
          <div className="absolute z-20 flex flex-col items-center justify-center pointer-events-none gap-1">
            <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
          </div>
        )}

        {/* Paused Indicator */}
        {!isPlaying && !isLoading && !hasError && (
          <div 
            onClick={togglePlay}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 cursor-pointer"
          >
            <div className="w-11 h-11 rounded-full bg-black/60 border border-white/20 flex items-center justify-center text-white">
              <Play size={20} className="ml-0.5 fill-white" />
            </div>
          </div>
        )}
      </div>

      {/* Scrubber & Controls Footer */}
      <div className="p-2.5 bg-slate-950/95 border-t border-white/5 flex flex-col gap-1.5 text-xs">
        {/* Scrubber with Real-time Drag & Trickplay */}
        <div className="relative w-full">
          <TrickplayScrubberThumbnail
            item={item}
            hoverTime={hoverScrubberTime}
            hoverPercent={hoverScrubberPercent}
            containerWidth={scrubberWidth}
            position="above"
          />

          <div
            ref={scrubberRef}
            className="w-full h-2 hover:h-3 bg-white/20 rounded-full cursor-pointer transition-all relative overflow-hidden group/bar"
            onMouseDown={handleScrubberMouseDown}
            onMouseMove={handleScrubberMouseMove}
            onMouseLeave={handleScrubberMouseLeave}
          >
            <div
              className="absolute top-0 left-0 bottom-0 bg-cyan-400 rounded-full transition-all duration-75"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between text-gray-300 pt-0.5">
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              className="p-1 hover:bg-white/10 rounded text-white transition"
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            </button>

            <button
              onClick={toggleMute}
              className="p-1 hover:bg-white/10 rounded text-white transition"
            >
              {isMuted ? <VolumeX size={14} className="text-gray-400" /> : <Volume2 size={14} className="text-cyan-400" />}
            </button>

            <span className="font-mono text-[11px] text-gray-400">
              {currentTimeText} / {durationText}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onSkip && onSkip(slotIndex)}
              className="px-2.5 py-0.5 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/40 text-cyan-300 text-[11px] font-medium transition flex items-center gap-1"
            >
              <SkipForward size={11} />
              <span>切片</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
