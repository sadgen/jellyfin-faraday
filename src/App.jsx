import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { jellyfin } from './api/jellyfinClient';
import { 
  loadFullCache, 
  saveFullCache, 
  updateItemInCache, 
  deleteItemFromCache 
} from './utils/mediaCache';
import { sortMediaItems } from './utils/mediaSorter';
import DesktopLayout from './components/DesktopLayout';
import LibraryView from './components/LibraryView';
import FloatingWindowsContainer from './components/FloatingWindowsContainer';
import LoginModal from './components/LoginModal';
import SettingsModal from './components/SettingsModal';
import MetadataEditorModal from './components/MetadataEditorModal';
import IdentifyModal from './components/IdentifyModal';
import VideoPlayerModal from './components/VideoPlayerModal';
import VrPlayerModal from './components/VrPlayerModal';
import MobileNavBar from './components/MobileNavBar';
import ErrorBoundary from './components/ErrorBoundary';
import { Film, AlertCircle } from 'lucide-react';

const STORAGE_KEY_TILES = 'jf_faraday_tile_count';
const STORAGE_KEY_FILTER = 'jf_faraday_filter_mode';
const STORAGE_KEY_VIEW = 'jf_last_selected_view';
const STORAGE_KEY_SORT = 'jf_faraday_sort_method';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(jellyfin.auth.isConfigured);
  const [viewMode, setViewMode] = useState('library'); // 'library' | 'kanban'
  
  // Media items & libraries
  const [mediaItems, setMediaItems] = useState([]);
  const [totalRecordCount, setTotalRecordCount] = useState(0);
  const [userViews, setUserViews] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('jf_cached_views') || '[]');
    } catch {
      return [];
    }
  });
  
  // Synchronously initialize to saved library or first cached library
  const [selectedViewId, setSelectedViewId] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_VIEW);
    if (saved) return saved;
    try {
      const cachedViews = JSON.parse(localStorage.getItem('jf_cached_views') || '[]');
      if (cachedViews.length > 0 && cachedViews[0]?.Id) return cachedViews[0].Id;
    } catch {}
    return '';
  });

  const [sortMethod, setSortMethod] = useState(() => {
    return localStorage.getItem(STORAGE_KEY_SORT) || 'date_desc';
  });

  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedGenre, setSelectedGenre] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedLetter, setSelectedLetter] = useState('');

  // Loading state
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [lastSyncTime, setLastSyncTime] = useState(null);

  // Kanban Items Stream
  const [kanbanPool, setKanbanPool] = useState([]);

  // Floating 3-Window PIP Preview System (Tampermonkey Multi-Slot Replica)
  const [floatingWindows, setFloatingWindows] = useState([]);

  // Preferences
  const [activeTileCount, setActiveTileCount] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_TILES);
    const count = parseInt(saved, 10);
    if ([1, 2, 4].includes(count)) return count;
    return typeof window !== 'undefined' && window.innerWidth < 768 ? 1 : 2;
  });

  const [filterMode, setFilterMode] = useState(() => {
    return localStorage.getItem(STORAGE_KEY_FILTER) || 'pure_random';
  });

  const [isGlobalMuted, setIsGlobalMuted] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  // Modals
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(!jellyfin.auth.isConfigured);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [identifyingItem, setIdentifyingItem] = useState(null);
  const [modalPlayingItem, setModalPlayingItem] = useState(null);
  const [vrPlayingItem, setVrPlayingItem] = useState(null);
  const [initialKanbanItem, setInitialKanbanItem] = useState(null);

  // Change View & Persist
  const handleSelectView = (viewId) => {
    setSelectedViewId(viewId);
    localStorage.setItem(STORAGE_KEY_VIEW, viewId);
  };

  const handleSortMethodChange = (sort) => {
    setSortMethod(sort);
    localStorage.setItem(STORAGE_KEY_SORT, sort);
    setMediaItems(prev => sortMediaItems(prev, sort));
  };

  const handleTileCountChange = (count) => {
    setActiveTileCount(count);
    localStorage.setItem(STORAGE_KEY_TILES, count.toString());
  };

  const handleFilterModeChange = (mode) => {
    setFilterMode(mode);
    localStorage.setItem(STORAGE_KEY_FILTER, mode);
  };

  // 竞态守卫与跨渲染引用（声明在 hydration effect 之前，供其内部读取）
  const fetchRequestIdRef = useRef(0);
  const userViewsRef = useRef(userViews);
  const selectedViewIdRef = useRef(selectedViewId);
  useEffect(() => { userViewsRef.current = userViews; }, [userViews]);
  useEffect(() => { selectedViewIdRef.current = selectedViewId; }, [selectedViewId]);

  // 1. INSTANT LOCAL CACHE HYDRATION & USER VIEWS INITIALIZATION
  // 仅在登录态变化时执行一次；视图/排序变化不重复触发全量拉取（防启动 3 次重复请求）
  useEffect(() => {
    if (!jellyfin.auth.isConfigured) return;

    const savedViewId = localStorage.getItem(STORAGE_KEY_VIEW) || '';

    loadFullCache().then(cache => {
      if (cache.items && cache.items.length > 0) {
        const sortedCached = sortMediaItems(cache.items, sortMethod);
        setMediaItems(sortedCached);
        setTotalRecordCount(cache.count || sortedCached.length);
      }
      if (cache.lastSyncTime) setLastSyncTime(cache.lastSyncTime);
      if (cache.views && cache.views.length > 0) {
        setUserViews(cache.views);
        if (!savedViewId && !selectedViewIdRef.current) {
          const firstId = cache.views[0]?.Id || 'all';
          setSelectedViewId(firstId);
          localStorage.setItem(STORAGE_KEY_VIEW, firstId);
        }
      }
    });

    jellyfin.getUserViews().then(views => {
      if (views && views.length > 0) {
        setUserViews(views);
        if (!savedViewId && !selectedViewIdRef.current) {
          const firstId = views[0]?.Id || 'all';
          setSelectedViewId(firstId);
          localStorage.setItem(STORAGE_KEY_VIEW, firstId);
        }
      }
    }).catch(err => {
      console.warn('Failed to fetch user views:', err);
    });
  }, [isAuthenticated]);

  // 2. Query Media Items & Save to Local Cache
  // 竞态守卫：递增请求序号，慢的旧响应后到时直接丢弃，防止旧视图数据覆盖新状态

  const fetchAllMedia = useCallback(async (viewId, search, status, sort, genre, year, letter, isBackground = false) => {
    if (!jellyfin.auth.isConfigured) return;
    if (!viewId) return;

    const requestId = ++fetchRequestIdRef.current;
    const isStale = () => requestId !== fetchRequestIdRef.current;
    // 缓存指纹：仅当无任何筛选/搜索条件（全量未过滤视图）时才允许覆写全库缓存
    const isUnfilteredQuery = !search && (!status || status === 'all') && !genre && !year && !letter;

    if (!isBackground) setIsLoading(true);
    setErrorText('');

    try {
      const firstPageData = await jellyfin.queryMediaPage({
        parentId: viewId,
        searchTerm: search,
        statusFilter: status,
        sortMethod: sort,
        genre,
        year,
        nameStartsWithOrGreater: letter,
        startIndex: 0,
        limit: 150
      });

      if (isStale()) return; // 已有更新的请求发出，丢弃本次响应

      const initialItems = firstPageData.Items || [];
      const total = firstPageData.TotalRecordCount || initialItems.length;

      setMediaItems(initialItems);
      setTotalRecordCount(total);

      if (!isBackground) setIsLoading(false);

      if (total > 150) {
        const fullData = await jellyfin.queryMediaPage({
          parentId: viewId,
          searchTerm: search,
          statusFilter: status,
          sortMethod: sort,
          genre,
          year,
          nameStartsWithOrGreater: letter,
          startIndex: 0,
          limit: 0
        });

        if (isStale()) return;

        if (fullData.Items && fullData.Items.length > 0) {
          setMediaItems(fullData.Items);
          setTotalRecordCount(fullData.TotalRecordCount || fullData.Items.length);
          // 仅全量未筛选结果才写入全库缓存；筛选/搜索子集只更新内存状态
          if (isUnfilteredQuery) {
            saveFullCache(fullData.Items, userViewsRef.current);
          }
        }
      } else if (initialItems.length > 0 && isUnfilteredQuery) {
        saveFullCache(initialItems, userViewsRef.current);
      }
    } catch (err) {
      console.error('Failed to load media items:', err);
      if (!isBackground && !isStale()) {
        setErrorText(err.message || '获取媒体列表失败');
      }
    } finally {
      if (!isBackground && !isStale()) setIsLoading(false);
    }
  }, []);

  // Debounced search / filter trigger
  const searchTimeoutRef = useRef(null);
  const isFirstMountRef = useRef(true);

  useEffect(() => {
    if (!jellyfin.auth.isConfigured || !selectedViewId) return;

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    searchTimeoutRef.current = setTimeout(() => {
      const isBg = isFirstMountRef.current && mediaItems.length > 0;
      isFirstMountRef.current = false;
      
      fetchAllMedia(selectedViewId, searchKeyword, statusFilter, sortMethod, selectedGenre, selectedYear, selectedLetter, isBg);
    }, searchKeyword ? 300 : 0);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [selectedViewId, searchKeyword, statusFilter, sortMethod, selectedGenre, selectedYear, selectedLetter, fetchAllMedia]);

  // Load Random Pool for Kanban on Demand
  const loadKanbanStream = useCallback(async () => {
    if (!jellyfin.auth.isConfigured) return;
    try {
      const randomItems = await jellyfin.queryRandomBatch({
        parentId: selectedViewId,
        filterMode,
        limit: 100
      });
      setKanbanPool(randomItems || []);
    } catch (err) {
      console.warn('Failed to load random stream for kanban:', err);
    }
  }, [selectedViewId, filterMode]);

  useEffect(() => {
    if (viewMode === 'kanban') {
      loadKanbanStream();
    }
  }, [viewMode, loadKanbanStream]);

  // ==================== FLOATING 3-WINDOW PIP SYSTEM ====================
  // Open item in a floating slot (FIFO replacement with slot shifting if all 3 full)
  const handleOpenFloatingWindow = useCallback((item, startSecond = null) => {
    if (!item?.Id) return;
    setFloatingWindows(prev => {
      // If already playing in one of the windows, bring it to front
      const existing = prev.find(w => w.item.Id === item.Id);
      if (existing) {
        return prev.map(w => w.id === existing.id ? { ...w, startSecond, timestamp: Date.now() } : w);
      }

      if (prev.length < 3) {
        const occupiedSlots = prev.map(w => w.slotIndex);
        const targetSlot = [0, 1, 2].find(s => !occupiedSlots.includes(s)) ?? prev.length;
        return [
          ...prev,
          {
            id: `win-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            slotIndex: targetSlot,
            item,
            startSecond,
            timestamp: Date.now()
          }
        ];
      }

      // If all 3 slots full: remove oldest window, shift following windows forward (下一个顶上来), and add new item to tail slot 2
      const sortedByTime = [...prev].sort((a, b) => a.timestamp - b.timestamp);
      const oldest = sortedByTime[0];
      const remaining = prev.filter(w => w.id !== oldest.id);
      const shifted = remaining.map(w => {
        if (w.slotIndex > oldest.slotIndex) {
          return { ...w, slotIndex: w.slotIndex - 1 };
        }
        return w;
      });

      return [
        ...shifted,
        {
          id: `win-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          slotIndex: 2,
          item,
          startSecond,
          timestamp: Date.now()
        }
      ];
    });
  }, []);

  // 影院/VR Modal 上一个·下一个：合并查找域（mediaItems ∪ kanbanPool ∪ floatingWindows），
  // 悬浮窗/看板池来源的条目不在 mediaItems 时也能定位相邻条目
  const modalNavPool = useMemo(() => {
    const seen = new Set();
    const pool = [];
    for (const it of [...mediaItems, ...kanbanPool, ...floatingWindows.map(w => w.item)]) {
      if (it?.Id && !seen.has(it.Id)) {
        seen.add(it.Id);
        pool.push(it);
      }
    }
    return pool;
  }, [mediaItems, kanbanPool, floatingWindows]);

  const navigateModalItem = useCallback((currentItem, direction) => {
    if (!currentItem?.Id || modalNavPool.length === 0) return;
    const idx = modalNavPool.findIndex(it => it.Id === currentItem.Id);
    if (idx === -1) {
      setModalPlayingItem(modalNavPool[0]);
      return;
    }
    const nextIdx = idx + direction;
    if (nextIdx >= 0 && nextIdx < modalNavPool.length) {
      setModalPlayingItem(modalNavPool[nextIdx]);
    }
  }, [modalNavPool]);

  const navigateVrItem = useCallback((currentItem, direction) => {
    if (!currentItem?.Id || modalNavPool.length === 0) return;
    const idx = modalNavPool.findIndex(it => it.Id === currentItem.Id);
    if (idx === -1) {
      setVrPlayingItem(modalNavPool[0]);
      return;
    }
    const nextIdx = idx + direction;
    if (nextIdx >= 0 && nextIdx < modalNavPool.length) {
      setVrPlayingItem(modalNavPool[nextIdx]);
    }
  }, [modalNavPool]);

  // Open 3 random videos simultaneously (Tampermonkey 随机3窗)
  const handleOpenRandom3Windows = useCallback(() => {
    const pool = mediaItems.length > 0 ? mediaItems : kanbanPool;
    if (pool.length === 0) return;

    const unplayed = pool.filter(it => !it.UserData?.Played);
    const candidatePool = unplayed.length >= 3 ? unplayed : pool;

    // Fisher-Yates 均匀洗牌（sort(() => 0.5 - Math.random()) 是有偏洗牌）
    const shuffled = [...candidatePool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const selected3 = shuffled.slice(0, 3);

    setFloatingWindows(
      selected3.map((it, idx) => ({
        id: `win-${Date.now()}-${idx}`,
        slotIndex: idx,
        item: it,
        timestamp: Date.now() + idx
      }))
    );
  }, [mediaItems, kanbanPool]);

  // Close floating window (removes window, subsequent windows shift forward / 下一个顶上来)
  const handleCloseFloatingWindow = useCallback((closedSlotIndex) => {
    setFloatingWindows(prev => {
      const remaining = prev.filter(w => w.slotIndex !== closedSlotIndex);
      return remaining.map(w => {
        if (w.slotIndex > closedSlotIndex) {
          return { ...w, slotIndex: w.slotIndex - 1 };
        }
        return w;
      });
    });
  }, []);

  // Skip video in floating window (destroys current window, shifts next windows forward / 下一个顶上来, and spawns new random item at tail slot)
  const handleSkipFloatingWindow = useCallback((skippedSlotIndex) => {
    setFloatingWindows(prev => {
      // 1. Remove current window and shift following windows forward
      const remaining = prev.filter(w => w.slotIndex !== skippedSlotIndex);
      const shifted = remaining.map(w => {
        if (w.slotIndex > skippedSlotIndex) {
          return { ...w, slotIndex: w.slotIndex - 1 };
        }
        return w;
      });

      // 2. Pick a new random unplayed video that is not already playing
      const pool = mediaItems.length > 0 ? mediaItems : kanbanPool;
      if (pool.length === 0) return shifted;

      const activeIds = new Set(shifted.map(w => w.item.Id));
      const unplayed = pool.filter(it => !it.UserData?.Played && !activeIds.has(it.Id));
      const candidatePool = unplayed.length > 0 ? unplayed : pool.filter(it => !activeIds.has(it.Id));
      const randomItem = candidatePool[Math.floor(Math.random() * candidatePool.length)] || pool[0];

      if (!randomItem) return shifted;

      const tailSlot = shifted.length; // e.g. slot 2 if 2 active, slot 1 if 1 active
      return [
        ...shifted,
        {
          id: `win-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          slotIndex: tailSlot,
          item: randomItem,
          timestamp: Date.now()
        }
      ];
    });
  }, [mediaItems, kanbanPool]);

  const handleBringFloatingToFront = useCallback((winId) => {
    setFloatingWindows(prev => {
      const target = prev.find(w => w.id === winId);
      if (!target) return prev;
      return [...prev.filter(w => w.id !== winId), { ...target, timestamp: Date.now() }];
    });
  }, []);

  const activeScopeName = useMemo(() => {
    let name = '全部媒体库';
    if (selectedViewId && selectedViewId !== 'all') {
      const view = userViews.find(v => v.Id === selectedViewId);
      if (view) name = view.Name;
    }
    if (searchKeyword) name += ` • "${searchKeyword}"`;
    if (selectedGenre) name += ` • ${selectedGenre}`;
    if (selectedLetter) name += ` • 字母 ${selectedLetter}`;
    if (statusFilter === 'favorites') name += ' • 最爱';
    else if (statusFilter === 'unplayed') name += ' • 未看';
    return name;
  }, [selectedViewId, userViews, searchKeyword, selectedGenre, selectedLetter, statusFilter]);

  const handleUpdateItem = useCallback((updatedItem) => {
    if (!updatedItem?.Id) return;
    setMediaItems(prev => prev.map(item => item.Id === updatedItem.Id ? { ...item, ...updatedItem } : item));
    setKanbanPool(prev => prev.map(item => item.Id === updatedItem.Id ? { ...item, ...updatedItem } : item));
    setFloatingWindows(prev => prev.map(w => w.item.Id === updatedItem.Id ? { ...w, item: { ...w.item, ...updatedItem } } : w));
    updateItemInCache(updatedItem);
  }, []);

  const handleDeleteItem = useCallback((deletedId) => {
    setMediaItems(prev => prev.filter(item => item.Id !== deletedId));
    setKanbanPool(prev => prev.filter(item => item.Id !== deletedId));
    setFloatingWindows(prev => prev.filter(w => w.item.Id !== deletedId));
    setTotalRecordCount(prev => Math.max(0, prev - 1));
    deleteItemFromCache(deletedId);
  }, []);

  const handlePlaySingleItem = useCallback((item, startSecond = null) => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setModalPlayingItem(startSecond !== null ? { ...item, startSecond } : item);
    } else {
      handleOpenFloatingWindow(item, startSecond);
    }
  }, [handleOpenFloatingWindow]);

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    setIsLoginModalOpen(false);
    fetchAllMedia(selectedViewId, searchKeyword, statusFilter, sortMethod, selectedGenre, selectedYear, selectedLetter);
  };

  const handleLogout = () => {
    // 递增请求序号使所有在途 fetch 响应失效（登出后不再写入状态/缓存）
    fetchRequestIdRef.current++;
    setIsAuthenticated(false);
    setMediaItems([]);
    setTotalRecordCount(0);
    setUserViews([]);
    setKanbanPool([]);
    setFloatingWindows([]);
    localStorage.removeItem(STORAGE_KEY_VIEW);
    setSelectedViewId('');
    setIsLoginModalOpen(true);
  };

  // Server-side library scan & metadata refresh (Scans disk for newly added movies)
  const handleServerRefreshLibrary = useCallback(async () => {
    setIsLoading(true);
    try {
      await jellyfin.refreshLibrary(selectedViewId);
      await new Promise(r => setTimeout(r, 1200));
      await fetchAllMedia(selectedViewId, searchKeyword, statusFilter, sortMethod, selectedGenre, selectedYear, selectedLetter);
    } catch (err) {
      console.error('Failed to refresh library metadata on server:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedViewId, searchKeyword, statusFilter, sortMethod, selectedGenre, selectedYear, selectedLetter, fetchAllMedia]);

  return (
    <ErrorBoundary>
      <div className="relative w-screen h-screen bg-[#080b11] text-gray-100 overflow-hidden select-none flex flex-col">
        
        {/* Global Error Banner */}
        {errorText && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-xl bg-red-950/90 border border-red-500/40 text-xs text-red-200 shadow-2xl">
            <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
            <span>{errorText}</span>
            <button
              onClick={() => setIsLoginModalOpen(true)}
              className="ml-2 underline text-white hover:text-cyan-300 font-medium"
            >
              重新连接
            </button>
          </div>
        )}

        {/* Main View Area */}
        <div className="flex-1 w-full h-full overflow-hidden">
          {viewMode === 'library' ? (
            <LibraryView
              items={mediaItems}
              totalRecordCount={totalRecordCount}
              userViews={userViews}
              selectedViewId={selectedViewId}
              onSelectView={handleSelectView}
              searchKeyword={searchKeyword}
              onSearchChange={setSearchKeyword}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              sortMethod={sortMethod}
              onSortMethodChange={handleSortMethodChange}
              selectedGenre={selectedGenre}
              onSelectGenre={setSelectedGenre}
              selectedYear={selectedYear}
              onSelectYear={setSelectedYear}
              selectedLetter={selectedLetter}
              onSelectLetter={setSelectedLetter}
              onEnterKanban={() => {
                setInitialKanbanItem(null);
                setViewMode('kanban');
              }}
              onOpenRandom3Windows={handleOpenRandom3Windows}
              onPlaySingleItem={handlePlaySingleItem}
              onOpenFloatingWindow={handleOpenFloatingWindow}
              onPlayModal={(item) => setModalPlayingItem(item)}
              onPlayVr={(item) => setVrPlayingItem(item)}
              onUpdateItem={handleUpdateItem}
              onDeleteItem={handleDeleteItem}
              onOpenMetadataEditor={(item) => setEditingItem(item)}
              onOpenIdentify={(item) => setIdentifyingItem(item)}
              onRefreshLibrary={handleServerRefreshLibrary}
              isRefreshing={isLoading}
            />
          ) : (
            <DesktopLayout
              items={kanbanPool.length > 0 ? kanbanPool : mediaItems}
              activeTileCount={activeTileCount}
              onTileCountChange={handleTileCountChange}
              filterMode={filterMode}
              onFilterModeChange={handleFilterModeChange}
              isGlobalMuted={isGlobalMuted}
              onToggleGlobalMute={() => setIsGlobalMuted(!isGlobalMuted)}
              playbackSpeed={playbackSpeed}
              onPlaybackSpeedChange={setPlaybackSpeed}
              onOpenSettings={() => setIsSettingsModalOpen(true)}
              onRefreshLibrary={loadKanbanStream}
              isRefreshing={isLoading}
              onOpenLibraryView={() => setViewMode('library')}
              onOpenVr={(item) => setVrPlayingItem(item)}
              onDeleteItem={handleDeleteItem}
              activeScopeName={activeScopeName}
              initialPlayingItem={initialKanbanItem}
            />
          )}
        </div>

        {/* Floating 3-Window PIP Preview System */}
        {viewMode === 'library' && (
          <FloatingWindowsContainer
            windows={floatingWindows}
            onCloseWindow={handleCloseFloatingWindow}
            onSkipWindow={handleSkipFloatingWindow}
            onExpandWindow={(item) => setModalPlayingItem(item)}
            onBringToFront={handleBringFloatingToFront}
            onUpdateItem={handleUpdateItem}
            onDeleteItem={handleDeleteItem}
          />
        )}

        {/* Mobile Bottom Navigation Bar */}
        {viewMode === 'library' && (
          <MobileNavBar
            viewMode={viewMode}
            onSwitchView={(mode) => setViewMode(mode)}
            onOpenSearch={() => {
              const searchInput = document.querySelector('input[type="text"]');
              if (searchInput) searchInput.focus();
            }}
            onOpenSettings={() => setIsSettingsModalOpen(true)}
            totalCount={totalRecordCount}
          />
        )}

        {/* Full-Screen Theater Video Player Modal */}
        <VideoPlayerModal
          isOpen={!!modalPlayingItem}
          item={modalPlayingItem}
          onClose={() => setModalPlayingItem(null)}
          onNext={() => navigateModalItem(modalPlayingItem, 1)}
          onPrev={() => navigateModalItem(modalPlayingItem, -1)}
          onUpdateItem={handleUpdateItem}
          onDeleteItem={handleDeleteItem}
          onOpenVr={(item) => setVrPlayingItem(item)}
        />

        {/* Three.js VR 180 / 360 SBS 3D Player Modal */}
        <VrPlayerModal
          isOpen={!!vrPlayingItem}
          item={vrPlayingItem}
          onClose={() => setVrPlayingItem(null)}
          onNext={() => navigateVrItem(vrPlayingItem, 1)}
          onPrev={() => navigateVrItem(vrPlayingItem, -1)}
        />

        {/* Login Modal */}
        <LoginModal
          isOpen={isLoginModalOpen}
          onClose={() => setIsLoginModalOpen(false)}
          onLoginSuccess={handleLoginSuccess}
        />

        {/* Settings Modal */}
        <SettingsModal
          isOpen={isSettingsModalOpen}
          onClose={() => setIsSettingsModalOpen(false)}
          onLogout={handleLogout}
          onRefreshLibrary={() => fetchAllMedia(selectedViewId, searchKeyword, statusFilter, sortMethod, selectedGenre, selectedYear, selectedLetter)}
          isRefreshing={isLoading}
          totalItemsCount={totalRecordCount}
          lastSyncTime={lastSyncTime}
        />

        {/* Metadata Editor Modal */}
        <MetadataEditorModal
          isOpen={!!editingItem}
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={handleUpdateItem}
        />

        {/* Identify / Scraper Modal */}
        <IdentifyModal
          isOpen={!!identifyingItem}
          item={identifyingItem}
          onClose={() => setIdentifyingItem(null)}
          onIdentified={handleUpdateItem}
        />
      </div>
    </ErrorBoundary>
  );
}
