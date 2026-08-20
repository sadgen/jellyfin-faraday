import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Hls from 'hls.js';
import { jellyfin } from '../api/jellyfinClient';
import { getTrickplayStyle } from '../utils/trickplay';
import { useExternalPlayer } from '../hooks/useExternalPlayer';
import { useTouchGestures } from '../hooks/useTouchGestures';
import TrickplayScrubberThumbnail from './TrickplayScrubberThumbnail';
import InlineVrCanvas from './InlineVrCanvas';
import { 
  Play, Pause, SkipForward, Volume2, VolumeX, Maximize, 
  Star, Eye, EyeOff, ExternalLink, Zap, Image as ImageIcon,
  X, Info, Tag, Calendar, Film, Sun, FastForward, Glasses
} from 'lucide-react';

export default function VideoTile({
  tileId = 0,
  activeTileCount = 2,
  item,
  isGlobalMuted = true,
  playbackSpeed = 1.0,
  onSkip,
  onUpdateItem
}) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const containerRef = useRef(null);
  const scrubberRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [isTileMuted, setIsTileMuted] = useState(isGlobalMuted);
  const [isHovered, setIsHovered] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showPlayerMenu, setShowPlayerMenu] = useState(false);
  const [showPosterModal, setShowPosterModal] = useState(false);
  
  // Pinned Poster PIP: ENABLED BY DEFAULT and enlarged 1.5x
  const [showPinnedPoster, setShowPinnedPoster] = useState(true);
  
  // INLINE VR Projection State (renders right inside this tile!)
  const [isVrActive, setIsVrActive] = useState(false);
  
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

  // 4-Window Geometric Layout Calculations
  const is4Window = activeTileCount === 4;
  const isTopRowIn4Window = is4Window && (tileId === 0 || tileId === 1);
  const isBottomRowIn4Window = is4Window && (tileId === 2 || tileId === 3);
  
  const scrubberPositionClass = isBottomRowIn4Window ? 'top-0' : 'bottom-0';
  const trickplayPosition = isTopRowIn4Window ? 'below' : 'above';

  // Mobile Touch Gestures
  const { gestureState, brightness, touchHandlers } = useTouchGestures({
    videoRef,
    containerRef,
    duration: rawDuration,
    currentTime: videoRef.current?.currentTime || 0,
    onSeek: (target) => {
      if (videoRef.current) videoRef.current.currentTime = target;
    },
    onTogglePlay: () => {
      togglePlay();
    },
    normalSpeed: playbackSpeed,
    onSpeedChange: (speed) => {
      if (videoRef.current) videoRef.current.playbackRate = speed;
    }
  });

  // Sync mute with global setting
  useEffect(() => {
    setIsTileMuted(isGlobalMuted);
    if (videoRef.current) {
      videoRef.current.muted = isGlobalMuted;
    }
  }, [isGlobalMuted]);

  // Sync playback speed
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Load and play video when item changes
  useEffect(() => {
    if (!item?.Id) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setHasError(false);
    setErrorMessage('');
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
      videoEl.playbackRate = playbackSpeed;
      videoEl.muted = isTileMuted;
      videoEl.play().catch(() => {
        videoEl.muted = true;
        setIsTileMuted(true);
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
          videoEl.playbackRate = playbackSpeed;
          videoEl.play().catch(() => {
            videoEl.muted = true;
            setIsTileMuted(true);
            videoEl.play().catch(() => {});
          });
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            setHasError(true);
            setErrorMessage('视频解码或转码失败');
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
  }, [item?.Id, tileId]);

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

  const handleScrubberMouseMove = (e) => {
    if (isDraggingScrubberRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const duration = videoRef.current?.duration || (item?.RunTimeTicks ? item.RunTimeTicks / 10000000 : 0);
    
    setHoverScrubberTime(duration * pos);
    setHoverScrubberPercent(pos);
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
    setIsTileMuted(nextMuted);
  };

  const toggleFullscreen = (e) => {
    if (e) e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // MOUSE MIDDLE-CLICK (AuxClick button === 1)
  const handleAuxClick = (e) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      if (onSkip) onSkip(tileId);
    }
  };

  // Toggle Favorite
  const handleToggleFavorite = async (e) => {
    if (e) e.stopPropagation();
    if (!item?.Id) return;
    const isFav = !!item.UserData?.IsFavorite;
    const nextFav = !isFav;
    
    if (onUpdateItem) {
      onUpdateItem({
        ...item,
        UserData: { ...item.UserData, IsFavorite: nextFav }
      });
    }

    try {
      await jellyfin.toggleFavorite(item.Id, nextFav);
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
  };

  // Toggle Played Status
  const handleTogglePlayed = async (e) => {
    if (e) e.stopPropagation();
    if (!item?.Id) return;
    const isPlayed = !!item.UserData?.Played;
    const nextPlayed = !isPlayed;
    const playCount = nextPlayed ? (item.UserData?.PlayCount || 0) + 1 : Math.max(0, (item.UserData?.PlayCount || 1) - 1);

    if (onUpdateItem) {
      onUpdateItem({
        ...item,
        UserData: { ...item.UserData, Played: nextPlayed, PlayCount: playCount }
      });
    }

    try {
      await jellyfin.markPlayed(item.Id, nextPlayed);
    } catch (err) {
      console.error('Failed to toggle played status:', err);
    }
  };

  const coverUrl = useMemo(() => {
    if (!item?.Id) return null;
    return jellyfin.getImageUrl(item.Id, item.ImageTags?.Primary, 'Primary', 600, 80);
  }, [item?.Id, item?.ImageTags]);

  const isFavorite = !!item?.UserData?.IsFavorite;
  const playCount = item?.UserData?.PlayCount || 0;

  return (
    <div
      ref={containerRef}
      onAuxClick={handleAuxClick}
      onWheel={handleWheel}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setShowPlayerMenu(false);
      }}
      className={`relative w-full h-full bg-black rounded-xl border border-slate-800/80 shadow-2xl flex flex-col justify-center items-center select-none touch-none ${
        is4Window ? 'overflow-visible' : 'overflow-hidden'
      }`}
      style={{ filter: `brightness(${brightness})`, zIndex: isHovered || isWheelSeeking ? 40 : 10 }}
      {...touchHandlers}
    >
      {/* Complete Uncropped Poster Cover Artwork */}
      {coverUrl && (
        <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none flex items-center justify-center rounded-xl">
          <img
            src={coverUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-25 blur-lg scale-110"
          />
          <img
            src={coverUrl}
            alt={item?.Name || 'Poster'}
            className={`relative max-w-full max-h-full object-contain transition-all duration-500 ${
              isLoading 
                ? 'opacity-60 blur-xs scale-100' 
                : !isPlaying 
                  ? 'opacity-80 scale-100' 
                  : 'opacity-0 scale-95'
            }`}
          />
        </div>
      )}

      {/* Main Video Element */}
      <video
        ref={videoRef}
        playsInline
        crossOrigin="anonymous"
        className="w-full h-full object-contain z-10 cursor-pointer rounded-xl"
        onClick={togglePlay}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => {
          setIsLoading(false);
          setIsPlaying(true);
        }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => onSkip && onSkip(tileId)}
        onTimeUpdate={handleTimeUpdate}
      />

      {/* INLINE VR WEBGL PROJECTION CANVAS (Renders inside this tile, no fullscreen popup!) */}
      <InlineVrCanvas
        videoRef={videoRef}
        isActive={isVrActive}
        onClose={() => setIsVrActive(false)}
      />

      {/* Mobile Touch Gesture HUD Overlay */}
      {gestureState.type && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none animate-in fade-in zoom-in-95 duration-100">
          <div className="flex flex-col items-center gap-2 bg-black/80 backdrop-blur-md px-4 py-3 rounded-2xl border border-white/10 shadow-2xl text-white">
            {gestureState.type === 'seek' && <FastForward size={24} className="text-cyan-400 animate-pulse" />}
            {gestureState.type === 'brightness' && <Sun size={24} className="text-amber-400" />}
            {gestureState.type === 'volume' && <Volume2 size={24} className="text-cyan-400" />}
            {gestureState.type === 'speed_boost' && <Zap size={24} className="text-amber-400 animate-bounce" />}
            <span className="font-mono font-bold text-xs">{gestureState.text}</span>
          </div>
        </div>
      )}

      {/* 
        Pinned Poster Floating PIP View:
        - ENABLED BY DEFAULT
        - ENLARGED BY 1.5x (w-36 sm:w-44 aspect-[2/3])
        - Clean close button & click for lightbox
      */}
      {showPinnedPoster && coverUrl && (
        <div 
          className={`absolute z-30 w-36 sm:w-44 aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl border-2 border-cyan-400/60 bg-black/90 backdrop-blur-md animate-in zoom-in-95 duration-200 group/poster-pip cursor-pointer ${
            isBottomRowIn4Window ? 'bottom-12 right-3' : 'top-10 right-3'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            setShowPosterModal(true);
          }}
          title="点击查看大图"
        >
          <img src={coverUrl} alt="Cover" className="w-full h-full object-cover transition-transform group-hover/poster-pip:scale-105" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowPinnedPoster(false);
            }}
            className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/80 text-white/80 hover:text-white hover:bg-red-500/80 transition"
            title="隐藏海报"
          >
            <X size={13} />
          </button>
          <div className="absolute bottom-0 inset-x-0 bg-black/70 px-2 py-0.5 text-[10px] text-center text-cyan-300 font-medium truncate backdrop-blur-xs">
            {item?.Name}
          </div>
        </div>
      )}

      {/* Loading Spinner */}
      {isLoading && !hasError && (
        <div className="absolute z-20 flex flex-col items-center justify-center pointer-events-none gap-2">
          <div className="w-10 h-10 border-4 border-jf-accent/30 border-t-jf-accent rounded-full animate-spin" />
          <span className="text-xs font-mono text-cyan-200/80 drop-shadow">加载视频流...</span>
        </div>
      )}

      {/* Paused Center Indicator */}
      {!isPlaying && !isLoading && !hasError && (
        <div 
          onClick={togglePlay}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/20 backdrop-blur-xs cursor-pointer group/play"
        >
          <div className="w-14 h-14 rounded-full bg-black/60 border border-white/20 flex items-center justify-center text-white shadow-2xl group-hover/play:scale-110 group-hover/play:bg-jf-accent transition-all duration-300">
            <Play size={24} className="ml-1 fill-white" />
          </div>
          <span className="text-xs font-medium text-gray-200 mt-2.5 drop-shadow bg-black/50 px-2.5 py-1 rounded-full border border-white/10">
            已暂停 (点击播放)
          </span>
        </div>
      )}

      {/* Error Overlay */}
      {hasError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/80 gap-3 p-4 text-center rounded-xl">
          <div className="text-jf-danger text-sm font-semibold">{errorMessage || '播放失败'}</div>
          <button
            onClick={() => onSkip && onSkip(tileId)}
            className="px-3 py-1.5 bg-jf-accent hover:bg-jf-accentHover text-xs font-medium rounded-md transition"
          >
            切换下一个视频
          </button>
        </div>
      )}

      {/* Badges: Top-Left for top tiles, BOTTOM-LEFT for 4-window bottom row */}
      <div className={`absolute left-2.5 z-20 flex items-center gap-1.5 pointer-events-none ${
        isBottomRowIn4Window ? 'bottom-3' : 'top-2.5'
      }`}>
        <div 
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-black/60 backdrop-blur-md border border-white/10 text-[11px] font-mono font-medium text-cyan-300 shadow-sm"
          title={`已播放 ${playCount} 次`}
        >
          <Eye size={12} className="text-cyan-400" />
          <span>{playCount}</span>
        </div>

        {item?.CommunityRating && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-black/60 backdrop-blur-md border border-white/10 text-[11px] font-mono font-medium text-amber-300 shadow-sm">
            <Star size={11} className="fill-amber-400 text-amber-400" />
            <span>{item.CommunityRating.toFixed(1)}</span>
          </div>
        )}
      </div>

      {/* Quick Actions: Top-Right for top tiles, BOTTOM-RIGHT for 4-window bottom row */}
      <div className={`absolute right-2.5 z-20 flex items-center gap-1.5 transition-opacity duration-200 ${
        isBottomRowIn4Window ? 'bottom-3' : 'top-2.5'
      } ${isHovered ? 'opacity-100' : 'opacity-80 md:opacity-0 group-hover:opacity-100'}`}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowPinnedPoster(!showPinnedPoster);
          }}
          className={`p-1.5 rounded-md backdrop-blur-md border transition-all ${
            showPinnedPoster 
              ? 'bg-cyan-500/30 border-cyan-400 text-cyan-300 shadow-md' 
              : 'bg-black/60 border-white/10 text-gray-300 hover:text-cyan-400 hover:bg-black/80'
          }`}
          title="浮动展示高清海报 (默认开启 1.5倍)"
        >
          <ImageIcon size={14} />
        </button>

        {/* Inline VR Toggle Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsVrActive(!isVrActive);
          }}
          className={`p-1.5 rounded-md backdrop-blur-md border transition-all ${
            isVrActive 
              ? 'bg-amber-500/40 border-amber-400 text-amber-300 shadow-md animate-pulse' 
              : 'bg-black/60 border-white/10 text-gray-300 hover:text-amber-400 hover:bg-black/80'
          }`}
          title="🥽 开启/退出 当前窗口 VR 180° / 360° 全景"
        >
          <Glasses size={14} />
        </button>

        <button
          onClick={handleToggleFavorite}
          className={`p-1.5 rounded-md backdrop-blur-md border transition-all ${
            isFavorite 
              ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' 
              : 'bg-black/60 border-white/10 text-gray-300 hover:text-amber-400 hover:bg-black/80'
          }`}
          title={isFavorite ? '取消收藏' : '加入最爱'}
        >
          <Star size={14} className={isFavorite ? 'fill-amber-400' : ''} />
        </button>

        <button
          onClick={handleTogglePlayed}
          className="p-1.5 rounded-md bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/10 text-gray-300 hover:text-cyan-400 transition"
          title={item?.UserData?.Played ? '标记为未播' : '标记为已播'}
        >
          {item?.UserData?.Played ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>

        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowPlayerMenu(!showPlayerMenu);
            }}
            className="p-1.5 rounded-md bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/10 text-gray-300 hover:text-cyan-400 transition"
            title="调用外部播放器 (MPV / PotPlayer / VLC)"
          >
            <ExternalLink size={14} />
          </button>

          {showPlayerMenu && (
            <div 
              className={`absolute right-0 w-32 glass-panel rounded-md shadow-2xl py-1 z-30 text-xs text-gray-200 divide-y divide-white/5 ${
                isBottomRowIn4Window ? 'bottom-8' : 'top-8'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
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

        <button
          onClick={(e) => {
            e.stopPropagation();
            if (onSkip) onSkip(tileId);
          }}
          className="p-1.5 rounded-md bg-jf-accent/80 hover:bg-jf-accent text-white backdrop-blur-md border border-cyan-400/30 transition shadow"
          title="切换下一个"
        >
          <SkipForward size={14} />
        </button>
      </div>

      {/* Floating Scrubber & Info Bar */}
      <div 
        className={`absolute inset-x-0 z-30 p-3 transition-all duration-300 ${scrubberPositionClass} ${
          isBottomRowIn4Window 
            ? 'pt-2.5 pb-4 bg-gradient-to-b from-black/95 via-black/80 to-transparent' 
            : 'pt-6 pb-2.5 bg-gradient-to-t from-black/95 via-black/80 to-transparent'
        } ${
          isHovered || isWheelSeeking ? 'opacity-100 translate-y-0' : 'opacity-90 md:opacity-0 md:translate-y-2'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Scrubber Container with Real-Time Mouse Drag */}
        <div className="relative w-full mb-2">
          <TrickplayScrubberThumbnail
            item={item}
            hoverTime={hoverScrubberTime}
            hoverPercent={hoverScrubberPercent}
            containerWidth={scrubberWidth}
            position={trickplayPosition}
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

        {/* Bar info row */}
        <div className="flex items-center justify-between text-xs text-gray-300 gap-2">
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <div className="flex flex-col min-w-0">
              <div 
                onClick={() => setShowPosterModal(true)}
                className="font-semibold text-white truncate max-w-[160px] sm:max-w-[220px] text-xs drop-shadow hover:text-cyan-300 cursor-pointer transition" 
                title={item?.Name}
              >
                {item?.Name || '未知影片'}
              </div>
              <div className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5 font-mono">
                <span>{currentTimeText} / {durationText}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={togglePlay}
              className="p-1 hover:bg-white/15 rounded text-white transition"
              title={isPlaying ? '暂停' : '播放'}
            >
              {isPlaying ? <Pause size={13} /> : <Play size={13} />}
            </button>

            <button
              onClick={toggleMute}
              className="p-1 hover:bg-white/15 rounded text-white transition"
              title={isTileMuted ? '取消静音' : '静音'}
            >
              {isTileMuted ? <VolumeX size={13} className="text-gray-400" /> : <Volume2 size={13} className="text-cyan-400" />}
            </button>

            <button
              onClick={toggleFullscreen}
              className="p-1 hover:bg-white/15 rounded text-white transition"
              title="全屏"
            >
              <Maximize size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Poster Lightbox */}
      {showPosterModal && coverUrl && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200"
          onClick={() => setShowPosterModal(false)}
        >
          <div 
            className="relative max-w-md w-full glass-panel rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3.5 border-b border-white/5 flex items-center justify-between bg-black/40">
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <Film size={16} className="text-cyan-400 flex-shrink-0" />
                <span className="text-sm font-bold text-white truncate">{item?.Name}</span>
              </div>
              <button
                onClick={() => setShowPosterModal(false)}
                className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="relative w-full max-h-[55vh] bg-black/80 flex items-center justify-center overflow-hidden">
              <img
                src={coverUrl}
                alt={item?.Name}
                className="max-h-[55vh] w-auto object-contain shadow-2xl"
              />
            </div>

            <div className="p-4 flex flex-col gap-2 bg-slate-900/90 text-xs text-gray-300 overflow-y-auto">
              <div className="flex items-center justify-between">
                <span className="font-mono text-cyan-300">{item?.ProductionYear || '未知年份'}</span>
                {item?.CommunityRating && (
                  <span className="flex items-center gap-1 font-mono text-amber-300 font-bold">
                    <Star size={12} className="fill-amber-400" />
                    {item.CommunityRating.toFixed(1)}
                  </span>
                )}
              </div>

              {item?.Overview && (
                <div className="text-[11px] text-gray-400 leading-relaxed max-h-24 overflow-y-auto">
                  {item.Overview}
                </div>
              )}

              <div className="flex justify-end gap-2 mt-1">
                <button
                  onClick={() => {
                    setShowPosterModal(false);
                    setIsVrActive(true);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-300 text-xs font-medium flex items-center gap-1"
                >
                  <Glasses size={13} />
                  <span>开启当前窗口 VR</span>
                </button>

                <button
                  onClick={() => {
                    setShowPosterModal(false);
                    if (onSkip) onSkip(tileId);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-jf-accent hover:bg-cyan-400 text-white text-xs font-medium flex items-center gap-1"
                >
                  <SkipForward size={13} />
                  <span>换下一个视频</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
