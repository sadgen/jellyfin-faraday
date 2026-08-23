import React from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

export default function DeleteConfirmModal({
  isOpen,
  item,
  onConfirm,
  onClose
}) {
  if (!isOpen || !item) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div 
        className="relative max-w-md w-full glass-panel rounded-2xl overflow-hidden shadow-2xl border border-red-500/30 bg-[#0d1117] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 border-b border-red-500/20 bg-red-950/30 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-400 font-bold text-sm sm:text-base">
            <AlertTriangle size={18} className="text-red-400 animate-pulse" />
            <span>永久删除确认</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 flex flex-col gap-3.5 text-xs sm:text-sm text-gray-300">
          <p>
            确定要从 <span className="text-red-400 font-bold">物理磁盘</span> 和 Jellyfin 媒体库中永久删除以下媒体吗？
          </p>

          <div className="p-3 rounded-xl bg-black/60 border border-white/10 flex flex-col gap-1 font-mono text-xs">
            <div className="text-white font-bold truncate">
              {item.Name}
            </div>
            {item.Path && (
              <div className="text-gray-500 text-[11px] truncate" title={item.Path}>
                {item.Path}
              </div>
            )}
          </div>

          <div className="p-2.5 rounded-lg bg-red-950/40 border border-red-500/20 text-red-300 text-[11px]">
            ⚠️ 警告：该操作将直接删除磁盘文件，无法通过回收站恢复！
          </div>
        </div>

        {/* Modal Actions */}
        <div className="p-4 border-t border-white/5 bg-black/40 flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-gray-300 text-xs font-medium transition"
          >
            取消
          </button>
          <button
            onClick={() => {
              onConfirm(item);
              onClose();
            }}
            className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-lg shadow-red-600/30"
          >
            <Trash2 size={13} />
            <span>确认删除</span>
          </button>
        </div>
      </div>
    </div>
  );
}
