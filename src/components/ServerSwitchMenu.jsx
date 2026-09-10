import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Server, LogOut } from 'lucide-react';
import { jellyfin } from '../api/jellyfinClient';

/**
 * 顶栏服务器切换入口：展示当前连接的服务器与账号，
 * 点击「退出当前服务器」回到连接页（连接页支持已记住服务器一键重连与清理）。
 * 菜单经 Portal 渲染到 body，z 10000 高于浮窗最高层 9999。
 */
export default function ServerSwitchMenu({ onLogout }) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 56, right: 8 });
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const updateMenuPos = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuPos({
      top: Math.min(r.bottom + 8, window.innerHeight - 16),
      right: Math.max(8, window.innerWidth - r.right)
    });
  }, []);

  // 点击外部自动关闭（菜单在 body 上，须同时排除按钮与菜单本体）
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e) => {
      const inButton = buttonRef.current && buttonRef.current.contains(e.target);
      const inMenu = menuRef.current && menuRef.current.contains(e.target);
      if (!inButton && !inMenu) setIsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  const serverUrl = jellyfin.auth.serverUrl || '';
  let serverHost = serverUrl;
  try {
    serverHost = new URL(serverUrl).host;
  } catch {
    // 非法 URL 时保留原始字符串
  }
  const username = jellyfin.auth.username || '';

  return (
    <div ref={buttonRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => {
          updateMenuPos();
          setIsOpen(prev => !prev);
        }}
        title="切换 / 退出当前 Jellyfin 服务器"
        className={`flex items-center gap-1 px-2 py-1.5 rounded-[10px] border text-[11px] font-semibold transition backdrop-blur-md ${
          isOpen
            ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-300'
            : 'border-white/10 bg-black/35 text-gray-300 hover:bg-white/10 hover:text-white'
        }`}
      >
        <Server size={15} />
        <span className="hidden md:inline max-w-[140px] truncate">{serverHost || '服务器'}</span>
      </button>

      {isOpen && createPortal(
        <div
          ref={menuRef}
          className="fixed w-64 bg-[#0d131f] border border-white/15 rounded-2xl p-3 shadow-[0_20px_50px_rgba(0,0,0,0.85)] flex flex-col gap-2.5 text-xs animate-in fade-in zoom-in-95 duration-100"
          style={{ top: menuPos.top, right: menuPos.right, zIndex: 10000 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-wider border-b border-white/10 pb-2">
            <Server size={13} className="text-cyan-400" />
            <span>当前服务器</span>
          </div>
          <div className="flex flex-col gap-0.5 px-0.5 min-w-0">
            <span className="text-[13px] font-bold text-white truncate" title={serverUrl}>
              {serverHost || '未知服务器'}
            </span>
            {username && (
              <span className="text-[11px] text-gray-400 truncate">账号：{username}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              if (onLogout) onLogout();
            }}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-red-950/50 border border-red-500/40 text-red-300 font-bold hover:bg-red-900/60 transition"
          >
            <LogOut size={13} />
            <span>退出当前服务器</span>
          </button>
          <div className="text-[10px] text-gray-500 leading-relaxed">
            退出后回到连接页，已记住的服务器可一键重连或清理。
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
