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

export function sortMediaItems(items, sortMethod = 'date_desc') {
  if (!items || !Array.isArray(items)) return [];
  const copy = [...items];

  switch (sortMethod) {
    case 'date_desc':
      return copy.sort((a, b) => new Date(b.DateCreated || 0) - new Date(a.DateCreated || 0));
    case 'date_asc':
      return copy.sort((a, b) => new Date(a.DateCreated || 0) - new Date(b.DateCreated || 0));
    case 'name_asc':
      return copy.sort((a, b) => (a.SortName || a.Name || '').localeCompare(b.SortName || b.Name || '', 'zh-CN'));
    case 'name_desc':
      return copy.sort((a, b) => (b.SortName || b.Name || '').localeCompare(a.SortName || a.Name || '', 'zh-CN'));
    case 'rating_desc':
      return copy.sort((a, b) => (b.CommunityRating || 0) - (a.CommunityRating || 0));
    case 'rating_asc':
      return copy.sort((a, b) => (a.CommunityRating || 0) - (b.CommunityRating || 0));
    case 'year_desc':
      return copy.sort((a, b) => (b.ProductionYear || 0) - (a.ProductionYear || 0));
    case 'year_asc':
      return copy.sort((a, b) => (a.ProductionYear || 0) - (b.ProductionYear || 0));
    case 'playcount_desc':
      return copy.sort((a, b) => (b.UserData?.PlayCount || 0) - (a.UserData?.PlayCount || 0));
    case 'playcount_asc':
      return copy.sort((a, b) => (a.UserData?.PlayCount || 0) - (b.UserData?.PlayCount || 0));
    case 'runtime_desc':
      return copy.sort((a, b) => (b.RunTimeTicks || 0) - (a.RunTimeTicks || 0));
    case 'random':
      // 依据 Id 固定随机键排序（会话内稳定），缓存水合与服务端刷新结果一致
      return copy.sort((a, b) => getRandomKey(a.Id) - getRandomKey(b.Id));
    default:
      return copy;
  }
}
