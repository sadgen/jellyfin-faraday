/**
 * IndexedDB Persistent Local Media Cache (Blissful-Faraday Style)
 * Stores full lightweight media metadata on disk in the browser.
 * Provides < 10ms instant startup on page reload.
 */

const DB_NAME = 'jellyfin_faraday_db';
const DB_VERSION = 1;
const STORE_NAME = 'media_items';
const META_STORE = 'meta_info';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'Id' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getLibraryFromCache() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };
      request.onerror = () => {
        resolve([]);
      };
    });
  } catch (e) {
    console.warn('Failed to read from IndexedDB cache:', e);
    return [];
  }
}

export async function saveLibraryToCache(items = []) {
  if (!items || items.length === 0) return;
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const metaStore = tx.objectStore(META_STORE);

    // Clear old records and save fresh batch
    store.clear();
    for (const item of items) {
      store.put(item);
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
    console.warn('Failed to save to IndexedDB cache:', e);
  }
}

export async function clearLibraryCache() {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.objectStore(META_STORE).clear();
  } catch (e) {
    console.warn('Failed to clear IndexedDB cache:', e);
  }
}
