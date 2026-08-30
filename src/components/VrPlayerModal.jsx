import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import Hls from 'hls.js';
import { jellyfin } from '../api/jellyfinClient';
import TrickplayScrubberThumbnail from './TrickplayScrubberThumbnail';
import SubtitleOverlay from './SubtitleOverlay';
import SubtitleModal from './SubtitleModal';
import VolumeControl from './VolumeControl';
import SleepTimerButton from './SleepTimerButton';
import { useVolumeControl } from '../hooks/useVolumeControl';
import { useMediaPlaybackInfo } from '../hooks/useMediaPlaybackInfo';
import { useSubtitleTracks } from '../hooks/useSubtitleTracks';
import { PLAYBACK_SPEED_OPTIONS } from '../utils/qualityPresets';
import { getStoredSeekSpeed, getSeekStepSeconds } from '../utils/seekSettings';
import {
  X, Play, Pause,
  RotateCcw, Glasses,
  SkipBack, SkipForward, Compass, Subtitles
} from 'lucide-react';

const VR_MODES = [
  { id: '180_3d_sbs', label: '180° 3D (左右 SBS)' },
  { id: '180_2d', label: '180° 半球全景 (Dome)' },
  { id: '360_2d', label: '360° 全景 (2D)' },
  { id: '360_3d_sbs', label: '360° 3D (左右 SBS)' },
  { id: '360_3d_tb', label: '360° 3D (上下 Top-Bottom)' },
  { id: 'plane_cinema', label: '📺 虚拟曲面巨幕影院' }
];

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function VrPlayerModal({
  isOpen,
  item,
  onClose,
  initialMode = '180_3d_sbs',
  onUpdateItem,
  onPrev,
  onNext
}) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const scrubberRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const meshRef = useRef(null);
  const textureRef = useRef(null);
  const animFrameRef = useRef(null);
  const playReportTimerRef = useRef(null);
  const hasCountedPlayRef = useRef(false);
  const playSessionIdRef = useRef(null);
  const isDraggingScrubberRef = useRef(false);

  const isUserInteractingRef = useRef(false);
  const onPointerDownPointerXRef = useRef(0);
  const onPointerDownPointerYRef = useRef(0);
  const onPointerDownLonRef = useRef(0);
  const onPointerDownLatRef = useRef(0);
  const lonRef = useRef(0);
  const latRef = useRef(0);
  const phiRef = useRef(0);
  const thetaRef = useRef(0);
  const fovRef = useRef(100);

  const [vrMode, setVrMode] = useState(initialMode);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [currentTimeText, setCurrentTimeText] = useState('00:00');
  const [durationText, setDurationText] = useState('00:00');
  const [_rawDuration, setRawDuration] = useState(0);
  const [fov, setFov] = useState(100);
  const [hoverScrubberTime, setHoverScrubberTime] = useState(null);
  const [hoverScrubberPercent, setHoverScrubberPercent] = useState(0);
  const [scrubberWidth, setScrubberWidth] = useState(600);
  const [seekSpeed, setSeekSpeed] = useState(() => getStoredSeekSpeed());
  const [showSubtitleModal, setShowSubtitleModal] = useState(false);

  useEffect(() => {
    const handleSeekSpeedChange = (e) => {
      if (e.detail) setSeekSpeed(e.detail);
    };
    window.addEventListener('faraday:seek_speed_changed', handleSeekSpeedChange);
    return () => window.removeEventListener('faraday:seek_speed_changed', handleSeekSpeedChange);
  }, []);

  const { playbackData, setPlaybackData } = useMediaPlaybackInfo(item?.Id);
  const { volume, setVolume, isMuted, setIsMuted, toggleMute } = useVolumeControl(videoRef);
  const { subtitleStreams, mediaSourceId, selectedSubtitleIndex, selectSubtitle, syncSubtitleModes } =
    useSubtitleTracks({ item, playbackData, videoRef });

  // Setup Mesh Geometry based on VR Mode
  const setupGeometry = useCallback((mode) => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (meshRef.current) {
      scene.remove(meshRef.current);
      if (meshRef.current.geometry) meshRef.current.geometry.dispose();
      if (meshRef.current.material) meshRef.current.material.dispose();
      meshRef.current = null;
    }

    let geometry;
    const radius = 500;

    switch (mode) {
      case '180_2d': {
        // 180 Hemisphere
        geometry = new THREE.SphereGeometry(radius, 64, 32, -Math.PI / 2, Math.PI, 0, Math.PI);
        geometry.scale(-1, 1, 1);
        break;
      }

      case '180_3d_sbs': {
        // 180 SBS 3D: Map left half of texture to front 180 dome
        geometry = new THREE.SphereGeometry(radius, 64, 32, -Math.PI / 2, Math.PI, 0, Math.PI);
        geometry.scale(-1, 1, 1);
        // Remap UV to left eye (0.0 to 0.5)
        const uvs180 = geometry.attributes.uv;
        for (let i = 0; i < uvs180.count; i++) {
          uvs180.setX(i, uvs180.getX(i) * 0.5);
        }
        uvs180.needsUpdate = true;
        break;
      }

      case '360_3d_sbs': {
        // 360 SBS 3D: Map left half to full 360 sphere
        geometry = new THREE.SphereGeometry(radius, 64, 32);
        geometry.scale(-1, 1, 1);
        const uvs360 = geometry.attributes.uv;
        for (let i = 0; i < uvs360.count; i++) {
          uvs360.setX(i, uvs360.getX(i) * 0.5);
        }
        uvs360.needsUpdate = true;
        break;
      }

      case '360_3d_tb': {
        // 360 Top-Bottom 3D: Map top half to full 360 sphere
        geometry = new THREE.SphereGeometry(radius, 64, 32);
        geometry.scale(-1, 1, 1);
        const uvsTb = geometry.attributes.uv;
        for (let i = 0; i < uvsTb.count; i++) {
          uvsTb.setY(i, uvsTb.getY(i) * 0.5 + 0.5);
        }
        uvsTb.needsUpdate = true;
        break;
      }

      case 'plane_cinema': {
        // Curved Virtual Cinema Screen
        geometry = new THREE.CylinderGeometry(radius * 0.8, radius * 0.8, radius * 0.9, 48, 1, true, -Math.PI / 3, (2 * Math.PI) / 3);
        geometry.scale(-1, 1, 1);
        break;
      }

      case '360_2d':
      default: {
        // Full 360 Equirectangular Sphere
        geometry = new THREE.SphereGeometry(radius, 64, 32);
        geometry.scale(-1, 1, 1);
        break;
      }
    }

    const material = new THREE.MeshBasicMaterial({
      map: textureRef.current,
      side: THREE.FrontSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    meshRef.current = mesh;
  }, []);

  // Initialize Three.js VR Engine
  useEffect(() => {
    if (!isOpen || !containerRef.current || !videoRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // 1. Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(fovRef.current, width / height, 1, 1100);
    camera.target = new THREE.Vector3(0, 0, 0);
    cameraRef.current = camera;

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    rendererRef.current = renderer;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 4. Video Texture
    const video = videoRef.current;
    const texture = new THREE.VideoTexture(video);
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.format = THREE.RGBAFormat;
    textureRef.current = texture;

    setupGeometry(vrMode);

    // 5. Render Loop
    let isRunning = true;
    const animate = () => {
      if (!isRunning) return;
      animFrameRef.current = requestAnimationFrame(animate);

      // Smooth camera orientation
      latRef.current = Math.max(-85, Math.min(85, latRef.current));
      phiRef.current = THREE.MathUtils.degToRad(90 - latRef.current);
      thetaRef.current = THREE.MathUtils.degToRad(lonRef.current);

      camera.target.x = 500 * Math.sin(phiRef.current) * Math.cos(thetaRef.current);
      camera.target.y = 500 * Math.cos(phiRef.current);
      camera.target.z = 500 * Math.sin(phiRef.current) * Math.sin(thetaRef.current);
      camera.lookAt(camera.target);

      renderer.render(scene, camera);
    };
    animate();

    const handleWindowResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleWindowResize);

    return () => {
      isRunning = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleWindowResize);
      if (meshRef.current) {
        scene.remove(meshRef.current);
        if (meshRef.current.geometry) meshRef.current.geometry.dispose();
        if (meshRef.current.material) meshRef.current.material.dispose();
      }
      if (textureRef.current) textureRef.current.dispose();
      if (rendererRef.current) rendererRef.current.dispose();
      if (container) container.innerHTML = '';
    };
  }, [isOpen, setupGeometry, vrMode]);

  const playbackSpeedRef = useRef(playbackSpeed);
  playbackSpeedRef.current = playbackSpeed;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const itemRef = useRef(item);
  itemRef.current = item;
  const onUpdateItemRef = useRef(onUpdateItem);
  onUpdateItemRef.current = onUpdateItem;

  // Cleanup timers on component unmount
  useEffect(() => {
    return () => {
      if (playReportTimerRef.current) clearInterval(playReportTimerRef.current);
    };
  }, []);

  // Load video stream (Direct / HLS) — 支持续播（此前 VR 模式总是从 0 开始）
  useEffect(() => {
    if (!isOpen || !item?.Id || !videoRef.current) return;

    setIsLoading(true);
    hasCountedPlayRef.current = false;
    const videoEl = videoRef.current;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const sessionId = jellyfin.createPlaySessionId();
    playSessionIdRef.current = sessionId;

    // 续播位置：Trickplay 点击时间 > 服务器上次播放位置 > 0
    const initialSeekTime = (item.startSecond !== undefined && item.startSecond !== null)
      ? item.startSecond
      : (item.UserData?.PlaybackPositionTicks ? item.UserData.PlaybackPositionTicks / 10000000 : 0);

    const onLoadedMetadata = () => {
      if (initialSeekTime > 0 && videoEl) {
        videoEl.currentTime = initialSeekTime;
      }
      syncSubtitleModesRef.current();
    };
    videoEl.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
    if (initialSeekTime > 0 && videoEl.readyState >= 1) {
      videoEl.currentTime = initialSeekTime;
    }

    // Report playback start to Jellyfin
    jellyfin.reportPlayback(item.Id, initialSeekTime, false, 'Started', {
      playSessionId: sessionId,
      volumeLevel: volumeRef.current * 100
    });

    // Periodic progress reporting (every 10s)
    if (playReportTimerRef.current) clearInterval(playReportTimerRef.current);
    playReportTimerRef.current = setInterval(() => {
      if (videoEl && !videoEl.paused && videoEl.currentTime > 0) {
        jellyfin.reportPlayback(item.Id, videoEl.currentTime, false, 'Progress', {
          playSessionId: playSessionIdRef.current,
          volumeLevel: volumeRef.current * 100
        });

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

    const directUrl = jellyfin.getStreamUrl(item.Id);
    const hlsUrl = jellyfin.getHlsUrl(item.Id, { playSessionId: sessionId });

    const setupDirect = () => {
      videoEl.src = directUrl;
      videoEl.muted = isMutedRef.current;
      videoEl.playbackRate = playbackSpeedRef.current;
      videoEl.play().catch(() => {
        videoEl.muted = true;
        setIsMuted(true);
        videoEl.play().catch(() => {});
      });
    };

    const setupHls = () => {
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hlsRef.current = hls;
        hls.loadSource(hlsUrl);
        hls.attachMedia(videoEl);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoEl.muted = isMutedRef.current;
          videoEl.playbackRate = playbackSpeedRef.current;
          if (initialSeekTime > 0) videoEl.currentTime = initialSeekTime;
          videoEl.play().catch(() => {
            videoEl.muted = true;
            setIsMuted(true);
            videoEl.play().catch(() => {});
          });
        });
      } else {
        setupDirect();
      }
    };

    videoEl.addEventListener('error', setupHls, { once: true });
    setupDirect();

    return () => {
      if (playReportTimerRef.current) clearInterval(playReportTimerRef.current);
      if (videoEl && videoEl.currentTime > 0) {
        jellyfin.reportPlayback(item.Id, videoEl.currentTime, true, 'Stopped', {
          playSessionId: playSessionIdRef.current,
          volumeLevel: volumeRef.current * 100
        });
      }
      videoEl.removeEventListener('error', setupHls);
      videoEl.removeEventListener('loadedmetadata', onLoadedMetadata);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      videoEl.removeAttribute('src');
      videoEl.load();
    };
  }, [isOpen, item?.Id, setIsMuted]);

  // 键盘快捷键（与影院播放器一致）
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
            video.currentTime = Math.max(0, video.currentTime - getSeekStepSeconds(seekSpeed));
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (video && video.duration) {
            video.currentTime = Math.min(video.duration, video.currentTime + getSeekStepSeconds(seekSpeed));
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
        case 'n':
        case 'N':
          if (onNext) onNext();
          break;
        case 'p':
        case 'P':
          if (onPrev) onPrev();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, seekSpeed, setVolume, onNext, onPrev]);

  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const syncSubtitleModesRef = useRef(syncSubtitleModes);
  syncSubtitleModesRef.current = syncSubtitleModes;

  // Drag to Look Around (Mouse / Touch)
  const handlePointerDown = (e) => {
    isUserInteractingRef.current = true;
    onPointerDownPointerXRef.current = e.clientX || e.touches?.[0]?.clientX || 0;
    onPointerDownPointerYRef.current = e.clientY || e.touches?.[0]?.clientY || 0;
    onPointerDownLonRef.current = lonRef.current;
    onPointerDownLatRef.current = latRef.current;
  };

  const handlePointerMove = (e) => {
    if (!isUserInteractingRef.current) return;
    const clientX = e.clientX || e.touches?.[0]?.clientX || 0;
    const clientY = e.clientY || e.touches?.[0]?.clientY || 0;
    lonRef.current = (onPointerDownPointerXRef.current - clientX) * 0.15 + onPointerDownLonRef.current;
    latRef.current = (clientY - onPointerDownPointerYRef.current) * 0.15 + onPointerDownLatRef.current;
  };

  const handlePointerUp = () => {
    isUserInteractingRef.current = false;
  };

  // Wheel Zoom FOV & Wheel Seek（步长遵循全局快进档位设置）
  const handleWheel = (e) => {
    if (e.shiftKey) {
      // Shift + Wheel = Adjust Field of View
      e.preventDefault();
      const deltaFov = e.deltaY > 0 ? 5 : -5;
      const nextFov = Math.max(50, Math.min(130, fovRef.current + deltaFov));
      fovRef.current = nextFov;
      setFov(nextFov);
      if (cameraRef.current) {
        cameraRef.current.fov = nextFov;
        cameraRef.current.updateProjectionMatrix();
      }
      return;
    }

    // Default Wheel = Fast-forward (Down) / Rewind (Up)
    e.preventDefault();
    const video = videoRef.current;
    if (!video || !video.duration) return;
    const step = getSeekStepSeconds(seekSpeed);
    const delta = e.deltaY > 0 ? step : -step;
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + delta));
  };

  const resetOrientation = () => {
    lonRef.current = 0;
    latRef.current = 0;
    fovRef.current = 100;
    setFov(100);
    if (cameraRef.current) {
      cameraRef.current.fov = 100;
      cameraRef.current.updateProjectionMatrix();
    }
  };

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

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !video.duration || isDraggingScrubberRef.current) return;
    setRawDuration(video.duration);
    setProgress((video.currentTime / video.duration) * 100);
    setCurrentTimeText(formatTime(video.currentTime));
    setDurationText(formatTime(video.duration));
  };

  // Scrubber Drag Seeking (Mouse + Touch)
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
    e.preventDefault();
    e.stopPropagation();
    isDraggingScrubberRef.current = true;
    updateScrubberDrag(e.touches[0].clientX);
  }, [updateScrubberDrag]);

  const handleScrubberTouchMove = useCallback((e) => {
    if (e.touches.length !== 1) return;
    if (isDraggingScrubberRef.current) {
      e.preventDefault();
      e.stopPropagation();
      updateScrubberDrag(e.touches[0].clientX);
    }
  }, [updateScrubberDrag]);

  const handleScrubberTouchEnd = useCallback(() => {
    if (isDraggingScrubberRef.current) {
      isDraggingScrubberRef.current = false;
      setTimeout(() => setHoverScrubberTime(null), 800);
    }
  }, []);

  if (!isOpen || !item) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col select-none overflow-hidden animate-in fade-in duration-200">
      {/* Hidden Source Video Element used for Three.js VideoTexture */}
      <video
        ref={videoRef}
        playsInline
        crossOrigin="anonymous"
        className="hidden"
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => {
          setIsLoading(false);
          setIsPlaying(true);
          syncSubtitleModes();
        }}
        onLoadedData={syncSubtitleModes}
        onPause={() => setIsPlaying(false)}
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

      {/* Top VR Control HUD */}
      <div className="absolute top-0 inset-x-0 z-30 p-3 sm:p-4 bg-gradient-to-b from-black/90 via-black/60 to-transparent flex items-center justify-between pointer-events-auto">
        <div className="flex items-center gap-2.5 min-w-0 pr-2">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-cyan-950/80 border border-cyan-400/50 text-cyan-300 text-xs font-bold shadow-lg">
            <Glasses size={14} className="animate-pulse" />
            <span>VR 全景影院</span>
          </div>
          <span className="text-white font-bold text-sm truncate">{item.Name}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* 睡眠定时 */}
          <SleepTimerButton onExpire={() => { if (videoRef.current) videoRef.current.pause(); }} />

          {/* 字幕选择 / 在线下载（WebGL 遮挡视频时以覆盖层渲染） */}
          <button
            onClick={() => setShowSubtitleModal(true)}
            className={`p-2 rounded-xl border transition ${
              selectedSubtitleIndex !== -1
                ? 'bg-cyan-500/25 border-cyan-400/50 text-cyan-300'
                : 'bg-black/70 border-white/10 text-gray-300 hover:text-cyan-300'
            }`}
            title="字幕选择 / 在线下载"
          >
            <Subtitles size={15} />
          </button>

          {/* Mode Selector */}
          <select
            value={vrMode}
            onChange={(e) => {
              const mode = e.target.value;
              setVrMode(mode);
              setupGeometry(mode);
            }}
            className="px-3 py-1.5 rounded-xl bg-black/80 border border-cyan-400/40 text-cyan-300 text-xs font-medium focus:outline-none cursor-pointer"
          >
            {VR_MODES.map(m => (
              <option key={m.id} value={m.id} className="bg-slate-900 text-white">
                {m.label}
              </option>
            ))}
          </select>

          {/* Reset Orientation */}
          <button
            onClick={resetOrientation}
            className="p-2 rounded-xl bg-black/70 hover:bg-black/90 border border-white/10 text-gray-300 hover:text-cyan-300 transition"
            title="重置视角 (居中)"
          >
            <RotateCcw size={15} />
          </button>

          {/* Close VR */}
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-red-950/80 hover:bg-red-900 border border-red-500/40 text-red-200 transition"
            title="退出 VR"
          >
            <X size={17} />
          </button>
        </div>
      </div>

      {/* Main Three.js Canvas Container */}
      <div
        ref={containerRef}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
        onWheel={handleWheel}
        className="flex-1 w-full h-full cursor-grab active:cursor-grabbing bg-black touch-none"
      />

      {/* Loading Indicator */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 gap-2">
          <div className="w-12 h-12 border-4 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
          <span className="text-xs font-mono text-cyan-300 bg-black/70 px-3 py-1 rounded-full border border-white/10">
            加载 VR 全景视频流...
          </span>
        </div>
      )}

      {/* 字幕覆盖层（视频元素被 Canvas 遮挡，原生字幕轨不可见） */}
      <SubtitleOverlay videoRef={videoRef} visible={selectedSubtitleIndex !== -1} />

      {/* Bottom Transport Scrubber & HUD */}
      <div className="absolute bottom-0 inset-x-0 z-30 p-4 pt-8 bg-gradient-to-t from-black/95 via-black/80 to-transparent flex flex-col gap-2.5 pointer-events-auto">
        {/* Scrubber Container */}
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
            onMouseMove={(e) => {
              if (isDraggingScrubberRef.current) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              const dur = videoRef.current?.duration || 0;
              setHoverScrubberTime(dur * p);
              setHoverScrubberPercent(p);
              setScrubberWidth(rect.width);
            }}
            onMouseLeave={() => {
              if (!isDraggingScrubberRef.current) setHoverScrubberTime(null);
            }}
            onTouchStart={handleScrubberTouchStart}
            onTouchMove={handleScrubberTouchMove}
            onTouchEnd={handleScrubberTouchEnd}
            onTouchCancel={handleScrubberTouchEnd}
          >
            <div
              className="absolute top-0 left-0 bottom-0 bg-cyan-400 rounded-full transition-all duration-75"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Transport Row */}
        <div className="flex items-center justify-between text-xs text-gray-300">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={togglePlay}
              className="p-2.5 rounded-xl bg-jf-accent hover:bg-cyan-400 text-white transition shadow-lg shadow-cyan-500/25"
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
            </button>

            {onPrev && (
              <button
                onClick={onPrev}
                className="p-2 rounded-xl bg-black/60 hover:bg-white/10 text-gray-300 transition"
              >
                <SkipBack size={15} />
              </button>
            )}

            {onNext && (
              <button
                onClick={onNext}
                className="p-2 rounded-xl bg-black/60 hover:bg-white/10 text-gray-300 transition"
              >
                <SkipForward size={15} />
              </button>
            )}

            {/* 音量滑块 + 静音 */}
            <VolumeControl volume={volume} setVolume={setVolume} isMuted={isMuted} toggleMute={toggleMute} compact />

            <span className="font-mono text-gray-400 text-xs">
              {currentTimeText} / {durationText}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* FOV Slider */}
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-xl bg-black/60 border border-white/10 text-[11px] text-gray-300 font-mono">
              <Compass size={13} className="text-cyan-400" />
              <span>FOV: {Math.round(fov)}°</span>
            </div>

            {/* Playback Speed */}
            <div className="flex items-center bg-black/60 px-2.5 py-1 rounded-xl border border-white/10 gap-1 text-xs">
              <select
                value={playbackSpeed}
                onChange={(e) => {
                  const sp = parseFloat(e.target.value);
                  setPlaybackSpeed(sp);
                  if (videoRef.current) videoRef.current.playbackRate = sp;
                }}
                className="bg-transparent text-cyan-300 focus:outline-none cursor-pointer font-mono font-bold"
              >
                {PLAYBACK_SPEED_OPTIONS.map(sp => (
                  <option key={sp} value={sp} className="bg-slate-900">{sp}x</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* 字幕管理 / 在线下载 */}
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
