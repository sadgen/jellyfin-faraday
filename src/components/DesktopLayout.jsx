import React, { useMemo } from 'react';
import VideoTile from './VideoTile';
import ControlHUD from './ControlHUD';
import { useSessionQueue } from '../hooks/useSessionQueue';
import { Film } from 'lucide-react';

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
  isRefreshing
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
        // 2 columns side by side on desktop, stacked on narrow screens
        return 'grid-cols-1 md:grid-cols-2 grid-rows-2 md:grid-rows-1';
      case 4:
      default:
        // 2x2 grid
        return 'grid-cols-2 grid-rows-2';
    }
  }, [activeTileCount]);

  return (
    <div className="relative w-screen h-screen bg-[#080b11] p-3 pb-24 overflow-hidden flex flex-col">
      {/* Empty State */}
      {(!items || items.length === 0) && (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
          <Film size={48} className="text-gray-600 animate-pulse" />
          <div className="text-base font-medium">当前筛选模式下暂无可用媒体</div>
          <div className="text-xs text-gray-500">尝试切换为「纯粹随机」或点击设置同步媒体库</div>
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
      />
    </div>
  );
}
