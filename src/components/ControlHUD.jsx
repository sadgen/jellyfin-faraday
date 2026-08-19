import React, { useState } from 'react';
import { 
  Grid, Shuffle, Volume2, VolumeX, Settings, 
  Sparkles, Star, TrendingDown, Clock, RefreshCw,
  Gauge, HelpCircle
} from 'lucide-react';

const FILTER_MODES = [
  { id: 'pure_random', label: '纯粹随机', icon: Shuffle, desc: '媒体库全量随机' },
  { id: 'favorite_random', label: '最爱随机', icon: Star, desc: '仅从最爱收藏中随机' },
  { id: 'least_played_random', label: '最少播放', icon: TrendingDown, desc: '未播与少播优先' },
  { id: 'latest_random', label: '最新入库', icon: Clock, desc: '最新添加媒体随机' }
];

const SPEED_OPTIONS = [1.0, 1.25, 1.5, 2.0, 3.0, 5.0];

export default function ControlHUD({
  activeTileCount,
  onTileCountChange,
  filterMode,
  onFilterModeChange,
  onReshuffle,
  isGlobalMuted,
  onToggleGlobalMute,
  playbackSpeed,
  onPlaybackSpeedChange,
  remainingCount,
  totalCount,
  onOpenSettings,
  onRefreshLibrary,
  isRefreshing
}) {
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 max-w-[95vw] px-4 py-2 rounded-2xl glass-pill shadow-2xl border border-white/10 text-xs text-gray-200">
      
      {/* 1. Tile Count Selector: 1, 2, 4 */}
      <div className="flex items-center bg-black/40 rounded-xl p-1 border border-white/5 gap-0.5">
        {[1, 2, 4].map(count => (
          <button
            key={count}
            onClick={() => onTileCountChange(count)}
            className={`px-2.5 py-1 rounded-lg font-mono font-medium transition-all ${
              activeTileCount === count
                ? 'bg-jf-accent text-white shadow'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
            title={`切换为 ${count} 视口平铺`}
          >
            {count} 窗
          </button>
        ))}
      </div>

      <div className="h-4 w-[1px] bg-white/10 mx-1" />

      {/* 2. Filter Mode Capsule Buttons */}
      <div className="flex items-center bg-black/40 rounded-xl p-1 border border-white/5 gap-0.5">
        {FILTER_MODES.map(mode => {
          const Icon = mode.icon;
          const isActive = filterMode === mode.id;
          return (
            <button
              key={mode.id}
              onClick={() => onFilterModeChange(mode.id)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-all ${
                isActive
                  ? 'bg-slate-700/80 text-cyan-300 border border-cyan-500/30 shadow'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
              title={mode.desc}
            >
              <Icon size={13} className={isActive ? 'text-cyan-400' : ''} />
              <span>{mode.label}</span>
            </button>
          );
        })}
      </div>

      <div className="h-4 w-[1px] bg-white/10 mx-1" />

      {/* 3. Global Reshuffle Button */}
      <button
        onClick={onReshuffle}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-black/40 hover:bg-white/10 border border-white/5 text-gray-300 hover:text-white transition"
        title="全部重新洗牌 (Reshuffle)"
      >
        <Shuffle size={14} className="text-cyan-400" />
        <span className="hidden sm:inline">换一批</span>
      </button>

      {/* 4. Global Mute Button */}
      <button
        onClick={onToggleGlobalMute}
        className={`p-2 rounded-xl border transition ${
          isGlobalMuted 
            ? 'bg-black/40 border-white/5 text-gray-400 hover:text-white' 
            : 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
        }`}
        title={isGlobalMuted ? '全局已静音 (点击开启声音)' : '全局声音已开启 (点击静音)'}
      >
        {isGlobalMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
      </button>

      {/* 5. Speed Multiplier Dropdown */}
      <div className="relative">
        <button
          onClick={() => setShowSpeedMenu(!showSpeedMenu)}
          className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-black/40 hover:bg-white/10 border border-white/5 text-gray-300 font-mono"
          title="调整全局播放倍速"
        >
          <Gauge size={13} className="text-amber-400" />
          <span>{playbackSpeed}x</span>
        </button>

        {showSpeedMenu && (
          <div 
            className="absolute bottom-10 left-0 glass-panel rounded-xl py-1 shadow-2xl z-50 text-xs flex flex-col gap-0.5 min-w-[75px]"
            onClick={(e) => e.stopPropagation()}
          >
            {SPEED_OPTIONS.map(speed => (
              <button
                key={speed}
                onClick={() => {
                  onPlaybackSpeedChange(speed);
                  setShowSpeedMenu(false);
                }}
                className={`px-3 py-1 text-left font-mono hover:bg-white/10 ${
                  playbackSpeed === speed ? 'text-cyan-400 font-bold bg-white/5' : 'text-gray-300'
                }`}
              >
                {speed.toFixed(speed % 1 === 0 ? 0 : 2)}x
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-4 w-[1px] bg-white/10 mx-1" />

      {/* 6. Queue Stats Counter */}
      <div 
        className="hidden md:flex items-center gap-1 font-mono text-[11px] text-gray-400 px-2 py-1 bg-black/30 rounded-lg border border-white/5"
        title={`当前库内共 ${totalCount} 部，会话待播队列剩余 ${remainingCount} 部`}
      >
        <span className="text-cyan-300 font-semibold">{totalCount - remainingCount}</span>
        <span>/</span>
        <span>{totalCount}</span>
      </div>

      {/* 7. Refresh Library Data */}
      <button
        onClick={onRefreshLibrary}
        disabled={isRefreshing}
        className="p-2 rounded-xl bg-black/40 hover:bg-white/10 border border-white/5 text-gray-400 hover:text-white transition disabled:opacity-50"
        title="同步/重新获取 Jellyfin 媒体库"
      >
        <RefreshCw size={14} className={isRefreshing ? 'animate-spin text-cyan-400' : ''} />
      </button>

      {/* 8. Settings Button */}
      <button
        onClick={onOpenSettings}
        className="p-2 rounded-xl bg-black/40 hover:bg-white/10 border border-white/5 text-gray-400 hover:text-white transition"
        title="服务器连接设置"
      >
        <Settings size={14} />
      </button>

    </div>
  );
}
