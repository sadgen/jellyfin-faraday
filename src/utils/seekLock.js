/**
 * Seek 锁（Seek Lock）
 *
 * 提交 seek 后、视频真正到达目标位置前，video 的 timeupdate 仍按旧播放位置
 * 持续触发（跨缓冲区转码 seek 还要重开转码会话，耗时数秒）。这段时间内若
 * 放任 timeupdate 刷新进度条，就会出现「进度条先到目标位 → 弹回原位 →
 * 加载完成后又跳到目标位」的困惑体验。
 *
 * 用法：commit seek 前 arm(target)；timeupdate 里用 isActive() 守卫，
 * 视频 currentTime 逼近目标（±tolerance）时自动解除。
 * timeoutMs 是兜底：seek 失败回退到其他位置时锁不会永久卡死进度条。
 */

const DEFAULT_TOLERANCE_SEC = 1.5;
const DEFAULT_TIMEOUT_MS = 12000;
// 兜底上限：转码重启可能远超单次 timeout，但 seek 彻底失败时不能永久冻死进度条
const MAX_TOTAL_WAIT_MS = 60000;

export function createSeekLock({
  videoElRef,
  toleranceSec = DEFAULT_TOLERANCE_SEC,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  let pendingTarget = null;
  let timer = null;
  let armedAt = 0;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const release = () => {
    pendingTarget = null;
    clearTimer();
  };

  const resolveEl = () => {
    const raw = typeof videoElRef === 'function' ? videoElRef() : videoElRef;
    return raw?.current ?? raw;
  };

  const arm = (targetTime) => {
    if (typeof targetTime !== 'number' || isNaN(targetTime)) return;
    pendingTarget = targetTime;
    armedAt = Date.now();
    clearTimer();
    timer = setTimeout(checkTimeout, timeoutMs);
  };

  // 超时兜底：视频仍在寻轨/加载（seeking 或无数据）时说明 seek 还在路上，
  // 继续等待；只有视频状态健康却停在别处（seek 真正失败/被放弃）才放行
  const checkTimeout = () => {
    const videoEl = resolveEl();
    const waitingForStream = videoEl && (videoEl.seeking || (videoEl.readyState ?? 4) < 3);
    if (waitingForStream && Date.now() - armedAt < MAX_TOTAL_WAIT_MS) {
      timer = setTimeout(checkTimeout, timeoutMs);
      return;
    }
    release();
  };

  // 锁是否仍生效；视频已到达目标附近时自动解除并放行进度刷新
  const isActive = () => {
    if (pendingTarget === null) return false;
    const videoEl = resolveEl();
    if (videoEl && Math.abs((videoEl.currentTime || 0) - pendingTarget) <= toleranceSec) {
      release();
      return false;
    }
    return true;
  };

  const getPendingTarget = () => pendingTarget;

  return { arm, release, isActive, getPendingTarget };
}
