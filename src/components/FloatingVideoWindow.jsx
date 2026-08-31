import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { jellyfin } from '../api/jellyfinClient';
import { calculateSlotStyle } from '../utils/windowLayout';
import { useExternalPlayer } from '../hooks/useExternalPlayer';
import { useTouchGestures } from '../hooks/useTouchGestures';
import { useVolumeControl } from '../hooks/useVolumeControl';
import { useMediaPlaybackInfo } from '../hooks/useMediaPlaybackInfo';
import { useSubtitleTracks } from '../hooks/useSubtitleTracks';
import { useViewport } from '../hooks/useViewport';
import { SEEK_SPEED_OPTIONS, getStoredSeekSpeed, setStoredSeekSpeed, getSeekStepSeconds, getSeekSwipeSpan } from '../utils/seekSettings';
import { getPlaybackDefaults } from '../utils/playbackDefaults';
import { calculateSmartStartTime } from '../utils/smartStartHelper';
import { QUALITY_OPTIONS, PLAYBACK_SPEED_OPTIONS } from '../utils/qualityPresets';
import TrickplayScrubberThumbnail from './TrickplayScrubberThumbnail';
import InlineVrCanvas from './InlineVrCanvas';
import SubtitleModal from './SubtitleModal';
import DeleteConfirmModal from './DeleteConfirmModal';
import QuickTagSelector from './QuickTagSelector';
import { detectVrVideo } from '../utils/vrDetector';
import { probeStreamStatus, describeVideoMediaError } from '../utils/playbackDiagnostics';
import { PlaybackSessionController } from '../utils/playbackSessionController';
import {
  Play, Pause, SkipForward, Volume2, VolumeX,
  X, ExternalLink, Star, Eye, EyeOff, Image as ImageIcon,
  Glasses, Trash2, FastForward, Sun, Zap, Gauge, RefreshCw, Subtitles, Film,
  Tag, Scaling, FlipHorizontal, MoreVertical, SlidersHorizontal
} from 'lucide-react';

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
  onDeleteItem,
  onSwitchItem
}) {
  const { id, slotIndex, item } = windowData;

  const videoRef = useRef(null);
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

  // 响应式视口（替代渲染期直读 window.innerWidth / innerHeight）
  const { width: vpWidth, height: vpHeight } = useViewport();
  const isMobileViewport = vpWidth < 768;

  // Multi-part video list (e.g. Part 1, 2, 3 / CD1, CD2)
  const [partsList, setPartsList] = useState(() => [{ Id: item?.Id, Name: item?.Name || 'Part 1' }]);
  const [currentPartIndex, setCurrentPartIndex] = useState(0);
  const currentPartId = partsList[currentPartIndex]?.Id || item?.Id;

  // Media playback info（音轨/字幕流来源）——跟随当前播放分段，
  // 否则 Part 2+ 会沿用第一个切片的字幕/音轨信息
  const { playbackData, setPlaybackData } = useMediaPlaybackInfo(currentPartId);

  // 非主条目的分段：拉取分段自身详情（含 Trickplay 清单），
  // 否则进度条缩略图会沿用第一个切片的 trickplay，帧画面对应错误
  const [partDetail, setPartDetail] = useState(null);

  // Fetch multi-part items on mount or item change（分段列表随后在下方 effect 中构建）
  useEffect(() => {
    setPartDetail(null);
    if (!currentPartId || currentPartId === item?.Id || !jellyfin.auth.isConfigured) return;
    let cancelled = false;
    jellyfin.queryMediaPage({ ids: currentPartId, limit: 1 }).then(data => {
      const detail = data?.Items?.[0];
      if (!cancelled && detail) setPartDetail(detail);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentPartId, item?.Id]);

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

  // Default Playback Settings initialization & Dynamic Listener
  const [playbackDefaults, setPlaybackDefaultsState] = useState(() => getPlaybackDefaults());
  const playbackDefaultsRef = useRef(playbackDefaults);
  playbackDefaultsRef.current = playbackDefaults;

  useEffect(() => {
    const handleDefaultsChanged = (e) => {
      if (e.detail) {
        setPlaybackDefaultsState(e.detail);
        playbackDefaultsRef.current = e.detail;
      }
    };
    window.addEventListener('faraday:playback_defaults_changed', handleDefaultsChanged);
    return () => window.removeEventListener('faraday:playback_defaults_changed', handleDefaultsChanged);
  }, []);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(() => playbackDefaults.speed || 1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorDetails, setErrorDetails] = useState('');
  const [smartStartToast, setSmartStartToast] = useState('');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showPlayerMenu, setShowPlayerMenu] = useState(false);
  const [showPosterModal, setShowPosterModal] = useState(false);
  const [showSubtitleModal, setShowSubtitleModal] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [showAspectMenu, setShowAspectMenu] = useState(false);
  const [aspectMode, setAspectMode] = useState('contain'); // 'contain' | 'cover' | 'fill'
  const [flipH, setFlipH] = useState(false);

  // 音量控制（浮窗默认静音启动，音量等级记忆并随播放上报）
  const { volume, setVolume, isMuted, setIsMuted, toggleMute } = useVolumeControl(videoRef, { initialMuted: true });

  // 字幕流管理（共享 hook：提取文本字幕流 + 硬字幕识别默认选择 + textTracks 同步）
  const { subtitleStreams, mediaSourceId, selectedSubtitleIndex, selectSubtitle, syncSubtitleModes } =
    useSubtitleTracks({ item, playbackData, videoRef });

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
  const scrubberDragTimeRef = useRef(null);

  // Mouse Wheel Seek State
  const [isWheelSeeking, setIsWheelSeeking] = useState(false);
  const wheelTimerRef = useRef(null);
  const wheelSeekingTimeRef = useRef(null);

  // Playback reporting & PlayCount Tracking
  const hasCountedPlayRef = useRef(false);
  // 播放失败诊断：直连失败原因暂存
  const directDiagRef = useRef('');

  // 统一播放会话控制器
  const sessionControllerRef = useRef(null);
  if (!sessionControllerRef.current) {
    sessionControllerRef.current = new PlaybackSessionController({
      jellyfinClient: jellyfin,
      onError: (data) => {
        setHasError(true);
        const parts = [];
        if (directDiagRef.current) parts.push(directDiagRef.current);
        parts.push(`HLS: ${data?.type || 'Error'}/${data?.details || 'Unknown'}${data?.response?.code ? ` (HTTP ${data.response.code})` : ''}`);
        if (videoRef.current?.videoWidth > 0) {
          parts.push(`${videoRef.current.videoWidth}×${videoRef.current.videoHeight}${isVrActiveRef.current ? ' · VR模式已激活' : ''}`);
        }
        setErrorDetails(parts.join(' | '));
        probeStreamStatus(jellyfin.getStreamUrl(currentPartId)).then(status => {
          setErrorDetails(prev => `${prev} | 直连探测: ${status}`);
        }).catch(() => {});
      },
      onAutoDirectFallback: () => {
        directDiagRef.current = '直连流: 加载失败，已自动回退到转码流';
        const defaultQuality = streamQualityRef.current !== 'direct' ? streamQualityRef.current : '4000000';
        setStreamQuality(defaultQuality);
        sessionControllerRef.current?.loadStream({
          itemId: currentPartId,
          mediaSourceId: currentPartId,
          streamQuality: defaultQuality,
          initialSeekTime: videoRef.current?.currentTime || 0,
          playbackSpeed: playbackSpeedRef.current,
          isMuted: isMutedRef.current,
          volume: volumeRef.current
        });
      }
    });
  }

  // 巡更模式（Patrol Mode）：实际播放时长累计、倒计时显示与防重锁
  const patrolElapsedRef = useRef(0);
  const lastPatrolTickRef = useRef(null);
  const hasPatrolSkippedRef = useRef(false);
  const [patrolRemainingSec, setPatrolRemainingSec] = useState(() => playbackDefaults.patrolIntervalSeconds || 45);

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
      sessionControllerRef.current?.seek(target);
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

  const playbackSpeedRef = useRef(playbackSpeed);
  playbackSpeedRef.current = playbackSpeed;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const isVrActiveRef = useRef(isVrActive);
  isVrActiveRef.current = isVrActive;
  const streamQualityRef = useRef(streamQuality);
  streamQualityRef.current = streamQuality;
  const itemRef = useRef(item);
  itemRef.current = item;
  const onUpdateItemRef = useRef(onUpdateItem);
  onUpdateItemRef.current = onUpdateItem;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  // Fetch multi-part items on mount or item change.
  // 经 ref 读取 item：收藏/元数据更新会生成新 item 对象，若依赖整个对象，
  // 会导致分段列表重取并跳回 Part 1。
  useEffect(() => {
    const currentItem = itemRef.current;
    if (!currentItem?.Id) return;

    // 1. 如果该条目已被 Smart Stacking 智能聚合并带有多分段，直接使用聚合切片列表！
    if (currentItem.isStacked && currentItem.stackedItems && currentItem.stackedItems.length > 0) {
      setPartsList(currentItem.stackedItems.map((part, idx) => ({
        ...part,
        Name: part.Name || `Part ${idx + 1}`
      })));
      setCurrentPartIndex(0);
      return;
    }

    // 2. 否则通过 Jellyfin 原生 AdditionalParts 接口拉取多分段
    jellyfin.getAdditionalParts(currentItem.Id).then(additional => {
      if (additional && additional.length > 0) {
        setPartsList([
          { ...currentItem, Name: currentItem.Name || 'Part 1' },
          ...additional.map((part, idx) => ({
            ...part,
            Name: part.Name || `Part ${idx + 2}`
          }))
        ]);
      } else {
        setPartsList([{ ...currentItem, Name: currentItem.Name || 'Part 1' }]);
      }
      setCurrentPartIndex(0);
    }).catch(() => {
      setPartsList([{ ...currentItem, Name: currentItem.Name || 'Part 1' }]);
      setCurrentPartIndex(0);
    });
  }, [item?.Id]);

  // Cleanup timers on component unmount
  useEffect(() => {
    return () => {
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    };
  }, []);

  const currentPlayingPart = partsList[currentPartIndex] || item;

  // 进度条缩略图必须使用"当前播放分段"的条目数据：主条目用 item，
  // 其他分段用拉取到的分段详情（分段详情到达前暂无 trickplay 帧，
  // 避免错误沿用第一个切片的画面导致帧与时间对应错位）
  const trickplayItem = useMemo(() => {
    if (currentPartId === item?.Id) return item;
    return partDetail || currentPlayingPart;
  }, [currentPartId, item, partDetail, currentPlayingPart]);

  // Load and play video when item/part changes + Report Playback to Jellyfin
  useEffect(() => {
    const controller = sessionControllerRef.current;
    if (!controller) return;

    if (!currentPartId) {
      setIsLoading(false);
      controller.destroy();
      return;
    }

    setIsLoading(true);
    setHasError(false);
    setErrorDetails('');
    directDiagRef.current = '';
    setProgress(0);
    setHoverScrubberTime(null);
    setIsWheelSeeking(false);
    hasCountedPlayRef.current = false;

    // Reset patrol tracking on item/part load with multi-window stagger
    const currentPatrolInterval = playbackDefaultsRef.current.patrolIntervalSeconds || 45;
    const initialStagger = (slotIndex > 0 && playbackDefaultsRef.current.patrolMode)
      ? ((slotIndex * 12) % Math.max(15, currentPatrolInterval - 10))
      : 0;
    patrolElapsedRef.current = initialStagger;
    lastPatrolTickRef.current = null;
    hasPatrolSkippedRef.current = false;
    setPatrolRemainingSec(Math.max(0, Math.ceil(currentPatrolInterval - initialStagger)));

    const videoEl = videoRef.current;
    if (!videoEl) return;
    controller.attachVideo(videoEl);

    // Determine initial seek time: Trickplay click time > server resumeTicks > smartStart > 0
    let initialSeekTime = calculateSmartStartTime(currentPlayingPart, {
      explicitStartSecond: windowData.startSecond,
      smartStartEnabled: playbackDefaultsRef.current.smartStart
    });
    const isExplicitSeek = windowData.startSecond !== undefined && windowData.startSecond !== null;
    const isResumeSeek = !!currentPlayingPart.UserData?.PlaybackPositionTicks;

    // Auto-detect VR Video format (pure 2D vs 3D-to-2D vs true VR)
    const initialVr = detectVrVideo(currentPlayingPart, videoEl);
    if (initialVr.isVr) {
      setIsVrActive(true);
      setDetectedVrMode(initialVr.mode);
    } else {
      setIsVrActive(false);
    }

    const onLoadedMetadata = () => {
      let targetSeek = initialSeekTime;
      if (targetSeek === 0 && !isExplicitSeek && !isResumeSeek && playbackDefaultsRef.current.smartStart) {
        targetSeek = calculateSmartStartTime(currentPlayingPart, {
          smartStartEnabled: true,
          duration: videoEl.duration
        });
        initialSeekTime = targetSeek;
      }

      if (targetSeek > 0 && !controller.isTranscoding() && videoEl) {
        videoEl.currentTime = targetSeek;
      }
      if (targetSeek > 0 && !isExplicitSeek && !isResumeSeek && playbackDefaultsRef.current.smartStart) {
        setSmartStartToast(`🎯 已智能跳过前奏起播 (${formatTime(targetSeek)})`);
        setTimeout(() => setSmartStartToast(''), 3000);
      }
      // Re-verify with decoded video dimensions
      const vrCheck = detectVrVideo(currentPlayingPart, videoEl);
      if (vrCheck.isVr) {
        setIsVrActive(true);
        setDetectedVrMode(vrCheck.mode);
      }
    };
    videoEl.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });

    controller.loadStream({
      itemId: currentPartId,
      mediaSourceId: currentPartId,
      streamQuality: streamQualityRef.current,
      initialSeekTime,
      playbackSpeed: playbackSpeedRef.current,
      isMuted: isMutedRef.current,
      volume: volumeRef.current
    });

    return () => {
      videoEl.removeEventListener('loadedmetadata', onLoadedMetadata);
      controller.destroy();
    };
  }, [currentPartId, windowData.startSecond]);

  // Reload Video Stream & Metadata (to fetch newly downloaded subtitles)
  const handleReloadStream = useCallback(async (customPlaybackData = null) => {
    setIsLoading(true);
    const videoEl = videoRef.current;
    const currentPos = videoEl?.currentTime || 0;
    try {
      const freshInfo = customPlaybackData || await jellyfin.getItemPlaybackInfo(currentPartId);
      if (freshInfo) {
        setPlaybackData(freshInfo);
      }
    } catch (e) {
      console.warn('Failed to reload item metadata:', e);
    }
    if (sessionControllerRef.current) {
      await sessionControllerRef.current.loadStream({
        itemId: currentPartId,
        mediaSourceId: currentPartId,
        streamQuality: streamQualityRef.current,
        initialSeekTime: currentPos,
        playbackSpeed: playbackSpeedRef.current,
        isMuted: isMutedRef.current,
        volume: volumeRef.current
      });
      syncSubtitleModes();
    }
    setIsLoading(false);
  }, [currentPartId, setPlaybackData, syncSubtitleModes]);

  // Switch Stream Quality / Transcode Bitrate seamlessly
  const changeStreamQuality = useCallback((qualityId, silent = false) => {
    if (!currentPartId) return;

    setStreamQuality(qualityId);
    setShowQualityMenu(false);

    sessionControllerRef.current?.changeQuality(qualityId);

    if (!silent) {
      if (qualityId === 'direct') {
        setSmoothToast('🎬 已切换为原画直推模式');
      } else {
        const opt = QUALITY_OPTIONS.find(q => q.id === qualityId);
        setSmoothToast(`⚡ 已切换为 ${opt?.shortLabel || qualityId} 转码模式`);
      }
      setTimeout(() => setSmoothToast(''), 3000);
    }
  }, [currentPartId]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !video.duration || isDraggingScrubberRef.current) return;
    setRawDuration(video.duration);
    const p = (video.currentTime / video.duration) * 100;
    setProgress(p);
    setCurrentTimeText(formatTime(video.currentTime));
    setDurationText(formatTime(video.duration));

    // 霓虹巡更轮播模式：按实际活跃播放时间（秒）累计倒计时
    if (playbackDefaultsRef.current.patrolMode && !hasPatrolSkippedRef.current && !video.paused && !video.seeking) {
      const targetInterval = playbackDefaultsRef.current.patrolIntervalSeconds || 45;
      const now = globalThis.performance.now();
      if (lastPatrolTickRef.current) {
        const deltaSec = (now - lastPatrolTickRef.current) / 1000;
        if (deltaSec > 0 && deltaSec < 3) {
          patrolElapsedRef.current += deltaSec;
        }
      }
      lastPatrolTickRef.current = now;

      const remaining = Math.max(0, Math.ceil(targetInterval - patrolElapsedRef.current));
      setPatrolRemainingSec(remaining);

      if (patrolElapsedRef.current >= targetInterval) {
        hasPatrolSkippedRef.current = true;
        handleSkipNext();
      }
    } else {
      lastPatrolTickRef.current = null;
    }
  };

  // Video Ended -> increment play count and play next part / next episode / skip
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
    sessionControllerRef.current?.destroy();

    // Multi-part check: if more parts exist in this video, play next part!
    if (partsList.length > 1 && currentPartIndex < partsList.length - 1) {
      setCurrentPartIndex(prev => prev + 1);
    } else if (item?.SeriesId && jellyfin.auth.isConfigured) {
      // 剧集：自动连播下一集（无下一集时回退到随机换片）
      jellyfin.getEpisodes(item.SeriesId).then(list => {
        const idx = list.findIndex(ep => ep.Id === item.Id);
        const nextEp = (idx >= 0 && idx + 1 < list.length) ? list[idx + 1] : null;
        if (nextEp && onSwitchItem) {
          onSwitchItem(item.Id, nextEp);
        } else if (onSkip) {
          onSkip(id);
        }
      }).catch(() => {
        if (onSkip) onSkip(id);
      });
    } else {
      // No more parts, skip to next video (promote next windows forward)
      if (onSkip) onSkip(id);
    }
  };

  const handleSkipNext = () => {
    if (partsList.length > 1 && currentPartIndex < partsList.length - 1) {
      setCurrentPartIndex(prev => prev + 1);
    } else {
      if (onSkip) onSkip(id);
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
      const commitTime = wheelSeekingTimeRef.current;
      wheelSeekingTimeRef.current = null;
      setIsWheelSeeking(false);
      setHoverScrubberTime(null);
      if (commitTime !== null) {
        sessionControllerRef.current?.seek(commitTime);
      }
    }, 400);
  }, [seekSpeed]);

  // Scrubber Mouse & Touch Drag Seeking
  const updateScrubberPreview = useCallback((clientX) => {
    if (!scrubberRef.current || !videoRef.current) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const duration = videoRef.current.duration || (item?.RunTimeTicks ? item.RunTimeTicks / 10000000 : 0);
    if (!duration) return;

    const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetTime = duration * p;

    scrubberDragTimeRef.current = targetTime;
    setProgress(p * 100);
    setCurrentTimeText(formatTime(targetTime));
    setHoverScrubberTime(targetTime);
    setHoverScrubberPercent(p);
    setScrubberWidth(rect.width);
  }, [item?.RunTimeTicks]);

  const handleScrubberMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingScrubberRef.current = true;
    updateScrubberPreview(e.clientX);

    const handleWindowMouseMove = (moveEvent) => {
      if (isDraggingScrubberRef.current) {
        updateScrubberPreview(moveEvent.clientX);
      }
    };

    const handleWindowMouseUp = (upEvent) => {
      if (isDraggingScrubberRef.current) {
        isDraggingScrubberRef.current = false;
        updateScrubberPreview(upEvent.clientX);
        const commitTarget = scrubberDragTimeRef.current;
        if (commitTarget !== null && commitTarget !== undefined) {
          sessionControllerRef.current?.seek(commitTarget);
        }
      }
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
  }, [updateScrubberPreview]);

  const handleScrubberTouchStart = useCallback((e) => {
    if (e.touches.length !== 1) return;
    isDraggingScrubberRef.current = true;
    updateScrubberPreview(e.touches[0].clientX);
  }, [updateScrubberPreview]);

  const handleScrubberTouchMove = useCallback((e) => {
    if (e.touches.length !== 1) return;
    if (isDraggingScrubberRef.current) {
      e.preventDefault();
      updateScrubberPreview(e.touches[0].clientX);
    }
  }, [updateScrubberPreview]);

  const handleScrubberTouchEnd = useCallback(() => {
    if (isDraggingScrubberRef.current) {
      isDraggingScrubberRef.current = false;
      const commitTarget = scrubberDragTimeRef.current;
      if (commitTarget !== null && commitTarget !== undefined) {
        sessionControllerRef.current?.seek(commitTarget);
      }
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

  // 播放失败重试：重载当前源并恢复播放
  const handleRetryPlayback = () => {
    setHasError(false);
    setIsLoading(true);
    setErrorDetails('');
    const video = videoRef.current;
    if (video) {
      video.load();
      video.play().catch(() => {});
    }
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

  // Toggle Played Status（失败回滚，避免 UI 与服务器状态不一致）
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
      if (onUpdateItem) {
        onUpdateItem(item);
      }
    }
  };

  // Delete Video from Disk — 使用统一样式化确认弹窗（与影院/媒体库一致）
  const handleConfirmDelete = async () => {
    try {
      await jellyfin.deleteItem(item.Id);
      setShowDeleteModal(false);
      if (onDeleteItem) onDeleteItem(item.Id);
      if (onSkip) onSkip(id); // Triggers shift & slot promotion!
    } catch (err) {
      alert(err.message || '删除失败');
    }
  };

  // Middle Click to Close (Trigger Shift & Next Window Promotion)
  const handleAuxClick = (e) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      if (onClose) onClose(id);
    }
  };

  const coverUrl = useMemo(() => {
    if (!item?.Id) return null;
    return jellyfin.getBestImageUrl(item, { maxWidth: 500 });
  }, [item]);

  const isFavorite = !!item?.UserData?.IsFavorite;

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
      {isMobileViewport && (
        <TrickplayScrubberThumbnail
          item={trickplayItem}
          hoverTime={hoverScrubberTime}
          hoverPercent={hoverScrubberPercent}
          containerWidth={layout.width}
          mode="window"
          position={layout.top > (vpHeight * 0.42) ? 'above' : 'below'}
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
          {/* 霓虹巡更轮巡实时倒计时徽章 */}
          {playbackDefaults.patrolMode && (
            <div
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-cyan-950/90 border border-cyan-400/90 text-cyan-300 text-[10px] font-mono font-bold shadow-[0_0_8px_rgba(6,182,212,0.5)] flex-shrink-0 animate-pulse"
              title={`🚨 霓虹多窗巡更轮巡中：剩余 ${patrolRemainingSec} 秒自动轮换`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
              <span>巡更 {patrolRemainingSec}s</span>
            </div>
          )}
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
          {/* 手机端或窄窗模式：收拢为「更多功能」下拉菜单，仅保留 更多 / 下一个 / 关闭 3 枚核心按钮 */}
          {(isMobileViewport || layout.width < 460) ? (
            <>
              {/* 更多功能下拉菜单 */}
              <div className="relative">
                <button
                  onClick={() => setShowMoreMenu(prev => !prev)}
                  className={`p-1 rounded transition ${
                    showMoreMenu ? 'bg-cyan-500/30 text-cyan-300' : 'text-gray-400 hover:text-cyan-300 hover:bg-white/10'
                  }`}
                  title="更多功能与播放选项"
                >
                  <MoreVertical size={14} />
                </button>

                {showMoreMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                    <div
                      className="absolute right-0 top-7 w-60 bg-[#0d131f] border-2 border-cyan-400/70 rounded-2xl p-2.5 shadow-[0_20px_60px_rgba(0,0,0,0.95)] flex flex-col gap-2 z-50 text-xs animate-in fade-in zoom-in-95 duration-100 max-h-[75vh] overflow-y-auto"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between border-b border-white/10 pb-1.5 px-1">
                        <span className="font-bold text-white text-xs flex items-center gap-1.5">
                          <SlidersHorizontal size={13} className="text-cyan-400" />
                          播放功能选项
                        </span>
                        <button
                          onClick={() => setShowMoreMenu(false)}
                          className="p-1 rounded-full text-gray-400 hover:text-white hover:bg-white/10"
                        >
                          <X size={13} />
                        </button>
                      </div>

                      {/* 1. 画质与清晰度 */}
                      <div className="flex flex-col gap-1 px-1">
                        <span className="text-[10px] text-cyan-300 font-bold">🎥 播放画质</span>
                        <div className="grid grid-cols-3 gap-1">
                          {QUALITY_OPTIONS.map(opt => (
                            <button
                              key={opt.id}
                              onClick={() => { changeStreamQuality(opt.id, false); setShowMoreMenu(false); }}
                              className={`py-1 px-1 rounded-lg text-[10px] text-center transition ${
                                streamQuality === opt.id
                                  ? 'bg-cyan-400 text-slate-950 font-bold shadow'
                                  : 'bg-slate-800 text-gray-300 hover:bg-slate-700 border border-white/10'
                              }`}
                            >
                              {opt.shortLabel}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 2. 快进/寻轨步长 */}
                      <div className="flex flex-col gap-1 px-1">
                        <span className="text-[10px] text-cyan-300 font-bold">⏩ 寻轨/快进步长</span>
                        <div className="grid grid-cols-3 gap-1">
                          {SEEK_SPEED_OPTIONS.map(opt => (
                            <button
                              key={opt.id}
                              onClick={() => { setStoredSeekSpeed(opt.id); setSeekSpeed(opt.id); setShowMoreMenu(false); }}
                              className={`py-1 px-1 rounded-lg text-[10px] text-center transition ${
                                seekSpeed === opt.id
                                  ? 'bg-cyan-400 text-slate-950 font-bold shadow'
                                  : 'bg-slate-800 text-gray-300 hover:bg-slate-700 border border-white/10'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 3. 画面比例与水平镜像 */}
                      <div className="flex flex-col gap-1 px-1">
                        <span className="text-[10px] text-cyan-300 font-bold">📐 画面比例与镜像</span>
                        <div className="grid grid-cols-4 gap-1">
                          {[
                            { id: 'contain', label: '原比例' },
                            { id: 'cover', label: '铺满' },
                            { id: 'fill', label: '拉伸' }
                          ].map(opt => (
                            <button
                              key={opt.id}
                              onClick={() => { setAspectMode(opt.id); setShowMoreMenu(false); }}
                              className={`py-1 px-1 rounded-lg text-[10px] text-center transition ${
                                aspectMode === opt.id
                                  ? 'bg-cyan-400 text-slate-950 font-bold shadow'
                                  : 'bg-slate-800 text-gray-300 hover:bg-slate-700 border border-white/10'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                          <button
                            onClick={() => { setFlipH(prev => !prev); }}
                            className={`py-1 px-1 rounded-lg text-[10px] text-center transition flex items-center justify-center gap-0.5 ${
                              flipH
                                ? 'bg-cyan-400 text-slate-950 font-bold shadow'
                                : 'bg-slate-800 text-gray-300 hover:bg-slate-700 border border-white/10'
                            }`}
                          >
                            <FlipHorizontal size={11} />
                            <span>镜像</span>
                          </button>
                        </div>
                      </div>

                      {/* 4. 快捷功能开关列表 */}
                      <div className="flex flex-col gap-1 border-t border-white/10 pt-1.5 px-1">
                        {/* 字幕管理 */}
                        <button
                          onClick={() => { setShowSubtitleModal(true); setShowMoreMenu(false); }}
                          className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/10 text-gray-200 transition"
                        >
                          <span className="flex items-center gap-2">
                            <Subtitles size={13} className="text-cyan-400" />
                            <span>字幕管理与下载</span>
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono">
                            {selectedSubtitleIndex !== -1 ? '已选' : '关闭'}
                          </span>
                        </button>

                        {/* 快捷打标 */}
                        <button
                          onClick={() => { setShowTagMenu(true); setShowMoreMenu(false); }}
                          className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/10 text-gray-200 transition"
                        >
                          <span className="flex items-center gap-2">
                            <Tag size={13} className="text-cyan-400" />
                            <span>快捷打标</span>
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {(item?.Tags?.length || 0) > 0 ? `${item.Tags.length}个` : '未打标'}
                          </span>
                        </button>

                        {/* 海报画中画 */}
                        <button
                          onClick={() => setShowPinnedPoster(prev => !prev)}
                          className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/10 text-gray-200 transition"
                        >
                          <span className="flex items-center gap-2">
                            <ImageIcon size={13} className="text-cyan-400" />
                            <span>海报画中画</span>
                          </span>
                          <span className={`text-[10px] font-bold ${showPinnedPoster ? 'text-cyan-400' : 'text-gray-500'}`}>
                            {showPinnedPoster ? '已开启' : '已关闭'}
                          </span>
                        </button>

                        {/* VR 全景 */}
                        <button
                          onClick={() => setIsVrActive(prev => !prev)}
                          className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/10 text-gray-200 transition"
                        >
                          <span className="flex items-center gap-2">
                            <Glasses size={13} className="text-amber-400" />
                            <span>VR 全景视点</span>
                          </span>
                          <span className={`text-[10px] font-bold ${isVrActive ? 'text-amber-300' : 'text-gray-500'}`}>
                            {isVrActive ? '已开启' : '已关闭'}
                          </span>
                        </button>

                        {/* 收藏最爱 */}
                        <button
                          onClick={handleToggleFavorite}
                          className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/10 text-gray-200 transition"
                        >
                          <span className="flex items-center gap-2">
                            <Star size={13} className={isFavorite ? 'fill-amber-400 text-amber-400' : 'text-gray-400'} />
                            <span>收藏最爱</span>
                          </span>
                          <span className={`text-[10px] font-bold ${isFavorite ? 'text-amber-400' : 'text-gray-500'}`}>
                            {isFavorite ? '最爱' : '未收藏'}
                          </span>
                        </button>

                        {/* 播放状态标记 */}
                        <button
                          onClick={handleTogglePlayed}
                          className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/10 text-gray-200 transition"
                        >
                          <span className="flex items-center gap-2">
                            {item?.UserData?.Played ? <EyeOff size={13} className="text-cyan-400" /> : <Eye size={13} className="text-gray-400" />}
                            <span>播放状态</span>
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {item?.UserData?.Played ? '已看' : '未播'}
                          </span>
                        </button>

                        {/* 重新加载/刷新流 */}
                        <button
                          onClick={() => { handleReloadStream(); setShowMoreMenu(false); }}
                          className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/10 text-gray-200 transition"
                        >
                          <span className="flex items-center gap-2">
                            <RefreshCw size={13} className="text-cyan-400" />
                            <span>重新加载流</span>
                          </span>
                        </button>

                        {/* 外部播放器 */}
                        <div className="flex items-center justify-between py-1 px-2 pt-1.5 border-t border-white/10">
                          <span className="text-[10px] text-gray-400 flex items-center gap-1.5">
                            <ExternalLink size={12} />
                            <span>外部播放</span>
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => { launchPlayer('mpv', item); setShowMoreMenu(false); }}
                              className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/40 text-[10px] font-mono"
                            >
                              MPV
                            </button>
                            <button
                              onClick={() => { launchPlayer('potplayer', item); setShowMoreMenu(false); }}
                              className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-500/40 text-[10px] font-mono"
                            >
                              Pot
                            </button>
                          </div>
                        </div>

                        {/* 从磁盘删除 */}
                        <button
                          onClick={() => { setShowDeleteModal(true); setShowMoreMenu(false); }}
                          className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-red-950/40 text-red-400 transition border-t border-white/10 mt-1"
                        >
                          <span className="flex items-center gap-2">
                            <Trash2 size={13} />
                            <span>从磁盘删除文件</span>
                          </span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
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

              {/* 快捷打标 */}
              <div className="relative">
                <button
                  onClick={() => setShowTagMenu(prev => !prev)}
                  className={`p-1 rounded transition ${
                    (item?.Tags?.length || 0) > 0 ? 'text-cyan-300 bg-cyan-500/20' : 'text-gray-400 hover:text-cyan-300'
                  }`}
                  title="快捷打标 (极品/精选/收藏片段/自制等)"
                >
                  <Tag size={13} />
                </button>

                {showTagMenu && (
                  <div
                    className="absolute right-0 top-7 z-50 animate-in fade-in zoom-in-95 duration-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <QuickTagSelector
                      item={item}
                      onUpdateItem={onUpdateItem}
                      onClose={() => setShowTagMenu(false)}
                    />
                  </div>
                )}
              </div>

              {/* 画面比例与水平镜像 */}
              <div className="relative">
                <button
                  onClick={() => setShowAspectMenu(prev => !prev)}
                  className={`p-1 rounded transition ${
                    aspectMode !== 'contain' || flipH ? 'text-cyan-300 bg-cyan-500/20' : 'text-gray-400 hover:text-cyan-300'
                  }`}
                  title="画面比例与镜像 (原比例/铺满/拉伸/水平镜像)"
                >
                  <Scaling size={13} />
                </button>

                {showAspectMenu && (
                  <div
                    className="absolute right-0 top-7 w-36 glass-panel rounded-xl shadow-2xl py-1 z-50 text-xs text-gray-200 divide-y divide-white/5 animate-in fade-in zoom-in-95 duration-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-3 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      画面比例
                    </div>
                    {[
                      { id: 'contain', label: '原比例' },
                      { id: 'cover', label: '铺满裁剪' },
                      { id: 'fill', label: '满屏拉伸' }
                    ].map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => { setAspectMode(opt.id); setShowAspectMenu(false); }}
                        className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition ${
                          aspectMode === opt.id ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'hover:bg-white/10 text-gray-300'
                        }`}
                      >
                        <span>{opt.label}</span>
                        {aspectMode === opt.id && <span className="text-cyan-400 text-xs">✓</span>}
                      </button>
                    ))}
                    <div className="py-1">
                      <button
                        onClick={() => { setFlipH(prev => !prev); setShowAspectMenu(false); }}
                        className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition ${
                          flipH ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'hover:bg-white/10 text-gray-300'
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <FlipHorizontal size={13} />
                          <span>水平镜像</span>
                        </span>
                        {flipH && <span className="text-cyan-400 text-xs">✓</span>}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Delete Video */}
              <button
                onClick={() => setShowDeleteModal(true)}
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
            </>
          )}

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
            onClick={() => onClose && onClose(id)}
            className="p-1 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition"
            title="关闭窗口 (中键 / 下一个顶上来)"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 智能跳前奏起播 提示 */}
      {smartStartToast && (
        <div className="absolute top-11 left-1/2 -translate-x-1/2 z-50 px-3 py-1 rounded-full bg-[#0d131f]/95 border border-cyan-400 text-cyan-300 text-[11px] font-bold shadow-xl shadow-cyan-500/30 backdrop-blur-md flex items-center gap-1.5 pointer-events-none animate-in fade-in zoom-in-95 duration-150">
          <span>{smartStartToast}</span>
        </div>
      )}

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
          className={`w-full h-full cursor-pointer z-10 select-none pointer-events-auto transition-transform duration-200 ${
            aspectMode === 'cover'
              ? 'object-cover'
              : aspectMode === 'fill'
                ? 'w-full h-full [object-fit:fill]'
                : 'object-contain'
          } ${flipH ? '-scale-x-100' : ''}`}
          style={{ WebkitTouchCallout: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
          onClick={togglePlay}
          onWaiting={() => setIsLoading(true)}
          onPlaying={() => {
            setIsLoading(false);
            setIsPlaying(true);
            syncSubtitleModes();
          }}
          onLoadedData={syncSubtitleModes}
          onPause={() => setIsPlaying(false)}
          onEnded={handleEnded}
          onTimeUpdate={handleTimeUpdate}
        >
          {subtitleStreams.map(s => (
            <track
              key={`${currentPartId}-${s.Index}`}
              kind="subtitles"
              label={s.Title || s.Language || `Subtitle ${s.Index}`}
              src={jellyfin.getSubtitleTrackUrl(currentPartId, mediaSourceId, s.Index)}
              srcLang={s.Language || 'zh'}
              data-index={s.Index}
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
            <img
              src={coverUrl}
              alt="Poster"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
              className="w-full h-full object-cover transition-transform group-hover/pip:scale-105"
            />
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

        {/* Playback Error（含失败原因诊断，替代原来的黑屏无提示） */}
        {hasError && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 bg-black/85 p-2 text-center">
            <Film size={20} className="text-red-400 flex-shrink-0" />
            <p className="text-[11px] text-red-300 font-medium">播放失败</p>
            {errorDetails && (
              <p className="text-[9px] font-mono text-gray-400 max-w-full break-all leading-relaxed">{errorDetails}</p>
            )}
            <button
              onClick={handleRetryPlayback}
              className="mt-1 px-3 py-1 rounded-lg bg-jf-accent hover:bg-cyan-400 text-white text-[10px] font-bold transition"
            >
              重试
            </button>
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
          {!isMobileViewport && (
            <TrickplayScrubberThumbnail
              item={trickplayItem}
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

            {/* 音量滑块（记忆并随播放上报真实音量） */}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-12 accent-cyan-400 h-1 bg-white/20 rounded-lg cursor-pointer appearance-none"
              title={`音量 ${Math.round((isMuted ? 0 : volume) * 100)}%`}
              onClick={(e) => e.stopPropagation()}
            />

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
              {PLAYBACK_SPEED_OPTIONS.map(sp => (
                <option key={sp} value={sp} className="bg-slate-900">{sp}x</option>
              ))}
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
        onSelectSubtitle={(idx) => selectSubtitle(idx)}
        onSubtitleDownloaded={(updatedPlayback, subIdx) => {
          if (updatedPlayback) setPlaybackData(updatedPlayback);
          if (subIdx !== undefined && subIdx !== null) selectSubtitle(subIdx);
        }}
        onClose={() => setShowSubtitleModal(false)}
      />

      {/* 统一样式化删除确认弹窗（替代原生 confirm） */}
      <DeleteConfirmModal
        isOpen={showDeleteModal}
        item={item}
        onConfirm={handleConfirmDelete}
        onClose={() => setShowDeleteModal(false)}
      />
    </div>
  );
}
