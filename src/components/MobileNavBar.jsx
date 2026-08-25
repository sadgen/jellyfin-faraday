import { Film, Play, Search, Settings } from 'lucide-react';

export default function MobileNavBar({
  onOpenRandomPlay,
  onOpenRandom2Windows,
  onOpenRandom3Windows,
  onOpenSearch,
  onOpenSettings
}) {
  return (
    <div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-950/95 backdrop-blur-lg border-t border-white/10 px-3 py-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex items-center justify-around text-[10px] text-gray-400 select-none shadow-2xl">
      {/* Tab 1: Library */}
      <button
        onClick={() => {
          const container = document.querySelector('.overflow-y-auto');
          if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
          else window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        className="flex flex-col items-center gap-0.5 p-1 text-cyan-400 font-bold active:scale-95 transition"
      >
        <Film size={17} className="stroke-[2.5]" />
        <span>媒体库</span>
      </button>

      {/* Tab 2: Random 2 Windows (Mobile Optimized!) */}
      <button
        onClick={onOpenRandom2Windows || onOpenRandomPlay}
        className="flex flex-col items-center gap-0.5 p-1 text-amber-400 hover:text-amber-300 active:scale-95 transition"
        title="手机双窗同时播放"
      >
        <Play size={17} className="fill-amber-400" />
        <span className="font-bold">随机 2 窗</span>
      </button>

      {/* Tab 3: Random 3 Windows */}
      <button
        onClick={onOpenRandom3Windows}
        className="flex flex-col items-center gap-0.5 p-1 text-emerald-400 hover:text-emerald-300 active:scale-95 transition"
        title="开启三窗同时播放"
      >
        <Play size={17} className="fill-emerald-400" />
        <span>随机 3 窗</span>
      </button>

      {/* Tab 4: Search */}
      <button
        onClick={onOpenSearch}
        className="flex flex-col items-center gap-0.5 p-1 hover:text-white active:scale-95 transition"
      >
        <Search size={17} />
        <span>搜索</span>
      </button>

      {/* Tab 5: Settings */}
      <button
        onClick={onOpenSettings}
        className="flex flex-col items-center gap-0.5 p-1 hover:text-white active:scale-95 transition"
      >
        <Settings size={17} />
        <span>设置</span>
      </button>
    </div>
  );
}
