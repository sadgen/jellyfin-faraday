import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import { jellyfin } from '../api/jellyfinClient';
import { getTrickplayStyle } from '../utils/trickplay';
import { detectDuplicateMedia } from '../utils/duplicateChecker';
import { scanLibraryHealth } from '../utils/healthInspector';
import { stackMediaItems } from '../utils/mediaStacking';
import { sortMediaItems } from '../utils/mediaSorter';
import { useViewport } from '../hooks/useViewport';
import { getPlaybackDefaults, setPlaybackDefaults, QUALITY_OPTIONS, SPEED_PRESETS, PATROL_INTERVALS } from '../utils/playbackDefaults';
import { SEEK_SPEED_OPTIONS, getStoredSeekSpeed, setStoredSeekSpeed } from '../utils/seekSettings';
import MobileActionSheet from './MobileActionSheet';
import DeleteConfirmModal from './DeleteConfirmModal';
import CardContextMenu from './CardContextMenu';
import FaradaySuiteMenu from './FaradaySuiteMenu';
import {
  Play, Star, Eye, Search,
  Trash2, Folder, Film,
  ArrowUpDown, X, RefreshCw, Layers, LayoutGrid,
  Grid, List, MoreVertical, Calendar,
  Users, Tag, Check, ChevronRight, ChevronDown,
  SlidersHorizontal, Info, RotateCcw, History, Zap, ShieldAlert, Sparkles, Wand2
} from 'lucide-react';

const SUB_TABS = [
  { id: 'items', label: '影片', icon: Film },
  { id: 'folder', label: '文件夹', icon: Folder },
  { id: 'resume', label: '继续观看', icon: RotateCcw },
  { id: 'nextup', label: 'NextUp', icon: Zap },
  { id: 'history', label: '历史', icon: History },
  { id: 'genres', label: '类型', icon: Tag },
  { id: 'persons', label: '演职员', icon: Users },
  { id: 'years', label: '年份', icon: Calendar },
  { id: 'collections', label: '合集', icon: Layers },
  { id: 'duplicates', label: '查重清理', icon: Layers },
  { id: 'health', label: '损坏排查', icon: ShieldAlert }
];

// A-Z 字母索引（# 代表非字母开头）
const LETTER_INDEXES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '#'];

// 其他网格视图（文件夹 / 继续观看 / NextUp / 历史 / 演员 / 类型 / 年份 / 合集 / 损坏排查）的默认每行列数
const SECONDARY_GRID_DEFAULT_COLUMNS = {
  folder: 6, genres: 6, persons: 5, years: 8, collections: 6, resume: 6, nextup: 6, history: 6, health: 6
};

