import React, { useState, useEffect, useRef } from 'react';
import { LayoutGrid, Image, Film, ExternalLink, AlertCircle, CheckCircle2, X } from 'lucide-react';

const SUITE_APPS = [
  {
    id: 'gallery',
    name: 'Faraday Gallery',
    badge: '相册 / 图集',
    description: '极简高动态平铺照片墙与短视频轮播',
    envKey: 'VITE_FARADAY_GALLERY_URL',
    defaultPort: 3000,
    icon: Image,
    accentColor: '#a855f7' // 紫色系
  },
  {
    id: 'stream',
    name: 'Faraday Stream',
    badge: '影视 / 流媒体',
    description: 'Jellyfin 极速客户端与多窗画中画连播',
    envKey: 'VITE_FARADAY_STREAM_URL',
    defaultPort: 5173,
    icon: Film,
    accentColor: '#06b6d4' // 青色系
  }
];

export default function FaradaySuiteMenu({ currentApp = 'stream', direction = 'down' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [notice, setNotice] = useState(null); // 提示未配置信息: { appId, message }
  const menuRef = useRef(null);

  // 点击外部自动关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
        setNotice(null);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [isOpen]);

  // 解析目标 App 的 URL 与配置状态
  const resolveAppTarget = (app) => {
    const isCurrent = app.id === currentApp;
    if (isCurrent) {
      return { isCurrent: true, isConfigured: true, url: null };
    }

    // 1. 优先读取 Vite 环境变量
    const envUrl = typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env[app.envKey]
      : null;

    if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
      return { isCurrent: false, isConfigured: true, url: envUrl.trim() };
    }

    // 2. 本地开发环境 (localhost / 127.0.0.1) 自动兜底默认端口
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname;
      const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
      if (isLocalHost) {
        return {
          isCurrent: false,
          isConfigured: true,
          url: `http://${hostname}:${app.defaultPort}`
        };
      }
    }

    // 3. 生产/反代环境且未配置环境变量：明确标记为未配置
    return { isCurrent: false, isConfigured: false, url: null };
  };

  const handleAppClick = (app, targetInfo) => {
    if (targetInfo.isCurrent) {
      // 当前应用，关闭菜单即可
      setIsOpen(false);
      return;
    }

    if (!targetInfo.isConfigured || !targetInfo.url) {
      // 未配置：友好提示，绝不报错或跳死链
      setNotice({
        appId: app.id,
        message: `⚠️ 该项目未配置访问地址。如已部署，可在环境变量中添加 ${app.envKey}=http(s)://... 来启用关联。`
      });
      return;
    }

    // 已配置：在新标签页安全打开
    setIsOpen(false);
    setNotice(null);
    window.open(targetInfo.url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      {/* 触发按钮 */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          setNotice(null);
        }}
        title="Faraday Suite 应用切换器"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '6px 8px',
          borderRadius: '10px',
          border: isOpen ? '1px solid rgba(6, 182, 212, 0.6)' : '1px solid rgba(255, 255, 255, 0.1)',
          background: isOpen ? 'rgba(6, 182, 212, 0.15)' : 'rgba(0, 0, 0, 0.35)',
          color: isOpen ? '#22d3ee' : '#d1d5db',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          backdropFilter: 'blur(8px)',
          gap: '4px'
        }}
        onMouseEnter={(e) => {
          if (!isOpen) {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
            e.currentTarget.style.color = '#ffffff';
          }
        }}
        onMouseLeave={(e) => {
          if (!isOpen) {
            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.35)';
            e.currentTarget.style.color = '#d1d5db';
          }
        }}
      >
        <LayoutGrid size={15} />
        <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.02em' }}>Suite</span>
      </button>

      {/* 下拉/上拉抽屉卡片 */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            ...(direction === 'up'
              ? { bottom: 'calc(100% + 8px)' }
              : { top: 'calc(100% + 8px)' }),
            width: '280px',
            background: '#0d131f',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '14px',
            padding: '12px',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.05)',
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            backdropFilter: 'blur(20px)',
            color: '#f3f4f6',
            fontFamily: 'system-ui, -apple-system, sans-serif'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '6px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <LayoutGrid size={14} style={{ color: '#06b6d4' }} />
              <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.05em', color: '#e5e7eb' }}>
                FARADAY SUITE
              </span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9ca3af',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <X size={14} />
            </button>
          </div>

          {/* App List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {SUITE_APPS.map((app) => {
              const target = resolveAppTarget(app);
              const Icon = app.icon;
              const isNoticeTarget = notice && notice.appId === app.id;

              return (
                <div
                  key={app.id}
                  onClick={() => handleAppClick(app, target)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '8px 10px',
                    borderRadius: '10px',
                    border: target.isCurrent
                      ? `1px solid ${app.accentColor}55`
                      : '1px solid rgba(255, 255, 255, 0.06)',
                    background: target.isCurrent
                      ? `${app.accentColor}15`
                      : 'rgba(255, 255, 255, 0.03)',
                    cursor: target.isCurrent ? 'default' : 'pointer',
                    transition: 'all 0.15s ease',
                    position: 'relative'
                  }}
                  onMouseEnter={(e) => {
                    if (!target.isCurrent) {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!target.isCurrent) {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
                    }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div
                        style={{
                          width: '26px',
                          height: '26px',
                          borderRadius: '7px',
                          background: `${app.accentColor}25`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: app.accentColor
                        }}
                      >
                        <Icon size={15} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#f9fafb' }}>
                          {app.name}
                        </span>
                        <span style={{ fontSize: '10px', color: '#9ca3af' }}>
                          {app.badge}
                        </span>
                      </div>
                    </div>

                    {/* Status Pill */}
                    <div>
                      {target.isCurrent ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: '6px',
                            background: 'rgba(34, 197, 94, 0.15)',
                            color: '#4ade80',
                            fontWeight: 600
                          }}
                        >
                          <CheckCircle2 size={10} /> 当前应用
                        </span>
                      ) : target.isConfigured ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: '6px',
                            background: 'rgba(6, 182, 212, 0.15)',
                            color: '#22d3ee',
                            fontWeight: 500
                          }}
                        >
                          切换直达 <ExternalLink size={10} />
                        </span>
                      ) : (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: '6px',
                            background: 'rgba(234, 179, 8, 0.15)',
                            color: '#facc15',
                            fontWeight: 500
                          }}
                          title="未检测到该项目部署地址，点击查看指引"
                        >
                          未配置
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 描述 */}
                  <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '4px', lineHeight: 1.3 }}>
                    {app.description}
                  </div>

                  {/* 针对未配置项的即时友好展开提示 */}
                  {isNoticeTarget && (
                    <div
                      style={{
                        marginTop: '8px',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        background: 'rgba(234, 179, 8, 0.12)',
                        border: '1px solid rgba(234, 179, 8, 0.3)',
                        fontSize: '10px',
                        color: '#fef08a',
                        lineHeight: 1.4,
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '4px'
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <AlertCircle size={13} style={{ color: '#facc15', flexShrink: 0, marginTop: '1px' }} />
                      <span>{notice.message}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
