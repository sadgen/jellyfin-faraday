/**
 * Smart Media Stacking (自制视频分段切片智能聚合)
 * 将同组切片（如 xxx_part1/part2, xxx_cd1/cd2, xxx_1/2, xxx-1/2）聚合成单一主卡片，
 * 在海报上显示切片数量角标（如"共 3 段"），点击时自动传入分段列表实现切片轮播。
 */

/**
 * 提取切片视频的基础分组名与切片序号
 */
export function extractPartInfo(name = '') {
  if (!name) return null;
  const clean = name.replace(/\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v)$/i, '').trim();

  // 1. 匹配 partN, ptN, cdN, discN (如 _part1, -part02, .cd1)
  const partMatch = clean.match(/^(.*?)[-_.\s]+(?:part|pt|cd|disc)[-_.\s]*0*(\d{1,2})$/i);
  if (partMatch) {
    return {
      baseName: partMatch[1].trim(),
      partIndex: parseInt(partMatch[2], 10),
      rawMatch: partMatch[0]
    };
  }

  // 2. 匹配以短横线或下划线结尾的纯序号 (如 vlog_20240101_1, clip-2)
  const trailingNumMatch = clean.match(/^(.*?)[-_]0*([1-9]\d?)$/i);
  if (trailingNumMatch) {
    // 排除形如 ABC-123 的标准番号
    if (!/^[a-zA-Z]{2,6}$/.test(trailingNumMatch[1])) {
      return {
        baseName: trailingNumMatch[1].trim(),
        partIndex: parseInt(trailingNumMatch[2], 10),
        rawMatch: trailingNumMatch[0]
      };
    }
  }

  return null;
}

/**
 * 将媒体列表智能聚合：
 * 如果同组基础名称下存在 ≥ 2 个分段，聚合成一个虚拟主条目（附带 stackedParts 列表与总时长），
 * 其余分段折叠，避免海报列表被切片充斥。
 */
export function stackMediaItems(items = []) {
  const groups = new Map();
  const unstacked = [];

  items.forEach(item => {
    const info = extractPartInfo(item.Name || '');
    if (!info) {
      unstacked.push(item);
      return;
    }

    const key = info.baseName.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        baseName: info.baseName,
        parts: []
      });
    }
    groups.get(key).parts.push({
      item,
      partIndex: info.partIndex
    });
  });

  const result = [...unstacked];

  groups.forEach(group => {
    if (group.parts.length === 1) {
      // 只有 1 个切片时不聚合，直接原样展示
      result.push(group.parts[0].item);
      return;
    }

    // 按切片序号正序排列
    group.parts.sort((a, b) => a.partIndex - b.partIndex);
    const sortedItems = group.parts.map(p => p.item);
    const primary = sortedItems[0];

    // 计算分段总时长
    let totalTicks = 0;
    sortedItems.forEach(it => {
      totalTicks += it.RunTimeTicks || 0;
    });

    const stackedItem = {
      ...primary,
      Name: group.baseName,
      RunTimeTicks: totalTicks > 0 ? totalTicks : primary.RunTimeTicks,
      isStacked: true,
      stackedCount: sortedItems.length,
      stackedItems: sortedItems
    };

    result.push(stackedItem);
  });

  return result;
}
