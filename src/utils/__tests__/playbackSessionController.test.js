import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Hls from 'hls.js';
import { isRemoteNetwork, isHevc10VideoStream, canMsePlayVideoStream } from '../streamRouting';
import {
  isTimeInBuffer,
  secondsToTicks,
  PlaybackSessionController,
  HLS_DEFAULT_CONFIG,
  SESSION_STOP_DRAIN_MS
} from '../playbackSessionController';

vi.mock('hls.js', () => {
  class MockHls {
    static isSupported() {
      return true;
    }
    static Events = {
      MANIFEST_PARSED: 'hlsManifestParsed',
      ERROR: 'hlsError'
    };
    static ErrorTypes = {
      MEDIA_ERROR: 'mediaError',
      NETWORK_ERROR: 'networkError'
    };
    constructor(config) {
      this.config = config;
      this.loadSource = vi.fn();
      this.attachMedia = vi.fn();
      this.on = vi.fn();
      this.stopLoad = vi.fn();
      this.detachMedia = vi.fn();
      this.destroy = vi.fn();
      this.recoverMediaError = vi.fn();
      this.startLoad = vi.fn();
    }
  }
  return {
    default: MockHls
  };
});

vi.mock('../streamRouting', () => ({
  isRemoteNetwork: vi.fn(),
  isHevc10VideoStream: vi.fn(),
  canMsePlayVideoStream: vi.fn()
}));

// Helper to mock HTML5 TimeRanges
function createTimeRanges(ranges) {
  return {
    length: ranges.length,
    start: (index) => ranges[index][0],
    end: (index) => ranges[index][1]
  };
}

describe('playbackSessionController helpers', () => {
  it('keeps the original account for delayed session stop after switching accounts', async () => {
    vi.useFakeTimers();
    try {
      const stops = [];
      const client = {
        auth: { serverUrl: 'https://old.example', token: 'old-token' },
        stopTranscoding() { stops.push({ ...this.auth }); return Promise.resolve(true); },
      };
      const session = new PlaybackSessionController({ jellyfinClient: client });
      session.scheduleSessionStop({ itemId: 'old-item', playSessionId: 'old-session', positionSec: 12 });
      client.auth = { serverUrl: 'https://new.example', token: 'new-token' };
      vi.advanceTimersByTime(SESSION_STOP_DRAIN_MS + 1);
      expect(stops).toEqual([{ serverUrl: 'https://old.example', token: 'old-token' }]);
    } finally {
      vi.useRealTimers();
    }
  });
  it('secondsToTicks correctly converts seconds to 10-million ticks', () => {
    expect(secondsToTicks(0)).toBe(0);
    expect(secondsToTicks(1)).toBe(10000000);
    expect(secondsToTicks(72.5)).toBe(725000000);
    expect(secondsToTicks(-5)).toBe(0);
    expect(secondsToTicks(null)).toBe(0);
    expect(secondsToTicks(undefined)).toBe(0);
  });

  it('isTimeInBuffer correctly detects buffered ranges with margin', () => {
    const mockVideo = {
      buffered: createTimeRanges([
        [0, 30],
        [60, 120]
      ])
    };

    // Inside first range
    expect(isTimeInBuffer(mockVideo, 0)).toBe(true);
    expect(isTimeInBuffer(mockVideo, 15)).toBe(true);
    expect(isTimeInBuffer(mockVideo, 29)).toBe(true);

    // Outside (in the gap)
    expect(isTimeInBuffer(mockVideo, 45)).toBe(false);

    // Inside second range
    expect(isTimeInBuffer(mockVideo, 70)).toBe(true);
    expect(isTimeInBuffer(mockVideo, 119)).toBe(true);

    // Far ahead
    expect(isTimeInBuffer(mockVideo, 300)).toBe(false);

    // Edge cases
    expect(isTimeInBuffer(null, 10)).toBe(false);
    expect(isTimeInBuffer({}, 10)).toBe(false);
    expect(isTimeInBuffer(mockVideo, NaN)).toBe(false);
  });
});

