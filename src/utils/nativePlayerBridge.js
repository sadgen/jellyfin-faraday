/**
 * 安卓壳（jellyfinfaraday-android，Capacitor + 原生 ExoPlayer）播放桥。
 *
 * 仅当页面运行在 Capacitor WebView 内（window.Capacitor.isNativePlatform()
 * 且原生注册了 FaradayPlayer 插件）时激活；浏览器与 desktop-faraday 环境
 * 下 isNativePlayerAvailable() 恒为 false，所有方法 no-op。
 *
 * 职责分工（对齐 desktop-faraday 的壳模式）：
 *   - 点播移交：loadStream 把直连/HLS 流 URL 与凭据交给原生，原生侧全权
 *     负责 ExoPlayer 播放与 Jellyfin PlaybackEvents 上报（web 端不再武装
 *     Started/心跳，避免同一部片双重计播）；
 *   - 状态回写：原生按节流频率回推 position/paused/started，写回页面
 *     video 元素（影子 paused + 合成事件）驱动页面 UI（进度条/图标）。
 *     支持多窗镜像：按 itemId 路由，网页浮窗与单片全屏各自的元素互不干扰；
 *   - 页面控制转发：seeking/volumechange/ratechange 转发给原生；
 *   - 会话收尾：controller.destroy() → close 通知原生结束会话；原生侧
 *     结束/浮窗化时向页面派发合成 Escape，让全屏播放弹窗自行关闭。
 */

const PLUGIN_NAME = 'FaradayPlayer';

export function isNativePlayerAvailable() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  return Boolean(
    cap &&
      typeof cap.isNativePlatform === 'function' &&
      cap.isNativePlatform() &&
      cap.Plugins &&
      cap.Plugins[PLUGIN_NAME]
  );
}

function getPlugin() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  return cap && cap.Plugins ? cap.Plugins[PLUGIN_NAME] : null;
}

class NativePlayerBridge {
  constructor() {
    /** itemId -> { videoEl, paused, positionSec, floating } */
    this.mirrors = new Map();
    this.suppressSeek = new Map();
    this._handles = [];
    this._listening = false;
  }

  /**
   * 移交播放。controller 仅用于读取 jellyfin 凭据与 itemId；必须在
   * web 侧 armStartedReport/startHeartbeat 之前调用。
   * floating=true 表示来源是网页浮窗（原生侧开迷你窗，不进全屏覆盖层）。
   */
  async loadStream(controller, { itemId, mediaSourceId, playMethod, streamUrl, initialSeekTime, audioStreamIndex, subtitleStreamIndex, floating }) {
    const plugin = getPlugin();
    if (!plugin || !itemId) return;

    this.detach(itemId);
    this.mirrors.set(itemId, {
      videoEl: controller.videoEl || null,
      paused: true,
      positionSec: Number.isFinite(initialSeekTime) ? initialSeekTime : 0,
      floating: Boolean(floating)
    });

    this._attachElementMirror(controller.videoEl, itemId);
    this._ensureNativeListeners();

    try {
      await plugin.play({
        url: streamUrl,
        itemId,
        mediaSourceId: mediaSourceId || itemId,
        playMethod,
        startPositionSec: Number.isFinite(initialSeekTime) ? initialSeekTime : 0,
        audioStreamIndex: audioStreamIndex ?? null,
        subtitleStreamIndex: subtitleStreamIndex ?? null,
        floating: Boolean(floating),
        serverUrl: controller.jellyfin.auth.serverUrl || '',
        token: controller.jellyfin.auth.token || '',
        userId: controller.jellyfin.auth.userId || ''
      });
    } catch (err) {
      console.error('[nativePlayerBridge] play failed:', err);
    }
  }

  seek(itemId, positionSec) {
    const plugin = getPlugin();
    if (!plugin || !this.mirrors.has(itemId || this._anyItemId())) return;
    plugin.seek({ itemId, positionSec }).catch(() => {});
  }

  setPaused(itemId, paused) {
    const plugin = getPlugin();
    if (!plugin || !this.mirrors.has(itemId || this._anyItemId())) return;
    plugin.pause({ itemId, paused: Boolean(paused) }).catch(() => {});
  }

  /** controller.destroy() → 通知原生结束会话（上报 Stopped、收窗） */
  notifyClosed(itemId) {
    const plugin = getPlugin();
    const closedId = itemId || this._anyItemId();
    if (!plugin || !closedId) return;
    this.detach(closedId);
    plugin.close({ itemId: closedId }).catch(() => {});
  }

