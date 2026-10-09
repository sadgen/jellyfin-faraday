/**
 * Jellyfin Faraday Service Worker（PWA 离线壳）
 * 策略：
 * - 导航请求（HTML）：网络优先，离线回退缓存的壳页面 —— 应用可离线打开，
 *   配合 IndexedDB 全量媒体缓存实现"断网秒开媒体库"。
 * - 同源静态资源（js/css/图标等）：Stale-While-Revalidate。
 * - 跨域请求（Jellyfin 媒体服务器 API / 视频流 / 图片）：不拦截（含 api_key 的请求
 *   不落入 Cache Storage，避免令牌泄漏）。
 */

const CACHE_NAME = 'faraday-shell-v2';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './faraday.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key.startsWith('faraday-shell-') && key !== CACHE_NAME).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 不拦截跨域请求（Jellyfin 服务器 API / 流媒体 / 图片，避免缓存含令牌的响应）
  if (url.origin !== self.location.origin) return;
  // Cache only the app shell and built assets, never same-origin server APIs.
  const scopePath = new URL(self.registration.scope).pathname;
  const relativePath = url.pathname.startsWith(scopePath) ? url.pathname.slice(scopePath.length) : null;
  if (relativePath === null) return;
  if (url.search || request.headers.has('Authorization') || request.headers.has('X-MediaBrowser-Token')) return;
  if (request.mode !== 'navigate' && (relativePath === null ||
      !(relativePath.startsWith('assets/') || ['manifest.webmanifest', 'faraday.svg', 'index.html', ''].includes(relativePath)))) return;

  // 导航请求：网络优先，离线回退应用壳
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          if (response.ok && response.headers.get('Content-Type')?.includes('text/html')) {
            caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy)).catch(() => {});
          }
          return response;
        })
        .catch(() =>
          caches.match('./index.html').then(cached => cached || caches.match('./'))
        )
    );
    return;
  }

  // 同源静态资源：Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request)
        .then(response => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
