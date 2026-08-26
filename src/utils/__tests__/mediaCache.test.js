import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { 
  getDbName, 
  getViewsStorageKey, 
  loadFullCache, 
  saveFullCache, 
  updateItemInCache, 
  deleteItemFromCache, 
  clearLibraryCache 
} from '../mediaCache';

describe('mediaCache multi-user isolation and operations', () => {
  const serverA = 'https://jellyfin.server-a.com';
  const user1 = 'user_111';
  const serverB = 'https://jellyfin.server-b.com';
  const user2 = 'user_222';

  beforeEach(async () => {
    localStorage.clear();
    await clearLibraryCache(serverA, user1);
    await clearLibraryCache(serverB, user2);
  });

  it('generates distinct DB names and LocalStorage keys for different users/servers', () => {
    const db1 = getDbName(serverA, user1);
    const db2 = getDbName(serverB, user2);
    expect(db1).not.toBe(db2);
    expect(db1).toContain('user_111');
    expect(db2).toContain('user_222');

    const key1 = getViewsStorageKey(serverA, user1);
    const key2 = getViewsStorageKey(serverB, user2);
    expect(key1).not.toBe(key2);
  });

  it('saves and loads items and views for specific user/server', async () => {
    const mockItems = [
      { Id: 'item-1', Name: 'Movie 1', ProductionYear: 2024 },
      { Id: 'item-2', Name: 'Movie 2', ProductionYear: 2023 }
    ];
    const mockViews = [
      { Id: 'view-1', Name: 'Movies' }
    ];

    const saved = await saveFullCache(mockItems, mockViews, serverA, user1);
    expect(saved).toBe(true);

    const loaded = await loadFullCache(serverA, user1);
    expect(loaded.count).toBe(2);
    expect(loaded.items.length).toBe(2);
    expect(loaded.items[0].Name).toBe('Movie 1');
    expect(loaded.views.length).toBe(1);

    // Verify isolation: User 2 has empty cache
    const loadedUser2 = await loadFullCache(serverB, user2);
    expect(loadedUser2.count).toBe(0);
    expect(loadedUser2.items.length).toBe(0);
  });

  it('updates single item in cache without affecting others', async () => {
    const mockItems = [
      { Id: 'item-1', Name: 'Original Name', UserData: { Played: false } }
    ];
    await saveFullCache(mockItems, [], serverA, user1);

    await updateItemInCache({ Id: 'item-1', Name: 'Updated Name', UserData: { Played: true } }, serverA, user1);

    const loaded = await loadFullCache(serverA, user1);
    expect(loaded.items[0].Name).toBe('Updated Name');
    expect(loaded.items[0].UserData.Played).toBe(true);
  });

  it('deletes single item from cache', async () => {
    const mockItems = [
      { Id: 'item-1', Name: 'Movie 1' },
      { Id: 'item-2', Name: 'Movie 2' }
    ];
    await saveFullCache(mockItems, [], serverA, user1);
    await deleteItemFromCache('item-1', serverA, user1);

    const loaded = await loadFullCache(serverA, user1);
    expect(loaded.count).toBe(1);
    expect(loaded.items[0].Id).toBe('item-2');
  });

  it('clears library cache completely on logout', async () => {
    const mockItems = [{ Id: 'item-1', Name: 'Movie 1' }];
    const mockViews = [{ Id: 'view-1', Name: 'Movies' }];
    await saveFullCache(mockItems, mockViews, serverA, user1);

    await clearLibraryCache(serverA, user1);

    const loaded = await loadFullCache(serverA, user1);
    expect(loaded.count).toBe(0);
    expect(loaded.items.length).toBe(0);
  });

  it('does not expose legacy global views to a different account', async () => {
    localStorage.setItem('jf_cached_views', JSON.stringify([
      { Id: 'legacy-private-view', Name: 'Previous User Library' }
    ]));

    const loaded = await loadFullCache(serverB, user2);

    expect(loaded.views).toEqual([]);
  });
});
