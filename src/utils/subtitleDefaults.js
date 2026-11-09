/**
 * 字幕默认轨（每部片一个，本账号全设备生效）
 *
 * 存储双层：localStorage 同步缓存（播放面挂载时秒读、无闪断）+ 服务端
 * DisplayPreferences CustomPrefs KV（同账号跨设备共享，主存储）。
 * 任何写入先落本地再异步同步服务端，并广播 faraday:subtitle_default_changed
 * 让所有打开的播放面/弹窗即时刷新。
 *
 * 记录的是流指纹（外部轨=文件名基名、内嵌轨=index+DisplayTitle+语言）而非裸
 * index——删轨后 Jellyfin 会对剩余轨道重编号，指纹仍能找回正确的轨道。
 */

import { jellyfin } from '../api/jellyfinClient';

const STORAGE_KEY = 'jf_subtitle_default_map';
export const SUBTITLE_DEFAULT_EVENT = 'faraday:subtitle_default_changed';

function loadLocalMap() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function persistLocalMap(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 存储失败不影响功能本身（仅本设备失去离线缓存）
  }
}

function broadcast(detail) {
  try {
    window.dispatchEvent(new CustomEvent(SUBTITLE_DEFAULT_EVENT, { detail }));
  } catch {
    // ignore
  }
}

/** 读某条片的默认轨指纹；未记录返回 null */
export function getDefaultSubtitle(itemId) {
  if (!itemId) return null;
  return loadLocalMap()[itemId] || null;
}

/** 设某条片的默认轨（stream 为 MediaStream）；本地即时生效，服务端异步同步 */
export function saveDefaultSubtitle(itemId, stream) {
  if (!itemId || !stream) return;
  const map = loadLocalMap();
  const record = {
    index: stream.Index,
    external: Boolean(stream.IsExternal),
    language: stream.Language || '',
    displayTitle: stream.DisplayTitle || stream.Title || '',
    path: (stream.Path || '').split(/[\\/]/).pop(),
    ts: Date.now()
  };
  map[itemId] = record;
  persistLocalMap(map);
  broadcast(record);
  jellyfin.saveSubtitleDefaults(map).catch(() => {});
}

/** 取消某条片的默认轨（恢复启发式自动选轨） */
export function clearDefaultSubtitle(itemId) {
  if (!itemId) return;
  const map = loadLocalMap();
  if (!map[itemId]) return;
  delete map[itemId];
  persistLocalMap(map);
  broadcast({ itemId, removed: true });
  jellyfin.saveSubtitleDefaults(map).catch(() => {});
}

/** 订阅默认轨变化（跨窗口/跨弹窗广播）；返回退订函数 */
export function subscribeSubtitleDefaultChanges(fn) {
  window.addEventListener(SUBTITLE_DEFAULT_EVENT, fn);
  return () => window.removeEventListener(SUBTITLE_DEFAULT_EVENT, fn);
}

/**
 * 与服务端 KV 双向合并（服务端为准，本地 ts 更新的条目上抛保存）。
 * 供播放面/弹窗打开时调用一次：本地秒读兜底在先，服务端随后校正。
 * 服务器不可达时保持本地数据，返回本地 map。
 */
export async function syncSubtitleDefaultsWithServer() {
  const serverMap = await jellyfin.getSubtitleDefaults();
  if (!serverMap) return loadLocalMap();
  const local = loadLocalMap();
  const merged = { ...serverMap };
  let changed = false;
  for (const [itemId, rec] of Object.entries(local)) {
    const serverRec = serverMap[itemId];
    if (!serverRec || (rec?.ts || 0) > (serverRec?.ts || 0)) {
      merged[itemId] = rec;
      changed = true;
    }
  }
  persistLocalMap(merged);
  if (changed) {
    jellyfin.saveSubtitleDefaults(merged).catch(() => {});
    broadcast({ synced: true });
  }
  return merged;
}
