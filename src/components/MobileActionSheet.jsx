import { jellyfin } from '../api/jellyfinClient';
import { useExternalPlayer } from '../hooks/useExternalPlayer';
import {
  Play, Star, Eye, EyeOff, Edit3, Sparkles,
  Trash2, RefreshCw, ExternalLink, X, Film,
  Glasses, Tv, Info
} from 'lucide-react';

export default function MobileActionSheet({
  isOpen,
  item,
  onClose,
  onPlay,
  onPlayVr,
  onOpenFloating,
  onOpenDetail,
  onToggleFavorite,
  onTogglePlayed,
  onOpenMetadataEditor,
  onOpenIdentify,
  onRefreshMetadata,
  onDelete
}) {
  const { launchPlayer } = useExternalPlayer();

  if (!isOpen || !item) return null;

  const posterUrl = jellyfin.getBestImageUrl(item, { maxWidth: 200 });
  const isFavorite = !!item.UserData?.IsFavorite;
  const isPlayed = !!item.UserData?.Played;

  return (
    <div 
      className="md:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      {/* Bottom Sheet Drawer */}
      <div 
        className="w-full bg-[#111622] rounded-t-3xl border-t border-white/10 p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex flex-col gap-4 text-xs shadow-2xl animate-in slide-in-from-bottom duration-200 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle pill */}
        <div className="w-10 h-1 rounded-full bg-white/20 self-center -mt-1 mb-1" />

        {/* Item Header Banner */}
        <div className="flex items-center gap-3 border-b border-white/5 pb-3">
          <div className="w-11 h-[60px] rounded-lg overflow-hidden bg-black/60 border border-white/10 flex-shrink-0">
            {posterUrl ? (
              <img src={posterUrl} alt={item.Name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-500"><Film size={18} /></div>
            )}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <div className="font-bold text-white text-sm truncate">{item.Name}</div>
            <div className="text-gray-400 text-[11px] mt-0.5 flex items-center gap-2">
              <span>{item.ProductionYear || '未知年份'}</span>
              {item.OfficialRating && <span className="px-1 bg-white/10 rounded">{item.OfficialRating}</span>}
              {item.CommunityRating && <span className="text-amber-300">★ {item.CommunityRating.toFixed(1)}</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* Action Buttons Grid */}
        <div className="grid grid-cols-2 gap-2 text-gray-200 font-medium">
          {/* Main Play (Theater) */}
          <button
            onClick={() => { onPlay(item); onClose(); }}
            className="py-3 rounded-2xl bg-jf-accent hover:bg-cyan-400 text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/25"
          >
            <Play size={16} className="fill-white" />
            <span>影院播放</span>
          </button>

          {/* VR Panorama Play */}
          <button
            onClick={() => { if (onPlayVr) onPlayVr(item); onClose(); }}
            className="py-3 rounded-2xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-300 font-bold flex items-center justify-center gap-2 shadow-lg shadow-amber-500/15"
          >
            <Glasses size={16} />
            <span>🥽 VR 全景</span>
          </button>

          {/* Floating PIP Window */}
          {onOpenFloating && (
            <button
              onClick={() => { onOpenFloating(item); onClose(); }}
              className="col-span-2 p-3 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-cyan-500/30 text-cyan-300 flex items-center justify-center gap-2 font-bold shadow"
            >
              <Tv size={15} />
              <span>开启悬浮播放窗 (3 窗模式)</span>
            </button>
          )}

          {/* Detail / Similar */}
          {onOpenDetail && (
            <button
              onClick={() => { onOpenDetail(item); onClose(); }}
              className="p-3 rounded-xl bg-black/40 border border-white/5 text-gray-300 flex items-center gap-2.5"
            >
              <Info size={15} />
              <span>详情 / 相似推荐</span>
            </button>
          )}

          {/* Favorite */}
          <button
            onClick={() => { onToggleFavorite(item); onClose(); }}
            className={`p-3 rounded-xl border flex items-center gap-2.5 transition ${
              isFavorite ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-black/40 border-white/5 text-gray-300'
            }`}
          >
            <Star size={15} className={isFavorite ? 'fill-amber-400' : ''} />
            <span>{isFavorite ? '已收藏' : '加入最爱'}</span>
          </button>

          {/* Watched */}
          <button
            onClick={() => { onTogglePlayed(item); onClose(); }}
            className={`p-3 rounded-xl border flex items-center gap-2.5 transition ${
              isPlayed ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-black/40 border-white/5 text-gray-300'
            }`}
          >
            {isPlayed ? <EyeOff size={15} /> : <Eye size={15} />}
            <span>{isPlayed ? '标记未看' : '标记已看'}</span>
          </button>

          {/* MPV */}
          <button
            onClick={() => { launchPlayer('mpv', item); onClose(); }}
            className="p-3 rounded-xl bg-black/40 border border-white/5 text-gray-300 flex items-center justify-between"
          >
            <span className="flex items-center gap-2"><ExternalLink size={14} /> MPV 播放器</span>
            <span className="text-[9px] text-cyan-400 font-mono">mpv://</span>
          </button>

          {/* PotPlayer */}
          <button
            onClick={() => { launchPlayer('potplayer', item); onClose(); }}
            className="p-3 rounded-xl bg-black/40 border border-white/5 text-gray-300 flex items-center justify-between"
          >
            <span className="flex items-center gap-2"><ExternalLink size={14} /> PotPlayer</span>
            <span className="text-[9px] text-amber-400 font-mono">pot://</span>
          </button>

          {/* Edit Metadata */}
          <button
            onClick={() => { onOpenMetadataEditor(item); onClose(); }}
            className="p-3 rounded-xl bg-black/40 border border-white/5 text-gray-300 flex items-center gap-2.5"
          >
            <Edit3 size={15} />
            <span>编辑元数据</span>
          </button>

          {/* Scraper / Identify */}
          <button
            onClick={() => { onOpenIdentify(item); onClose(); }}
            className="p-3 rounded-xl bg-black/40 border border-white/5 text-cyan-300 flex items-center gap-2.5"
          >
            <Sparkles size={15} />
            <span>重新刮削</span>
          </button>

          {/* Refresh item metadata */}
          <button
            onClick={() => { onRefreshMetadata(item); onClose(); }}
            className="p-3 rounded-xl bg-black/40 border border-white/5 text-gray-300 flex items-center gap-2.5"
          >
            <RefreshCw size={15} />
            <span>刷新元数据</span>
          </button>

          {/* Delete item */}
          <button
            onClick={() => { onDelete(item); onClose(); }}
            className="p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-red-400 flex items-center gap-2.5"
          >
            <Trash2 size={15} />
            <span>从磁盘彻底删除</span>
          </button>
        </div>
      </div>
    </div>
  );
}
