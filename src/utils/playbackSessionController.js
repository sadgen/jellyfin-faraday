import Hls from 'hls.js';
import { jellyfin } from '../api/jellyfinClient';
import { isNativePlayerAvailable, nativePlayerBridge } from './nativePlayerBridge';
import { isRemoteNetwork, isHevc10VideoStream, canMsePlayVideoStream } from './streamRouting';

/**
 * 默认统一 HLS 配置（遵循 JELLYFIN_PLAYBACK_FIX_PLAN.md）
 */
export const HLS_DEFAULT_CONFIG = {
  enableWorker: true,
  lowLatencyMode: false,
  backBufferLength: 120,
  maxBufferLength: 60,
  maxMaxBufferLength: 120,
  manifestLoadingTimeOut: 15000,
  manifestLoadingMaxRetry: 3,
  levelLoadingTimeOut: 15000,
  levelLoadingMaxRetry: 3,
  fragLoadingTimeOut: 20000,
  fragLoadingMaxRetry: 4
};

// Give aborted HLS requests a brief chance to reach Jellyfin before the
// corresponding playback session removes its transcode segments.
export const SESSION_STOP_DRAIN_MS = 150;

/**
 * 检查目标时间是否在 HTML5 Video 已缓冲的片段范围内
 * @param {HTMLVideoElement} videoEl
 * @param {number} targetTime - 目标时间（秒）
 * @param {number} bufferMargin - 缓冲边缘安全余量（秒，默认 0.5）
 * @returns {boolean}
 */
export function isTimeInBuffer(videoEl, targetTime, bufferMargin = 0.5) {
  if (!videoEl || !videoEl.buffered || typeof targetTime !== 'number' || isNaN(targetTime)) {
    return false;
  }
  const buffered = videoEl.buffered;
  const count = buffered.length;
  for (let i = 0; i < count; i++) {
    const start = buffered.start(i);
    const end = buffered.end(i);
    // 如果目标时间落在当前缓冲区间内（且距离右侧边界有余量）
    if (targetTime >= start && targetTime <= Math.max(start, end - bufferMargin)) {
      return true;
    }
  }
  return false;
}

/**
 * 将秒转换为 Jellyfin Ticks (1秒 = 10,000,000 Ticks)
 * @param {number} seconds
 * @returns {number}
 */
export function secondsToTicks(seconds) {
  if (!seconds || seconds <= 0 || isNaN(seconds)) return 0;
  return Math.floor(seconds * 10000000);
}

/**
 * 播放会话控制器类
 * 统管 DirectPlay / Transcode HLS、世代标记（防止陈旧事件覆盖）、缓冲感知 Seek 及 Jellyfin 会话生命周期
 */
export class PlaybackSessionController {
  constructor({
    jellyfinClient = jellyfin,
    onStateChange = null,
    onError = null,
    onAutoDirectFallback = null,
    onTranscodeSeekRestart = null,
    onStreamRoute = null
  } = {}) {
    // Each controller owns the credentials of the account that created it.
    this.jellyfin = jellyfinClient.auth
      ? Object.assign(Object.create(Object.getPrototypeOf(jellyfinClient)), jellyfinClient, { auth: { ...jellyfinClient.auth } })
      : jellyfinClient;
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.onAutoDirectFallback = onAutoDirectFallback;
    // 跨缓冲转码 seek 重启流之前、video 尚未清空时同步触发（UI 可抓最后一帧做加载底图）
    this.onTranscodeSeekRestart = onTranscodeSeekRestart;
    // 原画档自动分流结果回调（mode: 'auto-remux'）——UI 据此 toast 告知用户实际走的路
    this.onStreamRoute = onStreamRoute;

    this.videoEl = null;
    this.itemId = null;
    this.mediaSourceId = null;
    this.streamQuality = 'direct'; // 'direct' | 'remux' | '8000000' | '4000000' | '1000000' etc.
    this.audioStreamIndex = null;
    this.subtitleStreamIndex = null;

    this.playSessionId = null;
    this.generationId = 0;
    this.hlsInstance = null;
    this.playMethod = 'DirectPlay'; // 'DirectPlay' | 'DirectStream' | 'Transcode'
    this.isDestroyed = false;

    this.reportTimer = null;
    this.pendingStopTimers = new Set();
    this.startedArmRemover = null;
    this.lastReportedPosition = 0;
    this.mediaErrorRecoveries = 0;
    this.maxMediaErrorRecoveries = 2;
  }

