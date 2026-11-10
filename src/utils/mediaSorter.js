/**
 * Media Item Sorter & Filter Utility
 * Ensures identical ordering between client-side cache hydration and server-side responses.
 */

// 稳定随机排序：按条目 Id 固定随机键，列表因扫描/播放状态更新而重算时顺序保持不变；
// 新条目按自己的键插入，不打乱既有相对顺序
const randomKeyCache = new Map();
function getRandomKey(id) {
  let key = randomKeyCache.get(id);
  if (key === undefined) {
    key = Math.random();
    randomKeyCache.set(id, key);
    if (randomKeyCache.size > 20000) randomKeyCache.clear();
  }
  return key;
}

// 各排序字段的比较器（比较器表驱动，供主/次级排序组合复用）
const SORT_COMPARATORS = {
  date_desc: (a, b) => new Date(b.DateCreated || 0) - new Date(a.DateCreated || 0),
  date_asc: (a, b) => new Date(a.DateCreated || 0) - new Date(b.DateCreated || 0),
  name_asc: (a, b) => (a.SortName || a.Name || '').localeCompare(b.SortName || b.Name || '', 'zh-CN'),
  name_desc: (a, b) => (b.SortName || b.Name || '').localeCompare(a.SortName || a.Name || '', 'zh-CN'),
  rating_desc: (a, b) => (b.CommunityRating || 0) - (a.CommunityRating || 0),
  rating_asc: (a, b) => (a.CommunityRating || 0) - (b.CommunityRating || 0),
  year_desc: (a, b) => (b.ProductionYear || 0) - (a.ProductionYear || 0),
  year_asc: (a, b) => (a.ProductionYear || 0) - (b.ProductionYear || 0),
  playcount_desc: (a, b) => (b.UserData?.PlayCount || 0) - (a.UserData?.PlayCount || 0),
  playcount_asc: (a, b) => (a.UserData?.PlayCount || 0) - (b.UserData?.PlayCount || 0),
  runtime_desc: (a, b) => (b.RunTimeTicks || 0) - (a.RunTimeTicks || 0),
  random: (a, b) => getRandomKey(a.Id) - getRandomKey(b.Id) // 依据 Id 固定随机键排序（会话内稳定）
};

/**
 * 排序入口。
 * @param secondaryMethod 次级排序字段：主排序比较相等（并列）时用它分先后，
 *                        null/与主排序相同则不启用（保持原顺序兜底）
 */
export function sortMediaItems(items, sortMethod = 'date_desc', secondaryMethod = null) {
  if (!items || !Array.isArray(items)) return [];
  const copy = [...items];
  const primary = SORT_COMPARATORS[sortMethod];
  if (!primary) return copy;
  const secondary = (secondaryMethod && secondaryMethod !== sortMethod)
    ? SORT_COMPARATORS[secondaryMethod]
    : null;
  if (!secondary) return copy.sort(primary);
  return copy.sort((a, b) => primary(a, b) || secondary(a, b));
}