// 按标签页读取持久化的每行列数（1-12），无记录时使用默认值
function getSecondaryGridColumns(tab) {
  try {
    const saved = parseInt(localStorage.getItem(`jf_library_grid_cols_${tab}`) || '', 10);
    if (!isNaN(saved) && saved >= 1 && saved <= 12) return saved;
  } catch {
    // ignore storage errors
  }
  return SECONDARY_GRID_DEFAULT_COLUMNS[tab] || 6;
}

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
const MediaCard = memo(function MediaCard({
  item,
  isDuplicate,
  viewLayout = 'poster',
  isSelected = false,
  isSelecting = false,
  isMobileViewport = false,
  onToggleSelect,
  onPlay,
  onPlayModal,
  onPlayVr,
  onToggleFavorite,
  onTogglePlayed,
  onOpenDetail,
  onOpenMetadataEditor,
  onOpenIdentify,
  onRefreshMetadata,
  onDelete,
  onUpdateItem,
  onOpenActionSheet
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [trickplayTime, setTrickplayTime] = useState(null);
  const [hoverPercent, setHoverPercent] = useState(0);
  const [isNearTop, setIsNearTop] = useState(false);

  const isBackdrop = viewLayout === 'backdrop';
  // 封面回退链：Primary(海报/截图封面) → Thumb → Backdrop → 无 tag 兜底；
  // 服务端 404 时由 img onError 回退到垫底的占位图标
  const posterUrl = useMemo(() => {
    return jellyfin.getBestImageUrl(item, { maxWidth: isBackdrop ? 500 : 360, preferBackdrop: isBackdrop });
  }, [item, isBackdrop]);

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
    setTrickplayTime(null);
    setHoverPercent(0);
    // 注意：不在这里关闭 Portal 菜单（menuAnchor）——菜单渲染在 body 上，
    // 鼠标移出卡片进入菜单会触发本回调，若在此关闭则菜单无法点击。
    // 菜单的关闭由 CardContextMenu 的外部点击 / Esc / 滚动 / 选中项处理。
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
        {/* Static Poster Artwork（垫底占位图标：无封面 / 截图封面 404 时优雅回退） */}
        <div className="absolute inset-0 flex items-center justify-center text-gray-600">
          <Film size={isBackdrop ? 40 : 32} />
        </div>
        {posterUrl && (
          <img
            src={posterUrl}
            alt={item.Name}
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
            className={`relative w-full h-full object-cover transition-opacity duration-200 ${
              isBackdrop && tpStyle ? 'opacity-0' : 'opacity-100'
            }`}
          />
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

        {/* Top-Left: Duplicate Badge / Stacked / Health Issue or Play Count */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 z-20 pointer-events-none flex-wrap max-w-[85%]">
          {item.healthIssue && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-600/95 backdrop-blur-md border border-red-400 text-[10px] font-mono font-bold text-white shadow-lg animate-pulse" title={item.healthReason}>
              <ShieldAlert size={10} />
              <span>损坏</span>
            </div>
          )}

          {item.isStacked && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-600/90 backdrop-blur-md border border-cyan-400/50 text-[10px] font-mono font-bold text-white shadow-md">
              <Layers size={10} />
              <span>{item.stackedCount} 段</span>
            </div>
          )}

          {isDuplicate && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-600/90 backdrop-blur-md border border-red-400/50 text-[10px] font-mono font-bold text-white shadow-lg animate-pulse">
              <Layers size={10} />
              <span>重复</span>
            </div>
          )}

          {!isDuplicate && !item.healthIssue && playCount > 0 && (
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
          <div className="flex items-center gap-1">
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

            {/* 查看详情 / 相似推荐 */}
            {onOpenDetail && (
              <button
                onClick={(e) => { e.stopPropagation(); onOpenDetail(item); }}
                className="p-1.5 rounded-lg bg-black/70 hover:bg-black/90 border border-white/10 text-gray-300 hover:text-cyan-300 backdrop-blur-md transition"
                title="查看详情 / 相似推荐"
              >
                <Info size={14} />
              </button>
            )}

            {/* 刷新元数据（一键直达） */}
            {onRefreshMetadata && (
              <button
                onClick={(e) => { e.stopPropagation(); onRefreshMetadata(item); }}
                className="p-1.5 rounded-lg bg-black/70 hover:bg-black/90 border border-white/10 text-gray-300 hover:text-cyan-300 backdrop-blur-md transition"
                title="刷新媒体信息"
              >
                <RefreshCw size={14} />
              </button>
            )}
          </div>

          <div className="relative">
            <button
              data-contextmenu-trigger
              onClick={(e) => {
                e.stopPropagation();
                if (menuAnchor) {
                  setMenuAnchor(null); // 再次点击触发按钮 = 关闭菜单
                  return;
                }
                if (isMobileViewport && onOpenActionSheet) {
                  onOpenActionSheet(item);
                } else {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setMenuAnchor({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
                }
              }}
              className="p-1.5 rounded-lg bg-black/70 hover:bg-black/90 border border-white/10 text-gray-300 hover:text-white backdrop-blur-md transition"
              title="更多操作"
            >
              <MoreVertical size={14} />
            </button>
          </div>
        </div>

        {/* 卡片操作菜单：Portal 渲染到 body，避免被海报容器 overflow-hidden 裁剪 */}
        <CardContextMenu
          item={item}
          anchorRect={menuAnchor}
          onClose={() => setMenuAnchor(null)}
          onPlayFloating={onPlay}
          onPlayTheater={onPlayModal}
          onPlayVr={onPlayVr}
          onOpenDetail={onOpenDetail}
          onOpenMetadataEditor={onOpenMetadataEditor}
          onOpenIdentify={onOpenIdentify}
          onRefreshMetadata={onRefreshMetadata}
          onDelete={onDelete}
          onUpdateItem={onUpdateItem}
        />
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
const MediaListRow = memo(function MediaListRow({
  item,
  isDuplicate,
  isSelected = false,
  isSelecting = false,
  isMobileViewport = false,
  onToggleSelect,
  onPlay,
  onPlayModal,
  onPlayVr,
  onToggleFavorite,
  onTogglePlayed: _onTogglePlayed,
  onOpenDetail,
  onOpenMetadataEditor,
  onOpenIdentify,
  onRefreshMetadata,
  onDelete,
  onUpdateItem,
  onOpenActionSheet
}) {
  const [menuAnchor, setMenuAnchor] = useState(null);
  const posterUrl = jellyfin.getBestImageUrl(item, { maxWidth: 150 });
  const isFavorite = !!item.UserData?.IsFavorite;
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
          <div className="absolute inset-0 flex items-center justify-center text-gray-600"><Film size={14} /></div>
          {posterUrl && (
            <img
              src={posterUrl}
              alt={item.Name}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
              className="relative w-full h-full object-cover"
            />
          )}
        </div>

          <div className="flex flex-col min-w-0">
            <div className="font-semibold text-white truncate text-xs sm:text-sm group-hover:text-cyan-300 transition flex items-center gap-1.5" title={item.Name}>
              <span>{item.Name}</span>
              {item.isStacked && (
                <span className="px-1.5 py-0.2 rounded bg-cyan-600/90 text-[9px] font-mono text-white flex-shrink-0">
                  {item.stackedCount} 段
                </span>
              )}
              {item.healthIssue && (
                <span className="px-1.5 py-0.2 rounded bg-red-600 text-[9px] font-mono text-white flex-shrink-0" title={item.healthReason}>
                  损坏
                </span>
              )}
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
          data-contextmenu-trigger
          onClick={(e) => {
            e.stopPropagation();
            if (menuAnchor) {
              setMenuAnchor(null); // 再次点击触发按钮 = 关闭菜单
              return;
            }
            if (isMobileViewport && onOpenActionSheet) {
              onOpenActionSheet(item);
            } else {
              const rect = e.currentTarget.getBoundingClientRect();
              setMenuAnchor({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
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

      {/* 行操作菜单（与卡片菜单一致，Portal 渲染） */}
      <CardContextMenu
        item={item}
        anchorRect={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        onPlayFloating={onPlay}
        onPlayTheater={onPlayModal}
        onPlayVr={onPlayVr}
        onOpenDetail={onOpenDetail}
        onOpenMetadataEditor={onOpenMetadataEditor}
        onOpenIdentify={onOpenIdentify}
        onRefreshMetadata={onRefreshMetadata}
        onDelete={onDelete}
        onUpdateItem={onUpdateItem}
      />
    </div>
  );
});

export default function LibraryView({
  items = [],
  totalRecordCount: _totalRecordCount = 0,
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
  selectedLetter,
  onSelectLetter,
  autoRefillFloatingWindows = false,
  onToggleAutoRefill,
  onOpenRandom2Windows,
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
  onOpenDetail,
  onRefreshLibrary,
  onFilteredItemsChange,
  isRefreshing
}) {
  // 默认使用文件夹视图（folder），并持久化记住用户当前所选子标签页
  const [activeSubTab, setActiveSubTab] = useState(() => {
    try {
      return localStorage.getItem('jf_library_active_subtab') || 'folder';
    } catch {
      return 'folder';
    }
  });

  const handleSubTabChange = useCallback((tabId) => {
    setActiveSubTab(tabId);
    try {
      localStorage.setItem('jf_library_active_subtab', tabId);
    } catch {
      // ignore storage errors
    }
  }, []);

  const [viewLayout, setViewLayout] = useState('poster');
  const [favoriteFilter, setFavoriteFilter] = useState('all');
  const [playCountFilter, setPlayCountFilter] = useState('all');
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);
  const [showMobileFilterMenu, setShowMobileFilterMenu] = useState(false);
  const [showMobileSubTabMenu, setShowMobileSubTabMenu] = useState(false);
  const [showMobileLayoutMenu, setShowMobileLayoutMenu] = useState(false);
  const [enableStacking, setEnableStacking] = useState(() => {
    try {
      return localStorage.getItem('jf_enable_media_stacking') !== 'false';
    } catch {
      return true;
    }
  });
  const [selectedItemIds, setSelectedItemIds] = useState(() => new Set());
  const [actionSheetItem, setActionSheetItem] = useState(null);
  const [deleteTargetItem, setDeleteTargetItem] = useState(null);

  // 响应式视口（替代渲染期直读 window.innerWidth）
  const { width: vpWidth } = useViewport();
  const isMobileViewport = vpWidth < 768;

  // Default Playback Settings State & Quick Popover
  const [showPlaybackDefaultsMenu, setShowPlaybackDefaultsMenu] = useState(false);
  const [playbackDefaults, setPlaybackDefaultsState] = useState(() => getPlaybackDefaults());
  const [seekSpeed, setSeekSpeedState] = useState(() => getStoredSeekSpeed());

  useEffect(() => {
    const handleDefaultsChange = (e) => {
      if (e.detail) setPlaybackDefaultsState(e.detail);
    };
    const handleSeekChange = (e) => {
      if (e.detail) setSeekSpeedState(e.detail);
    };
    window.addEventListener('faraday:playback_defaults_changed', handleDefaultsChange);
    window.addEventListener('faraday:seek_speed_changed', handleSeekChange);
    return () => {
      window.removeEventListener('faraday:playback_defaults_changed', handleDefaultsChange);
      window.removeEventListener('faraday:seek_speed_changed', handleSeekChange);
    };
  }, []);

  // Dynamic Poster Columns Slider State (Persisted separately for Poster vs Backdrop)
  const [gridColumnsPoster, setGridColumnsPoster] = useState(() => {
    const saved = localStorage.getItem('jf_library_grid_cols_poster') || localStorage.getItem('jf_library_grid_cols');
    if (saved) {
      const num = parseInt(saved, 10);
      if (!isNaN(num) && num >= 1 && num <= 12) return num;
    }
    return vpWidth < 640 ? 3 : 6;
  });

  const [gridColumnsBackdrop, setGridColumnsBackdrop] = useState(() => {
    const saved = localStorage.getItem('jf_library_grid_cols_backdrop');
    if (saved) {
      const num = parseInt(saved, 10);
      if (!isNaN(num) && num >= 1 && num <= 12) return num;
    }
    return vpWidth < 640 ? 2 : 4;
  });

  const gridColumns = useMemo(() => {
    const isMobile = vpWidth < 640;
    if (viewLayout === 'backdrop') {
      return isMobile ? Math.min(gridColumnsBackdrop, 2) : gridColumnsBackdrop;
    }
    return isMobile ? Math.min(gridColumnsPoster, 4) : gridColumnsPoster;
  }, [vpWidth, viewLayout, gridColumnsBackdrop, gridColumnsPoster]);

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

  const [secondaryGridColumns, setSecondaryGridColumnsState] = useState(() => getSecondaryGridColumns(activeSubTab));

  useEffect(() => {
    setSecondaryGridColumnsState(getSecondaryGridColumns(activeSubTab));
  }, [activeSubTab]);

  const handleSecondaryGridColumnsChange = (val) => {
    const num = parseInt(val, 10);
    if (isNaN(num) || num < 1 || num > 12) return;
    setSecondaryGridColumnsState(num);
    try {
      localStorage.setItem(`jf_library_grid_cols_${activeSubTab}`, String(num));
    } catch {
      // ignore storage errors
    }
  };

  // 当前子视图实际生效的每行列数与滑块可见性
  const isMediaGridTab = activeSubTab === 'items' || activeSubTab === 'duplicates';
  const effectiveGridColumns = isMediaGridTab ? gridColumns : secondaryGridColumns;
  const showColumnsSlider = isMediaGridTab ? viewLayout !== 'list' : true;

  // 手机端筛选下拉按钮是否处于激活状态（任一筛选生效即高亮）
  const hasActiveMobileFilters =
    (statusFilter || 'all') !== 'all' ||
    favoriteFilter !== 'all' ||
    playCountFilter !== 'all' ||
    showDuplicatesOnly;
  
  // Secondary metadata state
  const [genresList, setGenresList] = useState([]);
  const [personsList, setPersonsList] = useState([]);
  const [collectionsList, setCollectionsList] = useState([]);
  const [yearsList, setYearsList] = useState([]);
  const [resumeList, setResumeList] = useState([]);
  const [nextUpList, setNextUpList] = useState([]);
  const [historyList, setHistoryList] = useState([]);

  // 原始目录树结构（文件夹浏览）状态
  const [folderItems, setFolderItems] = useState([]);
  const [folderPathStack, setFolderPathStack] = useState([]); // [{ id, name }]
  const [isFolderLoading, setIsFolderLoading] = useState(false);

  // 当切换库视图时，重置文件夹面包屑栈
  useEffect(() => {
    if (selectedViewId && selectedViewId !== 'all') {
      const view = userViews.find(v => v.Id === selectedViewId);
      setFolderPathStack([{ id: selectedViewId, name: view?.Name || '根目录' }]);
    } else {
      setFolderPathStack([]);
    }
  }, [selectedViewId, userViews]);

  // 文件夹当前所在的父节点 ID
  const currentFolderNode = folderPathStack[folderPathStack.length - 1];
  const currentFolderId = currentFolderNode?.id || (selectedViewId !== 'all' ? selectedViewId : '');

  // 加载当前文件夹的直接子项（文件夹 + 视频）
  useEffect(() => {
    if (activeSubTab !== 'folder' || !jellyfin.auth.isConfigured) return;

    if (!currentFolderId) {
      // 在"全部"视图且尚未进入任何库：直接展示各顶级库作为文件夹
      setFolderItems(userViews.map(v => ({
        Id: v.Id,
        Name: v.Name,
        IsFolder: true,
        Type: 'Folder',
        ImageTags: v.ImageTags,
        ChildCount: v.ChildCount
      })));
      return;
    }

    setIsFolderLoading(true);
    let cancelled = false;
    jellyfin.getFolderChildren(currentFolderId).then(items => {
      if (!cancelled) {
        setFolderItems(items || []);
        setIsFolderLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setIsFolderLoading(false);
    });

    return () => { cancelled = true; };
  }, [activeSubTab, currentFolderId, userViews]);

  // 演职员：从本地缓存聚合"只统计演员"（/Persons 接口会混入导演/编剧等幕后人员）。
  // 依据条目 People 中的 Type 过滤（Actor / GuestStar / 无 Type 视为演员），按出演数量排序。
  const localActorList = useMemo(() => {
    if (!items || items.length === 0) return [];
    const hasPeopleData = items.some(it => Array.isArray(it.People));
    if (!hasPeopleData) return [];
    const map = new Map();
    items.forEach(it => {
      (it.People || []).forEach(p => {
        if (!p?.Id || !p?.Name) return;
        if (p.Type && !['Actor', 'GuestStar'].includes(p.Type)) return;
        const entry = map.get(p.Id) || {
          Id: p.Id,
          Name: p.Name,
          ImageTags: { Primary: p.PrimaryImageTag || undefined },
          count: 0
        };
        entry.count += 1;
        map.set(p.Id, entry);
      });
    });
    return Array.from(map.values())
      .sort((a, b) => b.count - a.count || a.Name.localeCompare(b.Name, 'zh-CN'))
      .slice(0, 300);
  }, [items]);

  // 优先使用本地演员聚合；缓存尚无 People 数据时回退服务器 /Persons
  const personsDisplayList = localActorList.length > 0 ? localActorList : personsList;

  // Progressive Lazy Loading (80 initial + 60 on scroll)
  const [visibleCount, setVisibleCount] = useState(80);

  useEffect(() => {
    setVisibleCount(80);
  }, [selectedViewId, statusFilter, favoriteFilter, playCountFilter, selectedGenre, selectedYear, selectedLetter, showDuplicatesOnly, searchKeyword, activeSubTab]);

  // Duplicate detection across current items
  const { duplicateItemIds, duplicateCount } = useMemo(() => {
    return detectDuplicateMedia(items);
  }, [items]);

  // Health inspection across current items (损坏截断/下载中断坏文件检测)
  const { brokenItems, brokenCount } = useMemo(() => {
    return scanLibraryHealth(items);
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
    } else if (activeSubTab === 'years') {
      jellyfin.getYears(selectedViewId).then(list => {
        if (reqId === subTabReqIdRef.current) setYearsList(list || []);
      });
    } else if (activeSubTab === 'resume') {
      jellyfin.getResumeItems(selectedViewId).then(list => {
        if (reqId === subTabReqIdRef.current) setResumeList(list || []);
      });
    } else if (activeSubTab === 'nextup') {
      jellyfin.getNextUp(selectedViewId).then(list => {
        if (reqId === subTabReqIdRef.current) setNextUpList(list || []);
      });
    } else if (activeSubTab === 'history') {
      jellyfin.getPlayedHistory(selectedViewId).then(list => {
        if (reqId === subTabReqIdRef.current) setHistoryList(list || []);
      });
    }
  }, [activeSubTab, selectedViewId]);

  // Display items with Play Count and Status filter support
  const displayItems = useMemo(() => {
    let result = items;
    if (activeSubTab === 'duplicates') {
      result = items.filter(it => duplicateItemIds.has(it.Id));
    }

    // 0. 仅显示重复影片（U4：与查重清理标签页同源的判定，可叠加其它筛选）
    if (showDuplicatesOnly && activeSubTab !== 'duplicates') {
      result = result.filter(it => duplicateItemIds.has(it.Id));
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

    // 4. 健康排查子标签页
    if (activeSubTab === 'health') {
      return sortMediaItems(brokenItems, sortMethod);
    }

    // 5. 自制分段切片智能聚合（在影片主视图且开启聚合时）
    if (activeSubTab === 'items' && enableStacking) {
      result = stackMediaItems(result);
    }

    // 6. 保证最终展示列表严格按当前 sortMethod 排序（解决按演员/关键词搜索时服务端按匹配度打乱排序的问题）
    return sortMediaItems(result, sortMethod);
  }, [items, activeSubTab, duplicateItemIds, brokenItems, showDuplicatesOnly, statusFilter, favoriteFilter, playCountFilter, enableStacking, sortMethod]);

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
      if (onUpdateItem) {
        onUpdateItem(item);
      }
      alert(err.message || '更新收藏状态失败');
    }
  }, [onUpdateItem]);

  // Played toggle（失败回滚 + 提示，与收藏操作行为一致）
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
      if (onUpdateItem) {
        onUpdateItem(item);
      }
      alert(err.message || '更新播放状态失败');
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
    const targetItems = ids
      .map(id => items.find(item => item.Id === id))
      .filter(Boolean);

    // Optimistically update local items in UI
    targetItems.forEach(it => {
      if (onUpdateItem) {
        onUpdateItem({
          ...it,
          UserData: { ...it.UserData, IsFavorite: isFav }
        });
      }
    });

    const results = await Promise.allSettled(
      targetItems.map(item => jellyfin.toggleFavorite(item.Id, isFav))
    );
    const failedItems = targetItems.filter((_, index) => results[index].status === 'rejected');

    // Roll back only the items that the server rejected.
    failedItems.forEach(item => {
      if (onUpdateItem) onUpdateItem(item);
    });

    if (failedItems.length > 0) {
      const succeeded = targetItems.length - failedItems.length;
      alert(`批量收藏完成：成功 ${succeeded} 项，失败 ${failedItems.length} 项。失败项目已恢复原状态。`);
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
    const results = await Promise.allSettled(list.map(it => jellyfin.deleteItem(it.Id)));
    const succeededItems = list.filter((_, index) => results[index].status === 'fulfilled');
    const failedItems = list.filter((_, index) => results[index].status === 'rejected');

    succeededItems.forEach(item => {
      if (onDeleteItem) onDeleteItem(item.Id);
    });

    // Remove only successful deletions from selection so failed items remain
    // selected and can be retried immediately.
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      succeededItems.forEach(item => next.delete(item.Id));
      return next;
    });

    if (failedItems.length > 0) {
      const failedNames = failedItems.slice(0, 3).map(item => item.Name).join('、');
      const suffix = failedItems.length > 3 ? ` 等 ${failedItems.length} 项` : '';
      alert(`删除完成：成功 ${succeededItems.length} 项，失败 ${failedItems.length} 项（${failedNames}${suffix}）。失败项目仍保持选中，可重试。`);
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

          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {/* Quick Random Windows Button：补窗语义 —— 保留当前浮窗，随机补齐到 2/3 窗；文案与行为统一由 isMobileViewport 决定 */}
            <button
              onClick={isMobileViewport ? (onOpenRandom2Windows || onPlayRandomItem) : (onOpenRandom3Windows || onPlayRandomItem)}
              className="flex items-center gap-1 px-2 sm:px-3.5 py-1 sm:py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-bold shadow-lg transition transform hover:scale-[1.02]"
              title={isMobileViewport ? "随机补充悬浮窗至 2 窗 (保留当前窗口，缺几补几)" : "随机补充悬浮窗至 1大+2小 3 窗 (保留当前窗口，缺几补几)"}
            >
              <Play size={12} className="fill-amber-400 text-amber-400" />
              <span>{isMobileViewport ? '随机2窗' : '随机 3 窗'}</span>
            </button>

            {/* Quick Random 1 Play Button (Desktop Only；移动端由底部导航栏承担) */}
            <button
              onClick={onPlayRandomItem}
              className="hidden md:flex items-center gap-1 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-black/40 hover:bg-white/10 border border-white/10 text-gray-300 text-xs font-medium transition"
              title="随机挑选一部视频立即播放"
            >
              <Play size={12} className="text-gray-400" />
              <span>单片随机</span>
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

            {/* Default Playback Settings Popover */}
            <div className="relative">
              <button
                onClick={() => setShowPlaybackDefaultsMenu(prev => !prev)}
                className={`flex items-center gap-1 p-1.5 sm:px-3 sm:py-1.5 rounded-xl border text-xs font-bold transition ${
                  showPlaybackDefaultsMenu
                    ? 'bg-cyan-950 border-cyan-400 text-cyan-300 shadow-lg shadow-cyan-500/30'
                    : 'bg-black/40 hover:bg-white/10 border-white/10 text-gray-300 hover:text-cyan-300'
                }`}
                title="设置全局默认播放选项（画质、倍速、海报画中画、快进步长等）"
              >
                <SlidersHorizontal size={13} className="text-cyan-400" />
                <span className="hidden sm:inline">默认播放</span>
              </button>

              {/* Backdrop to close on outside click */}
              {showPlaybackDefaultsMenu && (
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowPlaybackDefaultsMenu(false)} 
                />
              )}

              {/* Solid High-Contrast Dropdown Menu */}
              {showPlaybackDefaultsMenu && (
                <div 
                  className="absolute right-0 top-[calc(100%+8px)] z-50 w-[88vw] max-w-sm sm:w-80 bg-[#0d131f] border-2 border-cyan-400/80 rounded-2xl p-3.5 sm:p-4 shadow-[0_20px_60px_rgba(0,0,0,0.95)] flex flex-col gap-3.5 text-xs animate-in fade-in zoom-in-95 duration-100 max-h-[85vh] overflow-y-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between border-b border-white/15 pb-2">
                    <span className="font-bold text-white text-sm flex items-center gap-1.5">
                      <SlidersHorizontal size={14} className="text-cyan-400" />
                      默认播放偏好设置
                    </span>
                    <button
                      onClick={() => setShowPlaybackDefaultsMenu(false)}
                      className="p-1 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  {/* 1. Default Quality */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] text-cyan-300 font-bold">🎥 默认画质</span>
                    <div className="grid grid-cols-5 gap-1.5">
                      {QUALITY_OPTIONS.map(q => (
                        <button
                          key={q.id}
                          onClick={() => {
                            const updated = setPlaybackDefaults({ quality: q.id });
                            setPlaybackDefaultsState(updated);
                          }}
                          className={`py-1.5 rounded-lg text-[11px] text-center transition ${
                            playbackDefaults.quality === q.id
                              ? 'bg-cyan-400 text-slate-950 font-extrabold shadow-md shadow-cyan-400/40'
                              : 'bg-slate-800 hover:bg-slate-700 text-gray-200 border border-white/10 font-medium'
                          }`}
                        >
                          {q.shortLabel}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 2. Default Speed */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] text-cyan-300 font-bold">⚡ 默认播放倍速</span>
                    <div className="grid grid-cols-5 gap-1.5">
                      {SPEED_PRESETS.map(spd => (
                        <button
                          key={spd}
                          onClick={() => {
                            const updated = setPlaybackDefaults({ speed: spd });
                            setPlaybackDefaultsState(updated);
                          }}
                          className={`py-1.5 rounded-lg text-[11px] text-center transition ${
                            playbackDefaults.speed === spd
                              ? 'bg-cyan-400 text-slate-950 font-extrabold shadow-md shadow-cyan-400/40'
                              : 'bg-slate-800 hover:bg-slate-700 text-gray-200 border border-white/10 font-medium'
                          }`}
                        >
                          {spd}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 3. Default Pinned Poster PIP */}
                  <div className="flex items-center justify-between py-1 border-t border-white/10">
                    <span className="text-[11px] text-gray-200 font-medium">🖼️ 海报画中画 (PIP)</span>
                    <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-white/15 text-[11px]">
                      <button
                        onClick={() => {
                          const updated = setPlaybackDefaults({ showPinnedPoster: true });
                          setPlaybackDefaultsState(updated);
                        }}
                        className={`px-3 py-1 rounded transition ${
                          playbackDefaults.showPinnedPoster
                            ? 'bg-cyan-400 text-slate-950 font-extrabold shadow-sm'
                            : 'text-gray-400 hover:text-white font-medium'
                        }`}
                      >
                        开启
                      </button>
                      <button
                        onClick={() => {
                          const updated = setPlaybackDefaults({ showPinnedPoster: false });
                          setPlaybackDefaultsState(updated);
                        }}
                        className={`px-3 py-1 rounded transition ${
                          !playbackDefaults.showPinnedPoster
                            ? 'bg-cyan-400 text-slate-950 font-extrabold shadow-sm'
                            : 'text-gray-400 hover:text-white font-medium'
                        }`}
                      >
                        关闭
                      </button>
                    </div>
                  </div>

                  {/* 4. Seek Speed Tier */}
                  <div className="flex flex-col gap-1.5 pt-1 border-t border-white/10">
                    <span className="text-[11px] text-cyan-300 font-bold">⏩ 快进快退 / 滚轮寻轨步长</span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {SEEK_SPEED_OPTIONS.map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => {
                            setStoredSeekSpeed(opt.id);
                            setSeekSpeedState(opt.id);
                          }}
                          className={`py-1.5 rounded-lg text-[11px] text-center transition ${
                            seekSpeed === opt.id
                              ? 'bg-cyan-400 text-slate-950 font-extrabold shadow-md shadow-cyan-400/40'
                              : 'bg-slate-800 hover:bg-slate-700 text-gray-200 border border-white/10 font-medium'
                          }`}
                        >
                          {opt.label.split(' ')[0]} ({opt.shortLabel})
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 5. Auto Refill Floating Windows */}
                  <div className="flex items-center justify-between pt-2 border-t border-white/15">
                    <span className="text-[11px] text-gray-200 font-medium">🪟 关窗后自动补充新窗</span>
                    <button
                      onClick={() => {
                        const nextVal = !autoRefillFloatingWindows;
                        if (onToggleAutoRefill) onToggleAutoRefill(nextVal);
                        const updated = setPlaybackDefaults({ autoRefill: nextVal });
                        setPlaybackDefaultsState(updated);
                      }}
                      className={`px-3 py-1 rounded-lg text-[11px] font-bold transition ${
                        autoRefillFloatingWindows
                          ? 'bg-cyan-400 text-slate-950 font-extrabold shadow-md shadow-cyan-400/40'
                          : 'bg-slate-800 hover:bg-slate-700 text-gray-400 hover:text-white border border-white/15'
                      }`}
                    >
                      {autoRefillFloatingWindows ? '已开启' : '已关闭'}
                    </button>
                  </div>

                  {/* 6. Smart Start (智能正片起播) */}
                  <div className="flex items-center justify-between pt-1 border-t border-white/10">
                    <div className="flex flex-col">
                      <span className="text-[11px] text-gray-200 font-medium">🎯 智能跳前奏起播</span>
                      <span className="text-[9px] text-gray-400">优先识别片头章节，智能跳过开场冗余前奏起播</span>
                    </div>
                    <button
                      onClick={() => {
                        const nextVal = !playbackDefaults.smartStart;
                        const updated = setPlaybackDefaults({ smartStart: nextVal });
                        setPlaybackDefaultsState(updated);
                      }}
                      className={`px-3 py-1 rounded-lg text-[11px] font-bold transition ${
                        playbackDefaults.smartStart
                          ? 'bg-cyan-400 text-slate-950 font-extrabold shadow-md shadow-cyan-400/40'
                          : 'bg-slate-800 hover:bg-slate-700 text-gray-400 hover:text-white border border-white/15'
                      }`}
                    >
                      {playbackDefaults.smartStart ? '已开启' : '已关闭'}
                    </button>
                  </div>

                  {/* 7. Patrol Mode (霓虹巡更轮播) */}
                  <div className="flex flex-col gap-1.5 pt-1 border-t border-white/10">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-[11px] text-cyan-300 font-bold">🚨 霓虹多窗巡更轮巡</span>
                        <span className="text-[9px] text-gray-400">浮窗按设定秒数自动轮换换片，打造多屏监控看板</span>
                      </div>
                      <button
                        onClick={() => {
                          const nextVal = !playbackDefaults.patrolMode;
                          const updated = setPlaybackDefaults({ patrolMode: nextVal });
                          setPlaybackDefaultsState(updated);
                        }}
                        className={`px-3 py-1 rounded-lg text-[11px] font-bold transition ${
                          playbackDefaults.patrolMode
                            ? 'bg-cyan-400 text-slate-950 font-extrabold shadow-md shadow-cyan-400/40'
                            : 'bg-slate-800 hover:bg-slate-700 text-gray-400 hover:text-white border border-white/15'
                        }`}
                      >
                        {playbackDefaults.patrolMode ? '已开启' : '已关闭'}
                      </button>
                    </div>
                    {playbackDefaults.patrolMode && (
                      <div className="grid grid-cols-4 gap-1 pt-0.5">
                        {PATROL_INTERVALS.map(sec => (
                          <button
                            key={sec}
                            onClick={() => {
                              const updated = setPlaybackDefaults({ patrolIntervalSeconds: sec });
                              setPlaybackDefaultsState(updated);
                            }}
                            className={`py-1 rounded text-[10px] font-mono font-bold text-center transition ${
                              (playbackDefaults.patrolIntervalSeconds || 45) === sec
                                ? 'bg-cyan-400 text-slate-950 shadow-sm'
                                : 'bg-slate-800 text-gray-300 hover:bg-slate-700'
                            }`}
                          >
                            {sec}秒
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 8. Media Stacking Toggle */}
                  <div className="flex items-center justify-between pt-1 border-t border-white/10">
                    <div className="flex flex-col">
                      <span className="text-[11px] text-gray-200 font-medium">📦 自制切片智能聚合</span>
                      <span className="text-[9px] text-gray-500">将 part1/part2 等切片合并为单张卡片</span>
                    </div>
                    <button
                      onClick={() => {
                        const nextVal = !enableStacking;
                        setEnableStacking(nextVal);
                        localStorage.setItem('jf_enable_media_stacking', String(nextVal));
                      }}
                      className={`px-3 py-1 rounded-lg text-[11px] font-bold transition ${
                        enableStacking
                          ? 'bg-cyan-400 text-slate-950 font-extrabold shadow-md shadow-cyan-400/40'
                          : 'bg-slate-800 hover:bg-slate-700 text-gray-400 hover:text-white border border-white/15'
                      }`}
                    >
                      {enableStacking ? '已开启' : '已关闭'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Faraday Suite Switcher */}
            <FaradaySuiteMenu currentApp="stream" direction="down" />
          </div>
        </div>

        {/* Row 2: Secondary Sub-Tabs + 视图布局切换（桌面端平铺，手机端收拢为下拉菜单） */}
        {isMobileViewport ? (
          <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-1.5 text-xs min-w-0">
            {/* 手机端：子标签页下拉菜单 */}
            <div className="relative flex-1 min-w-0">
              {(() => {
                const currentTab = SUB_TABS.find(t => t.id === activeSubTab) || SUB_TABS[0];
                const Icon = currentTab.icon;
                const isDup = activeSubTab === 'duplicates';
                const isHealth = activeSubTab === 'health';
                return (
                  <button
                    onClick={() => setShowMobileSubTabMenu(prev => !prev)}
                    className="w-full flex items-center justify-between gap-1.5 px-3 py-1.5 rounded-xl bg-black/50 hover:bg-white/10 border border-white/10 text-xs font-bold text-gray-200 shadow-sm transition"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 truncate">
                      <Icon size={13} className={isDup || isHealth ? 'text-red-400' : 'text-cyan-400'} />
                      <span className="truncate">{currentTab.label}</span>
                      {isDup && duplicateCount > 0 && (
                        <span className="px-1 py-0.2 rounded-full bg-red-500 text-[9px] text-white font-mono">
                          {duplicateCount}
                        </span>
                      )}
                      {isHealth && brokenCount > 0 && (
                        <span className="px-1 py-0.2 rounded-full bg-red-500 text-[9px] text-white font-mono">
                          {brokenCount}
                        </span>
                      )}
                    </div>
                    <ChevronDown size={13} className={`text-gray-400 transition-transform ${showMobileSubTabMenu ? 'rotate-180' : ''}`} />
                  </button>
                );
              })()}

              {showMobileSubTabMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMobileSubTabMenu(false)} />
                  <div
                    className="absolute left-0 top-[calc(100%+6px)] z-50 w-56 bg-[#0d131f] border-2 border-cyan-400/60 rounded-2xl p-2 shadow-[0_20px_60px_rgba(0,0,0,0.95)] flex flex-col gap-1 text-xs animate-in fade-in zoom-in-95 duration-100 max-h-[70vh] overflow-y-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-2 py-1 text-[10px] font-bold text-gray-400 border-b border-white/10 mb-0.5">
                      切换子标签页
                    </div>
                    {SUB_TABS.map(tab => {
                      const Icon = tab.icon;
                      const active = activeSubTab === tab.id;
                      const isTabDup = tab.id === 'duplicates';
                      const isTabHealth = tab.id === 'health';
                      return (
                        <button
                          key={tab.id}
                          onClick={() => {
                            handleSubTabChange(tab.id);
                            setShowMobileSubTabMenu(false);
                          }}
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left transition ${
                            active
                              ? 'bg-cyan-400 text-slate-950 font-bold shadow-md shadow-cyan-400/30'
                              : 'text-gray-300 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Icon size={13} className={active ? 'text-slate-950' : 'text-cyan-400'} />
                            <span>{tab.label}</span>
                          </div>
                          {isTabDup && duplicateCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full bg-red-500 text-[10px] text-white font-mono">
                              {duplicateCount}
                            </span>
                          )}
                          {isTabHealth && brokenCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full bg-red-500 text-[10px] text-white font-mono">
                              {brokenCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* 手机端：视图排版与列数下拉菜单 */}
            <div className="relative flex-shrink-0">
              <button
                onClick={() => setShowMobileLayoutMenu(prev => !prev)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-black/50 hover:bg-white/10 border border-white/10 text-xs font-bold text-gray-200 shadow-sm transition"
                title="视图与排版选项"
              >
                <LayoutGrid size={13} className="text-cyan-400" />
                <span>{effectiveGridColumns}列 · {viewLayout === 'poster' ? '海报' : viewLayout === 'backdrop' ? '剧照' : '列表'}</span>
                <ChevronDown size={12} className={`text-gray-400 transition-transform ${showMobileLayoutMenu ? 'rotate-180' : ''}`} />
              </button>

              {showMobileLayoutMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMobileLayoutMenu(false)} />
                  <div
                    className="absolute right-0 top-[calc(100%+6px)] z-50 w-64 bg-[#0d131f] border-2 border-cyan-400/60 rounded-2xl p-3 shadow-[0_20px_60px_rgba(0,0,0,0.95)] flex flex-col gap-3 text-xs animate-in fade-in zoom-in-95 duration-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* 视图布局 */}
                    {['items', 'duplicates'].includes(activeSubTab) && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[10px] text-cyan-300 font-bold">视图布局</span>
                        <div className="grid grid-cols-3 gap-1">
                          {[
                            { id: 'poster', label: '海报 (2:3)', icon: LayoutGrid },
                            { id: 'backdrop', label: '剧照 (16:9)', icon: Grid },
                            { id: 'list', label: '列表', icon: List }
                          ].map(l => (
                            <button
                              key={l.id}
                              onClick={() => {
                                setViewLayout(l.id);
                                setShowMobileLayoutMenu(false);
                              }}
                              className={`py-2 px-1 rounded-lg text-center flex flex-col items-center gap-1 transition ${
                                viewLayout === l.id
                                  ? 'bg-cyan-400 text-slate-950 font-extrabold shadow-md shadow-cyan-400/40'
                                  : 'bg-slate-800 text-gray-300 hover:bg-slate-700 border border-white/10'
                              }`}
                            >
                              <l.icon size={14} />
                              <span className="text-[10px]">{l.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 每行列数 */}
                    {showColumnsSlider && (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-cyan-300 font-bold">每行显示列数</span>
                          <span className="text-[11px] font-mono text-cyan-400 font-bold">{effectiveGridColumns} 列</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {[1, 2, 3, 4].map(cols => (
                            <button
                              key={cols}
                              onClick={() => {
                                if (isMediaGridTab) handleGridColumnsChange(cols);
                                else handleSecondaryGridColumnsChange(cols);
                                setShowMobileLayoutMenu(false);
                              }}
                              className={`py-1.5 rounded-lg text-xs font-bold text-center transition ${
                                effectiveGridColumns === cols
                                  ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/30'
                                  : 'bg-slate-800 text-gray-300 hover:bg-slate-700 border border-white/10'
                              }`}
                            >
                              {cols}列
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-2 text-xs min-w-0">
            <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0 no-scrollbar">
              {SUB_TABS.map(tab => {
                const Icon = tab.icon;
                const isDup = tab.id === 'duplicates';
                const isHealth = tab.id === 'health';
                return (
                  <button
                    key={tab.id}
                    onClick={() => handleSubTabChange(tab.id)}
                    className={`flex items-center gap-1 px-2 py-1 sm:px-2.5 rounded-lg font-medium transition flex-shrink-0 text-xs ${
                      activeSubTab === tab.id
                        ? (isDup || isHealth) ? 'bg-red-600/90 text-white shadow' : 'bg-slate-800 text-cyan-300 shadow'
                        : (isDup && duplicateCount > 0) || (isHealth && brokenCount > 0) ? 'text-red-400 hover:bg-red-950/40' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <Icon size={12} />
                    <span>{tab.label}</span>
                    {isDup && duplicateCount > 0 && (
                      <span className="px-1 py-0.5 rounded-full bg-red-500 text-[9px] text-white">
                        {duplicateCount}
                      </span>
                    )}
                    {isHealth && brokenCount > 0 && (
                      <span className="px-1 py-0.5 rounded-full bg-red-500 text-[9px] text-white">
                        {brokenCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              {/* 每行列数滑块（当前网格视图，按标签页独立记忆） */}
              {showColumnsSlider && (
                <div className="flex items-center gap-1.5 bg-black/50 px-2 py-1 rounded-xl border border-white/10 text-xs text-gray-300 flex-shrink-0">
                  <SlidersHorizontal size={12} className="text-cyan-400 flex-shrink-0" />
                  <input
                    type="range"
                    min={1}
                    max={12}
                    step={1}
                    value={effectiveGridColumns}
                    onChange={(e) => isMediaGridTab ? handleGridColumnsChange(e.target.value) : handleSecondaryGridColumnsChange(e.target.value)}
                    className="w-14 sm:w-20 accent-cyan-400 h-1.5 bg-white/20 rounded-lg cursor-pointer appearance-none"
                    title={`拖拽滑块调整当前视图每行数量 (当前: ${effectiveGridColumns} 列)`}
                  />
                  <span className="text-[10px] font-mono text-cyan-300 font-bold min-w-[24px] text-right">
                    {effectiveGridColumns}列
                  </span>
                </div>
              )}

              {/* 视图布局切换：海报 / 剧照缩略图 / 列表（影片/查重视图） */}
              {['items', 'duplicates'].includes(activeSubTab) && (
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
                    title="剧照缩略图网格 (16:9)"
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
              )}
            </div>
          </div>
        )}

        {/* Row 2/3: Search, Filters & Sorting Bar: Auto-resizing Search Bar tiling smoothly */}
        <div className="flex items-center gap-1.5 sm:gap-2 text-xs pt-0.5 min-w-0 flex-nowrap overflow-x-auto no-scrollbar">
          {/* Auto-expanding Search Input */}
          <div className="relative flex-1 min-w-[120px] sm:min-w-[180px] max-w-full sm:max-w-md flex-shrink">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="搜索视频 / 演员..."
              className="w-full pl-7 sm:pl-8 pr-6 py-1 sm:py-1.5 rounded-xl bg-black/50 border border-white/10 text-white text-xs placeholder-gray-500 focus:outline-none focus:border-cyan-400 focus:bg-black/80 transition"
            />
            {searchKeyword && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition"
              >
                <X size={11} />
              </button>
            )}
          </div>

          {/* 手机端：筛选下拉菜单（桌面端隐藏，防止按钮过多溢出） */}
          {isMobileViewport ? (
            <div className="relative flex-shrink-0">
              <button
                onClick={() => setShowMobileFilterMenu(prev => !prev)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition ${
                  hasActiveMobileFilters
                    ? 'bg-cyan-500/30 border-cyan-400/60 text-cyan-300 shadow-sm shadow-cyan-500/30'
                    : 'bg-black/40 border-white/10 text-gray-300 hover:text-cyan-300'
                }`}
                title="筛选"
              >
                <SlidersHorizontal size={12} />
                <span>筛选</span>
                {hasActiveMobileFilters && (
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                )}
              </button>

              {showMobileFilterMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowMobileFilterMenu(false)}
                  />
                  <div
                    className="absolute right-0 top-[calc(100%+8px)] z-50 w-72 bg-[#0d131f] border-2 border-cyan-400/60 rounded-2xl p-3.5 shadow-[0_20px_60px_rgba(0,0,0,0.95)] flex flex-col gap-3 text-xs animate-in fade-in zoom-in-95 duration-100 max-h-[70vh] overflow-y-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between border-b border-white/15 pb-2">
                      <span className="font-bold text-white text-sm flex items-center gap-1.5">
                        <SlidersHorizontal size={13} className="text-cyan-400" />
                        筛选选项
                      </span>
                      <button
                        onClick={() => setShowMobileFilterMenu(false)}
                        className="p-1 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {/* 播放状态 */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] text-cyan-300 font-bold">播放状态</span>
                      <div className="grid grid-cols-3 gap-1">
                        {STATUS_OPTIONS.map(f => {
                          const active = (statusFilter || 'all') === f.id;
                          return (
                            <button
                              key={f.id}
                              onClick={() => onStatusFilterChange(active && f.id !== 'all' ? 'all' : f.id)}
                              className={`py-1.5 rounded-lg text-[11px] text-center transition ${
                                active
                                  ? 'bg-cyan-400 text-slate-950 font-extrabold shadow-md shadow-cyan-400/40'
                                  : 'bg-slate-800 text-gray-300 hover:bg-slate-700 border border-white/10'
                              }`}
                            >
                              {f.label.replace(/^[^\u4e00-\u9fa5A-Za-z]+/, '')}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 收藏筛选 */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] text-cyan-300 font-bold">收藏</span>
                      <div className="grid grid-cols-3 gap-1">
                        {[
                          { id: 'all', label: '全部' },
                          { id: 'favorite', label: '最爱' },
                          { id: 'not_favorite', label: '非最爱' }
                        ].map(opt => {
                          const active =
                            (opt.id === 'all' && favoriteFilter === 'all') ||
                            (opt.id === 'favorite' && favoriteFilter === 'favorite') ||
                            (opt.id === 'not_favorite' && favoriteFilter === 'not_favorite');
                          return (
                            <button
                              key={opt.id}
                              onClick={() => setFavoriteFilter(opt.id)}
                              className={`py-1.5 rounded-lg text-[11px] text-center transition ${
                                active
                                  ? 'bg-cyan-400 text-slate-950 font-extrabold shadow-md shadow-cyan-400/40'
                                  : 'bg-slate-800 text-gray-300 hover:bg-slate-700 border border-white/10'
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 播放次数 */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] text-cyan-300 font-bold">播放次数</span>
                      <div className="grid grid-cols-3 gap-1">
                        {PLAY_COUNT_OPTIONS.map(opt => {
                          const active = playCountFilter === opt.id;
                          return (
                            <button
                              key={opt.id}
                              onClick={() => setPlayCountFilter(active ? 'all' : opt.id)}
                              className={`py-1.5 rounded-lg text-[11px] text-center transition ${
                                active
                                  ? 'bg-cyan-400 text-slate-950 font-extrabold shadow-md shadow-cyan-400/40'
                                  : 'bg-slate-800 text-gray-300 hover:bg-slate-700 border border-white/10'
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 仅显示重复影片 */}
                    <div className="flex items-center justify-between pt-1 border-t border-white/10">
                      <span className="text-[11px] text-gray-200 font-medium flex items-center gap-1">
                        <Layers size={11} className="text-red-400" />
                        <span>仅显示重复影片</span>
                      </span>
                      <button
                        onClick={() => setShowDuplicatesOnly(prev => !prev)}
                        className={`px-3 py-1 rounded-lg text-[11px] font-bold transition ${
                          showDuplicatesOnly
                            ? 'bg-red-600 text-white shadow'
                            : 'bg-slate-800 text-gray-300 hover:bg-slate-700 border border-white/10'
                        }`}
                      >
                        {showDuplicatesOnly ? `已开启 (${duplicateCount})` : '已关闭'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
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

              <div className="h-3.5 w-px bg-white/10 mx-0.5 flex-shrink-0" />

              {/* 仅显示重复影片 (U4) */}
              <button
                onClick={() => setShowDuplicatesOnly(prev => !prev)}
                className={`px-1.5 sm:px-2 py-1 rounded-lg transition flex-shrink-0 text-xs flex items-center gap-1 ${
                  showDuplicatesOnly
                    ? 'bg-red-600/90 text-white font-bold shadow'
                    : duplicateCount > 0
                      ? 'text-red-400 hover:text-red-300'
                      : 'text-gray-400 hover:text-white'
                }`}
                title={showDuplicatesOnly ? '取消仅显示重复影片' : `仅在当前列表中显示重复影片 (${duplicateCount} 部)`}
              >
                <Layers size={11} />
                <span>仅重复</span>
                {showDuplicatesOnly && duplicateCount > 0 && (
                  <span className="px-1 py-0.5 rounded-full bg-red-500 text-[9px] text-white font-mono">
                    {duplicateCount}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* Active Filter Chips（类型 / 年份 / 字母索引） */}
          {(selectedGenre || selectedYear || selectedLetter) && (
            <div className="flex items-center gap-1 flex-shrink-0">
              {selectedGenre && (
                <button
                  onClick={() => onSelectGenre('')}
                  className="flex items-center gap-1 px-2 py-1 rounded-xl bg-cyan-950/60 border border-cyan-500/40 text-cyan-300 text-xs font-medium hover:bg-cyan-900/60 transition"
                  title="清除类型筛选"
                >
                  <Tag size={10} />
                  <span>{selectedGenre}</span>
                  <X size={11} />
                </button>
              )}
              {selectedYear && (
                <button
                  onClick={() => onSelectYear('')}
                  className="flex items-center gap-1 px-2 py-1 rounded-xl bg-cyan-950/60 border border-cyan-500/40 text-cyan-300 text-xs font-medium hover:bg-cyan-900/60 transition"
                  title="清除年份筛选"
                >
                  <Calendar size={10} />
                  <span className="font-mono">{selectedYear}</span>
                  <X size={11} />
                </button>
              )}
              {selectedLetter && (
                <button
                  onClick={() => onSelectLetter('')}
                  className="flex items-center gap-1 px-2 py-1 rounded-xl bg-cyan-950/60 border border-cyan-500/40 text-cyan-300 text-xs font-medium hover:bg-cyan-900/60 transition"
                  title="清除字母索引"
                >
                  <span className="font-mono font-bold">{selectedLetter}</span>
                  <X size={11} />
                </button>
              )}
            </div>
          )}

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
        {/* A-Z 字母索引（仅影片视图） */}
        {activeSubTab === 'items' && (
          <div className="flex items-center gap-0.5 flex-wrap mb-2.5 sm:mb-3 bg-black/30 border border-white/5 rounded-xl px-1.5 py-1">
            <button
              onClick={() => onSelectLetter && onSelectLetter('')}
              className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold transition flex-shrink-0 ${
                !selectedLetter ? 'bg-slate-700 text-cyan-300' : 'text-gray-400 hover:text-white'
              }`}
              title="全部 (清除字母索引)"
            >
              全部
            </button>
            {LETTER_INDEXES.map(letter => {
              const active = selectedLetter === letter;
              return (
                <button
                  key={letter}
                  onClick={() => onSelectLetter && onSelectLetter(active ? '' : letter)}
                  className={`w-6 h-5 rounded-md text-[10px] font-mono font-bold transition flex-shrink-0 ${
                    active
                      ? 'bg-jf-accent text-slate-950 shadow'
                      : 'text-gray-400 hover:text-cyan-300 hover:bg-white/10'
                  }`}
                >
                  {letter}
                </button>
              );
            })}
          </div>
        )}

        {/* SUB-VIEW 0: Folder Browser（原始文件夹目录树逐层浏览） */}
        {activeSubTab === 'folder' && (
          <div className="flex flex-col gap-3">
            {/* 面包屑导航栏 */}
            <div className="flex items-center justify-between gap-2 p-2 px-3 rounded-xl bg-slate-900/60 border border-white/10 text-xs">
              <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                <button
                  onClick={() => {
                    if (selectedViewId && selectedViewId !== 'all') {
                      const root = userViews.find(v => v.Id === selectedViewId);
                      setFolderPathStack([{ id: selectedViewId, name: root?.Name || '根目录' }]);
                    } else {
                      setFolderPathStack([]);
                    }
                  }}
                  className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-bold"
                >
                  <Folder size={14} />
                  <span>{selectedViewId && selectedViewId !== 'all' ? (userViews.find(v => v.Id === selectedViewId)?.Name || '媒体库根目录') : '全部媒体库'}</span>
                </button>

                {folderPathStack.map((node, idx) => (
                  <div key={node.id} className="flex items-center gap-1.5">
                    <ChevronRight size={12} className="text-gray-600" />
                    {idx === folderPathStack.length - 1 ? (
                      <span className="font-bold text-white truncate max-w-[200px]">{node.name}</span>
                    ) : (
                      <button
                        onClick={() => setFolderPathStack(prev => prev.slice(0, idx + 1))}
                        className="text-gray-400 hover:text-cyan-300 truncate max-w-[150px]"
                      >
                        {node.name}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {folderPathStack.length > (selectedViewId && selectedViewId !== 'all' ? 1 : 0) && (
                <button
                  onClick={() => setFolderPathStack(prev => prev.slice(0, prev.length - 1))}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-gray-200 text-xs font-medium transition flex-shrink-0"
                >
                  <span>返回上一级</span>
                </button>
              )}
            </div>

            {/* 内容区域：加载中 / 空目录 / 目录内容 */}
            {isFolderLoading ? (
              <div className="flex items-center justify-center py-20 text-gray-500 gap-2">
                <RefreshCw size={18} className="animate-spin text-cyan-400" />
                <span>正在加载文件夹内容...</span>
              </div>
            ) : folderItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-3 py-20">
                <Folder size={48} className="text-gray-700" />
                <div className="text-sm">当前文件夹为空</div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {/* 1. 子文件夹区 */}
                {folderItems.some(it => it.IsFolder || it.Type === 'Folder' || it.Type === 'CollectionFolder') && (
                  <div className="flex flex-col gap-2">
                    <div className="text-[11px] font-bold text-gray-400 flex items-center gap-1.5">
                      <Folder size={12} className="text-cyan-400" />
                      <span>子文件夹 ({folderItems.filter(it => it.IsFolder || it.Type === 'Folder' || it.Type === 'CollectionFolder').length})</span>
                    </div>
                    <div
                      className="grid gap-2.5 sm:gap-3"
                      style={{ gridTemplateColumns: `repeat(${effectiveGridColumns}, minmax(0, 1fr))` }}
                    >
                      {folderItems
                        .filter(it => it.IsFolder || it.Type === 'Folder' || it.Type === 'CollectionFolder')
                        .map(folder => {
                          const folderPoster = jellyfin.getBestImageUrl(folder, { maxWidth: 300 });
                          return (
                            <div
                              key={folder.Id}
                              onClick={() => {
                                setFolderPathStack(prev => [...prev, { id: folder.Id, name: folder.Name }]);
                              }}
                              className="group flex flex-col bg-slate-900/50 hover:bg-slate-800/80 rounded-xl overflow-hidden border border-white/5 hover:border-cyan-500/40 hover:-translate-y-0.5 transition cursor-pointer shadow-lg"
                            >
                              <div className="aspect-[16/10] bg-black/60 overflow-hidden relative flex items-center justify-center">
                                {folderPoster ? (
                                  <img
                                    src={folderPoster}
                                    alt={folder.Name}
                                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                    className="w-full h-full object-cover group-hover:scale-105 transition"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-cyan-400/70 group-hover:text-cyan-300">
                                    <Folder size={38} />
                                  </div>
                                )}
                                {folder.ChildCount !== undefined && folder.ChildCount !== null && (
                                  <div className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-full bg-black/80 backdrop-blur-md border border-white/15 text-[10px] font-mono text-cyan-300">
                                    {folder.ChildCount} 项
                                  </div>
                                )}
                              </div>
                              <div className="p-2.5 flex flex-col gap-0.5">
                                <div className="text-xs font-bold text-white truncate group-hover:text-cyan-300 transition" title={folder.Name}>
                                  {folder.Name}
                                </div>
                                <div className="text-[10px] text-gray-500">文件夹</div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {/* 2. 视频文件区 */}
                {folderItems.some(it => !it.IsFolder && it.Type !== 'Folder' && it.Type !== 'CollectionFolder') && (
                  <div className="flex flex-col gap-2">
                    <div className="text-[11px] font-bold text-gray-400 flex items-center gap-1.5">
                      <Film size={12} className="text-cyan-400" />
                      <span>视频文件 ({folderItems.filter(it => !it.IsFolder && it.Type !== 'Folder' && it.Type !== 'CollectionFolder').length})</span>
                    </div>
                    {viewLayout === 'list' ? (
                      <div className="flex flex-col gap-2">
                        {folderItems
                          .filter(it => !it.IsFolder && it.Type !== 'Folder' && it.Type !== 'CollectionFolder')
                          .map(file => (
                            <MediaListRow
                              key={file.Id}
                              item={file}
                              isDuplicate={duplicateItemIds.has(file.Id)}
                              isSelected={selectedItemIds.has(file.Id)}
                              isSelecting={isSelecting}
                              isMobileViewport={isMobileViewport}
                              onToggleSelect={handleToggleSelect}
                              onPlay={onPlaySingleItem}
                              onPlayModal={onPlayModal}
                              onPlayVr={onPlayVr}
                              onToggleFavorite={handleToggleFavorite}
                              onTogglePlayed={handleTogglePlayed}
                              onOpenDetail={onOpenDetail}
                              onOpenMetadataEditor={onOpenMetadataEditor}
                              onOpenIdentify={onOpenIdentify}
                              onRefreshMetadata={handleRefreshMetadata}
                              onDelete={handleDelete}
                              onOpenActionSheet={(it) => setActionSheetItem(it)}
                            />
                          ))}
                      </div>
                    ) : (
                      <div
                        className="grid gap-2.5 sm:gap-3.5"
                        style={{ gridTemplateColumns: `repeat(${effectiveGridColumns}, minmax(0, 1fr))` }}
                      >
                        {folderItems
                          .filter(it => !it.IsFolder && it.Type !== 'Folder' && it.Type !== 'CollectionFolder')
                          .map(file => (
                            <MediaCard
                              key={file.Id}
                              item={file}
                              isDuplicate={duplicateItemIds.has(file.Id)}
                              viewLayout={viewLayout}
                              isSelected={selectedItemIds.has(file.Id)}
                              isSelecting={isSelecting}
                              isMobileViewport={isMobileViewport}
                              onToggleSelect={handleToggleSelect}
                              onPlay={onPlaySingleItem}
                              onPlayModal={onPlayModal}
                              onPlayVr={onPlayVr}
                              onToggleFavorite={handleToggleFavorite}
                              onTogglePlayed={handleTogglePlayed}
                              onOpenDetail={onOpenDetail}
                              onOpenMetadataEditor={onOpenMetadataEditor}
                              onOpenIdentify={onOpenIdentify}
                              onRefreshMetadata={handleRefreshMetadata}
                              onDelete={handleDelete}
                              onOpenActionSheet={(it) => setActionSheetItem(it)}
                            />
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* SUB-VIEW 1: Genres */}
        {activeSubTab === 'genres' && (
          <div className="grid gap-2.5 sm:gap-3" style={{ gridTemplateColumns: `repeat(${effectiveGridColumns}, minmax(0, 1fr))` }}>
            {genresList.map(genre => (
              <div
                key={genre.Id}
                  onClick={() => {
                    onSelectGenre(genre.Name);
                    handleSubTabChange('items');
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

        {/* SUB-VIEW 2: Persons（仅演员，按出演数量排序，大图卡片） */}
        {activeSubTab === 'persons' && (
          <div className="grid gap-3 sm:gap-4" style={{ gridTemplateColumns: `repeat(${effectiveGridColumns}, minmax(0, 1fr))` }}>
            {personsDisplayList.map(person => {
              const imgUrl = jellyfin.getImageUrl(person.Id, person.ImageTags?.Primary, 'Primary', 400, 85);
              return (
                <div
                  key={person.Id}
                  onClick={() => {
                    onSearchChange(person.Name);
                    handleSubTabChange('items');
                  }}
                  className="group flex flex-col bg-slate-900/50 rounded-2xl overflow-hidden border border-white/5 hover:border-cyan-500/40 hover:-translate-y-1 hover:shadow-xl hover:shadow-cyan-500/10 transition cursor-pointer"
                  title={`查看 ${person.Name} 的作品${person.count ? `（出演 ${person.count} 部）` : ''}`}
                >
                  <div className="relative aspect-square bg-black/60 overflow-hidden">
                    {imgUrl ? (
                      <img src={imgUrl} alt={person.Name} className="w-full h-full object-cover group-hover:scale-105 transition" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-600"><Users size={36} /></div>
                    )}
                    {person.count > 0 && (
                      <div className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-full bg-black/80 backdrop-blur-md border border-cyan-500/40 text-[10px] font-mono font-bold text-cyan-300 shadow-lg">
                        {person.count} 部
                      </div>
                    )}
                  </div>
                  <div className="p-2 sm:p-2.5 text-center">
                    <span className="text-xs sm:text-sm font-semibold text-white truncate w-full block group-hover:text-cyan-300 transition">
                      {person.Name}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* SUB-VIEW 3: Collections */}
        {activeSubTab === 'collections' && (
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${effectiveGridColumns}, minmax(0, 1fr))` }}>
            {collectionsList.map(col => {
              const imgUrl = jellyfin.getImageUrl(col.Id, col.ImageTags?.Primary, 'Primary', 300, 80);
              return (
                <div
                  key={col.Id}
                  onClick={() => {
                    onSelectView(col.Id);
                    handleSubTabChange('items');
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

        {/* SUB-VIEW 3.5: Years（年份标签页，点击按年份筛选影片） */}
        {activeSubTab === 'years' && (
          yearsList.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-3 py-20">
              <Calendar size={40} className="text-gray-700" />
              <div className="text-sm">暂无年份数据</div>
            </div>
          ) : (
            <div className="grid gap-2.5 sm:gap-3" style={{ gridTemplateColumns: `repeat(${effectiveGridColumns}, minmax(0, 1fr))` }}>
              {yearsList.map(year => (
                <div
                  key={year.Id}
                  onClick={() => {
                    onSelectYear && onSelectYear(year.Name);
                    handleSubTabChange('items');
                  }}
                  className={`p-3 sm:p-4 rounded-xl border flex items-center justify-between cursor-pointer transition shadow-lg ${
                    String(selectedYear) === String(year.Name)
                      ? 'bg-cyan-950/80 border-cyan-400 text-cyan-200'
                      : 'bg-slate-900/60 hover:bg-slate-800/90 border-white/5 hover:border-cyan-500/40'
                  }`}
                >
                  <span className="font-bold font-mono text-sm sm:text-base text-white">{year.Name}</span>
                  <ChevronRight size={14} className="text-gray-500" />
                </div>
              ))}
            </div>
          )
        )}

        {/* SUB-VIEW 3.6: 继续观看（带进度条的断点续播列表） */}
        {activeSubTab === 'resume' && (
          resumeList.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-3 py-20">
              <RotateCcw size={40} className="text-gray-700" />
              <div className="text-sm">暂未观看 / 没有看到一半的影片</div>
            </div>
          ) : (
            <div className="grid gap-2.5 sm:gap-3.5" style={{ gridTemplateColumns: `repeat(${effectiveGridColumns}, minmax(0, 1fr))` }}>
              {resumeList.map(item => {
                const resumePercent = item.UserData?.PlaybackPositionTicks && item.RunTimeTicks
                  ? Math.min(100, (item.UserData.PlaybackPositionTicks / item.RunTimeTicks) * 100)
                  : 0;
                const poster = jellyfin.getBestImageUrl(item, { maxWidth: 360 });
                return (
                  <div
                    key={item.Id}
                    onClick={() => onPlayModal && onPlayModal(item)}
                    className="group cursor-pointer rounded-xl overflow-hidden bg-slate-900/50 border border-white/5 hover:border-cyan-500/40 hover:-translate-y-1 transition"
                    title={`继续播放 ${item.Name}`}
                  >
                    <div className="relative aspect-[2/3] bg-black overflow-hidden">
                      <div className="absolute inset-0 flex items-center justify-center text-gray-600"><Film size={28} /></div>
                      {poster && (
                        <img
                          src={poster}
                          alt={item.Name}
                          loading="lazy"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          className="relative w-full h-full object-cover group-hover:scale-105 transition"
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                        <div className="w-10 h-10 rounded-full bg-cyan-500/90 flex items-center justify-center text-white shadow-xl">
                          <Play size={18} className="ml-0.5 fill-white" />
                        </div>
                      </div>
                      {/* Resume Progress Line */}
                      {resumePercent > 0 && (
                        <div className="absolute bottom-0 inset-x-0 h-1.5 bg-white/20">
                          <div className="h-full bg-cyan-400" style={{ width: `${resumePercent}%` }} />
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-xs font-semibold text-white truncate group-hover:text-cyan-300">{item.Name}</div>
                      <div className="text-[10px] text-cyan-300 font-mono mt-0.5">
                        看到 {Math.round(resumePercent)}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* SUB-VIEW 3.7: NextUp（下一集待看） */}
        {activeSubTab === 'nextup' && (
          nextUpList.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-3 py-20">
              <Zap size={40} className="text-gray-700" />
              <div className="text-sm">暂无待看的下一集</div>
            </div>
          ) : (
            <div className="grid gap-2.5 sm:gap-3.5" style={{ gridTemplateColumns: `repeat(${effectiveGridColumns}, minmax(0, 1fr))` }}>
              {nextUpList.map(item => {
                const poster = jellyfin.getBestImageUrl(item, { maxWidth: 360 });
                const epLabel = `${item.ParentIndexNumber !== undefined && item.ParentIndexNumber !== null ? `S${String(item.ParentIndexNumber).padStart(2, '0')}` : ''}${item.IndexNumber !== undefined && item.IndexNumber !== null ? `E${String(item.IndexNumber).padStart(2, '0')}` : ''}`;
                return (
                  <div
                    key={item.Id}
                    onClick={() => onPlayModal && onPlayModal(item)}
                    className="group cursor-pointer rounded-xl overflow-hidden bg-slate-900/50 border border-white/5 hover:border-amber-500/40 hover:-translate-y-1 transition"
                  >
                    <div className="relative aspect-[2/3] bg-black overflow-hidden">
                      <div className="absolute inset-0 flex items-center justify-center text-gray-600"><Film size={28} /></div>
                      {poster && (
                        <img
                          src={poster}
                          alt={item.Name}
                          loading="lazy"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          className="relative w-full h-full object-cover group-hover:scale-105 transition"
                        />
                      )}
                      {epLabel && (
                        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-amber-500/90 text-slate-950 text-[9px] font-mono font-black">
                          {epLabel}
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-[10px] text-amber-300 font-bold truncate">{item.SeriesName || '剧集'}</div>
                      <div className="text-xs font-semibold text-white truncate group-hover:text-amber-300 mt-0.5">{item.Name}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* SUB-VIEW 3.8: 观看历史（海报模式，按最后播放时间排序） */}
        {activeSubTab === 'history' && (
          historyList.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-3 py-20">
              <History size={40} className="text-gray-700" />
              <div className="text-sm">暂无观看历史</div>
            </div>
          ) : (
            <div className="grid gap-2.5 sm:gap-3.5" style={{ gridTemplateColumns: `repeat(${effectiveGridColumns}, minmax(0, 1fr))` }}>
              {historyList.map(item => {
                const lastPlayed = item.UserData?.LastPlayedDate
                  ? new Date(item.UserData.LastPlayedDate)
                  : null;
                const poster = jellyfin.getBestImageUrl(item, { maxWidth: 360 });
                const epLabel = `${item.ParentIndexNumber !== undefined && item.ParentIndexNumber !== null ? `S${String(item.ParentIndexNumber).padStart(2, '0')}` : ''}${item.IndexNumber !== undefined && item.IndexNumber !== null ? `E${String(item.IndexNumber).padStart(2, '0')}` : ''}`;
                const playedText = lastPlayed
                  ? `${lastPlayed.toLocaleDateString()} ${lastPlayed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : '';
                const isToday = lastPlayed ? new Date().toDateString() === lastPlayed.toDateString() : false;
                return (
                  <div
                    key={`${item.Id}-${item.UserData?.LastPlayedDate || ''}`}
                    onClick={() => onPlayModal && onPlayModal(item)}
                    className="group cursor-pointer rounded-xl overflow-hidden bg-slate-900/50 border border-white/5 hover:border-cyan-500/40 hover:-translate-y-1 transition"
                    title={`播放 ${item.SeriesName && epLabel ? `${item.SeriesName} ${epLabel} · ${item.Name}` : item.Name}`}
                  >
                    <div className="relative aspect-[2/3] bg-black overflow-hidden">
                      <div className="absolute inset-0 flex items-center justify-center text-gray-600"><Film size={28} /></div>
                      {poster && (
                        <img
                          src={poster}
                          alt={item.Name}
                          loading="lazy"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          className="relative w-full h-full object-cover group-hover:scale-105 transition"
                        />
                      )}
                      {epLabel && (
                        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/75 border border-cyan-500/40 text-cyan-300 text-[9px] font-mono font-black">
                          {epLabel}
                        </div>
                      )}
                      {/* 悬停播放遮罩 + 最后播放时间 */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-1.5">
                        <div className="w-10 h-10 rounded-full bg-cyan-500/90 flex items-center justify-center text-white shadow-xl">
                          <Play size={18} className="ml-0.5 fill-white" />
                        </div>
                        {playedText && (
                          <div className="px-2 py-0.5 rounded-full bg-black/85 border border-white/20 text-[9px] font-mono text-cyan-200">
                            {playedText}
                          </div>
                        )}
                      </div>
                      {/* 观看次数角标 */}
                      {(item.UserData?.PlayCount || 0) > 1 && (
                        <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 border border-white/10 text-[9px] font-mono text-amber-300">
                          {item.UserData.PlayCount}次
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-xs font-semibold text-white truncate group-hover:text-cyan-300">
                        {item.SeriesName && epLabel ? item.Name : item.Name}
                      </div>
                      <div className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
                        {isToday ? (
                          <span className="text-cyan-300 font-bold">今天看过</span>
                        ) : (
                          <span className="font-mono">{lastPlayed ? lastPlayed.toLocaleDateString() : ''}</span>
                        )}
                        {item.SeriesName && <span className="truncate text-amber-300/80">· {item.SeriesName}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* SUB-VIEW 4: Items Grid / List View / Duplicates / Health */}
        {['items', 'duplicates', 'health'].includes(activeSubTab) && (
          <>
            {displayItems.length === 0 && !isRefreshing ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-3 py-20">
                {activeSubTab === 'health' ? (
                  <>
                    <ShieldAlert size={48} className="text-emerald-500/80" />
                    <div className="text-sm text-emerald-300 font-bold">全库未发现损坏/截断文件，媒体文件均健康！</div>
                  </>
                ) : (
                  <>
                    <Film size={48} className="text-gray-700 animate-pulse" />
                    <div className="text-sm">没有找到符合当前筛选条件的媒体</div>
                  </>
                )}
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
                    isMobileViewport={isMobileViewport}
                    onToggleSelect={handleToggleSelect}
                    onPlay={onPlaySingleItem}
                    onPlayModal={onPlayModal}
                    onPlayVr={onPlayVr}
                    onToggleFavorite={handleToggleFavorite}
                    onTogglePlayed={handleTogglePlayed}
                    onOpenDetail={onOpenDetail}
                    onOpenMetadataEditor={onOpenMetadataEditor}
                    onOpenIdentify={onOpenIdentify}
                    onRefreshMetadata={handleRefreshMetadata}
                    onDelete={handleDelete}
                    onUpdateItem={onUpdateItem}
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
                    isMobileViewport={isMobileViewport}
                    onToggleSelect={handleToggleSelect}
                    onPlay={onPlaySingleItem}
                    onPlayModal={onPlayModal}
                    onPlayVr={onPlayVr}
                    onToggleFavorite={handleToggleFavorite}
                    onTogglePlayed={handleTogglePlayed}
                    onOpenDetail={onOpenDetail}
                    onOpenMetadataEditor={onOpenMetadataEditor}
                    onOpenIdentify={onOpenIdentify}
                    onRefreshMetadata={handleRefreshMetadata}
                    onDelete={handleDelete}
                    onUpdateItem={onUpdateItem}
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
        onPlay={onPlayModal || onPlaySingleItem}
        onPlayVr={onPlayVr}
        onOpenFloating={onOpenFloatingWindow || onPlaySingleItem}
        onOpenDetail={onOpenDetail}
        onToggleFavorite={handleToggleFavorite}
        onTogglePlayed={handleTogglePlayed}
        onOpenMetadataEditor={onOpenMetadataEditor}
        onOpenIdentify={onOpenIdentify}
        onRefreshMetadata={handleRefreshMetadata}
        onDelete={handleDelete}
        onUpdateItem={onUpdateItem}
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
