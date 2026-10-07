/**
 * Jellyfin Trickplay Engine & Parser
 * Supports Jellyfin 10.9+ Trickplay Manifests (sprite sheets).
 */

import { jellyfin } from '../api/jellyfinClient';

/**
 * Parse Trickplay info from item details or MediaSources
 * preferredWidth 缺省为 null = 使用清单中实际存在的最高档位
 * （服务端多档时任意场景都拿最清晰的档；单档服务器自动回退到唯一档）
 */
export function getTrickplayInfo(item, { preferredWidth = null } = {}) {
  const defaultAr = (item?.Width && item?.Height && item.Height > 0)
    ? (item.Width / item.Height)
    : (item?.PrimaryImageAspectRatio && item.PrimaryImageAspectRatio > 0 ? item.PrimaryImageAspectRatio : (16 / 9));
  const defaultIsVertical = defaultAr < 0.9;

  const defaultRet = { 
    width: preferredWidth, 
    height: Math.round(preferredWidth / defaultAr),
    aspectRatio: defaultAr,
    isVertical: defaultIsVertical,
    interval: 10, 
    id: item?.Id || null, 
    cols: 10, 
    rows: 10,
    hasTrickplay: false 
  };
  
  if (!item) return defaultRet;

  const mediaSource = item.MediaSources?.[0];
  const manifests = mediaSource?.Trickplay || mediaSource?.TrickPlay || mediaSource?.trickplay || item.Trickplay || item.TrickPlay;
  const id = mediaSource?.Id || item.Id || null;

  if (!manifests || typeof manifests !== 'object') {
    // If item has width info or default fallback
    return { ...defaultRet, id, hasTrickplay: false };
  }

  let config = manifests;
  const keys = Object.keys(manifests);
  
  // Unpack nested MediaSourceId if present
  if (keys.length === 1 && manifests[keys[0]] && typeof manifests[keys[0]] === 'object' && !manifests.Width && !manifests[320] && !manifests[640]) {
    config = manifests[keys[0]];
  }

  // 两条分支（config.Width 单档 / 数字键多档）都会完整赋值 width
  let width;
  let height = 180;
  let interval = 10;
  let cols = 10;
  let rows = 10;

  if (config.Width && !config[config.Width]) {
    width = config.Width;
    if (config.Height) height = config.Height;
    let rawInterval = config.Interval || 10000;
    if (rawInterval > 1000000) interval = rawInterval / 10000000;
    else if (rawInterval > 100) interval = rawInterval / 1000;
    else interval = rawInterval;

    if (config.TileWidth && config.TileWidth <= 20) {
      cols = config.TileWidth;
      rows = config.TileHeight || config.TileWidth;
    } else if (config.ThumbnailWidth && config.Width > config.ThumbnailWidth) {
      cols = Math.round(config.Width / config.ThumbnailWidth);
      rows = Math.round(config.Height / config.ThumbnailHeight);
    }
  } else {
    const widths = Object.keys(config).map(Number).filter(n => !isNaN(n));
    // 清单里没有任何数字宽度档位（空嵌套对象）：视为无 Trickplay，
    // 避免拼出指向 404 的 URL 渲染出黑框
    if (widths.length === 0) {
      return { ...defaultRet, id, hasTrickplay: false };
    }
    // preferredWidth 未指定 = 取实际存在的最高档（清晰度优先）
    if (widths.includes(preferredWidth)) {
      width = preferredWidth;
    } else if (preferredWidth === null) {
      width = Math.max(...widths);
    } else {
      width = widths.reduce((prev, curr) => Math.abs(curr - preferredWidth) < Math.abs(prev - preferredWidth) ? curr : prev);
    }
    const m = config[width.toString()] || config[width];
    if (m) {
      if (m.Height) height = m.Height;
      let rawInterval = m.Interval || 10000;
      if (rawInterval > 1000000) interval = rawInterval / 10000000;
      else if (rawInterval > 100) interval = rawInterval / 1000;
      else interval = rawInterval;

      if (m.TileWidth && m.TileWidth <= 20) {
        cols = m.TileWidth;
        rows = m.TileHeight || m.TileWidth;
      } else if (m.ThumbnailWidth && m.Width > m.ThumbnailWidth) {
        cols = Math.round(m.Width / m.ThumbnailWidth);
        rows = Math.round(m.Height / m.ThumbnailHeight);
      }
    }
  }

  let aspectRatio = null;
  if (width && height && height > 0) {
    aspectRatio = width / height;
  }
  if ((!aspectRatio || isNaN(aspectRatio)) && item.Width && item.Height && item.Height > 0) {
    aspectRatio = item.Width / item.Height;
  }
  if ((!aspectRatio || isNaN(aspectRatio)) && item.PrimaryImageAspectRatio && item.PrimaryImageAspectRatio > 0) {
    aspectRatio = item.PrimaryImageAspectRatio;
  }
  if (!aspectRatio || isNaN(aspectRatio)) {
    aspectRatio = 16 / 9;
  }

  const isVertical = aspectRatio < 0.9;

  return {
    width,
    height,
    aspectRatio,
    isVertical,
    interval: Math.max(1, interval),
    id,
    cols: Math.max(1, cols),
    rows: Math.max(1, rows),
    hasTrickplay: true
  };
}

