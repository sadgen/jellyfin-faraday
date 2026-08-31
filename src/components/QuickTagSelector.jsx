import { useState } from 'react';
import { Tag, Plus, X, Check } from 'lucide-react';
import { jellyfin } from '../api/jellyfinClient';

export const PRESET_TAGS = ['极品', '精选', '收藏片段', '待重下', '画质差', '自制'];

/**
 * 快捷打标面板（一键打 Tag 并同步保存至 Jellyfin 服务端与本地缓存）
 */
export default function QuickTagSelector({ item, onUpdateItem, onClose }) {
  const currentTags = item?.Tags || [];
  const [customInput, setCustomInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleToggleTag = async (tagName) => {
    if (!item?.Id || isSaving) return;
    const exists = currentTags.includes(tagName);
    const nextTags = exists
      ? currentTags.filter(t => t !== tagName)
      : [...currentTags, tagName];

    const updatedItem = {
      ...item,
      Tags: nextTags
    };

    if (onUpdateItem) onUpdateItem(updatedItem);
    setIsSaving(true);

    try {
      // 提交到 Jellyfin 服务端
      await jellyfin.updateItemMetadata(item.Id, {
        Name: item.Name,
        Tags: nextTags
      });
    } catch (err) {
      console.warn('Failed to update tag on server:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddCustom = (e) => {
    e.preventDefault();
    const tag = customInput.trim();
    if (!tag) return;
    if (!currentTags.includes(tag)) {
      handleToggleTag(tag);
    }
    setCustomInput('');
  };

  return (
    <div
      className="p-3 bg-[#0d131f] border border-cyan-500/40 rounded-2xl shadow-2xl flex flex-col gap-2.5 text-xs text-gray-200 min-w-[240px]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
        <div className="flex items-center gap-1.5 font-bold text-white">
          <Tag size={13} className="text-cyan-400" />
          <span>快捷打标</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 rounded text-gray-400 hover:text-white">
            <X size={13} />
          </button>
        )}
      </div>

      {/* Preset Tags */}
      <div className="flex flex-wrap gap-1.5">
        {PRESET_TAGS.map(t => {
          const active = currentTags.includes(t);
          return (
            <button
              key={t}
              onClick={() => handleToggleTag(t)}
              className={`px-2 py-1 rounded-lg transition font-medium flex items-center gap-1 text-[11px] ${
                active
                  ? 'bg-cyan-500/30 border border-cyan-400/60 text-cyan-300 font-bold shadow-sm'
                  : 'bg-black/40 border border-white/10 text-gray-300 hover:text-white hover:bg-white/10'
              }`}
            >
              {active && <Check size={10} className="text-cyan-400" />}
              <span>{t}</span>
            </button>
          );
        })}
      </div>

      {/* Existing Custom Tags */}
      {currentTags.filter(t => !PRESET_TAGS.includes(t)).length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-white/5 pt-1.5">
          {currentTags.filter(t => !PRESET_TAGS.includes(t)).map(t => (
            <span
              key={t}
              onClick={() => handleToggleTag(t)}
              className="px-2 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 text-[10px] flex items-center gap-1 cursor-pointer hover:bg-red-950 hover:border-red-500/40 hover:text-red-300 transition"
              title="点击移除此标签"
            >
              <span>{t}</span>
              <X size={9} />
            </span>
          ))}
        </div>
      )}

      {/* Custom Tag Input */}
      <form onSubmit={handleAddCustom} className="flex items-center gap-1.5 border-t border-white/5 pt-1.5">
        <input
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          placeholder="输入自定义标签..."
          className="flex-1 px-2.5 py-1 rounded-lg bg-black/60 border border-white/10 text-white placeholder-gray-500 text-[11px] focus:outline-none focus:border-cyan-400"
        />
        <button
          type="submit"
          disabled={!customInput.trim()}
          className="p-1 rounded-lg bg-jf-accent hover:bg-cyan-400 text-white disabled:opacity-30 transition"
          title="添加标签"
        >
          <Plus size={13} />
        </button>
      </form>
    </div>
  );
}
