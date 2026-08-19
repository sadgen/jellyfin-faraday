import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import { jellyfin } from '../api/jellyfinClient';
import { useExternalPlayer } from '../hooks/useExternalPlayer';
import { 
  Play, Pause, SkipForward, Volume2, VolumeX, Maximize, 
  Star, Eye, EyeOff, Tv, Film, ExternalLink, Zap
} from 'lucide-react';

export default function VideoTile({
  tileId,
  item,
  isGlobalMuted = true,
  playbackSpeed = 1.0,
  onSkip,
  onUpdateItem
}) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const containerRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [isTileMuted, setIsTileMuted] = useState(isGlobalMuted);
  const [isHovered, setIsHovered] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showPlayerMenu, setShowPlayerMenu] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTimeText, setCurrentTimeText] = useState('00:00');
  const [durationText, setDurationText] = useState('00:00');

  const { launchPlayer } = useExternalPlayer();

  // Sync mute with global setting unless user explicitly changed tile
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

    const videoEl = videoRef.current;
    if (!videoEl) return;

    // Clean up previous HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const directStreamUrl = jellyfin.getStreamUrl(item.Id);
    const hlsUrl = jellyfin.getHlsUrl(item.Id);

    // Try direct HTML5 stream first
    const setupDirectPlay = () => {
      videoEl.src = directStreamUrl;
      videoEl.playbackRate = playbackSpeed;
      videoEl.muted = isTileMuted;
      videoEl.play().catch(err => {
        console.warn(`[Tile ${tileId}] Direct play autoplay blocked or failed:`, err);
        // Autoplay may need user gesture or muted
        videoEl.muted = true;
        setIsTileMuted(true);
        videoEl.play().catch(() => {});
      });
    };

    // Try HLS playback if direct play fails or browser supports HLS
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
            console.error(`[Tile ${tileId}] HLS fatal error:`, data);
            setHasError(true);
            setErrorMessage('视频解码或转码失败');
          }
        });
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        // Native Safari HLS
        videoEl.src = hlsUrl;
        videoEl.play().catch(() => {});
      } else {
        setupDirectPlay();
      }
    };

    // Start with direct playback, fallback to HLS on error
    const handleDirectError = () => {
      console.warn(`[Tile ${tileId}] Direct stream error, falling back to HLS`);
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

  // Video event listeners for progress and duration
  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
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

  const togglePlay = (e) => {
    e.stopPropagation();
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
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsTileMuted(nextMuted);
  };

  const toggleFullscreen = (e) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // MOUSE MIDDLE-CLICK (AuxClick button === 1): Close current video and skip to next!
  const handleAuxClick = (e) => {
    if (e.button === 1) { // Middle mouse button
      e.preventDefault();
      e.stopPropagation();
      if (onSkip) onSkip(tileId);
    }
  };

  // Toggle Favorite
  const handleToggleFavorite = async (e) => {
    e.stopPropagation();
    if (!item?.Id) return;
    const isFav = !!item.UserData?.IsFavorite;
    const nextFav = !isFav;
    
    // Optimistic UI update
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
    e.stopPropagation();
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

  const posterUrl = item?.Id ? jellyfin.getImageUrl(item.Id, item.ImageTags?.Primary, 'Primary', 800) : null;
  const isFavorite = !!item?.UserData?.IsFavorite;
  const playCount = item?.UserData?.PlayCount || 0;

  return (
    <div
      ref={containerRef}
      onAuxClick={handleAuxClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setShowPlayerMenu(false);
      }}
      className="relative w-full h-full bg-black overflow-hidden group select-none border border-slate-800/80 rounded-lg shadow-2xl flex flex-col justify-center items-center"
      title="鼠标中键点击直接切片，左键点击播放/暂停"
    >
      {/* Fallback Poster Background */}
      {posterUrl && (
        <img
          src={posterUrl}
          alt={item?.Name || 'Poster'}
          className={`absolute inset-0 w-full h-full object-cover blur-md opacity-30 transition-opacity duration-700 pointer-events-none ${
            isLoading ? 'opacity-50' : 'opacity-20'
          }`}
        />
      )}

      {/* Main Video Element */}
      <video
        ref={videoRef}
        playsInline
        className="w-full h-full object-contain z-10 cursor-pointer"
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

      {/* Loading Spinner */}
      {isLoading && !hasError && (
        <div className="absolute z-20 flex flex-col items-center justify-center pointer-events-none gap-2">
          <div className="w-10 h-10 border-4 border-jf-accent/30 border-t-jf-accent rounded-full animate-spin" />
          <span className="text-xs font-mono text-cyan-200/80 drop-shadow">加载视频流...</span>
        </div>
      )}

      {/* Error Overlay */}
      {hasError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/80 gap-3 p-4 text-center">
          <div className="text-jf-danger text-sm font-semibold">{errorMessage || '播放失败'}</div>
          <button
            onClick={() => onSkip && onSkip(tileId)}
            className="px-3 py-1.5 bg-jf-accent hover:bg-jf-accentHover text-xs font-medium rounded-md transition"
          >
            切换下一个视频
          </button>
        </div>
      )}

      {/* Top Left Badges: Play Count & Type */}
      <div className="absolute top-2.5 left-2.5 z-20 flex items-center gap-1.5 pointer-events-none">
        {/* Play Count Badge (from jellyfin-packet) */}
        <div 
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-black/60 backdrop-blur-md border border-white/10 text-[11px] font-mono font-medium text-cyan-300 shadow-sm"
          title={`已播放 ${playCount} 次`}
        >
          <Eye size={12} className="text-cyan-400" />
          <span>{playCount}</span>
        </div>

        {/* Community Rating */}
        {item?.CommunityRating && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-black/60 backdrop-blur-md border border-white/10 text-[11px] font-mono font-medium text-amber-300 shadow-sm">
            <Star size={11} className="fill-amber-400 text-amber-400" />
            <span>{item.CommunityRating.toFixed(1)}</span>
          </div>
        )}
      </div>

      {/* Top Right Quick Actions (Middle-Click Hint & Favorite) */}
      <div className={`absolute top-2.5 right-2.5 z-20 flex items-center gap-1.5 transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'opacity-0 md:opacity-0 group-hover:opacity-100'}`}>
        {/* Favorite Button */}
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

        {/* Mark Watched Button */}
        <button
          onClick={handleTogglePlayed}
          className="p-1.5 rounded-md bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/10 text-gray-300 hover:text-cyan-400 transition"
          title={item?.UserData?.Played ? '标记为未播' : '标记为已播'}
        >
          {item?.UserData?.Played ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>

        {/* External Player Menu Button */}
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
              className="absolute right-0 top-8 w-32 glass-panel rounded-md shadow-2xl py-1 z-30 text-xs text-gray-200 divide-y divide-white/5"
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

        {/* Skip / Next Video Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (onSkip) onSkip(tileId);
          }}
          className="p-1.5 rounded-md bg-jf-accent/80 hover:bg-jf-accent text-white backdrop-blur-md border border-cyan-400/30 transition shadow"
          title="切换下一个 (或鼠标中键点击窗口)"
        >
          <SkipForward size={14} />
        </button>
      </div>

      {/* Bottom Floating Scrubber & Info Bar */}
      <div 
        className={`absolute bottom-0 inset-x-0 z-20 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-3 pt-6 transition-all duration-300 ${
          isHovered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress Bar (Clickable) */}
        <div 
          className="w-full h-1.5 bg-white/20 hover:h-2.5 rounded-full cursor-pointer transition-all relative overflow-hidden mb-2"
          onClick={handleSeek}
        >
          <div 
            className="absolute top-0 left-0 bottom-0 bg-jf-accent rounded-full transition-all duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-xs text-gray-300">
          {/* Title & Metadata */}
          <div className="flex flex-col min-w-0 pr-2">
            <div className="font-semibold text-white truncate max-w-[240px] text-sm drop-shadow" title={item?.Name}>
              {item?.Name || '未知影片'}
            </div>
            <div className="text-[11px] text-gray-400 flex items-center gap-2">
              <span>{currentTimeText} / {durationText}</span>
              {item?.ProductionYear && <span>• {item.ProductionYear}</span>}
              {item?.OfficialRating && <span className="px-1 bg-white/10 rounded text-[9px]">{item.OfficialRating}</span>}
            </div>
          </div>

          {/* Player Mini Controls */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={togglePlay}
              className="p-1.5 hover:bg-white/15 rounded text-white transition"
              title={isPlaying ? '暂停' : '播放'}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            </button>

            <button
              onClick={toggleMute}
              className="p-1.5 hover:bg-white/15 rounded text-white transition"
              title={isTileMuted ? '取消静音' : '静音'}
            >
              {isTileMuted ? <VolumeX size={15} className="text-gray-400" /> : <Volume2 size={15} className="text-cyan-400" />}
            </button>

            <button
              onClick={toggleFullscreen}
              className="p-1.5 hover:bg-white/15 rounded text-white transition"
              title="单窗口全屏"
            >
              <Maximize size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Middle Click Hint (Watermark when hovered) */}
      {isHovered && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none bg-black/40 backdrop-blur-xs px-3 py-1.5 rounded-full border border-white/5 text-[11px] text-gray-300/60 font-mono flex items-center gap-1.5">
          <Zap size={12} className="text-cyan-400" />
          <span>中键点击换片</span>
        </div>
      )}
    </div>
  );
}
