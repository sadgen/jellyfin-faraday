import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { jellyfin } from '../api/jellyfinClient';
import { getTrickplayStyle } from '../utils/trickplay';
import { detectDuplicateMedia } from '../utils/duplicateChecker';
import { useExternalPlayer } from '../hooks/useExternalPlayer';
import MobileActionSheet from './MobileActionSheet';
import { 
  Play, Shuffle, Star, Eye, EyeOff, Search, 
  Edit3, Sparkles, Trash2, Folder, Film, 
  ArrowUpDown, X, RefreshCw, Layers, LayoutGrid,
  Grid, List, MoreVertical, ExternalLink, Calendar,
  Users, Tag, Check, ChevronRight, Tv
} from 'lucide-react';

const ALPHABET = ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

const SUB_TABS = [
  { id: 'items', label: '影片', icon: Film },
  { id: 'genres', label: '类型', icon: Tag },
  { id: 'persons', label: '演职员', icon: Users },
  { id: 'years', label: '年份', icon: Calendar },
  { id: 'collections', label: '合集', icon: Layers },
  { id: 'duplicates', label: '查重清理', icon: Layers }
];

const BASE_STATUS_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'unplayed', label: '👀 未播' },
  { id: 'played', label: '✅ 已播' },
  { id: 'favorites', label: '⭐ 最爱' }
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
 * - In Poster mode (2:3): Pops up a large 260x146 Trickplay preview ABOVE the poster!
 * - In Backdrop mode (16:9): Renders inside the 16:9 card.
 */
