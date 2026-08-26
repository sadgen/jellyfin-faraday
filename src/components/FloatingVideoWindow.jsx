import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Hls from 'hls.js';
import { jellyfin } from '../api/jellyfinClient';
import { calculateSlotStyle } from '../utils/windowLayout';
import { useExternalPlayer } from '../hooks/useExternalPlayer';
import { useTouchGestures } from '../hooks/useTouchGestures';
import { SEEK_SPEED_OPTIONS, getStoredSeekSpeed, setStoredSeekSpeed, getSeekStepSeconds, getSeekSwipeSpan } from '../utils/seekSettings';
import { getPlaybackDefaults } from '../utils/playbackDefaults';
import { getDefaultSubtitleIndex } from '../utils/subtitleHelper';
import TrickplayScrubberThumbnail from './TrickplayScrubberThumbnail';
import InlineVrCanvas from './InlineVrCanvas';
import SubtitleModal from './SubtitleModal';
import { detectVrVideo } from '../utils/vrDetector';
import { 
  Play, Pause, SkipForward, Volume2, VolumeX, 
  X, ExternalLink, Star, Eye, EyeOff, Image as ImageIcon,
  Glasses, Trash2, FastForward, Sun, Zap, Gauge, RefreshCw, Subtitles
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
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function FloatingVideoWindow({
  windowData,
  onClose,
  onSkip,
  onExpand: _onExpand,
  onBringToFront,
  onUpdateItem,
  onDeleteItem
}) {
  const { id, slotIndex, item } = windowData;

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const containerRef = useRef(null);
  const scrubberRef = useRef(null);

  // Initialize position and size using exact Tampermonkey slot formula
  const [layout, setLayout] = useState(() => calculateSlotStyle(slotIndex));
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const isCustomPositionRef = useRef(false);
  const prevSlotRef = useRef(slotIndex);

  // Long-press Drag state & tactile feedback for mobile
  const [isLongPressDragging, setIsLongPressDragging] = useState(false);

  // Multi-part video list (e.g. Part 1, 2, 3 / CD1, CD2)
  const [partsList, setPartsList] = useState(() => [{ Id: item?.Id, Name: item?.Name || 'Part 1' }]);
  const [currentPartIndex, setCurrentPartIndex] = useState(0);
  const currentPartId = partsList[currentPartIndex]?.Id || item?.Id;

  // Media playback info (MediaSources, Container, Bitrate, SubtitleStreams)
  const [playbackData, setPlaybackData] = useState(null);

  // Fetch multi-part items & detailed playback info on mount or item change
  useEffect(() => {
    if (!item?.Id) return;
    jellyfin.getItemPlaybackInfo(item.Id).then(info => {
      if (info) setPlaybackData(info);
    }).catch(() => {});

    jellyfin.getAdditionalParts(item.Id).then(additional => {
      if (additional && additional.length > 0) {
        setPartsList([
          { Id: item.Id, Name: item.Name || 'Part 1' },
          ...additional.map((part, idx) => ({
            Id: part.Id,
            Name: part.Name || `Part ${idx + 2}`,
            RunTimeTicks: part.RunTimeTicks,
            MediaSources: part.MediaSources,
            MediaStreams: part.MediaStreams
          }))
        ]);
      } else {
        setPartsList([{ Id: item.Id, Name: item.Name || 'Part 1' }]);
      }
      setCurrentPartIndex(0);
    }).catch(() => {
      setPartsList([{ Id: item.Id, Name: item.Name || 'Part 1' }]);
      setCurrentPartIndex(0);
    });
  }, [item?.Id, item?.Name]);

  // Update layout when slotIndex changes (window promotion / shifting)
  useEffect(() => {
    if (prevSlotRef.current !== slotIndex) {
      prevSlotRef.current = slotIndex;
      isCustomPositionRef.current = false;
      setLayout(calculateSlotStyle(slotIndex));
    }
  }, [slotIndex]);

  useEffect(() => {
    const handleResize = () => {
      if (!isCustomPositionRef.current) {
        setLayout(calculateSlotStyle(slotIndex));
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [slotIndex]);

  // Default Playback Settings initialization
  const [playbackDefaults] = useState(() => getPlaybackDefaults());

  // Playback state
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(() => playbackDefaults.speed || 1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [showPlayerMenu, setShowPlayerMenu] = useState(false);
  const [showPosterModal, setShowPosterModal] = useState(false);
  const [showSubtitleModal, setShowSubtitleModal] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState(-1);

  // Fast Forward / Rewind / Seek Step Tier: 'slow' (5s) | 'medium' (15s, default) | 'fast' (30s)
  const [seekSpeed, setSeekSpeed] = useState(() => getStoredSeekSpeed());
  const [showSeekSpeedMenu, setShowSeekSpeedMenu] = useState(false);

  useEffect(() => {
    const handleSeekSpeedChange = (e) => {
      if (e.detail) setSeekSpeed(e.detail);
    };
    window.addEventListener('faraday:seek_speed_changed', handleSeekSpeedChange);
    return () => window.removeEventListener('faraday:seek_speed_changed', handleSeekSpeedChange);
  }, []);

  // Stream Quality: 'direct' | '8000000' | '4000000' | '2000000' | '1000000'
  const [streamQuality, setStreamQuality] = useState(() => playbackDefaults.quality || 'direct');
  const isSmoothMode = streamQuality !== 'direct';
  const [smoothToast, setSmoothToast] = useState('');

  // Pinned Poster PIP: defaults from global settings (1X on Mobile, 1.5X on Desktop)
  const [showPinnedPoster, setShowPinnedPoster] = useState(() => playbackDefaults.showPinnedPoster !== false);

  // INLINE VR Projection State (Auto-detected on load)
  const [isVrActive, setIsVrActive] = useState(false);
  const [detectedVrMode, setDetectedVrMode] = useState('180_3d_sbs');

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

  // Playback reporting & PlayCount Tracking
  const playReportTimerRef = useRef(null);
  const hasCountedPlayRef = useRef(false);

  const { launchPlayer } = useExternalPlayer();

  const dragStartPosRef = useRef({ left: 0, top: 0 });

  // Mobile Touch Gestures with real-time Trickplay preview & Long-press window drag
  const { gestureState, brightness, touchHandlers } = useTouchGestures({
    videoRef,
    containerRef,
    duration: rawDuration,
    currentTime: videoRef.current?.currentTime || 0,
    disableLongPressBoost: true,
    enableLongPressDrag: true,
    onLongPressDragStart: () => {
      setIsLongPressDragging(true);
      setIsDragging(true);
      isCustomPositionRef.current = true;
      if (onBringToFront) onBringToFront(id);
      dragStartPosRef.current = { left: layout.left, top: layout.top };
    },
    onLongPressDragMove: ({ dx, dy }) => {
      const newX = Math.max(0, Math.min(window.innerWidth - 60, dragStartPosRef.current.left + dx));
      const newY = Math.max(50, Math.min(window.innerHeight - 60, dragStartPosRef.current.top + dy));
      setLayout(prev => ({ ...prev, left: newX, top: newY }));
    },
    onLongPressDragEnd: () => {
      setIsLongPressDragging(false);
      setIsDragging(false);
    },
    customSwipeSpan: getSeekSwipeSpan(seekSpeed),
    onSeek: (target) => {
      if (videoRef.current) videoRef.current.currentTime = target;
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
    onTogglePlay: () => {
      togglePlay();
    },
    normalSpeed: playbackSpeed,
    onSpeedChange: (speed) => {
      setPlaybackSpeed(speed);
      if (videoRef.current) videoRef.current.playbackRate = speed;
    }
  });

  // Extract subtitle streams
  const mediaSource = playbackData?.MediaSources?.[0] || item?.MediaSources?.[0];
  const mediaSourceId = mediaSource?.Id || item?.Id;
  const subtitleStreams = useMemo(() => {
    const streams = mediaSource?.MediaStreams || playbackData?.MediaStreams || item?.MediaStreams || [];
    return streams.filter(s => s.Type === 'Subtitle' && !['pgssub', 'dvdsub', 'dvbsub'].includes(s.Codec?.toLowerCase()));
  }, [item, playbackData, mediaSource]);

  // Auto-detect default subtitle (or disable if hardsub flag in name e.g. C / UC)
  useEffect(() => {
    if (subtitleStreams.length > 0) {
      const defIdx = getDefaultSubtitleIndex(item, subtitleStreams);
      setSelectedSubtitleIndex(defIdx);
    }
  }, [item, subtitleStreams]);

  // Sync subtitle mode to video.textTracks
  const syncSubtitles = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !videoEl.textTracks) return;
    for (let i = 0; i < videoEl.textTracks.length; i++) {
      const track = videoEl.textTracks[i];
      const trackIndex = subtitleStreams[i]?.Index;
      if (selectedSubtitleIndex !== -1 && trackIndex === selectedSubtitleIndex) {
        track.mode = 'showing';
      } else {
        track.mode = 'hidden';
      }
    }
  }, [selectedSubtitleIndex, subtitleStreams]);

  useEffect(() => {
    syncSubtitles();
  }, [syncSubtitles]);

  const playbackSpeedRef = useRef(playbackSpeed);
  playbackSpeedRef.current = playbackSpeed;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const streamQualityRef = useRef(streamQuality);
  streamQualityRef.current = streamQuality;
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

  const currentPlayingPart = partsList[currentPartIndex] || item;

  // Load and play video when item/part changes + Report Playback to Jellyfin
  useEffect(() => {
    if (!currentPartId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setHasError(false);
    setProgress(0);
    setHoverScrubberTime(null);
    setIsWheelSeeking(false);
    hasCountedPlayRef.current = false;

    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Determine initial seek time: Trickplay click time > server resumeTicks > 0
    const initialSeekTime = (windowData.startSecond !== undefined && windowData.startSecond !== null)
      ? windowData.startSecond
      : (currentPlayingPart.UserData?.PlaybackPositionTicks ? currentPlayingPart.UserData.PlaybackPositionTicks / 10000000 : 0);

    // Auto-detect VR Video format (pure 2D vs 3D-to-2D vs true VR)
    const initialVr = detectVrVideo(currentPlayingPart, videoEl);
    if (initialVr.isVr) {
      setIsVrActive(true);
      setDetectedVrMode(initialVr.mode);
    } else {
      setIsVrActive(false);
    }

    const onLoadedMetadata = () => {
      if (initialSeekTime > 0 && videoEl) {
        videoEl.currentTime = initialSeekTime;
      }
      // Re-verify with decoded video dimensions
      const vrCheck = detectVrVideo(currentPlayingPart, videoEl);
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
    jellyfin.reportPlayback(currentPartId, initialSeekTime, false, 'Started');

    // Periodic progress reporting (every 10s)
    if (playReportTimerRef.current) clearInterval(playReportTimerRef.current);
    playReportTimerRef.current = setInterval(() => {
      if (videoEl && !videoEl.paused && videoEl.currentTime > 0) {
        jellyfin.reportPlayback(currentPartId, videoEl.currentTime, false, 'Progress');
        
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

    const directStreamUrl = jellyfin.getStreamUrl(currentPartId);
    const hlsUrl = jellyfin.getHlsUrl(currentPartId);

    const setupHlsPlay = (customUrl = null) => {
      const targetUrl = customUrl || (isSmoothMode ? jellyfin.getSmoothHlsUrl(currentPartId) : hlsUrl);
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch {}
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
          videoEl.playbackRate = playbackSpeed;
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
          }
        });
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = targetUrl;
        if (initialSeekTime > 0) videoEl.currentTime = initialSeekTime;
        videoEl.play().catch(() => {});
      } else {
        setupDirectPlay();
      }
    };

    const handleDirectError = () => {
      setupHlsPlay();
    };

    const setupDirectPlay = () => {
      const currentQuality = streamQualityRef.current;
      if (currentQuality !== 'direct') {
        const bitrate = parseInt(currentQuality, 10) || 4000000;
        setupHlsPlay(jellyfin.getSmoothHlsUrl(currentPartId, bitrate));
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
        jellyfin.reportPlayback(currentPartId, videoEl.currentTime, true, 'Stopped');
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
  }, [currentPartId, windowData.startSecond]);

  // Reload Video Stream & Metadata (to fetch newly downloaded subtitles)
  const handleReloadStream = useCallback(async (customPlaybackData = null, targetSubIdx = null) => {
    setIsLoading(true);
    const videoEl = videoRef.current;
    const currentPos = videoEl?.currentTime || 0;
    try {
      const freshInfo = customPlaybackData || await jellyfin.getItemPlaybackInfo(currentPartId);
      if (freshInfo) {
        setPlaybackData(freshInfo);
        if (onUpdateItem) onUpdateItem(freshInfo);
        const streams = freshInfo?.MediaSources?.[0]?.MediaStreams || freshInfo?.MediaStreams || [];
        const newSubs = streams.filter(s => s.Type === 'Subtitle' && !['pgssub', 'dvdsub', 'dvbsub'].includes(s.Codec?.toLowerCase()));
        if (targetSubIdx !== null && targetSubIdx !== undefined) {
          setSelectedSubtitleIndex(targetSubIdx);
        } else if (newSubs.length > 0 && selectedSubtitleIndex === -1) {
          const def = newSubs.find(s => s.IsDefault) || newSubs[newSubs.length - 1];
          if (def) setSelectedSubtitleIndex(def.Index);
        }
      }
    } catch (e) {
      console.warn('Failed to reload item metadata:', e);
    }
    if (videoEl) {
      videoEl.src = jellyfin.getStreamUrl(currentPartId) + `&_r=${Date.now()}`;
      videoEl.playbackRate = playbackSpeed;
      videoEl.muted = isMuted;
      videoEl.addEventListener('loadedmetadata', () => {
        if (currentPos > 0) videoEl.currentTime = currentPos;
        videoEl.play().catch(() => {});
        syncSubtitles();
      }, { once: true });
      videoEl.load();
    }
    setIsLoading(false);
  }, [currentPartId, isMuted, playbackSpeed, onUpdateItem, selectedSubtitleIndex, syncSubtitles]);

  // Switch Stream Quality / Transcode Bitrate seamlessly
  const changeStreamQuality = useCallback((qualityId, silent = false) => {
    const videoEl = videoRef.current;
    if (!videoEl || !currentPartId) return;

    setStreamQuality(qualityId);
    setShowQualityMenu(false);
    const currentPos = videoEl.currentTime || 0;
    const speed = playbackSpeed;
    const muted = isMuted;

    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch {}
      hlsRef.current = null;
    }

    if (qualityId === 'direct') {
      videoEl.src = jellyfin.getStreamUrl(currentPartId);
      videoEl.playbackRate = speed;
      videoEl.muted = muted;
      videoEl.addEventListener('loadedmetadata', () => {
        if (currentPos > 0) videoEl.currentTime = currentPos;
        videoEl.play().catch(() => {});
        syncSubtitles();
      }, { once: true });
      videoEl.load();
      if (!silent) {
        setSmoothToast('🎬 已切换为原画直推模式');
        setTimeout(() => setSmoothToast(''), 3000);
      }
    } else {
      const bitrate = parseInt(qualityId, 10) || 4000000;
      const smoothUrl = jellyfin.getSmoothHlsUrl(currentPartId, bitrate);
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
  }, [currentPartId, isMuted, playbackSpeed, syncSubtitles]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !video.duration || isDraggingScrubberRef.current) return;
    setRawDuration(video.duration);
    const p = (video.currentTime / video.duration) * 100;
    setProgress(p);
    setCurrentTimeText(formatTime(video.currentTime));
    setDurationText(formatTime(video.duration));
  };

  // Video Ended -> increment play count and play next part or skip (trigger promotion)
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
    jellyfin.reportPlayback(currentPartId, videoRef.current?.duration || 0, true, 'Stopped');
    
    // Multi-part check: if more parts exist in this video, play next part!
    if (partsList.length > 1 && currentPartIndex < partsList.length - 1) {
      setCurrentPartIndex(prev => prev + 1);
    } else {
      // No more parts, skip to next video (promote next windows forward)
      if (onSkip) onSkip(slotIndex);
    }
  };

  const handleSkipNext = () => {
    if (partsList.length > 1 && currentPartIndex < partsList.length - 1) {
      setCurrentPartIndex(prev => prev + 1);
    } else {
      if (onSkip) onSkip(slotIndex);
    }
  };

  // Dragging the floating window
  const handleMouseDownHeader = (e) => {
    if (e.target.closest('button') || e.target.closest('select')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    if (onBringToFront) onBringToFront(id);

    setIsDragging(true);
    isCustomPositionRef.current = true;
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startPosX = layout.left;
    const startPosY = layout.top;

    const handleMouseMove = (moveEvent) => {
      const dx = moveEvent.clientX - startMouseX;
      const dy = moveEvent.clientY - startMouseY;
      const newX = Math.max(10, Math.min(window.innerWidth - 100, startPosX + dx));
      const newY = Math.max(10, Math.min(window.innerHeight - 60, startPosY + dy));
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

  const handleTouchStartHeader = (e) => {
    if (e.target.closest('button') || e.target.closest('select')) return;
    if (e.touches.length !== 1) return;
    if (onBringToFront) onBringToFront(id);

    setIsDragging(true);
    isCustomPositionRef.current = true;
    const touch = e.touches[0];
    const startTouchX = touch.clientX;
    const startTouchY = touch.clientY;
    const startPosX = layout.left;
    const startPosY = layout.top;

    const handleTouchMove = (moveEvent) => {
      if (moveEvent.touches.length !== 1) return;
      const t = moveEvent.touches[0];
      const dx = t.clientX - startTouchX;
      const dy = t.clientY - startTouchY;
      const newX = Math.max(0, Math.min(window.innerWidth - 60, startPosX + dx));
      const newY = Math.max(50, Math.min(window.innerHeight - 60, startPosY + dy));
      setLayout(prev => ({ ...prev, left: newX, top: newY }));
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };

    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);
  };

  // Resizing the floating window via bottom-right handle
  const handleMouseDownResize = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (onBringToFront) onBringToFront(id);
    setIsResizing(true);
    isCustomPositionRef.current = true;

    const startX = e.clientX;
    const startW = layout.width;

    const handleMouseMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const minW = 260;
      const maxW = Math.max(minW, window.innerWidth - 20);
      const nextW = Math.max(minW, Math.min(maxW, startW + dx));
      setLayout(prev => ({ ...prev, width: nextW }));
      if (scrubberRef.current) {
        setScrubberWidth(scrubberRef.current.getBoundingClientRect().width);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Mouse Wheel Seek (uses seekSpeed tier: 5s / 15s / 30s)
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const video = videoRef.current;
    if (!video || !video.duration) return;

    const duration = video.duration;
    const step = getSeekStepSeconds(seekSpeed);
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
  }, [seekSpeed]);

  // Scrubber Mouse & Touch Drag Seeking
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

  // Toggle Favorite
  const handleToggleFavorite = async (e) => {
    if (e) e.stopPropagation();
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
      if (onUpdateItem) {
        onUpdateItem(item);
      }
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
      onUpdateItem({ ...item, UserData: { ...item.UserData, Played: nextPlayed, PlayCount: playCount } });
    }
    try {
      await jellyfin.markPlayed(item.Id, nextPlayed);
    } catch (err) {
      console.error('Failed to toggle played:', err);
    }
  };

  // Delete Video from Disk (Tampermonkey Replica)
  const handleDeleteVideo = async (e) => {
    if (e) e.stopPropagation();
    if (!item?.Id) return;
    if (!confirm(`确定要从服务器和物理磁盘中永久删除「${item.Name}」吗？\n警告：这将从物理硬盘上永久删除该文件且无法撤销！`)) {
      return;
    }
    try {
      await jellyfin.deleteItem(item.Id);
      if (onDeleteItem) onDeleteItem(item.Id);
      if (onSkip) onSkip(slotIndex); // Triggers shift & slot promotion!
    } catch (err) {
      alert(err.message || '删除失败');
    }
  };

  // Middle Click to Close (Trigger Shift & Next Window Promotion)
  const handleAuxClick = (e) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      if (onClose) onClose(slotIndex);
    }
  };

  const coverUrl = useMemo(() => {
    if (!item?.Id) return null;
    return jellyfin.getImageUrl(item.Id, item.ImageTags?.Primary, 'Primary', 500, 80);
  }, [item?.Id, item?.ImageTags]);

  const isFavorite = !!item?.UserData?.IsFavorite;
  const _playCount = item?.UserData?.PlayCount || 0;

  return (
    <div
      ref={containerRef}
      onMouseDown={() => onBringToFront && onBringToFront(id)}
      onAuxClick={handleAuxClick}
      onWheel={handleWheel}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{
        left: `${layout.left}px`,
        top: `${layout.top}px`,
        width: `${layout.width}px`,
        zIndex: hoverScrubberTime !== null ? 9999 : (isDragging || isResizing ? 500 : 50 + (slotIndex === 1 ? 5 : (slotIndex === 0 ? 1 : 0))),
        transition: (isDragging || isResizing)
          ? 'none' 
          : 'left 0.3s cubic-bezier(0.2, 0, 0, 1), top 0.3s cubic-bezier(0.2, 0, 0, 1), width 0.3s cubic-bezier(0.2, 0, 0, 1), height 0.3s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.2s',
        WebkitTouchCallout: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none'
      }}
      className={`fixed rounded-2xl overflow-visible shadow-2xl border bg-[#0d1117] flex flex-col group select-none ${
        slotIndex === 0 
          ? 'border-cyan-400/70 shadow-cyan-500/25' 
          : 'border-white/15 shadow-black/80'
      } ${
        (isDragging || isResizing) ? 'ring-2 ring-cyan-400 shadow-cyan-500/50 opacity-95 scale-[1.01]' : 'hover:border-cyan-400'
      }`}
    >
      {/* Mobile Window-level Centered Trickplay Thumbnail (Adaptive Above / Below entire window) */}
      {typeof window !== 'undefined' && window.innerWidth < 768 && (
        <TrickplayScrubberThumbnail
          item={item}
          hoverTime={hoverScrubberTime}
          hoverPercent={hoverScrubberPercent}
          containerWidth={layout.width}
          mode="window"
          position={layout.top > (window.innerHeight * 0.42) ? 'above' : 'below'}
        />
      )}

      {/* Draggable Header */}
      <div
        onMouseDown={handleMouseDownHeader}
        onTouchStart={handleTouchStartHeader}
        className={`px-3 py-2 border-b border-white/10 rounded-t-2xl flex items-center justify-between cursor-move text-xs ${
          slotIndex === 0 ? 'bg-cyan-950/80 text-cyan-200' : 'bg-slate-950/90 text-gray-300'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1 pr-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${slotIndex === 0 ? 'bg-cyan-400 animate-pulse' : 'bg-amber-400'}`} />
          <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-mono text-cyan-300 font-bold flex-shrink-0">
            {slotIndex === 0 ? '主窗' : `副窗 #${slotIndex}`}
          </span>
          {/* Multi-part Video Part Selector */}
          {partsList.length > 1 && (
            <div 
              className="flex items-center gap-1 bg-black/50 px-1.5 py-0.5 rounded border border-amber-500/40 flex-shrink-0"
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <span className="text-[10px] text-amber-400 font-bold">Part</span>
              <select
                value={currentPartIndex}
                onChange={(e) => setCurrentPartIndex(Number(e.target.value))}
                className="bg-transparent text-[10px] text-amber-300 font-bold outline-none cursor-pointer"
              >
                {partsList.map((p, idx) => (
                  <option key={p.Id} value={idx} className="bg-slate-900 text-white">
                    {idx + 1}/{partsList.length}: {p.Name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <span className="font-bold text-white text-xs truncate flex-1 min-w-0" title={item?.Name}>
            {item?.Name || '视频预览'}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Fast-Forward / Rewind Speed Tier Selector (3 档: 慢 5s, 中 15s, 快 30s) */}
          <div className="relative">
            <button
              onClick={() => setShowSeekSpeedMenu(!showSeekSpeedMenu)}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-bold text-gray-400 hover:text-cyan-300 hover:bg-white/10 transition"
              title="设置快进/快退/滚轮寻轨步长 (慢 5s / 中 15s / 快 30s)"
            >
              <FastForward size={12} className="text-cyan-400" />
              <span>{SEEK_SPEED_OPTIONS.find(o => o.id === seekSpeed)?.shortLabel || '15s'}</span>
            </button>

            {showSeekSpeedMenu && (
              <div
                className="absolute right-0 top-7 w-36 glass-panel rounded-xl shadow-2xl py-1 z-50 text-xs text-gray-200 divide-y divide-white/5 animate-in fade-in zoom-in-95 duration-100"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-3 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  快进/快退步长
                </div>
                {SEEK_SPEED_OPTIONS.map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => {
                      setStoredSeekSpeed(opt.id);
                      setSeekSpeed(opt.id);
                      setShowSeekSpeedMenu(false);
                    }}
                    className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition ${
                      seekSpeed === opt.id
                        ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                        : 'hover:bg-white/10 text-gray-300'
                    }`}
                  >
                    <span>{opt.label}</span>
                    {seekSpeed === opt.id && <span className="text-cyan-400 text-xs">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Subtitles & MeiamSub Download */}
          <button
            onClick={() => setShowSubtitleModal(true)}
            className={`p-1 rounded transition ${
              selectedSubtitleIndex !== -1 ? 'text-cyan-300 bg-cyan-500/20' : 'text-gray-400 hover:text-cyan-300'
            }`}
            title="字幕管理与在线下载 (迅雷/MeiamSub/射手)"
          >
            <Subtitles size={13} />
          </button>

          {/* Quality & Transcode Selector Menu */}
          <div className="relative">
            <button
              onClick={() => setShowQualityMenu(!showQualityMenu)}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold transition ${
                streamQuality !== 'direct'
                  ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-400/50 shadow-sm shadow-cyan-500/30'
                  : 'text-gray-400 hover:text-cyan-300 hover:bg-white/10'
              }`}
              title="切换播放画质 / 转码模式"
            >
              <Zap size={12} className={streamQuality !== 'direct' ? 'fill-cyan-400 text-cyan-400' : ''} />
              <span>{QUALITY_OPTIONS.find(q => q.id === streamQuality)?.shortLabel || '原画'}</span>
            </button>

            {showQualityMenu && (
              <div
                className="absolute right-0 top-7 w-44 glass-panel rounded-xl shadow-2xl py-1 z-50 text-xs text-gray-200 divide-y divide-white/5 animate-in fade-in zoom-in-95 duration-100"
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

          {/* Refresh / Reload Stream (to load newly downloaded subs) */}
          <button
            onClick={handleReloadStream}
            className="p-1 rounded text-gray-400 hover:text-cyan-300 transition"
            title="刷新流与媒体信息 (重新加载新下载字幕)"
          >
            <RefreshCw size={13} />
          </button>

          {/* Poster PIP Toggle */}
          <button
            onClick={() => setShowPinnedPoster(!showPinnedPoster)}
            className={`p-1 rounded transition ${
              showPinnedPoster ? 'text-cyan-300 bg-cyan-500/20' : 'text-gray-400 hover:text-cyan-300'
            }`}
            title="海报画中画 (默认开启 1.5倍)"
          >
            <ImageIcon size={13} />
          </button>

          {/* Inline VR Toggle */}
          <button
            onClick={() => setIsVrActive(!isVrActive)}
            className={`p-1 rounded transition ${
              isVrActive ? 'text-amber-300 bg-amber-500/30 animate-pulse' : 'text-gray-400 hover:text-amber-400'
            }`}
            title="🥽 开启/退出 当前窗口 VR 全景"
          >
            <Glasses size={13} />
          </button>

          {/* Favorite */}
          <button
            onClick={handleToggleFavorite}
            className={`p-1 rounded transition ${
              isFavorite ? 'text-amber-400' : 'text-gray-400 hover:text-amber-400'
            }`}
            title={isFavorite ? '取消收藏' : '加入最爱'}
          >
            <Star size={13} className={isFavorite ? 'fill-amber-400' : ''} />
          </button>

          {/* Played */}
          <button
            onClick={handleTogglePlayed}
            className="p-1 rounded text-gray-400 hover:text-cyan-300 transition"
            title={item?.UserData?.Played ? '标记为未播' : '标记为已播'}
          >
            {item?.UserData?.Played ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>

          {/* Delete Video */}
          <button
            onClick={handleDeleteVideo}
            className="p-1 rounded text-gray-400 hover:text-red-400 transition"
            title="从服务器和磁盘删除"
          >
            <Trash2 size={13} />
          </button>

          {/* External Player Menu */}
          <div className="relative">
            <button
              onClick={() => setShowPlayerMenu(!showPlayerMenu)}
              className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-cyan-300 transition"
              title="MPV / 外部播放器"
            >
              <ExternalLink size={13} />
            </button>

            {showPlayerMenu && (
              <div 
                className="absolute right-0 top-7 w-32 glass-panel rounded-xl shadow-2xl py-1 z-50 text-xs text-gray-200 divide-y divide-white/5 animate-in fade-in zoom-in-95 duration-100"
                onClick={(e) => e.stopPropagation()}
              >
                <button 
                  onClick={() => { launchPlayer('mpv', item); setShowPlayerMenu(false); }}
                  className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center justify-between text-cyan-300 font-medium"
                >
                  <span>MPV 播放器</span>
                  <span className="text-[10px]">mpv://</span>
                </button>
                <button 
                  onClick={() => { launchPlayer('potplayer', item); setShowPlayerMenu(false); }}
                  className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center justify-between text-amber-300"
                >
                  <span>PotPlayer</span>
                  <span className="text-[10px]">pot://</span>
                </button>
              </div>
            )}
          </div>
          <button
            onClick={handleSkipNext}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-cyan-300 transition"
            title={
              partsList.length > 1 && currentPartIndex < partsList.length - 1
                ? `播放下一分段 (Part ${currentPartIndex + 2}/${partsList.length})`
                : '跳过当前视频 (下一个顶上来)'
            }
          >
            <SkipForward size={13} />
          </button>

          {/* Close window (closes this window & promotes next windows forward) */}
          <button
            onClick={() => onClose && onClose(slotIndex)}
            className="p-1 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition"
            title="关闭窗口 (中键 / 下一个顶上来)"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Video Viewport (16:9) with Long-press Drag Support */}
      <div 
        className="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden touch-none select-none"
        style={{ filter: `brightness(${brightness})`, WebkitTouchCallout: 'none', userSelect: 'none' }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        {...touchHandlers}
      >
        {/* Long-press Window Dragging Active Feedback Overlay */}
        {isLongPressDragging && (
          <div className="absolute inset-0 z-40 bg-cyan-950/40 backdrop-blur-[1px] flex items-center justify-center pointer-events-none rounded-2xl border-2 border-cyan-400">
            <div className="px-3.5 py-1.5 rounded-full bg-black/85 border border-cyan-400 text-cyan-300 text-xs font-bold flex items-center gap-1.5 shadow-2xl animate-pulse">
              <span>🖐️ 正在拖动窗口...</span>
            </div>
          </div>
        )}

        {/* Smooth Mode Notification Toast */}
        {smoothToast && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 px-3 py-1 bg-black/85 backdrop-blur-md border border-cyan-400/60 rounded-full text-[11px] font-bold text-cyan-300 shadow-xl pointer-events-none animate-in fade-in duration-150">
            {smoothToast}
          </div>
        )}

        {coverUrl && (
          <img
            src={coverUrl}
            alt=""
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 pointer-events-none ${
              isLoading ? 'opacity-60 blur-sm' : 'opacity-0'
            }`}
          />
        )}

        <video
          ref={videoRef}
          playsInline
          crossOrigin="anonymous"
          controls={false}
          controlsList="nodownload noplaybackrate"
          disablePictureInPicture={true}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className="w-full h-full object-contain cursor-pointer z-10 select-none pointer-events-auto"
          style={{ WebkitTouchCallout: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
          onClick={togglePlay}
          onWaiting={() => setIsLoading(true)}
          onPlaying={() => {
            setIsLoading(false);
            setIsPlaying(true);
            syncSubtitles();
          }}
          onLoadedData={syncSubtitles}
          onPause={() => setIsPlaying(false)}
          onEnded={handleEnded}
          onTimeUpdate={handleTimeUpdate}
        >
          {subtitleStreams.map(s => (
            <track
              key={`${item.Id}-${s.Index}`}
              kind="subtitles"
              label={s.Title || s.Language || `Subtitle ${s.Index}`}
              src={jellyfin.getSubtitleTrackUrl(item.Id, mediaSourceId, s.Index)}
              srcLang={s.Language || 'zh'}
              data-index={s.Index}
              default={selectedSubtitleIndex === s.Index}
            />
          ))}
        </video>

        {/* INLINE VR WEBGL CANVAS */}
        <InlineVrCanvas
          videoRef={videoRef}
          isActive={isVrActive}
          onClose={() => setIsVrActive(false)}
          initialMode={detectedVrMode}
        />

        {/* Mobile Touch Gesture HUD Overlay */}
        {gestureState.type && (
          <div className={`absolute inset-0 z-30 flex items-center justify-center pointer-events-none animate-in fade-in zoom-in-95 duration-100 transition-opacity ${gestureState.fading ? 'opacity-0 duration-500' : 'opacity-100'}`}>
            <div className="flex flex-col items-center gap-1.5 bg-black/80 backdrop-blur-md px-3.5 py-2.5 rounded-2xl border border-white/10 shadow-2xl text-white">
              {gestureState.type === 'seek' && <FastForward size={20} className="text-cyan-400 animate-pulse" />}
              {gestureState.type === 'brightness' && <Sun size={20} className="text-amber-400" />}
              {(gestureState.type === 'speed_step' || gestureState.type === 'speed_boost') && <Gauge size={20} className="text-amber-400" />}
              <span className="font-mono font-bold text-[11px]">{gestureState.text}</span>
            </div>
          </div>
        )}

        {/* 
          Pinned Poster Floating PIP View:
          - Mobile: 1X compact standard size (w-20 xs:w-24)
          - Desktop: 1.5X enlarged size (sm:w-36)
        */}
        {showPinnedPoster && coverUrl && (
          <div 
            className="absolute top-2 right-2 z-30 w-20 xs:w-24 sm:w-36 aspect-[2/3] rounded-xl overflow-hidden shadow-2xl border sm:border-2 border-cyan-400/60 bg-black/90 backdrop-blur-md animate-in zoom-in-95 duration-150 group/pip cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setShowPosterModal(true);
            }}
            title="点击查看高清大图"
          >
            <img src={coverUrl} alt="Poster" className="w-full h-full object-cover transition-transform group-hover/pip:scale-105" />
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowPinnedPoster(false);
              }}
              className="absolute top-1 right-1 p-1 rounded-full bg-black/80 text-white hover:bg-red-500 transition"
              title="隐藏海报"
            >
              <X size={11} />
            </button>
            <div className="absolute bottom-0 inset-x-0 bg-black/75 px-1 py-0.5 text-[8px] sm:text-[9px] text-center text-cyan-300 font-medium truncate backdrop-blur-xs">
              {item?.Name}
            </div>
          </div>
        )}

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
      <div className="p-2.5 bg-slate-950/95 border-t border-white/5 rounded-b-2xl flex flex-col gap-1.5 text-xs">
        {/* Scrubber with Real-time Drag & Centered Trickplay */}
        <div className="relative w-full">
          {/* Desktop Scrubber-level Trickplay Thumbnail */}
          {typeof window !== 'undefined' && window.innerWidth >= 768 && (
            <TrickplayScrubberThumbnail
              item={item}
              hoverTime={hoverScrubberTime}
              hoverPercent={hoverScrubberPercent}
              containerWidth={scrubberWidth}
              mode="scrubber"
              position={slotIndex === 2 ? 'above' : 'below'}
            />
          )}

          <div
            ref={scrubberRef}
            className="w-full h-2.5 sm:h-2 hover:h-3.5 sm:hover:h-3 bg-white/20 rounded-full cursor-pointer transition-all relative overflow-hidden group/bar touch-none"
            onMouseDown={handleScrubberMouseDown}
            onMouseMove={handleScrubberMouseMove}
            onMouseLeave={handleScrubberMouseLeave}
            onTouchStart={handleScrubberTouchStart}
            onTouchMove={handleScrubberTouchMove}
            onTouchEnd={handleScrubberTouchEnd}
            onTouchCancel={handleScrubberTouchEnd}
          >
            <div
              className="absolute top-0 left-0 bottom-0 bg-cyan-400 shadow-sm shadow-cyan-400/50 rounded-full transition-all duration-75"
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

          <div className="flex items-center gap-2">
            {/* Playback Speed */}
            <select
              value={playbackSpeed}
              onChange={(e) => {
                const sp = parseFloat(e.target.value);
                setPlaybackSpeed(sp);
                if (videoRef.current) videoRef.current.playbackRate = sp;
              }}
              className="bg-black/60 px-1.5 py-0.5 rounded border border-white/10 text-cyan-300 text-[10px] font-mono focus:outline-none cursor-pointer"
            >
              <option value="0.75" className="bg-slate-900">0.75x</option>
              <option value="1.0" className="bg-slate-900">1.0x</option>
              <option value="1.25" className="bg-slate-900">1.25x</option>
              <option value="1.5" className="bg-slate-900">1.5x</option>
              <option value="2.0" className="bg-slate-900">2.0x</option>
            </select>

            <button
              onClick={handleSkipNext}
              className="px-2.5 py-0.5 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/40 text-cyan-300 text-[11px] font-medium transition flex items-center gap-1"
              title={
                partsList.length > 1 && currentPartIndex < partsList.length - 1
                  ? `播放下一段切片 (Part ${currentPartIndex + 2}/${partsList.length})`
                  : '换一个 (下一个顶上来)'
              }
            >
              <SkipForward size={11} />
              <span>{partsList.length > 1 ? `切片 P${currentPartIndex + 1}/${partsList.length}` : '切片'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* SE Corner Resizer Handle (Bottom-Right) */}
      <div
        onMouseDown={handleMouseDownResize}
        className="absolute right-0 bottom-0 w-4 h-4 cursor-se-resize z-40 flex items-end justify-end p-0.5 group/resizer"
        title="拖拽缩放窗口大小"
      >
        <div className="w-2.5 h-2.5 border-r-2 border-b-2 border-white/30 group-hover/resizer:border-cyan-400 transition-colors" />
      </div>

      {/* Full Poster Lightbox */}
      {showPosterModal && coverUrl && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-150"
          onClick={() => setShowPosterModal(false)}
        >
          <div 
            className="relative max-w-md w-full glass-panel rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3 border-b border-white/5 flex items-center justify-between bg-black/40">
              <span className="text-xs font-bold text-white truncate">{item?.Name}</span>
              <button
                onClick={() => setShowPosterModal(false)}
                className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[60vh] bg-black/90 flex items-center justify-center p-2">
              <img src={coverUrl} alt="Poster" className="max-h-[55vh] object-contain rounded-lg shadow-xl" />
            </div>
          </div>
        </div>
      )}

      {/* Subtitles & Remote Download Modal */}
      <SubtitleModal
        isOpen={showSubtitleModal}
        item={item}
        currentSubtitleIndex={selectedSubtitleIndex}
        onSelectSubtitle={(idx) => setSelectedSubtitleIndex(idx)}
        onSubtitleDownloaded={handleReloadStream}
        onClose={() => setShowSubtitleModal(false)}
      />
    </div>
  );
}
