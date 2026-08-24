import React from 'react';
import { Film, Play, Search, Settings } from 'lucide-react';

export default function MobileNavBar({
  onOpenRandomPlay,
  onOpenRandom3Windows,
  onOpenSearch,
  onOpenSettings
}) {
  return (
    <div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-950/95 backdrop-blur-lg border-t border-white/10 px-4 py-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex items-center justify-around text-[10px] text-gray-400 select-none shadow-2xl">
      {/* Tab 1: Library */}
      <button
        onClick={() => {
          const container = document.querySelector('.overflow-y-auto');
          if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
          else window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        className="flex flex-col items-center gap-0.5 p-1 text-cyan-400 font-bold scale-105 transition"
      >
        <Film size={18} className="stroke-[2.5]" />
        <span>媒体库</span>
      </button>

      {/* Tab 2: Instant Random Play (Playback First!) */}
      <button
        onClick={onOpenRandomPlay || onOpenRandom3Windows}
        className="flex flex-col items-center gap-0.5 p-1 text-amber-400 hover:text-amber-300 active:scale-95 transition"
      >
        <Play size={18} className="fill-amber-400" />
        <span>随机播放</span>
      </button>

      {/* Tab 3: Search */}
      <button
        onClick={onOpenSearch}
        className="flex flex-col items-center gap-0.5 p-1 hover:text-white transition"
      >
        <Search size={18} />
        <span>搜索</span>
      </button>

      {/* Tab 4: Settings */}
      <button
        onClick={onOpenSettings}
        className="flex flex-col items-center gap-0.5 p-1 hover:text-white transition"
      >
        <Settings size={18} />
        <span>设置</span>
      </button>
    </div>
  );
}
