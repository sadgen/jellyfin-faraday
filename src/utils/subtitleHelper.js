/**
 * Detects if a video item has hardcoded/embedded Chinese subtitles based on file name or title.
 * Standard naming conventions in AV/movie libraries:
 * - Suffix: -C, _C, C, -UC, _UC, UC, [C], [UC], (C), (UC) (case-insensitive)
 * - Words: 中文字幕, 中字, 内嵌, 硬字幕, 破解
 * 
 * If true: Subtitles should NOT be loaded by default to avoid double-subtitle clutter.
 * If false: Subtitles SHOULD be loaded by default.
 */
export function hasHardcodedChineseSubtitles(item) {
  if (!item) return false;
  const candidates = [
    item.Path,
    item.FileName,
    item.Name,
    item.OriginalTitle
  ].filter(Boolean);

  for (const text of candidates) {
    // Strip file extension if present (.mp4, .mkv, .avi, .wmv, etc.)
    const cleanText = text.replace(/\.[a-z0-9]{2,5}$/i, '').trim();

    // 1. Check explicit Chinese subtitle keywords
    if (/中文字幕|中字|内嵌|硬字幕|无码破解/i.test(cleanText)) {
      return true;
    }

    // 2. Check suffix ending with -C, _C, ' C', -UC, _UC, ' UC', [C], [UC], (C), (UC)
    if (/(?:[-_\s[(]|\b)u?c(?:[-_\s\])]|$)/i.test(cleanText)) {
      return true;
    }

    // 3. Check directly concatenated code ending with C or UC, e.g. STARS999C, ABP123UC, FC2-PPV-123456-C
    if (/[a-z0-9]+-?[0-9]+u?c$/i.test(cleanText)) {
      return true;
    }
  }

  return false;
}

/**
 * 从标题/文件名识别中文字幕的简繁（zho/chi 这类语言码本身不带简繁信息，判断不出返回 null）。
 * 注意别用过于宽松的缩写：'gb' 会误中 release 名里的 GBR。
 */
export function detectChineseVariant(stream) {
  if (!stream) return null;
  const text = [stream.Title, stream.Path].filter(Boolean).join(' ');
  if (/cht|zh-hant|zh-tw|big5|繁/i.test(text)) return '繁';
  if (/chs|zh-hans|zh-cn|简/i.test(text)) return '简';
  return null;
}

/**
 * Extract video codes (e.g. ABP-123 / kavr495) from a video item's file name / title.
 * Returns an array of [letters, digits] pairs with letters uppercased, e.g. [['KAVR', '495']].
 */
export function extractVideoCodes(item) {
  const candidates = [item?.Path, item?.Name, item?.OriginalTitle].filter(Boolean);
  const codes = [];
  const seen = new Set();
  for (const text of candidates) {
    // 只取路径末段文件名，避免目录名里的杂词
    const base = String(text).split(/[\\/]/).pop();
    const re = /\b([A-Za-z]{2,6})-?(\d{2,6})\b/g;
    let m;
    while ((m = re.exec(base)) !== null) {
      const key = `${m[1].toUpperCase()}${m[2]}`;
      if (!seen.has(key)) {
        seen.add(key);
        codes.push([m[1].toUpperCase(), m[2]]);
      }
    }
  }
  return codes;
}

/**
 * Rank remote subtitle search results by relevance to the item's video code.
 * MeiamSub.Thunder (迅雷) returns name-based fuzzy matches with arbitrary ordering —
 * audit (2026-10) showed top results are frequently subs of DIFFERENT codes
 * (e.g. kavr409/KAVR-429 subs for KAVR-495), so we float exact-code matches to the top.
 * Returns { exact, related, hasCode } — original order preserved within groups,
 * duplicates (same name+format) dropped.
 */
export function rankRemoteSubtitles(results = [], item = {}) {
  const codes = extractVideoCodes(item);
  const seen = new Set();
  const scored = [];
  (results || []).forEach((sub, i) => {
    const name = String(sub?.Name || '');
    const dedupKey = `${name.trim().toLowerCase()}|${sub?.Format || ''}`;
    if (seen.has(dedupKey)) return;
    seen.add(dedupKey);
    let rank = 1;
    if (codes.length > 0) {
      rank = 2;
      for (const [letters, digits] of codes) {
        // 兼容 KAVR-495 / kavr495 / kavr_495 等写法
        if (new RegExp(`${letters}[\\s._-]?${digits}`, 'i').test(name)) {
          rank = 0;
          break;
        }
      }
    }
    scored.push({ sub, rank, i });
  });
  scored.sort((a, b) => a.rank - b.rank || a.i - b.i);
  return {
    exact: scored.filter(s => s.rank === 0).map(s => s.sub),
    related: scored.filter(s => s.rank !== 0).map(s => s.sub),
    hasCode: codes.length > 0
  };
}

/**
 * Select the best default subtitle stream if hardcoded Chinese subtitles are not present.
 */
export function getDefaultSubtitleIndex(item, subtitleStreams = []) {
  if (!subtitleStreams || subtitleStreams.length === 0) return -1;
  
  if (hasHardcodedChineseSubtitles(item)) {
    return -1; // Default do not load
  }

  // Otherwise default load best subtitle
  const defaultStream = subtitleStreams.find(s => s.IsDefault)
    || subtitleStreams.find(s => /zh|chi|zho|chinese|中文|简|繁/i.test(s.Language || s.Title || ''))
    || subtitleStreams[0];

  return defaultStream ? defaultStream.Index : -1;
}
