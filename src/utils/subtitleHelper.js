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
