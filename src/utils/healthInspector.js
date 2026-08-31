/**
 * Media File Health Inspector
 * 检测媒体库中的损坏文件、下载中断截断文件（如 TG 机器人下载中断只有 2-3MB 但报几十分钟）以及无流文件。
 */

export const HEALTH_ISSUES = {
  TRUNCATED: { id: 'truncated', label: '文件下载中断/截断', desc: '文件极小（<15MB）但声称时长超过 5 分钟，通常为下载未完成的文件头' },
  EMPTY: { id: 'empty', label: '空文件/零字节', desc: '文件大小为 0 或完全无有效数据' },
  NO_VIDEO: { id: 'no_video', label: '无有效视频流', desc: '媒体文件中没有检测到视频流轨' }
};

/**
 * 检查单个条目的健康状态
 */
export function inspectItemHealth(item) {
  if (!item) return { isHealthy: true, issue: null, reason: '' };

  const ms = (item.MediaSources || [])[0] || {};
  const sizeBytes = ms.Size !== undefined && ms.Size !== null ? ms.Size : (item.Size || 0);
  const runtimeSec = item.RunTimeTicks ? item.RunTimeTicks / 10000000 : (ms.RunTimeTicks ? ms.RunTimeTicks / 10000000 : 0);
  const streams = item.MediaStreams || ms.MediaStreams || [];

  // 1. 空文件检测
  if (sizeBytes === 0 && runtimeSec === 0) {
    return {
      isHealthy: false,
      issue: HEALTH_ISSUES.EMPTY.id,
      reason: '文件大小为 0 字节',
      sizeBytes,
      runtimeSec
    };
  }

  // 2. 截断/中断文件检测：声称时长大于 5 分钟（300s），但文件大小不足 15MB (15 * 1024 * 1024)
  if (runtimeSec >= 300 && sizeBytes > 0 && sizeBytes < 15 * 1024 * 1024) {
    const sizeMb = (sizeBytes / 1048576).toFixed(1);
    const timeMin = Math.round(runtimeSec / 60);
    return {
      isHealthy: false,
      issue: HEALTH_ISSUES.TRUNCATED.id,
      reason: `仅 ${sizeMb} MB，但元数据声称 ${timeMin} 分钟（典型下载中断坏文件）`,
      sizeBytes,
      runtimeSec
    };
  }

  // 3. 无视频流检测（针对视频类型条目）
  const itemType = item.Type || '';
  if (['Movie', 'Episode', 'Video'].includes(itemType) && streams.length > 0) {
    const hasVideo = streams.some(s => s.Type === 'Video');
    if (!hasVideo) {
      return {
        isHealthy: false,
        issue: HEALTH_ISSUES.NO_VIDEO.id,
        reason: '媒体未包含可播放的视频流轨道',
        sizeBytes,
        runtimeSec
      };
    }
  }

  return { isHealthy: true, issue: null, reason: '' };
}

/**
 * 扫描全列表返回所有损坏项目
 */
export function scanLibraryHealth(items = []) {
  const brokenItems = [];

  items.forEach(item => {
    const res = inspectItemHealth(item);
    if (!res.isHealthy) {
      brokenItems.push({
        ...item,
        healthIssue: res.issue,
        healthReason: res.reason,
        sizeBytes: res.sizeBytes,
        runtimeSec: res.runtimeSec
      });
    }
  });

  return {
    brokenItems,
    brokenCount: brokenItems.length
  };
}
