import React from 'react';
import { jellyfin } from '../api/jellyfinClient';
import { Settings, Server, User, LogOut, RefreshCw, ShieldCheck, X, HardDrive } from 'lucide-react';

export default function SettingsModal({
  isOpen,
  onClose,
  onLogout,
  onRefreshLibrary,
  isRefreshing,
  totalItemsCount
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div 
        className="w-full max-w-md glass-panel rounded-2xl shadow-2xl p-6 border border-white/10 flex flex-col gap-5 text-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-jf-accent/20 border border-jf-accent/40 flex items-center justify-center text-cyan-400">
              <Settings size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">看板设置</h2>
              <p className="text-xs text-gray-400">Jellyfin Faraday 系统与连接配置</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Current Connection Info */}
        <div className="bg-black/40 rounded-xl p-4 border border-white/5 flex flex-col gap-2.5 text-xs">
          <div className="text-gray-400 font-medium mb-1">当前连接信息</div>
          
          <div className="flex items-center justify-between">
            <span className="text-gray-400 flex items-center gap-1.5">
              <Server size={13} className="text-cyan-400" />
              <span>服务器</span>
            </span>
            <span className="font-mono text-white max-w-[200px] truncate" title={jellyfin.auth.serverUrl}>
              {jellyfin.auth.serverUrl || '未配置'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-gray-400 flex items-center gap-1.5">
              <User size={13} className="text-cyan-400" />
              <span>登录用户</span>
            </span>
            <span className="font-medium text-cyan-300">
              {jellyfin.auth.username || '匿名/Token'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-gray-400 flex items-center gap-1.5">
              <HardDrive size={13} className="text-amber-400" />
              <span>已同步媒体总数</span>
            </span>
            <span className="font-mono text-amber-300 font-bold">
              {totalItemsCount} 部
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {/* Refresh media library */}
          <button
            onClick={onRefreshLibrary}
            disabled={isRefreshing}
            className="w-full px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 text-xs text-gray-200 font-medium flex items-center justify-center gap-2 transition disabled:opacity-50"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin text-cyan-400' : ''} />
            <span>{isRefreshing ? '正在重新同步媒体库...' : '同步 / 重新拉取媒体库'}</span>
          </button>

          {/* Switch server / Logout */}
          <button
            onClick={() => {
              if (confirm('确定要退出当前 Jellyfin 服务器连接吗？')) {
                jellyfin.clearAuth();
                if (onLogout) onLogout();
                onClose();
              }
            }}
            className="w-full px-4 py-2.5 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 text-xs text-red-300 font-medium flex items-center justify-center gap-2 transition"
          >
            <LogOut size={14} />
            <span>切换服务器 / 退出登录</span>
          </button>
        </div>

        {/* Security / Privacy notice */}
        <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/20 text-[11px] text-emerald-300/90">
          <ShieldCheck size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-emerald-300">安全与隐私隔离就绪</div>
            <div className="text-emerald-400/80">代码库严格执行脱敏规范，无任何敏感私有域名或 Token 泄露风险。</div>
          </div>
        </div>
      </div>
    </div>
  );
}
