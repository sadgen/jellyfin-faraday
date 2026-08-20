import React from 'react';
import { Film, Shuffle, Search, Settings, Layers } from 'lucide-react';

export default function MobileNavBar({
  viewMode,
  onSwitchView,
  onOpenSearch,
  onOpenSettings,
  totalCount = 0
}) {
  return (
    <div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-950/95 backdrop-blur-lg border-t border-white/10 px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex items-center justify-around text-[10px] text-gray-400 select-none shadow-2xl">
      {/* Tab 1: Library */}
      <button
        onClick={() => onSwitchView('library')}
        className={`flex flex-col items-center gap-1 p-1 transition ${
          viewMode === 'library' ? 'text-cyan-400 font-bold scale-105' : 'hover:text-white'
        }`}
      >
        <Film size={19} className={viewMode === 'library' ? 'stroke-[2.5]' : ''} />
        <span>媒体库</span>
      </button>

      {/* Tab 2: Kanban (Random Multi-Tile Player) */}
      <button
        onClick={() => onSwitchView('kanban')}
        className={`relative flex flex-col items-center gap-1 p-1 transition ${
          viewMode === 'kanban' ? 'text-cyan-400 font-bold scale-105' : 'hover:text-white'
        }`}
      >
        <div className="relative">
          <Shuffle size={19} className={viewMode === 'kanban' ? 'stroke-[2.5]' : ''} />
          {totalCount > 0 && (
            <span className="absolute -top-1 -right-2.5 px-1 bg-cyan-500 text-white text-[8px] font-mono rounded-full font-bold">
              {totalCount > 99 ? '99+' : totalCount}
            </span>
          )}
        </div>
        <span>随机看</span>
      </button>

      {/* Tab 3: Search */}
      <button
        onClick={onOpenSearch}
        className="flex flex-col items-center gap-1 p-1 hover:text-white transition"
      >
        <Search size={19} />
        <span>搜索</span>
      </button>

      {/* Tab 4: Settings */}
      <button
        onClick={onOpenSettings}
        className="flex flex-col items-center gap-1 p-1 hover:text-white transition"
      >
        <Settings size={19} />
        <span>设置</span>
      </button>
    </div>
  );
}
