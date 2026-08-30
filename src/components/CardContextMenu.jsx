import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Tv, Play, Glasses, ExternalLink, Info, Edit3, Sparkles, RefreshCw, Trash2
} from 'lucide-react';
import { useExternalPlayer } from '../hooks/useExternalPlayer';

/**
 * 媒体卡片操作菜单（Portal 渲染到 body，fixed 定位）
 * 修复：旧实现渲染在海报容器的 overflow-hidden 内部且向上弹出，
 * 菜单高度超出海报顶边被整体裁剪，导致"三点按钮点了没反应"。
 */
export default function CardContextMenu({
  item,
  anchorRect,
  onClose,
  onPlayFloating,
  onPlayTheater,
  onPlayVr,
  onOpenDetail,
  onOpenMetadataEditor,
  onOpenIdentify,
  onRefreshMetadata,
  onDelete
}) {
  const { launchPlayer } = useExternalPlayer();
  const menuRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!anchorRect || !menuRef.current) return;
    const menu = menuRef.current;
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left = anchorRect.right - mw;
    let top = anchorRect.top - mh - 6;
    if (top < 8) top = anchorRect.bottom + 6;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - mh - 8));
    setPos({ left, top });
  }, [anchorRect]);

  useEffect(() => {
    if (!item) return;
    const handleOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        // 触发按钮自身的点击交给按钮 onClick 处理（切换开/关），这里跳过
        if (e.target.closest?.('[data-contextmenu-trigger]')) return;
        onClose();
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClose = () => onClose();
    window.addEventListener('mousedown', handleOutside, true);
    window.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('resize', handleClose);
    return () => {
      window.removeEventListener('mousedown', handleOutside, true);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('resize', handleClose);
    };
  }, [item, onClose]);

  if (!item || !anchorRect) return null;

  const run = (fn) => () => {
    onClose();
    if (typeof fn === 'function') fn(item);
  };

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? 'visible' : 'hidden'
      }}
      className="w-44 glass-panel rounded-xl shadow-2xl py-1 z-[9999] text-xs text-gray-200 divide-y divide-white/5 animate-in fade-in zoom-in-95 duration-100"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="py-1">
        <button
          onClick={run(onPlayFloating)}
          className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2 text-cyan-300 font-medium"
        >
          <Tv size={13} />
          <span>悬浮窗播放 (3窗)</span>
        </button>

        <button
          onClick={run(onPlayTheater)}
          className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2 text-gray-300"
        >
          <Play size={13} />
          <span>影院全屏模式</span>
        </button>

        <button
          onClick={run(onPlayVr)}
          className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2 text-amber-300 font-medium"
        >
          <Glasses size={13} />
          <span>🥽 VR 全景播放</span>
        </button>

        {onOpenDetail && (
          <button
            onClick={run(onOpenDetail)}
            className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2 text-gray-300"
          >
            <Info size={13} />
            <span>查看详情 / 相似推荐</span>
          </button>
        )}

        <button
          onClick={() => { onClose(); launchPlayer('mpv', item); }}
          className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center justify-between text-gray-300"
        >
          <span className="flex items-center gap-2"><ExternalLink size={12} /> MPV 播放器</span>
          <span className="text-[10px] text-cyan-400">mpv://</span>
        </button>
        <button
          onClick={() => { onClose(); launchPlayer('potplayer', item); }}
          className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center justify-between text-gray-300"
        >
          <span className="flex items-center gap-2"><ExternalLink size={12} /> PotPlayer</span>
          <span className="text-[10px] text-amber-400">pot://</span>
        </button>
        <button
          onClick={() => { onClose(); launchPlayer('vlc', item); }}
          className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center justify-between text-gray-300"
        >
          <span className="flex items-center gap-2"><ExternalLink size={12} /> VLC 播放器</span>
          <span className="text-[10px] text-orange-400">vlc://</span>
        </button>
      </div>

      <div className="py-1">
        {onOpenMetadataEditor && (
          <button
            onClick={run(onOpenMetadataEditor)}
            className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2 text-gray-300"
          >
            <Edit3 size={12} />
            <span>编辑元数据</span>
          </button>
        )}

        {onOpenIdentify && (
          <button
            onClick={run(onOpenIdentify)}
            className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2 text-cyan-300"
          >
            <Sparkles size={12} />
            <span>重新识别 / 刮削</span>
          </button>
        )}

        {onRefreshMetadata && (
          <button
            onClick={run(onRefreshMetadata)}
            className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2 text-gray-300"
          >
            <RefreshCw size={12} />
            <span>刷新媒体信息</span>
          </button>
        )}
      </div>

      <div className="py-1">
        {onDelete && (
          <button
            onClick={run(onDelete)}
            className="w-full px-3 py-1.5 text-left hover:bg-red-900/40 flex items-center gap-2 text-red-400"
          >
            <Trash2 size={12} />
            <span>从磁盘删除</span>
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
