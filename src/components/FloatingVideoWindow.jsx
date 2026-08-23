import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Hls from 'hls.js';
import { jellyfin } from '../api/jellyfinClient';
import { calculateSlotStyle } from '../utils/windowLayout';
import { useExternalPlayer } from '../hooks/useExternalPlayer';
import { useTouchGestures } from '../hooks/useTouchGestures';
import TrickplayScrubberThumbnail from './TrickplayScrubberThumbnail';
import InlineVrCanvas from './InlineVrCanvas';
import SubtitleModal from './SubtitleModal';
import { detectVrVideo } from '../utils/vrDetector';
import { 
  Play, Pause, SkipForward, Volume2, VolumeX, Maximize, 
  X, ExternalLink, Film, Star, Eye, EyeOff, Image as ImageIcon,
  Glasses, Trash2, FastForward, Sun, Zap, Gauge, RefreshCw, Subtitles
} from 'lucide-react';

export default function FloatingVideoWindow({
  windowData,
  onClose,
  onSkip,
  onExpand,
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

  // Multi-part video list (e.g. Part 1, 2, 3 / CD1, CD2)
  const [partsList, setPartsList] = useState(() => [{ Id: item?.Id, Name: item?.Name || 'Part 1' }]);
  const [currentPartIndex, setCurrentPartIndex] = useState(0);

  // Fetch additional video parts (slices / multi-part VR / multi-part episodes)
  useEffect(() => {
    if (!item?.Id) return;
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
  }, [item?.Id]);

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

  // Playback state
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [showPlayerMenu, setShowPlayerMenu] = useState(false);
  const [showPosterModal, setShowPosterModal] = useState(false);
  const [showSubtitleModal, setShowSubtitleModal] = useState(false);
  const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState(-1);

  // Pinned Poster PIP: ENABLED BY DEFAULT (1X on Mobile, 1.5X on Desktop)
  const [showPinnedPoster, setShowPinnedPoster] = useState(true);

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

  // Mobile Touch Gestures with real-time Trickplay preview
  const { gestureState, brightness, touchHandlers } = useTouchGestures({
    videoRef,
    containerRef,
    duration: rawDuration,
    currentTime: videoRef.current?.currentTime || 0,
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
      // 同步本地倍速状态（修复既有不一致：state 与元素脱节），
      // 元素立即生效；下次换片时 setupDirectPlay 也会按该档位起播
      setPlaybackSpeed(speed);
      if (videoRef.current) videoRef.current.playbackRate = speed;
    }
  });

  const [playbackData, setPlaybackData] = useState(null);

  // Fetch full playback info with MediaSources & MediaStreams when opened
  useEffect(() => {
    if (item?.Id) {
      jellyfin.getItemPlaybackInfo(item.Id).then(info => {
        if (info) {
          setPlaybackData(info);
          if (onUpdateItem) onUpdateItem(info);
        }
      }).catch(() => {});
    }
  }, [item?.Id]);

  // Extract subtitle streams
  const mediaSource = playbackData?.MediaSources?.[0] || item?.MediaSources?.[0];
  const mediaSourceId = mediaSource?.Id || item?.Id;
  const subtitleStreams = useMemo(() => {
    const streams = mediaSource?.MediaStreams || playbackData?.MediaStreams || item?.MediaStreams || [];
    return streams.filter(s => s.Type === 'Subtitle' && !['pgssub', 'dvdsub', 'dvbsub'].includes(s.Codec?.toLowerCase()));
  }, [item, playbackData, mediaSource]);

  // Auto-detect default subtitle (or disable if hardsub flag in name)
  useEffect(() => {
    if (subtitleStreams.length > 0) {
      const fileName = item?.Path || item?.Name || '';
      const hasHardcodedSubs = /-(u?c)(?:[^a-z0-9]|$)/i.test(fileName);
      if (hasHardcodedSubs) {
        setSelectedSubtitleIndex(-1);
      } else {
        const defaultStream = subtitleStreams.find(s => s.IsDefault) || subtitleStreams[0];
        if (defaultStream) {
          setSelectedSubtitleIndex(defaultStream.Index);
        }
      }
    }
  }, [item?.Id, subtitleStreams]);

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
  const currentPartId = currentPlayingPart?.Id || item?.Id;

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

    const setupDirectPlay = () => {
      videoEl.src = directStreamUrl;
      videoEl.playbackRate = playbackSpeedRef.current;
      videoEl.muted = isMutedRef.current;
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
        videoEl.src = hlsUrl;
        if (initialSeekTime > 0) videoEl.currentTime = initialSeekTime;
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

  // Mouse Wheel Seek
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
  const playCount = item?.UserData?.PlayCount || 0;

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
        zIndex: 50 + slotIndex,
        transition: (isDragging || isResizing)
          ? 'none' 
          : 'left 0.3s cubic-bezier(0.2, 0, 0, 1), top 0.3s cubic-bezier(0.2, 0, 0, 1), width 0.3s cubic-bezier(0.2, 0, 0, 1), height 0.3s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.2s'
      }}
      className={`fixed rounded-2xl overflow-visible shadow-2xl border bg-[#0d1117] flex flex-col group select-none ${
        slotIndex === 0 
          ? 'border-cyan-400/70 shadow-cyan-500/25' 
          : 'border-white/15 shadow-black/80'
      } ${
        (isDragging || isResizing) ? 'shadow-cyan-500/50 opacity-95 scale-[1.01]' : 'hover:border-cyan-400'
      }`}
    >
      {/* Draggable Header */}
      <div
        onMouseDown={handleMouseDownHeader}
        className={`px-3 py-2 border-b border-white/10 rounded-t-2xl flex items-center justify-between cursor-move text-xs ${
          slotIndex === 0 ? 'bg-cyan-950/80 text-cyan-200' : 'bg-slate-950/90 text-gray-300'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 pr-2">
          <span className={`w-2 h-2 rounded-full ${slotIndex === 0 ? 'bg-cyan-400 animate-pulse' : 'bg-amber-400'}`} />
          <span className="font-bold text-white text-xs truncate max-w-[140px] sm:max-w-[200px]" title={item?.Name}>
            {item?.Name || '视频预览'}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-mono text-cyan-300 font-bold">
            {slotIndex === 0 ? '主窗' : `副窗 #${slotIndex}`}
          </span>
          {/* Multi-part Video Part Selector */}
          {partsList.length > 1 && (
            <div 
              className="flex items-center gap-1 bg-black/50 px-1.5 py-0.5 rounded border border-amber-500/40"
              onMouseDown={(e) => e.stopPropagation()}
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
        </div>

        <div className="flex items-center gap-1">
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
                <button 
                  onClick={() => { launchPlayer('vlc', item); setShowPlayerMenu(false); }}
                  className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center justify-between text-orange-300"
                >
                  <span>VLC 播放器</span>
                  <span className="text-[10px]">vlc://</span>
                </button>
              </div>
            )}
          </div>

          {/* Expand to full theater */}
          <button
            onClick={() => onExpand && onExpand(item)}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-cyan-300 transition"
            title="放大影院全屏"
          >
            <Maximize size={13} />
          </button>

          {/* Skip next / next part (promotes next part or promotes next windows forward) */}
          <button
            onClick={handleSkipNext}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-cyan-300 transition"
            title={
              partsList.length > 1 && currentPartIndex < partsList.length - 1
                ? `播放下一段 (Part ${currentPartIndex + 2}/${partsList.length})`
                : '换一个 (下一个顶上来)'
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

      {/* Video Viewport (16:9) */}
      <div 
        className="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden touch-none"
        style={{ filter: `brightness(${brightness})` }}
        {...touchHandlers}
      >
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
          className="w-full h-full object-contain cursor-pointer z-10"
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
        {/* Scrubber with Real-time Drag & Trickplay (Position BELOW) */}
        <div className="relative w-full">
          <TrickplayScrubberThumbnail
            item={item}
            hoverTime={hoverScrubberTime}
            hoverPercent={hoverScrubberPercent}
            containerWidth={scrubberWidth}
            position="below"
          />

          <div
            ref={scrubberRef}
            className="w-full h-2 hover:h-3 bg-white/20 rounded-full cursor-pointer transition-all relative overflow-hidden group/bar"
            onMouseDown={handleScrubberMouseDown}
            onMouseMove={handleScrubberMouseMove}
            onMouseLeave={handleScrubberMouseLeave}
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
