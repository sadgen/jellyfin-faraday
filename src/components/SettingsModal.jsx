import { useState } from 'react';
import { jellyfin } from '../api/jellyfinClient';
import { clearLibraryCache } from '../utils/mediaCache';
import { SEEK_SPEED_OPTIONS, getStoredSeekSpeed, setStoredSeekSpeed } from '../utils/seekSettings';
import { Settings, Server, User, LogOut, RefreshCw, ShieldCheck, X, HardDrive, Clock, FastForward } from 'lucide-react';

export default function SettingsModal({
  isOpen,
  onClose,
  onLogout,
  onRefreshLibrary,
  isRefreshing,
  totalItemsCount,
  lastSyncTime
}) {
  const [seekSpeed, setSeekSpeed] = useState(() => getStoredSeekSpeed());

  if (!isOpen) return null;

  const formatLastSync = (timestamp) => {
    if (!timestamp) return '刚刚';
    const d = new Date(timestamp);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

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
              <p className="text-xs text-gray-400">Jellyfin Faraday 系统与本地缓存管理</p>
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
          <div className="text-gray-400 font-medium mb-1">当前连接与磁盘缓存</div>
          
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
              <span>本地缓存总数</span>
            </span>
            <span className="font-mono text-amber-300 font-bold">
              {totalItemsCount} 部
            </span>
          </div>

          {lastSyncTime && (
            <div className="flex items-center justify-between">
              <span className="text-gray-400 flex items-center gap-1.5">
                <Clock size={13} className="text-emerald-400" />
                <span>上次全量同步</span>
              </span>
              <span className="font-mono text-gray-300 text-[11px]">
                {formatLastSync(lastSyncTime)}
              </span>
            </div>
          )}
        </div>

        {/* Seek Speed Tier Setting (慢 5s / 中 15s / 快 30s) */}
        <div className="bg-black/40 rounded-xl p-4 border border-white/5 flex flex-col gap-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-gray-300 font-medium flex items-center gap-1.5">
              <FastForward size={14} className="text-cyan-400" />
              <span>快进快退 / 滚轮寻轨步长</span>
            </span>
            <span className="text-[11px] text-cyan-300 font-mono font-bold">
              {SEEK_SPEED_OPTIONS.find(o => o.id === seekSpeed)?.label}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1">
            {SEEK_SPEED_OPTIONS.map(opt => (
              <button
                key={opt.id}
                onClick={() => {
                  setStoredSeekSpeed(opt.id);
                  setSeekSpeed(opt.id);
                }}
                className={`py-2 px-1 rounded-xl text-center border font-medium transition flex flex-col items-center gap-0.5 ${
                  seekSpeed === opt.id
                    ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-300 shadow-sm shadow-cyan-500/30'
                    : 'bg-white/5 border-white/5 text-gray-400 hover:text-gray-200 hover:bg-white/10'
                }`}
              >
                <span className="text-xs font-bold">{opt.label.split(' ')[0]}</span>
                <span className="text-[10px] font-mono opacity-80">{opt.seconds}秒 / 步</span>
              </button>
            ))}
          </div>
          <div className="text-[10px] text-gray-500">
            影响电脑版滚轮寻轨步长、手机版滑动手势跨度与播放窗口快进快退。
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {/* Refresh / Resync media library */}
          <button
            onClick={() => {
              onRefreshLibrary();
              onClose();
            }}
            disabled={isRefreshing}
            className="w-full px-4 py-2.5 rounded-xl bg-jf-accent/20 hover:bg-jf-accent/40 border border-cyan-500/30 text-xs text-cyan-300 font-medium flex items-center justify-center gap-2 transition disabled:opacity-50"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin text-cyan-400' : ''} />
            <span>{isRefreshing ? '正在后台同步媒体库...' : '从服务器全量同步 / 更新缓存'}</span>
          </button>

          {/* Switch server / Logout */}
          <button
            onClick={async () => {
              if (confirm('确定要清除本地缓存并退出登录吗？')) {
                const s = jellyfin.auth.serverUrl;
                const u = jellyfin.auth.userId;
                jellyfin.clearAuth();
                // 清空当前账号 IndexedDB 媒体库缓存与视图缓存，防止换账号后冷启动泄露上一账号媒体库
                await clearLibraryCache(s, u);
                localStorage.removeItem('jf_last_selected_view');
                if (onLogout) onLogout();
                onClose();
              }
            }}
            className="w-full px-4 py-2.5 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 text-xs text-red-300 font-medium flex items-center justify-center gap-2 transition"
          >
            <LogOut size={14} />
            <span>清除缓存并退出登录</span>
          </button>
        </div>

        {/* Cache status note */}
        <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/20 text-[11px] text-emerald-300/90">
          <ShieldCheck size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-emerald-300">本地磁盘缓存加速已就绪</div>
            <div className="text-emerald-400/80">每次刷新页面将直接从浏览器本地 IndexedDB 秒级加载，无需重复从 Jellyfin 服务器下载。</div>
          </div>
        </div>
      </div>
    </div>
  );
}
