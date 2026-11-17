/**
 * 多版本条目（同一部影片的多个格式版本）纯逻辑工具。
 *
 * Jellyfin 侧形态：`标题 - 版本名` 命名的多文件同夹合并为一个条目，
 * PlaybackInfo / item 的 MediaSources 数组每个元素即一个版本；
 * 主版本 MediaSource.Id == ItemId，其余版本各有独立 Id。
 * 播放面（影院弹窗 / 浮窗）用 MediaSourceId 参数选择具体版本拉流。
 */

/**
 * 去重后的版本列表（按 MediaSources 顺序，主版本在前）。
 * 单版本条目返回长度 1 的数组；调用方以 length > 1 判定是否显示切换入口。
 */
export function listMediaVersions(playbackData, item) {
  const sources = playbackData?.MediaSources || item?.MediaSources || [];
  const seen = new Set();
  const out = [];
  for (const s of sources || []) {
    if (!s?.Id || seen.has(s.Id)) continue;
    seen.add(s.Id);
    out.push(s);
  }
  return out;
}

/**
 * 选中版本解析：preferredId 命中则用之，否则回落第一个（主/默认）版本。
 * sources 缺失时返回 null（调用方自行兜底 itemId）。
 */
export function selectMediaSource(sources, preferredId) {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  if (preferredId) {
    const hit = sources.find(s => s?.Id === preferredId);
    if (hit) return hit;
  }
  return sources[0];
}

/**
 * 版本显示名：优先服务器侧 Name（`标题 - 版本名` 命名的版本名段），
 * 缺失时由视频流拼 编码+位深+分辨率+容器（如 "AV1 10bit · 1080p · MP4"）。
 */
export function describeMediaVersion(source) {
  if (!source) return '';
  if (source.Name) return String(source.Name);
  const video = (source.MediaStreams || []).find(s => s?.Type === 'Video');
  const parts = [];
  if (video?.Codec) {
    parts.push(String(video.Codec).toUpperCase());
    if (video.BitDepth) parts.push(`${video.BitDepth}bit`);
  }
  if (video?.Height) parts.push(`${video.Height}p`);
  if (source.Container) parts.push(String(source.Container).toUpperCase());
  return parts.join(' · ') || '默认版本';
}

/**
 * 版本体积标签（GB，两位小数）；无 Size 时返回空串。
 */
export function formatVersionSize(source) {
  if (!source?.Size || source.Size <= 0) return '';
  return `${(source.Size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
