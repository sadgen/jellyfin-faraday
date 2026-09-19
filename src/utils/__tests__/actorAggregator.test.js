import { describe, it, expect } from 'vitest';
import { aggregateActors, isRomanizedJunkRole } from '../actorAggregator';

describe('aggregateActors', () => {
  it('仅保留演员（Actor/GuestStar/无 Type），过滤幕后人员', () => {
    const list = aggregateActors([
      { People: [
        { Id: 'a1', Name: '王凯', Type: 'Actor' },
        { Id: 'd1', Name: '王小枪', Type: 'Director' },
        { Id: 'w1', Name: '某某', Type: 'Writer' },
        { Id: 'g1', Name: '嘉宾', Type: 'GuestStar' },
        { Id: 'n1', Name: '无类型' },
      ] }]
    );
    expect(list.map(p => p.Name).sort()).toEqual(['嘉宾', '王凯', '无类型'].sort());
  });

  it('跨条目按 Id 去重并累计出演次数', () => {
    const list = aggregateActors([
      { People: [{ Id: 'a1', Name: '王凯', Type: 'Actor' }] },
      { People: [{ Id: 'a1', Name: '王凯', Type: 'Actor' }] },
      { People: [{ Id: 'a1', Name: '王凯', Type: 'Actor' }] },
      { People: [{ Id: 'a2', Name: '彭昱畅', Type: 'Actor' }] },
    ]);
    expect(list).toHaveLength(2);
    expect(list[0].Name).toBe('王凯');
    expect(list[0].count).toBe(3);
    expect(list[1].count).toBe(1);
  });

  it('次数相同按中文名排序', () => {
    const list = aggregateActors([
      { People: [{ Id: 'b', Name: '乙', Type: 'Actor' }] },
      { People: [{ Id: 'a', Name: '甲', Type: 'Actor' }] },
    ]);
    expect(list.map(p => p.Name)).toEqual(['乙', '甲'].sort((x, y) => x.localeCompare(y, 'zh-CN')));
  });

  it('跳过缺少 Id 或 Name 的脏数据', () => {
    const list = aggregateActors([
      { People: [{ Name: '无Id' }, { Id: 'x' }, {}] },
    ]);
    expect(list).toHaveLength(0);
  });

  it('携带 PrimaryImageTag 供头像渲染', () => {
    const list = aggregateActors([
      { People: [{ Id: 'a1', Name: '王凯', Type: 'Actor', PrimaryImageTag: 'tag1' }] },
    ]);
    expect(list[0].ImageTags).toEqual({ Primary: 'tag1' });
  });

  it('无 People 或非法输入返回空数组', () => {
    expect(aggregateActors([])).toEqual([]);
    expect(aggregateActors(null)).toEqual([]);
    expect(aggregateActors('x')).toEqual([]);
  });
});

describe('isRomanizedJunkRole', () => {
  it('中文名 + 纯 ASCII 角色名 = 拼音垃圾', () => {
    expect(isRomanizedJunkRole('王凯', 'Ma Qi')).toBe(true);
    expect(isRomanizedJunkRole('邱天', 'Qiu Tian')).toBe(true);
  });

  it('中文名 + 中文角色名有效', () => {
    expect(isRomanizedJunkRole('张一山', '韦小宝')).toBe(false);
  });

  it('英文演员 + 英文角色名不受影响', () => {
    expect(isRomanizedJunkRole('Kevin Hart', 'Himself')).toBe(false);
  });

  it('空角色名或空人名不判定为垃圾', () => {
    expect(isRomanizedJunkRole('王凯', '')).toBe(false);
    expect(isRomanizedJunkRole('王凯', null)).toBe(false);
    expect(isRomanizedJunkRole('', 'Ma Qi')).toBe(false);
  });
});
