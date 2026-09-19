/**
 * 演职员聚合：从条目 People 中聚合"只统计演员"（/Persons 接口会混入导演/编剧
 * 等幕后人员，且无法按出演数量排序）。依据 People 的 Type 过滤（Actor / GuestStar /
 * 无 Type 视为演员），同一人物跨条目按 Id 去重累计出演次数，按次数降序排列。
 */

const ACTOR_TYPES = ['Actor', 'GuestStar'];

export function aggregateActors(items) {
  if (!Array.isArray(items)) return [];
  const map = new Map();
  items.forEach(it => {
    (it?.People || []).forEach(p => {
      if (!p?.Id || !p?.Name) return;
      if (p.Type && !ACTOR_TYPES.includes(p.Type)) return;
      const entry = map.get(p.Id) || {
        Id: p.Id,
        Name: p.Name,
        ImageTags: { Primary: p.PrimaryImageTag || undefined },
        count: 0
      };
      entry.count += 1;
      map.set(p.Id, entry);
    });
  });
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count || a.Name.localeCompare(b.Name, 'zh-CN'))
    .slice(0, 300);
}

/**
 * 判断演员的角色名是否为"拼音垃圾"：人物名是中文、角色名却是纯 ASCII
 * （如 TMDB 刮削源给的 "Ma Qi"），对中文用户毫无信息量还容易被误认为
 * 另一个人名。中文角色名（如 "韦小宝"）或英文演员的角色不受影响。
 */
export function isRomanizedJunkRole(personName, role) {
  if (!personName || !role) return false;
  if (!/[\u4e00-\u9fff]/.test(personName)) return false;
  // 纯 ASCII（拉丁字母/数字/常见标点）判定，等价于 /^[\x00-\x7F]+$/ 但规避 lint no-control-regex
  return /^[\u0020-\u007E]+$/.test(role.trim()) && role.trim().length > 0;
}
