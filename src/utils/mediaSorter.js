/**
 * Media Item Sorter & Filter Utility
 * Ensures identical ordering between client-side cache hydration and server-side responses.
 */

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
      // Fisher-Yates 均匀洗牌，使客户端缓存水合与服务端 Random 排序行为一致
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    default:
      return copy;
  }
}
