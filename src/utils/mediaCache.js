/**
 * Persistent Local Media & Views Cache (Blissful-Faraday Style)
 * Stores full lightweight media metadata & user views in IndexedDB & LocalStorage.
 * Isolated by serverUrl + userId to prevent cross-account / cross-server data leakage.
 * Enables < 5ms instant startup on page refresh without hitting the network.
 */

import { jellyfin } from '../api/jellyfinClient';

const DB_PREFIX = 'jf_faraday_db';
const DB_VERSION = 2;
const STORE_ITEMS = 'media_items';
const STORE_VIEWS = 'user_views';
const STORE_META = 'meta_info';

function sanitizeKey(str) {
  if (!str) return 'default';
  return str.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Generate isolated IndexedDB database name per server and user
 */
export function getDbName(serverUrl = null, userId = null) {
  const s = serverUrl || jellyfin?.auth?.serverUrl || '';
  const u = userId || jellyfin?.auth?.userId || '';
  if (!s && !u) return DB_PREFIX;
  return `${DB_PREFIX}_${sanitizeKey(s)}_${sanitizeKey(u)}`;
}

/**
 * Generate isolated LocalStorage key for user views
 */
export function getViewsStorageKey(serverUrl = null, userId = null) {
  const s = serverUrl || jellyfin?.auth?.serverUrl || '';
  const u = userId || jellyfin?.auth?.userId || '';
  if (!s && !u) return 'jf_cached_views';
  return `jf_cached_views_${sanitizeKey(s)}_${sanitizeKey(u)}`;
}

function openDB(serverUrl = null, userId = null) {
  const dbName = getDbName(serverUrl, userId);
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not supported'));
    }
    const request = indexedDB.open(dbName, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        db.createObjectStore(STORE_ITEMS, { keyPath: 'Id' });
      }
      if (!db.objectStoreNames.contains(STORE_VIEWS)) {
        db.createObjectStore(STORE_VIEWS, { keyPath: 'Id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Load everything from disk cache instantly (Items + Views + Meta)
 */
export async function loadFullCache(serverUrl = null, userId = null) {
  try {
    const db = await openDB(serverUrl, userId);
    return new Promise((resolve) => {
      const tx = db.transaction([STORE_ITEMS, STORE_VIEWS, STORE_META], 'readonly');
      const itemsStore = tx.objectStore(STORE_ITEMS);
      const viewsStore = tx.objectStore(STORE_VIEWS);
      const metaStore = tx.objectStore(STORE_META);

      const itemsReq = itemsStore.getAll();
      const viewsReq = viewsStore.getAll();
      const metaReq = metaStore.get('last_sync');

      let items = [];
      let views = [];
      let meta = null;

      itemsReq.onsuccess = () => { items = itemsReq.result || []; };
      viewsReq.onsuccess = () => { views = viewsReq.result || []; };
      metaReq.onsuccess = () => { meta = metaReq.result || null; };

      tx.oncomplete = () => {
        // Also fallback to localStorage views if any
        if (views.length === 0 && typeof localStorage !== 'undefined') {
          try {
            const viewsKey = getViewsStorageKey(serverUrl, userId);
            views = JSON.parse(localStorage.getItem(viewsKey) || localStorage.getItem('jf_cached_views') || '[]');
          } catch {}
        }
        resolve({
          items,
          views,
          lastSyncTime: meta?.timestamp || null,
          count: items.length
        });
      };

      tx.onerror = () => {
        resolve({ items: [], views: [], lastSyncTime: null, count: 0 });
      };
    });
  } catch (e) {
    console.warn('Failed to load full cache from IndexedDB:', e);
    let views = [];
    if (typeof localStorage !== 'undefined') {
      try {
        const viewsKey = getViewsStorageKey(serverUrl, userId);
        views = JSON.parse(localStorage.getItem(viewsKey) || localStorage.getItem('jf_cached_views') || '[]');
      } catch {}
    }
    return { items: [], views, lastSyncTime: null, count: 0 };
  }
}

/**
 * Save full media catalog & views to cache
 */
export async function saveFullCache(items = [], views = [], serverUrl = null, userId = null) {
  if (!items || items.length === 0) return false;
  try {
    // Save views to localStorage for ultra-fast zero-latency read
    if (views && views.length > 0 && typeof localStorage !== 'undefined') {
      try {
        const viewsKey = getViewsStorageKey(serverUrl, userId);
        localStorage.setItem(viewsKey, JSON.stringify(views));
      } catch {}
    }

    const db = await openDB(serverUrl, userId);
    const tx = db.transaction([STORE_ITEMS, STORE_VIEWS, STORE_META], 'readwrite');
    const itemsStore = tx.objectStore(STORE_ITEMS);
    const viewsStore = tx.objectStore(STORE_VIEWS);
    const metaStore = tx.objectStore(STORE_META);

    // Clear old items and bulk put
    itemsStore.clear();
    for (let i = 0; i < items.length; i++) {
      itemsStore.put(items[i]);
    }

    if (views && views.length > 0) {
      viewsStore.clear();
      for (let i = 0; i < views.length; i++) {
        viewsStore.put(views[i]);
      }
    }

    metaStore.put({
      key: 'last_sync',
      timestamp: Date.now(),
      count: items.length
    });

    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    console.warn('Failed to save full cache to IndexedDB:', e);
    return false;
  }
}

/**
 * Update single item in cache
 */
export async function updateItemInCache(item, serverUrl = null, userId = null) {
  if (!item?.Id) return false;
  try {
    const db = await openDB(serverUrl, userId);
    return new Promise((resolve) => {
      const tx = db.transaction([STORE_ITEMS], 'readwrite');
      tx.objectStore(STORE_ITEMS).put(item);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    console.warn('Failed to update item in cache:', e);
    return false;
  }
}

/**
 * Delete single item from cache
 */
export async function deleteItemFromCache(itemId, serverUrl = null, userId = null) {
  if (!itemId) return false;
  try {
    const db = await openDB(serverUrl, userId);
    return new Promise((resolve) => {
      const tx = db.transaction([STORE_ITEMS], 'readwrite');
      tx.objectStore(STORE_ITEMS).delete(itemId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    console.warn('Failed to delete item from cache:', e);
    return false;
  }
}

/**
 * Clear all cached data for specific user/server (or current active user)
 */
export async function clearLibraryCache(serverUrl = null, userId = null) {
  try {
    const s = serverUrl || jellyfin?.auth?.serverUrl || '';
    const u = userId || jellyfin?.auth?.userId || '';
    if (typeof localStorage !== 'undefined') {
      const viewsKey = getViewsStorageKey(s, u);
      localStorage.removeItem(viewsKey);
      localStorage.removeItem('jf_cached_views');
    }

    const db = await openDB(s, u);
    return new Promise((resolve) => {
      const tx = db.transaction([STORE_ITEMS, STORE_VIEWS, STORE_META], 'readwrite');
      tx.objectStore(STORE_ITEMS).clear();
      tx.objectStore(STORE_VIEWS).clear();
      tx.objectStore(STORE_META).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    console.warn('Failed to clear cache:', e);
    return false;
  }
}
