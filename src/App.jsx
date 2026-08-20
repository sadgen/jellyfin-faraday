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

  // Kanban Items Stream
  const [kanbanPool, setKanbanPool] = useState([]);

  // Floating 3-Window PIP Preview System (Tampermonkey Multi-Slot Replica)
  const [floatingWindows, setFloatingWindows] = useState([]);
  const MAX_FLOATING_WINDOWS = 3;

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
  const [initialKanbanItem, setInitialKanbanItem] = useState(null);

  // Change View & Persist
  const handleSelectView = (viewId) => {
    setSelectedViewId(viewId);
    localStorage.setItem(STORAGE_KEY_VIEW, viewId);
  };

  const handleSortMethodChange = (sort) => {
    setSortMethod(sort);
    localStorage.setItem(STORAGE_KEY_SORT, sort);
    // Instant sort current items in memory
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

  // 1. INSTANT LOCAL CACHE HYDRATION & USER VIEWS INITIALIZATION (< 5ms, 0 Network Latency)
  useEffect(() => {
    if (!jellyfin.auth.isConfigured) return;

    // Load from local IndexedDB cache immediately with IDENTICAL sort order
    loadFullCache().then(cache => {
      if (cache.items && cache.items.length > 0) {
        // Pre-sort cache identically to sortMethod to prevent order jumping on refresh!
        const sortedCached = sortMediaItems(cache.items, sortMethod);
        setMediaItems(sortedCached);
        setTotalRecordCount(cache.count || sortedCached.length);
      }
      if (cache.views && cache.views.length > 0) {
        setUserViews(cache.views);
        if (!selectedViewId) {
          const firstId = cache.views[0]?.Id || 'all';
          setSelectedViewId(firstId);
          localStorage.setItem(STORAGE_KEY_VIEW, firstId);
        }
      }
    });

    // Fetch user views from server
    jellyfin.getUserViews().then(views => {
      if (views && views.length > 0) {
        setUserViews(views);
        if (!selectedViewId) {
          const firstId = views[0]?.Id || 'all';
          setSelectedViewId(firstId);
          localStorage.setItem(STORAGE_KEY_VIEW, firstId);
        }
      }
    }).catch(err => {
      console.warn('Failed to fetch user views:', err);
    });
  }, [isAuthenticated, selectedViewId, sortMethod]);

  // 2. Query Media Items & Save to Local Cache (Fast Stream: 150 items first < 15ms)
  const fetchAllMedia = useCallback(async (viewId, search, status, sort, genre, year, letter, isBackground = false) => {
    if (!jellyfin.auth.isConfigured) return;
    if (!viewId) return;

    if (!isBackground) setIsLoading(true);
    setErrorText('');

    try {
      // Step A: Fast first page (150 items) for instant < 15ms frame render
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

      const initialItems = firstPageData.Items || [];
      const total = firstPageData.TotalRecordCount || initialItems.length;

      setMediaItems(initialItems);
      setTotalRecordCount(total);

      if (!isBackground) setIsLoading(false);

      // Step B: If there are more items in this library, fetch the rest in background
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

        if (fullData.Items && fullData.Items.length > 0) {
          setMediaItems(fullData.Items);
          setTotalRecordCount(fullData.TotalRecordCount || fullData.Items.length);
          saveFullCache(fullData.Items, userViews);
        }
      } else if (initialItems.length > 0) {
        saveFullCache(initialItems, userViews);
      }
    } catch (err) {
      console.error('Failed to load media items:', err);
      if (!isBackground) {
        setErrorText(err.message || '获取媒体列表失败');
      }
    } finally {
      if (!isBackground) setIsLoading(false);
    }
  }, [userViews]);

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

  // When entering Kanban mode, fetch random pool
  useEffect(() => {
    if (viewMode === 'kanban') {
      loadKanbanStream();
    }
  }, [viewMode, loadKanbanStream]);

  // ==================== FLOATING 3-WINDOW PIP SYSTEM ====================
  // Calculate slot position (docked at bottom or cascaded)
  const getSlotPosition = (slotIndex) => {
    const marginX = 20;
    const windowWidth = 330;
    const bottomY = Math.max(10, window.innerHeight - 275);
    const leftX = marginX + slotIndex * windowWidth;
    // If overflowing screen width, cascade slightly
    if (leftX + 320 > window.innerWidth) {
      return { x: window.innerWidth - 340 - slotIndex * 30, y: bottomY - slotIndex * 40 };
    }
    return { x: leftX, y: bottomY };
  };

  // Open item in a floating slot (FIFO replacement if all 3 full: "相互替代")
  const handleOpenFloatingWindow = useCallback((item) => {
    if (!item?.Id) return;
    setFloatingWindows(prev => {
      const occupiedSlots = prev.map(w => w.slotIndex);
      // Find empty slot (0, 1, 2)
      let targetSlot = [0, 1, 2].find(s => !occupiedSlots.includes(s));

      if (targetSlot === undefined) {
        // All 3 slots full: replace oldest window (FIFO)
        const sortedByTime = [...prev].sort((a, b) => a.timestamp - b.timestamp);
        const oldest = sortedByTime[0];
        targetSlot = oldest.slotIndex;
        const filtered = prev.filter(w => w.id !== oldest.id);
        return [
          ...filtered,
          {
            id: `win-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            slotIndex: targetSlot,
            item,
            timestamp: Date.now(),
            position: getSlotPosition(targetSlot)
          }
        ];
      }

      return [
        ...prev,
        {
          id: `win-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          slotIndex: targetSlot,
          item,
          timestamp: Date.now(),
          position: getSlotPosition(targetSlot)
        }
      ];
    });
  }, []);

  // Open 3 random videos in 3 slots simultaneously (Tampermonkey 随机3窗)
  const handleOpenRandom3Windows = useCallback(() => {
    const pool = mediaItems.length > 0 ? mediaItems : kanbanPool;
    if (pool.length === 0) return;

    // Prefer unplayed items
    const unplayed = pool.filter(it => !it.UserData?.Played);
    const candidatePool = unplayed.length >= 3 ? unplayed : pool;

    const shuffled = [...candidatePool].sort(() => 0.5 - Math.random());
    const selected3 = shuffled.slice(0, 3);

    setFloatingWindows(
      selected3.map((it, idx) => ({
        id: `win-${Date.now()}-${idx}`,
        slotIndex: idx,
        item: it,
        timestamp: Date.now() + idx,
        position: getSlotPosition(idx)
      }))
    );
  }, [mediaItems, kanbanPool]);

  // Close floating window
  const handleCloseFloatingWindow = useCallback((slotIndex) => {
    setFloatingWindows(prev => prev.filter(w => w.slotIndex !== slotIndex));
  }, []);

  // Skip video in floating window to another random item
  const handleSkipFloatingWindow = useCallback((slotIndex) => {
    const pool = mediaItems.length > 0 ? mediaItems : kanbanPool;
    if (pool.length === 0) return;
    const randomItem = pool[Math.floor(Math.random() * pool.length)];
    if (!randomItem) return;

    setFloatingWindows(prev => prev.map(w => {
      if (w.slotIndex === slotIndex) {
        return {
          ...w,
          item: randomItem,
          timestamp: Date.now()
        };
      }
      return w;
    }));
  }, [mediaItems, kanbanPool]);

  // Bring clicked window to front
  const handleBringFloatingToFront = useCallback((winId) => {
    setFloatingWindows(prev => {
      const target = prev.find(w => w.id === winId);
      if (!target) return prev;
      return [...prev.filter(w => w.id !== winId), { ...target, timestamp: Date.now() }];
    });
  }, []);

  // Active scope name
  const activeScopeName = useMemo(() => {
    let name = '全部媒体库';
    if (selectedViewId && selectedViewId !== 'all') {
      const view = userViews.find(v => v.Id === selectedViewId);
      if (view) name = view.Name;
    }
    if (searchKeyword) {
      name += ` • "${searchKeyword}"`;
    }
    if (selectedGenre) {
      name += ` • ${selectedGenre}`;
    }
    if (selectedLetter) {
      name += ` • 字母 ${selectedLetter}`;
    }
    if (statusFilter === 'favorites') {
      name += ' • 最爱';
    } else if (statusFilter === 'unplayed') {
      name += ' • 未看';
    }
    return name;
  }, [selectedViewId, userViews, searchKeyword, selectedGenre, selectedLetter, statusFilter]);

  // Update item in local state & IndexedDB
  const handleUpdateItem = useCallback((updatedItem) => {
    if (!updatedItem?.Id) return;
    setMediaItems(prev => prev.map(item => item.Id === updatedItem.Id ? { ...item, ...updatedItem } : item));
    setKanbanPool(prev => prev.map(item => item.Id === updatedItem.Id ? { ...item, ...updatedItem } : item));
    setFloatingWindows(prev => prev.map(w => w.item.Id === updatedItem.Id ? { ...w, item: { ...w.item, ...updatedItem } } : w));
    updateItemInCache(updatedItem);
  }, []);

  // Delete item from local state & IndexedDB
  const handleDeleteItem = useCallback((deletedId) => {
    setMediaItems(prev => prev.filter(item => item.Id !== deletedId));
    setKanbanPool(prev => prev.filter(item => item.Id !== deletedId));
    setFloatingWindows(prev => prev.filter(w => w.item.Id !== deletedId));
    setTotalRecordCount(prev => Math.max(0, prev - 1));
    deleteItemFromCache(deletedId);
  }, []);

  // Play single item clicked from Media Library
  const handlePlaySingleItem = useCallback((item) => {
    // Open in floating window (Tampermonkey slot behavior) on desktop, or modal on mobile
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setModalPlayingItem(item);
    } else {
      handleOpenFloatingWindow(item);
    }
  }, [handleOpenFloatingWindow]);

  // Login handler
  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    setIsLoginModalOpen(false);
    fetchAllMedia(selectedViewId, searchKeyword, statusFilter, sortMethod, selectedGenre, selectedYear, selectedLetter);
  };

  // Logout handler
  const handleLogout = () => {
    setIsAuthenticated(false);
    setMediaItems([]);
    setUserViews([]);
    setFloatingWindows([]);
    setIsLoginModalOpen(true);
  };

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

        {/* Main View Area (100% full screen) */}
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
              onPlayModal={(item) => setModalPlayingItem(item)}
              onUpdateItem={handleUpdateItem}
              onDeleteItem={handleDeleteItem}
              onOpenMetadataEditor={(item) => setEditingItem(item)}
              onOpenIdentify={(item) => setIdentifyingItem(item)}
              onRefreshLibrary={() => fetchAllMedia(selectedViewId, searchKeyword, statusFilter, sortMethod, selectedGenre, selectedYear, selectedLetter)}
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
              activeScopeName={activeScopeName}
              initialPlayingItem={initialKanbanItem}
            />
          )}
        </div>

        {/* Floating 3-Window PIP Preview System (Tampermonkey Multi-Slot Replica) */}
        {viewMode === 'library' && (
          <FloatingWindowsContainer
            windows={floatingWindows}
            onCloseWindow={handleCloseFloatingWindow}
            onSkipWindow={handleSkipFloatingWindow}
            onExpandWindow={(item) => setModalPlayingItem(item)}
            onBringToFront={handleBringFloatingToFront}
          />
        )}

        {/* Mobile Bottom Navigation Bar (ONLY in Library View, Never Blocks Video Playback) */}
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
          onNext={() => {
            const idx = mediaItems.findIndex(it => it.Id === modalPlayingItem?.Id);
            if (idx >= 0 && idx < mediaItems.length - 1) {
              setModalPlayingItem(mediaItems[idx + 1]);
            }
          }}
          onPrev={() => {
            const idx = mediaItems.findIndex(it => it.Id === modalPlayingItem?.Id);
            if (idx > 0) {
              setModalPlayingItem(mediaItems[idx - 1]);
            }
          }}
          onUpdateItem={handleUpdateItem}
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
