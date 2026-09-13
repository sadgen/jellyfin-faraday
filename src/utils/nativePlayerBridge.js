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
 *     video 元素（影子 paused + 合成事件）驱动页面 UI（进度条/图标）；
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
    this.activeItemId = null;
    this.videoEl = null;
    this.paused = true;
    this.positionSec = 0;
    this.suppressSeek = false;
    this._removeStateListener = null;
  }

  /**
   * 移交播放。controller 仅用于读取 jellyfin 凭据与 itemId；必须在
   * web 侧 armStartedReport/startHeartbeat 之前调用。
   */
  async loadStream(controller, { itemId, mediaSourceId, playMethod, streamUrl, initialSeekTime, audioStreamIndex, subtitleStreamIndex }) {
    const plugin = getPlugin();
    if (!plugin || !itemId) return;

    this.detach();
    this.activeItemId = itemId;
    this.paused = true;
    this.positionSec = initialSeekTime || 0;

    this._attachElementMirror(controller.videoEl);
    this._listenNativeEvents(controller);

    try {
      await plugin.play({
        url: streamUrl,
        itemId,
        mediaSourceId: mediaSourceId || itemId,
        playMethod,
        startPositionSec: Number.isFinite(initialSeekTime) ? initialSeekTime : 0,
        audioStreamIndex: audioStreamIndex ?? null,
        subtitleStreamIndex: subtitleStreamIndex ?? null,
        serverUrl: controller.jellyfin.auth.serverUrl || '',
        token: controller.jellyfin.auth.token || '',
        userId: controller.jellyfin.auth.userId || ''
      });
    } catch (err) {
      console.error('[nativePlayerBridge] play failed:', err);
    }
  }

  seek(positionSec) {
    const plugin = getPlugin();
    if (!plugin || !this.activeItemId) return;
    plugin.seek({ positionSec }).catch(() => {});
  }

  setPaused(paused) {
    const plugin = getPlugin();
    if (!plugin || !this.activeItemId) return;
    plugin.pause({ paused: Boolean(paused) }).catch(() => {});
  }

  /** controller.destroy() → 通知原生结束会话（上报 Stopped、收 overlay） */
  notifyClosed(itemId) {
    const plugin = getPlugin();
    const closedId = itemId || this.activeItemId;
    if (!plugin || !closedId) return;
    if (this.activeItemId === closedId) this.detach();
    plugin.close({ itemId: closedId }).catch(() => {});
  }

  /** 解绑元素镜像与原生事件监听（会话移交/关闭时） */
  detach() {
    if (this._removeStateListener) {
      try {
        this._removeStateListener();
      } catch {}
      this._removeStateListener = null;
    }
    this.videoEl = null;
    this.activeItemId = null;
  }

  /**
   * 页面 video 元素退化为"状态镜像"：永不真正播放，原生回写
   * currentTime/paused 驱动 UI；元素上的 seek/volume/rate 操作转发原生。
   */
  _attachElementMirror(videoEl) {
    this.videoEl = videoEl || null;
    if (!videoEl) return;

    // 影子 paused：元素从未真正播放，原生 paused 才是 UI 判断依据
    try {
      const bridge = this;
      Object.defineProperty(videoEl, 'paused', {
        configurable: true,
        get() {
          return bridge.paused;
        }
      });
    } catch {}

    videoEl.addEventListener('seeking', this._onSeeking);
    videoEl.addEventListener('volumechange', this._onVolumeChange);
    videoEl.addEventListener('ratechange', this._onRateChange);
  }

  _onSeeking = () => {
    if (this.suppressSeek || !this.videoEl) return;
    const t = this.videoEl.currentTime;
    if (Number.isFinite(t)) this.seek(t);
  };

  _onVolumeChange = () => {
    const plugin = getPlugin();
    if (!plugin || !this.videoEl) return;
    plugin
      .setVolume({ volume: this.videoEl.volume, muted: this.videoEl.muted })
      .catch(() => {});
  };

  _onRateChange = () => {
    const plugin = getPlugin();
    if (!plugin || !this.videoEl) return;
    plugin.setRate({ rate: this.videoEl.playbackRate || 1 }).catch(() => {});
  };

  _listenNativeEvents() {
    const plugin = getPlugin();
    if (!plugin || typeof plugin.addListener !== 'function') return;
    const handles = [];
    const keep = (h) => {
      if (h && typeof h.remove === 'function') handles.push(h);
    };
    try {
      keep(plugin.addListener('faradayState', (state) => {
        if (!state || state.itemId !== this.activeItemId) return;
        this._applyNativeState(state);
      }));
      keep(plugin.addListener('faradayEnded', (payload) => {
        if (!payload || payload.itemId !== this.activeItemId) return;
        this.detach();
        this._dispatchEscape();
      }));
      // 原生切到浮窗：全屏弹窗自行关闭，浏览不被打断（会话继续）
      keep(plugin.addListener('faradayFloated', (payload) => {
        if (!payload || payload.itemId !== this.activeItemId) return;
        this._dispatchEscape();
      }));
    } catch {}
    this._removeStateListener = () => {
      for (const h of handles) {
        try {
          h.remove();
        } catch {}
      }
    };
  }

  _applyNativeState(state) {
    const el = this.videoEl;
    if (typeof state.paused === 'boolean' && state.paused !== this.paused) {
      this.paused = state.paused;
      if (el) {
        el.dispatchEvent(new Event(state.paused ? 'pause' : 'play'));
        if (!state.paused) el.dispatchEvent(new Event('playing'));
      }
    }
    if (Number.isFinite(state.positionSec)) {
      this.positionSec = state.positionSec;
      if (el && Math.abs((el.currentTime || 0) - state.positionSec) > 1.2) {
        this.suppressSeek = true;
        try {
          el.currentTime = state.positionSec;
        } catch {}
        setTimeout(() => {
          this.suppressSeek = false;
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
