import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { isNativePlayerAvailable } from '../utils/nativePlayerBridge';
import { jellyfin } from '../api/jellyfinClient';
import { calculateSlotStyle, calculateMaximizedStyle } from '../utils/windowLayout';
import { useExternalPlayer } from '../hooks/useExternalPlayer';
import { useTouchGestures } from '../hooks/useTouchGestures';
import { useVolumeControl } from '../hooks/useVolumeControl';
import { useMediaPlaybackInfo } from '../hooks/useMediaPlaybackInfo';
import { useSubtitleTracks } from '../hooks/useSubtitleTracks';
import { useViewport } from '../hooks/useViewport';
import { SEEK_SPEED_OPTIONS, getStoredSeekSpeed, setStoredSeekSpeed, getSeekStepSeconds } from '../utils/seekSettings';
import { createSeekLock } from '../utils/seekLock';
import { getPlaybackDefaults } from '../utils/playbackDefaults';
import { calculateSmartStartTime } from '../utils/smartStartHelper';
import { QUALITY_OPTIONS, PLAYBACK_SPEED_OPTIONS } from '../utils/qualityPresets';
import TrickplayScrubberThumbnail from './TrickplayScrubberThumbnail';
import * as THREE from 'three';
import InlineVrCanvas from './InlineVrCanvas';
import SubtitleOverlay from './SubtitleOverlay';
import SubtitleModal from './SubtitleModal';
import DeleteConfirmModal from './DeleteConfirmModal';
import QuickTagSelector from './QuickTagSelector';
import { detectVrVideo } from '../utils/vrDetector';
import { preloadAllTrickplaySprites } from '../utils/trickplay';
import { probeStreamStatus, describeVideoMediaError } from '../utils/playbackDiagnostics';
import { PlaybackSessionController } from '../utils/playbackSessionController';
import {
  Play, Pause, SkipForward, Volume1, Volume2, VolumeX,
  X, ExternalLink, Star, Eye, EyeOff, Image as ImageIcon,
  Glasses, Trash2, FastForward, Sun, Zap, Gauge, RefreshCw, Subtitles, Film,
  Tag, Scaling, FlipHorizontal, MoreVertical, SlidersHorizontal, Crop, RectangleHorizontal
} from 'lucide-react';

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// 设备朝向四元数（含横屏轴向补偿）→ 观察方向的水平朝向角，用于三屏取中的体感平移
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _qScreen = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const FLIP_X = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const Z_AXIS = new THREE.Vector3(0, 0, 1);
function deviceHeadingRad(e) {
  _euler.set(
    THREE.MathUtils.degToRad(e.beta),
    THREE.MathUtils.degToRad(e.alpha),
    -THREE.MathUtils.degToRad(e.gamma),
    'YXZ'
  );
  _quat.setFromEuler(_euler).multiply(FLIP_X)
    .multiply(_qScreen.setFromAxisAngle(Z_AXIS, -THREE.MathUtils.degToRad(window.screen?.orientation?.angle ?? window.orientation ?? 0)));
  _fwd.set(0, 0, -1).applyQuaternion(_quat);
  return Math.atan2(_fwd.x, _fwd.z);
}

