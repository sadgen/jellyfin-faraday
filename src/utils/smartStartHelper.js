/**
 * Smart Start / Intro Skip Helper
 *
 * Determines optimal initial playback seek time based on:
 * 1. User explicit seek / start time (highest priority, 0 is respected)
 * 2. Jellyfin server resume position (PlaybackPositionTicks)
 * 3. Smart intro skip (if enabled):
 *    - Jellyfin Chapters (Intro / Opening / Chapter 2 start point)
 *    - Long videos (>= 10m): 25%~35% golden point (bypasses long intros/logos)
 *    - Medium videos (2~10m): 10%~15% intro skip (bypasses 15~30s opening)
 *    - Short videos (1~2m): 5~10s skip
 *    - Very short clips (< 1m): start at 0
 */

export function calculateSmartStartTime(item, options = {}) {
  const {
    explicitStartSecond = null,
    smartStartEnabled = false,
    duration = 0,
    randomFactor = null // Can pass a fixed value for deterministic unit testing
  } = options;

  // 1. Explicit user target takes highest priority (0 is a valid seek target, e.g. "Play from beginning")
  if (explicitStartSecond !== null && explicitStartSecond !== undefined && !isNaN(explicitStartSecond)) {
    return Math.max(0, Number(explicitStartSecond));
  }

  // 2. Server resume position ticks
  const resumeTicks = item?.UserData?.PlaybackPositionTicks;
  if (typeof resumeTicks === 'number' && resumeTicks > 0) {
    return resumeTicks / 10000000;
  }

  // If smart start is not enabled, start at 0
  if (!smartStartEnabled) {
    return 0;
  }

  // Determine runtime in seconds (video element duration or item RunTimeTicks)
  const runtimeSec = (duration && duration > 0)
    ? duration
    : (item?.RunTimeTicks ? item.RunTimeTicks / 10000000 : 0);

  if (!runtimeSec || runtimeSec <= 0) {
    return 0;
  }

  // 3. Check for Jellyfin Chapters / Intro markers
  if (item?.Chapters && Array.isArray(item.Chapters) && item.Chapters.length > 1) {
    const firstChapter = item.Chapters[0];
    const secondChapter = item.Chapters[1];
    const firstChapterName = (firstChapter?.Name || '').toLowerCase();
    const secondChapterSec = (secondChapter?.StartPositionTicks || 0) / 10000000;

    const isExplicitIntroChapter = /intro|opening|op|片头|前奏|序幕|prologue/.test(firstChapterName);
    if (isExplicitIntroChapter && secondChapterSec > 0 && secondChapterSec < runtimeSec * 0.5) {
      return Math.round(secondChapterSec);
    }
    if (secondChapterSec > 0 && secondChapterSec <= Math.min(180, runtimeSec * 0.3)) {
      return Math.round(secondChapterSec);
    }
  }

  // 4. Heuristic based on video duration
  const rand = typeof randomFactor === 'number' ? randomFactor : Math.random();

  if (runtimeSec >= 600) {
    // Long video (>10 mins): 25%~35% golden point
    const factor = 0.25 + rand * 0.10;
    return Math.round(runtimeSec * factor);
  } else if (runtimeSec >= 120) {
    // Medium-long video (2-10 mins): 10%~15% intro skip
    const factor = 0.10 + rand * 0.05;
    return Math.max(15, Math.round(runtimeSec * factor));
  } else if (runtimeSec >= 60) {
    // Medium video (1-2 mins): skip first 5~10s
    return Math.min(10, Math.round(runtimeSec * 0.10));
  }

  // Very short videos (< 60s): start at 0
  return 0;
}
