import { useMemo } from 'react';
import { jellyfin } from '../api/jellyfinClient';
import {
  X, Film, Star, Eye, Clock, BarChart3, Calendar, Flame, TrendingUp
} from 'lucide-react';

function formatHours(seconds) {
  if (!seconds || seconds <= 0) return '0 小时';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} 分钟`;
  return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

function isSameDay(dateStr, ref) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate();
}

/**
 * 观影统计面板：基于本地全量缓存（IndexedDB 水合数据）即时计算，
 * 无需请求服务器。
 */
export default function StatsModal({ isOpen, onClose, items = [] }) {
  const stats = useMemo(() => {
    const now = new Date();
    const weekAgo = now.getTime() - 7 * 24 * 3600 * 1000;

    let playedCount = 0;
    let favoritesCount = 0;
    let totalRuntimeSec = 0;
    let playedRuntimeSec = 0;
    let todayCount = 0;
    let weekCount = 0;
    const genreMap = new Map();
    const yearMap = new Map();

    items.forEach(it => {
      const played = !!it.UserData?.Played;
      const lastPlayed = it.UserData?.LastPlayedDate;
      const runtimeSec = it.RunTimeTicks ? it.RunTimeTicks / 10000000 : 0;
      totalRuntimeSec += runtimeSec;
      if (played) {
        playedCount += 1;
        playedRuntimeSec += runtimeSec;
      }
      if (it.UserData?.IsFavorite) favoritesCount += 1;
      if (isSameDay(lastPlayed, now)) todayCount += 1;
      if (lastPlayed && new Date(lastPlayed).getTime() >= weekAgo) weekCount += 1;

      (it.Genres || []).forEach(g => {
        genreMap.set(g, (genreMap.get(g) || 0) + 1);
      });
      if (it.ProductionYear) {
        yearMap.set(it.ProductionYear, (yearMap.get(it.ProductionYear) || 0) + 1);
      }
    });

    const topGenres = Array.from(genreMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const topPlayed = [...items]
      .filter(it => (it.UserData?.PlayCount || 0) > 0)
      .sort((a, b) => (b.UserData?.PlayCount || 0) - (a.UserData?.PlayCount || 0))
      .slice(0, 8);

    const decadeMap = new Map();
    yearMap.forEach((count, year) => {
      const decade = `${Math.floor(year / 10) * 10}s`;
      decadeMap.set(decade, (decadeMap.get(decade) || 0) + count);
    });
    const topDecades = Array.from(decadeMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return {
      total: items.length,
      playedCount,
      unplayedCount: items.length - playedCount,
      favoritesCount,
      totalRuntimeSec,
      playedRuntimeSec,
      todayCount,
      weekCount,
      topGenres,
      topPlayed,
      topDecades
    };
  }, [items]);

  if (!isOpen) return null;

  const maxGenreCount = stats.topGenres.length > 0 ? stats.topGenres[0][1] : 1;

  const statCards = [
    { icon: Film, label: '媒体总数', value: `${stats.total} 部`, color: 'text-cyan-300 border-cyan-500/30 bg-cyan-950/40' },
    { icon: Eye, label: '已看 / 未看', value: `${stats.playedCount} / ${stats.unplayedCount}`, color: 'text-emerald-300 border-emerald-500/30 bg-emerald-950/40' },
    { icon: Clock, label: '全库总时长', value: formatHours(stats.totalRuntimeSec), color: 'text-amber-300 border-amber-500/30 bg-amber-950/40' },
    { icon: TrendingUp, label: '已看完时长', value: formatHours(stats.playedRuntimeSec), color: 'text-violet-300 border-violet-500/30 bg-violet-950/40' },
    { icon: Flame, label: '今日已看', value: `${stats.todayCount} 部`, color: 'text-rose-300 border-rose-500/30 bg-rose-950/40' },
    { icon: Calendar, label: '近 7 天已看', value: `${stats.weekCount} 部`, color: 'text-sky-300 border-sky-500/30 bg-sky-950/40' },
    { icon: Star, label: '收藏总数', value: `${stats.favoritesCount} 部`, color: 'text-yellow-300 border-yellow-500/30 bg-yellow-950/40' }
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] glass-panel rounded-2xl shadow-2xl border border-white/10 flex flex-col overflow-hidden text-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/40 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-300">
              <BarChart3 size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">观影统计</h2>
              <p className="text-[11px] text-gray-400">基于本地全量缓存即时计算</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-4">
          {/* Stat Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {statCards.map(card => {
              const Icon = card.icon;
              return (
                <div key={card.label} className={`rounded-xl border p-3 flex flex-col gap-1 ${card.color}`}>
                  <div className="flex items-center gap-1.5 text-[10px] font-bold opacity-90">
                    <Icon size={12} />
                    <span>{card.label}</span>
                  </div>
                  <span className="text-lg font-black font-mono leading-none">{card.value}</span>
                </div>
              );
            })}
          </div>

          {/* Genre Ranking */}
          {stats.topGenres.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-[11px] text-gray-400 font-bold">类型偏好 Top 8</div>
              <div className="flex flex-col gap-1.5">
                {stats.topGenres.map(([genre, count]) => (
                  <div key={genre} className="flex items-center gap-2">
                    <span className="w-20 text-[11px] text-gray-300 truncate text-right" title={genre}>{genre}</span>
                    <div className="flex-1 h-3.5 bg-black/50 rounded-full overflow-hidden border border-white/5">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 rounded-full"
                        style={{ width: `${(count / maxGenreCount) * 100}%` }}
                      />
                    </div>
                    <span className="w-8 text-[11px] font-mono text-cyan-300">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Played */}
          {stats.topPlayed.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-[11px] text-gray-400 font-bold">重播榜 Top 8</div>
              <div className="flex flex-col gap-1">
                {stats.topPlayed.map(it => {
                  const poster = jellyfin.getImageUrl(it.Id, it.ImageTags?.Primary, 'Primary', 120, 75);
                  return (
                    <div key={it.Id} className="flex items-center gap-2.5 p-1.5 rounded-lg bg-black/30 border border-white/5">
                      <div className="w-7 h-10 rounded overflow-hidden bg-black/60 border border-white/10 flex-shrink-0">
                        {poster && <img src={poster} alt="" className="w-full h-full object-cover" />}
                      </div>
                      <span className="flex-1 text-[11px] text-gray-200 truncate">{it.Name}</span>
                      <span className="text-[11px] font-mono text-cyan-300 font-bold flex-shrink-0">
                        {it.UserData?.PlayCount || 0} 次
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Decades */}
          {stats.topDecades.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-[11px] text-gray-400 font-bold">年代分布 Top 5</div>
              <div className="flex gap-2 flex-wrap">
                {stats.topDecades.map(([decade, count]) => (
                  <div key={decade} className="px-3 py-1.5 rounded-xl bg-black/40 border border-white/10 text-[11px]">
                    <span className="font-mono font-bold text-white">{decade}</span>
                    <span className="ml-1.5 text-cyan-300 font-mono">{count} 部</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
