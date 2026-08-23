import React from 'react';
import { Film, Tv, Search, Settings } from 'lucide-react';

export default function MobileNavBar({
  onOpenRandom3Windows,
  onOpenSearch,
  onOpenSettings
}) {
  return (
    <div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-950/95 backdrop-blur-lg border-t border-white/10 px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex items-center justify-around text-[10px] text-gray-400 select-none shadow-2xl">
      {/* Tab 1: Library */}
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className="flex flex-col items-center gap-1 p-1 text-cyan-400 font-bold scale-105 transition"
      >
        <Film size={19} className="stroke-[2.5]" />
        <span>媒体库</span>
      </button>

      {/* Tab 2: Random 3 Windows */}
      <button
        onClick={onOpenRandom3Windows}
        className="flex flex-col items-center gap-1 p-1 text-amber-400 hover:text-amber-300 transition"
      >
        <Tv size={19} />
        <span>随机3窗</span>
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
