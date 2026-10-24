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
    /** itemId -> { videoEl, paused, positionSec, floating, durationSec, vw, vh } */
    this.mirrors = new Map();
    this.suppressSeek = new Map();
    this._handles = [];
    this._listening = false;
    this._slotLoopActive = false;
    this._lastSlotsJson = '';
    // web UI 驱动形态标记：壳内 CSS 据此挖洞（视频槽位透明露出原生垫层）。
    // 仅安卓壳内才加——浏览器/desktop-faraday 下加了会让浮窗留边、加载占位全透明（镂空）。
    if (isNativePlayerAvailable() && typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.classList.add('native-player');
    } else if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.classList.remove('native-player');
    }
  }

  /**
   * 移交播放。controller 仅用于读取 jellyfin 凭据与 itemId；必须在
   * web 侧 armStartedReport/startHeartbeat 之前调用。
   * floating=true 表示来源是网页浮窗（原生开会话，画面由垫层随网页槽位显示）。
   */
  async loadStream(controller, { itemId, mediaSourceId, playMethod, streamUrl, initialSeekTime, audioStreamIndex, subtitleStreamIndex, floating }) {
    const plugin = getPlugin();
    if (!plugin || !itemId) return;

    this.detach(itemId);
    this.mirrors.set(itemId, {
      videoEl: controller.videoEl || null,
      paused: true,
      positionSec: Number.isFinite(initialSeekTime) ? initialSeekTime : 0,
      floating: Boolean(floating),
      durationSec: 0,
      vw: 0,
      vh: 0
    });

    this._attachElementMirror(controller.videoEl, itemId);
    this._ensureNativeListeners();
    this._startSlotLoop();

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
    const floating = Boolean(this.mirrors.get(closedId)?.floating);
    this.detach(closedId);
    plugin.close({ itemId: closedId, floating }).catch(() => {});
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
    // 时长/分辨率影子属性：镜像元素无媒体数据，进度条与窗口比例
    // （videoAspect/竖屏适配）全靠原生回推（faradayState）
    try {
      Object.defineProperty(videoEl, 'duration', {
        configurable: true,
        get() {
          const m = bridge.mirrors.get(itemId);
          return m && m.durationSec > 0 ? m.durationSec : NaN;
        }
      });
    } catch {}
    try {
      Object.defineProperty(videoEl, 'videoWidth', {
        configurable: true,
        get() {
          const m = bridge.mirrors.get(itemId);
          return m ? m.vw : 0;
        }
      });
      Object.defineProperty(videoEl, 'videoHeight', {
        configurable: true,
        get() {
          const m = bridge.mirrors.get(itemId);
          return m ? m.vh : 0;
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
        // 先派发 ended（网页浮窗/弹窗自己的连播/换片逻辑用它），再 detach；
        // 非浮窗补 Escape（VideoPlayerModal 监听后自行关闭）
        if (m && m.videoEl) {
          try { m.videoEl.dispatchEvent(new Event('ended')); } catch {}
        }
        this.detach(payload && payload.itemId);
        if (m && !m.floating) this._dispatchEscape();
      }));
      keep(plugin.addListener('faradayNote', (payload) => {
        if (payload && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('faraday:note', { detail: payload }));
        }
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
      // 进度条/时间显示驱动：镜像元素没有真实解码 tick，靠回推节拍派发 timeupdate
      if (el) {
        try { el.dispatchEvent(new Event('timeupdate')); } catch {}
      }
    }
    // 时长回推 → durationchange（进度条比例）
    if (Number.isFinite(state.durationSec) && state.durationSec > 0 && m.durationSec !== state.durationSec) {
      m.durationSec = state.durationSec;
      if (el) {
        try { el.dispatchEvent(new Event('durationchange')); } catch {}
      }
    }
    // 分辨率回推 → loadedmetadata/resize（videoAspect、竖屏窗口比例依赖它）
    const w = Number(state.videoWidth) || 0;
    const h = Number(state.videoHeight) || 0;
    if (w > 0 && h > 0 && (m.vw !== w || m.vh !== h)) {
      m.vw = w;
      m.vh = h;
      if (el) {
        try {
          el.dispatchEvent(new Event('loadedmetadata'));
          el.dispatchEvent(new Event('resize'));
        } catch {}
      }
    }
  }

  /**
   * 槽位上报循环：rAF 逐帧收集全部镜像 video 元素的 rect + object-fit/平移/
   * 镜像/亮度（computed style，含向上 6 层找 brightness filter），变化才发
   * updateSlots。原生垫层（UnderlayVideoManager）据此定位画面。窗口拖拽/
   * 转场动画期间 rect 每帧变化 → 垫层逐帧跟随。
   */
  _startSlotLoop() {
    if (this._slotLoopActive) return;
    this._slotLoopActive = true;
    const tick = () => {
      if (this.mirrors.size === 0) {
        this._slotLoopActive = false;
        this._lastSlotsJson = '';
        return;
      }
      const slots = [];
      for (const [itemId, m] of this.mirrors) {
        const el = m.videoEl;
        if (!el || !el.isConnected) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
        if (!cs) continue;
        let objectPosition = 50;
        const op = parseFloat(cs.objectPosition);
        if (Number.isFinite(op)) objectPosition = op;
        const flipH = cs.transform && cs.transform !== 'none' ? /matrix\(-/.test(cs.transform) : false;
        let brightness = 1;
        let node = el;
        for (let hops = 0; node && hops < 6; hops++) {
          const f = getComputedStyle(node).filter;
          const mb = f && f.match(/brightness\(([\d.]+)\)/);
          if (mb) {
            brightness = parseFloat(mb[1]);
            break;
          }
          node = node.parentElement;
        }
        // 铺满/取中铺满的 scrubber 预览锚在进度条上方、落进视频矩形——
        // 原生视频浮层会盖住它。上报 bottomInset 让原生把视频底部收缩
        // 让出预览区（window 模式预览挂窗口外沿，无重叠，恒 0）。
        // 注意：此机制只服务播放器内的擦洗预览；媒体库卡片框内视频
        // 不许接入（缩视频让位的方案已被用户否决）
        let bottomInset = 0;
        const pv = document.querySelector('[data-native-overlap]');
        if (pv) {
          const pr = pv.getBoundingClientRect();
          const hOverlap = pr.left < r.right && pr.right > r.left;
          if (hOverlap && pr.top < r.bottom) {
            bottomInset = Math.min(
              Math.max(0, r.bottom - pr.top + 8),
              r.height * 0.45
            );
          }
        }
        slots.push({
          itemId,
          x: r.left,
          y: r.top,
          w: r.width,
          h: r.height,
          bottomInset,
          fit: cs.objectFit || 'contain',
          objectPosition,
          flipH,
          brightness
        });
      }
      const json = JSON.stringify(slots);
      if (json !== this._lastSlotsJson) {
        this._lastSlotsJson = json;
        const plugin = getPlugin();
        if (plugin) plugin.updateSlots({ slots }).catch(() => {});
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** 网页 ⋮ 菜单强制进入原生 VR（立体模式由原生检测） */
  enterVr() {
    const plugin = getPlugin();
    if (plugin) plugin.enterVr({}).catch(() => {});
  }

  /** 横竖屏锁定（WebView 里 screen.orientation.lock 不可用） */
  setOrientation(orientation) {
    const plugin = getPlugin();
    if (plugin) plugin.setOrientation({ orientation }).catch(() => {});
  }

  /** 原生关闭/浮窗化后让全屏播放弹窗自行关闭（VideoPlayerModal 监听 Escape） */
  _dispatchEscape() {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } catch {}
  }
}

export const nativePlayerBridge = new NativePlayerBridge();

// 竖滑手势配置（左/右半屏：亮度/音量/倍速）推送到原生壳：
// 模块加载时推一次当前值，面板改动经事件即时重推
import { getGestureSettings } from './gestureSettings';
function pushGestureSettings() {
  const plugin = getPlugin();
  if (!plugin || typeof plugin.setGestureConfig !== 'function') return;
  const s = getGestureSettings();
  plugin.setGestureConfig({ left: s.left, right: s.right }).catch(() => {});
}
if (isNativePlayerAvailable()) {
  pushGestureSettings();
  if (typeof window !== 'undefined') {
    window.addEventListener('faraday:gesture_settings_changed', pushGestureSettings);
  }
}

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