  /**
   * 绑定 DOM Video 元素
   */
  attachVideo(videoEl) {
    this.videoEl = videoEl;
  }

  /**
   * 获取当前播放模式
   * DirectStream（原样串流）与转码一样持有服务端 ffmpeg 会话，
   * 跨缓冲 seek 必须走"快照遮罩 + 重启会话"路径，不能当直连处理
   */
  isTranscoding() {
    return (
      this.streamQuality !== 'direct' ||
      this.playMethod === 'Transcode' ||
      this.playMethod === 'DirectStream'
    );
  }

  /**
   * 启动或切换播放会话
   */
  async loadStream({
    itemId,
    mediaSourceId = null,
    streamQuality = 'direct',
    audioStreamIndex = null,
    subtitleStreamIndex = null,
    initialSeekTime = 0,
    playbackSpeed = 1,
    isMuted = false,
    volume = 1,
    nativeFloating = false,
    autoPlay = true
  }) {
    this.isDestroyed = false;

    // 1. 递增 generationId，使之前正在进行中的旧异步回调失效
    this.generationId++;
    const currentGeneration = this.generationId;

    const videoEl = this.videoEl;

    // 2. 必须在清空媒体源前先保存当前播放位置与旧会话上下文
    const oldSession = this.snapshotSession(videoEl?.currentTime);

    // 3. 先停止心跳、终止客户端 HLS 加载与网络拉取、解绑视频元素
    this.stopHeartbeat();
    this.destroyHls();

    if (videoEl) {
      try {
        videoEl.removeAttribute('src');
        videoEl.load();
      } catch {}
    }

    // 4. 客户端请求终止后，留出短暂网络排空缓冲（150ms），确保客户端已发送的取消信号
    // 先于服务端的转码目录删除到达，彻底消除 Could not find file 404 竞态
    // 安卓壳模式下 web 侧从未向服务器上报过会话，无旧会话可停
    if (!isNativePlayerAvailable()) {
      this.scheduleSessionStop(oldSession);
    }

    this.itemId = itemId;
    this.mediaSourceId = mediaSourceId || itemId;
    this.streamQuality = streamQuality;
    this.audioStreamIndex = audioStreamIndex;
    this.subtitleStreamIndex = subtitleStreamIndex;
    this.mediaErrorRecoveries = 0;

    // 5. 为新播放流创建独立 PlaySessionId
    this.playSessionId = this.jellyfin.createPlaySessionId();

    // 5.5 武装突然关页兜底：手机划掉标签/浏览器关闭时 destroy 不会执行，
    // 服务端转码/串流切片会滞留到会话超时（remux 全速切片滞留可达数 GB）。
    // pagehide 在移动端可靠触发，sendBeacon 补发 Stopped（带不了 Authorization
    // 头，鉴权走 ApiKey query 参数，端点已实测接受）
    if (!isNativePlayerAvailable()) {
      this.armPageHideStop();
    }

    if (!videoEl || !this.itemId) return;

    // 安卓壳（Capacitor）：原生 ExoPlayer 全权接管播放与 Jellyfin PlaybackEvents
    // 上报，页面 video 元素退化为状态镜像。web 侧不武装 Started/心跳，防止双计。
    if (isNativePlayerAvailable()) {
      // 原生 ExoPlayer 直推无浏览器缓冲短板，「串流」档在壳内等价原画直推
      this.playMethod =
        (streamQuality === 'direct' || streamQuality === 'remux') && audioStreamIndex === null
          ? 'DirectPlay'
          : 'Transcode';
      const streamUrl =
        this.playMethod === 'DirectPlay'
          ? this.jellyfin.getStreamUrl(this.itemId)
          : this.jellyfin.getSmoothHlsUrl(this.itemId, parseInt(streamQuality, 10) || 4000000, {
              playSessionId: this.playSessionId,
              mediaSourceId: this.mediaSourceId,
              audioStreamIndex: this.audioStreamIndex,
              subtitleStreamIndex: this.subtitleStreamIndex
            });
      this.notifyState();
      await nativePlayerBridge.loadStream(this, {
        itemId: this.itemId,
        mediaSourceId: this.mediaSourceId,
        playMethod: this.playMethod,
        streamUrl,
        initialSeekTime,
        audioStreamIndex: this.audioStreamIndex,
        subtitleStreamIndex: this.subtitleStreamIndex,
        floating: nativeFloating
      });
      return;
    }

    videoEl.playbackRate = playbackSpeed;
    videoEl.muted = isMuted;

    // Started 上报武装到"实际开始播放"事件：会话在首帧前被替换（dev StrictMode
    // 双挂载、直连失败回退、重载流）时不得向 Jellyfin 发送 PlaybackStart，
    // 否则服务器会为一次开窗记录两次播放
    this.armStartedReport(initialSeekTime);

    // 原画直连 = 渐进式静态流：起播零服务端开销、seek 走 HTTP Range 即时响应，
    // 由浏览器/设备硬解原文件（HEVC VR 源同样直接播）。
    // 历史注记：曾全局试验 HLS DirectStream remux 已回退（连局域网也换串流，起播与
    // seek 全面劣化）；2026-11-08 重新引入但收窄为「外网 + HEVC 10-bit」条件分流
    // （局域网 / 8-bit 保持直连秒开，见 shouldRemuxDirectStream）。
    if ((streamQuality === 'direct' || streamQuality === 'remux') && audioStreamIndex === null) {
      // 原画档路由：'direct' 在外网 + HEVC 10-bit 时自动改走原样串流（Remux HLS，
      // -c copy 零重编码保原画质，换取 hls.js 60~120s 缓冲垫；局域网 / 非 10-bit
      // 一律直连，秒开体验不变）；'remux' 为用户显式选择的串流档，不看网络不看位深，
      // h264/hevc 均可原样串流。探测/判定任一步失败都回落直连，绝不因新逻辑引入起播回归
      const forced = streamQuality === 'remux';
      const route = await this.resolveDirectRoute(forced);
      if (this.generationId !== currentGeneration) return;
      if (route?.useRemux) {
        this.playMethod = 'DirectStream';
        const remuxUrl = this.jellyfin.getRemuxHlsUrl(this.itemId, {
          playSessionId: this.playSessionId,
          mediaSourceId: this.mediaSourceId,
          videoCodec: route.videoCodec
        });
        this.initHls(remuxUrl, initialSeekTime, currentGeneration, autoPlay);
        // 自动分流对用户透明，回调让 UI toast 告知实际模式（显式档用户自己选的，不提示）
        if (!forced && this.onStreamRoute) {
          try {
            this.onStreamRoute({ mode: 'auto-remux', videoCodec: route.videoCodec });
          } catch {}
        }
        this.notifyState();
        return;
      }
      this.playMethod = 'DirectPlay';
      const directUrl = this.jellyfin.getStreamUrl(this.itemId);

      videoEl.removeAttribute('src');
      videoEl.src = directUrl;

      if (autoPlay) {
        if (initialSeekTime > 0) {
          try {
            videoEl.currentTime = initialSeekTime;
          } catch {}
        }

        this.startHeartbeat();

        videoEl.play().catch((firstErr) => {
          if (this.generationId !== currentGeneration) return;
          videoEl.muted = true;
          videoEl.play().catch((secondErr) => {
            if (this.generationId !== currentGeneration) return;
            const err = secondErr || firstErr;
            // 自动播放策略被拒（NotAllowedError）：流本身没有问题，转码也救不了，
            // 保持暂停等用户手势即可，绝不触发回退（曾经的"意外跳 4M"来源之一）
            if (err && err.name === 'NotAllowedError') return;
            // 直连完全失败（如浏览器无该编码硬解），通知上层回退到转码，携带失败原因
            if (this.onAutoDirectFallback) {
              this.onAutoDirectFallback({
                errorName: (err && err.name) || 'UnknownError',
                message: (err && err.message) || ''
              });
            }
          });
        });
      } else {
        // 暂停起播：仅拉流缓冲不出声（随机多窗副窗模式），起播点交给组件的 loadedmetadata 监听
        videoEl.preload = 'auto';
        videoEl.load();
        this.startHeartbeat();
      }
    } else {
      this.playMethod = 'Transcode';
      const bitrate = parseInt(streamQuality, 10) || 4000000;
      const hlsUrl = this.jellyfin.getSmoothHlsUrl(this.itemId, bitrate, {
        playSessionId: this.playSessionId,
        mediaSourceId: this.mediaSourceId,
        audioStreamIndex: this.audioStreamIndex,
        subtitleStreamIndex: this.subtitleStreamIndex
      });

      this.initHls(hlsUrl, initialSeekTime, currentGeneration, autoPlay);
    }

    this.notifyState();
  }

