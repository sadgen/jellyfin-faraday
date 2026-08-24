import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Hls from 'hls.js';
import { jellyfin } from '../api/jellyfinClient';
import { getTrickplayStyle } from '../utils/trickplay';
import { useExternalPlayer } from '../hooks/useExternalPlayer';
import { useTouchGestures } from '../hooks/useTouchGestures';
import TrickplayScrubberThumbnail from './TrickplayScrubberThumbnail';
import InlineVrCanvas from './InlineVrCanvas';
import DeleteConfirmModal from './DeleteConfirmModal';
import { detectVrVideo } from '../utils/vrDetector';
import { 
  Play, Pause, Volume2, VolumeX, Maximize, 
  Star, Eye, EyeOff, ExternalLink, X, Film, 
  SkipForward, SkipBack, Sun, Zap, FastForward, Glasses, Trash2, Gauge
} from 'lucide-react';

export const QUALITY_OPTIONS = [
  { id: 'direct', label: '🎬 原画直推 (原始码率)', shortLabel: '原画', bitrate: 0 },
  { id: '8000000', label: '🌟 极清 8 Mbps (1080p)', shortLabel: '8M', bitrate: 8000000 },
  { id: '4000000', label: '⚡ 流畅 4 Mbps (1080p)', shortLabel: '4M', bitrate: 4000000 },
  { id: '2000000', label: '🚀 标清 2 Mbps (720p)', shortLabel: '2M', bitrate: 2000000 },
  { id: '1000000', label: '📱 省流 1 Mbps (480p)', shortLabel: '1M', bitrate: 1000000 }
];

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function VideoPlayerModal({
  isOpen,
  item,
  onClose,
  onNext,
  onPrev,
  onUpdateItem,
  onDeleteItem,
  onOpenVr
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
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [isVrActive, setIsVrActive] = useState(false);
  const [detectedVrMode, setDetectedVrMode] = useState('180_3d_sbs');

  // Stream Quality: 'direct' | '8000000' | '4000000' | '2000000' | '1000000'
  const [streamQuality, setStreamQuality] = useState('direct');
  const isSmoothMode = streamQuality !== 'direct';
  const [smoothToast, setSmoothToast] = useState('');

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

  // Mouse Wheel Seek State
  const [isWheelSeeking, setIsWheelSeeking] = useState(false);
  const wheelTimerRef = useRef(null);
  const wheelSeekingTimeRef = useRef(null);

  // Playback reporting & PlayCount Tracking
  const playReportTimerRef = useRef(null);
  const hasCountedPlayRef = useRef(false);

  const { launchPlayer } = useExternalPlayer();

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // Mobile Touch Gestures with real-time Trickplay preview
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
    onSeekPreview: (targetTime, percent) => {
      setHoverScrubberTime(targetTime);
      setHoverScrubberPercent(percent);
      setIsWheelSeeking(true);
      if (scrubberRef.current) {
        setScrubberWidth(scrubberRef.current.getBoundingClientRect().width);
      }
    },
    onSeekPreviewEnd: () => {
      setTimeout(() => {
        setHoverScrubberTime(null);
        setIsWheelSeeking(false);
      }, 600);
    },
    onTogglePlay: togglePlay,
    normalSpeed: playbackSpeed,
    onSpeedChange: (speed) => {
      setPlaybackSpeed(speed);
      if (videoRef.current) videoRef.current.playbackRate = speed;
    }
  });

  const playbackSpeedRef = useRef(playbackSpeed);
  playbackSpeedRef.current = playbackSpeed;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const itemRef = useRef(item);
  itemRef.current = item;
  const onUpdateItemRef = useRef(onUpdateItem);
  onUpdateItemRef.current = onUpdateItem;

  // Cleanup timers on component unmount
  useEffect(() => {
    return () => {
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
      if (playReportTimerRef.current) clearInterval(playReportTimerRef.current);
    };
  }, []);

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
    setIsWheelSeeking(false);

    const videoEl = videoRef.current;
    if (!videoEl) return;

    // Auto-detect VR Video format (pure 2D vs 3D-to-2D vs true VR)
    const initialVr = detectVrVideo(item, videoEl);
    if (initialVr.isVr) {
      setIsVrActive(true);
      setDetectedVrMode(initialVr.mode);
    } else {
      setIsVrActive(false);
    }

    hasCountedPlayRef.current = false;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Determine initial seek time: Trickplay click time > server resumeTicks > 0
    const initialSeekTime = (item.startSecond !== undefined && item.startSecond !== null)
      ? item.startSecond
      : (item.UserData?.PlaybackPositionTicks ? item.UserData.PlaybackPositionTicks / 10000000 : 0);

    const onLoadedMetadata = () => {
      if (initialSeekTime > 0 && videoEl) {
        videoEl.currentTime = initialSeekTime;
      }
      // Re-verify with decoded video dimensions
      const vrCheck = detectVrVideo(item, videoEl);
      if (vrCheck.isVr) {
        setIsVrActive(true);
        setDetectedVrMode(vrCheck.mode);
      }
    };
    videoEl.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
    if (initialSeekTime > 0 && videoEl.readyState >= 1) {
      videoEl.currentTime = initialSeekTime;
    }

    // Report playback start to Jellyfin
    jellyfin.reportPlayback(item.Id, initialSeekTime, false, 'Started');

    // Periodic progress reporting (every 10s)
    if (playReportTimerRef.current) clearInterval(playReportTimerRef.current);
    playReportTimerRef.current = setInterval(() => {
      if (videoEl && !videoEl.paused && videoEl.currentTime > 0) {
        jellyfin.reportPlayback(item.Id, videoEl.currentTime, false, 'Progress');
        
        // Count playback if played for >= 10s
        if (!hasCountedPlayRef.current && videoEl.currentTime >= 10) {
          hasCountedPlayRef.current = true;
          const currentItem = itemRef.current;
          const nextCount = (currentItem?.UserData?.PlayCount || 0) + 1;
          if (onUpdateItemRef.current && currentItem) {
            onUpdateItemRef.current({
              ...currentItem,
              UserData: { ...currentItem.UserData, PlayCount: nextCount }
            });
          }
        }
      }
    }, 10000);

    const directStreamUrl = jellyfin.getStreamUrl(item.Id);
    const hlsUrl = jellyfin.getHlsUrl(item.Id);

    const setupHlsPlay = (customUrl = null) => {
      const targetUrl = customUrl || (isSmoothMode ? jellyfin.getSmoothHlsUrl(item.Id) : hlsUrl);
      
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch (e) {}
        hlsRef.current = null;
      }
      videoEl.removeAttribute('src');
      videoEl.load();

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 30
        });
        hlsRef.current = hls;
        hls.loadSource(targetUrl);
        hls.attachMedia(videoEl);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoEl.playbackRate = playbackSpeedRef.current;
          if (initialSeekTime > 0) videoEl.currentTime = initialSeekTime;
          videoEl.play().catch(() => {
            videoEl.muted = true;
            setIsMuted(true);
            videoEl.play().catch(() => {});
          });
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            setHasError(true);
            setErrorMessage('视频加载失败，请重试');
          }
        });
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = targetUrl;
        if (initialSeekTime > 0) videoEl.currentTime = initialSeekTime;
        videoEl.play().catch(() => {
          videoEl.muted = true;
          setIsMuted(true);
          videoEl.play().catch(() => {});
        });
      } else {
        setHasError(true);
        setErrorMessage('浏览器不支持此视频流');
      }
    };

    const handleDirectError = () => {
      setupHlsPlay();
    };

    const setupDirectPlay = () => {
      if (streamQuality !== 'direct') {
        const bitrate = parseInt(streamQuality, 10) || 4000000;
        setupHlsPlay(jellyfin.getSmoothHlsUrl(item.Id, bitrate));
        return;
      }

      videoEl.src = directStreamUrl;
      videoEl.playbackRate = playbackSpeedRef.current;
      videoEl.muted = isMutedRef.current;
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
      if (playReportTimerRef.current) clearInterval(playReportTimerRef.current);
      if (videoEl && videoEl.currentTime > 0) {
        jellyfin.reportPlayback(item.Id, videoEl.currentTime, true, 'Stopped');
      }
      videoEl.removeEventListener('error', handleDirectError);
      videoEl.removeEventListener('loadedmetadata', onLoadedMetadata);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      videoEl.removeAttribute('src');
      videoEl.load();
    };
  }, [isOpen, item?.Id]);

  // Switch Stream Quality / Transcode Bitrate seamlessly
  const changeStreamQuality = useCallback((qualityId, silent = false) => {
    const videoEl = videoRef.current;
    if (!videoEl || !item?.Id) return;

    setStreamQuality(qualityId);
    setShowQualityMenu(false);
    const currentPos = videoEl.currentTime || 0;
    const speed = playbackSpeedRef.current;
    const muted = isMutedRef.current;

    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch (e) {}
      hlsRef.current = null;
    }

    if (qualityId === 'direct') {
      videoEl.src = jellyfin.getStreamUrl(item.Id);
      videoEl.currentTime = currentPos;
      videoEl.playbackRate = speed;
      videoEl.muted = muted;
      videoEl.play().catch(() => {});
      if (!silent) {
        setSmoothToast('🎬 已切换为原画直推模式');
        setTimeout(() => setSmoothToast(''), 3000);
      }
    } else {
      const bitrate = parseInt(qualityId, 10) || 4000000;
      const smoothUrl = jellyfin.getSmoothHlsUrl(item.Id, bitrate);
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 30
        });
        hlsRef.current = hls;
        hls.loadSource(smoothUrl);
        hls.attachMedia(videoEl);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoEl.playbackRate = speed;
          videoEl.muted = muted;
          if (currentPos > 0) videoEl.currentTime = currentPos;
          videoEl.play().catch(() => {});
        });
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = smoothUrl;
        videoEl.currentTime = currentPos;
        videoEl.playbackRate = speed;
        videoEl.play().catch(() => {});
      }
      if (!silent) {
        const opt = QUALITY_OPTIONS.find(q => q.id === qualityId);
        setSmoothToast(`⚡ 已切换为 ${opt?.shortLabel || qualityId} 转码模式`);
        setTimeout(() => setSmoothToast(''), 3000);
      }
    }
  }, [item?.Id]);

  // Backward compatibility alias for diagnostics
  const switchToSmoothMode = useCallback((enable = true, silent = false) => {
    changeStreamQuality(enable ? '4000000' : 'direct', silent);
  }, [changeStreamQuality]);

  // Automatic stutter & frame-drop diagnosis loop (Tampermonkey original: ONLY when continuously playing with dropped frames)
  useEffect(() => {
    if (!isOpen) return;
    const video = videoRef.current;
    if (!video) return;

    let lastDecoded = 0;
    let lastDropped = 0;

    const diagInterval = setInterval(() => {
      if (!video || video.paused || video.ended || isDraggingScrubberRef.current || isWheelSeeking || streamQuality !== 'direct') return;
      if (typeof video.getVideoPlaybackQuality === 'function') {
        const q = video.getVideoPlaybackQuality();
        const totalDecoded = q.totalVideoFrames;
        const totalDropped = q.droppedVideoFrames;
        const periodDropped = totalDropped - lastDropped;
        const periodDecoded = totalDecoded - lastDecoded;
        lastDecoded = totalDecoded;
        lastDropped = totalDropped;

        if (totalDecoded > 30) {
          const dropRate = (totalDropped / totalDecoded) * 100;
          if (dropRate > 5.0 || (periodDropped > 8 && periodDecoded > 15)) {
            console.warn(`[Faraday ⚡] 影院播放掉帧率: ${dropRate.toFixed(2)}%，自动切为流畅模式`);
            changeStreamQuality('4000000', true);
            setSmoothToast(`⚡ 检测到网页掉帧 (${dropRate.toFixed(1)}%)，已自动切换为流畅模式`);
            setTimeout(() => setSmoothToast(''), 3500);
          }
        }
      }
    }, 3000);

    return () => {
      clearInterval(diagInterval);
    };
  }, [isOpen, streamQuality, isWheelSeeking, changeStreamQuality]);

  // Video Ended -> increment play count and next
  const handleEnded = () => {
    if (!hasCountedPlayRef.current) {
      hasCountedPlayRef.current = true;
      const nextCount = (item.UserData?.PlayCount || 0) + 1;
      if (onUpdateItem) {
        onUpdateItem({
          ...item,
          UserData: { ...item.UserData, Played: true, PlayCount: nextCount }
        });
      }
    }
    jellyfin.reportPlayback(item.Id, videoRef.current?.duration || 0, true, 'Stopped');
    if (onNext) onNext();
  };

  // Mouse Wheel Fast-Forward / Rewind
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

  const handleScrubberTouchStart = useCallback((e) => {
    if (e.touches.length !== 1) return;
    isDraggingScrubberRef.current = true;
    updateScrubberDrag(e.touches[0].clientX);
  }, [updateScrubberDrag]);

  const handleScrubberTouchMove = useCallback((e) => {
    if (e.touches.length !== 1) return;
    if (isDraggingScrubberRef.current) {
      e.preventDefault();
      updateScrubberDrag(e.touches[0].clientX);
    }
  }, [updateScrubberDrag]);

  const handleScrubberTouchEnd = useCallback(() => {
    if (isDraggingScrubberRef.current) {
      isDraggingScrubberRef.current = false;
      setTimeout(() => setHoverScrubberTime(null), 800);
    }
  }, []);

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

  // Toggle Favorite
  const handleToggleFavorite = async () => {
    if (!item?.Id) return;
    const isFav = !!item.UserData?.IsFavorite;
    const nextFav = !isFav;
    if (onUpdateItem) {
      onUpdateItem({ ...item, UserData: { ...item.UserData, IsFavorite: nextFav } });
    }
    try {
      await jellyfin.toggleFavorite(item.Id, nextFav);
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
  };

  // Toggle Played Status
  const handleTogglePlayed = async () => {
    if (!item?.Id) return;
    const isPlayed = !!item.UserData?.Played;
    const nextPlayed = !isPlayed;
    const playCount = nextPlayed ? (item.UserData?.PlayCount || 0) + 1 : Math.max(0, (item.UserData?.PlayCount || 1) - 1);
    if (onUpdateItem) {
      onUpdateItem({ ...item, UserData: { ...item.UserData, Played: nextPlayed, PlayCount: playCount } });
    }
    try {
      await jellyfin.markPlayed(item.Id, nextPlayed);
    } catch (err) {
      console.error('Failed to toggle played status:', err);
    }
  };

  // Delete Video from Disk (custom modal)
  const handleDeleteVideo = () => {
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!item?.Id) return;
    try {
      await jellyfin.deleteItem(item.Id);
      if (onDeleteItem) onDeleteItem(item.Id);
      onClose();
    } catch (err) {
      alert(err.message || '删除失败');
    }
  };

  const posterUrl = item?.Id ? (jellyfin.getImageUrl(item.Id, item.ImageTags?.Backdrop || item.ImageTags?.Primary, 'Backdrop', 800, 80) || jellyfin.getImageUrl(item.Id, item.ImageTags?.Primary, 'Primary', 800, 80)) : null;
  const isFavorite = !!item?.UserData?.IsFavorite;
  const playCount = item?.UserData?.PlayCount || 0;

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
        <div className="p-3 sm:p-3.5 border-b border-white/5 flex items-center justify-between bg-black/60 text-xs z-30 pt-[max(0.75rem,env(safe-area-inset-top))] flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <Film size={18} className="text-cyan-400 flex-shrink-0" />
            <span className="font-bold text-white text-sm truncate">{item?.Name}</span>
            {item?.ProductionYear && (
              <span className="text-gray-400 font-mono hidden sm:inline">({item.ProductionYear})</span>
            )}
            <span className="hidden xs:flex items-center gap-1 font-mono text-[11px] text-cyan-300 bg-white/5 px-2 py-0.5 rounded-full">
              <Eye size={11} className="text-cyan-400" />
              <span>{playCount}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Inline VR Mode */}
            <button
              onClick={() => setIsVrActive(!isVrActive)}
              className={`px-2.5 py-1.5 rounded-lg border font-bold transition flex items-center gap-1.5 ${
                isVrActive 
                  ? 'bg-amber-500/40 border-amber-400 text-amber-300 animate-pulse' 
                  : 'bg-amber-500/20 hover:bg-amber-500/30 border-amber-400/40 text-amber-300'
              }`}
              title="🥽 开启/退出 VR 180° / 360° 全景模式"
            >
              <Glasses size={14} />
              <span className="hidden sm:inline">{isVrActive ? '退出 VR' : '开启 VR'}</span>
            </button>

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
          {posterUrl && (
            <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none flex items-center justify-center">
              <img 
                src={posterUrl} 
                alt="" 
                className="absolute inset-0 w-full h-full object-cover opacity-25 blur-lg scale-110" 
              />
              <img 
                src={posterUrl} 
                alt="Poster" 
                className={`relative max-w-full max-h-full object-contain transition-opacity duration-500 ${
                  isLoading ? 'opacity-70 blur-sm' : 'opacity-0'
                }`} 
              />
            </div>
          )}

          <video
            ref={videoRef}
            playsInline
            crossOrigin="anonymous"
            className="w-full h-full object-contain cursor-pointer z-10"
            onClick={togglePlay}
            onWaiting={() => setIsLoading(true)}
            onPlaying={() => {
              setIsLoading(false);
              setIsPlaying(true);
            }}
            onLoadedData={() => setIsLoading(false)}
            onCanPlay={() => setIsLoading(false)}
            onPause={() => setIsPlaying(false)}
            onEnded={handleEnded}
            onTimeUpdate={handleTimeUpdate}
          />

          {/* INLINE VR WEBGL CANVAS */}
          <InlineVrCanvas
            videoRef={videoRef}
            isActive={isVrActive}
            onClose={() => setIsVrActive(false)}
            initialMode={detectedVrMode}
          />

          {/* Smooth Mode Notification Toast */}
          {smoothToast && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 px-4 py-1.5 bg-black/85 backdrop-blur-md border border-cyan-400/60 rounded-full text-xs font-bold text-cyan-300 shadow-2xl pointer-events-none animate-in fade-in duration-150">
              {smoothToast}
            </div>
          )}

          {/* Touch Gesture HUD Overlay */}
          {gestureState.type && (
            <div className={`absolute inset-0 z-30 flex items-center justify-center pointer-events-none animate-in fade-in zoom-in-95 duration-100 transition-opacity ${gestureState.fading ? 'opacity-0 duration-500' : 'opacity-100'}`}>
              <div className="flex flex-col items-center gap-2 bg-black/80 backdrop-blur-md px-5 py-3.5 rounded-2xl border border-white/10 shadow-2xl text-white">
                {gestureState.type === 'seek' && <FastForward size={28} className="text-cyan-400 animate-pulse" />}
                {gestureState.type === 'brightness' && <Sun size={28} className="text-amber-400" />}
                {(gestureState.type === 'speed_step' || gestureState.type === 'speed_boost') && <Gauge size={28} className="text-amber-400" />}
                
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
        <div className="p-3 sm:p-4 bg-slate-900/95 border-t border-white/5 flex flex-col gap-2.5 pb-[max(1.25rem,env(safe-area-inset-bottom))] z-30 flex-shrink-0">
          {/* Scrubber Container with Real-Time Mouse Drag */}
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
              className="w-full h-2.5 hover:h-3.5 bg-white/20 rounded-full cursor-pointer transition-all relative overflow-hidden group/bar touch-none"
              onMouseDown={handleScrubberMouseDown}
              onMouseMove={handleScrubberMouseMove}
              onMouseLeave={handleScrubberMouseLeave}
              onTouchStart={handleScrubberTouchStart}
              onTouchMove={handleScrubberTouchMove}
              onTouchEnd={handleScrubberTouchEnd}
              onTouchCancel={handleScrubberTouchEnd}
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
          <div className="flex items-center justify-between text-xs text-gray-300 gap-1 flex-wrap sm:flex-nowrap">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                onClick={togglePlay}
                className="p-2 sm:p-2.5 rounded-xl bg-jf-accent hover:bg-cyan-400 text-white transition shadow-lg"
              >
                {isPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
              </button>

              {onPrev && (
                <button
                  onClick={onPrev}
                  className="p-2 rounded-xl bg-black/40 hover:bg-white/10 text-gray-300 transition"
                  title="上一个"
                >
                  <SkipBack size={14} />
                </button>
              )}

              {onNext && (
                <button
                  onClick={onNext}
                  className="p-2 rounded-xl bg-black/40 hover:bg-white/10 text-gray-300 transition"
                  title="下一个"
                >
                  <SkipForward size={14} />
                </button>
              )}

              <button
                onClick={toggleMute}
                className="p-2 rounded-xl bg-black/40 hover:bg-white/10 text-gray-300 transition"
              >
                {isMuted ? <VolumeX size={14} className="text-gray-400" /> : <Volume2 size={14} className="text-cyan-400" />}
              </button>

              <span className="font-mono text-gray-400 text-[11px] hidden xs:inline">
                {currentTimeText} / {durationText}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Favorite */}
              <button
                onClick={handleToggleFavorite}
                className={`p-2 rounded-xl border transition ${
                  isFavorite ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'bg-black/40 border-white/5 text-gray-300 hover:text-amber-400'
                }`}
                title={isFavorite ? '取消收藏' : '加入最爱'}
              >
                <Star size={14} className={isFavorite ? 'fill-amber-400' : ''} />
              </button>

              {/* Played */}
              <button
                onClick={handleTogglePlayed}
                className="p-2 rounded-xl bg-black/40 border border-white/5 text-gray-300 hover:text-cyan-400 transition"
                title={item?.UserData?.Played ? '标记未播' : '标记已播'}
              >
                {item?.UserData?.Played ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>

              {/* Delete Video */}
              <button
                onClick={handleDeleteVideo}
                className="p-2 rounded-xl bg-black/40 border border-white/5 text-gray-400 hover:text-red-400 transition"
                title="从服务器和磁盘删除"
              >
                <Trash2 size={14} />
              </button>

              {/* Quality & Transcode Selector Menu */}
              <div className="relative">
                <button
                  onClick={() => setShowQualityMenu(!showQualityMenu)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition ${
                    streamQuality !== 'direct'
                      ? 'bg-cyan-500/30 text-cyan-300 border-cyan-400/50 shadow-sm shadow-cyan-500/30' 
                      : 'bg-black/40 border-white/5 text-gray-300 hover:text-cyan-300 hover:bg-white/10'
                  }`}
                  title="切换播放画质 / 转码模式"
                >
                  <Zap size={14} className={streamQuality !== 'direct' ? 'fill-cyan-400 text-cyan-400' : ''} />
                  <span>{QUALITY_OPTIONS.find(q => q.id === streamQuality)?.shortLabel || '原画'}</span>
                </button>

                {showQualityMenu && (
                  <div 
                    className="absolute right-0 bottom-10 w-44 glass-panel rounded-xl shadow-2xl py-1 z-50 text-xs text-gray-200 divide-y divide-white/5 animate-in fade-in zoom-in-95 duration-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-3 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      选择画质 / 转码
                    </div>
                    {QUALITY_OPTIONS.map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => changeStreamQuality(opt.id, false)}
                        className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition ${
                          streamQuality === opt.id
                            ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                            : 'hover:bg-white/10 text-gray-300'
                        }`}
                      >
                        <span>{opt.label}</span>
                        {streamQuality === opt.id && <span className="text-cyan-400 text-xs">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Speed */}
              <div className="flex items-center bg-black/40 px-2 py-1 rounded-xl border border-white/5 gap-1">
                <select
                  value={playbackSpeed}
                  onChange={(e) => {
                    const sp = parseFloat(e.target.value);
                    setPlaybackSpeed(sp);
                    if (videoRef.current) videoRef.current.playbackRate = sp;
                  }}
                  className="bg-transparent text-cyan-300 focus:outline-none cursor-pointer font-mono font-bold text-[11px]"
                >
                  <option value="0.5" className="bg-slate-900">0.5x</option>
                  <option value="1.0" className="bg-slate-900">1.0x</option>
                  <option value="1.25" className="bg-slate-900">1.25x</option>
                  <option value="1.5" className="bg-slate-900">1.5x</option>
                  <option value="2.0" className="bg-slate-900">2.0x</option>
                  <option value="2.5" className="bg-slate-900">2.5x</option>
                </select>
              </div>

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="p-2 rounded-xl bg-black/40 hover:bg-white/10 text-gray-300 transition"
                title="全屏"
              >
                <Maximize size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Custom Safe Delete Modal */}
      <DeleteConfirmModal
        isOpen={showDeleteModal}
        item={item}
        onConfirm={handleConfirmDelete}
        onClose={() => setShowDeleteModal(false)}
      />
    </div>
  );
}
