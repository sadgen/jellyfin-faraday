/**
 * 画质档位与倍速档位常量（全局单一来源）
 * 影院播放器 / 浮动窗口 / VR 播放器 / 默认播放偏好菜单统一从此引用，
 * 避免多处重复定义导致标签与倍速范围漂移不一致。
 */

export const QUALITY_OPTIONS = [
  { id: 'direct', label: '🎬 原画直推 (原始码率)', shortLabel: '原画', bitrate: 0 },
  { id: '8000000', label: '🌟 极清 8 Mbps (1080p)', shortLabel: '8M', bitrate: 8000000 },
  { id: '4000000', label: '⚡ 流畅 4 Mbps (1080p)', shortLabel: '4M', bitrate: 4000000 },
  { id: '2000000', label: '🚀 标清 2 Mbps (720p)', shortLabel: '2M', bitrate: 2000000 },
  { id: '1000000', label: '📱 省流 1 Mbps (480p)', shortLabel: '1M', bitrate: 1000000 }
];

/** 播放器内倍速选择器统一档位（影院 / 浮窗 / VR 共用） */
export const PLAYBACK_SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

/** 默认播放偏好菜单中的快捷倍速网格 */
export const SPEED_PRESETS = [0.75, 1.0, 1.25, 1.5, 2.0];

/** 触控手势右侧上下划升速档位 */
export const TOUCH_SPEED_STEPS = [1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

export function findQualityOption(qualityId) {
  return QUALITY_OPTIONS.find(q => q.id === qualityId) || QUALITY_OPTIONS[0];
}