  /**
   * 原画档串流路由判定（按条目缓存，跨缓冲 seek 重启不重复探测）。
   * 自动档（force=false）依次确认：① 客户端到服务器是高延迟链路（外网/跨网段）；
   * ② 该视频是 HEVC 10-bit（PlaybackInfo 的 Codec/Profile/BitDepth）；③ 浏览器 MSE
   * 能喂该流。显式档（force=true）跳过网络判定，h264/hevc 均可原样串流。
   * 任一步不成立或失败都回落直连（保持现状）。
   * @param {boolean} force - 用户显式选择「串流」档
   * @returns {Promise<{itemId: string, useRemux: boolean, videoCodec: string|null}>}
   */
  async resolveDirectRoute(force = false) {
    if (this._directRoute?.itemId === this.itemId) {
      return this._directRoute;
    }
    const serverUrl = this.jellyfin?.auth?.serverUrl;
    let useRemux = false;
    let videoCodec = null;
    try {
      const remote = serverUrl ? await isRemoteNetwork(serverUrl) : false;
      if (remote || force) {
        const info = await this.jellyfin.getItemPlaybackInfo(this.itemId);
        const video = (info?.MediaSources?.[0]?.MediaStreams || []).find(s => s.Type === 'Video');
        const codec = String(video?.Codec || '').toLowerCase();
        const eligible = force
          ? codec === 'hevc' || codec === 'h264'
          : isHevc10VideoStream(video);
        if (eligible && canMsePlayVideoStream(video)) {
          useRemux = true;
          videoCodec = codec;
        }
      }
    } catch {}
    this._directRoute = { itemId: this.itemId, useRemux, videoCodec };
    return this._directRoute;
  }