describe('PlaybackSessionController', () => {
  let mockJellyfin;
  let mockVideo;
  let controller;

  beforeEach(() => {
    vi.useFakeTimers();
    // 默认按内网处理（保持既有直连测试的行为不变），新分流用例单独覆写
    isRemoteNetwork.mockResolvedValue(false);
    isHevc10VideoStream.mockReturnValue(false);
    canMsePlayVideoStream.mockReturnValue(true);
    let sessionCounter = 1;
    mockJellyfin = {
      auth: { serverUrl: 'https://jf.example', token: 'test-token', userId: 'u1' },
      createPlaySessionId: vi.fn(() => `test_session_${sessionCounter++}`),
      getStreamUrl: vi.fn((itemId) => `https://jf.example/stream/${itemId}`),
      getSmoothHlsUrl: vi.fn((itemId, bitrate, opts) => `https://jf.example/hls/${itemId}?bitrate=${bitrate}&ticks=${opts.startTimeTicks || 0}&sess=${opts.playSessionId}`),
      getRemuxHlsUrl: vi.fn((itemId, opts) => `https://jf.example/remux/${itemId}?codec=${opts.videoCodec}&sess=${opts.playSessionId}`),
      getItemPlaybackInfo: vi.fn().mockResolvedValue({
        MediaSources: [{
          MediaStreams: [{ Type: 'Video', Codec: 'hevc', Profile: 'Main 10', BitDepth: 10, CodecTag: 'hvc1' }]
        }]
      }),
      reportPlayback: vi.fn().mockResolvedValue(true),
      stopTranscoding: vi.fn().mockResolvedValue(true)
    };

    const eventListeners = {};
    mockVideo = {
      src: '',
      currentTime: 0,
      playbackRate: 1,
      muted: false,
      volume: 1,
      paused: false,
      removeAttribute: vi.fn(),
      load: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
      canPlayType: vi.fn().mockReturnValue('maybe'),
      buffered: createTimeRanges([[0, 20]]),
      addEventListener: vi.fn((type, fn) => {
        (eventListeners[type] = eventListeners[type] || []).push(fn);
      }),
      removeEventListener: vi.fn((type, fn) => {
        eventListeners[type] = (eventListeners[type] || []).filter((f) => f !== fn);
      })
    };
    mockVideo.fireEvent = (type) => {
      (eventListeners[type] || []).slice().forEach((fn) => fn({ type }));
    };

    controller = new PlaybackSessionController({
      jellyfinClient: mockJellyfin
    });
    controller.attachVideo(mockVideo);
  });

  afterEach(() => {
    controller.destroy();
    vi.advanceTimersByTime(SESSION_STOP_DRAIN_MS + 1);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('initializes DirectPlay correctly when streamQuality is direct', async () => {
    await controller.loadStream({
      itemId: 'item_100',
      streamQuality: 'direct',
      initialSeekTime: 12,
      playbackSpeed: 1.5,
      isMuted: false,
      volume: 0.8
    });

    expect(controller.playMethod).toBe('DirectPlay');
    expect(mockVideo.src).toBe('https://jf.example/stream/item_100');
    expect(mockVideo.currentTime).toBe(12);
    expect(mockVideo.playbackRate).toBe(1.5);

    // Started must wait for real playback, not fire on load
    expect(mockJellyfin.reportPlayback).not.toHaveBeenCalled();
    mockVideo.fireEvent('playing');
    expect(mockJellyfin.reportPlayback).toHaveBeenCalledWith(
      'item_100',
      12,
      false,
      'Started',
      expect.objectContaining({
        playMethod: 'DirectPlay'
      })
    );
  });

  it('routes external HEVC 10-bit direct playback through remux HLS (DirectStream)', async () => {
    isRemoteNetwork.mockResolvedValue(true);
    isHevc10VideoStream.mockReturnValue(true);
    canMsePlayVideoStream.mockReturnValue(true);

    await controller.loadStream({ itemId: 'item_358', streamQuality: 'direct' });

    expect(controller.playMethod).toBe('DirectStream');
    expect(mockJellyfin.getRemuxHlsUrl).toHaveBeenCalledWith('item_358', expect.objectContaining({
      playSessionId: expect.any(String),
      videoCodec: 'hevc'
    }));
    // 不再走静态直连 src；由 hls.js 接管（loadSource 收到串流地址）
    expect(mockVideo.src).not.toBe('https://jf.example/stream/item_358');
    expect(isHevc10VideoStream).toHaveBeenCalled();
    // 串流会话被视为转码态（跨缓冲 seek 走重启机制）
    expect(controller.isTranscoding()).toBe(true);
  });

  it('forces remux for explicit remux tier even on LAN (user-selected mode)', async () => {
    isRemoteNetwork.mockResolvedValue(false); // 局域网：显式档不看网络
    canMsePlayVideoStream.mockReturnValue(true);

    await controller.loadStream({ itemId: 'item_358', streamQuality: 'remux' });

    expect(controller.playMethod).toBe('DirectStream');
    expect(mockJellyfin.getRemuxHlsUrl).toHaveBeenCalledWith('item_358', expect.objectContaining({
      videoCodec: 'hevc'
    }));
    expect(mockVideo.src).not.toBe('https://jf.example/stream/item_358');
  });

  it('explicit remux tier carries source codec (h264 sources remux as h264)', async () => {
    isRemoteNetwork.mockResolvedValue(false);
    canMsePlayVideoStream.mockReturnValue(true);
    mockJellyfin.getItemPlaybackInfo.mockResolvedValueOnce({
      MediaSources: [{
        MediaStreams: [{ Type: 'Video', Codec: 'h264', Profile: 'High', CodecTag: 'avc1' }]
      }]
    });

    await controller.loadStream({ itemId: 'item_h264', streamQuality: 'remux' });

    expect(controller.playMethod).toBe('DirectStream');
    expect(mockJellyfin.getRemuxHlsUrl).toHaveBeenCalledWith('item_h264', expect.objectContaining({
      videoCodec: 'h264'
    }));
  });

  it('explicit remux tier falls back to direct play when MSE cannot feed the codec', async () => {
    isRemoteNetwork.mockResolvedValue(false);
    canMsePlayVideoStream.mockReturnValue(false);

    await controller.loadStream({ itemId: 'item_358', streamQuality: 'remux' });

    expect(controller.playMethod).toBe('DirectPlay');
    expect(mockJellyfin.getRemuxHlsUrl).not.toHaveBeenCalled();
    expect(mockVideo.src).toBe('https://jf.example/stream/item_358');
  });

  it('keeps direct play for HEVC 10-bit on LAN (remux only for external)', async () => {
    isRemoteNetwork.mockResolvedValue(false);
    isHevc10VideoStream.mockReturnValue(true);

    await controller.loadStream({ itemId: 'item_100', streamQuality: 'direct' });

    expect(controller.playMethod).toBe('DirectPlay');
    expect(mockJellyfin.getRemuxHlsUrl).not.toHaveBeenCalled();
    expect(mockVideo.src).toBe('https://jf.example/stream/item_100');
  });

  it('keeps direct play for external non-10bit videos (e.g. HEVC 8-bit / H.264)', async () => {
    isRemoteNetwork.mockResolvedValue(true);
    isHevc10VideoStream.mockReturnValue(false);

    await controller.loadStream({ itemId: 'item_639', streamQuality: 'direct' });

    expect(controller.playMethod).toBe('DirectPlay');
    expect(mockJellyfin.getRemuxHlsUrl).not.toHaveBeenCalled();
  });

  it('falls back to direct play when MSE cannot feed HEVC (old browsers)', async () => {
    isRemoteNetwork.mockResolvedValue(true);
    isHevc10VideoStream.mockReturnValue(true);
    canMsePlayVideoStream.mockReturnValue(false);

    await controller.loadStream({ itemId: 'item_358', streamQuality: 'direct' });

    expect(controller.playMethod).toBe('DirectPlay');
    expect(mockJellyfin.getRemuxHlsUrl).not.toHaveBeenCalled();
  });

  it('caches the remux route per item so cross-buffer seek restart does not re-probe', async () => {
    isRemoteNetwork.mockResolvedValue(true);
    isHevc10VideoStream.mockReturnValue(true);

    await controller.loadStream({ itemId: 'item_358', streamQuality: 'direct', initialSeekTime: 10 });
    // 跨缓冲 seek 重启：同条目再次 loadStream
    await controller.loadStream({ itemId: 'item_358', streamQuality: 'direct', initialSeekTime: 600 });

    expect(controller.playMethod).toBe('DirectStream');
    expect(mockJellyfin.getItemPlaybackInfo).toHaveBeenCalledTimes(1);
    expect(mockJellyfin.getRemuxHlsUrl).toHaveBeenCalledTimes(2);
  });

  it('sends a beacon Stopped report on pagehide to clean up server-side sessions', async () => {
    const beacons = [];
    const origSendBeacon = globalThis.navigator.sendBeacon;
    globalThis.navigator.sendBeacon = vi.fn((url, blob) => beacons.push({ url, blob }));
    try {
      await controller.loadStream({ itemId: 'item_358', streamQuality: 'direct' });
      mockVideo.currentTime = 42;

      window.dispatchEvent(new Event('pagehide'));
      expect(beacons.length).toBe(1);
      expect(beacons[0].url).toContain('/Sessions/Playing/Stopped?ApiKey=test-token');
      expect(beacons[0].blob.type).toBe('application/json');
      const body = JSON.parse(await beacons[0].blob.text());
      expect(body.ItemId).toBe('item_358');
      expect(body.EventName).toBe('Stopped');
      expect(body.PositionTicks).toBe(420000000);

      // destroy 摘除 handler：后续 pagehide 不再补发
      controller.destroy();
      window.dispatchEvent(new Event('pagehide'));
      expect(beacons.length).toBe(1);
    } finally {
      globalThis.navigator.sendBeacon = origSendBeacon;
    }
  });

  it('reports Started exactly once when a session is replaced before first play (StrictMode remount safe)', async () => {
    // First mount: session armed, then destroyed before playback starts
    await controller.loadStream({ itemId: 'item_800', streamQuality: 'direct', initialSeekTime: 5 });
    controller.destroy();

    // StrictMode remount: 组件 effect 重跑会先重新 attachVideo 再 loadStream
    controller.attachVideo(mockVideo);
    await controller.loadStream({ itemId: 'item_800', streamQuality: 'direct', initialSeekTime: 5 });
    expect(mockJellyfin.reportPlayback).not.toHaveBeenCalled();

    mockVideo.fireEvent('playing');
    const startedCalls = mockJellyfin.reportPlayback.mock.calls.filter((c) => c[3] === 'Started');
    expect(startedCalls).toHaveLength(1);
    expect(startedCalls[0][0]).toBe('item_800');
    expect(startedCalls[0][4]).toMatchObject({ playSessionId: 'test_session_2' });
  });

  it('never reports Started if playback never begins', async () => {
    await controller.loadStream({ itemId: 'item_900', streamQuality: 'direct' });
    vi.advanceTimersByTime(30000);

    const startedCalls = mockJellyfin.reportPlayback.mock.calls.filter((c) => c[3] === 'Started');
    expect(startedCalls).toHaveLength(0);
  });

  it('performs native seek when target time is in buffer during transcode mode', async () => {
    // Start transcode session
    controller.streamQuality = '4000000';
    controller.playMethod = 'Transcode';
    controller.itemId = 'item_200';
    controller.playSessionId = 'sess_existing';
    mockVideo.buffered = createTimeRanges([[0, 50]]);

    await controller.seek(25);

    // Target 25 is within [0, 50] buffer -> should directly set video.currentTime without recreating stream
    expect(mockVideo.currentTime).toBe(25);
    expect(mockJellyfin.stopTranscoding).not.toHaveBeenCalled();
    expect(mockJellyfin.reportPlayback).toHaveBeenCalledWith(
      'item_200',
      25,
      false,
      'Progress',
      expect.anything()
    );
  });

  it('performs reload seek with hls.js startPosition when target time is outside buffer', async () => {
    controller.streamQuality = '4000000';
    controller.playMethod = 'Transcode';
    controller.itemId = 'item_200';
    controller.playSessionId = 'sess_existing';
    mockVideo.buffered = createTimeRanges([[0, 20]]);

    // Seek to 1200 seconds (20 minutes)
    await controller.seek(1200);
    vi.advanceTimersByTime(SESSION_STOP_DRAIN_MS + 1);

    // Should stop old transcode session
    expect(mockJellyfin.stopTranscoding).toHaveBeenCalledWith(
      'item_200',
      'sess_existing',
      expect.anything()
    );

    // HLS URL should be requested WITHOUT StartTimeTicks (Jellyfin 10.11.11 forbidden)
    expect(mockJellyfin.getSmoothHlsUrl).toHaveBeenCalledWith(
      'item_200',
      4000000,
      expect.objectContaining({
        playSessionId: expect.any(String)
      })
    );
    expect(mockJellyfin.getSmoothHlsUrl).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        startTimeTicks: expect.anything()
      })
    );

    // hlsInstance should have startPosition set to target 1200
    expect(controller.hlsInstance?.config?.startPosition).toBe(1200);
  });

  it('fires onTranscodeSeekRestart only before a cross-buffer transcode restart', async () => {
    const onTranscodeSeekRestart = vi.fn();
    controller.onTranscodeSeekRestart = onTranscodeSeekRestart;
    controller.streamQuality = '4000000';
    controller.playMethod = 'Transcode';
    controller.itemId = 'item_400';
    controller.playSessionId = 'sess_frame';

    // 缓冲区内：原生定位，不重启流、不抓帧
    mockVideo.buffered = createTimeRanges([[0, 50]]);
    await controller.seek(25);
    expect(onTranscodeSeekRestart).not.toHaveBeenCalled();
    expect(mockVideo.currentTime).toBe(25);

    // 原画直推：原生 seek，不抓帧
    controller.streamQuality = 'direct';
    controller.playMethod = 'DirectPlay';
    mockVideo.buffered = createTimeRanges([[0, 20]]);
    await controller.seek(9999);
    expect(onTranscodeSeekRestart).not.toHaveBeenCalled();

    // 跨缓冲区转码 seek：重启前抓最后一帧
    controller.streamQuality = '4000000';
    controller.playMethod = 'Transcode';
    await controller.seek(1200);
    vi.advanceTimersByTime(SESSION_STOP_DRAIN_MS + 1);
    expect(onTranscodeSeekRestart).toHaveBeenCalledTimes(1);
    expect(onTranscodeSeekRestart).toHaveBeenCalledWith();
  });

  it('switches quality and stops previous transcode session', async () => {
    await controller.loadStream({
      itemId: 'item_300',
      streamQuality: '4000000'
    });

    const oldSessionId = controller.playSessionId;
    mockVideo.currentTime = 35;

    await controller.changeQuality('1000000');
    vi.advanceTimersByTime(SESSION_STOP_DRAIN_MS + 1);

    expect(mockJellyfin.stopTranscoding).toHaveBeenCalledWith(
      'item_300',
      oldSessionId,
      expect.objectContaining({
        positionSec: 35
      })
    );
    expect(controller.streamQuality).toBe('1000000');
    expect(controller.playSessionId).not.toBe(oldSessionId);
  });

  it('switches audio track, switches to transcode mode and stops previous session', async () => {
    await controller.loadStream({
      itemId: 'item_400',
      streamQuality: 'direct'
    });

    const oldSessionId = controller.playSessionId;
    mockVideo.currentTime = 50;

    await controller.changeAudioTrack(2, '8000000');
    vi.advanceTimersByTime(SESSION_STOP_DRAIN_MS + 1);

    expect(mockJellyfin.stopTranscoding).toHaveBeenCalledWith(
      'item_400',
      oldSessionId,
      expect.anything()
    );
    expect(controller.audioStreamIndex).toBe(2);
    expect(controller.streamQuality).toBe('8000000');
    expect(controller.playMethod).toBe('Transcode');
  });

  it('terminates client HLS requests before notifying server to stop transcoding', async () => {
    const callOrder = [];

    await controller.loadStream({
      itemId: 'item_600',
      streamQuality: '4000000'
    });

    const activeHls = controller.hlsInstance;
    activeHls.destroy = vi.fn(() => callOrder.push('hls.destroy'));
    activeHls.stopLoad = vi.fn(() => callOrder.push('hls.stopLoad'));
    activeHls.detachMedia = vi.fn(() => callOrder.push('hls.detachMedia'));
    mockJellyfin.stopTranscoding = vi.fn(async () => {
      callOrder.push('jellyfin.stopTranscoding');
      return true;
    });
    // 控制器带 auth 的客户端走浅拷贝（与生产一致），替换须挂到控制器实际持有的引用上
    controller.jellyfin.stopTranscoding = mockJellyfin.stopTranscoding;

    // Re-load stream to trigger cleanup of existing session
    await controller.loadStream({
      itemId: 'item_600',
      streamQuality: '1000000'
    });
    vi.advanceTimersByTime(SESSION_STOP_DRAIN_MS + 1);

    expect(callOrder).toEqual([
      'hls.stopLoad',
      'hls.detachMedia',
      'hls.destroy',
      'jellyfin.stopTranscoding'
    ]);
  });

  it('destroy drains client requests before stopping Jellyfin and resets video', () => {
    controller.itemId = 'item_500';
    controller.playSessionId = 'sess_clean';
    mockVideo.currentTime = 80;

    controller.destroy();

    expect(mockJellyfin.stopTranscoding).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SESSION_STOP_DRAIN_MS - 1);
    expect(mockJellyfin.stopTranscoding).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(mockJellyfin.stopTranscoding).toHaveBeenCalledWith(
      'item_500',
      'sess_clean',
      expect.objectContaining({
        positionSec: 80
      })
    );
    expect(mockVideo.removeAttribute).toHaveBeenCalledWith('src');
    expect(mockVideo.load).toHaveBeenCalled();
  });

  it('destroy is idempotent and schedules only one stop for an active session', () => {
    controller.itemId = 'item_700';
    controller.mediaSourceId = 'source_700';
    controller.playSessionId = 'sess_once';
    controller.playMethod = 'Transcode';
    mockVideo.currentTime = 42;

    controller.destroy();
    controller.destroy();
    vi.advanceTimersByTime(SESSION_STOP_DRAIN_MS);

    expect(mockJellyfin.stopTranscoding).toHaveBeenCalledTimes(1);
    expect(mockJellyfin.stopTranscoding).toHaveBeenCalledWith(
      'item_700',
      'sess_once',
      expect.objectContaining({
        positionSec: 42,
        mediaSourceId: 'source_700',
        playMethod: 'Transcode'
      })
    );
    expect(controller.itemId).toBeNull();
    expect(controller.mediaSourceId).toBeNull();
    expect(controller.playSessionId).toBeNull();
  });
});
