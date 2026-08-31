import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Hls from 'hls.js';
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

// Helper to mock HTML5 TimeRanges
function createTimeRanges(ranges) {
  return {
    length: ranges.length,
    start: (index) => ranges[index][0],
    end: (index) => ranges[index][1]
  };
}

describe('playbackSessionController helpers', () => {
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
    let sessionCounter = 1;
    mockJellyfin = {
      createPlaySessionId: vi.fn(() => `test_session_${sessionCounter++}`),
      getStreamUrl: vi.fn((itemId) => `https://jf.example/stream/${itemId}`),
      getSmoothHlsUrl: vi.fn((itemId, bitrate, opts) => `https://jf.example/hls/${itemId}?bitrate=${bitrate}&ticks=${opts.startTimeTicks || 0}&sess=${opts.playSessionId}`),
      reportPlayback: vi.fn().mockResolvedValue(true),
      stopTranscoding: vi.fn().mockResolvedValue(true)
    };

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
      buffered: createTimeRanges([[0, 20]])
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
