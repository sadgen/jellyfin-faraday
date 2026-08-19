import React, { useState, useMemo, useEffect } from 'react';
import { jellyfin } from '../api/jellyfinClient';
import { 
  Play, Shuffle, Star, Eye, EyeOff, Search, 
  Edit3, Sparkles, Trash2, Filter, Folder, Film, 
  ArrowUpDown, Check, X, RefreshCw
} from 'lucide-react';

const STATUS_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'favorites', label: '⭐ 仅最爱' },
  { id: 'unplayed', label: '👀 仅未看' },
  { id: 'played', label: '✅ 仅已看' },
];

const SORT_OPTIONS = [
  { id: 'date_desc', label: '最新入库' },
  { id: 'name_asc', label: '名称 A-Z' },
  { id: 'rating_desc', label: '评分最高' },
  { id: 'playcount_asc', label: '最少播放' },
  { id: 'playcount_desc', label: '最多播放' },
];

export default function LibraryView({
  items = [],
  userViews = [],
  selectedViewId,
  onSelectView,
  searchKeyword,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  sortMethod,
  onSortMethodChange,
  onEnterKanban,
  onPlaySingleItem,
  onUpdateItem,
  onDeleteItem,
  onOpenMetadataEditor,
  onOpenIdentify,
  onRefreshLibrary,
  isRefreshing
}) {
  // Toggle Favorite
  const handleToggleFavorite = async (e, item) => {
    e.stopPropagation();
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

  // Toggle Played Status
  const handleTogglePlayed = async (e, item) => {
    e.stopPropagation();
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

  // Delete Item
  const handleDelete = async (e, item) => {
    e.stopPropagation();
    if (!confirm(`确定要从媒体库和磁盘中永久删除「${item.Name}」吗？`)) return;
    try {
      await jellyfin.deleteItem(item.Id);
      if (onDeleteItem) onDeleteItem(item.Id);
    } catch (err) {
      alert(err.message || '删除失败');
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#080b11] text-gray-100 overflow-hidden">
      
      {/* Top Filter & Toolbar */}
      <div className="p-4 border-b border-white/5 bg-slate-900/60 backdrop-blur-md flex flex-col gap-3.5 z-20">
        
        {/* Row 1: Libraries / Views tabs & Main Action */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* User Views / Categories Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 max-w-full">
            <button
              onClick={() => onSelectView('all')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition flex-shrink-0 ${
                selectedViewId === 'all'
                  ? 'bg-jf-accent text-white shadow-lg shadow-cyan-500/20'
                  : 'bg-black/40 hover:bg-white/10 text-gray-300 border border-white/5'
              }`}
            >
              <Film size={13} />
              <span>全部媒体库</span>
            </button>

            {userViews.map(view => (
              <button
                key={view.Id}
                onClick={() => onSelectView(view.Id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition flex-shrink-0 ${
                  selectedViewId === view.Id
                    ? 'bg-jf-accent text-white shadow-lg shadow-cyan-500/20'
                    : 'bg-black/40 hover:bg-white/10 text-gray-300 border border-white/5'
                }`}
              >
                <Folder size={13} />
                <span>{view.Name}</span>
              </button>
            ))}
          </div>

          {/* Enter Kanban Mode Button */}
          <button
            onClick={onEnterKanban}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/25 transition transform hover:scale-[1.02] flex-shrink-0"
            title="以多视口随机看板播放当前筛选出的媒体"
          >
            <Shuffle size={14} />
            <span>开启随机看板 ({items.length} 部)</span>
          </button>
        </div>

        {/* Row 2: Search, Status Filter & Sorting */}
        <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
          
          {/* Search Input */}
          <div className="relative min-w-[220px] max-w-xs flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="搜索影片名称、演员、年份..."
              className="w-full pl-9 pr-8 py-1.5 rounded-xl bg-black/50 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400 transition"
            />
            {searchKeyword && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Status Filters */}
          <div className="flex items-center bg-black/40 p-1 rounded-xl border border-white/5 gap-0.5">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => onStatusFilterChange(f.id)}
                className={`px-2.5 py-1 rounded-lg transition ${
                  statusFilter === f.id
                    ? 'bg-slate-700 text-cyan-300 font-medium shadow'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Sort Selector */}
          <div className="flex items-center gap-1.5 bg-black/40 px-2.5 py-1 rounded-xl border border-white/5 text-gray-300">
            <ArrowUpDown size={13} className="text-cyan-400" />
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

          {/* Resync Button */}
          <button
            onClick={onRefreshLibrary}
            disabled={isRefreshing}
            className="p-2 rounded-xl bg-black/40 hover:bg-white/10 border border-white/5 text-gray-400 hover:text-white transition disabled:opacity-50"
            title="同步媒体库"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin text-cyan-400' : ''} />
          </button>
        </div>
      </div>

      {/* Media Cards Grid */}
      <div className="flex-1 overflow-y-auto p-4 pb-20">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-3">
            <Film size={48} className="text-gray-700 animate-pulse" />
            <div className="text-sm">没有找到符合当前筛选条件的媒体</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3.5">
            {items.map(item => {
              const posterUrl = jellyfin.getImageUrl(item.Id, item.ImageTags?.Primary, 'Primary', 400);
              const isFavorite = !!item.UserData?.IsFavorite;
              const isPlayed = !!item.UserData?.Played;
              const playCount = item.UserData?.PlayCount || 0;

              return (
                <div
                  key={item.Id}
                  className="group relative flex flex-col bg-slate-900/40 rounded-xl overflow-hidden border border-white/5 hover:border-cyan-500/40 hover:shadow-xl hover:shadow-cyan-500/10 transition-all duration-300 transform hover:-translate-y-1"
                >
                  {/* Poster Image Container */}
                  <div className="relative w-full aspect-[2/3] bg-black/60 overflow-hidden">
                    {posterUrl ? (
                      <img
                        src={posterUrl}
                        alt={item.Name}
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-600">
                        <Film size={32} />
                      </div>
                    )}

                    {/* Play Count Badge (Top-Left) */}
                    <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-mono text-cyan-300">
                      <Eye size={11} className="text-cyan-400" />
                      <span>{playCount}</span>
                    </div>

                    {/* Community Rating (Top-Right) */}
                    {item.CommunityRating && (
                      <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-mono text-amber-300">
                        <Star size={10} className="fill-amber-400 text-amber-400" />
                        <span>{item.CommunityRating.toFixed(1)}</span>
                      </div>
                    )}

                    {/* Hover Quick Actions Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-between p-2.5">
                      
                      {/* Top Action Row */}
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={(e) => handleToggleFavorite(e, item)}
                          className={`p-1.5 rounded-lg backdrop-blur-md border transition ${
                            isFavorite 
                              ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' 
                              : 'bg-black/60 border-white/10 text-gray-300 hover:text-amber-400'
                          }`}
                          title={isFavorite ? '取消收藏' : '加入收藏'}
                        >
                          <Star size={13} className={isFavorite ? 'fill-amber-400' : ''} />
                        </button>

                        <button
                          onClick={(e) => handleTogglePlayed(e, item)}
                          className="p-1.5 rounded-lg bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/10 text-gray-300 hover:text-cyan-400 transition"
                          title={isPlayed ? '标记未播' : '标记已播'}
                        >
                          {isPlayed ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                      </div>

                      {/* Center Play Button */}
                      <div className="flex justify-center">
                        <button
                          onClick={() => onPlaySingleItem(item)}
                          className="w-11 h-11 rounded-full bg-jf-accent hover:bg-cyan-400 text-white flex items-center justify-center shadow-lg shadow-cyan-500/40 transition transform hover:scale-110"
                          title="开始播放"
                        >
                          <Play size={18} className="ml-0.5 fill-white" />
                        </button>
                      </div>

                      {/* Bottom Management Row */}
                      <div className="flex justify-between items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); onOpenMetadataEditor(item); }}
                          className="p-1.5 rounded-lg bg-black/60 hover:bg-white/20 border border-white/10 text-gray-300 hover:text-white transition"
                          title="编辑元数据"
                        >
                          <Edit3 size={13} />
                        </button>

                        <button
                          onClick={(e) => { e.stopPropagation(); onOpenIdentify(item); }}
                          className="p-1.5 rounded-lg bg-black/60 hover:bg-white/20 border border-white/10 text-gray-300 hover:text-cyan-300 transition"
                          title="识别/重新刮削"
                        >
                          <Sparkles size={13} />
                        </button>

                        <button
                          onClick={(e) => handleDelete(e, item)}
                          className="p-1.5 rounded-lg bg-black/60 hover:bg-red-900/60 border border-white/10 text-gray-400 hover:text-red-400 transition"
                          title="删除媒体"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Title & Info */}
                  <div className="p-2 flex flex-col gap-0.5 min-w-0">
                    <div className="text-xs font-medium text-white truncate group-hover:text-cyan-300 transition" title={item.Name}>
                      {item.Name}
                    </div>
                    <div className="text-[10px] text-gray-400 flex items-center justify-between">
                      <span>{item.ProductionYear || '未知年份'}</span>
                      {item.OfficialRating && <span className="px-1 bg-white/5 rounded">{item.OfficialRating}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
