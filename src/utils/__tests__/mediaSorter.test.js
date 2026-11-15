import { describe, it, expect } from 'vitest';
import { sortMediaItems, sortMediaItemsByDuplicateGroups } from '../mediaSorter';

describe('mediaSorter sorting utilities', () => {
  const items = [
    { Id: '1', Name: 'Alpha', ProductionYear: 2020, CommunityRating: 7.5, UserData: { PlayCount: 3 }, DateCreated: '2024-01-01' },
    { Id: '2', Name: 'Beta', ProductionYear: 2023, CommunityRating: 9.0, UserData: { PlayCount: 10 }, DateCreated: '2024-05-01' },
    { Id: '3', Name: 'Gamma', ProductionYear: 2018, CommunityRating: 6.0, UserData: { PlayCount: 0 }, DateCreated: '2023-01-01' }
  ];

  it('sorts by date descending and ascending', () => {
    const desc = sortMediaItems(items, 'date_desc');
    expect(desc.map(i => i.Id)).toEqual(['2', '1', '3']);

    const asc = sortMediaItems(items, 'date_asc');
    expect(asc.map(i => i.Id)).toEqual(['3', '1', '2']);
  });

  it('sorts by name ascending and descending', () => {
    const asc = sortMediaItems(items, 'name_asc');
    expect(asc.map(i => i.Name)).toEqual(['Alpha', 'Beta', 'Gamma']);

    const desc = sortMediaItems(items, 'name_desc');
    expect(desc.map(i => i.Name)).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('sorts by rating descending', () => {
    const desc = sortMediaItems(items, 'rating_desc');
    expect(desc.map(i => i.Id)).toEqual(['2', '1', '3']);
  });

  it('sorts by playcount descending', () => {
    const desc = sortMediaItems(items, 'playcount_desc');
    expect(desc.map(i => i.Id)).toEqual(['2', '1', '3']);
  });

  it('shuffles items for random sort while preserving the multiset', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ Id: String(i), Name: `V${i}` }));
    const shuffled = sortMediaItems(many, 'random');
    expect(shuffled.map(i => i.Id).sort((a, b) => Number(a) - Number(b)))
      .toEqual(many.map(i => i.Id));
    // 不修改原数组
    expect(many[0].Id).toBe('0');
  });

  it('keeps random order stable across recomputes and new item insertion', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ Id: String(i), Name: `V${i}` }));
    const first = sortMediaItems(many, 'random').map(i => i.Id);
    const second = sortMediaItems(many, 'random').map(i => i.Id);
    expect(second).toEqual(first);

    // 追加新条目后，既有条目相对顺序不变，新条目按自己的键插入
    const extended = [...many, { Id: '60', Name: 'V60' }, { Id: '61', Name: 'V61' }];
    const after = sortMediaItems(extended, 'random').map(i => i.Id);
    const before = after.filter(id => id !== '60' && id !== '61');
    expect(before).toEqual(first);
  });

  it('sorts normal view by exact DateCreated (no day grouping)', () => {
    const sameDay = [
      { Id: 'a', DateCreated: '2026-11-10T09:00:00Z' },
      { Id: 'b', DateCreated: '2026-11-10T11:00:00Z' },
      { Id: 'c', DateCreated: '2026-11-10T08:00:00Z' }
    ];
    expect(sortMediaItems(sameDay, 'date_desc').map(i => i.Id)).toEqual(['b', 'a', 'c']);
    expect(sortMediaItems(sameDay, 'date_asc').map(i => i.Id)).toEqual(['c', 'a', 'b']);
  });
});

describe('sortMediaItemsByDuplicateGroups (重复筛选视图)', () => {
  const D = t => `2026-11-10T${t}:00Z`;
  const items = [
    { Id: 'A旧', DateCreated: '2024-01-01T00:00:00Z' },
    { Id: 'A新', DateCreated: D('09:00') },
    { Id: 'B旧', DateCreated: '2023-05-05T00:00:00Z' },
    { Id: 'B新', DateCreated: D('07:00') },
    { Id: '普通1', DateCreated: D('10:00') },
    { Id: '普通2', DateCreated: D('08:00') }
  ];
  const groups = [
    { code: 'A', items: [items[0], items[1]] },
    { code: 'B', items: [items[2], items[3]] }
  ];

  it('keeps every duplicate group contiguous even with same-day items and multiple groups', () => {
    const desc = sortMediaItemsByDuplicateGroups(items, 'date_desc', groups).map(i => i.Id);
    expect(desc).toEqual(['普通1', 'A新', 'A旧', '普通2', 'B新', 'B旧']);

    const asc = sortMediaItemsByDuplicateGroups(items, 'date_asc', groups).map(i => i.Id);
    expect(asc).toEqual(['B旧', 'B新', 'A旧', 'A新', '普通2', '普通1']);
  });

  it('places a group by its newest member (desc) / oldest member (asc)', () => {
    const desc = sortMediaItemsByDuplicateGroups(items, 'date_desc', groups);
    // A 组按 A新 的 09:00 占位，排在 10:00 与 08:00 之间
    expect(desc.findIndex(i => i.Id === 'A新')).toBe(1);
    expect(desc.findIndex(i => i.Id === 'A旧')).toBe(2);

    const asc = sortMediaItemsByDuplicateGroups(items, 'date_asc', groups);
    // B 组按 B旧 的 2023 占位，整体最靠前
    expect(asc.slice(0, 2).map(i => i.Id)).toEqual(['B旧', 'B新']);
  });

  it('yields the same result as plain sorting when no group has 2+ members present', () => {
    const singleOnly = [
      { Id: 'A旧', DateCreated: '2024-01-01T00:00:00Z' },
      { Id: '普通', DateCreated: '2025-01-01T00:00:00Z' }
    ];
    expect(sortMediaItemsByDuplicateGroups(singleOnly, 'date_desc', groups))
      .toEqual(sortMediaItems(singleOnly, 'date_desc'));
  });

  it('falls back to plain sorting for non-date/year sort methods', () => {
    const named = items.map((it, idx) => ({ ...it, Name: `N${idx}` }));
    expect(sortMediaItemsByDuplicateGroups(named, 'name_asc', groups))
      .toEqual(sortMediaItems(named, 'name_asc'));
  });
});
