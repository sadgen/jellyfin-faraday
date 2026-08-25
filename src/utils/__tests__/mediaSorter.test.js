import { describe, it, expect } from 'vitest';
import { sortMediaItems } from '../mediaSorter';

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
});
