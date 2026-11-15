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

const createdAt = it => new Date(it.DateCreated || 0).getTime();
const yearOf = it => it.ProductionYear || 0;

// 各排序字段的比较器（普通视图：严格按字段值排序，不做任何分组/取整）
const SORT_COMPARATORS = {
  date_desc: (a, b) => createdAt(b) - createdAt(a),
  date_asc: (a, b) => createdAt(a) - createdAt(b),
  name_asc: (a, b) => (a.SortName || a.Name || '').localeCompare(b.SortName || b.Name || '', 'zh-CN'),
  name_desc: (a, b) => (b.SortName || b.Name || '').localeCompare(a.SortName || a.Name || '', 'zh-CN'),
  rating_desc: (a, b) => (b.CommunityRating || 0) - (a.CommunityRating || 0),
  rating_asc: (a, b) => (a.CommunityRating || 0) - (b.CommunityRating || 0),
  year_desc: (a, b) => yearOf(b) - yearOf(a),
  year_asc: (a, b) => yearOf(a) - yearOf(b),
  playcount_desc: (a, b) => (b.UserData?.PlayCount || 0) - (a.UserData?.PlayCount || 0),
  playcount_asc: (a, b) => (a.UserData?.PlayCount || 0) - (b.UserData?.PlayCount || 0),
  runtime_desc: (a, b) => (b.RunTimeTicks || 0) - (a.RunTimeTicks || 0),
  random: (a, b) => getRandomKey(a.Id) - getRandomKey(b.Id) // 依据 Id 固定随机键排序（会话内稳定）
};

/**
 * 普通排序入口：按真实字段值排（日期精确到秒），不做重复组占位。
 */
export function sortMediaItems(items, sortMethod = 'date_desc') {
  if (!items || !Array.isArray(items)) return [];
  const primary = SORT_COMPARATORS[sortMethod];
  if (!primary) return [...items];
  return [...items].sort(primary);
}

/**
 * 重复筛选视图专用（「查重清理」标签页 / 开启「仅显示重复」时）。
 * 把每个重复组当成一个整体块参与日期或年份排序，保证同组始终相邻：
 * - 组占位：最新排序取组内最新日期/年份，最早排序取组内最旧
 * - 组内顺序：最新排序新版在前，最早排序旧版在前
 * - 非重复条目按自身日期/年份参与；其它排序字段直接回退普通排序
 * @param duplicateGroups detectDuplicateMedia() 的产物 [{ code, items }]
 */
export function sortMediaItemsByDuplicateGroups(items, sortMethod = 'date_desc', duplicateGroups = []) {
  if (!items || !Array.isArray(items)) return [];

  const isDate = sortMethod === 'date_desc' || sortMethod === 'date_asc';
  const isYear = sortMethod === 'year_desc' || sortMethod === 'year_asc';
  if ((!isDate && !isYear) || !duplicateGroups || duplicateGroups.length === 0) {
    return sortMediaItems(items, sortMethod);
  }

  const desc = sortMethod.endsWith('_desc');
  const valueOf = isDate ? createdAt : yearOf;

  // 当前列表实际存在的成员才参与组块（搜索/筛选后可能只剩部分成员）
  const presentIds = new Set(items.map(it => it.Id));
  const groupOfItem = new Map();
  duplicateGroups.forEach(g => {
    const members = g.items.filter(it => presentIds.has(it.Id));
    if (members.length > 1) members.forEach(it => groupOfItem.set(it.Id, g));
  });

  // 按输入顺序组装「组块」与「单个条目」，输入顺序兜底并列时的稳定性
  const units = [];
  const builtGroups = new Set();
  items.forEach(it => {
    const group = groupOfItem.get(it.Id);
    if (!group) {
      units.push({ key: valueOf(it), items: [it] });
      return;
    }
    if (builtGroups.has(group)) return;
    builtGroups.add(group);

    const members = group.items.filter(x => groupOfItem.get(x.Id) === group);
    members.sort((a, b) => desc ? valueOf(b) - valueOf(a) : valueOf(a) - valueOf(b));
    const key = desc
      ? Math.max(...members.map(valueOf))
      : Math.min(...members.map(valueOf));
    units.push({ key, items: members });
  });

  units.sort((a, b) => desc ? b.key - a.key : a.key - b.key);
  return units.flatMap(unit => unit.items);
}