const spriteCache = new Set();

export function preloadTrickplaySprite(imageUrl) {
  if (!imageUrl || typeof Image === 'undefined' || spriteCache.has(imageUrl)) return;
  spriteCache.add(imageUrl);
  const img = new Image();
  img.src = imageUrl;
}

/**
 * 整片雪碧图预热（jellow「缩略图全部预切到内存」的 web 等价）：
 * 开窗时把当前条目的全部 Trickplay 分块图用 Image 预载进浏览器缓存，
 * 滑动 seek 时缩略图零网络等待。上限 40 张防超长片刷爆缓存。
 */
export function preloadAllTrickplaySprites(item) {
  if (!item || typeof Image === 'undefined' || !jellyfin.auth.serverUrl) return;
  const tp = getTrickplayInfo(item);
  if (!tp.hasTrickplay) return;
  const durationSec = item.RunTimeTicks ? item.RunTimeTicks / 10000000 : 0;
  if (!durationSec) return;
  const targetId = tp.id || item.Id;
  const totalTiles = Math.floor(durationSec / tp.interval);
  const isSprite = tp.cols > 1 && tp.rows > 1;
  const tilesPerSheet = Math.max(1, tp.cols * tp.rows);
  const sheetCount = isSprite ? Math.ceil(totalTiles / tilesPerSheet) : totalTiles + 1;
  const count = Math.min(sheetCount, 40);
  for (let i = 0; i < count; i++) {
    preloadTrickplaySprite(`${jellyfin.auth.serverUrl}/Videos/${targetId}/Trickplay/${tp.width}/${i}.jpg?ApiKey=${jellyfin.auth.token}&MediaSourceId=${targetId}`);
  }
}

/**
 * Calculate sprite URL and CSS background coordinates for a given playback time in seconds
 */
export function getTrickplayStyle(item, timeInSeconds, options = {}) {
  if (!item || !jellyfin.auth.serverUrl) return null;

  const tp = getTrickplayInfo(item, options);
  // 无 Trickplay 清单时不返回样式（组件回退显示"无 Trickplay 帧"提示），
  // 避免拼出指向 404 的 URL 显示坏图
  if (!tp.hasTrickplay) return null;

  const targetId = tp.id || item.Id;
  const time = Math.max(0, timeInSeconds || 0);

  const totalTiles = Math.floor(time / tp.interval);
  const isSprite = tp.cols > 1 && tp.rows > 1;
  const tilesPerSheet = tp.cols * tp.rows;
  const spriteIdx = isSprite ? Math.floor(totalTiles / tilesPerSheet) : totalTiles;

  const imageUrl = `${jellyfin.auth.serverUrl}/Videos/${targetId}/Trickplay/${tp.width}/${spriteIdx}.jpg?ApiKey=${jellyfin.auth.token}&MediaSourceId=${targetId}`;

  preloadTrickplaySprite(imageUrl);

  if (isSprite) {
    const tileIdx = totalTiles % tilesPerSheet;
    const colIdx = tileIdx % tp.cols;
    const rowIdx = Math.floor(tileIdx / tp.cols);
    
    const posX = tp.cols > 1 ? (colIdx / (tp.cols - 1)) * 100 : 0;
    const posY = tp.rows > 1 ? (rowIdx / (tp.rows - 1)) * 100 : 0;

    return {
      backgroundImage: `url("${imageUrl}")`,
      backgroundSize: `${tp.cols * 100}% ${tp.rows * 100}%`,
      backgroundPosition: `${posX}% ${posY}%`,
      backgroundRepeat: 'no-repeat',
      aspectRatio: `${tp.aspectRatio}`
    };
  }

  return {
    backgroundImage: `url("${imageUrl}")`,
    backgroundSize: 'contain',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    aspectRatio: `${tp.aspectRatio}`
  };
}
