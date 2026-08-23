/**
 * Full-Library Duplicate Detection Engine (from jellyfin-packet.user.js)
 * Normalizes movie codes & titles to identify duplicates across all libraries.
 */

export function normalizeMovieCode(title = '') {
  if (!title) return '';
  let clean = title.trim();
  
  // Remove brackets and common release tags like [4K], [中文字幕], -C, [UNCENSORED]
  clean = clean.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ');
  clean = clean.replace(/\b(4k|1080p|720p|hd|fhd|uhd|ch|uncensored|leak)\b/gi, ' ');
  
  // Match standard番号 format: ABC-123, FC2-PPV-123456, etc.
  const codeMatch = clean.match(/([a-zA-Z]{2,6}|fc2-ppv|fc2)\s*[-_]?\s*(\d{3,8})/i);
  if (codeMatch) {
    const prefix = codeMatch[1].toUpperCase().replace(/[-_]/g, '');
    const num = codeMatch[2];
    return `${prefix}-${num}`;
  }

  // Fallback: simplified alphanumeric string
  return clean.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '');
}

/**
 * Scan media list and return duplicate item IDs and groups
 */
export function detectDuplicateMedia(items = []) {
  const codeGroups = new Map();

  items.forEach(item => {
    const code = normalizeMovieCode(item.Name || '');
    if (!code || code.length < 3) return;

    if (!codeGroups.has(code)) {
      codeGroups.set(code, []);
    }
    codeGroups.get(code).push(item);
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
