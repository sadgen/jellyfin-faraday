import { useState, useEffect } from 'react';
import { jellyfin } from '../api/jellyfinClient';
import { Edit3, Save, X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function MetadataEditorModal({
  isOpen,
  onClose,
  item,
  onSaved
}) {
  const [name, setName] = useState('');
  const [originalTitle, setOriginalTitle] = useState('');
  const [productionYear, setProductionYear] = useState('');
  const [communityRating, setCommunityRating] = useState('');
  const [overview, setOverview] = useState('');
  const [genres, setGenres] = useState('');
  const [tags, setTags] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ type: '', text: '' });

  useEffect(() => {
    let isCancelled = false;

    if (isOpen && item?.Id) {
      setIsLoading(true);
      setStatusMsg({ type: '', text: '' });
      setName(item.Name || '');
      setOriginalTitle(item.OriginalTitle || '');
      setProductionYear(item.ProductionYear ? item.ProductionYear.toString() : '');
      setCommunityRating(item.CommunityRating ? item.CommunityRating.toString() : '');
      setOverview(item.Overview || '');
      setGenres((item.Genres || []).join(', '));
      setTags((item.Tags || []).join(', '));

      jellyfin.getItemDetails(item.Id)
        .then(details => {
          if (isCancelled || !details) return;
          setName(details.Name || '');
          setOriginalTitle(details.OriginalTitle || '');
          setProductionYear(details.ProductionYear ? details.ProductionYear.toString() : '');
          setCommunityRating(details.CommunityRating ? details.CommunityRating.toString() : '');
          setOverview(details.Overview || '');
          setGenres((details.Genres || []).join(', '));
          setTags((details.Tags || []).join(', '));
        })
        .catch(err => {
          if (isCancelled) return;
          console.error('Failed to load item details:', err);
          setName(item.Name || '');
        })
        .finally(() => {
          if (!isCancelled) setIsLoading(false);
        });
    }

    return () => {
      isCancelled = true;
    };
  }, [isOpen, item]);

  if (!isOpen || !item) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setStatusMsg({ type: '', text: '' });

    try {
      const updateData = {
        Id: item.Id,
        Name: name.trim(),
        OriginalTitle: originalTitle.trim(),
        ProductionYear: productionYear ? parseInt(productionYear, 10) : undefined,
        CommunityRating: communityRating ? parseFloat(communityRating) : undefined,
        Overview: overview.trim(),
        Genres: genres.split(',').map(s => s.trim()).filter(Boolean),
        Tags: tags.split(',').map(s => s.trim()).filter(Boolean)
      };

      await jellyfin.updateItemMetadata(item.Id, updateData);

      setStatusMsg({ type: 'success', text: '元数据修改成功！' });
      if (onSaved) {
        onSaved({
          ...item,
          ...updateData
        });
      }

      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err) {
      console.error('Failed to save metadata:', err);
      setStatusMsg({ type: 'error', text: err.message || '保存失败' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div 
        className="w-full max-w-lg glass-panel rounded-2xl shadow-2xl p-6 border border-white/10 flex flex-col gap-4 text-gray-200 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Edit3 size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">编辑媒体元数据</h2>
              <p className="text-[11px] text-gray-400 truncate max-w-[280px]">{item.Name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition"
          >
            <X size={18} />
          </button>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-400">
            <Loader2 size={24} className="animate-spin text-cyan-400" />
            <span className="text-xs">加载元数据详情...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 text-xs">
            {/* Title */}
            <div className="flex flex-col gap-1">
              <label className="text-gray-300 font-medium">影片名称 / 标题</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400 transition"
                required
              />
            </div>

            {/* Original Title & Year */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-gray-300 font-medium">原始标题 / 番号</label>
                <input
                  type="text"
                  value={originalTitle}
                  onChange={(e) => setOriginalTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400 transition font-mono"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-gray-300 font-medium">发行年份</label>
                <input
                  type="number"
                  value={productionYear}
                  onChange={(e) => setProductionYear(e.target.value)}
                  placeholder="如 2024"
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400 transition font-mono"
                />
              </div>
            </div>

            {/* Rating & Genres */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="flex flex-col gap-1">
                <label className="text-gray-300 font-medium">评分 (0-10)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="10"
                  value={communityRating}
                  onChange={(e) => setCommunityRating(e.target.value)}
                  placeholder="如 8.5"
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400 transition font-mono"
                />
              </div>
              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-gray-300 font-medium">流派分类 (逗号分隔)</label>
                <input
                  type="text"
                  value={genres}
                  onChange={(e) => setGenres(e.target.value)}
                  placeholder="动作, 剧情, 悬疑"
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400 transition"
                />
              </div>
            </div>

            {/* Tags */}
            <div className="flex flex-col gap-1">
              <label className="text-gray-300 font-medium">标签 Tags (逗号分隔)</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="4K, 中文字幕, 经典"
                className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400 transition"
              />
            </div>

            {/* Overview */}
            <div className="flex flex-col gap-1">
              <label className="text-gray-300 font-medium">剧情简介 / Overview</label>
              <textarea
                rows={3}
                value={overview}
                onChange={(e) => setOverview(e.target.value)}
                placeholder="剧情内容概述..."
                className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400 transition resize-none"
              />
            </div>

            {/* Status Feedback */}
            {statusMsg.text && (
              <div className={`flex items-center gap-2 p-2.5 rounded-xl border ${
                statusMsg.type === 'success' 
                  ? 'bg-emerald-950/50 border-emerald-500/30 text-emerald-300' 
                  : 'bg-red-950/50 border-red-500/30 text-red-300'
              }`}>
                {statusMsg.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                <span>{statusMsg.text}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 transition"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2.5 rounded-xl bg-jf-accent hover:bg-jf-accentHover text-white font-medium flex items-center justify-center gap-2 transition shadow-lg shadow-cyan-500/20 disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                <span>保存元数据</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