  /**
   * 初始化 HLS 实例
   */
  initHls(hlsUrl, initialSeekTime, generation, autoPlay = true) {
    const videoEl = this.videoEl;
    if (!videoEl) return;

    this.destroyHls();
    videoEl.removeAttribute('src');
    videoEl.load();

    if (Hls.isSupported()) {
      const hls = new Hls({
        ...HLS_DEFAULT_CONFIG,
        startPosition: initialSeekTime > 0 ? initialSeekTime : -1
      });
      this.hlsInstance = hls;

      hls.loadSource(hlsUrl);
      hls.attachMedia(videoEl);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (this.generationId !== generation) return;
        this.startHeartbeat();

        if (!autoPlay) return;
        videoEl.play().catch(() => {
          if (this.generationId !== generation) return;
          videoEl.muted = true;
          videoEl.play().catch(() => {});
        });
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (this.generationId !== generation) return;
        if (!data.fatal) return;

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && this.mediaErrorRecoveries < this.maxMediaErrorRecoveries) {
          this.mediaErrorRecoveries++;
          hls.recoverMediaError();
        } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else {
          this.destroyHls();
          if (this.onError) {
            this.onError(data);
          }
        }
      });
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = hlsUrl;
      if (initialSeekTime > 0) {
        try {
          videoEl.currentTime = initialSeekTime;
        } catch {}
      }
      this.startHeartbeat();
      if (!autoPlay) return;
      videoEl.play().catch(() => {
        if (this.generationId !== generation) return;
        videoEl.muted = true;
        videoEl.play().catch(() => {});
      });
    } else {
      if (this.onError) {
        this.onError({ fatal: true, type: 'UNSUPPORTED', details: 'HLS not supported in this browser' });
      }
    }
  }

  /**
   * 智能定位（Seek）
   * 1. DirectPlay: 原生 seek
   * 2. Transcode + 目标在缓冲区内: 原生 seek (<0.5s 瞬时响应)
   * 3. Transcode + 目标超出缓冲区: 销毁旧转码、带 StartTimeTicks 重启新会话，防止服务端从 0 追赶
   * @param {number} targetTime - 目标时间（秒）
   */
  async seek(targetTime) {
    const videoEl = this.videoEl;
    if (!videoEl || !this.itemId || typeof targetTime !== 'number' || isNaN(targetTime)) return;

    const clampedTime = Math.max(0, targetTime);
    this.lastReportedPosition = clampedTime;

    // 安卓壳：seek 一律交原生（ExoPlayer 流内 seek / HLS 播放列表自适应）
    if (isNativePlayerAvailable()) {
      nativePlayerBridge.seek(this.itemId, clampedTime);
      return;
    }

    // 原画直推 或 处于转码但目标已在已下载的缓冲队列中
    if (!this.isTranscoding() || isTimeInBuffer(videoEl, clampedTime)) {
      videoEl.currentTime = clampedTime;
      this.reportProgress(clampedTime);
      return;
    }

    // 跨缓冲区转码 Seek：需要让 Jellyfin 从目标点重新切片
    if (this.onTranscodeSeekRestart) {
      try {
        this.onTranscodeSeekRestart();
      } catch {}
    }
    const currentSpeed = videoEl.playbackRate || 1;
    const isMuted = videoEl.muted || false;
    const volume = videoEl.volume || 1;

    await this.loadStream({
      itemId: this.itemId,
      mediaSourceId: this.mediaSourceId,
      streamQuality: this.streamQuality,
      audioStreamIndex: this.audioStreamIndex,
      subtitleStreamIndex: this.subtitleStreamIndex,
      initialSeekTime: clampedTime,
      playbackSpeed: currentSpeed,
      isMuted,
      volume
    });
  }

  /**
   * 切换画质
   */
  async changeQuality(qualityId) {
    if (this.streamQuality === qualityId) return;
    const currentPos = this.videoEl?.currentTime || this.lastReportedPosition || 0;
    let audioIdx = this.audioStreamIndex;
    if ((qualityId === 'direct' || qualityId === 'remux') && audioIdx !== null) {
      audioIdx = null; // 原画档（直推/串流）重置音轨选择
    }
    const currentSpeed = this.videoEl?.playbackRate || 1;
    const isMuted = this.videoEl?.muted || false;
    const volume = this.videoEl?.volume || 1;

    await this.loadStream({
      itemId: this.itemId,
      mediaSourceId: this.mediaSourceId,
      streamQuality: qualityId,
      audioStreamIndex: audioIdx,
      subtitleStreamIndex: this.subtitleStreamIndex,
      initialSeekTime: currentPos,
      playbackSpeed: currentSpeed,
      isMuted,
      volume
    });
  }

  /**
   * 切换音轨（自动进入转码模式并保留播放时间）
   */
  async changeAudioTrack(streamIndex, preferredQuality = '8000000') {
    if (this.audioStreamIndex === streamIndex) return;
    const currentPos = this.videoEl?.currentTime || this.lastReportedPosition || 0;
    // 原画档（直推/串流）无法指定音轨，切音轨回落转码档
    const targetQuality =
      this.streamQuality !== 'direct' && this.streamQuality !== 'remux'
        ? this.streamQuality
        : preferredQuality;
    const currentSpeed = this.videoEl?.playbackRate || 1;
    const isMuted = this.videoEl?.muted || false;
    const volume = this.videoEl?.volume || 1;

    await this.loadStream({
      itemId: this.itemId,
      mediaSourceId: this.mediaSourceId,
      streamQuality: targetQuality,
      audioStreamIndex: streamIndex,
      subtitleStreamIndex: this.subtitleStreamIndex,
      initialSeekTime: currentPos,
      playbackSpeed: currentSpeed,
      isMuted,
      volume
    });
  }

  /**
   * 武装 Started 上报：挂一次性 playing 监听，首帧真正播出时才发送 PlaybackStart。
   * 只按 generation 放行，被替换/销毁的旧会话永远不上报，避免重复计播。
   */
  armStartedReport(positionSec = 0) {
    this.clearStartedArm();
    const videoEl = this.videoEl;
    if (!videoEl || typeof videoEl.addEventListener !== 'function') {
      // 无 DOM 事件能力的兜底（理论仅测试环境）：退回立即上报
      this.reportStarted(positionSec);
      return;
    }
    const generation = this.generationId;
    const onPlaying = () => {
      if (this.generationId !== generation || this.isDestroyed) return;
      const position = Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : positionSec;
      this.clearStartedArm();
      this.reportStarted(position);
    };
    videoEl.addEventListener('playing', onPlaying, { once: true });
    this.startedArmRemover = () => {
      videoEl.removeEventListener('playing', onPlaying);
    };
  }

  /**
   * 解除 Started 上报武装（会话替换、销毁时调用）
   */
  clearStartedArm() {
    if (this.startedArmRemover) {
      try {
        this.startedArmRemover();
      } catch {}
      this.startedArmRemover = null;
    }
  }

  /**
   * 上报 Started
   */
  reportStarted(positionSec = 0) {
    if (!this.itemId || !this.playSessionId) return;
    this.lastReportedPosition = positionSec;
    this.jellyfin.reportPlayback(this.itemId, positionSec, false, 'Started', {
      playSessionId: this.playSessionId,
      mediaSourceId: this.mediaSourceId,
      playMethod: this.playMethod,
      volumeLevel: this.videoEl ? Math.round(this.videoEl.volume * 100) : 100,
      playbackRate: this.videoEl?.playbackRate || 1,
      audioStreamIndex: this.audioStreamIndex,
      subtitleStreamIndex: this.subtitleStreamIndex,
      isMuted: Boolean(this.videoEl?.muted)
    }).catch(() => {});
  }

  /**
   * 上报 Progress
   */
  reportProgress(positionSec = 0, isPaused = false) {
    if (!this.itemId || !this.playSessionId) return;
    this.lastReportedPosition = positionSec;
    this.jellyfin.reportPlayback(this.itemId, positionSec, isPaused, 'Progress', {
      playSessionId: this.playSessionId,
      mediaSourceId: this.mediaSourceId,
      playMethod: this.playMethod,
      volumeLevel: this.videoEl ? Math.round(this.videoEl.volume * 100) : 100,
      playbackRate: this.videoEl?.playbackRate || 1,
      audioStreamIndex: this.audioStreamIndex,
      subtitleStreamIndex: this.subtitleStreamIndex,
      isMuted: Boolean(this.videoEl?.muted)
    }).catch(() => {});
  }

  /**
   * 启动 10s 心跳上报定时器
   */
  startHeartbeat() {
    this.stopHeartbeat();
    this.reportTimer = setInterval(() => {
      if (this.videoEl && !this.videoEl.paused && this.videoEl.currentTime > 0) {
        this.reportProgress(this.videoEl.currentTime, false);
      }
    }, 10000);
  }

  /**
   * 停止心跳上报
   */
  stopHeartbeat() {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = null;
    }
  }

  /**
   * Capture an immutable playback-session snapshot before clearing the media
   * element. video.load() may reset currentTime to zero.
   */
  snapshotSession(positionSec = null) {
    if (!this.itemId || !this.playSessionId) return null;
    const safePosition = Number.isFinite(positionSec)
      ? positionSec
      : (Number.isFinite(this.lastReportedPosition) ? this.lastReportedPosition : 0);
    return {
      itemId: this.itemId,
      playSessionId: this.playSessionId,
      mediaSourceId: this.mediaSourceId,
      playMethod: this.playMethod,
      positionSec: safePosition
    };
  }

  /**
   * Stop a captured Jellyfin session after in-flight HLS requests have had a
   * chance to observe the client-side abort. The snapshot prevents a delayed
   * stop from targeting a newer session on the same controller.
   */
  scheduleSessionStop(session) {
    if (!session?.itemId || !session?.playSessionId) return null;

    const timerId = setTimeout(() => {
      this.pendingStopTimers.delete(timerId);
      try {
        Promise.resolve(this.jellyfin.stopTranscoding(session.itemId, session.playSessionId, {
          positionSec: session.positionSec,
          mediaSourceId: session.mediaSourceId,
          playMethod: session.playMethod
        })).catch(() => {});
      } catch {}
    }, SESSION_STOP_DRAIN_MS);
    this.pendingStopTimers.add(timerId);
    return timerId;
  }

  /**
   * 突然关页兜底：pagehide 时以 sendBeacon 补发 Stopped（会话与位置实时读取，
   * 会话被正常替换/销毁后 handler 已摘除或身份为空，不会误报新会话）。
   */
  armPageHideStop() {
    this.clearPageHideStop();
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const handler = () => {
      try {
        const auth = this.jellyfin?.auth;
        if (!auth?.serverUrl || !this.itemId || !this.playSessionId) return;
        const posSec = this.videoEl?.currentTime ?? this.lastReportedPosition ?? 0;
        const body = {
          ItemId: this.itemId,
          PositionTicks: Math.floor(posSec * 10000000),
          PlaySessionId: this.playSessionId,
          MediaSourceId: this.mediaSourceId,
          PlayMethod: this.playMethod,
          EventName: 'Stopped'
        };
        const url = `${auth.serverUrl}/Sessions/Playing/Stopped?ApiKey=${encodeURIComponent(auth.token)}`;
        globalThis.navigator?.sendBeacon?.(
          url,
          new Blob([JSON.stringify(body)], { type: 'application/json' })
        );
      } catch {}
    };
    window.addEventListener('pagehide', handler);
    this.pageHideRemover = () => window.removeEventListener('pagehide', handler);
  }

  clearPageHideStop() {
    if (this.pageHideRemover) {
      try {
        this.pageHideRemover();
      } catch {}
      this.pageHideRemover = null;
    }
  }

  /**
   * 销毁 HLS 实例并终止所有在途分片加载
   */
  destroyHls() {
    if (this.hlsInstance) {
      try {
        this.hlsInstance.stopLoad?.();
        this.hlsInstance.detachMedia?.();
        this.hlsInstance.destroy?.();
      } catch {}
      this.hlsInstance = null;
    }
  }

  /**
   * 状态变动回调通知
   */
  notifyState() {
    if (this.onStateChange) {
      this.onStateChange({
        playSessionId: this.playSessionId,
        playMethod: this.playMethod,
        streamQuality: this.streamQuality,
        audioStreamIndex: this.audioStreamIndex,
        subtitleStreamIndex: this.subtitleStreamIndex,
        generationId: this.generationId
      });
    }
  }

  /**
   * 销毁整个播放控制器并释放服务端与客户端资源
   */
  destroy() {
    this.isDestroyed = true;
    this.generationId++;
    this.stopHeartbeat();
    this.clearStartedArm();
    this.clearPageHideStop();

    // 安卓壳：web 侧会话从未上报服务器，结束交原生（Stopped/资源释放）
    if (isNativePlayerAvailable()) {
      nativePlayerBridge.notifyClosed(this.itemId);
      const oldVideoEl = this.videoEl;
      this.itemId = null;
      this.mediaSourceId = null;
      this.playSessionId = null;
      this.destroyHls();
      if (oldVideoEl) {
        try {
          oldVideoEl.removeAttribute('src');
          oldVideoEl.load();
        } catch {}
        this.videoEl = null;
      }
      return;
    }

    // 1. 优先保存最后播放位置与旧会话上下文（在清空 src 前）
    const oldVideoEl = this.videoEl;
    const oldSession = this.snapshotSession(oldVideoEl?.currentTime);

    // Clear the active identity immediately so repeated cleanup calls cannot
    // schedule duplicate Stopped reports for the same session.
    this.itemId = null;
    this.mediaSourceId = null;
    this.playSessionId = null;

    // 2. 先终止客户端 HLS 加载与视频元素
    this.destroyHls();
    if (oldVideoEl) {
      try {
        oldVideoEl.removeAttribute('src');
        oldVideoEl.load();
      } catch {}
      this.videoEl = null;
    }

    // 3. 与 loadStream 使用同一网络排空窗口，再通知服务端结束转码
    this.scheduleSessionStop(oldSession);
  }
}
