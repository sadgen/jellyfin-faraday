import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * Fisher-Yates Shuffle Algorithm
 */
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Session-Level Never-Repeat Queue Hook (blissful-faraday pattern)
 */
export function useSessionQueue(items = [], filterMode = 'pure_random', activeTileCount = 2, initialItem = null) {
  const [displayedItems, setDisplayedItems] = useState([]);
  const displayedItemsRef = useRef([]);

  const remainingQueueRef = useRef([]);
  const consumedIdsSetRef = useRef(new Set());
  const prevFilterKeyRef = useRef('');

  // 1. Calculate filtered & prioritized items based on active mode
  const filteredPool = useMemo(() => {
    if (!items || items.length === 0) return [];

    let pool = [];

    switch (filterMode) {
      case 'favorite_random':
        pool = items.filter(item => item.UserData?.IsFavorite);
        return shuffleArray(pool);

      case 'least_played_random':
        const playCountMap = new Map();
        items.forEach(item => {
          const count = item.UserData?.PlayCount || 0;
          if (!playCountMap.has(count)) playCountMap.set(count, []);
          playCountMap.get(count).push(item);
        });
        const sortedCounts = Array.from(playCountMap.keys()).sort((a, b) => a - b);
        sortedCounts.forEach(cnt => {
          pool = pool.concat(shuffleArray(playCountMap.get(cnt)));
        });
        return pool;

      case 'latest_random':
        const sortedByDate = [...items].sort((a, b) => new Date(b.DateCreated) - new Date(a.DateCreated));
        return shuffleArray(sortedByDate.slice(0, Math.max(50, activeTileCount * 10)));

      case 'pure_random':
      default:
        return shuffleArray(items);
    }
  }, [items, filterMode, activeTileCount]);

  useEffect(() => {
    displayedItemsRef.current = displayedItems;
  }, [displayedItems]);

  // 2. Initialize or re-initialize queue when filter / tile count / items / initialItem change
  const initialItemId = initialItem?.Id || '';
  const filterKey = `${filterMode}:${items.length}:${activeTileCount}:${initialItemId}`;
  
  const initQueueAndTiles = useCallback(() => {
    if (!filteredPool || filteredPool.length === 0) {
      setDisplayedItems([]);
      displayedItemsRef.current = [];
      remainingQueueRef.current = [];
      consumedIdsSetRef.current.clear();
      return;
    }

    let initialTiles = [];

    if (initialItem && initialItem.Id) {
      initialTiles.push(initialItem);
      // Fill the rest with items from filteredPool
      for (const it of filteredPool) {
        if (initialTiles.length >= activeTileCount) break;
        if (it.Id !== initialItem.Id) {
          initialTiles.push(it);
        }
      }
    } else {
      initialTiles = filteredPool.slice(0, activeTileCount);
    }
    
    // Fill any missing tiles if pool is smaller than activeTileCount
    while (initialTiles.length < activeTileCount && filteredPool.length > 0) {
      initialTiles.push(filteredPool[initialTiles.length % filteredPool.length]);
    }

    setDisplayedItems(initialTiles);
    displayedItemsRef.current = initialTiles;

    // Remaining items go into the session queue
    const initialIds = new Set(initialTiles.map(it => it?.Id).filter(Boolean));
    const remaining = filteredPool.filter(it => !initialIds.has(it.Id));
    remainingQueueRef.current = remaining;

    consumedIdsSetRef.current = initialIds;
  }, [filteredPool, activeTileCount, initialItem]);

  useEffect(() => {
    if (filterKey !== prevFilterKeyRef.current) {
      prevFilterKeyRef.current = filterKey;
      initQueueAndTiles();
    }
  }, [filterKey, initQueueAndTiles]);

  // 3. Consume next unique item for a specific tile
  const consumeNext = useCallback((tileId) => {
    if (!filteredPool || filteredPool.length === 0) return null;

    let nextItem = null;

    while (remainingQueueRef.current.length > 0) {
      const candidate = remainingQueueRef.current.shift();
      if (!candidate) continue;

      const otherTiles = displayedItemsRef.current.filter((_, idx) => idx !== tileId);
      const isAlreadyShowing = otherTiles.some(t => t?.Id === candidate.Id);

      if (!isAlreadyShowing) {
        nextItem = candidate;
        consumedIdsSetRef.current.add(candidate.Id);
        break;
      }

      // 与其他磁贴重复的候选不丢弃，回填队尾（池小时避免加速枯竭）
      remainingQueueRef.current.push(candidate);
      // 防御：整轮都是重复候选时退出（队列已转一圈）
      if (remainingQueueRef.current.every(it => it?.Id === candidate.Id)) break;
    }

    // If queue is exhausted, refill it by re-shuffling the pool
    if (!nextItem) {
      const currentDisplayedIds = new Set(displayedItemsRef.current.map(t => t?.Id).filter(Boolean));
      const freshPool = shuffleArray(filteredPool.filter(it => !currentDisplayedIds.has(it.Id)));

      if (freshPool.length > 0) {
        nextItem = freshPool.shift();
        remainingQueueRef.current = freshPool;
        consumedIdsSetRef.current.clear();
        if (nextItem) consumedIdsSetRef.current.add(nextItem.Id);
      } else if (filteredPool.length > 0) {
        nextItem = filteredPool[0];
      }
    }

    if (nextItem) {
      setDisplayedItems(prev => {
        const next = [...prev];
        next[tileId] = nextItem;
        displayedItemsRef.current = next;
        return next;
      });
    }

    return nextItem;
  }, [filteredPool]);

  // 4. Force Reshuffle All active tiles
  const reshuffleAll = useCallback(() => {
    consumedIdsSetRef.current.clear();
    initQueueAndTiles();
  }, [initQueueAndTiles]);

  // 5. Update item metadata or favorite status in place
  const updateItemInTiles = useCallback((updatedItem) => {
    if (!updatedItem?.Id) return;
    setDisplayedItems(prev => prev.map(it => it?.Id === updatedItem.Id ? { ...it, ...updatedItem } : it));
  }, []);

  return {
    displayedItems,
    remainingCount: remainingQueueRef.current.length,
    totalCount: filteredPool.length,
    consumeNext,
    reshuffleAll,
    updateItemInTiles
  };
}
