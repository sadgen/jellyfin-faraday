import { getSubtitleBadge } from '../utils/subtitleBadge';

/**
 * JAV 字幕/版本角标（统一浅紫，低调）：
 * L=LTX / U=无码 / C=中文字幕（软硬同标）/ Raw=生肉，组合出 L/U/LC/UC/C/Raw 六种。
 * 非番号条目不渲染。data-subtitle-badge 供 GUI 测试按值断言。
 */
export default function SubtitleBadgeChip({ item, className = '' }) {
  const badge = getSubtitleBadge(item);
  if (!badge) return null;
  return (
    <span
      data-subtitle-badge={badge.label}
      className={`flex-shrink-0 px-1.5 py-0.5 rounded bg-purple-300/85 text-purple-950 text-[10px] font-mono font-bold leading-none shadow-sm ${className}`}
    >
      {badge.label}
    </span>
  );
}
