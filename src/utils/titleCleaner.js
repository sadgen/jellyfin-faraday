/**
 * Title Cleaner & Scraper Optimizer
 * 针对 TG 搬运视频、自制视频及带有广告后缀的影片提供一键标题净化与标准番号提取。
 */

import { matchStrictCommercialCode } from './duplicateChecker';

/**
 * 净化杂乱的文件名/标题
 */
export function cleanMediaTitle(title = '') {
  if (!title) return { cleanedTitle: '', extractedCode: null, isChanged: false };
  let current = title.trim();

  // 1. 去除常见视频扩展名
  current = current.replace(/\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v)$/i, '');

  // 2. 去除常见的画质、压制、字幕广告方括号/圆括号标签
  current = current.replace(/\[\s*(4k|1080p|720p|hd|fhd|uhd|uncensored|leak|中文字幕|内嵌中字|破解|原盘|自制|首发|精选)[^\]]*\]/gi, '');
  current = current.replace(/\(\s*(4k|1080p|720p|hd|fhd|uhd|uncensored|leak|中文字幕|内嵌中字|破解|原盘|自制|首发|精选)[^)]*\)/gi, '');

  // 3. 去除前缀/后缀发布网址（如 masex.tv@, javbus.com-, hjd2048.com 等）
  current = current.replace(/(?:^|[\s_/-])[\w-]+\.(tv|com|xyz|net|org|cc|me|vip|top|club)[@_\-\s/]?/gi, ' ');

  // 4. 去除 TG 频道推广后缀（如 @kbjba, @tgchannel 等）
  current = current.replace(/(?:^|[\s_-])@[\w.-]+/gi, ' ');

  // 5. 整理多余的下划线、短横线与多余空格
  current = current.replace(/^[_\s-]+|[_\s-]+$/g, '');
  current = current.replace(/[\s_-]+/g, (m) => m.includes(' ') ? ' ' : m).trim();
  current = current.replace(/^[_\s-]+|[_\s-]+$/g, '');

  // 6. 检查是否含有标准商业番号 (如从 masex.tv@ADN-799-C 提取出 ADN-799)
  const code = matchStrictCommercialCode(current) || matchStrictCommercialCode(title);

  const cleanedTitle = current || title;
  const isChanged = cleanedTitle !== title;

  return {
    originalTitle: title,
    cleanedTitle,
    extractedCode: code,
    isChanged
  };
}

/**
 * 从文件路径推导编辑/识别弹窗的默认搜索词。
 * 用户打开编辑或识别，多半是因为当前刮削结果不对，文件名才是最可靠的线索，
 * 因此默认值取文件名（去扩展名后净化，命中标准番号时优先番号）而非现有元数据。
 */
export function deriveFilenameSearchTerm(filePath = '') {
  if (!filePath) return null;
  const base = filePath.split(/[\\/]/).pop().replace(/\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v)$/i, '');
  if (!base) return null;
  const { cleanedTitle, extractedCode } = cleanMediaTitle(base);
  // 年份只在有明确分隔的语境下提取，避免误命中番号/分辨率里的数字（如 FC2-PPV-2920232）
  const yearMatch = base.match(/(?:^|[\s._-])((?:19|20)\d{2})(?:$|[\s._-])/);
  return {
    term: extractedCode || cleanedTitle || base,
    year: yearMatch ? yearMatch[1] : null
  };
}
