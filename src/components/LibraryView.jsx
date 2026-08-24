import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { jellyfin } from '../api/jellyfinClient';
import { getTrickplayStyle } from '../utils/trickplay';
import { detectDuplicateMedia } from '../utils/duplicateChecker';
import { useExternalPlayer } from '../hooks/useExternalPlayer';
import MobileActionSheet from './MobileActionSheet';
import DeleteConfirmModal from './DeleteConfirmModal';
import { 
  Play, Star, Eye, EyeOff, Search, 
  Edit3, Sparkles, Trash2, Folder, Film, 
  ArrowUpDown, X, RefreshCw, Layers, LayoutGrid,
  Grid, List, MoreVertical, ExternalLink, Calendar,
  Users, Tag, Check, ChevronRight, Tv, Glasses,
  SlidersHorizontal
} from 'lucide-react';

const SUB_TABS = [
  { id: 'items', label: '影片', icon: Film },
  { id: 'genres', label: '类型', icon: Tag },
  { id: 'persons', label: '演职员', icon: Users },
  { id: 'years', label: '年份', icon: Calendar },
  { id: 'collections', label: '合集', icon: Layers },
  { id: 'duplicates', label: '查重清理', icon: Layers }
];

const STATUS_OPTIONS = [
  { id: 'all', label: '全部' },
  { id: 'unplayed', label: '👀 未播完' },
  { id: 'played', label: '✅ 已播' }
];

const PLAY_COUNT_OPTIONS = [
  { id: 'play_0', label: '0次', title: '未播放过 (0次)' },
  { id: 'play_1', label: '1次', title: '播放过1次' },
  { id: 'play_lte_1', label: '≤1次', title: '0次或1次' },
  { id: 'play_2_5', label: '2-5次', title: '播放 2 至 5 次' },
  { id: 'play_5_10', label: '5-10次', title: '播放 5 至 10 次' },
  { id: 'play_gte_10', label: '10+次', title: '播放 10 次以上' }
];

const SORT_OPTIONS = [
  { id: 'date_desc', label: '添加日期 (最新)' },
  { id: 'date_asc', label: '添加日期 (最早)' },
  { id: 'name_asc', label: '名称 (A-Z)' },
  { id: 'name_desc', label: '名称 (Z-A)' },
  { id: 'rating_desc', label: '社区评分 (最高)' },
  { id: 'rating_asc', label: '社区评分 (最低)' },
  { id: 'year_desc', label: '发行年份 (最新)' },
  { id: 'year_asc', label: '发行年份 (最早)' },
  { id: 'playcount_desc', label: '播放次数 (最多)' },
  { id: 'playcount_asc', label: '播放次数 (最少)' },
  { id: 'runtime_desc', label: '时长 (最长)' },
  { id: 'random', label: '随机乱序' }
];

/**
 * Movie Card with Clean Unmasked Timeline Trickplay
 * - In Poster mode (2:3): Pops up a 480x270 2X-enlarged Trickplay preview
 * - Auto-detects top viewport boundary: pops below card if near top, pops above otherwise!
 */
