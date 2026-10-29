/**
 * JAV 字幕/版本角标判定（2026-10-29 用户拍板的组合规则）
 *
 * 前缀：文件名 -LTX → L；-U / -UC → U
 * 后缀：中文字幕 → 追加 C
 *   - 硬字幕：只能靠文件名后缀 -C / -CH / -UC（含紧贴番号数字的 …ch，如 MIKR-089ch）
 *   - 软字幕：条目存在字幕流（MediaStreams 或 HasSubtitles）
 * 全空 → Raw
 * 共六种结果：L / U / LC / UC / C / Raw
 *
 * 非番号样式条目一律返回 null（8096 剧集/普通电影不误报）。
 * 判定一律以文件名（Path 基名）为准，Name（刮削后为「番号 标题」）仅作缺省兜底。
 */

// 番号样式：字母数字段（须含字母，容纳 FC2 / 300MIUM）+ 可选 -PPV + 连字符 + 2~8 位数字
const JAV_CODE_RE = /^(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9]{2,10}(?:-PPV)?-\d{2,8}/i;
const SUFFIX_L_RE = /-ltx$/i;
const SUFFIX_U_RE = /-(u|uc)$/i;
// 硬字幕：连字符后缀 -C/-CH/-UC，或紧贴数字的 glued ch（MIKR-089ch）
const SUFFIX_C_RE = /-(c|ch|uc)$|\dch$/i;

export const SUBTITLE_BADGE_LABELS = ['L', 'U', 'LC', 'UC', 'C', 'Raw'];

function fileNameOf(item) {
  const raw = item?.Path || item?.Name || '';
  if (!raw) return '';
  return raw.split(/[\\/]/).pop().replace(/\.[A-Za-z0-9]{1,5}$/, '');
}

export function hasSubtitleStream(item) {
  const streams = item?.MediaStreams;
  if (Array.isArray(streams) && streams.some((s) => s?.Type === 'Subtitle')) return true;
  return item?.HasSubtitles === true;
}

/**
 * @returns {{label: 'L'|'U'|'LC'|'UC'|'C'|'Raw'} | null} null = 非番号条目，不显示角标
 */
export function getSubtitleBadge(item) {
  const name = fileNameOf(item);
  if (!name || !JAV_CODE_RE.test(name)) return null;

  const prefix = SUFFIX_L_RE.test(name) ? 'L' : SUFFIX_U_RE.test(name) ? 'U' : '';
  const hasC = SUFFIX_C_RE.test(name) || hasSubtitleStream(item);

  if (prefix) return { label: hasC ? `${prefix}C` : prefix };
  if (hasC) return { label: 'C' };
  return { label: 'Raw' };
}
