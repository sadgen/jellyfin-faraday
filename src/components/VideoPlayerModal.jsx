import React, { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { jellyfin } from '../api/jellyfinClient';
import { useExternalPlayer } from '../hooks/useExternalPlayer';
import TrickplayScrubberThumbnail from './TrickplayScrubberThumbnail';
import { 
  Play, Pause, Volume2, VolumeX, Maximize, 
  Star, Eye, EyeOff, ExternalLink, X, Film, 
  SkipForward, SkipBack, Settings
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

  // Trickplay Hover State
  const [hoverScrubberTime, setHoverScrubberTime] = useState(null);
  const [hoverScrubberPercent, setHoverScrubberPercent] = useState(0);
  const [scrubberWidth, setScrubberWidth] = useState(600);

  const { launchPlayer } = useExternalPlayer();

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
    if (!video || !video.duration) return;
    const p = (video.currentTime / video.duration) * 100;
    setProgress(p);
    setCurrentTimeText(formatTime(video.currentTime));
    setDurationText(formatTime(video.duration));
  };

  const handleSeek = (e) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video || !video.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    video.currentTime = pos * video.duration;
  };

  const handleScrubberMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const duration = videoRef.current?.duration || (item.RunTimeTicks ? item.RunTimeTicks / 10000000 : 0);
    
    setHoverScrubberTime(duration * pos);
    setHoverScrubberPercent(pos);
    setScrubberWidth(rect.width);
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
    const video = videoRef.current;
    if (!video) return;
    if (!document.fullscreenElement) {
      video.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const posterUrl = item?.Id ? jellyfin.getImageUrl(item.Id, item.ImageTags?.Primary, 'Primary', 1000) : null;
  const isFavorite = !!item?.UserData?.IsFavorite;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-5xl bg-[#0d1117] rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="p-3.5 border-b border-white/5 flex items-center justify-between bg-black/40 text-xs">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <Film size={18} className="text-cyan-400 flex-shrink-0" />
            <span className="font-bold text-white text-sm truncate">{item?.Name}</span>
            {item?.ProductionYear && (
              <span className="text-gray-400 font-mono">({item.ProductionYear})</span>
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
                <span>外部播放器</span>
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
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Video Canvas Container */}
        <div className="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden">
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
        <div className="p-4 bg-slate-900/90 border-t border-white/5 flex flex-col gap-3">
          {/* Scrubber Container */}
          <div className="relative w-full">
            {/* Trickplay Thumbnail Bubble */}
            <TrickplayScrubberThumbnail
              item={item}
              hoverTime={hoverScrubberTime}
              hoverPercent={hoverScrubberPercent}
              containerWidth={scrubberWidth}
            />

            {/* Clickable Seekbar */}
            <div
              ref={scrubberRef}
              className="w-full h-2 bg-white/20 hover:h-3 rounded-full cursor-pointer transition-all relative overflow-hidden"
              onClick={handleSeek}
              onMouseMove={handleScrubberMouseMove}
              onMouseLeave={() => setHoverScrubberTime(null)}
            >
              <div
                className="absolute top-0 left-0 bottom-0 bg-cyan-400 rounded-full transition-all duration-100"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Controls Row */}
          <div className="flex items-center justify-between text-xs text-gray-300">
            {/* Left: Play/Pause, Time */}
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlay}
                className="p-2 rounded-xl bg-jf-accent hover:bg-cyan-400 text-white transition shadow-lg"
              >
                {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
              </button>

              {onPrev && (
                <button
                  onClick={onPrev}
                  className="p-2 rounded-xl bg-black/40 hover:bg-white/10 text-gray-300 transition"
                  title="上一个视频"
                >
                  <SkipBack size={15} />
                </button>
              )}

              {onNext && (
                <button
                  onClick={onNext}
                  className="p-2 rounded-xl bg-black/40 hover:bg-white/10 text-gray-300 transition"
                  title="下一个视频"
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

            {/* Right: Speed, Fullscreen */}
            <div className="flex items-center gap-2">
              {/* Playback Speed Selector */}
              <div className="flex items-center bg-black/40 px-2 py-1 rounded-xl border border-white/5 gap-1">
                <span className="text-gray-400 text-[11px]">倍速:</span>
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
