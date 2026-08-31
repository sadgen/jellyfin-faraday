import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { jellyfin } from '../api/jellyfinClient';
import { useExternalPlayer } from '../hooks/useExternalPlayer';
import { useTouchGestures } from '../hooks/useTouchGestures';
import { useVolumeControl } from '../hooks/useVolumeControl';
import { useMediaPlaybackInfo } from '../hooks/useMediaPlaybackInfo';
import { useSubtitleTracks } from '../hooks/useSubtitleTracks';
import { useViewport } from '../hooks/useViewport';
import TrickplayScrubberThumbnail from './TrickplayScrubberThumbnail';
import InlineVrCanvas from './InlineVrCanvas';
import DeleteConfirmModal from './DeleteConfirmModal';
import SubtitleModal from './SubtitleModal';
import VolumeControl from './VolumeControl';
import SleepTimerButton from './SleepTimerButton';
import QuickTagSelector from './QuickTagSelector';
import { detectVrVideo } from '../utils/vrDetector';
import { probeStreamStatus, describeVideoMediaError } from '../utils/playbackDiagnostics';
import { QUALITY_OPTIONS, PLAYBACK_SPEED_OPTIONS } from '../utils/qualityPresets';
import { SEEK_SPEED_OPTIONS, getStoredSeekSpeed, setStoredSeekSpeed, getSeekStepSeconds, getSeekSwipeSpan } from '../utils/seekSettings';
import { getPlaybackDefaults } from '../utils/playbackDefaults';
import { calculateSmartStartTime } from '../utils/smartStartHelper';
import { PlaybackSessionController } from '../utils/playbackSessionController';
import {
  Play, Pause, Maximize,
  Star, Eye, EyeOff, ExternalLink, X, Film,
  SkipForward, SkipBack, Sun, Zap, FastForward, Glasses, Trash2, Gauge,
  Subtitles, Music, Keyboard, ChevronRight, Tag, Scaling, FlipHorizontal
} from 'lucide-react';

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

function episodeLabel(ep) {
  if (!ep) return '';
  const s = ep.ParentIndexNumber;
  const e = ep.IndexNumber;
  const sPart = (s !== undefined && s !== null) ? `S${String(s).padStart(2, '0')}` : '';
  const ePart = (e !== undefined && e !== null) ? `E${String(e).padStart(2, '0')}` : '';
  return `${ep.SeriesName ? `${ep.SeriesName} ` : ''}${sPart}${ePart}`.trim();
}

const NEXT_EPISODE_COUNTDOWN_SECONDS = 8;