  _anyItemId() {
    return this.mirrors.keys().next().value || null;
  }

  /** 解绑指定会话的镜像与元素监听（会话移交/关闭时） */
  detach(itemId) {
    this.mirrors.delete(itemId);
    this.suppressSeek.delete(itemId);
  }

  /**
   * 页面 video 元素退化为"状态镜像"：永不真正播放，原生回写
   * currentTime/paused 驱动 UI；元素上的 seek/volume/rate 操作转发原生。
   */
  _attachElementMirror(videoEl, itemId) {
    if (!videoEl) return;
    const bridge = this;
    try {
      Object.defineProperty(videoEl, 'paused', {
        configurable: true,
        get() {
          const m = bridge.mirrors.get(itemId);
          return m ? m.paused : true;
        }
      });
    } catch {}

    videoEl.addEventListener('seeking', () => {
      if (bridge.suppressSeek.get(itemId) || !bridge.mirrors.has(itemId)) return;
      const t = videoEl.currentTime;
      if (Number.isFinite(t)) bridge.seek(itemId, t);
    });
    videoEl.addEventListener('volumechange', () => {
      const plugin = getPlugin();
      if (!plugin || !bridge.mirrors.has(itemId)) return;
      plugin
        .setVolume({ itemId, volume: videoEl.volume, muted: videoEl.muted })
        .catch(() => {});
    });
    videoEl.addEventListener('ratechange', () => {
      const plugin = getPlugin();
      if (!plugin || !bridge.mirrors.has(itemId)) return;
      plugin.setRate({ itemId, rate: videoEl.playbackRate || 1 }).catch(() => {});
    });
  }

  _ensureNativeListeners() {
    if (this._listening) return;
    const plugin = getPlugin();
    if (!plugin || typeof plugin.addListener !== 'function') return;
    this._listening = true;
    const keep = (h) => {
      if (h && typeof h.remove === 'function') this._handles.push(h);
    };
    try {
      keep(plugin.addListener('faradayState', (state) => {
        this._applyNativeState(state);
      }));
      keep(plugin.addListener('faradayEnded', (payload) => {
        const m = payload && this.mirrors.get(payload.itemId);
        this.detach(payload && payload.itemId);
        if (m && !m.floating) this._dispatchEscape();
      }));
      // 原生切到浮窗/PiP：全屏播放弹窗自行关闭（会话继续）
      keep(plugin.addListener('faradayFloated', (payload) => {
        if (payload && this.mirrors.has(payload.itemId)) this._dispatchEscape();
      }));
    } catch {}
  }

  _applyNativeState(state) {
    if (!state) return;
    const m = this.mirrors.get(state.itemId);
    if (!m) return;
    const el = m.videoEl;
    if (typeof state.paused === 'boolean' && state.paused !== m.paused) {
      m.paused = state.paused;
      if (el) {
        el.dispatchEvent(new Event(state.paused ? 'pause' : 'play'));
        if (!state.paused) el.dispatchEvent(new Event('playing'));
      }
    }
    if (Number.isFinite(state.positionSec)) {
      m.positionSec = state.positionSec;
      if (el && Math.abs((el.currentTime || 0) - state.positionSec) > 1.2) {
        this.suppressSeek.set(state.itemId, true);
        try {
          el.currentTime = state.positionSec;
        } catch {}
        setTimeout(() => {
          this.suppressSeek.set(state.itemId, false);
        }, 50);
      }
    }
  }

  /** 原生关闭/浮窗化后让全屏播放弹窗自行关闭（VideoPlayerModal 监听 Escape） */
  _dispatchEscape() {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } catch {}
  }
}

export const nativePlayerBridge = new NativePlayerBridge();

// Capacitor WebView 内禁用 PWA Service Worker：壳自带资产版本管理，
// SW 缓存会把 WebView 钉死在旧版本（sw.js 本体已由打包脚本剔除，这里
// 只清理上一版本可能注册的遗留）
if (isNativePlayerAvailable() && typeof navigator !== 'undefined' && navigator.serviceWorker) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) reg.unregister().catch(() => {});
  }).catch(() => {});
  if (window.caches && typeof window.caches.keys === 'function') {
    window.caches.keys().then((keys) => {
      for (const key of keys) window.caches.delete(key).catch(() => {});
    }).catch(() => {});
  }
}
