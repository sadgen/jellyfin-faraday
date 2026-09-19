import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSeekLock } from '../seekLock';

describe('createSeekLock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeVideo = (currentTime) => ({ currentTime });

  it('初始不锁定', () => {
    const lock = createSeekLock({ videoElRef: { current: makeVideo(0) } });
    expect(lock.isActive()).toBe(false);
    expect(lock.getPendingTarget()).toBeNull();
  });

  it('arm 后锁定，视频未到达目标时保持锁定', () => {
    const video = makeVideo(10);
    const lock = createSeekLock({ videoElRef: { current: video } });
    lock.arm(120);
    expect(lock.isActive()).toBe(true);
    expect(lock.getPendingTarget()).toBe(120);
    // timeupdate 仍在旧位置附近
    video.currentTime = 11;
    expect(lock.isActive()).toBe(true);
  });

  it('视频 currentTime 逼近目标（±容差）时自动解除', () => {
    const video = makeVideo(10);
    const lock = createSeekLock({ videoElRef: { current: video }, toleranceSec: 1.5 });
    lock.arm(120);
    video.currentTime = 119;
    expect(lock.isActive()).toBe(false);
    expect(lock.getPendingTarget()).toBeNull();
    // 解除后不再锁定
    video.currentTime = 10;
    expect(lock.isActive()).toBe(false);
  });

  it('超时兜底解除，避免 seek 失败卡死进度条', () => {
    const video = makeVideo(10);
    const lock = createSeekLock({ videoElRef: { current: video }, timeoutMs: 5000 });
    lock.arm(120);
    vi.advanceTimersByTime(5001);
    expect(lock.isActive()).toBe(false);
  });

  it('视频仍在寻轨/加载时超时不解除，继续等待', () => {
    const video = { currentTime: 10, readyState: 0, seeking: false };
    const lock = createSeekLock({ videoElRef: { current: video }, timeoutMs: 5000 });
    lock.arm(120);
    vi.advanceTimersByTime(5001);
    // 转码重启中（readyState 0）：锁保持，进度条不被旧位置刷回
    expect(lock.isActive()).toBe(true);
    // 流恢复且到达目标附近后正常解除
    video.readyState = 4;
    video.currentTime = 120.5;
    expect(lock.isActive()).toBe(false);
  });

  it('seeking 状态下超时不解除', () => {
    const video = { currentTime: 10, readyState: 4, seeking: true };
    const lock = createSeekLock({ videoElRef: { current: video }, timeoutMs: 5000 });
    lock.arm(120);
    vi.advanceTimersByTime(5001);
    expect(lock.isActive()).toBe(true);
    video.seeking = false;
    vi.advanceTimersByTime(5001);
    expect(lock.isActive()).toBe(false);
  });

  it('兜底等待有总上限（60s），彻底失败也会解除', () => {
    const video = { currentTime: 10, readyState: 0, seeking: false };
    const lock = createSeekLock({ videoElRef: { current: video }, timeoutMs: 5000 });
    lock.arm(120);
    vi.advanceTimersByTime(61000);
    expect(lock.isActive()).toBe(false);
  });

  it('重复 arm 覆盖旧目标并重置超时', () => {
    const video = makeVideo(10);
    const lock = createSeekLock({ videoElRef: { current: video }, timeoutMs: 5000 });
    lock.arm(120);
    vi.advanceTimersByTime(3000);
    lock.arm(300);
    vi.advanceTimersByTime(3000);
    expect(lock.isActive()).toBe(true);
    expect(lock.getPendingTarget()).toBe(300);
  });

  it('release 立即解除并清理定时器', () => {
    const video = makeVideo(10);
    const lock = createSeekLock({ videoElRef: { current: video }, timeoutMs: 5000 });
    lock.arm(120);
    lock.release();
    expect(lock.isActive()).toBe(false);
    expect(() => vi.advanceTimersByTime(10000)).not.toThrow();
  });

  it('非法目标（NaN）不触发锁定', () => {
    const lock = createSeekLock({ videoElRef: { current: makeVideo(10) } });
    lock.arm(NaN);
    expect(lock.isActive()).toBe(false);
  });

  it('videoElRef 为空时仍锁定（由超时兜底）', () => {
    const lock = createSeekLock({ videoElRef: { current: null } });
    lock.arm(120);
    expect(lock.isActive()).toBe(true);
  });

  it('videoElRef 支持函数形式', () => {
    const video = makeVideo(10);
    const lock = createSeekLock({ videoElRef: () => ({ current: video }) });
    lock.arm(120);
    expect(lock.isActive()).toBe(true);
    video.currentTime = 120.5;
    expect(lock.isActive()).toBe(false);
  });
});
