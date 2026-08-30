/**
 * Jellyfin Trickplay Engine & Parser
 * Supports Jellyfin 10.9+ Trickplay Manifests (sprite sheets).
 */

import { jellyfin } from '../api/jellyfinClient';

/**
 * Parse Trickplay info from item details or MediaSources
 */
export function getTrickplayInfo(item) {
  const defaultRet = { 
    width: 320, 
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

  let width = 320;
  let interval = 10;
  let cols = 10;
  let rows = 10;

  if (config.Width && !config[config.Width]) {
    width = config.Width;
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
    if (widths.length > 0) {
      width = widths.includes(640) ? 640 : (widths.includes(320) ? 320 : Math.max(...widths));
      const m = config[width.toString()] || config[width];
      if (m) {
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
  }

  return {
    width,
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
 * Calculate sprite URL and CSS background coordinates for a given playback time in seconds
 */
export function getTrickplayStyle(item, timeInSeconds) {
  if (!item || !jellyfin.auth.serverUrl) return null;

  const tp = getTrickplayInfo(item);
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
      backgroundRepeat: 'no-repeat'
    };
  }

  return {
    backgroundImage: `url("${imageUrl}")`,
    backgroundSize: 'contain',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat'
  };
}
