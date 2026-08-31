import Hls from 'hls.js';
import { jellyfin } from '../api/jellyfinClient';

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
    onAutoDirectFallback = null
  } = {}) {
    this.jellyfin = jellyfinClient;
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.onAutoDirectFallback = onAutoDirectFallback;

    this.videoEl = null;
    this.itemId = null;
    this.mediaSourceId = null;
    this.streamQuality = 'direct'; // 'direct' | '8000000' | '4000000' | '1000000' etc.
    this.audioStreamIndex = null;
    this.subtitleStreamIndex = null;

    this.playSessionId = null;
    this.generationId = 0;
    this.hlsInstance = null;
    this.playMethod = 'DirectPlay'; // 'DirectPlay' | 'Transcode'
    this.isDestroyed = false;

    this.reportTimer = null;
    this.pendingStopTimers = new Set();
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
   */
  isTranscoding() {
    return this.streamQuality !== 'direct' || this.playMethod === 'Transcode';
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
    volume = 1
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
    this.scheduleSessionStop(oldSession);

    this.itemId = itemId;
    this.mediaSourceId = mediaSourceId || itemId;
    this.streamQuality = streamQuality;
    this.audioStreamIndex = audioStreamIndex;
    this.subtitleStreamIndex = subtitleStreamIndex;
    this.mediaErrorRecoveries = 0;

    // 5. 为新播放流创建独立 PlaySessionId
    this.playSessionId = this.jellyfin.createPlaySessionId();

    if (!videoEl || !this.itemId) return;

    videoEl.playbackRate = playbackSpeed;
    videoEl.muted = isMuted;

    if (streamQuality === 'direct' && audioStreamIndex === null) {
      this.playMethod = 'DirectPlay';
      const directUrl = this.jellyfin.getStreamUrl(this.itemId);

      videoEl.removeAttribute('src');
      videoEl.src = directUrl;
      if (initialSeekTime > 0) {
        try {
          videoEl.currentTime = initialSeekTime;
        } catch {}
      }

      this.startHeartbeat();
      this.reportStarted(initialSeekTime);

      videoEl.play().catch(() => {
        if (this.generationId !== currentGeneration) return;
        videoEl.muted = true;
        videoEl.play().catch(() => {
          if (this.generationId !== currentGeneration) return;
          // 直连完全失败，通知上层回退到 HLS
          if (this.onAutoDirectFallback) {
            this.onAutoDirectFallback();
          }
        });
      });
    } else {
      this.playMethod = 'Transcode';
      const bitrate = parseInt(streamQuality, 10) || 4000000;

      const hlsUrl = this.jellyfin.getSmoothHlsUrl(this.itemId, bitrate, {
        playSessionId: this.playSessionId,
        mediaSourceId: this.mediaSourceId,
        audioStreamIndex: this.audioStreamIndex,
        subtitleStreamIndex: this.subtitleStreamIndex
      });

      this.initHls(hlsUrl, initialSeekTime, currentGeneration);
    }

    this.notifyState();
  }

  /**
   * 初始化 HLS 实例
   */
  initHls(hlsUrl, initialSeekTime, generation) {
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
        this.reportStarted(initialSeekTime);

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
      this.reportStarted(initialSeekTime);
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

    // 原画直推 或 处于转码但目标已在已下载的缓冲队列中
    if (!this.isTranscoding() || isTimeInBuffer(videoEl, clampedTime)) {
      videoEl.currentTime = clampedTime;
      this.reportProgress(clampedTime);
      return;
    }

    // 跨缓冲区转码 Seek：需要让 Jellyfin 从目标点重新切片
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
    if (qualityId === 'direct' && audioIdx !== null) {
      audioIdx = null; // 原画直推重置音轨选择
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
    const targetQuality = this.streamQuality !== 'direct' ? this.streamQuality : preferredQuality;
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
