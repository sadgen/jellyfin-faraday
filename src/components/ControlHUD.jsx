import React, { useState } from 'react';
import { 
  Shuffle, Volume2, VolumeX, Settings, 
  Star, TrendingDown, Clock,
  Gauge, ArrowLeft
} from 'lucide-react';

const FILTER_MODES = [
  { id: 'pure_random', label: '全量随机', icon: Shuffle, desc: '媒体库全量随机' },
  { id: 'favorite_random', label: '最爱随机', icon: Star, desc: '仅从最爱收藏中随机' },
  { id: 'least_played_random', label: '最少播放', icon: TrendingDown, desc: '未播与少播优先' },
  { id: 'latest_random', label: '最新入库', icon: Clock, desc: '最新添加媒体随机' }
];

const SPEED_OPTIONS = [1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

export default function ControlHUD({
  activeTileCount,
  onTileCountChange,
  filterMode,
  onFilterModeChange,
  onReshuffleAll,
  isGlobalMuted,
  onToggleGlobalMute,
  playbackSpeed,
  onPlaybackSpeedChange,
  remainingCount,
  totalCount,
  onOpenSettings,
  onRefreshLibrary,
  isRefreshing,
  onOpenLibraryView,
  activeScopeName = '全部媒体库'
}) {
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  return (
    <>
      {/* 1. TOP-LEFT FLOATING ACTION: Return to Media Library (OnePlus 12 Notch Safe) */}
      <div className="fixed top-[max(0.75rem,env(safe-area-inset-top))] left-[max(0.75rem,env(safe-area-inset-left))] z-40 flex items-center gap-2">
        <button
          onClick={onOpenLibraryView}
          className="group flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-black/60 hover:bg-slate-900/90 text-white backdrop-blur-md border border-white/15 hover:border-cyan-400 shadow-2xl transition transform hover:scale-[1.02] text-xs font-semibold"
          title="返回媒体库浏览与分类筛选"
        >
          <ArrowLeft size={16} className="text-cyan-400 group-hover:-translate-x-0.5 transition-transform" />
          <span>返回媒体库</span>
          <span className="text-[10px] text-gray-400 font-normal hidden sm:inline">({activeScopeName})</span>
        </button>

        {/* Reshuffle Quick Button next to Return */}
        <button
          onClick={onReshuffleAll}
          className="p-2 rounded-2xl bg-black/60 hover:bg-slate-900/90 text-gray-300 hover:text-cyan-300 backdrop-blur-md border border-white/15 shadow-2xl transition"
          title="全部重新洗牌 (换一批)"
        >
          <Shuffle size={16} className="text-cyan-400" />
        </button>
      </div>

      {/* 2. TOP-RIGHT FLOATING ACTION HUD (OnePlus 12 Notch & Corner Safe) */}
      <div className="fixed top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] z-40 flex items-center gap-2 text-xs">
        {/* Tile Layout Selector */}
        <div className="flex items-center bg-black/60 backdrop-blur-md border border-white/15 rounded-2xl p-1 shadow-2xl">
          {[1, 2, 4].map(count => (
            <button
              key={count}
              onClick={() => onTileCountChange(count)}
              className={`px-2.5 py-1 rounded-xl font-bold font-mono transition ${
                activeTileCount === count
                  ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/30'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {count}窗
            </button>
          ))}
        </div>

        {/* Filter Mode Selector */}
        <div className="relative">
          <button
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-black/60 hover:bg-slate-900/90 backdrop-blur-md border border-white/15 text-gray-200 shadow-2xl font-medium"
            title="选择随机播放算法"
          >
            <Shuffle size={13} className="text-cyan-400" />
            <span className="hidden sm:inline">{FILTER_MODES.find(m => m.id === filterMode)?.label || '随机模式'}</span>
          </button>

          {showFilterMenu && (
            <div 
              className="absolute right-0 top-10 w-44 glass-panel rounded-2xl p-1 shadow-2xl z-50 text-xs flex flex-col gap-1 border border-white/15 animate-in fade-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {FILTER_MODES.map(mode => {
                const Icon = mode.icon;
                const isSelected = filterMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    onClick={() => {
                      onFilterModeChange(mode.id);
                      setShowFilterMenu(false);
                    }}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-xl text-left transition ${
                      isSelected ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'hover:bg-white/10 text-gray-300'
                    }`}
                  >
                    <Icon size={14} className={isSelected ? 'text-cyan-400' : 'text-gray-400'} />
                    <div className="flex flex-col">
                      <span>{mode.label}</span>
                      <span className="text-[10px] text-gray-500 font-normal">{mode.desc}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Global Mute Toggle */}
        <button
          onClick={onToggleGlobalMute}
          className={`p-2 rounded-2xl backdrop-blur-md border shadow-2xl transition ${
            isGlobalMuted 
              ? 'bg-black/60 border-white/15 text-gray-400 hover:text-white' 
              : 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
          }`}
          title={isGlobalMuted ? '全局已静音 (点击开启声音)' : '全局声音已开启 (点击静音)'}
        >
          {isGlobalMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>

        {/* Speed Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowSpeedMenu(!showSpeedMenu)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-2xl bg-black/60 hover:bg-slate-900/90 backdrop-blur-md border border-white/15 text-gray-300 font-mono font-bold shadow-2xl"
            title="调整全局播放倍速"
          >
            <Gauge size={13} className="text-amber-400" />
            <span>{playbackSpeed}x</span>
          </button>

          {showSpeedMenu && (
            <div 
              className="absolute right-0 top-10 glass-panel rounded-2xl py-1 shadow-2xl z-50 text-xs flex flex-col gap-0.5 min-w-[80px] border border-white/15 animate-in fade-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {SPEED_OPTIONS.map(speed => (
                <button
                  key={speed}
                  onClick={() => {
                    onPlaybackSpeedChange(speed);
                    setShowSpeedMenu(false);
                  }}
                  className={`px-3 py-1.5 text-left font-mono hover:bg-white/10 ${
                    playbackSpeed === speed ? 'text-cyan-400 font-bold bg-white/5' : 'text-gray-300'
                  }`}
                >
                  {speed.toFixed(speed % 1 === 0 ? 0 : 1)}x
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          className="p-2 rounded-2xl bg-black/60 hover:bg-slate-900/90 backdrop-blur-md border border-white/15 text-gray-400 hover:text-white shadow-2xl transition"
          title="服务器连接与设置"
        >
          <Settings size={15} />
        </button>
      </div>
    </>
  );
}