const MediaCard = React.memo(function MediaCard({
  item,
  isDuplicate,
  viewLayout = 'poster',
  isSelected = false,
  isSelecting = false,
  onToggleSelect,
  onPlay,
  onPlayModal,
  onPlayVr,
  onToggleFavorite,
  onTogglePlayed,
  onOpenMetadataEditor,
  onOpenIdentify,
  onRefreshMetadata,
  onDelete,
  onOpenActionSheet
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [trickplayTime, setTrickplayTime] = useState(null);
  const [hoverPercent, setHoverPercent] = useState(0);
  const [isNearTop, setIsNearTop] = useState(false);
  const { launchPlayer } = useExternalPlayer();

  const isBackdrop = viewLayout === 'backdrop';
  const posterUrl = isBackdrop 
    ? (jellyfin.getImageUrl(item.Id, item.ImageTags?.Backdrop || item.ImageTags?.Primary, 'Backdrop', 500, 80) || jellyfin.getImageUrl(item.Id, item.ImageTags?.Primary, 'Primary', 360, 80))
    : jellyfin.getImageUrl(item.Id, item.ImageTags?.Primary, 'Primary', 360, 80);

  const isFavorite = !!item.UserData?.IsFavorite;
  const isPlayed = !!item.UserData?.Played;
  const playCount = item.UserData?.PlayCount || 0;

  const durationSec = useMemo(() => {
    return item.RunTimeTicks ? item.RunTimeTicks / 10000000 : 7200;
  }, [item.RunTimeTicks]);

  const durationText = useMemo(() => {
    if (!item.RunTimeTicks) return '';
    const totalMinutes = Math.floor(item.RunTimeTicks / (10000000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours > 0) return `${hours}小时${mins}分`;
    return `${mins}分钟`;
  }, [item.RunTimeTicks]);

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const rafIdRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const isLongPressActiveRef = useRef(false);
  const startPosRef = useRef({ x: 0, y: 0 });

  const handlePointerDown = useCallback((e) => {
    if (e.button !== undefined && e.button !== 0) return;
    startPosRef.current = { x: e.clientX, y: e.clientY };
    isLongPressActiveRef.current = false;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      isLongPressActiveRef.current = true;
      if (onToggleSelect) {
        onToggleSelect(item.Id);
      }
      try {
        if (navigator.vibrate) navigator.vibrate(40);
      } catch {
        // ignore
      }
    }, 450);
  }, [item.Id, onToggleSelect]);

  const handlePointerMove = useCallback((e) => {
    if (!longPressTimerRef.current) return;
    const dx = Math.abs(e.clientX - startPosRef.current.x);
    const dy = Math.abs(e.clientY - startPosRef.current.y);
    if (dx > 10 || dy > 10) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleCardClick = useCallback((e) => {
    if (isLongPressActiveRef.current) {
      isLongPressActiveRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (isSelecting) {
      e.preventDefault();
      e.stopPropagation();
      if (onToggleSelect) onToggleSelect(item.Id);
      return;
    }
    onPlay(item, trickplayTime);
  }, [isSelecting, item, onPlay, onToggleSelect, trickplayTime]);

  const handleCoverMouseMove = useCallback((e) => {
    const target = e.currentTarget;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    if (!rect.width) return;
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPercent(percent);
    setTrickplayTime(durationSec * percent);
    // Auto-detect boundary: if card top is less than 300px from viewport top, display below!
    setIsNearTop(rect.top < 300);
  }, [durationSec]);

  // Touch tracking for mobile devices (trickplay follows finger)
  const handleCoverTouchMove = useCallback((e) => {
    if (!e.touches || e.touches.length === 0) return;
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const percent = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    setHoverPercent(percent);
    setTrickplayTime(durationSec * percent);
    setIsNearTop(rect.top < 240);
  }, [durationSec]);

  const handleCoverTouchEnd = useCallback(() => {
    setTimeout(() => {
      setTrickplayTime(null);
      setHoverPercent(0);
    }, 500);
  }, []);

  const handleCoverMouseLeave = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setIsHovered(false);
    setShowContextMenu(false);
    setTrickplayTime(null);
    setHoverPercent(0);
  }, []);

  const tpStyle = useMemo(() => {
    if (trickplayTime === null) return null;
    return getTrickplayStyle(item, trickplayTime);
  }, [item, trickplayTime]);

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleCoverMouseLeave}
      style={{
        zIndex: (isHovered || tpStyle) ? 999 : 1
      }}
      className={`group relative flex flex-col bg-slate-900/50 rounded-xl transition-all duration-150 select-none will-change-transform ${
        isSelected
          ? 'border-2 border-cyan-400 ring-2 ring-cyan-400/40 shadow-xl shadow-cyan-500/25 scale-[0.98]'
          : isDuplicate 
            ? 'border border-red-500/60 shadow-lg shadow-red-500/10 hover:-translate-y-1' 
            : 'border border-white/5 hover:border-cyan-500/40 hover:shadow-xl hover:shadow-cyan-500/10 hover:-translate-y-1'
      }`}
    >
      {/* Selection Checkbox Badge */}
      {(isSelecting || isSelected) && (
        <div 
          onClick={(e) => {
            e.stopPropagation();
            if (onToggleSelect) onToggleSelect(item.Id);
          }}
          className="absolute top-2 left-2 z-30 cursor-pointer p-0.5"
          title={isSelected ? '取消选中' : '选中'}
        >
          <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${
            isSelected 
              ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/50 scale-105' 
              : 'bg-black/60 border-2 border-white/60 hover:border-white hover:bg-black/80'
          }`}>
            {isSelected && <Check size={13} className="stroke-[3]" />}
          </div>
        </div>
      )}

      {/* 
        2X-Enlarged Floating Trickplay Preview Window (Poster Mode only)
        - Mobile: 320px-380px 16:9 (enlarged crisp view)
        - Desktop: 480px-540px 16:9 (2X-2.5X enlarged HD view)
        Auto boundary: floats below card if near top, above card otherwise!
      */}
      {!isBackdrop && tpStyle && (
        <div 
          className={`absolute left-1/2 -translate-x-1/2 z-50 flex flex-col items-center pointer-events-none animate-in fade-in zoom-in-95 duration-100 ${
            isNearTop ? 'top-[calc(100%+8px)]' : 'bottom-[calc(100%+8px)]'
          }`}
        >
          {/* Upward arrow if positioned below */}
          {isNearTop && (
            <div className="w-0 h-0 border-x-8 border-x-transparent border-b-8 border-b-cyan-400 mb-0.5" />
          )}

          {/* 2X-Enlarged HD Frame */}
          <div className="w-[320px] xs:w-[380px] sm:w-[480px] lg:w-[540px] max-w-[92vw] aspect-video rounded-xl sm:rounded-2xl overflow-hidden bg-black/95 border-2 border-cyan-400 shadow-2xl shadow-cyan-500/40 flex items-center justify-center relative">
            <div className="w-full h-full" style={tpStyle} />
            <div className="absolute bottom-2 sm:bottom-2.5 bg-black/85 backdrop-blur-md px-3 sm:px-3.5 py-0.5 sm:py-1 rounded-full text-xs font-mono font-bold text-cyan-300 border border-white/20 shadow-lg">
              {formatTime(trickplayTime)}
            </div>
          </div>

          {/* Downward arrow if positioned above */}
          {!isNearTop && (
            <div className="w-0 h-0 border-x-8 border-x-transparent border-t-8 border-t-cyan-400 mt-0.5" />
          )}
        </div>
      )}

      {/* Poster / Backdrop Canvas */}
      <div 
        className={`relative w-full bg-black rounded-t-xl overflow-hidden cursor-pointer flex items-center justify-center touch-pan-y ${
          isBackdrop ? 'aspect-video' : 'aspect-[2/3]'
        }`}
        onClick={handleCardClick}
        onMouseMove={handleCoverMouseMove}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onTouchStart={handleCoverTouchMove}
        onTouchMove={handleCoverTouchMove}
        onTouchEnd={handleCoverTouchEnd}
        onTouchCancel={handleCoverTouchEnd}
      >
        {/* Static Poster Artwork */}
        {posterUrl ? (
          <img
            src={posterUrl}
            alt={item.Name}
            loading="lazy"
            className={`w-full h-full object-cover transition-opacity duration-200 ${
              isBackdrop && tpStyle ? 'opacity-0' : 'opacity-100'
            }`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600">
            <Film size={isBackdrop ? 40 : 32} />
          </div>
        )}

        {/* BACKDROP MODE: Inline inside 16:9 Card */}
        {isBackdrop && tpStyle && (
          <div className="absolute inset-0 bg-black flex items-center justify-center overflow-hidden pointer-events-none">
            <div 
              className="w-full aspect-video relative shadow-2xl bg-center bg-no-repeat"
              style={tpStyle}
            />

            <div className="absolute bottom-2 left-2 z-30 pointer-events-none">
              <div className="px-2 py-0.5 rounded-full bg-black/85 backdrop-blur-md border border-cyan-400/50 text-[10px] font-mono font-bold text-cyan-300 shadow-lg">
                {formatTime(trickplayTime)}
              </div>
            </div>
          </div>
        )}

        {/* Bottom Timeline Progress Line on Hover */}
        {tpStyle && (
          <div className="absolute bottom-0 inset-x-0 h-1.5 bg-white/20 z-20 pointer-events-none">
            <div 
              className="h-full bg-cyan-400 shadow-sm shadow-cyan-400 transition-all duration-75"
              style={{ width: `${hoverPercent * 100}%` }}
            />
          </div>
        )}

        {/* Top-Right: Played Checkmark */}
        <div className="absolute top-2 right-2 flex items-center gap-1 z-20">
          {isPlayed ? (
            <div 
              onClick={(e) => { e.stopPropagation(); onTogglePlayed(item); }}
              className="w-5 h-5 rounded-full bg-emerald-500/90 text-white flex items-center justify-center shadow-md backdrop-blur-md cursor-pointer hover:scale-110 transition"
              title="已播放"
            >
              <Check size={12} className="stroke-[3]" />
            </div>
          ) : (
            <div 
              onClick={(e) => { e.stopPropagation(); onTogglePlayed(item); }}
              className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-md shadow-cyan-400/50 cursor-pointer"
              title="未播放"
            />
          )}
        </div>

        {/* Top-Left: Duplicate Badge or Play Count */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 z-20 pointer-events-none">
          {isDuplicate && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-600/90 backdrop-blur-md border border-red-400/50 text-[10px] font-mono font-bold text-white shadow-lg animate-pulse">
              <Layers size={10} />
              <span>重复</span>
            </div>
          )}

          {!isDuplicate && playCount > 0 && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-mono text-cyan-300">
              <Eye size={11} className="text-cyan-400" />
              <span>{playCount}</span>
            </div>
          )}

          {item.CommunityRating && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-mono text-amber-300">
              <Star size={10} className="fill-amber-400 text-amber-400" />
              <span>{item.CommunityRating.toFixed(1)}</span>
            </div>
          )}
        </div>

        {/* Hover Action Buttons */}
        <div className="absolute inset-x-2 bottom-2 z-30 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(item); }}
            className={`p-1.5 rounded-lg backdrop-blur-md border transition ${
              isFavorite 
                ? 'bg-amber-500/30 border-amber-500/50 text-amber-400' 
                : 'bg-black/70 border-white/10 text-gray-300 hover:text-amber-400'
            }`}
            title={isFavorite ? '取消收藏' : '加入最爱'}
          >
            <Star size={14} className={isFavorite ? 'fill-amber-400' : ''} />
          </button>

          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (window.innerWidth < 768 && onOpenActionSheet) {
                  onOpenActionSheet(item);
                } else {
                  setShowContextMenu(!showContextMenu);
                }
              }}
              className="p-1.5 rounded-lg bg-black/70 hover:bg-black/90 border border-white/10 text-gray-300 hover:text-white backdrop-blur-md transition"
              title="更多操作"
            >
              <MoreVertical size={14} />
            </button>

            {/* Desktop Context Menu */}
            {showContextMenu && (
              <div 
                className="hidden md:block absolute right-0 bottom-8 w-44 glass-panel rounded-xl shadow-2xl py-1 z-50 text-xs text-gray-200 divide-y divide-white/5 animate-in fade-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="py-1">
                  <button 
                    onClick={() => { onPlay(item); setShowContextMenu(false); }}
                    className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2 text-cyan-300 font-medium"
                  >
                    <Tv size={13} />
                    <span>悬浮窗播放 (3窗)</span>
                  </button>

                  <button 
                    onClick={() => { if (onPlayModal) onPlayModal(item); setShowContextMenu(false); }}
                    className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2 text-gray-300"
                  >
                    <Play size={13} />
                    <span>影院全屏模式</span>
                  </button>

                  <button 
                    onClick={() => { if (onPlayVr) onPlayVr(item); setShowContextMenu(false); }}
                    className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2 text-amber-300 font-medium"
                  >
                    <Glasses size={13} />
                    <span>🥽 VR 全景播放</span>
                  </button>

                  <button 
                    onClick={() => { launchPlayer('mpv', item); setShowContextMenu(false); }}
                    className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center justify-between text-gray-300"
                  >
                    <span className="flex items-center gap-2"><ExternalLink size={12} /> MPV 播放器</span>
                    <span className="text-[10px] text-cyan-400">mpv://</span>
                  </button>
                  <button 
                    onClick={() => { launchPlayer('potplayer', item); setShowContextMenu(false); }}
                    className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center justify-between text-gray-300"
                  >
                    <span className="flex items-center gap-2"><ExternalLink size={12} /> PotPlayer</span>
                    <span className="text-[10px] text-amber-400">pot://</span>
                  </button>
                  <button 
                    onClick={() => { launchPlayer('vlc', item); setShowContextMenu(false); }}
                    className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center justify-between text-gray-300"
                  >
                    <span className="flex items-center gap-2"><ExternalLink size={12} /> VLC 播放器</span>
                    <span className="text-[10px] text-orange-400">vlc://</span>
                  </button>
                </div>

                <div className="py-1">
                  <button 
                    onClick={() => { onOpenMetadataEditor(item); setShowContextMenu(false); }}
                    className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2 text-gray-300"
                  >
                    <Edit3 size={12} />
                    <span>编辑元数据</span>
                  </button>

                  <button 
                    onClick={() => { onOpenIdentify(item); setShowContextMenu(false); }}
                    className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2 text-cyan-300"
                  >
                    <Sparkles size={12} />
                    <span>重新识别 / 刮削</span>
                  </button>

                  <button 
                    onClick={() => { onRefreshMetadata(item); setShowContextMenu(false); }}
                    className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2 text-gray-300"
                  >
                    <RefreshCw size={12} />
                    <span>刷新媒体信息</span>
                  </button>
                </div>

                <div className="py-1">
                  <button 
                    onClick={() => { onDelete(item); setShowContextMenu(false); }}
                    className="w-full px-3 py-1.5 text-left hover:bg-red-900/40 flex items-center gap-2 text-red-400"
                  >
                    <Trash2 size={12} />
                    <span>从磁盘删除</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Title & Metadata Footer */}
      <div className="p-2.5 flex flex-col gap-0.5 min-w-0">
        <div 
          onClick={() => onPlay(item)}
          className="text-xs font-semibold text-white truncate group-hover:text-cyan-300 transition cursor-pointer" 
          title={item.Name}
        >
          {item.Name}
        </div>
        <div className="text-[11px] text-gray-400 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span>{item.ProductionYear || '未知年份'}</span>
            {durationText && <span className="hidden sm:inline">• {durationText}</span>}
          </div>
          {item.OfficialRating && (
            <span className="px-1 py-0.5 bg-white/10 rounded text-[9px] font-mono text-gray-300">
              {item.OfficialRating}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

/**
 * Detailed List Row View
 */
const MediaListRow = React.memo(function MediaListRow({
  item,
  isDuplicate,
  isSelected = false,
  isSelecting = false,
  onToggleSelect,
  onPlay,
  onToggleFavorite,
  onTogglePlayed,
  onOpenMetadataEditor,
  onOpenActionSheet
}) {
  const posterUrl = jellyfin.getImageUrl(item.Id, item.ImageTags?.Primary, 'Primary', 150, 80);
  const isFavorite = !!item.UserData?.IsFavorite;
  const isPlayed = !!item.UserData?.Played;
  const playCount = item.UserData?.PlayCount || 0;

  const durationText = useMemo(() => {
    if (!item.RunTimeTicks) return '-';
    const totalMinutes = Math.floor(item.RunTimeTicks / (10000000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours > 0) return `${hours}小时${mins}分`;
    return `${mins}分钟`;
  }, [item.RunTimeTicks]);

  const longPressTimerRef = useRef(null);
  const isLongPressActiveRef = useRef(false);
  const startPosRef = useRef({ x: 0, y: 0 });

  const handlePointerDown = useCallback((e) => {
    if (e.button !== undefined && e.button !== 0) return;
    startPosRef.current = { x: e.clientX, y: e.clientY };
    isLongPressActiveRef.current = false;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      isLongPressActiveRef.current = true;
      if (onToggleSelect) onToggleSelect(item.Id);
      try {
        if (navigator.vibrate) navigator.vibrate(40);
      } catch {
        // ignore
      }
    }, 450);
  }, [item.Id, onToggleSelect]);

  const handlePointerMove = useCallback((e) => {
    if (!longPressTimerRef.current) return;
    const dx = Math.abs(e.clientX - startPosRef.current.x);
    const dy = Math.abs(e.clientY - startPosRef.current.y);
    if (dx > 10 || dy > 10) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleRowClick = useCallback((e) => {
    if (isLongPressActiveRef.current) {
      isLongPressActiveRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (isSelecting) {
      e.preventDefault();
      e.stopPropagation();
      if (onToggleSelect) onToggleSelect(item.Id);
      return;
    }
    onPlay(item);
  }, [isSelecting, item, onPlay, onToggleSelect]);

  return (
    <div 
      onClick={handleRowClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`group flex items-center justify-between p-2.5 px-3 sm:px-4 rounded-xl transition cursor-pointer text-xs select-none ${
        isSelected
          ? 'bg-cyan-950/40 border-2 border-cyan-400 shadow-md shadow-cyan-500/20'
          : isDuplicate 
            ? 'bg-slate-900/40 hover:bg-slate-800/80 border border-red-500/50' 
            : 'bg-slate-900/40 hover:bg-slate-800/80 border border-white/5 hover:border-cyan-500/40'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
        {/* Selection Checkbox */}
        {(isSelecting || isSelected) && (
          <div 
            onClick={(e) => {
              e.stopPropagation();
              if (onToggleSelect) onToggleSelect(item.Id);
            }}
            className="flex-shrink-0 cursor-pointer"
            title={isSelected ? '取消选中' : '选中'}
          >
            <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${
              isSelected 
                ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/50 scale-105' 
                : 'bg-black/60 border-2 border-white/60 hover:border-white'
            }`}>
              {isSelected && <Check size={13} className="stroke-[3]" />}
            </div>
          </div>
        )}

        <div className="relative w-8 h-12 sm:w-9 sm:h-[52px] rounded-lg overflow-hidden bg-black/60 border border-white/10 flex-shrink-0">
          {posterUrl ? (
            <img src={posterUrl} alt={item.Name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-600"><Film size={14} /></div>
          )}
        </div>

        <div className="flex flex-col min-w-0">
          <div className="font-semibold text-white truncate text-xs sm:text-sm group-hover:text-cyan-300 transition" title={item.Name}>
            {item.Name}
          </div>
          <div className="text-[11px] text-gray-400 flex items-center gap-2 mt-0.5">
            <span>{item.ProductionYear || '未知年份'}</span>
            <span>•</span>
            <span>{durationText}</span>
            {item.OfficialRating && <span className="px-1 bg-white/10 rounded text-[9px]">{item.OfficialRating}</span>}
          </div>
        </div>
      </div>

      <div className="hidden md:flex items-center gap-6 text-gray-400">
        {item.CommunityRating && (
          <div className="flex items-center gap-1 font-mono text-amber-300">
            <Star size={12} className="fill-amber-400 text-amber-400" />
            <span>{item.CommunityRating.toFixed(1)}</span>
          </div>
        )}

        <div className="flex items-center gap-1 font-mono text-cyan-300">
          <Eye size={12} />
          <span>{playCount} 次</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => onToggleFavorite(item)}
          className={`p-1.5 rounded-lg border transition ${
            isFavorite ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'bg-black/40 border-white/5 text-gray-400 hover:text-amber-400'
          }`}
          title={isFavorite ? '取消最爱' : '加入最爱'}
        >
          <Star size={14} className={isFavorite ? 'fill-amber-400' : ''} />
        </button>

        <button
          onClick={() => {
            if (window.innerWidth < 768 && onOpenActionSheet) {
              onOpenActionSheet(item);
            } else {
              onOpenMetadataEditor(item);
            }
          }}
          className="p-1.5 rounded-lg bg-black/40 hover:bg-white/10 border border-white/5 text-gray-400 hover:text-white transition"
        >
          <MoreVertical size={14} />
        </button>

        <button
          onClick={() => onPlay(item)}
          className="p-1.5 px-2.5 sm:px-3 rounded-lg bg-jf-accent hover:bg-cyan-400 text-white font-medium flex items-center gap-1 transition"
        >
          <Play size={12} className="fill-white" />
          <span className="hidden sm:inline">播放</span>
        </button>
      </div>
    </div>
  );
});

export default function LibraryView({
  items = [],
  totalRecordCount = 0,
  userViews = [],
  selectedViewId,
  onSelectView,
  searchKeyword,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  sortMethod,
  onSortMethodChange,
  selectedGenre,
  onSelectGenre,
  selectedYear,
  onSelectYear,
  autoRefillFloatingWindows = false,
  onToggleAutoRefill,
  onOpenRandom3Windows,
  onPlayRandomItem,
  onPlaySingleItem,
  onOpenFloatingWindow,
  onPlayModal,
  onPlayVr,
  onUpdateItem,
  onDeleteItem,
  onOpenMetadataEditor,
  onOpenIdentify,
  onRefreshLibrary,
  onFilteredItemsChange,
  isRefreshing
}) {
  const [activeSubTab, setActiveSubTab] = useState('items');
  const [viewLayout, setViewLayout] = useState('poster');
  const [favoriteFilter, setFavoriteFilter] = useState('all');
  const [playCountFilter, setPlayCountFilter] = useState('all');
  const [selectedItemIds, setSelectedItemIds] = useState(() => new Set());
  const [actionSheetItem, setActionSheetItem] = useState(null);
  const [deleteTargetItem, setDeleteTargetItem] = useState(null);

  // Dynamic Poster Columns Slider State (Persisted separately for Poster vs Backdrop)
  const [gridColumnsPoster, setGridColumnsPoster] = useState(() => {
    const saved = localStorage.getItem('jf_library_grid_cols_poster') || localStorage.getItem('jf_library_grid_cols');
    if (saved) {
      const num = parseInt(saved, 10);
      if (!isNaN(num) && num >= 1 && num <= 12) return num;
    }
    return typeof window !== 'undefined' && window.innerWidth < 640 ? 3 : 6;
  });

  const [gridColumnsBackdrop, setGridColumnsBackdrop] = useState(() => {
    const saved = localStorage.getItem('jf_library_grid_cols_backdrop');
    if (saved) {
      const num = parseInt(saved, 10);
      if (!isNaN(num) && num >= 1 && num <= 12) return num;
    }
    return typeof window !== 'undefined' && window.innerWidth < 640 ? 2 : 4;
  });

  const gridColumns = viewLayout === 'backdrop' ? gridColumnsBackdrop : gridColumnsPoster;

  const handleGridColumnsChange = (val) => {
    const num = parseInt(val, 10);
    if (viewLayout === 'backdrop') {
      setGridColumnsBackdrop(num);
      localStorage.setItem('jf_library_grid_cols_backdrop', String(num));
    } else {
      setGridColumnsPoster(num);
      localStorage.setItem('jf_library_grid_cols_poster', String(num));
    }
  };
  
  // Secondary metadata state
  const [genresList, setGenresList] = useState([]);
  const [personsList, setPersonsList] = useState([]);
  const [collectionsList, setCollectionsList] = useState([]);

  // Progressive Lazy Loading (80 initial + 60 on scroll)
  const [visibleCount, setVisibleCount] = useState(80);

  useEffect(() => {
    setVisibleCount(80);
  }, [selectedViewId, statusFilter, favoriteFilter, playCountFilter, selectedGenre, selectedYear, searchKeyword, activeSubTab]);

  // Duplicate detection across current items
  const { duplicateItemIds, duplicateCount } = useMemo(() => {
    return detectDuplicateMedia(items);
  }, [items]);

  const subTabReqIdRef = useRef(0);

  // Load sub-tab data on demand with race-condition guard
  useEffect(() => {
    if (!jellyfin.auth.isConfigured || !selectedViewId) return;

    const reqId = ++subTabReqIdRef.current;

    if (activeSubTab === 'genres') {
      jellyfin.getGenres(selectedViewId).then(list => {
        if (reqId === subTabReqIdRef.current) setGenresList(list || []);
      });
    } else if (activeSubTab === 'persons') {
      jellyfin.getPersons(selectedViewId).then(list => {
        if (reqId === subTabReqIdRef.current) setPersonsList(list || []);
      });
    } else if (activeSubTab === 'collections') {
      jellyfin.getCollections(selectedViewId).then(list => {
        if (reqId === subTabReqIdRef.current) setCollectionsList(list || []);
      });
    }
  }, [activeSubTab, selectedViewId]);

  // Display items with Play Count and Status filter support
  const displayItems = useMemo(() => {
    let result = items;
    if (activeSubTab === 'duplicates') {
      result = items.filter(it => duplicateItemIds.has(it.Id));
    }

    // 1. Playback status filter (unplayed vs played)
    if (statusFilter === 'unplayed') {
      result = result.filter(it => !it.UserData?.Played);
    } else if (statusFilter === 'played') {
      result = result.filter(it => !!it.UserData?.Played);
    }

    // 2. Favorites filter (favorite vs not_favorite)
    if (favoriteFilter === 'favorite') {
      result = result.filter(it => !!it.UserData?.IsFavorite);
    } else if (favoriteFilter === 'not_favorite') {
      result = result.filter(it => !it.UserData?.IsFavorite);
    }

    // 3. Play count filter (mutually exclusive)
    if (playCountFilter === 'play_0') {
      result = result.filter(it => (it.UserData?.PlayCount || 0) === 0 && !it.UserData?.Played);
    } else if (playCountFilter === 'play_1') {
      result = result.filter(it => (it.UserData?.PlayCount || 0) === 1);
    } else if (playCountFilter === 'play_lte_1') {
      result = result.filter(it => (it.UserData?.PlayCount || 0) <= 1);
    } else if (playCountFilter === 'play_2_5') {
      result = result.filter(it => {
        const count = it.UserData?.PlayCount || 0;
        return count >= 2 && count <= 5;
      });
    } else if (playCountFilter === 'play_5_10') {
      result = result.filter(it => {
        const count = it.UserData?.PlayCount || 0;
        return count >= 5 && count <= 10;
      });
    } else if (playCountFilter === 'play_gte_10') {
      result = result.filter(it => (it.UserData?.PlayCount || 0) >= 10);
    }

    return result;
  }, [items, activeSubTab, duplicateItemIds, statusFilter, favoriteFilter, playCountFilter]);

  // Sync filtered items to parent container (for auto-refilling floating windows)
  useEffect(() => {
    if (onFilteredItemsChange) {
      onFilteredItemsChange(displayItems);
    }
  }, [displayItems, onFilteredItemsChange]);

  const displayedSlice = useMemo(() => {
    return displayItems.slice(0, visibleCount);
  }, [displayItems, visibleCount]);

  const scrollRafRef = useRef(null);
  const handleScroll = useCallback((e) => {
    const target = e.currentTarget;
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      if (!target) return;
      const { scrollTop, scrollHeight, clientHeight } = target;
      if (scrollHeight - scrollTop - clientHeight < 1000) {
        setVisibleCount(prev => (prev < displayItems.length ? Math.min(displayItems.length, prev + 60) : prev));
      }
    });
  }, [displayItems.length]);

  // Favorite toggle
  const handleToggleFavorite = useCallback(async (item) => {
    const nextFav = !item.UserData?.IsFavorite;
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
  }, [onUpdateItem]);

  // Played toggle
  const handleTogglePlayed = useCallback(async (item) => {
    const nextPlayed = !item.UserData?.Played;
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
      console.error('Failed to toggle played:', err);
    }
  }, [onUpdateItem]);

  // Refresh metadata
  const handleRefreshMetadata = useCallback(async (item) => {
    try {
      await jellyfin.refreshItemMetadata(item.Id);
      alert(`已向 Jellyfin 发送刷新「${item.Name}」元数据请求`);
    } catch (err) {
      alert('刷新失败: ' + err.message);
    }
  }, []);

  // Multi-select management
  const isSelecting = selectedItemIds.size > 0;

  const handleToggleSelect = useCallback((itemId) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedItemIds(new Set());
  }, []);

  const isAllVisibleSelected = useMemo(() => {
    if (displayItems.length === 0) return false;
    return displayItems.every(it => selectedItemIds.has(it.Id));
  }, [displayItems, selectedItemIds]);

  const handleSelectAllVisible = useCallback(() => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (isAllVisibleSelected) {
        displayItems.forEach(it => next.delete(it.Id));
      } else {
        displayItems.forEach(it => next.add(it.Id));
      }
      return next;
    });
  }, [displayItems, isAllVisibleSelected]);

  const handleBatchFavorite = useCallback(async (isFav) => {
    const ids = Array.from(selectedItemIds);
    if (ids.length === 0) return;

    // Optimistically update local items in UI
    ids.forEach(id => {
      const it = items.find(x => x.Id === id);
      if (it && onUpdateItem) {
        onUpdateItem({
          ...it,
          UserData: { ...it.UserData, IsFavorite: isFav }
        });
      }
    });

    try {
      await Promise.allSettled(ids.map(id => jellyfin.toggleFavorite(id, isFav)));
    } catch (err) {
      console.error('Batch favorite error:', err);
    }
  }, [selectedItemIds, items, onUpdateItem]);

  const handleOpenBatchDeleteModal = useCallback(() => {
    const ids = selectedItemIds;
    const targetItems = items.filter(x => ids.has(x.Id));
    if (targetItems.length === 0) return;
    setDeleteTargetItem(targetItems);
  }, [selectedItemIds, items]);

  // Delete item: trigger custom modal
  const handleDelete = useCallback((item) => {
    setDeleteTargetItem(item);
  }, []);

  const handleConfirmDelete = useCallback(async (target) => {
    const list = Array.isArray(target) ? target : [target];
    try {
      const results = await Promise.allSettled(list.map(it => jellyfin.deleteItem(it.Id)));
      list.forEach((it, idx) => {
        if (results[idx].status === 'fulfilled' && onDeleteItem) {
          onDeleteItem(it.Id);
        }
      });
      setSelectedItemIds(prev => {
        const next = new Set(prev);
        list.forEach(it => next.delete(it.Id));
        return next;
      });
    } catch (err) {
      alert(err.message || '删除失败');
    }
  }, [onDeleteItem]);

  return (
    <div className="w-full h-full flex flex-col bg-[#080b11] text-gray-100 overflow-hidden select-none">
      
      {/* Top Navigation Bar */}
      <div className="border-b border-white/5 bg-slate-950/90 backdrop-blur-md px-2.5 sm:px-5 py-2 sm:py-2.5 flex flex-col gap-1.5 sm:gap-2 z-30 pt-[max(0.5rem,env(safe-area-inset-top))]">
        
        {/* Row 1: Primary Library Tabs & Random Play Launcher */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 flex-1 min-w-0 no-scrollbar">
            {userViews.map(view => (
              <button
                key={view.Id}
                onClick={() => onSelectView(view.Id)}
                className={`flex items-center gap-1 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-xl text-xs font-bold transition flex-shrink-0 ${
                  selectedViewId === view.Id
                    ? 'bg-jf-accent text-white shadow-lg shadow-cyan-500/25 scale-[1.02]'
                    : 'bg-black/40 hover:bg-white/10 text-gray-300 border border-white/5'
                }`}
              >
                <Folder size={12} className={selectedViewId === view.Id ? 'text-white' : 'text-cyan-400'} />
                <span>{view.Name}</span>
              </button>
            ))}

            <button
              onClick={() => onSelectView('all')}
              className={`flex items-center gap-1 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl text-xs font-medium transition flex-shrink-0 ${
                selectedViewId === 'all'
                  ? 'bg-jf-accent text-white shadow-lg shadow-cyan-500/25'
                  : 'bg-black/40 hover:bg-white/10 text-gray-400 border border-white/5'
              }`}
              title="跨库全量浏览 (全部媒体)"
            >
              <Film size={12} />
              <span>全部</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            {/* Quick Random Play Button (Prioritizing Playback on Mobile & Desktop!) */}
            <button
              onClick={onPlayRandomItem || onOpenRandom3Windows}
              className="flex items-center gap-1 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-bold shadow-lg transition transform hover:scale-[1.02]"
              title="随机挑选一部未看/当前筛选的视频立即播放"
            >
              <Play size={12} className="fill-amber-400 text-amber-400" />
              <span className="hidden xs:inline">随机播放</span>
              <span className="xs:hidden">随机</span>
            </button>

            {/* Desktop Only: Auto Refill Floating Windows Checkbox */}
            <label 
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-black/40 hover:bg-white/10 border border-white/10 text-xs text-gray-300 cursor-pointer select-none transition" 
              title="勾选后，关闭某个悬浮播放窗口时将自动从当前筛选的媒体库中打开新窗口补充"
            >
              <input
                type="checkbox"
                checked={autoRefillFloatingWindows}
                onChange={(e) => onToggleAutoRefill && onToggleAutoRefill(e.target.checked)}
                className="w-3.5 h-3.5 accent-cyan-400 rounded cursor-pointer"
              />
              <span className="font-medium text-gray-200">自动补窗</span>
            </label>

            {/* Desktop Only: Tampermonkey 3-Window PIP Launcher */}
            <button
              onClick={onOpenRandom3Windows}
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-500/30 text-cyan-300 text-xs font-bold shadow-lg transition"
              title="开启 1大+2小 经典 3 独立悬浮播放窗"
            >
              <Tv size={13} className="text-cyan-400" />
              <span>3 窗模式</span>
            </button>
          </div>
        </div>

        {/* Row 2 (Desktop Only): Secondary Sub-Tabs, Sliders, Layout Switcher */}
        <div className="hidden md:flex items-center justify-between gap-2 border-t border-white/5 pt-2 text-xs">
          <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0">
            {SUB_TABS.map(tab => {
              const Icon = tab.icon;
              const isDup = tab.id === 'duplicates';
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveSubTab(tab.id)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition flex-shrink-0 text-xs ${
                    activeSubTab === tab.id
                      ? isDup ? 'bg-red-600/90 text-white shadow' : 'bg-slate-800 text-cyan-300 shadow'
                      : isDup && duplicateCount > 0 ? 'text-red-400 hover:bg-red-950/40' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Icon size={12} />
                  <span>{tab.label}</span>
                  {isDup && duplicateCount > 0 && (
                    <span className="px-1 py-0.5 rounded-full bg-red-500 text-[9px] text-white">
                      {duplicateCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Poster Size / Columns Slider */}
          {viewLayout !== 'list' && (
            <div className="flex items-center gap-1.5 bg-black/50 px-2 py-1 rounded-xl border border-white/10 text-xs text-gray-300 flex-shrink-0">
              <SlidersHorizontal size={12} className="text-cyan-400 flex-shrink-0" />
              <input
                type="range"
                min={1}
                max={12}
                step={1}
                value={gridColumns}
                onChange={(e) => handleGridColumnsChange(e.target.value)}
                className="w-14 sm:w-20 accent-cyan-400 h-1.5 bg-white/20 rounded-lg cursor-pointer appearance-none"
                title={`拖拽滑块调整每行海报大小与列数 (当前: ${gridColumns} 列)`}
              />
              <span className="text-[10px] font-mono text-cyan-300 font-bold min-w-[24px] text-right">
                {gridColumns}列
              </span>
            </div>
          )}

          {/* View Layout Switcher */}
          <div className="flex items-center bg-black/50 p-0.5 rounded-xl border border-white/10 gap-0.5 flex-shrink-0">
            <button
              onClick={() => setViewLayout('poster')}
              className={`p-1.5 rounded-lg transition ${
                viewLayout === 'poster' ? 'bg-slate-700 text-cyan-300 shadow' : 'text-gray-400 hover:text-white'
              }`}
              title="海报网格 (2:3)"
            >
              <LayoutGrid size={13} />
            </button>

            <button
              onClick={() => setViewLayout('backdrop')}
              className={`p-1.5 rounded-lg transition ${
                viewLayout === 'backdrop' ? 'bg-slate-700 text-cyan-300 shadow' : 'text-gray-400 hover:text-white'
              }`}
              title="剧照网格 (16:9)"
            >
              <Grid size={13} />
            </button>

            <button
              onClick={() => setViewLayout('list')}
              className={`p-1.5 rounded-lg transition ${
                viewLayout === 'list' ? 'bg-slate-700 text-cyan-300 shadow' : 'text-gray-400 hover:text-white'
              }`}
              title="列表视图"
            >
              <List size={13} />
            </button>
          </div>
        </div>

        {/* Row 2/3: Search, Filters & Sorting Bar (Compact Single-Row Horizontal Scroll on Mobile) */}
        <div className="flex items-center justify-between gap-1.5 text-xs pt-0.5 overflow-x-auto min-w-0 no-scrollbar">
          {/* Compact Search Input */}
          <div className="relative w-20 xs:w-28 sm:w-40 flex-shrink-0">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="搜索..."
              className="w-full pl-6 pr-5 py-1 rounded-xl bg-black/50 border border-white/10 text-white text-xs placeholder-gray-500 focus:outline-none focus:border-cyan-400 transition"
            />
            {searchKeyword && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                <X size={11} />
              </button>
            )}
          </div>

          {/* Filter Bar with Status, Favorites and Play Count */}
          <div className="flex items-center bg-black/40 p-0.5 rounded-xl border border-white/5 gap-0.5 sm:gap-1 overflow-x-auto flex-shrink-0">
            {/* Status (Mutually Exclusive: 全部 / 未播完 / 已播) */}
            <div className="flex items-center gap-0.5">
              {STATUS_OPTIONS.map(f => {
                const active = (statusFilter || 'all') === f.id;
                return (
                  <button
                    key={f.id}
                    onClick={() => onStatusFilterChange(active && f.id !== 'all' ? 'all' : f.id)}
                    className={`px-1.5 sm:px-2 py-1 rounded-lg transition flex-shrink-0 text-xs ${
                      active
                        ? 'bg-slate-700 text-cyan-300 font-medium shadow'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>

            <div className="h-3.5 w-px bg-white/10 mx-0.5 flex-shrink-0" />

            {/* Favorites Filter (Mutually Exclusive Pair: 最爱 / 非最爱) */}
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setFavoriteFilter(prev => prev === 'favorite' ? 'all' : 'favorite')}
                className={`px-1.5 sm:px-2 py-1 rounded-lg transition flex-shrink-0 text-xs flex items-center gap-1 ${
                  favoriteFilter === 'favorite'
                    ? 'bg-amber-500/25 border border-amber-500/40 text-amber-300 font-medium shadow'
                    : 'text-gray-400 hover:text-amber-300'
                }`}
                title="只看最爱视频"
              >
                <Star size={11} className={favoriteFilter === 'favorite' ? 'fill-amber-400 text-amber-400' : ''} />
                <span>最爱</span>
              </button>
              <button
                onClick={() => setFavoriteFilter(prev => prev === 'not_favorite' ? 'all' : 'not_favorite')}
                className={`px-1.5 sm:px-2 py-1 rounded-lg transition flex-shrink-0 text-xs flex items-center gap-1 ${
                  favoriteFilter === 'not_favorite'
                    ? 'bg-slate-700 text-cyan-300 font-medium shadow'
                    : 'text-gray-400 hover:text-white'
                }`}
                title="只看非最爱视频"
              >
                <span>非最爱</span>
              </button>
            </div>

            <div className="h-3.5 w-px bg-white/10 mx-0.5 flex-shrink-0" />

            {/* Play Count Filter */}
            <div className="flex items-center gap-0.5">
              {PLAY_COUNT_OPTIONS.map(opt => {
                const active = playCountFilter === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setPlayCountFilter(active ? 'all' : opt.id)}
                    className={`px-1.5 sm:px-2 py-1 rounded-lg transition flex-shrink-0 text-xs ${
                      active
                        ? 'bg-slate-700 text-cyan-300 font-medium shadow'
                        : 'text-gray-400 hover:text-white'
                    }`}
                    title={opt.title}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Filtered Total Count Badge */}
          <div 
            className="flex items-center gap-1 px-2 py-1 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-300 text-xs font-mono font-bold flex-shrink-0"
            title={`当前筛选: ${displayItems.length} 部`}
          >
            <Film size={11} className="text-cyan-400 flex-shrink-0" />
            <span>{displayItems.length}部</span>
          </div>

          {/* Sort Selector */}
          <div className="flex items-center gap-1 bg-black/40 px-1.5 sm:px-2 py-1 rounded-xl border border-white/5 text-gray-300 text-xs flex-shrink-0">
            <ArrowUpDown size={11} className="text-cyan-400" />
            <select
              value={sortMethod}
              onChange={(e) => onSortMethodChange(e.target.value)}
              className="bg-transparent text-gray-200 focus:outline-none cursor-pointer pr-1"
            >
              {SORT_OPTIONS.map(opt => (
                <option key={opt.id} value={opt.id} className="bg-slate-900 text-white">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Desktop Only: Refresh Library */}
          <button
            onClick={onRefreshLibrary}
            disabled={isRefreshing}
            className="hidden md:flex px-2.5 py-1.5 rounded-xl bg-black/40 hover:bg-white/10 border border-white/5 text-gray-300 hover:text-cyan-300 transition disabled:opacity-50 items-center gap-1.5 text-xs font-medium flex-shrink-0"
            title="扫描媒体库 & 刷新元数据"
          >
            <RefreshCw size={12} className={isRefreshing ? 'animate-spin text-cyan-400' : 'text-cyan-400'} />
            <span>{isRefreshing ? '扫描中...' : '刷新'}</span>
          </button>
        </div>
      </div>

      {/* Main Content Viewport with Infinite Progressive Loading */}
      <div 
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-2 sm:p-5 pb-24 md:pb-20"
      >
        {/* SUB-VIEW 1: Genres */}
        {activeSubTab === 'genres' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 sm:gap-3">
            {genresList.map(genre => (
              <div
                key={genre.Id}
                onClick={() => {
                  onSelectGenre(genre.Name);
                  setActiveSubTab('items');
                }}
                className="p-3.5 sm:p-4 rounded-xl bg-slate-900/60 hover:bg-slate-800/90 border border-white/5 hover:border-cyan-500/40 flex items-center justify-between cursor-pointer transition shadow-lg"
              >
                <div className="flex items-center gap-2.5">
                  <Tag size={15} className="text-cyan-400" />
                  <span className="font-semibold text-white text-xs sm:text-sm">{genre.Name}</span>
                </div>
                <ChevronRight size={14} className="text-gray-500" />
              </div>
            ))}
          </div>
        )}

        {/* SUB-VIEW 2: Persons */}
        {activeSubTab === 'persons' && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5 sm:gap-3.5">
            {personsList.map(person => {
              const imgUrl = jellyfin.getImageUrl(person.Id, person.ImageTags?.Primary, 'Primary', 200, 80);
              return (
                <div
                  key={person.Id}
                  onClick={() => {
                    onSearchChange(person.Name);
                    setActiveSubTab('items');
                  }}
                  className="group flex flex-col items-center bg-slate-900/40 p-2.5 rounded-2xl border border-white/5 hover:border-cyan-500/40 transition cursor-pointer"
                >
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden bg-black/60 border border-white/10 mb-1.5 group-hover:scale-105 transition">
                    {imgUrl ? (
                      <img src={imgUrl} alt={person.Name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-500"><Users size={20} /></div>
                    )}
                  </div>
                  <span className="text-[11px] sm:text-xs font-semibold text-white truncate max-w-full text-center group-hover:text-cyan-300">
                    {person.Name}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* SUB-VIEW 3: Collections */}
        {activeSubTab === 'collections' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {collectionsList.map(col => {
              const imgUrl = jellyfin.getImageUrl(col.Id, col.ImageTags?.Primary, 'Primary', 300, 80);
              return (
                <div
                  key={col.Id}
                  onClick={() => {
                    onSelectView(col.Id);
                    setActiveSubTab('items');
                  }}
                  className="group flex flex-col bg-slate-900/50 rounded-xl overflow-hidden border border-white/5 hover:border-cyan-500/40 transition cursor-pointer"
                >
                  <div className="aspect-[2/3] bg-black/60 overflow-hidden">
                    {imgUrl ? (
                      <img src={imgUrl} alt={col.Name} className="w-full h-full object-cover group-hover:scale-105 transition" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-600"><Layers size={28} /></div>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="text-xs font-bold text-white truncate group-hover:text-cyan-300">{col.Name}</div>
                    <div className="text-[10px] text-gray-400">合集系列</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* SUB-VIEW 4: Items Grid / List View */}
        {['items', 'duplicates'].includes(activeSubTab) && (
          <>
            {displayItems.length === 0 && !isRefreshing ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-3 py-20">
                <Film size={48} className="text-gray-700 animate-pulse" />
                <div className="text-sm">没有找到符合当前筛选条件的媒体</div>
              </div>
            ) : viewLayout === 'list' ? (
              <div className="flex flex-col gap-2">
                {displayedSlice.map(item => (
                  <MediaListRow
                    key={item.Id}
                    item={item}
                    isDuplicate={duplicateItemIds.has(item.Id)}
                    isSelected={selectedItemIds.has(item.Id)}
                    isSelecting={isSelecting}
                    onToggleSelect={handleToggleSelect}
                    onPlay={onPlaySingleItem}
                    onToggleFavorite={handleToggleFavorite}
                    onTogglePlayed={handleTogglePlayed}
                    onOpenMetadataEditor={onOpenMetadataEditor}
                    onOpenActionSheet={(it) => setActionSheetItem(it)}
                  />
                ))}
              </div>
            ) : (
              <div 
                className="grid gap-2.5 sm:gap-3.5"
                style={{
                  gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`
                }}
              >
                {displayedSlice.map(item => (
                  <MediaCard
                    key={item.Id}
                    item={item}
                    isDuplicate={duplicateItemIds.has(item.Id)}
                    viewLayout={viewLayout}
                    isSelected={selectedItemIds.has(item.Id)}
                    isSelecting={isSelecting}
                    onToggleSelect={handleToggleSelect}
                    onPlay={onPlaySingleItem}
                    onPlayModal={onPlayModal}
                    onPlayVr={onPlayVr}
                    onToggleFavorite={handleToggleFavorite}
                    onTogglePlayed={handleTogglePlayed}
                    onOpenMetadataEditor={onOpenMetadataEditor}
                    onOpenIdentify={onOpenIdentify}
                    onRefreshMetadata={handleRefreshMetadata}
                    onDelete={handleDelete}
                    onOpenActionSheet={(it) => setActionSheetItem(it)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating Multi-Select Batch Action Bar */}
      {selectedItemIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 sm:gap-3 px-4 py-2.5 rounded-2xl bg-slate-950/95 border border-cyan-500/50 shadow-2xl shadow-cyan-500/25 backdrop-blur-xl text-xs animate-in slide-in-from-bottom-5 duration-200 flex-wrap justify-center max-w-[95vw]">
          
          {/* Selected Count Indicator */}
          <div className="flex items-center gap-2 pr-2 border-r border-white/10 font-bold text-white font-mono">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-cyan-400 text-slate-950 text-[11px] font-black">
              {selectedItemIds.size}
            </span>
            <span>已选 {selectedItemIds.size} 部</span>
          </div>

          {/* Quick Select All */}
          <button
            onClick={handleSelectAllVisible}
            className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-gray-200 hover:text-white transition font-medium"
          >
            {isAllVisibleSelected ? '取消全选' : `全选当前 (${displayItems.length})`}
          </button>

          {/* Batch Add Favorites */}
          <button
            onClick={() => handleBatchFavorite(true)}
            className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold flex items-center gap-1.5 transition shadow-sm"
            title="将选中的所有媒体加入最爱"
          >
            <Star size={13} className="fill-amber-400 text-amber-400" />
            <span>加最爱</span>
          </button>

          {/* Batch Remove Favorites */}
          <button
            onClick={() => handleBatchFavorite(false)}
            className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-gray-300 hover:text-white font-medium flex items-center gap-1.5 transition"
            title="将选中的所有媒体取消最爱"
          >
            <Star size={13} />
            <span>取消最爱</span>
          </button>

          {/* Batch Delete */}
          <button
            onClick={handleOpenBatchDeleteModal}
            className="px-3 py-1.5 rounded-xl bg-red-600/90 hover:bg-red-600 text-white font-bold flex items-center gap-1.5 transition shadow-lg shadow-red-600/30"
            title="永久物理删除所有选中的媒体"
          >
            <Trash2 size={13} />
            <span>删除 ({selectedItemIds.size})</span>
          </button>

          {/* Exit / Clear Selection */}
          <button
            onClick={handleClearSelection}
            className="p-1.5 rounded-xl hover:bg-white/10 text-gray-400 hover:text-white transition ml-1"
            title="退出多选模式"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Mobile Action Sheet Drawer */}
      <MobileActionSheet
        isOpen={!!actionSheetItem}
        item={actionSheetItem}
        onClose={() => setActionSheetItem(null)}
        onPlay={onPlaySingleItem}
        onPlayVr={onPlayVr}
        onOpenFloating={onOpenFloatingWindow || onPlaySingleItem}
        onToggleFavorite={handleToggleFavorite}
        onTogglePlayed={handleTogglePlayed}
        onOpenMetadataEditor={onOpenMetadataEditor}
        onOpenIdentify={onOpenIdentify}
        onRefreshMetadata={handleRefreshMetadata}
        onDelete={handleDelete}
      />

      {/* Custom Safe Delete Modal */}
      <DeleteConfirmModal
        isOpen={!!deleteTargetItem}
        item={deleteTargetItem}
        itemsList={Array.isArray(deleteTargetItem) ? deleteTargetItem : null}
        onConfirm={handleConfirmDelete}
        onClose={() => setDeleteTargetItem(null)}
      />
    </div>
  );
}
