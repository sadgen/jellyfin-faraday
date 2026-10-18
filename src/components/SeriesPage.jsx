/**
 * SeriesPage —— 电视剧「进入子页面」浏览：剧 → 季筛选 → 集卡片网格
 *
 * 取代「点剧卡片弹 ItemDetailModal」的旧交互；集卡片通过 renderEpisodeCard
 * 由 LibraryView 注入（复用 MediaCard：播放/收藏/已看/右键自动预览全部同款），
 * 避免与 LibraryView 循环导入。
 */
import { useState, useEffect } from 'react';
import { ArrowLeft, Info, Loader2, Film } from 'lucide-react';
import { jellyfin } from '../api/jellyfinClient';

export default function SeriesPage({
  series,
  viewLayout = 'poster',
  isMobileViewport = false,
  onBack,
  onPlay,
  onOpenDetail,
  onToggleFavorite,
  onTogglePlayed,
  onRefreshMetadata,
  onDelete,
  onUpdateItem,
  onOpenActionSheet,
  renderEpisodeCard
}) {
  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState('');
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    jellyfin.getSeasons(series.Id).then((list) => {
      if (cancelled) return;
      setSeasons(list || []);
      setSeasonId(list?.[0]?.Id || '');
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [series.Id]);

  useEffect(() => {
    if (!seasonId) return undefined;
    let cancelled = false;
    setLoading(true);
    jellyfin.getEpisodes(series.Id, seasonId).then((list) => {
      if (cancelled) return;
      setEpisodes(list || []);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [series.Id, seasonId]);

  return (
    <div className="w-full h-full flex flex-col bg-[#080b11] text-gray-100 overflow-hidden">
      {/* 顶栏：返回 / 剧名（点标题看详情）/ 详情按钮 */}
      <div className="border-b border-white/5 bg-slate-950/90 backdrop-blur-md px-3 py-2.5 flex items-center gap-3 z-30 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          onClick={onBack}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition text-xs"
          title="返回"
        >
          <ArrowLeft size={14} /> 返回
        </button>
        <div
          onClick={() => onOpenDetail && onOpenDetail(series)}
          className="flex-1 min-w-0 cursor-pointer group/t"
          title="查看详情"
        >
          <div className="text-sm font-semibold text-white truncate group-hover/t:text-cyan-300 transition">{series.Name}</div>
          <div className="text-[11px] text-gray-500">
            {series.ProductionYear || ''}{seasons.length ? ` · 共 ${seasons.length} 季` : ''}
          </div>
        </div>
        {onOpenDetail && (
          <button
            onClick={() => onOpenDetail(series)}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-cyan-300 transition"
            title="查看详情 / 相似推荐"
          >
            <Info size={14} />
          </button>
        )}
      </div>

      {/* 季筛选（单季隐藏） */}
      {seasons.length > 1 && (
        <div className="px-3 py-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar border-b border-white/5">
          {seasons.map((s) => (
            <button
              key={s.Id}
              onClick={() => setSeasonId(s.Id)}
              className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition border ${
                s.Id === seasonId
                  ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-300'
                  : 'bg-white/5 border-white/10 text-gray-400 hover:text-gray-200'
              }`}
            >
              {s.Name}
            </button>
          ))}
        </div>
      )}

      {/* 集卡片网格 */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="h-full flex items-center justify-center text-gray-500">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : episodes.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-600 gap-2">
            <Film size={28} />
            <span className="text-xs">这一季没有集</span>
          </div>
        ) : (
          <div className={`grid gap-3 ${
            viewLayout === 'backdrop'
              ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
              : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
          }`}>
            {episodes.map((ep) => renderEpisodeCard(ep))}
          </div>
        )}
      </div>
    </div>
  );
}
