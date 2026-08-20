import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { jellyfin } from './api/jellyfinClient';
import { 
  loadFullCache, 
  saveFullCache, 
  updateItemInCache, 
  deleteItemFromCache 
} from './utils/mediaCache';
import DesktopLayout from './components/DesktopLayout';
import LibraryView from './components/LibraryView';
import LoginModal from './components/LoginModal';
import SettingsModal from './components/SettingsModal';
import MetadataEditorModal from './components/MetadataEditorModal';
import IdentifyModal from './components/IdentifyModal';
import VideoPlayerModal from './components/VideoPlayerModal';
import MobileNavBar from './components/MobileNavBar';
import ErrorBoundary from './components/ErrorBoundary';
import { Film, AlertCircle, Loader2 } from 'lucide-react';

const STORAGE_KEY_TILES = 'jf_faraday_tile_count';
const STORAGE_KEY_FILTER = 'jf_faraday_filter_mode';
const STORAGE_KEY_VIEW = 'jf_last_selected_view';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(jellyfin.auth.isConfigured);
  const [viewMode, setViewMode] = useState('library'); // 'library' | 'kanban'
  
  // Media items & libraries
  const [mediaItems, setMediaItems] = useState([]);
  const [totalRecordCount, setTotalRecordCount] = useState(0);
  const [userViews, setUserViews] = useState([]);
  
  // Default to user's saved library or let views loader set it to views[0].Id (Official Web Client Pattern)
  const [selectedViewId, setSelectedViewId] = useState(() => {
    return localStorage.getItem(STORAGE_KEY_VIEW) || '';
  });

  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortMethod, setSortMethod] = useState('date_desc');
  const [selectedGenre, setSelectedGenre] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedLetter, setSelectedLetter] = useState('');

  // Loading state
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');

  // Kanban Items Stream
  const [kanbanPool, setKanbanPool] = useState([]);

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

    // Load from local IndexedDB cache immediately
    loadFullCache().then(cache => {
      if (cache.items && cache.items.length > 0) {
        setMediaItems(cache.items);
        setTotalRecordCount(cache.count || cache.items.length);
      }
      if (cache.views && cache.views.length > 0) {
        setUserViews(cache.views);
        // Default to first view if not set
        if (!selectedViewId) {
          const firstId = cache.views[0]?.Id || 'all';
          setSelectedViewId(firstId);
          localStorage.setItem(STORAGE_KEY_VIEW, firstId);
        }
      }
    });

    // Fetch user views in background
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
  }, [isAuthenticated]);

  // 2. Query Media Items & Save to Local Cache (Fast Stream: 150 items first < 15ms)
  const fetchAllMedia = useCallback(async (viewId, search, status, sort, genre, year, letter, isBackground = false) => {
    if (!jellyfin.auth.isConfigured) return;
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
    if (!jellyfin.auth.isConfigured) return;

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
    updateItemInCache(updatedItem);
  }, []);

  // Delete item from local state & IndexedDB
  const handleDeleteItem = useCallback((deletedId) => {
    setMediaItems(prev => prev.filter(item => item.Id !== deletedId));
    setKanbanPool(prev => prev.filter(item => item.Id !== deletedId));
    setTotalRecordCount(prev => Math.max(0, prev - 1));
    deleteItemFromCache(deletedId);
  }, []);

  // Play single item clicked from Media Library
  const handlePlaySingleItem = useCallback((item) => {
    setModalPlayingItem(item);
  }, []);

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
              onSortMethodChange={setSortMethod}
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
              onPlaySingleItem={handlePlaySingleItem}
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
