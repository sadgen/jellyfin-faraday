import { useState } from 'react';
import { jellyfin } from '../api/jellyfinClient';
import { clearLibraryCache } from '../utils/mediaCache';
import { getSavedAccounts, removeAccount } from '../utils/accountStore';
import { SEEK_SPEED_OPTIONS, getStoredSeekSpeed, setStoredSeekSpeed } from '../utils/seekSettings';
import {
  Settings, Server, User, LogOut, RefreshCw, ShieldCheck, X, HardDrive, Clock,
  FastForward, Users as UsersIcon, ArrowLeftRight, Trash2, BarChart3, Check
} from 'lucide-react';

export default function SettingsModal({
  isOpen,
  onClose,
  onLogout,
  onRefreshLibrary,
  isRefreshing,
  totalItemsCount,
  lastSyncTime,
  onOpenStats,
  onSwitchAccount
}) {
  const [seekSpeed, setSeekSpeed] = useState(() => getStoredSeekSpeed());
  const [accounts, setAccounts] = useState(() => getSavedAccounts());

  if (!isOpen) return null;

  const formatLastSync = (timestamp) => {
    if (!timestamp) return '刚刚';
    const d = new Date(timestamp);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  const isCurrentAccount = (acc) =>
    acc.serverUrl === jellyfin.auth.serverUrl && acc.userId === jellyfin.auth.userId;

  const handleRemoveAccount = (acc) => {
    setAccounts(removeAccount(acc.serverUrl, acc.userId));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-md max-h-[92vh] overflow-y-auto glass-panel rounded-2xl shadow-2xl p-6 border border-white/10 flex flex-col gap-5 text-gray-200"
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

          {/* 观影统计入口 */}
          {onOpenStats && (
            <button
              onClick={() => { onOpenStats(); onClose(); }}
              className="mt-1 w-full px-4 py-2.5 rounded-xl bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-xs text-violet-300 font-medium flex items-center justify-center gap-2 transition"
            >
              <BarChart3 size={14} />
              <span>查看观影统计（今日已看 / 总时长 / 类型偏好）</span>
            </button>
          )}
        </div>

        {/* 多账号管理（P14） */}
        {accounts.length > 0 && (
          <div className="bg-black/40 rounded-xl p-4 border border-white/5 flex flex-col gap-2.5 text-xs">
            <div className="flex items-center gap-1.5 text-gray-400 font-medium">
              <UsersIcon size={13} className="text-cyan-400" />
              <span>已保存账号（一键切换）</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {accounts.map(acc => {
                const isCurrent = isCurrentAccount(acc);
                return (
                  <div
                    key={`${acc.serverUrl}-${acc.userId}`}
                    className={`flex items-center justify-between gap-2 p-2 rounded-xl border transition ${
                      isCurrent
                        ? 'bg-cyan-500/10 border-cyan-400/40'
                        : 'bg-black/40 border-white/5 hover:border-cyan-500/30'
                    }`}
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="font-bold text-white truncate flex items-center gap-1.5">
                        {acc.username}
                        {isCurrent && (
                          <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-400/40 text-[9px] text-cyan-300 font-bold">
                            <Check size={9} />
                            当前
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] text-gray-500 font-mono truncate" title={acc.serverUrl}>
                        {acc.serverUrl}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {!isCurrent && onSwitchAccount && (
                        <button
                          onClick={() => onSwitchAccount(acc)}
                          className="px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 font-bold flex items-center gap-1 transition"
                          title="切换到此账号（媒体缓存按账号隔离，切换后自动加载其库）"
                        >
                          <ArrowLeftRight size={12} />
                          <span>切换</span>
                        </button>
                      )}
                      <button
                        onClick={() => handleRemoveAccount(acc)}
                        className="p-1.5 rounded-lg hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition"
                        title="从此浏览器的保存列表中移除（不影响服务器）"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="text-[10px] text-gray-500">
              登录成功的账号会自动保存于此；媒体库缓存按「服务器 + 用户」物理隔离，切换后无需重新同步。
            </div>
          </div>
        )}

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
                <span className="text-[10px] font-mono opacity-80">{opt.stepSeconds}秒 / 步</span>
              </button>
            ))}
          </div>
          <div className="text-[10px] text-gray-500">
            影响电脑版滚轮寻轨步长、手机版滑动手势跨度、键盘 ←/→ 快进快退与播放窗口快进快退。
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