export default function FloatingVideoWindow({
  windowData,
  isFront = false,
  onClose,
  onSkip,
  onExpand: _onExpand,
  onExclusiveCrop,
  onBringToFront,
  onUpdateItem,
  onDeleteItem,
  onSwitchItem
}) {
  const { id, slotIndex, item } = windowData;
  // 铺满模式：本窗放大到页面可用区域最大（点击窗内铺满按钮触发，同时关闭其他浮窗）
  const isMaximized = !!windowData.isMaximized;

  // 视频宽高比（loadedmetadata/resize 时取自视频元素），铺满模式按它自适应宽度避免黑边。
  // HLS 渐进式加载中分辨率可能多次变化，必须同时监听媒体元素的 resize 事件
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const videoAspectRef = useRef(16 / 9);
  videoAspectRef.current = videoAspect;

  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const scrubberRef = useRef(null);
  // 窗内头部/控制条实测高度：点击铺满那一刻测量（此时窗口还是普通态，两者高度
  // 与铺满态一致），使铺满几何一次性同步算出，无需等高度渲染后再二次测量
  const headerRef = useRef(null);
  const footerRef = useRef(null);

  // Initialize position and size using exact Tampermonkey slot formula
  const [layout, setLayout] = useState(() => isMaximized ? calculateMaximizedStyle(16 / 9, windowData.chromeH) : calculateSlotStyle(slotIndex));
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const isCustomPositionRef = useRef(false);
  const prevSlotRef = useRef(slotIndex);

  // 三屏取中：三竖屏拼接的横屏视频只显示中间 1/3，窗口自适应为竖屏比例
  const [cropThird, setCropThird] = useState(false);
  const cropThirdRef = useRef(false);
  cropThirdRef.current = cropThird;
  const preCropLayoutRef = useRef(null);
  // 三屏取中铺满：开启取中的同时独占页面（其他浮窗关闭），窗口上下顶满页面可用区
  const [cropFill, setCropFill] = useState(false);
  const cropFillRef = useRef(false);
  cropFillRef.current = cropFill;

  // 音量竖向滑杆弹层
  const [showVolumePop, setShowVolumePop] = useState(false);


  // 横屏：元素全屏 + 锁定横向（Android Chrome 支持 orientation.lock；桌面仅全屏）
  const [isLandscape, setIsLandscape] = useState(false);
  const handleLandscapeToggle = async () => {
    try {
      if (!document.fullscreenElement) {
        const el = containerRef.current;
        if (el?.requestFullscreen) await el.requestFullscreen();
        try { await window.screen.orientation?.lock?.('landscape'); } catch {}
        setIsLandscape(true);
      } else {
        try { window.screen.orientation?.unlock?.(); } catch {}
        await document.exitFullscreen();
        setIsLandscape(false);
      }
    } catch {}
  };
  useEffect(() => {
    const onFsChange = () => {
      const active = !!document.fullscreenElement;
      setIsLandscape(active);
      if (!active) {
        try { window.screen.orientation?.unlock?.(); } catch {}
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  /**
   * 三屏取中几何：
   * - 桌面：保持视频区高度不变，宽度收窄为"高 × 面板宽高比"（竖屏塔窗）
   * - 手机：保持宽度不变、视频区增高为竖屏（超屏高则连同宽度一起收缩）
   * 全部直读 window 尺寸（不依赖渲染期 viewport hook），保证 effect / 事件回调里调用时无陈旧闭包
   */
  function computeCropLayout(base) {
    const chromeH = (headerRef.current?.offsetHeight || 34) + (footerRef.current?.offsetHeight || 38);
    const aspect = videoAspectRef.current > 0 ? videoAspectRef.current / 3 : 16 / 27;
    const mobile = window.innerWidth < 768;
    let areaW;
    let areaH;
    if (mobile) {
      areaW = base.width;
      areaH = areaW / aspect;
      // 顶部 header 64 + 底部导航 60 + 余量 12 之外不得溢出屏幕
      const maxAreaH = Math.max(240, window.innerHeight - 64 - 60 - 12 - chromeH);
      if (areaH > maxAreaH) {
        areaH = maxAreaH;
        areaW = areaH * aspect;
      }
    } else {
      areaH = base.width * 9 / 16;
      areaW = Math.max(areaH * aspect, 260);
    }
    const width = Math.round(areaW);
    let left = Math.round(base.left + (base.width - width) / 2);
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    const totalH = Math.round(areaH + chromeH);
    const bottomMargin = mobile ? 68 : 8;
    let top = base.top;
    if (top + totalH > window.innerHeight - bottomMargin) {
      top = Math.round(window.innerHeight - bottomMargin - totalH);
    }
    top = Math.max(64, top);
    return { ...base, left, top, width };
  }

  /**
   * 三屏取中铺满几何：窗口高度吃满页面可用区（上让开 64px 顶栏、下让开导航/边距），
   * 宽度 = 高 × 竖屏面板比例；宽超屏则反向收缩（竖屏手机上方形/横内容会留上下空间）。
   */
  function computeCropFillLayout() {
    // 全出血：手机宽贴满屏幕两边，上贴工具栏（64px）下贴导航栏（68px），桌面留 8px 边距。
    // 视口由 object-cover 裁剪，比例不再约束窗口大小。
    const chromeH = (headerRef.current?.offsetHeight || 34) + (footerRef.current?.offsetHeight || 38);
    const mobile = window.innerWidth < 768;
    const margin = mobile ? 0 : 16;
    const top = mobile ? 64 : 72;
    const bottomGap = mobile ? 0 : 8;
    const width = window.innerWidth - margin;
    // 可用区先扣除窗内 chrome（头部+控制条）高度，根节点 = 可用区 + chrome，
    // 保证 footer 底边恰好贴在导航栏上方（此前多算一层 chromeH 导致控制条被导航栏挡住）
    const areaH = Math.max(240, window.innerHeight - top - bottomGap - chromeH);
    return {
      left: Math.round(margin / 2),
      top,
      width: Math.round(width),
      height: Math.round(areaH + chromeH)
    };
  }

  const handleToggleCropThird = () => {
    if (isMaximized) return;
    const next = !cropThird;
    setCropThird(next);
    if (next) {
      preCropLayoutRef.current = layout;
      setCropFill(true);
      isCustomPositionRef.current = false;
      // iOS 13+ 陀螺仪权限必须挂在用户手势里：点取中按钮即为手势时机
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().catch(() => {});
      }
      if (onExclusiveCrop) onExclusiveCrop(id);
      setLayout(computeCropFillLayout());
    } else {
      setCropFill(false);
      resetCropPan();
      setLayout(preCropLayoutRef.current || calculateSlotStyle(slotIndex));
    }
  };

  // 三屏取中全景平移：object-position 0%(最左屏)~100%(最右屏)，50% = 中屏。
  // 直接写 video.style（JSX 不管理该属性，React 重渲染不会覆盖），避免陀螺仪 60fps 触发整窗重渲染
  const cropPanRef = useRef(50);
  const resetCropPan = () => {
    cropPanRef.current = 50;
    if (videoRef.current) videoRef.current.style.objectPosition = '';
  };

  // 手机 + 取中铺满：陀螺仪水平转动在整幅三屏拼接画面上左右平移（全景效果）。
  // 零点 = 开启瞬间的朝向（显示中屏）；转动 180° ≈ 扫完整幅画面；传感器不可用时静止在中屏
  const gyroHeadingRef = useRef(null);
  useEffect(() => {
    if (!cropThird || !cropFill || window.innerWidth >= 768) {
      gyroHeadingRef.current = null;
      return;
    }
    const handleDeviceOrientation = (e) => {
      if (e.alpha === null || e.beta === null || e.gamma === null) return;
      const heading = deviceHeadingRad(e);
      if (gyroHeadingRef.current === null) {
        gyroHeadingRef.current = heading;
        return;
      }
      let d = heading - gyroHeadingRef.current;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      // 死区 + 低通：滤掉手持微颤（<0.6°/事件忽略，之后 EMA 平滑跟进）
      if (Math.abs(d) < 0.01) return;
      gyroHeadingRef.current += d * 0.3;
      const applied = d * 0.3;
      const sweepRad = Math.PI / 180 * (playbackDefaultsRef.current.gyroSweepDeg || 90);
      cropPanRef.current = Math.max(0, Math.min(100, cropPanRef.current - applied * (100 / sweepRad)));
      if (videoRef.current) videoRef.current.style.objectPosition = `${cropPanRef.current}% 50%`;
    };
    window.addEventListener('deviceorientation', handleDeviceOrientation, true);
    return () => window.removeEventListener('deviceorientation', handleDeviceOrientation, true);
  }, [cropThird, cropFill]);

  // 取中铺满状态下双指张开放大 → 手机全屏（Android Chrome 的元素级全屏可用；
  // iPhone Safari 不支持元素级 requestFullscreen，表达式静默跳过）；双指收拢退出
  const videoViewportRef = useRef(null);
  useEffect(() => {
    const el = videoViewportRef.current;
    if (!el || !cropFill) return;
    let startDist = 0;
    let tracking = false;
    const pinchDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e) => {
      if (e.touches.length === 2) {
        startDist = pinchDist(e.touches);
        tracking = true;
      } else {
        tracking = false;
      }
    };
    const onMove = (e) => {
      if (!tracking || e.touches.length !== 2 || startDist <= 0) return;
      const d = pinchDist(e.touches);
      if (d > startDist * 1.3 && !document.fullscreenElement) {
        tracking = false;
        const target = containerRef.current || el;
        if (target.requestFullscreen) target.requestFullscreen().catch(() => {});
      } else if (document.fullscreenElement && d < startDist * 0.7) {
        tracking = false;
        document.exitFullscreen().catch(() => {});
      }
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
    };
  }, [cropFill]);

  // 响应式视口（替代渲染期直读 window.innerWidth / innerHeight）
  const { width: vpWidth, height: vpHeight } = useViewport();
  const isMobileViewport = vpWidth < 768;

  // Multi-part video list (e.g. Part 1, 2, 3 / CD1, CD2)
  const [partsList, setPartsList] = useState(() => [{ Id: item?.Id, Name: item?.Name || 'Part 1' }]);
  const [currentPartIndex, setCurrentPartIndex] = useState(0);
  const currentPartId = partsList[currentPartIndex]?.Id || item?.Id;

  // 视频宽高比监听：HLS 渐进式加载中分辨率可能多次变化，需同时监听媒体元素 resize
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const updateAspect = () => {
      if (v.videoWidth && v.videoHeight) setVideoAspect(v.videoWidth / v.videoHeight);
    };
    updateAspect();
    v.addEventListener('loadedmetadata', updateAspect);
    v.addEventListener('resize', updateAspect);
    return () => {
      v.removeEventListener('loadedmetadata', updateAspect);
      v.removeEventListener('resize', updateAspect);
    };
  }, [currentPartId]);

  // 铺满期间兜底轮询：HLS 切档的 resize 事件偶发丢失（观察到卡在中间分辨率），
  // 每秒校对一次实际比例，仅在铺满时运行
  useEffect(() => {
    if (!isMaximized) return;
    const t = setInterval(() => {
      const v = videoRef.current;
      if (v && v.videoWidth && v.videoHeight) {
        const a = v.videoWidth / v.videoHeight;
        if (Math.abs(a - videoAspectRef.current) > 0.01) setVideoAspect(a);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [isMaximized]);

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
    if (isMaximized) {
      // chromeH 在点击铺满时已实测传入，几何一次性同步算出
      isCustomPositionRef.current = false;
      setLayout(calculateMaximizedStyle(videoAspect, windowData.chromeH));
      return;
    }
    if (prevSlotRef.current !== slotIndex) {
      prevSlotRef.current = slotIndex;
      isCustomPositionRef.current = false;
      const base = calculateSlotStyle(slotIndex);
      if (cropFillRef.current) {
        setLayout(computeCropFillLayout());
      } else if (cropThirdRef.current) {
        preCropLayoutRef.current = base;
        setLayout(computeCropLayout(base));
      } else {
        setLayout(base);
      }
    }
  }, [slotIndex, isMaximized, videoAspect, windowData.chromeH]);

  useEffect(() => {
    const handleResize = () => {
      if (isMaximized) {
        setLayout(calculateMaximizedStyle(videoAspectRef.current, windowData.chromeH));
      } else if (cropFillRef.current) {
        isCustomPositionRef.current = false;
        setLayout(computeCropFillLayout());
      } else if (!isCustomPositionRef.current) {
        const base = calculateSlotStyle(slotIndex);
        if (cropThirdRef.current) {
          preCropLayoutRef.current = base;
          setLayout(computeCropLayout(base));
        } else {
          setLayout(base);
        }
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [slotIndex, isMaximized, videoAspect, windowData.chromeH]);

  // 三屏取中开启期间视频比例变化（HLS 渐进加载/切档/换片）：按最新比例重算竖屏几何
  useEffect(() => {
    if (!cropThirdRef.current || isMaximized || isCustomPositionRef.current) return;
    if (cropFillRef.current) {
      setLayout(computeCropFillLayout());
      return;
    }
    const base = preCropLayoutRef.current || calculateSlotStyle(slotIndex);
    setLayout(computeCropLayout(base));
  }, [videoAspect, slotIndex, isMaximized, windowData.chromeH]);

  // Default Playback Settings initialization & Dynamic Listener
  const [playbackDefaults, setPlaybackDefaultsState] = useState(() => getPlaybackDefaults());
  const playbackDefaultsRef = useRef(playbackDefaults);
  playbackDefaultsRef.current = playbackDefaults;

  useEffect(() => {
    const handleDefaultsChanged = (e) => {
      if (e.detail) {
        setPlaybackDefaultsState(e.detail);
        playbackDefaultsRef.current = e.detail;
        // 默认倍速变更：立即作用于已打开的浮窗（UI 下拉与视频元素同步）
        if (typeof e.detail.speed === 'number') {
          setPlaybackSpeed(e.detail.speed);
        }
      }
    };
    window.addEventListener('faraday:playback_defaults_changed', handleDefaultsChanged);
    return () => window.removeEventListener('faraday:playback_defaults_changed', handleDefaultsChanged);
  }, []);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(true);

  // 悬浮控制栏显隐：点画面切换；播放中 3s 自动隐藏，暂停时常显
  const [controlsVisible, setControlsVisible] = useState(false);
  const toggleControls = useCallback(() => {
    setControlsVisible(prev => !prev);
  }, []);
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

  // 字幕快捷开关：记录最近一次选中的字幕轨，关闭后再点一键恢复
  const lastSubtitleIndexRef = useRef(-1);
  useEffect(() => {
    if (selectedSubtitleIndex >= 0) lastSubtitleIndexRef.current = selectedSubtitleIndex;
  }, [selectedSubtitleIndex]);

  const handleToggleSubtitle = () => {
    if (selectedSubtitleIndex !== -1) {
      selectSubtitle(-1);
    } else {
      selectSubtitle(
        lastSubtitleIndexRef.current !== -1
          ? lastSubtitleIndexRef.current
          : (subtitleStreams[0]?.Index ?? -1)
      );
    }
  };

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
  // Seek 锁：seek 提交后到视频真正到达目标前，冻结进度条显示，
  // 防止 timeupdate 用旧播放位置把进度条弹回（加载完成后又跳走）
  const seekLockRef = useRef(null);
  if (!seekLockRef.current) {
    seekLockRef.current = createSeekLock({ videoElRef: videoRef });
  }

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
  const panLastXRef = useRef(null);

  // Mobile Touch Gestures with real-time Trickplay preview & Long-press window drag
  const { gestureState, brightness, touchHandlers } = useTouchGestures({
    videoRef,
    containerRef,
    duration: rawDuration,
    currentTime: videoRef.current?.currentTime || 0,
    disableLongPressBoost: true,
    enableLongPressDrag: true,
    onLongPressDragStart: () => {
      if (!cropFillRef.current) {
        setIsDragging(true);
        isCustomPositionRef.current = true;
        if (onBringToFront) onBringToFront(id);
        dragStartPosRef.current = { left: layout.left, top: layout.top };
      } else {
        panLastXRef.current = null;
      }
    },
    onLongPressDragMove: ({ dx, dy, clientX }) => {
      if (cropFillRef.current) {
        // 取中铺满：长按拖动 = 全景平移（窗口位置固定）
        if (panLastXRef.current === null) panLastXRef.current = clientX - dx;
        applyCropPanByDrag(clientX - panLastXRef.current);
        panLastXRef.current = clientX;
        return;
      }
      const newX = Math.max(0, Math.min(window.innerWidth - 60, dragStartPosRef.current.left + dx));
      const newY = Math.max(50, Math.min(window.innerHeight - 60, dragStartPosRef.current.top + dy));
      setLayout(prev => ({ ...prev, left: newX, top: newY }));
    },
    onLongPressDragEnd: () => {
      setIsDragging(false);
    },
    onSeek: (target) => {
      seekLockRef.current.arm(target);
      sessionControllerRef.current?.seek(target);
    },
    onSeekPreview: (targetTime, percent) => {
      setHoverScrubberTime(targetTime);
      setHoverScrubberPercent(percent);
      setIsWheelSeeking(true);
      // 预览时进度条与时间同步跟随，让用户知道滑到哪里了
      setProgress(percent * 100);
      setCurrentTimeText(formatTime(targetTime));
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
    onTap: () => {
      toggleControls();
    },
    normalSpeed: playbackSpeed,
    onSpeedChange: (speed) => {
      setPlaybackSpeed(speed);
      if (videoRef.current) videoRef.current.playbackRate = speed;
    }
  });

  const playbackSpeedRef = useRef(playbackSpeed);
  playbackSpeedRef.current = playbackSpeed;

  // 把当前倍速同步到 video 元素：初始挂载即生效，换片/换集（src 更新会重置倍速）
  // 与暂停恢复（playing 事件）后也重新校准，保证"默认倍速"真正作用于播放
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const apply = () => {
      video.defaultPlaybackRate = playbackSpeedRef.current;
      if (Math.abs(video.playbackRate - playbackSpeedRef.current) > 0.001) {
        video.playbackRate = playbackSpeedRef.current;
      }
    };
    apply();
    video.addEventListener('loadedmetadata', apply);
    video.addEventListener('playing', apply);
    return () => {
      video.removeEventListener('loadedmetadata', apply);
      video.removeEventListener('playing', apply);
    };
  }, [playbackSpeed, videoRef]);
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

  // Trickplay 全量预热：开窗/换分段即预载全部雪碧图，滑动 seek 缩略图零等待
  useEffect(() => {
    if (trickplayItem) preloadAllTrickplaySprites(trickplayItem);
  }, [trickplayItem]);

  // 手机上单开的浮窗默认进入三屏取中铺满（App 侧 autoCrop 标记，仅唯一新窗携带）
  const autoCropAppliedRef = useRef(false);
  useEffect(() => {
    if (autoCropAppliedRef.current || isMaximized || !windowData.autoCrop) return;
    if (window.innerWidth >= 768) return;
    autoCropAppliedRef.current = true;
    preCropLayoutRef.current = layout;
    setCropThird(true);
    setCropFill(true);
    isCustomPositionRef.current = false;
    setLayout(computeCropFillLayout());
    // 取中铺满是独占形态：点下一部影片新开的取中窗会把旧窗关掉
    if (onExclusiveCrop) onExclusiveCrop(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    seekLockRef.current.release();
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

    controller
      .loadStream({
        itemId: currentPartId,
        mediaSourceId: currentPartId,
        streamQuality: streamQualityRef.current,
        initialSeekTime,
        playbackSpeed: playbackSpeedRef.current,
        isMuted: isMutedRef.current,
        volume: volumeRef.current,
        nativeFloating: true
      })
      .then(() => {
        // 安卓壳：画面已交原生迷你窗，网页窗格自动收起（原生豁免 close，会话继续）
        if (isNativePlayerAvailable() && onClose) onClose(id);
      })
      .catch(() => {});

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
        volume: volumeRef.current,
        nativeFloating: true
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
    // Seek 锁生效期间视频仍在旧位置，timeupdate 不得刷新进度条
    if (seekLockRef.current.isActive()) return;
    // 滑动/悬停预览期间进度条保持跟手，不被播放进度拉回
    if (hoverScrubberTime !== null || isWheelSeeking) return;
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

  // 拖动浮窗（PotPlayer 式：标题栏与视频画面均可按住左键拖动）
  const startWindowDrag = (e) => {
    if (e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    if (onBringToFront) onBringToFront(id);

    setIsDragging(true);
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startPosX = layout.left;
    const startPosY = layout.top;
    // 只在真正发生移动后才视为自定义位置，单纯点击不阻断窗口随窗口尺寸变化自动归位
    let customPositionMarked = false;

    const handleMouseMove = (moveEvent) => {
      if (!customPositionMarked) {
        customPositionMarked = true;
        isCustomPositionRef.current = true;
      }
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

  // 取中铺满下的全景平移：object-position 0~100%，拖一屏宽 ≈ 扫过整幅拼接画面
  const applyCropPanByDrag = (dxPx) => {
    const rect = videoViewportRef.current?.getBoundingClientRect();
    if (!rect || !videoRef.current) return;
    const overflowPx = Math.max(1, rect.height * videoAspectRef.current - rect.width);
    cropPanRef.current = Math.max(0, Math.min(100, cropPanRef.current - (dxPx / overflowPx) * 100));
    videoRef.current.style.objectPosition = `${cropPanRef.current}% 50%`;
  };

  // VR 全景开启时，画面上的鼠标用于环视视角；取中铺满时横向拖动 = 全景平移；均不拖动窗口
  const handleMouseDownVideoArea = (e) => {
    // 桌面点击画面（无拖动）= 切换悬浮控制栏
    const downX = e.clientX;
    const downY = e.clientY;
    const onMouseUpCheck = (up) => {
      window.removeEventListener('mouseup', onMouseUpCheck);
      if (Math.hypot(up.clientX - downX, up.clientY - downY) < 5) toggleControls();
    };
    window.addEventListener('mouseup', onMouseUpCheck);
    if (isVrActive || isMaximized) return;
    if (cropFillRef.current) {
      e.preventDefault();
      const startX = e.clientX;
      const handleMove = (moveEvent) => applyCropPanByDrag(moveEvent.clientX - startX);
      const handleUp = () => {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
      };
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
      return;
    }
    startWindowDrag(e);
  };

  const handleTouchStartHeader = (e) => {
    if (e.target.closest('button') || e.target.closest('select')) return;
    if (isMaximized || cropFillRef.current) return;
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
    if (cropFillRef.current) return;
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

    // seek 在途时以在途目标为基准（video.currentTime 尚停留在旧位置，
    // 用它累加会让连续滚轮的目标点计算回跳）
    const pendingTarget = seekLockRef.current.getPendingTarget();
    const baseTime = wheelSeekingTimeRef.current !== null
      ? wheelSeekingTimeRef.current
      : pendingTarget !== null ? pendingTarget : video.currentTime;
    const nextTime = Math.max(0, Math.min(duration, baseTime + delta));

    wheelSeekingTimeRef.current = nextTime;

    const percent = nextTime / duration;
    // 锁要立刻上：乐观显示从滚动瞬间开始，若等到 400ms 防抖提交才上锁，
    // 空窗期内的 timeupdate 会先把进度条弹回旧位置（用户看到的回跳）
    seekLockRef.current.arm(nextTime);
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
        seekLockRef.current.arm(commitTime);
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
          seekLockRef.current.arm(commitTarget);
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
        seekLockRef.current.arm(commitTarget);
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
      // 删除前必须先彻底断开视频流并销毁播放会话，防止服务端底层存储因文件锁占用报错 403
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
      if (sessionControllerRef.current) {
        sessionControllerRef.current.destroy();
      }
      await new Promise(resolve => setTimeout(resolve, 150));

      await jellyfin.deleteItem(item.Id);
      setShowDeleteModal(false);
      if (onDeleteItem) onDeleteItem(item.Id);
      if (onSkip) onSkip(id); // Triggers shift & slot promotion!
    } catch (err) {
      alert(err.message || '删除失败');
    }
  };

  // 按下即处理（不等 click/auxclick）：
  // - 中键：立即关窗（PotPlayer 习惯；同时 preventDefault 阻止中键自动滚动）
  // - 左键：把窗口提到最前（z-index 置顶，不移动 DOM，避免吞掉后续点击）
  const handleContainerMouseDown = (e) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      if (onClose) onClose(id);
      return;
    }
    if (e.button === 0 && onBringToFront) onBringToFront(id);
  };

  const coverUrl = useMemo(() => {
    if (!item?.Id) return null;
    return jellyfin.getBestImageUrl(item, { maxWidth: 500 });
  }, [item]);

  const isFavorite = !!item?.UserData?.IsFavorite;


  return (
    <div
      ref={containerRef}
      onMouseDown={handleContainerMouseDown}
      onWheel={handleWheel}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{
        left: `${layout.left}px`,
        top: `${layout.top}px`,
        width: `${layout.width}px`,
        // 铺满/取中铺满模式显式锁定高度（普通窗口高度由内容比例 + 控制条撑出）
        ...((isMaximized || cropFill) ? { height: `${layout.height}px` } : {}),
        zIndex: hoverScrubberTime !== null ? 9999 : (isDragging || isResizing || isFront ? 500 : 50 + (slotIndex === 1 ? 5 : (slotIndex === 0 ? 1 : 0))),
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
      {/* Mobile Window-level Centered Trickplay Thumbnail (Adaptive Above / Below entire window)。
          铺满/取中铺满时窗口贴底，改走 footer 的 scrubber 模式（锚定进度条上方），
          window 模式会挂到窗口上沿外被顶部工具栏挡住 */}
      {isMobileViewport && !(cropFill || isMaximized) && (
        <TrickplayScrubberThumbnail
          item={trickplayItem}
          hoverTime={hoverScrubberTime}
          hoverPercent={hoverScrubberPercent}
          containerWidth={layout.width}
          mode="window"
          position={(layout.top + (layout.height || layout.width * 9 / 16 + 72)) > vpHeight * 0.6 ? 'above' : 'below'}
        />
      )}

      {/* Video Viewport — 三屏取中时切换为竖屏面板比例；按住左键即可拖动窗口 (PotPlayer 式)，触摸手势由 useTouchGestures 接管 */}
      <div
        ref={videoViewportRef}
        className={`relative w-full bg-black flex items-center justify-center overflow-hidden touch-none select-none cursor-move ${(isMaximized || cropFill) ? 'flex-1 min-h-0' : ''}`}
        style={{
          aspectRatio: (isMaximized || cropFill) ? undefined : (cropThird ? (videoAspect > 0 ? videoAspect / 3 : 16 / 27) : 16 / 9),
          filter: `brightness(${brightness})`,
          WebkitTouchCallout: 'none',
          userSelect: 'none'
        }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onMouseDown={handleMouseDownVideoArea}
        {...touchHandlers}
      >
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
          className={`w-full h-full z-10 select-none pointer-events-auto transition-transform duration-200 ${
            (cropThird && !isMaximized)
              ? 'object-cover'
              : aspectMode === 'cover'
                ? 'object-cover'
                : aspectMode === 'fill'
                  ? 'w-full h-full [object-fit:fill]'
                  : 'object-contain'
          } ${flipH ? '-scale-x-100' : ''}`}
          style={{ WebkitTouchCallout: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
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

        {/* 自定义字幕渲染层（与影院播放器共享样式设置） */}
        <SubtitleOverlay
          videoRef={videoRef}
          visible={selectedSubtitleIndex !== -1}
          selectedSubtitleIndex={selectedSubtitleIndex}
        />

        {/* INLINE VR WEBGL CANVAS */}
        <InlineVrCanvas
          videoRef={videoRef}
          isActive={isVrActive}
          onClose={() => setIsVrActive(false)}
          initialMode={detectedVrMode}
          gyroActive={isVrActive || cropThird}
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

        {/* Paused Indicator (纯指示，不拦截鼠标：画面按住仍可拖动窗口，播放/暂停用底部按钮) */}
        {!isPlaying && !isLoading && !hasError && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 pointer-events-none">
            <div className="w-11 h-11 rounded-full bg-black/60 border border-white/20 flex items-center justify-center text-white">
              <Play size={20} className="ml-0.5 fill-white" />
            </div>
          </div>
        )}

        {/* 常驻悬浮钮：控制区收起时的入口（点击展开圆盘） */}
        {!controlsVisible && (
          <button
            onClick={(e) => { e.stopPropagation(); toggleControls(); }}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            className="absolute right-2 bottom-2 z-30 w-10 h-10 rounded-full bg-black/60 backdrop-blur-md border border-white/20 flex items-center justify-center text-gray-200 hover:text-cyan-300 shadow-xl transition"
            title="播放控制"
          >
            <SlidersHorizontal size={16} />
          </button>
        )}

        {/* 悬浮控制圆盘：右下角单手区（点视频收起） */}
        {controlsVisible && (
          <div
            className="absolute right-2 bottom-2 z-30 w-32 h-32 rounded-full bg-black/60 backdrop-blur-md border border-white/15 shadow-2xl select-none"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            {/* 中心：播放/暂停 */}
            <button
              onClick={togglePlay}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-cyan-500/90 hover:bg-cyan-400 text-slate-950 flex items-center justify-center shadow-lg transition"
              title={isPlaying ? '暂停' : '播放'}
            >
              {isPlaying ? <Pause size={19} /> : <Play size={19} className="ml-0.5 fill-slate-950" />}
            </button>
            {/* 上：三屏取中 */}
            <button
              onClick={handleToggleCropThird}
              className={`absolute left-1/2 -translate-x-1/2 top-1 w-9 h-9 rounded-full flex items-center justify-center transition ${cropThird ? 'bg-amber-500/40 text-amber-300' : 'text-gray-300 hover:text-amber-300 hover:bg-white/10'}`}
              title="三屏取中"
            >
              <Crop size={15} />
            </button>
            {/* 左：字幕（颜色表状态） */}
            <button
              onClick={handleToggleSubtitle}
              className={`absolute left-1 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center transition ${
                subtitleStreams.length === 0
                  ? 'text-gray-700'
                  : selectedSubtitleIndex !== -1
                    ? 'bg-cyan-500/30 text-cyan-300'
                    : 'text-gray-300 hover:text-cyan-300 hover:bg-white/10'
              }`}
              title={
                subtitleStreams.length === 0
                  ? '字幕 (无可用文本字幕)'
                  : selectedSubtitleIndex !== -1 ? '字幕：开' : '字幕：关'
              }
            >
              <Subtitles size={15} />
            </button>
            {/* 右：音量（点开竖向滑杆） */}
            <div className="absolute right-1 top-1/2 -translate-y-1/2">
              <button
                onClick={() => setShowVolumePop(prev => !prev)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-gray-300 hover:text-cyan-300 hover:bg-white/10 transition"
                title={`音量 ${Math.round((isMuted ? 0 : volume) * 100)}%`}
              >
                {isMuted || volume === 0
                  ? <VolumeX size={15} className="text-red-400" />
                  : volume < 0.5
                    ? <Volume1 size={15} />
                    : <Volume2 size={15} />}
              </button>
              {showVolumePop && (
                <div className="absolute right-11 bottom-0 z-50 bg-[#0d131f] border border-white/15 rounded-xl px-3 py-2 shadow-2xl flex items-center h-28">
                  <input
                    type="range"
                    min={0} max={1} step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setVolume(v);
                      if (isMuted && v > 0) toggleMute();
                    }}
                    className="w-24 rotate-[270deg] accent-cyan-400 cursor-pointer appearance-none bg-white/20 rounded-lg h-1"
                  />
                </div>
              )}
            </div>
            {/* 下：横屏（手机） */}
            {isMobileViewport && (
              <button
                onClick={handleLandscapeToggle}
                className={`absolute left-1/2 -translate-x-1/2 bottom-1 w-9 h-9 rounded-full flex items-center justify-center transition ${isLandscape ? 'bg-cyan-500/30 text-cyan-300' : 'text-gray-300 hover:text-cyan-300 hover:bg-white/10'}`}
                title="横屏（全屏并锁定横向）"
              >
                <RectangleHorizontal size={15} />
              </button>
            )}
          </div>
        )}

        {/* 盘外贴边：下一个 / 更多 / 关闭 */}
        {controlsVisible && (
          <div
            className="absolute right-1 bottom-[140px] z-30 flex flex-col items-center gap-1.5 text-gray-300"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleSkipNext}
              className="w-9 h-9 rounded-full bg-black/60 backdrop-blur-md border border-white/15 flex items-center justify-center hover:text-cyan-300 transition"
              title={partsList.length > 1 && currentPartIndex < partsList.length - 1 ? `播放下一分段 (Part ${currentPartIndex + 2}/${partsList.length})` : '跳过当前视频'}
            >
              <SkipForward size={14} />
            </button>
            <button
              onClick={() => setShowMoreMenu(prev => !prev)}
              className={`w-9 h-9 rounded-full bg-black/60 backdrop-blur-md border border-white/15 flex items-center justify-center transition ${showMoreMenu ? 'bg-cyan-500/30 text-cyan-300' : 'hover:text-cyan-300'}`}
              title="更多功能与播放选项"
            >
              <MoreVertical size={15} />
            </button>
            <button
              onClick={() => onClose && onClose(id)}
              className="w-9 h-9 rounded-full bg-black/60 backdrop-blur-md border border-white/15 flex items-center justify-center hover:bg-red-500/20 hover:text-red-400 transition"
              title="关闭窗口"
            >
              <X size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Scrubber & Controls Footer */}
      <div ref={footerRef} className="p-2.5 bg-slate-950/95 border-t border-white/5 rounded-b-2xl flex flex-col gap-1.5 text-xs">
        {/* Scrubber with Real-time Drag & Centered Trickplay */}
        <div className="relative w-full">
          {/* Scrubber-level Trickplay Thumbnail：桌面常规；铺满/取中铺满（窗口贴底，含手机）恒挂进度条上方 */}
          {(!isMobileViewport || cropFill || isMaximized) && (
            <TrickplayScrubberThumbnail
              item={trickplayItem}
              hoverTime={hoverScrubberTime}
              hoverPercent={hoverScrubberPercent}
              containerWidth={scrubberWidth}
              mode="scrubber"
              position={(cropFill || isMaximized) ? 'above' : ((layout.top + (layout.height || layout.width * 9 / 16 + 72)) > vpHeight * 0.7 ? 'above' : 'below')}
            />
          )}

          <div
            ref={scrubberRef}
            className={`w-full bg-white/20 rounded-full cursor-pointer transition-all relative overflow-hidden group/bar touch-none ${hoverScrubberTime !== null || isWheelSeeking ? 'h-2' : 'h-0.5'}`}
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


      </div>

      {/* 标题栏（视频下方）：拖动窗口 + 分段 + 滚动标题 + 下一个/关闭 */}
      <div
        ref={headerRef}
        onMouseDown={startWindowDrag}
        onTouchStart={handleTouchStartHeader}
        className="px-2 py-1.5 border-t border-white/5 bg-slate-950/95 rounded-b-2xl flex items-center gap-1.5 cursor-move text-xs select-none"
      >
        {playbackDefaults.patrolMode && (
          <div
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-cyan-950/90 border border-cyan-400/90 text-cyan-300 text-[10px] font-mono font-bold flex-shrink-0 animate-pulse"
            title={`🚨 霓虹多窗巡更轮巡中：剩余 ${patrolRemainingSec} 秒自动轮换`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
            <span>巡更 {patrolRemainingSec}s</span>
          </div>
        )}
        {partsList.length > 1 && (
          <div
            className="flex items-center bg-black/50 px-1 py-0.5 rounded border border-amber-500/40 flex-shrink-0"
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <select
              value={currentPartIndex}
              onChange={(e) => setCurrentPartIndex(Number(e.target.value))}
              className="bg-transparent text-[10px] text-amber-300 font-bold outline-none cursor-pointer"
            >
              {partsList.map((p, idx) => (
                <option key={p.Id} value={idx} className="bg-slate-900 text-white">
                  P{idx + 1}/{partsList.length}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex-1 min-w-0 overflow-hidden" title={item?.Name}>
          {(item?.Name || '').length > 16 ? (
            <div className="flex whitespace-nowrap animate-marquee will-change-transform" style={{ animationDuration: `${Math.max(8, Math.min(30, (item?.Name || '').length * 0.35))}s` }}>
              <span className="pr-8 font-bold text-white text-xs flex-shrink-0">{item?.Name}</span>
              <span className="pr-8 font-bold text-white text-xs flex-shrink-0" aria-hidden>{item?.Name}</span>
            </div>
          ) : (
            <span className="font-bold text-white text-xs truncate block">{item?.Name || '视频预览'}</span>
          )}
        </div>
        <button
          onClick={handleSkipNext}
          className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-cyan-300 transition flex-shrink-0"
          title={partsList.length > 1 && currentPartIndex < partsList.length - 1 ? `播放下一分段 (Part ${currentPartIndex + 2}/${partsList.length})` : '跳过当前视频 (下一个顶上来)'}
        >
          <SkipForward size={13} />
        </button>
        <button
          onClick={() => onClose && onClose(id)}
          className="p-1 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition flex-shrink-0"
          title="关闭窗口 (中键 / 下一个顶上来)"
        >
          <X size={14} />
        </button>
      </div>

      {/* SE Corner Resizer Handle (Bottom-Right) */}
      {!isMaximized && (
        <div
          onMouseDown={handleMouseDownResize}
          className="absolute right-0 bottom-0 w-4 h-4 cursor-se-resize z-40 flex items-end justify-end p-0.5 group/resizer"
          title="拖拽缩放窗口大小"
        >
          <div className="w-2.5 h-2.5 border-r-2 border-b-2 border-white/30 group-hover/resizer:border-cyan-400 transition-colors" />
        </div>
      )}

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