function MediaCard({
  item,
  isDuplicate,
  viewLayout = 'poster',
  onPlay,
  onPlayModal,
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

  const handleCoverMouseMove = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPercent(percent);
    setTrickplayTime(durationSec * percent);
  }, [durationSec]);

  const handleCoverMouseLeave = useCallback(() => {
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
      className={`group relative flex flex-col bg-slate-900/50 rounded-xl transition-all duration-300 transform hover:-translate-y-1 select-none ${
        isDuplicate 
          ? 'border border-red-500/60 shadow-lg shadow-red-500/10' 
          : 'border border-white/5 hover:border-cyan-500/40 hover:shadow-xl hover:shadow-cyan-500/10'
      }`}
    >
      {/* 
        POSTER MODE: Large Floating Trickplay Preview Window ABOVE the card 
        (Avoids narrow poster width constraints, completely uncompressed & large)
      */}
      {!isBackdrop && tpStyle && (
        <div className="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 z-50 flex flex-col items-center pointer-events-none animate-in fade-in zoom-in-95 duration-100">
          <div className="w-[260px] h-[146px] rounded-xl overflow-hidden bg-black/95 border-2 border-cyan-400 shadow-2xl shadow-cyan-500/30 flex items-center justify-center relative">
            <div className="w-full h-full" style={tpStyle} />
            <div className="absolute bottom-2 bg-black/85 backdrop-blur-md px-3 py-1 rounded-full text-xs font-mono font-bold text-cyan-300 border border-white/20 shadow-lg">
              {formatTime(trickplayTime)}
            </div>
          </div>
          <div className="w-0 h-0 border-x-6 border-x-transparent border-t-6 border-t-cyan-400 mt-0.5" />
        </div>
      )}

      {/* Poster / Backdrop Canvas */}
      <div 
        className={`relative w-full bg-black rounded-t-xl overflow-hidden cursor-pointer flex items-center justify-center ${
          isBackdrop ? 'aspect-video' : 'aspect-[2/3]'
        }`}
        onClick={() => onPlay(item)}
        onMouseMove={handleCoverMouseMove}
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

        {/* BACKDROP MODE: Inside 16:9 Card */}
        {isBackdrop && tpStyle && (
          <div className="absolute inset-0 bg-black flex items-center justify-center overflow-hidden pointer-events-none">
            <div 
              className="w-full aspect-video relative shadow-2xl"
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
          <div className="absolute bottom-0 inset-x-0 h-1 bg-white/20 z-20 pointer-events-none">
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
        <div className="absolute inset-x-2 bottom-2 z-30 flex items-center justify-between opacity-80 md:opacity-0 group-hover:opacity-100 transition-opacity duration-200">
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
            <span className="px-1 py-0.2 bg-white/10 rounded text-[9px] font-mono text-gray-300">
              {item.OfficialRating}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Detailed List Row View
 */
function MediaListRow({
  item,
  isDuplicate,
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

  return (
    <div 
      onClick={() => onPlay(item)}
      className="group flex items-center justify-between p-2.5 px-3 sm:px-4 bg-slate-900/40 hover:bg-slate-800/80 border border-white/5 hover:border-cyan-500/40 rounded-xl transition cursor-pointer text-xs"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
        <div className="relative w-8 h-12 sm:w-9 sm:h-13 rounded-lg overflow-hidden bg-black/60 border border-white/10 flex-shrink-0">
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
}

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
  selectedLetter,
  onSelectLetter,
  onEnterKanban,
  onOpenRandom3Windows,
  onPlaySingleItem,
  onPlayModal,
  onUpdateItem,
  onDeleteItem,
  onOpenMetadataEditor,
  onOpenIdentify,
  onRefreshLibrary,
  isRefreshing
}) {
  const [activeSubTab, setActiveSubTab] = useState('items');
  const [viewLayout, setViewLayout] = useState('poster');
  const [actionSheetItem, setActionSheetItem] = useState(null);
  
  // Secondary metadata state
  const [genresList, setGenresList] = useState([]);
  const [personsList, setPersonsList] = useState([]);
  const [collectionsList, setCollectionsList] = useState([]);

  // Duplicate detection across current items
  const { duplicateItemIds, duplicateCount } = useMemo(() => {
    return detectDuplicateMedia(items);
  }, [items]);

  // Load sub-tab data on demand
  useEffect(() => {
    if (!jellyfin.auth.isConfigured) return;

    if (activeSubTab === 'genres') {
      jellyfin.getGenres(selectedViewId).then(list => setGenresList(list || []));
    } else if (activeSubTab === 'persons') {
      jellyfin.getPersons(selectedViewId).then(list => setPersonsList(list || []));
    } else if (activeSubTab === 'collections') {
      jellyfin.getCollections(selectedViewId).then(list => setCollectionsList(list || []));
    }
  }, [activeSubTab, selectedViewId]);

  // Display items
  const displayItems = useMemo(() => {
    if (activeSubTab === 'duplicates' || statusFilter === 'duplicates') {
      return items.filter(it => duplicateItemIds.has(it.Id));
    }
    return items;
  }, [items, activeSubTab, statusFilter, duplicateItemIds]);

  // Favorite toggle
  const handleToggleFavorite = async (item) => {
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
  };

  // Played toggle
  const handleTogglePlayed = async (item) => {
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
  };

  // Refresh metadata
  const handleRefreshMetadata = async (item) => {
    try {
      await jellyfin.refreshItemMetadata(item.Id);
      alert(`已向 Jellyfin 发送刷新「${item.Name}」元数据请求`);
    } catch (err) {
      alert('刷新失败: ' + err.message);
    }
  };

  // Delete item
  const handleDelete = async (item) => {
    if (!confirm(`确定要从媒体库和磁盘中永久删除「${item.Name}」吗？`)) return;
    try {
      await jellyfin.deleteItem(item.Id);
      if (onDeleteItem) onDeleteItem(item.Id);
    } catch (err) {
      alert(err.message || '删除失败');
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#080b11] text-gray-100 overflow-hidden select-none">
      
      {/* Top Navigation Bar */}
      <div className="border-b border-white/5 bg-slate-950/90 backdrop-blur-md px-3 sm:px-5 py-2.5 sm:py-3 flex flex-col gap-2.5 z-30 pt-[max(0.5rem,env(safe-area-inset-top))]">
        
        {/* Row 1: Primary Library Tabs, Random 3 Windows & Kanban Launcher */}
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 flex-1 min-w-0">
            {userViews.map(view => (
              <button
                key={view.Id}
                onClick={() => onSelectView(view.Id)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex-shrink-0 ${
                  selectedViewId === view.Id
                    ? 'bg-jf-accent text-white shadow-lg shadow-cyan-500/25 scale-[1.02]'
                    : 'bg-black/40 hover:bg-white/10 text-gray-300 border border-white/5'
                }`}
              >
                <Folder size={13} className={selectedViewId === view.Id ? 'text-white' : 'text-cyan-400'} />
                <span>{view.Name}</span>
              </button>
            ))}

            <button
              onClick={() => onSelectView('all')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium transition flex-shrink-0 ${
                selectedViewId === 'all'
                  ? 'bg-jf-accent text-white shadow-lg shadow-cyan-500/25'
                  : 'bg-black/40 hover:bg-white/10 text-gray-400 border border-white/5'
              }`}
              title="跨库全量浏览 (全部媒体)"
            >
              <Film size={12} />
              <span>全部媒体</span>
            </button>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Tampermonkey 随机3窗 Launcher */}
            <button
              onClick={onOpenRandom3Windows}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-bold shadow-lg transition transform hover:scale-[1.02]"
              title="复刻油猴脚本：开启 1大+2小 经典非对称 3 独立悬浮播放窗"
            >
              <Tv size={13} className="text-amber-400" />
              <span>随机3窗</span>
            </button>

            {/* Kanban Mode Launcher */}
            <button
              onClick={onEnterKanban}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/25 transition transform hover:scale-[1.02]"
              title="开启全屏随机多视口看板"
            >
              <Shuffle size={13} />
              <span className="hidden sm:inline">随机看板</span>
              <span className="font-mono text-[11px]">({totalRecordCount > 0 ? totalRecordCount : displayItems.length})</span>
            </button>
          </div>
        </div>

        {/* Row 2: Secondary Sub-Tabs */}
        <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-2 text-xs">
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
                    <span className="px-1 py-0.2 rounded-full bg-red-500 text-[9px] text-white">
                      {duplicateCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

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

        {/* Row 3: Search, Filters & Sorting Bar */}
        <div className="flex items-center justify-between gap-2 text-xs pt-0.5 flex-wrap">
          <div className="relative min-w-[140px] flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="搜索片名、演员..."
              className="w-full pl-8 pr-7 py-1 rounded-xl bg-black/50 border border-white/10 text-white text-xs placeholder-gray-500 focus:outline-none focus:border-cyan-400 transition"
            />
            {searchKeyword && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex items-center bg-black/40 p-0.5 rounded-xl border border-white/5 gap-0.5 overflow-x-auto">
            {BASE_STATUS_FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => onStatusFilterChange(f.id)}
                className={`px-2 py-1 rounded-lg transition flex-shrink-0 text-xs ${
                  statusFilter === f.id
                    ? 'bg-slate-700 text-cyan-300 font-medium shadow'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 bg-black/40 px-2 py-1 rounded-xl border border-white/5 text-gray-300 text-xs">
            <ArrowUpDown size={12} className="text-cyan-400" />
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

          <button
            onClick={onRefreshLibrary}
            disabled={isRefreshing}
            className="p-1.5 rounded-xl bg-black/40 hover:bg-white/10 border border-white/5 text-gray-400 hover:text-white transition disabled:opacity-50"
            title="刷新数据"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin text-cyan-400' : ''} />
          </button>
        </div>

        {/* Row 4: A-Z Alphabet Scrubber */}
        <div className="flex items-center justify-between gap-1 overflow-x-auto py-0.5 border-t border-white/5 text-[10px] font-mono text-gray-400">
          <button
            onClick={() => onSelectLetter('')}
            className={`px-1 py-0.2 rounded hover:text-white transition flex-shrink-0 ${
              !selectedLetter ? 'bg-cyan-500/20 text-cyan-300 font-bold' : ''
            }`}
          >
            ALL
          </button>
          {ALPHABET.map(letter => (
            <button
              key={letter}
              onClick={() => onSelectLetter(selectedLetter === letter ? '' : letter)}
              className={`px-1 py-0.2 rounded hover:text-white hover:bg-white/10 transition flex-shrink-0 ${
                selectedLetter === letter ? 'bg-jf-accent text-white font-bold' : ''
              }`}
            >
              {letter}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Viewport */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-5 pb-24 md:pb-20">
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
                {displayItems.map(item => (
                  <MediaListRow
                    key={item.Id}
                    item={item}
                    isDuplicate={duplicateItemIds.has(item.Id)}
                    onPlay={onPlaySingleItem}
                    onToggleFavorite={handleToggleFavorite}
                    onTogglePlayed={handleTogglePlayed}
                    onOpenMetadataEditor={onOpenMetadataEditor}
                    onOpenActionSheet={(it) => setActionSheetItem(it)}
                  />
                ))}
              </div>
            ) : (
              <div className={`grid gap-2.5 sm:gap-3.5 ${
                viewLayout === 'backdrop'
                  ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
                  : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
              }`}>
                {displayItems.map(item => (
                  <MediaCard
                    key={item.Id}
                    item={item}
                    isDuplicate={duplicateItemIds.has(item.Id)}
                    viewLayout={viewLayout}
                    onPlay={onPlaySingleItem}
                    onPlayModal={onPlayModal}
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

      {/* Mobile Action Sheet Drawer */}
      <MobileActionSheet
        isOpen={!!actionSheetItem}
        item={actionSheetItem}
        onClose={() => setActionSheetItem(null)}
        onPlay={onPlaySingleItem}
        onToggleFavorite={handleToggleFavorite}
        onTogglePlayed={handleTogglePlayed}
        onOpenMetadataEditor={onOpenMetadataEditor}
        onOpenIdentify={onOpenIdentify}
        onRefreshMetadata={handleRefreshMetadata}
        onDelete={handleDelete}
      />
    </div>
  );
}
