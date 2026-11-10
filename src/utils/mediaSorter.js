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

// 日期按「天」粒度参与排序：DateCreated 精确到秒、直接比较几乎永不相等，
// 次级排序在按日期的主排序下将永远无法生效；按天取整后「同一天添加的再按
// 次级字段分先后」才成立（无次级时稳定排序保持原有相对顺序，行为不变）
export function dayKey(v) {
  const d = new Date(v || 0);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

// 各排序字段的比较器（比较器表驱动，供主/次级排序组合复用）
const SORT_COMPARATORS = {
  date_desc: (a, b) => dayKey(b.DateCreated) - dayKey(a.DateCreated),
  date_asc: (a, b) => dayKey(a.DateCreated) - dayKey(b.DateCreated),
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
 * @param groupKeyMap     重复影片组共同时间/年份（Map<条目Id, 组键>）：仅 date_asc/desc、
 *                        year_asc/desc 主排序生效。组内成员以共同键参与排序使重复版本
 *                        相邻成对，组内并列再按各自真实值分先后（desc 时最新版本在前）；
 *                        由调用方按「desc 取组内最新 / asc 取组内最早」预计算
 */
export function sortMediaItems(items, sortMethod = 'date_desc', secondaryMethod = null, groupKeyMap = null) {
  if (!items || !Array.isArray(items)) return [];
  const copy = [...items];
  let primary;

  if ((sortMethod === 'date_desc' || sortMethod === 'date_asc') && groupKeyMap && groupKeyMap.size > 0) {
    const eff = it => {
      const v = groupKeyMap.get(it.Id);
      return v !== undefined ? v : dayKey(it.DateCreated);
    };
    const own = it => new Date(it.DateCreated || 0).getTime();
    primary = sortMethod === 'date_desc'
      ? (a, b) => eff(b) - eff(a) || own(b) - own(a)
      : (a, b) => eff(a) - eff(b) || own(a) - own(b);
  } else if ((sortMethod === 'year_desc' || sortMethod === 'year_asc') && groupKeyMap && groupKeyMap.size > 0) {
    const eff = it => {
      const v = groupKeyMap.get(it.Id);
      return v !== undefined ? v : (it.ProductionYear || 0);
    };
    const own = it => it.ProductionYear || 0;
    primary = sortMethod === 'year_desc'
      ? (a, b) => eff(b) - eff(a) || own(b) - own(a)
      : (a, b) => eff(a) - eff(b) || own(a) - own(b);
  } else {
    primary = SORT_COMPARATORS[sortMethod];
  }

  if (!primary) return copy;
  const secondary = (secondaryMethod && secondaryMethod !== sortMethod)
    ? SORT_COMPARATORS[secondaryMethod]
    : null;
  if (!secondary) return copy.sort(primary);
  return copy.sort((a, b) => primary(a, b) || secondary(a, b));
}
