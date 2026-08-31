import { useState, useEffect, useCallback, useMemo } from 'react';
import { jellyfin } from '../api/jellyfinClient';
import {
  X, Star, Play, Tv, Glasses, Eye, EyeOff, RefreshCw, Edit3,
  Sparkles, Trash2, Film, Clock, Copy, Check, Users, ChevronRight, Info
} from 'lucide-react';
import { useExternalPlayer } from '../hooks/useExternalPlayer';
import DeleteConfirmModal from './DeleteConfirmModal';

function formatRuntime(ticks) {
  if (!ticks) return '';
  const totalMinutes = Math.floor(ticks / 10000000 / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}小时${m}分` : `${m}分钟`;
}

function formatTicksAsTime(ticks) {
  if (!ticks) return '00:00';
  return formatTime(ticks / 10000000);
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * 影片详情弹窗：简介 / 演职员 / 媒体信息 / 相似推荐，一键播放与元数据管理。
 */
export default function ItemDetailModal({
  isOpen,
  item,
  onClose,
  onPlayTheater,
  onPlayFloating,
  onPlayVr,
  onUpdateItem,
  onDeleteItem,
  onOpenMetadataEditor,
  onOpenIdentify,
  onRefreshMetadata,
  onOpenDetail,
  onSearchPerson
}) {
  const [details, setDetails] = useState(null);
  const [similarItems, setSimilarItems] = useState([]);
  const [expandedOverview, setExpandedOverview] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const { launchPlayer } = useExternalPlayer();

  useEffect(() => {
    setDetails(null);
    setSimilarItems([]);
    setExpandedOverview(false);
    if (!isOpen || !item?.Id || !jellyfin.auth.isConfigured) return;
    let cancelled = false;
    jellyfin.getItemDetails(item.Id).then(d => {
      if (!cancelled && d) setDetails(d);
    }).catch(() => {});
    jellyfin.getSimilarItems(item.Id, 12).then(list => {
      if (!cancelled) setSimilarItems(list || []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isOpen, item?.Id]);

  const current = details || item;
  const userData = useMemo(() => current?.UserData || {}, [current]);
  const isFavorite = !!userData.IsFavorite;
  const isPlayed = !!userData.Played;
  const resumeTicks = !isPlayed ? (userData.PlaybackPositionTicks || 0) : 0;

  const handleToggleFavorite = useCallback(async () => {
    if (!current?.Id) return;
    const nextFav = !isFavorite;
    if (onUpdateItem) {
      onUpdateItem({ ...current, UserData: { ...userData, IsFavorite: nextFav } });
    }
    try {
      await jellyfin.toggleFavorite(current.Id, nextFav);
    } catch {
      if (onUpdateItem) onUpdateItem(current);
    }
  }, [current, isFavorite, userData, onUpdateItem]);

  const handleTogglePlayed = useCallback(async () => {
    if (!current?.Id) return;
    const nextPlayed = !isPlayed;
    const playCount = nextPlayed
      ? Math.max(1, (userData.PlayCount || 0) + 1)
      : Math.max(0, (userData.PlayCount || 1) - 1);
    if (onUpdateItem) {
      onUpdateItem({ ...current, UserData: { ...userData, Played: nextPlayed, PlayCount: playCount } });
    }
    try {
      await jellyfin.markPlayed(current.Id, nextPlayed);
    } catch {
      if (onUpdateItem) onUpdateItem(current);
    }
  }, [current, isPlayed, userData, onUpdateItem]);

  const handleCopyPath = async () => {
    if (!current?.Path) return;
    try {
      await navigator.clipboard.writeText(current.Path);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 1500);
    } catch {
      // ignore
    }
  };

  if (!isOpen || !item) return null;

  const backdropUrl = current?.Id ? jellyfin.getBestImageUrl(current, { maxWidth: 1000, preferBackdrop: true }) : '';
  const posterUrl = current?.Id ? jellyfin.getBestImageUrl(current, { maxWidth: 400 }) : '';
  const cast = (current?.People || [])
    // 只保留演员（Actor / GuestStar；无 Type 的条目按演员兜底），过滤导演/编剧等幕后人员
    .filter(p => !p.Type || ['Actor', 'GuestStar'].includes(p.Type))
    .slice(0, 8);
  const videoStream = (current?.MediaStreams || []).find(s => s.Type === 'Video');
  const audioStreams = (current?.MediaStreams || []).filter(s => s.Type === 'Audio');
  const subtitleCount = (current?.MediaStreams || []).filter(s => s.Type === 'Subtitle').length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-6 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[92vh] glass-panel rounded-2xl shadow-2xl border border-white/10 flex flex-col overflow-hidden text-xs text-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Backdrop Header */}
        <div className="relative flex-shrink-0">
          <div className="relative h-40 sm:h-52 bg-black overflow-hidden">
            {backdropUrl && (
              <img src={backdropUrl} alt="" className="w-full h-full object-cover opacity-60" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0d131f] via-black/40 to-transparent" />
          </div>
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-lg bg-black/60 hover:bg-black/90 text-gray-300 hover:text-white transition"
          >
            <X size={18} />
          </button>

          {/* Title Block */}
          <div className="absolute bottom-0 inset-x-0 p-4 flex items-end gap-3">
            <div className="w-16 sm:w-20 aspect-[2/3] rounded-lg overflow-hidden bg-black/70 border border-white/15 flex-shrink-0 shadow-xl relative">
              <div className="absolute inset-0 flex items-center justify-center text-gray-600"><Film size={22} /></div>
              {posterUrl && (
                <img
                  src={posterUrl}
                  alt={current?.Name}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  className="relative w-full h-full object-cover"
                />
              )}
            </div>
            <div className="min-w-0 flex-1 pb-0.5">
              <h2 className="text-base sm:text-lg font-bold text-white truncate">{current?.Name}</h2>
              {current?.OriginalTitle && current.OriginalTitle !== current.Name && (
                <div className="text-[11px] text-gray-400 truncate mt-0.5">{current.OriginalTitle}</div>
              )}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[11px] text-gray-300">
                {current?.ProductionYear && <span className="font-mono">{current.ProductionYear}</span>}
                {current?.CommunityRating && (
                  <span className="flex items-center gap-1 text-amber-300 font-mono">
                    <Star size={11} className="fill-amber-400 text-amber-400" />
                    {current.CommunityRating.toFixed(1)}
                  </span>
                )}
                {current?.RunTimeTicks && (
                  <span className="flex items-center gap-1 font-mono">
                    <Clock size={11} />
                    {formatRuntime(current.RunTimeTicks)}
                  </span>
                )}
                {current?.OfficialRating && (
                  <span className="px-1.5 py-0.5 bg-white/10 rounded font-mono text-[10px]">{current.OfficialRating}</span>
                )}
                {current?.PlayCount > 0 && (
                  <span className="font-mono text-cyan-300">看过 {current.PlayCount} 次</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex flex-col gap-4 p-4 overflow-y-auto flex-1">
          {/* Resume hint */}
          {resumeTicks > 0 && current?.RunTimeTicks && (
            <button
              onClick={() => onPlayTheater && onPlayTheater(current)}
              className="flex items-center gap-2 p-2.5 rounded-xl bg-cyan-950/60 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-900/60 transition text-left"
            >
              <Play size={14} className="fill-cyan-300" />
              <span className="font-bold">上次看到 {formatTicksAsTime(resumeTicks)}，点击继续播放</span>
            </button>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onPlayTheater && onPlayTheater(current)}
              className="px-3.5 py-2 rounded-xl bg-jf-accent hover:bg-cyan-400 text-white font-bold flex items-center gap-1.5 transition shadow-lg shadow-cyan-500/25"
            >
              <Play size={13} className="fill-white" />
              <span>影院播放</span>
            </button>
            <button
              onClick={() => onPlayFloating && onPlayFloating(current)}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-cyan-500/30 text-cyan-300 font-bold flex items-center gap-1.5 transition"
              title="开启悬浮播放窗"
            >
              <Tv size={13} />
              <span>悬浮窗</span>
            </button>
            <button
              onClick={() => onPlayVr && onPlayVr(current)}
              className="px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-300 font-bold flex items-center gap-1.5 transition"
            >
              <Glasses size={13} />
              <span>VR</span>
            </button>
            <button
              onClick={handleToggleFavorite}
              className={`px-3 py-2 rounded-xl border font-bold flex items-center gap-1.5 transition ${
                isFavorite ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-black/40 border-white/10 text-gray-300 hover:text-amber-300'
              }`}
            >
              <Star size={13} className={isFavorite ? 'fill-amber-400' : ''} />
              <span>{isFavorite ? '已收藏' : '收藏'}</span>
            </button>
            <button
              onClick={handleTogglePlayed}
              className={`px-3 py-2 rounded-xl border font-bold flex items-center gap-1.5 transition ${
                isPlayed ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-black/40 border-white/10 text-gray-300 hover:text-emerald-300'
              }`}
            >
              {isPlayed ? <EyeOff size={13} /> : <Eye size={13} />}
              <span>{isPlayed ? '标记未看' : '标记已看'}</span>
            </button>
            <button
              onClick={() => { if (onRefreshMetadata) onRefreshMetadata(current); }}
              className="px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-gray-300 hover:text-cyan-300 font-bold flex items-center gap-1.5 transition"
              title="向服务器发送元数据刷新请求"
            >
              <RefreshCw size={13} />
              <span>刷新元数据</span>
            </button>
            <button
              onClick={() => onOpenMetadataEditor && onOpenMetadataEditor(current)}
              className="px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-gray-300 hover:text-white font-bold flex items-center gap-1.5 transition"
            >
              <Edit3 size={13} />
              <span>编辑</span>
            </button>
            <button
              onClick={() => onOpenIdentify && onOpenIdentify(current)}
              className="px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-cyan-300 hover:bg-white/10 font-bold flex items-center gap-1.5 transition"
            >
              <Sparkles size={13} />
              <span>识别</span>
            </button>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="px-3 py-2 rounded-xl bg-red-950/40 border border-red-500/30 text-red-300 hover:bg-red-900/50 font-bold flex items-center gap-1.5 transition ml-auto"
            >
              <Trash2 size={13} />
              <span>删除</span>
            </button>
          </div>

          {/* Genres */}
          {current?.Genres?.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {current.Genres.map(g => (
                <span key={g} className="px-2 py-0.5 rounded-full bg-cyan-950/60 border border-cyan-500/30 text-cyan-300 font-medium">{g}</span>
              ))}
            </div>
          )}

          {/* Overview */}
          {current?.Overview && (
            <div className="rounded-xl bg-black/40 border border-white/5 p-3.5 text-[13px] leading-relaxed text-gray-300">
              <div className={`whitespace-pre-line ${expandedOverview ? '' : 'line-clamp-4'}`}>{current.Overview}</div>
              {current.Overview.length > 160 && (
                <button
                  onClick={() => setExpandedOverview(prev => !prev)}
                  className="mt-1.5 text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-0.5"
                >
                  <span>{expandedOverview ? '收起' : '展开全文'}</span>
                  <ChevronRight size={12} className={expandedOverview ? '-rotate-90' : 'rotate-90'} />
                </button>
              )}
            </div>
          )}

          {/* Cast（仅演员） */}
          {cast.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-gray-400 font-bold">
                <Users size={13} className="text-cyan-400" />
                <span>演员</span>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
                {cast.map(person => {
                  const imgUrl = person.Id ? jellyfin.getImageUrl(person.Id, person.PrimaryImageTag, 'Primary', 200, 85) : '';
                  return (
                    <button
                      key={person.Id || person.Name}
                      onClick={() => onSearchPerson && onSearchPerson(person.Name)}
                      className="flex flex-col items-center gap-1 w-16 flex-shrink-0 group"
                      title={`搜索 ${person.Name} 的作品`}
                    >
                      <div className="w-16 h-16 rounded-full overflow-hidden bg-black/60 border border-white/10 group-hover:border-cyan-400/60 transition">
                        {imgUrl ? (
                          <img src={imgUrl} alt={person.Name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-500"><Users size={20} /></div>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-300 truncate w-full text-center group-hover:text-cyan-300">{person.Name}</span>
                      {person.Role && (
                        <span className="text-[9px] text-gray-500 truncate w-full text-center" title={person.Role}>{person.Role}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Media Info */}
          <div className="rounded-xl bg-black/40 border border-white/5 p-3.5 flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-gray-400 font-bold">
              <Info size={13} className="text-cyan-400" />
              <span>媒体信息</span>
            </div>
            {current?.Path && (
              <button
                onClick={handleCopyPath}
                className="flex items-center gap-2 text-left text-[11px] font-mono text-gray-400 hover:text-cyan-300 transition group"
                title="点击复制完整路径"
              >
                {copiedPath ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} className="flex-shrink-0" />}
                <span className="truncate">{current.Path}</span>
                {copiedPath && <span className="text-emerald-400 flex-shrink-0">已复制</span>}
              </button>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
              {current?.Container && (
                <div className="flex flex-col">
                  <span className="text-gray-500">容器</span>
                  <span className="font-mono text-gray-200">{current.Container.toUpperCase()}</span>
                </div>
              )}
              {videoStream && (
                <div className="flex flex-col">
                  <span className="text-gray-500">视频</span>
                  <span className="font-mono text-gray-200">
                    {videoStream.Codec?.toUpperCase()} {videoStream.Width && videoStream.Height ? `${videoStream.Width}×${videoStream.Height}` : ''}
                  </span>
                </div>
              )}
              {audioStreams.length > 0 && (
                <div className="flex flex-col">
                  <span className="text-gray-500">音轨</span>
                  <span className="font-mono text-gray-200">{audioStreams.length} 条 ({audioStreams[0]?.Codec?.toUpperCase()})</span>
                </div>
              )}
              <div className="flex flex-col">
                <span className="text-gray-500">字幕</span>
                <span className="font-mono text-gray-200">{subtitleCount > 0 ? `${subtitleCount} 条` : '无'}</span>
              </div>
              {current?.MediaSources?.[0]?.Size && (
                <div className="flex flex-col">
                  <span className="text-gray-500">大小</span>
                  <span className="font-mono text-gray-200">{(current.MediaSources[0].Size / (1024 * 1024 * 1024)).toFixed(2)} GB</span>
                </div>
              )}
              <div className="flex flex-col">
                <span className="text-gray-500">外部播放</span>
                <button
                  onClick={() => launchPlayer('mpv', current)}
                  className="font-mono text-cyan-300 hover:text-cyan-200 text-left"
                >
                  MPV →
                </button>
              </div>
            </div>
          </div>

          {/* Similar Recommendations */}
          {similarItems.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-gray-400 font-bold">
                <Film size={13} className="text-cyan-400" />
                <span>相似推荐</span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {similarItems.map(sim => {
                  const simPoster = jellyfin.getBestImageUrl(sim, { maxWidth: 240 });
                  return (
                    <button
                      key={sim.Id}
                      onClick={() => onOpenDetail && onOpenDetail(sim)}
                      className="flex flex-col rounded-lg overflow-hidden bg-black/40 border border-white/5 hover:border-cyan-500/50 transition group text-left"
                      title={sim.Name}
                    >
                      <div className="aspect-[2/3] bg-black/60 overflow-hidden">
                        {simPoster ? (
                          <img src={simPoster} alt={sim.Name} className="w-full h-full object-cover group-hover:scale-105 transition" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-600"><Film size={16} /></div>
                        )}
                      </div>
                      <span className="px-1 py-1 text-[10px] text-gray-300 truncate group-hover:text-cyan-300">{sim.Name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Delete Confirm */}
        <DeleteConfirmModal
          isOpen={showDeleteModal}
          item={current}
          onConfirm={async () => {
            try {
              await jellyfin.deleteItem(current.Id);
              setShowDeleteModal(false);
              if (onDeleteItem) onDeleteItem(current.Id);
              onClose();
            } catch (err) {
              alert(err.message || '删除失败');
            }
          }}
          onClose={() => setShowDeleteModal(false)}
        />
      </div>
    </div>
  );
}