export default function VideoPlayerModal({
  isOpen,
  item,
  onClose,
  onNext,
  onPrev,
  onSwitchItem,
  onUpdateItem,
  onDeleteItem,
  onOpenVr: _onOpenVr
}) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const scrubberRef = useRef(null);

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

  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(() => playbackDefaults.speed || 1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorDetails, setErrorDetails] = useState('');
  const [showPlayerMenu, setShowPlayerMenu] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [showSubtitleModal, setShowSubtitleModal] = useState(false);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [showAspectMenu, setShowAspectMenu] = useState(false);
  const [aspectMode, setAspectMode] = useState('contain'); // 'contain' | 'cover' | 'fill'
  const [flipH, setFlipH] = useState(false);
  const [isVrActive, setIsVrActive] = useState(false);
  const [detectedVrMode, setDetectedVrMode] = useState('180_3d_sbs');

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
  const scrubberDragTimeRef = useRef(null);

  // Mouse Wheel Seek State
  const [_isWheelSeeking, setIsWheelSeeking] = useState(false);
  const wheelTimerRef = useRef(null);
  const wheelSeekingTimeRef = useRef(null);

  // Playback reporting & PlayCount Tracking
  const hasCountedPlayRef = useRef(false);

  // 播放失败诊断：直连失败原因暂存，致命错误时合并展示
  const directDiagRef = useRef('');

  // 统一播放会话控制器
  const sessionControllerRef = useRef(null);
  if (!sessionControllerRef.current) {
    sessionControllerRef.current = new PlaybackSessionController({
      jellyfinClient: jellyfin,
      onError: (data) => {
        setHasError(true);
        setErrorMessage('视频加载失败，请重试');
        const parts = [];
        if (directDiagRef.current) parts.push(directDiagRef.current);
        parts.push(`HLS: ${data?.type || 'Error'}/${data?.details || 'Unknown'}${data?.response?.code ? ` (HTTP ${data.response.code})` : ''}`);
        if (videoRef.current?.videoWidth > 0) {
          parts.push(`${videoRef.current.videoWidth}×${videoRef.current.videoHeight}${isVrActiveRef.current ? ' · VR模式已激活' : ''}`);
        }
        setErrorDetails(parts.join(' | '));
        probeStreamStatus(jellyfin.getStreamUrl(itemRef.current?.Id)).then(status => {
          setErrorDetails(prev => `${prev} | 直连探测: ${status}`);
        }).catch(() => {});
      },
      onAutoDirectFallback: () => {
        directDiagRef.current = '直连流: 加载失败，已自动回退到转码流';
        const defaultQuality = streamQualityRef.current !== 'direct' ? streamQualityRef.current : '4000000';
        setStreamQuality(defaultQuality);
        sessionControllerRef.current?.loadStream({
          itemId: itemRef.current?.Id,
          mediaSourceId: mediaSourceId,
          streamQuality: defaultQuality,
          initialSeekTime: videoRef.current?.currentTime || 0,
          playbackSpeed: playbackSpeedRef.current,
          isMuted: isMutedRef.current,
          volume: volumeRef.current
        });
      }
    });
  }

  // 音轨 / 字幕 / 音量 / PlaybackInfo（共享 hooks）
  const { playbackData, setPlaybackData } = useMediaPlaybackInfo(item?.Id);
  const { volume, setVolume, isMuted, setIsMuted, toggleMute } = useVolumeControl(videoRef);
  const { subtitleStreams, mediaSourceId, selectedSubtitleIndex, selectSubtitle, syncSubtitleModes } =
    useSubtitleTracks({ item, playbackData, videoRef });
  const viewport = useViewport();

  // 音轨流（多音轨视频切换，如 双语配音 / 导演评论）
  const audioStreams = useMemo(() => {
    const ms = playbackData?.MediaSources?.[0] || item?.MediaSources?.[0];
    const streams = ms?.MediaStreams || playbackData?.MediaStreams || item?.MediaStreams || [];
    return streams.filter(s => s.Type === 'Audio');
  }, [playbackData, item]);
  const [selectedAudioStreamIndex, setSelectedAudioStreamIndex] = useState(null);

  // 下一集预取（剧集连播）
  const [nextEpisode, setNextEpisode] = useState(null);
  const [episodeCountdown, setEpisodeCountdown] = useState(null);

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

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // ==================== 键盘快捷键 (P1) ====================
  useEffect(() => {
    if (!isOpen) return;
    const isTypingTarget = (t) => t && (
      t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable
    );

    const handleKeyDown = (e) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const video = videoRef.current;

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (video && video.duration) {
            const next = Math.max(0, (video.currentTime || 0) - getSeekStepSeconds(seekSpeed));
            sessionControllerRef.current?.seek(next);
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (video && video.duration) {
            const next = Math.min(video.duration, (video.currentTime || 0) + getSeekStepSeconds(seekSpeed));
            sessionControllerRef.current?.seek(next);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(volumeRef.current + 0.05);
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(volumeRef.current - 0.05);
          break;
        case 'm':
        case 'M':
          toggleMute();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'n':
        case 'N':
          if (onNext) onNext();
          break;
        case 'p':
        case 'P':
          if (onPrev) onPrev();
          break;
        case 'Escape':
          onClose();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, seekSpeed, togglePlay, toggleFullscreen, toggleMute, setVolume, onNext, onPrev, onClose]);

  // Mobile Touch Gestures with real-time Trickplay preview
  const { gestureState, brightness, touchHandlers } = useTouchGestures({
    videoRef,
    containerRef,
    duration: rawDuration,
    currentTime: videoRef.current?.currentTime || 0,
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
  const streamQualityRef = useRef(streamQuality);
  streamQualityRef.current = streamQuality;
  const itemRef = useRef(item);
  itemRef.current = item;
  const onUpdateItemRef = useRef(onUpdateItem);
  onUpdateItemRef.current = onUpdateItem;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const selectedAudioStreamIndexRef = useRef(selectedAudioStreamIndex);
  selectedAudioStreamIndexRef.current = selectedAudioStreamIndex;
  const isVrActiveRef = useRef(isVrActive);
  isVrActiveRef.current = isVrActive;

  // Cleanup timers on component unmount
  useEffect(() => {
    return () => {
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    };
  }, []);

  // 每次换片重置音轨选择与下一集信息
  useEffect(() => {
    setSelectedAudioStreamIndex(null);
    setNextEpisode(null);
    setEpisodeCountdown(null);
  }, [item?.Id]);

  // 剧集：预取下一集（自动连播）
  useEffect(() => {
    if (!item?.SeriesId || !jellyfin.auth.isConfigured) return;
    let cancelled = false;
    jellyfin.getEpisodes(item.SeriesId).then(list => {
      if (cancelled || !list || list.length === 0) return;
      const idx = list.findIndex(ep => ep.Id === item.Id);
      if (idx >= 0 && idx + 1 < list.length) {
        setNextEpisode(list[idx + 1]);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [item?.Id, item?.SeriesId]);

  // 下一集倒计时（可取消）
  useEffect(() => {
    if (episodeCountdown === null) return undefined;
    if (episodeCountdown <= 0) {
      setEpisodeCountdown(null);
      if (nextEpisode && onSwitchItem) onSwitchItem(nextEpisode);
      return undefined;
    }
    const timer = setTimeout(() => setEpisodeCountdown(c => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [episodeCountdown, nextEpisode, onSwitchItem]);

  const playNextEpisodeNow = useCallback(() => {
    setEpisodeCountdown(null);
    if (nextEpisode && onSwitchItem) onSwitchItem(nextEpisode);
  }, [nextEpisode, onSwitchItem]);

  useEffect(() => {
    const controller = sessionControllerRef.current;
    if (!controller) return;

    if (!isOpen || !item?.Id) {
      controller.destroy();
      return;
    }

    setIsLoading(true);
    setHasError(false);
    setErrorMessage('');
    setErrorDetails('');
    directDiagRef.current = '';
    setProgress(0);
    setHoverScrubberTime(null);
    setIsWheelSeeking(false);

    const videoEl = videoRef.current;
    if (!videoEl) return;
    controller.attachVideo(videoEl);

    // Auto-detect VR Video format (pure 2D vs 3D-to-2D vs true VR)
    const initialVr = detectVrVideo(item, videoEl);
    if (initialVr.isVr) {
      setIsVrActive(true);
      setDetectedVrMode(initialVr.mode);
    } else {
      setIsVrActive(false);
    }

    hasCountedPlayRef.current = false;

    // Determine initial seek time: Trickplay click time > server resumeTicks > smartStart > 0
    let initialSeekTime = calculateSmartStartTime(item, {
      explicitStartSecond: item.startSecond,
      smartStartEnabled: playbackDefaultsRef.current.smartStart
    });
    const isExplicitSeek = item.startSecond !== undefined && item.startSecond !== null;
    const isResumeSeek = !!item.UserData?.PlaybackPositionTicks;

    const onLoadedMetadata = () => {
      let targetSeek = initialSeekTime;
      if (targetSeek === 0 && !isExplicitSeek && !isResumeSeek && playbackDefaultsRef.current.smartStart) {
        targetSeek = calculateSmartStartTime(item, {
          smartStartEnabled: true,
          duration: videoEl.duration
        });
        initialSeekTime = targetSeek;
      }

      if (targetSeek > 0 && !controller.isTranscoding() && videoEl) {
        videoEl.currentTime = targetSeek;
      }
      if (targetSeek > 0 && !isExplicitSeek && !isResumeSeek && playbackDefaultsRef.current.smartStart) {
        setSmoothToast(`🎯 已智能跳过前奏起播 (${formatTime(targetSeek)})`);
        setTimeout(() => setSmoothToast(''), 3000);
      }
      const vrCheck = detectVrVideo(item, videoEl);
      if (vrCheck.isVr) {
        setIsVrActive(true);
        setDetectedVrMode(vrCheck.mode);
      }
    };
    videoEl.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });

    controller.loadStream({
      itemId: item.Id,
      mediaSourceId: mediaSourceId,
      streamQuality: streamQualityRef.current,
      audioStreamIndex: selectedAudioStreamIndexRef.current,
      initialSeekTime,
      playbackSpeed: playbackSpeedRef.current,
      isMuted: isMutedRef.current,
      volume: volumeRef.current
    });

    return () => {
      videoEl.removeEventListener('loadedmetadata', onLoadedMetadata);
      controller.destroy();
    };
  }, [isOpen, item?.Id, mediaSourceId]);

  // Switch Stream Quality / Transcode Bitrate seamlessly
  const changeStreamQuality = useCallback((qualityId, silent = false) => {
    if (!item?.Id) return;

    if (qualityId === 'direct' && selectedAudioStreamIndexRef.current !== null) {
      setSelectedAudioStreamIndex(null);
    }

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
  }, [item?.Id]);

  // 切换音轨：直推无法指定音轨，切换后进入转码模式并保留播放位置
  const changeAudioTrack = useCallback((stream) => {
    if (!item?.Id || !stream) return;
    setShowAudioMenu(false);
    if (selectedAudioStreamIndexRef.current === stream.Index) return;

    const targetQualityId = streamQualityRef.current !== 'direct' ? streamQualityRef.current : '8000000';
    setSelectedAudioStreamIndex(stream.Index);
    setStreamQuality(targetQualityId);

    sessionControllerRef.current?.changeAudioTrack(stream.Index, targetQualityId);

    const trackName = stream.DisplayTitle || stream.Title || stream.Language || `音轨 ${stream.Index}`;
    setSmoothToast(`🎵 已切换音轨: ${trackName}（转码播放）`);
    setTimeout(() => setSmoothToast(''), 3000);
  }, [item?.Id]);

  // Video Ended -> increment play count, then next episode (with countdown) or next item
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
    if (nextEpisode) {
      setEpisodeCountdown(NEXT_EPISODE_COUNTDOWN_SECONDS);
    } else if (onNext) {
      onNext();
    }
  };

  // Mouse Wheel Fast-Forward / Rewind (Debounced commit)
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

  // Scrubber Mouse Drag Seeking
  const updateScrubberPreview = useCallback((clientX) => {
    if (!scrubberRef.current || !videoRef.current) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const duration = videoRef.current.duration || (item?.RunTimeTicks ? item.RunTimeTicks / 10000000 : 0);
    if (!duration) return;

    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetTime = duration * pos;

    scrubberDragTimeRef.current = targetTime;
    setProgress(pos * 100);
    setCurrentTimeText(formatTime(targetTime));
    setHoverScrubberTime(targetTime);
    setHoverScrubberPercent(pos);
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
    if (!duration) return;
    const targetTime = duration * pos;
    setHoverScrubberTime(targetTime);
    setHoverScrubberPercent(pos);
    setScrubberWidth(rect.width);
  };

  const handleScrubberMouseLeave = () => {
    if (!isDraggingScrubberRef.current) {
      setHoverScrubberTime(null);
    }
  };

  const handleToggleFavorite = async () => {
    if (!item?.Id) return;
    const nextFav = !item.UserData?.IsFavorite;
    const optimistic = {
      ...item,
      UserData: { ...item.UserData, IsFavorite: nextFav }
    };
    if (onUpdateItem) onUpdateItem(optimistic);
    try {
      await jellyfin.toggleFavorite(item.Id, nextFav);
    } catch (e) {
      console.warn('Failed to toggle favorite:', e);
      if (onUpdateItem) onUpdateItem(item);
    }
  };

  const handleTogglePlayed = async () => {
    if (!item?.Id) return;
    const nextPlayed = !item.UserData?.Played;
    const optimistic = {
      ...item,
      UserData: {
        ...item.UserData,
        Played: nextPlayed,
        PlayCount: nextPlayed ? Math.max(1, (item.UserData?.PlayCount || 0) + 1) : 0
      }
    };
    if (onUpdateItem) onUpdateItem(optimistic);
    try {
      await jellyfin.markPlayed(item.Id, nextPlayed);
    } catch (e) {
      console.warn('Failed to toggle played:', e);
      if (onUpdateItem) onUpdateItem(item);
    }
  };

  const handleConfirmDelete = async () => {
    try {
      await jellyfin.deleteItem(item.Id);
      if (onDeleteItem) onDeleteItem(item.Id);
      setShowDeleteModal(false);
      onClose();
    } catch (err) {
      alert(err.message || '删除失败');
    }
  };

  const posterUrl = item?.Id ? jellyfin.getBestImageUrl(item, { maxWidth: 800, preferBackdrop: true }) : null;
  const isFavorite = !!item?.UserData?.IsFavorite;

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
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* 睡眠定时 */}
            <SleepTimerButton onExpire={() => { if (videoRef.current) videoRef.current.pause(); }} />

            {/* 键盘快捷键提示 */}
            <button
              className="hidden sm:flex p-1.5 rounded-lg text-gray-500 hover:text-gray-300 transition"
              title="快捷键：空格/K 暂停 · ←/→ 快退快进 · ↑/↓ 音量 · M 静音 · F 全屏 · N/P 上/下一个 · Esc 关闭"
            >
              <Keyboard size={15} />
            </button>

            <button
              onClick={() => setIsVrActive(!isVrActive)}
              className={`px-2.5 py-1.5 rounded-lg border font-bold transition flex items-center gap-1.5 ${
                isVrActive
                  ? 'bg-amber-500/40 border-amber-400 text-amber-300 animate-pulse'
                  : 'bg-amber-500/20 hover:bg-amber-500/30 border-amber-400/40 text-amber-300'
              }`}
            >
              <Glasses size={14} />
              <span className="hidden sm:inline">{isVrActive ? '退出 VR' : '开启 VR'}</span>
            </button>

            <div className="relative">
              <button
                onClick={() => setShowPlayerMenu(!showPlayerMenu)}
                className="px-2.5 py-1.5 rounded-lg bg-black/60 hover:bg-black/80 border border-white/10 text-gray-300 hover:text-cyan-300 transition flex items-center gap-1.5"
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
                    <span className="text-[10px] text-cyan-400">pot://</span>
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

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden flex-1 select-none">
          {smoothToast && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 px-3.5 py-1.5 bg-black/85 backdrop-blur-md border border-cyan-400/60 rounded-full text-xs font-bold text-cyan-300 shadow-xl pointer-events-none animate-in fade-in duration-150">
              {smoothToast}
            </div>
          )}

          {posterUrl && (
            <img
              src={posterUrl}
              alt=""
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 pointer-events-none ${
                isLoading ? 'opacity-50 blur-md' : 'opacity-0'
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
            className={`w-full h-full cursor-pointer z-10 select-none transition-transform duration-200 ${
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
                key={`${item.Id}-${s.Index}`}
                kind="subtitles"
                label={s.Title || s.Language || `Subtitle ${s.Index}`}
                src={jellyfin.getSubtitleTrackUrl(item.Id, mediaSourceId, s.Index)}
                srcLang={s.Language || 'zh'}
                data-index={s.Index}
              />
            ))}
          </video>

          <InlineVrCanvas
            videoRef={videoRef}
            isActive={isVrActive}
            onClose={() => setIsVrActive(false)}
            initialMode={detectedVrMode}
          />

          {isLoading && !hasError && (
            <div className="absolute z-20 flex flex-col items-center justify-center pointer-events-none gap-2">
              <div className="w-10 h-10 border-3 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
              <span className="text-xs text-gray-300 font-mono">加载中...</span>
            </div>
          )}

          {hasError && (
            <div className="absolute z-20 flex flex-col items-center justify-center p-4 text-center">
              <div className="p-3 rounded-full bg-red-500/20 text-red-400 mb-2">
                <Film size={24} />
              </div>
              <p className="text-sm text-red-300 font-medium mb-2">{errorMessage}</p>
              {errorDetails && (
                <p className="text-[10px] font-mono text-gray-500 max-w-md break-all leading-relaxed mb-3 text-left">
                  {errorDetails}
                </p>
              )}
              <button
                onClick={() => {
                  setHasError(false);
                  setIsLoading(true);
                  setErrorDetails('');
                  if (videoRef.current) {
                    videoRef.current.load();
                    videoRef.current.play().catch(() => {});
                  }
                }}
                className="px-4 py-1.5 rounded-xl bg-jf-accent hover:bg-cyan-400 text-white text-xs font-bold transition"
              >
                重试播放
              </button>
            </div>
          )}

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

          {/* 下一集自动连播倒计时 */}
          {episodeCountdown !== null && nextEpisode && (
            <div className="absolute top-3 right-3 z-40 flex flex-col gap-2 p-3 rounded-2xl bg-black/90 backdrop-blur-md border border-cyan-400/50 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200 max-w-[320px]">
              <div className="text-[11px] text-cyan-300 font-bold flex items-center gap-1.5">
                <SkipForward size={13} />
                <span>{episodeCountdown}s 后自动播放下一集</span>
              </div>
              <div className="text-xs text-white font-bold truncate">{episodeLabel(nextEpisode)}</div>
              <div className="text-[11px] text-gray-300 truncate">{nextEpisode.Name}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <button
                  onClick={playNextEpisodeNow}
                  className="px-3 py-1.5 rounded-lg bg-jf-accent hover:bg-cyan-400 text-white text-[11px] font-bold transition flex items-center gap-1"
                >
                  <Play size={11} className="fill-white" />
                  <span>立即播放</span>
                </button>
                <button
                  onClick={() => setEpisodeCountdown(null)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-gray-200 text-[11px] font-medium transition"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {!isPlaying && !isLoading && !hasError && (
            <div
              onClick={togglePlay}
              className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 cursor-pointer"
            >
              <div className="w-14 h-14 rounded-full bg-black/60 border border-white/20 flex items-center justify-center text-white shadow-2xl">
                <Play size={26} className="ml-1 fill-white" />
              </div>
            </div>
          )}
        </div>

        <div className="p-3 sm:p-4 bg-slate-900/95 border-t border-white/5 flex flex-col gap-2.5 pb-[max(1.25rem,env(safe-area-inset-bottom))] z-30 flex-shrink-0">
          <div className="relative w-full">
            <TrickplayScrubberThumbnail
              item={item}
              hoverTime={hoverScrubberTime}
              hoverPercent={hoverScrubberPercent}
              containerWidth={scrubberWidth}
              position="above"
              centerMode={viewport.width < 768}
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
                  title="上一个 (P)"
                >
                  <SkipBack size={14} />
                </button>
              )}

              {onNext && (
                <button
                  onClick={onNext}
                  className="p-2 rounded-xl bg-black/40 hover:bg-white/10 text-gray-300 transition"
                  title="下一个 (N)"
                >
                  <SkipForward size={14} />
                </button>
              )}

              {/* 音量滑块 + 静音（带记忆，随播放上报真实音量） */}
              <VolumeControl volume={volume} setVolume={setVolume} isMuted={isMuted} toggleMute={toggleMute} />

              <span className="font-mono text-gray-400 text-[11px] hidden xs:inline">
                {currentTimeText} / {durationText}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {/* 字幕管理（与浮窗共享 SubtitleModal） */}
              <button
                onClick={() => setShowSubtitleModal(true)}
                className={`p-2 rounded-xl border transition ${
                  selectedSubtitleIndex !== -1
                    ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-300'
                    : 'bg-black/40 border-white/5 text-gray-300 hover:text-cyan-300'
                }`}
                title="字幕选择 / 在线下载"
              >
                <Subtitles size={14} />
              </button>

              {/* 音轨切换（多音轨视频） */}
              {audioStreams.length > 1 && (
                <div className="relative">
                  <button
                    onClick={() => setShowAudioMenu(!showAudioMenu)}
                    className={`p-2 rounded-xl border transition ${
                      selectedAudioStreamIndex !== null
                        ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-300'
                        : 'bg-black/40 border-white/5 text-gray-300 hover:text-cyan-300'
                    }`}
                    title="切换音轨 (AudioStreamIndex)"
                  >
                    <Music size={14} />
                  </button>

                  {showAudioMenu && (
                    <div
                      className="absolute right-0 bottom-10 w-60 max-h-64 overflow-y-auto glass-panel rounded-xl shadow-2xl py-1 z-50 text-xs text-gray-200 divide-y divide-white/5 animate-in fade-in zoom-in-95 duration-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="px-3 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        选择音轨 ({audioStreams.length})
                      </div>
                      {audioStreams.map(s => (
                        <button
                          key={s.Index}
                          onClick={() => changeAudioTrack(s)}
                          className={`w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 transition ${
                            (selectedAudioStreamIndex === null && s.IsDefault) || selectedAudioStreamIndex === s.Index
                              ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                              : 'hover:bg-white/10 text-gray-300'
                          }`}
                        >
                          <span className="flex flex-col min-w-0">
                            <span className="truncate">{s.DisplayTitle || s.Title || `${s.Language || '音轨'} #${s.Index}`}</span>
                            <span className="text-[10px] text-gray-500 font-mono">
                              {s.Codec?.toUpperCase()} {s.Channels ? `• ${s.Channels}ch` : ''} {s.IsDefault ? '• 默认' : ''}
                            </span>
                          </span>
                          {((selectedAudioStreamIndex === null && s.IsDefault) || selectedAudioStreamIndex === s.Index) && (
                            <span className="text-cyan-400 text-xs">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 快捷打标 */}
              <div className="relative">
                <button
                  onClick={() => setShowTagMenu(prev => !prev)}
                  className={`p-2 rounded-xl border transition ${
                    (item?.Tags?.length || 0) > 0
                      ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-300'
                      : 'bg-black/40 border-white/5 text-gray-300 hover:text-cyan-300'
                  }`}
                  title="快捷打标 (极品/精选/收藏片段/自制等)"
                >
                  <Tag size={14} />
                </button>

                {showTagMenu && (
                  <div
                    className="absolute right-0 bottom-10 z-50 animate-in fade-in zoom-in-95 duration-100"
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
                  className={`p-2 rounded-xl border transition ${
                    aspectMode !== 'contain' || flipH
                      ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-300'
                      : 'bg-black/40 border-white/5 text-gray-300 hover:text-cyan-300'
                  }`}
                  title="画面比例与镜像翻转 (原比例/铺满/拉伸/水平翻转)"
                >
                  <Scaling size={14} />
                </button>

                {showAspectMenu && (
                  <div
                    className="absolute right-0 bottom-10 w-36 glass-panel rounded-xl shadow-2xl py-1 z-50 text-xs text-gray-200 divide-y divide-white/5 animate-in fade-in zoom-in-95 duration-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-3 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      画面比例
                    </div>
                    {[
                      { id: 'contain', label: '原比例 (黑边完整)' },
                      { id: 'cover', label: '铺满裁剪 (无黑边)' },
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
                          <span>水平镜像翻转</span>
                        </span>
                        {flipH && <span className="text-cyan-400 text-xs">✓</span>}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={handleToggleFavorite}
                className={`p-2 rounded-xl border transition ${
                  isFavorite ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'bg-black/40 border-white/5 text-gray-300 hover:text-amber-400'
                }`}
                title={isFavorite ? '取消收藏' : '加入最爱'}
              >
                <Star size={14} className={isFavorite ? 'fill-amber-400' : ''} />
              </button>

              <button
                onClick={handleTogglePlayed}
                className="p-2 rounded-xl bg-black/40 border border-white/5 text-gray-300 hover:text-cyan-400 transition"
                title={item?.UserData?.Played ? '标记未播' : '标记已播'}
              >
                {item?.UserData?.Played ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>

              <button
                onClick={() => setShowDeleteModal(true)}
                className="p-2 rounded-xl bg-black/40 border border-white/5 text-gray-400 hover:text-red-400 transition"
                title="从服务器和磁盘删除"
              >
                <Trash2 size={14} />
              </button>

              <div className="relative">
                <button
                  onClick={() => setShowSeekSpeedMenu(!showSeekSpeedMenu)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border bg-black/40 border-white/5 text-gray-300 hover:text-cyan-300 hover:bg-white/10 text-xs font-bold transition"
                  title="设置快进/快退/滚轮寻轨步长 (慢 5s / 中 15s / 快 30s)"
                >
                  <FastForward size={13} className="text-cyan-400" />
                  <span>{SEEK_SPEED_OPTIONS.find(o => o.id === seekSpeed)?.shortLabel || '15s'}</span>
                </button>

                {showSeekSpeedMenu && (
                  <div
                    className="absolute right-0 bottom-10 w-36 glass-panel rounded-xl shadow-2xl py-1 z-50 text-xs text-gray-200 divide-y divide-white/5 animate-in fade-in zoom-in-95 duration-100"
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
                  {PLAYBACK_SPEED_OPTIONS.map(sp => (
                    <option key={sp} value={sp} className="bg-slate-900">{sp}x</option>
                  ))}
                </select>
              </div>

              {/* 下一集直达按钮 */}
              {nextEpisode && (
                <button
                  onClick={playNextEpisodeNow}
                  className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-cyan-500/40 bg-cyan-950/60 hover:bg-cyan-900 text-cyan-300 text-[11px] font-bold transition"
                  title={`播放下一集: ${episodeLabel(nextEpisode)}`}
                >
                  <span>下一集</span>
                  <ChevronRight size={12} />
                </button>
              )}

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="p-2 rounded-xl bg-black/40 hover:bg-white/10 text-gray-300 transition"
                title="全屏 (F)"
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

      {/* 字幕管理 / 在线下载（与浮窗共享） */}
      <SubtitleModal
        isOpen={showSubtitleModal}
        item={item}
        currentSubtitleIndex={selectedSubtitleIndex}
        onSelectSubtitle={(idx) => selectSubtitle(idx)}
        onSubtitleDownloaded={(updatedPlayback, subIdx) => {
          if (updatedPlayback) setPlaybackData(updatedPlayback);
          selectSubtitle(subIdx);
        }}
        onClose={() => setShowSubtitleModal(false)}
      />
    </div>
  );
}
