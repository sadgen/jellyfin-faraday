import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * Fisher-Yates Shuffle Algorithm (In-place or copy)
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
export function useSessionQueue(items = [], filterMode = 'pure_random', activeTileCount = 2) {
  // Currently displayed items in each tile: Array of item objects or nulls
  const [displayedItems, setDisplayedItems] = useState([]);
  const displayedItemsRef = useRef([]);

  // Session-level FIFO queue
  const remainingQueueRef = useRef([]);
  const consumedIdsSetRef = useRef(new Set());
  const prevFilterKeyRef = useRef('');

  // 1. Calculate filtered & prioritized items based on active mode
  const filteredPool = useMemo(() => {
    if (!items || items.length === 0) return [];

    let pool = [];

    switch (filterMode) {
      case 'favorite_random':
        // Filter strictly by favorite
        pool = items.filter(item => item.UserData?.IsFavorite);
        return shuffleArray(pool);

      case 'least_played_random':
        // Sort primarily by PlayCount ascending, then randomize within the same playcount groups
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
        // Slice top 100 recent items and shuffle
        const sortedByDate = [...items].sort((a, b) => new Date(b.DateCreated) - new Date(a.DateCreated));
        return shuffleArray(sortedByDate.slice(0, Math.max(50, activeTileCount * 10)));

      case 'pure_random':
      default:
        // Pure random shuffle of entire library
        return shuffleArray(items);
    }
  }, [items, filterMode, activeTileCount]);

  // Keep displayedItemsRef in sync with state
  useEffect(() => {
    displayedItemsRef.current = displayedItems;
  }, [displayedItems]);

  // 2. Initialize or re-initialize queue when filter / tile count / items change
  const filterKey = `${filterMode}:${items.length}:${activeTileCount}`;
  
  const initQueueAndTiles = useCallback((force = false) => {
    if (!filteredPool || filteredPool.length === 0) {
      setDisplayedItems([]);
      displayedItemsRef.current = [];
      remainingQueueRef.current = [];
      consumedIdsSetRef.current.clear();
      return;
    }

    // Initial assignment to active tiles
    const initialTiles = filteredPool.slice(0, activeTileCount);
    
    // Fill any missing tiles if pool is smaller than activeTileCount
    while (initialTiles.length < activeTileCount && filteredPool.length > 0) {
      initialTiles.push(filteredPool[initialTiles.length % filteredPool.length]);
    }

    setDisplayedItems(initialTiles);
    displayedItemsRef.current = initialTiles;

    // Remaining items go into the session queue
    const remaining = filteredPool.slice(activeTileCount);
    remainingQueueRef.current = remaining;

    // Mark initial items as consumed
    consumedIdsSetRef.current = new Set(initialTiles.map(it => it?.Id).filter(Boolean));
  }, [filteredPool, activeTileCount]);

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

    // Check if queue has remaining items
    while (remainingQueueRef.current.length > 0) {
      const candidate = remainingQueueRef.current.shift();
      if (!candidate) continue;

      // Ensure candidate is not currently showing on any other active tile
      const otherTiles = displayedItemsRef.current.filter((_, idx) => idx !== tileId);
      const isAlreadyShowing = otherTiles.some(t => t?.Id === candidate.Id);

      if (!isAlreadyShowing) {
        nextItem = candidate;
        consumedIdsSetRef.current.add(candidate.Id);
        break;
      }
    }

    // If queue is exhausted, refill it by re-shuffling the pool (excluding currently displayed items)
    if (!nextItem) {
      const currentDisplayedIds = new Set(displayedItemsRef.current.map(t => t?.Id).filter(Boolean));
      const freshPool = shuffleArray(filteredPool.filter(it => !currentDisplayedIds.has(it.Id)));

      if (freshPool.length > 0) {
        nextItem = freshPool.shift();
        remainingQueueRef.current = freshPool;
        consumedIdsSetRef.current.clear();
        if (nextItem) consumedIdsSetRef.current.add(nextItem.Id);
      } else {
        // Fallback: pick any item from the pool different from current tile
        const currentItem = displayedItemsRef.current[tileId];
        const alternative = filteredPool.find(it => it.Id !== currentItem?.Id) || filteredPool[0];
        nextItem = alternative;
      }
    }

    if (nextItem) {
      // Synchronously update ref to prevent race conditions on rapid middle-clicks
      const updatedTiles = [...displayedItemsRef.current];
      updatedTiles[tileId] = nextItem;
      displayedItemsRef.current = updatedTiles;
      setDisplayedItems(updatedTiles);
    }

    return nextItem;
  }, [filteredPool]);

  // Reshuffle helper
  const reshuffleAll = useCallback(() => {
    initQueueAndTiles(true);
  }, [initQueueAndTiles]);

  // Manual update of a tile's item metadata (e.g. after toggling favorite or play status)
  const updateItemInTiles = useCallback((updatedItem) => {
    if (!updatedItem?.Id) return;
    setDisplayedItems(prev => prev.map(item => item?.Id === updatedItem.Id ? { ...item, ...updatedItem } : item));
    // Also update in queue if present
    remainingQueueRef.current = remainingQueueRef.current.map(item => item?.Id === updatedItem.Id ? { ...item, ...updatedItem } : item);
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
