/**
 * Persistent Local Media & Views Cache (Blissful-Faraday Style)
 * Stores full lightweight media metadata & user views in IndexedDB & LocalStorage.
 * Enables < 5ms instant startup on page refresh without hitting the network.
 */

const DB_NAME = 'jellyfin_faraday_db';
const DB_VERSION = 2;
const STORE_ITEMS = 'media_items';
const STORE_VIEWS = 'user_views';
const STORE_META = 'meta_info';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

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
export async function loadFullCache() {
  try {
    const db = await openDB();
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
        if (views.length === 0) {
          try {
            views = JSON.parse(localStorage.getItem('jf_cached_views') || '[]');
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
    return { items: [], views: [], lastSyncTime: null, count: 0 };
  }
}

/**
 * Save full media catalog & views to cache
 */
export async function saveFullCache(items = [], views = []) {
  if (!items || items.length === 0) return false;
  try {
    // Save views to localStorage for ultra-fast zero-latency read
    if (views && views.length > 0) {
      try {
        localStorage.setItem('jf_cached_views', JSON.stringify(views));
      } catch {}
    }

    const db = await openDB();
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
export async function updateItemInCache(item) {
  if (!item?.Id) return;
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_ITEMS], 'readwrite');
    tx.objectStore(STORE_ITEMS).put(item);
  } catch (e) {
    console.warn('Failed to update item in cache:', e);
  }
}

/**
 * Delete single item from cache
 */
export async function deleteItemFromCache(itemId) {
  if (!itemId) return;
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_ITEMS], 'readwrite');
    tx.objectStore(STORE_ITEMS).delete(itemId);
  } catch (e) {
    console.warn('Failed to delete item from cache:', e);
  }
}

/**
 * Clear all cached data
 */
export async function clearLibraryCache() {
  try {
    localStorage.removeItem('jf_cached_views');
    const db = await openDB();
    const tx = db.transaction([STORE_ITEMS, STORE_VIEWS, STORE_META], 'readwrite');
    tx.objectStore(STORE_ITEMS).clear();
    tx.objectStore(STORE_VIEWS).clear();
    tx.objectStore(STORE_META).clear();
  } catch (e) {
    console.warn('Failed to clear cache:', e);
  }
}
