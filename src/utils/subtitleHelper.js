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
    if (/中文字幕|中字|内嵌|硬字幕/i.test(cleanText)) {
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
    if (sub.isNewEngine) {
      rank = 0; // 新引擎返回的已通过精准番号与有效性门禁
    } else if (codes.length > 0) {
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

  scored.sort((a, b) => {
    if (a.sub.isNewEngine && b.sub.isNewEngine) {
      return (b.sub.score || 0) - (a.sub.score || 0) || a.i - b.i;
    }
    return a.rank - b.rank || a.i - b.i;
  });

  return {
    exact: scored.filter(s => s.rank === 0).map(s => s.sub),
    related: scored.filter(s => s.rank !== 0).map(s => s.sub),
    hasCode: codes.length > 0 || Boolean(results?.[0]?.isNewEngine)
  };
}

/**
 * 默认轨指纹键：外部轨按文件名基名（Jellyfin 删轨重编号后仍稳定），
 * 内嵌轨按 index+DisplayTitle+语言 组合。
 * 兼容两种入参：MediaStream（PascalCase 字段）与持久化的默认轨记录
 * （external/path/displayTitle 小写字段，见 subtitleDefaults.js）——两者拼出同一形态的键。
 */
export function buildSubtitleDefaultKey(stream) {
  if (!stream) return '';
  const idx = stream.Index ?? stream.index;
  if (stream.IsExternal || stream.external) {
    const p = stream.Path || stream.path || '';
    return `ext:${p ? p.split(/[\\/]/).pop() : `#${idx}`}`;
  }
  const title = stream.DisplayTitle || stream.displayTitle || stream.Title || '';
  const lang = stream.Language || stream.language || '';
  return `emb:${idx}|${title}|${lang}`;
}

/**
 * 用持久化的默认轨指纹在当前流列表里找回对应轨道。
 * 顺序：指纹精确匹配（外部轨=文件名、内嵌轨=index+标题+语言）→
 * 同 index 且标题一致的兜底；都失败返回 null（调用方回退启发式）。
 */
export function matchStoredDefault(stored, subtitleStreams = []) {
  if (!stored || !subtitleStreams || subtitleStreams.length === 0) return null;
  const key = buildSubtitleDefaultKey(stored);
  if (key) {
    const byKey = subtitleStreams.find(s => buildSubtitleDefaultKey(s) === key);
    if (byKey) return byKey;
  }
  return subtitleStreams.find(s =>
    s.Index === stored.index &&
    (s.DisplayTitle || s.Title || '') === (stored.displayTitle || '')
  ) || null;
}

/**
 * Select the best default subtitle stream if hardcoded Chinese subtitles are not present.
 * storedDefault（可选）：用户显式指定的默认轨指纹，命中时优先于一切启发式
 * （含硬字幕防双字幕——显式意图最高）。
 */
export function getDefaultSubtitleIndex(item, subtitleStreams = [], storedDefault = null) {
  if (!subtitleStreams || subtitleStreams.length === 0) return -1;

  const matched = matchStoredDefault(storedDefault, subtitleStreams);
  if (matched) return matched.Index;

  if (hasHardcodedChineseSubtitles(item)) {
    return -1; // Default do not load
  }

  // Otherwise default load best subtitle
  const defaultStream = subtitleStreams.find(s => s.IsDefault)
    || subtitleStreams.find(s => /zh|chi|zho|chinese|中文|简|繁/i.test(s.Language || s.Title || ''))
    || subtitleStreams[0];

  return defaultStream ? defaultStream.Index : -1;
}

/**
 * 字幕纯台词指纹（微服务 _srt_fingerprint 的 JS 版，客户端查重比对用）：
 * 去序号/时间轴/空白/标点后拼接台词正文。输入应为 Stream.srt 转换后的文本，
 * 跨格式（srt/ass/内嵌轨统一转 srt）比对稳定。无法提取台词返回 null。
 */
export function srtDialogueFingerprint(text) {
  if (!text || text.includes('\x00')) return null;
  const dialogue = [];
  for (const block of String(text).trim().split(/\n\s*\n/)) {
    for (const line of block.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.includes('-->') || /^\d+$/.test(t)) continue;
      // 注意用 \p{L}\p{N} 而非 \w：JS 的 \w 只认 ASCII，会把整句中文剥空
      const clean = t.replace(/[^\p{L}\p{N}]+/gu, '');
      if (clean) dialogue.push(clean);
    }
  }
  return dialogue.join('') || null;
}

/**
 * 台词相似度（字符二元组 Dice 系数，O(n)）。指纹动辄上万字符，
 * SequenceMatcher 级 O(n²) 在浏览器里跑不动，Dice 与之在 ≥0.9 阈值附近判定一致：
 * 完全相同 → 1；微小差异（个别错字/时间轴差异）≈ 0.95+；不同翻译通常远低于 0.9。
 */
export function dialogueSimilarity(fpA, fpB) {
  if (!fpA || !fpB) return 0;
  const MAX = 20000; // 封顶防超长指纹卡顿（阈值判定不受影响）
  const a = fpA.slice(0, MAX);
  const b = fpB.slice(0, MAX);
  if (a === b) return 1;
  const bigrams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const ga = bigrams(a);
  const gb = bigrams(b);
  let inter = 0;
  for (const [g, c] of ga) {
    const cc = gb.get(g);
    if (cc) inter += Math.min(c, cc);
  }
  const denom = (a.length - 1) + (b.length - 1);
  return denom > 0 ? (2 * inter) / denom : 0;
}
