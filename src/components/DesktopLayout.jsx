import React, { useMemo } from 'react';
import VideoTile from './VideoTile';
import ControlHUD from './ControlHUD';
import { useSessionQueue } from '../hooks/useSessionQueue';
import { Film, LayoutGrid } from 'lucide-react';

export default function DesktopLayout({
  items,
  activeTileCount,
  onTileCountChange,
  filterMode,
  onFilterModeChange,
  isGlobalMuted,
  onToggleGlobalMute,
  playbackSpeed,
  onPlaybackSpeedChange,
  onOpenSettings,
  onRefreshLibrary,
  isRefreshing,
  onOpenLibraryView,
  activeScopeName
}) {
  const {
    displayedItems,
    remainingCount,
    totalCount,
    consumeNext,
    reshuffleAll,
    updateItemInTiles
  } = useSessionQueue(items, filterMode, activeTileCount);

  // Dynamic CSS Grid layout classes based on active tile count
  const gridClasses = useMemo(() => {
    switch (activeTileCount) {
      case 1:
        return 'grid-cols-1 grid-rows-1';
      case 2:
        return 'grid-cols-1 md:grid-cols-2 grid-rows-2 md:grid-rows-1';
      case 4:
      default:
        return 'grid-cols-2 grid-rows-2';
    }
  }, [activeTileCount]);

  return (
    <div className="relative w-screen h-screen bg-[#080b11] p-3 pb-24 overflow-hidden flex flex-col">
      {/* Empty State */}
      {(!items || items.length === 0) && (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
          <Film size={48} className="text-gray-600 animate-pulse" />
          <div className="text-base font-medium">当前筛选范围「{activeScopeName}」内暂无可用媒体</div>
          <button
            onClick={onOpenLibraryView}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-jf-accent hover:bg-jf-accentHover text-white text-xs font-medium transition shadow-lg shadow-cyan-500/20 mt-2"
          >
            <LayoutGrid size={14} />
            <span>返回媒体库重新筛选</span>
          </button>
        </div>
      )}

      {/* Main Viewport Grid */}
      {items && items.length > 0 && (
        <div className={`flex-1 grid ${gridClasses} gap-2.5 w-full h-full min-h-0 min-w-0`}>
          {Array.from({ length: activeTileCount }).map((_, index) => {
            const currentItem = displayedItems[index];
            return (
              <div key={`tile-${index}`} className="w-full h-full min-h-0 min-w-0">
                <VideoTile
                  tileId={index}
                  item={currentItem}
                  isGlobalMuted={isGlobalMuted}
                  playbackSpeed={playbackSpeed}
                  onSkip={consumeNext}
                  onUpdateItem={updateItemInTiles}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Control HUD */}
      <ControlHUD
        activeTileCount={activeTileCount}
        onTileCountChange={onTileCountChange}
        filterMode={filterMode}
        onFilterModeChange={onFilterModeChange}
        onReshuffle={reshuffleAll}
        isGlobalMuted={isGlobalMuted}
        onToggleGlobalMute={onToggleGlobalMute}
        playbackSpeed={playbackSpeed}
        onPlaybackSpeedChange={onPlaybackSpeedChange}
        remainingCount={remainingCount}
        totalCount={totalCount}
        onOpenSettings={onOpenSettings}
        onRefreshLibrary={onRefreshLibrary}
        isRefreshing={isRefreshing}
        onOpenLibraryView={onOpenLibraryView}
        activeScopeName={activeScopeName}
      />
    </div>
  );
}
