/**
 * Full-Library Duplicate Detection Engine
 * 智能区分"自制未刮削视频"与"已识别元数据视频"：
 * 1. 未识别元数据（自制视频）：必须完整文件名（文件名去掉扩展名）完全一致才判定为重复，
 *    避免自制分段、不同时间自制视频（如 hidana_20250819_2210 与 2240）被模糊正则误判为重复。
 *    （除非命中极严格的顶级商业番号格式，如 ABC-123、FC2-PPV-123456）
 * 2. 已识别元数据（电影/剧集/已刮削影片）：
 *    - 优先匹配 ProviderIds (TMDB/IMDB/Jav等)，相同刮削 ID 直接判为重复；
 *    - 其次匹配提取出的标准番号 (如 ABC-123、FC2-PPV-123456)，忽略 -C, _UC, [4K], 中文字幕 等后缀与画质标签；
 *    - 最后使用标准化标题作为兜底。
 */

/**
 * 判断条目是否已识别过元数据（刮削过）
 */
export function hasIdentifiedMetadata(item) {
  if (!item) return false;

  // 1. 检查是否存在有效的外部刮削源 ID (Tmdb, Imdb, Tvdb, Douban, Anidb, Bangumi, Jav等)
  const pIds = item.ProviderIds || {};
  const validProviders = Object.keys(pIds).filter(k => pIds[k] && String(pIds[k]).trim());
  if (validProviders.length > 0) return true;

  // 2. 检查是否有丰富的元数据特征（非默认文件名作为标题且有 Overview 和 Genres）
  if (item.Overview && item.Overview.trim().length > 20 && item.Genres && item.Genres.length > 0) {
    return true;
  }

  return false;
}

/**
 * 提取文件名的纯净基名（从 Path 或 FileName 或 Name 中提取，去掉路径与扩展名）
 */
export function extractCleanFileName(item) {
  if (!item) return '';
  const raw = item.FileName || item.Path || item.Name || '';
  // 取路径最后一段
  const base = raw.split(/[/\\]/).pop() || raw;
  // 去除常见视频扩展名
  const noExt = base.replace(/\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v|iso)$/i, '').trim();
  return noExt.toLowerCase();
}

/**
 * 精准商业番号正则匹配（词首开始，字母 2-5 位 + 短横线/下划线 + 3-5 位数字，或 FC2-PPV-数字）
 * 严格排除 20250819 这类 8 位日期或自制时间戳
 */
export function matchStrictCommercialCode(text = '') {
  if (!text) return null;
  const m = text.match(/(?:^|[\s_[(])([a-zA-Z]{2,5}|fc2-ppv|fc2)[-_](\d{3,5})(?:[\s_\].)-]|$)/i);
  if (m) {
    const prefix = m[1].toUpperCase().replace(/[-_]/g, '');
    const num = m[2];
    return `${prefix}-${num}`;
  }
  return null;
}

/**
 * 提取番号/影片识别码（针对已刮削或商业番号片）
 */
export function normalizeMovieCode(title = '') {
  if (!title) return '';
  let clean = title.trim();

  // Remove brackets and common release tags like [4K], [中文字幕], -C, [UNCENSORED]
  clean = clean.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ');
  clean = clean.replace(/\b(4k|1080p|720p|hd|fhd|uhd|ch|uncensored|leak)\b/gi, ' ');

  // 1. 先尝试严格商业番号
  const strict = matchStrictCommercialCode(clean);
  if (strict) return strict;

  // 2. 较宽松番号（字母 2-6 位 + 数字 3-6 位）
  const codeMatch = clean.match(/([a-zA-Z]{2,6}|fc2-ppv|fc2)\s*[-_]?\s*(\d{3,6})/i);
  if (codeMatch) {
    const prefix = codeMatch[1].toUpperCase().replace(/[-_]/g, '');
    const num = codeMatch[2];
    return `${prefix}-${num}`;
  }

  // Fallback: simplified alphanumeric string
  return clean.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '');
}

/**
 * 获取媒体项目的去重特征 Key
 */
export function getItemDuplicateKey(item) {
  if (!item) return '';

  const isIdentified = hasIdentifiedMetadata(item);
  const name = item.Name || '';

  // 1. 已识别元数据：优先使用 ProviderId（TMDB / IMDB / TVDB 等）
  if (isIdentified && item.ProviderIds) {
    const p = item.ProviderIds;
    if (p.Tmdb) return `tmdb:${p.Tmdb}`;
    if (p.Imdb) return `imdb:${p.Imdb}`;
    if (p.Tvdb) return `tvdb:${p.Tvdb}`;
    if (p.Zap2It) return `zap2it:${p.Zap2It}`;
    for (const k of Object.keys(p)) {
      if (p[k] && String(p[k]).trim()) {
        return `${k.toLowerCase()}:${String(p[k]).trim()}`;
      }
    }
  }

  // 2. 已识别元数据：提取番号或标准化标题
  if (isIdentified) {
    const code = normalizeMovieCode(name);
    return code && code.length >= 3 ? `identified:${code}` : '';
  }

  // 3. 未识别元数据：检查是否命中了极严格的标准商业番号（如 ABP-123-C 和 ABP-123）
  const strictCode = matchStrictCommercialCode(name);
  if (strictCode) {
    return `strict_code:${strictCode}`;
  }

  // 4. 未识别元数据的自制视频：必须完整文件名（不含扩展名）完全一致！
  const cleanFileName = extractCleanFileName(item);
  if (cleanFileName && cleanFileName.length >= 3) {
    return `unidentified_file:${cleanFileName}`;
  }

  return '';
}

/**
 * Scan media list and return duplicate item IDs and groups
 */
export function detectDuplicateMedia(items = []) {
  const codeGroups = new Map();

  items.forEach(item => {
    const key = getItemDuplicateKey(item);
    if (!key) return;

    if (!codeGroups.has(key)) {
      codeGroups.set(key, []);
    }
    codeGroups.get(key).push(item);
  });

  const duplicateItemIds = new Set();
  const duplicateGroups = [];

  codeGroups.forEach((groupItems, code) => {
    if (groupItems.length > 1) {
      duplicateGroups.push({
        code,
        count: groupItems.length,
        items: groupItems
      });
      groupItems.forEach(it => duplicateItemIds.add(it.Id));
    }
  });

  return {
    duplicateItemIds,
    duplicateGroups,
    duplicateCount: duplicateItemIds.size
  };
}
