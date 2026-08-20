import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Hls from 'hls.js';
import { jellyfin } from '../api/jellyfinClient';
import { getTrickplayStyle } from '../utils/trickplay';
import { useExternalPlayer } from '../hooks/useExternalPlayer';
import { useTouchGestures } from '../hooks/useTouchGestures';
import TrickplayScrubberThumbnail from './TrickplayScrubberThumbnail';
import { 
  Play, Pause, Volume2, VolumeX, Maximize, 
  Star, Eye, EyeOff, ExternalLink, X, Film, 
  SkipForward, SkipBack, Sun, Zap, FastForward
} from 'lucide-react';

export default function VideoPlayerModal({
  isOpen,
  item,
  onClose,
  onNext,
  onPrev,
  onUpdateItem
}) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const containerRef = useRef(null);
  const scrubberRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showPlayerMenu, setShowPlayerMenu] = useState(false);

  // Progress & Duration
  const [progress, setProgress] = useState(0);
  const [currentTimeText, setCurrentTimeText] = useState('00:00');
  const [durationText, setDurationText] = useState('00:00');
  const [rawDuration, setRawDuration] = useState(0);

  // Trickplay Hover State
  const [hoverScrubberTime, setHoverScrubberTime] = useState(null);
  const [hoverScrubberPercent, setHoverScrubberPercent] = useState(0);
  const [scrubberWidth, setScrubberWidth] = useState(600);

  // Scrubber Mouse Dragging
  const isDraggingScrubberRef = useRef(false);

  // Mouse Wheel Seek & Trickplay State
  const [wheelSeekingState, setWheelSeekingState] = useState({
    active: false,
    time: 0,
    delta: 0
  });
  const wheelTimerRef = useRef(null);
  const wheelSeekingTimeRef = useRef(null);

  const { launchPlayer } = useExternalPlayer();

  // Mobile Touch Gestures
  const { gestureState, brightness, touchHandlers } = useTouchGestures({
    videoRef,
    containerRef,
    duration: rawDuration,
    currentTime: videoRef.current?.currentTime || 0,
    onSeek: (target) => {
      if (videoRef.current) {
        videoRef.current.currentTime = target;
      }
    },
    onTogglePlay: () => {
      togglePlay();
    },
    normalSpeed: playbackSpeed,
    onSpeedChange: (speed) => {
      setPlaybackSpeed(speed);
    }
  });

  useEffect(() => {
    if (!isOpen || !item?.Id) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }

    setIsLoading(true);
    setHasError(false);
    setErrorMessage('');
    setProgress(0);
    setHoverScrubberTime(null);
    setWheelSeekingState({ active: false, time: 0, delta: 0 });

    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const directStreamUrl = jellyfin.getStreamUrl(item.Id);
    const hlsUrl = jellyfin.getHlsUrl(item.Id);

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
          videoEl.playbackRate = playbackSpeed;
          videoEl.play().catch(() => {
            videoEl.muted = true;
            setIsMuted(true);
            videoEl.play().catch(() => {});
          });
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                setHasError(true);
                setErrorMessage('视频解码失败 (格式或转码不支持)');
                break;
            }
          }
        });
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = hlsUrl;
        videoEl.play().catch(() => {});
      } else {
        setHasError(true);
        setErrorMessage('浏览器不支持此视频流');
      }
    };

    const handleDirectError = () => {
      setupHlsPlay();
    };

    const setupDirectPlay = () => {
      videoEl.src = directStreamUrl;
      videoEl.playbackRate = playbackSpeed;
      videoEl.muted = isMuted;
      videoEl.play().catch(() => {
        videoEl.muted = true;
        setIsMuted(true);
        videoEl.play().catch(() => {
          setupHlsPlay();
        });
      });
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
  }, [isOpen, item?.Id]);

  // Mouse Wheel Fast-Forward (Down) / Rewind (Up)
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const video = videoRef.current;
    if (!video || !video.duration) return;

    const duration = video.duration;
    const step = 5;
    // User requirement: Wheel DOWN (deltaY > 0) is Fast-Forward (+5s), Wheel UP (deltaY < 0) is Rewind (-5s)
    const delta = e.deltaY > 0 ? step : -step;
    
    const baseTime = wheelSeekingTimeRef.current !== null ? wheelSeekingTimeRef.current : video.currentTime;
    const nextTime = Math.max(0, Math.min(duration, baseTime + delta));
    
    wheelSeekingTimeRef.current = nextTime;
    video.currentTime = nextTime;

    setWheelSeekingState({
      active: true,
      time: nextTime,
      delta: Math.round(nextTime - video.currentTime + delta)
    });

    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = setTimeout(() => {
      wheelSeekingTimeRef.current = null;
      setWheelSeekingState(prev => ({ ...prev, active: false }));
    }, 700);
  }, []);

  // Scrubber Mouse Drag Seeking
  const updateScrubberDrag = useCallback((clientX) => {
    if (!scrubberRef.current || !videoRef.current) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const duration = videoRef.current.duration || (item?.RunTimeTicks ? item.RunTimeTicks / 10000000 : 0);
    if (!duration) return;

    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetTime = duration * pos;

    setProgress(pos * 100);
    setCurrentTimeText(formatTime(targetTime));
    setHoverScrubberTime(targetTime);
    setHoverScrubberPercent(pos);
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

  // Wheel Trickplay Style
  const wheelTrickplayStyle = useMemo(() => {
    if (!wheelSeekingState.active || !item) return null;
    return getTrickplayStyle(item, wheelSeekingState.time);
  }, [wheelSeekingState.active, wheelSeekingState.time, item]);

  if (!isOpen || !item) return null;

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

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !video.duration || isDraggingScrubberRef.current) return;
    setRawDuration(video.duration);
    const p = (video.currentTime / video.duration) * 100;
    setProgress(p);
    setCurrentTimeText(formatTime(video.currentTime));
    setDurationText(formatTime(video.duration));
  };

  const handleScrubberMouseMove = (e) => {
    if (isDraggingScrubberRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const duration = videoRef.current?.duration || (item.RunTimeTicks ? item.RunTimeTicks / 10000000 : 0);
    
    setHoverScrubberTime(duration * pos);
    setHoverScrubberPercent(pos);
    setScrubberWidth(rect.width);
  };

  const handleScrubberMouseLeave = () => {
    if (!isDraggingScrubberRef.current) {
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

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const posterUrl = item?.Id ? jellyfin.getImageUrl(item.Id, item.ImageTags?.Primary, 'Primary', 1000) : null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 md:bg-black/90 backdrop-blur-md md:p-4 animate-in fade-in duration-200 overflow-hidden"
      onClick={onClose}
    >
      <div 
        ref={containerRef}
        onWheel={handleWheel}
        className="relative w-full h-full md:h-auto md:max-w-5xl bg-[#0d1117] md:rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col justify-between md:justify-start md:max-h-[92vh]"
        style={{ filter: `brightness(${brightness})` }}
        onClick={(e) => e.stopPropagation()}
        {...touchHandlers}
      >
        {/* Header Bar */}
        <div className="p-3.5 border-b border-white/5 flex items-center justify-between bg-black/60 text-xs z-30 pt-[max(0.75rem,env(safe-area-inset-top))] flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <Film size={18} className="text-cyan-400 flex-shrink-0" />
            <span className="font-bold text-white text-sm truncate">{item?.Name}</span>
            {item?.ProductionYear && (
              <span className="text-gray-400 font-mono hidden sm:inline">({item.ProductionYear})</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* External Player Menu */}
            <div className="relative">
              <button
                onClick={() => setShowPlayerMenu(!showPlayerMenu)}
                className="px-2.5 py-1.5 rounded-lg bg-black/60 hover:bg-black/80 border border-white/10 text-gray-300 hover:text-cyan-300 transition flex items-center gap-1.5"
                title="调用外部播放器"
              >
                <ExternalLink size={13} />
                <span className="hidden sm:inline">外部播放器</span>
              </button>

              {showPlayerMenu && (
                <div className="absolute right-0 top-9 w-36 glass-panel rounded-xl shadow-2xl py-1 z-50 text-xs text-gray-200 divide-y divide-white/5">
                  <button 
                    onClick={() => { launchPlayer('mpv', item); setShowPlayerMenu(false); }}
                    className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center justify-between"
                  >
                    <span>MPV 播放器</span>
                    <span className="text-[10px] text-cyan-400">mpv://</span>
                  </button>
                  <button 
                    onClick={() => { launchPlayer('potplayer', item); setShowPlayerMenu(false); }}
                    className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center justify-between"
                  >
                    <span>PotPlayer</span>
                    <span className="text-[10px] text-amber-400">pot://</span>
                  </button>
                  <button 
                    onClick={() => { launchPlayer('vlc', item); setShowPlayerMenu(false); }}
                    className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center justify-between"
                  >
                    <span>VLC 播放器</span>
                    <span className="text-[10px] text-orange-400">vlc://</span>
                  </button>
                  <button 
                    onClick={() => { launchPlayer('direct', item); setShowPlayerMenu(false); }}
                    className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center justify-between"
                  >
                    <span>新标签页直链</span>
                  </button>
                </div>
              )}
            </div>

            {/* Close */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Video Canvas Container */}
        <div className="relative flex-1 min-h-0 w-full md:aspect-video bg-black flex items-center justify-center overflow-hidden touch-none">
          {/* Poster Backdrop */}
          {posterUrl && (
            <img 
              src={posterUrl} 
              alt="Poster" 
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 pointer-events-none ${
                isLoading ? 'opacity-50 blur-sm' : 'opacity-10 blur-md'
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
            onTimeUpdate={handleTimeUpdate}
          />

          {/* Mouse Wheel Seek Trickplay Overlay */}
          {wheelSeekingState.active && (
            <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none animate-in fade-in zoom-in-95 duration-100">
              <div className="flex flex-col items-center gap-2 p-2.5 rounded-2xl bg-black/90 backdrop-blur-md border-2 border-cyan-400 shadow-2xl shadow-cyan-500/30">
                <div className="w-[260px] h-[146px] rounded-xl overflow-hidden bg-black flex items-center justify-center relative">
                  {wheelTrickplayStyle ? (
                    <div className="w-full h-full" style={wheelTrickplayStyle} />
                  ) : (
                    <FastForward size={40} className="text-cyan-400 animate-pulse" />
                  )}
                </div>
                <div className="flex items-center gap-2 px-3.5 py-1 rounded-full bg-cyan-950/80 border border-cyan-400/40 text-xs font-mono font-bold text-white shadow">
                  <span className="text-cyan-300">{formatTime(wheelSeekingState.time)}</span>
                  <span className="text-gray-400">/</span>
                  <span className="text-gray-300">{durationText}</span>
                </div>
              </div>
            </div>
          )}

          {/* Touch Gesture HUD Overlay */}
          {gestureState.type && (
            <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none animate-in fade-in zoom-in-95 duration-100">
              <div className="flex flex-col items-center gap-2 bg-black/80 backdrop-blur-md px-5 py-3.5 rounded-2xl border border-white/10 shadow-2xl text-white">
                {gestureState.type === 'seek' && <FastForward size={28} className="text-cyan-400 animate-pulse" />}
                {gestureState.type === 'brightness' && <Sun size={28} className="text-amber-400" />}
                {gestureState.type === 'volume' && <Volume2 size={28} className="text-cyan-400" />}
                {gestureState.type === 'speed_boost' && <Zap size={28} className="text-amber-400 animate-bounce" />}
                
                <span className="font-mono font-bold text-sm">{gestureState.text}</span>
              </div>
            </div>
          )}

          {/* Loading Spinner */}
          {isLoading && !hasError && (
            <div className="absolute z-20 flex flex-col items-center justify-center pointer-events-none gap-2">
              <div className="w-12 h-12 border-4 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
              <span className="text-xs font-mono text-cyan-200 drop-shadow">加载视频流...</span>
            </div>
          )}

          {/* Error View */}
          {hasError && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/80 gap-3 p-4 text-center">
              <div className="text-red-400 text-sm font-semibold">{errorMessage || '播放失败'}</div>
              <button
                onClick={() => launchPlayer('mpv', item)}
                className="px-4 py-2 bg-jf-accent hover:bg-cyan-400 text-white text-xs font-medium rounded-xl transition"
              >
                使用外部 MPV 播放器打开
              </button>
            </div>
          )}
        </div>

        {/* Player Controls & Scrubber */}
        <div className="p-4 bg-slate-900/95 border-t border-white/5 flex flex-col gap-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] z-30 flex-shrink-0">
          {/* Scrubber Container with Real-Time Mouse Drag */}
          <div className="relative w-full">
            <TrickplayScrubberThumbnail
              item={item}
              hoverTime={hoverScrubberTime}
              hoverPercent={hoverScrubberPercent}
              containerWidth={scrubberWidth}
            />

            <div
              ref={scrubberRef}
              className="w-full h-2.5 hover:h-3.5 bg-white/20 rounded-full cursor-pointer transition-all relative overflow-hidden group/bar"
              onMouseDown={handleScrubberMouseDown}
              onMouseMove={handleScrubberMouseMove}
              onMouseLeave={handleScrubberMouseLeave}
            >
              <div
                className="absolute top-0 left-0 bottom-0 bg-cyan-400 rounded-full transition-all duration-75 relative"
                style={{ width: `${progress}%` }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-md shadow-black scale-0 group-hover/bar:scale-100 transition-transform" />
              </div>
            </div>
          </div>

          {/* Controls Row */}
          <div className="flex items-center justify-between text-xs text-gray-300">
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={togglePlay}
                className="p-2.5 rounded-xl bg-jf-accent hover:bg-cyan-400 text-white transition shadow-lg"
              >
                {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
              </button>

              {onPrev && (
                <button
                  onClick={onPrev}
                  className="p-2 rounded-xl bg-black/40 hover:bg-white/10 text-gray-300 transition"
                  title="上一个"
                >
                  <SkipBack size={15} />
                </button>
              )}

              {onNext && (
                <button
                  onClick={onNext}
                  className="p-2 rounded-xl bg-black/40 hover:bg-white/10 text-gray-300 transition"
                  title="下一个"
                >
                  <SkipForward size={15} />
                </button>
              )}

              <button
                onClick={toggleMute}
                className="p-2 rounded-xl bg-black/40 hover:bg-white/10 text-gray-300 transition"
              >
                {isMuted ? <VolumeX size={16} className="text-gray-400" /> : <Volume2 size={16} className="text-cyan-400" />}
              </button>

              <span className="font-mono text-gray-400 text-xs">
                {currentTimeText} / {durationText}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center bg-black/40 px-2 py-1 rounded-xl border border-white/5 gap-1">
                <span className="text-gray-400 text-[11px] hidden sm:inline">倍速:</span>
                <select
                  value={playbackSpeed}
                  onChange={(e) => {
                    const sp = parseFloat(e.target.value);
                    setPlaybackSpeed(sp);
                    if (videoRef.current) videoRef.current.playbackRate = sp;
                  }}
                  className="bg-transparent text-cyan-300 focus:outline-none cursor-pointer font-mono font-bold"
                >
                  <option value="0.5" className="bg-slate-900">0.5x</option>
                  <option value="1.0" className="bg-slate-900">1.0x</option>
                  <option value="1.25" className="bg-slate-900">1.25x</option>
                  <option value="1.5" className="bg-slate-900">1.5x</option>
                  <option value="2.0" className="bg-slate-900">2.0x</option>
                  <option value="2.5" className="bg-slate-900">2.5x</option>
                  <option value="3.0" className="bg-slate-900">3.0x</option>
                </select>
              </div>

              <button
                onClick={toggleFullscreen}
                className="p-2 rounded-xl bg-black/40 hover:bg-white/10 text-gray-300 transition"
                title="全屏"
              >
                <Maximize size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
