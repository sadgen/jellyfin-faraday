import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { jellyfin } from './api/jellyfinClient';
import DesktopLayout from './components/DesktopLayout';
import LibraryView from './components/LibraryView';
import LoginModal from './components/LoginModal';
import SettingsModal from './components/SettingsModal';
import MetadataEditorModal from './components/MetadataEditorModal';
import IdentifyModal from './components/IdentifyModal';
import VideoPlayerModal from './components/VideoPlayerModal';
import ErrorBoundary from './components/ErrorBoundary';
import { Film, AlertCircle, Loader2 } from 'lucide-react';

const STORAGE_KEY_TILES = 'jf_faraday_tile_count';
const STORAGE_KEY_FILTER = 'jf_faraday_filter_mode';
const PAGE_SIZE = 100;

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(jellyfin.auth.isConfigured);
  const [viewMode, setViewMode] = useState('library'); // 'library' | 'kanban'
  
  // Media items & libraries
  const [mediaItems, setMediaItems] = useState([]);
  const [totalRecordCount, setTotalRecordCount] = useState(0);
  const [userViews, setUserViews] = useState([]);
  const [selectedViewId, setSelectedViewId] = useState('all');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortMethod, setSortMethod] = useState('date_desc');

  // Loading state (Ultra-fast server-side pagination)
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorText, setErrorText] = useState('');

  // Kanban Items Stream
  const [kanbanPool, setKanbanPool] = useState([]);

  // Preferences
  const [activeTileCount, setActiveTileCount] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_TILES);
    const count = parseInt(saved, 10);
    return [1, 2, 4].includes(count) ? count : 2;
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

  // Save tile count preference
  const handleTileCountChange = (count) => {
    setActiveTileCount(count);
    localStorage.setItem(STORAGE_KEY_TILES, count.toString());
  };

  // Save filter mode preference
  const handleFilterModeChange = (mode) => {
    setFilterMode(mode);
    localStorage.setItem(STORAGE_KEY_FILTER, mode);
  };

  // Load User Views on mount
  useEffect(() => {
    if (!jellyfin.auth.isConfigured) return;
    jellyfin.getUserViews().then(views => {
      setUserViews(views || []);
    }).catch(err => {
      console.warn('Failed to fetch user views:', err);
    });
  }, [isAuthenticated]);

  // Query First Page (< 50ms instantaneous server query)
  const fetchFirstPage = useCallback(async (viewId, search, status, sort) => {
    if (!jellyfin.auth.isConfigured) return;
    setIsLoading(true);
    setErrorText('');

    try {
      const data = await jellyfin.queryMediaPage({
        parentId: viewId,
        searchTerm: search,
        statusFilter: status,
        sortMethod: sort,
        startIndex: 0,
        limit: PAGE_SIZE
      });

      setMediaItems(data.Items || []);
      setTotalRecordCount(data.TotalRecordCount || 0);
    } catch (err) {
      console.error('Failed to load media items:', err);
      setErrorText(err.message || '获取媒体列表失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounced/Triggered page reload when filters change
  const searchTimeoutRef = useRef(null);
  useEffect(() => {
    if (!jellyfin.auth.isConfigured) return;

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    searchTimeoutRef.current = setTimeout(() => {
      fetchFirstPage(selectedViewId, searchKeyword, statusFilter, sortMethod);
    }, searchKeyword ? 300 : 0);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [selectedViewId, searchKeyword, statusFilter, sortMethod, fetchFirstPage]);

  // Infinite Scroll: Load next batch
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || isLoading || mediaItems.length >= totalRecordCount) return;
    setIsLoadingMore(true);

    try {
      const data = await jellyfin.queryMediaPage({
        parentId: selectedViewId,
        searchTerm: searchKeyword,
        statusFilter: statusFilter,
        sortMethod: sortMethod,
        startIndex: mediaItems.length,
        limit: PAGE_SIZE
      });

      const nextItems = data.Items || [];
      if (nextItems.length > 0) {
        setMediaItems(prev => {
          const idSet = new Set(prev.map(p => p.Id));
          const filtered = nextItems.filter(n => !idSet.has(n.Id));
          return prev.concat(filtered);
        });
      }
    } catch (err) {
      console.warn('Failed to load more items:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, isLoading, mediaItems.length, totalRecordCount, selectedViewId, searchKeyword, statusFilter, sortMethod]);

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
    if (selectedViewId !== 'all') {
      const view = userViews.find(v => v.Id === selectedViewId);
      if (view) name = view.Name;
    }
    if (searchKeyword) {
      name += ` • 搜索: "${searchKeyword}"`;
    }
    if (statusFilter === 'favorites') {
      name += ' • 最爱';
    } else if (statusFilter === 'unplayed') {
      name += ' • 未看';
    }
    return name;
  }, [selectedViewId, userViews, searchKeyword, statusFilter]);

  // Update item in local state
  const handleUpdateItem = useCallback((updatedItem) => {
    if (!updatedItem?.Id) return;
    setMediaItems(prev => prev.map(item => item.Id === updatedItem.Id ? { ...item, ...updatedItem } : item));
    setKanbanPool(prev => prev.map(item => item.Id === updatedItem.Id ? { ...item, ...updatedItem } : item));
  }, []);

  // Delete item from local state
  const handleDeleteItem = useCallback((deletedId) => {
    setMediaItems(prev => prev.filter(item => item.Id !== deletedId));
    setKanbanPool(prev => prev.filter(item => item.Id !== deletedId));
    setTotalRecordCount(prev => Math.max(0, prev - 1));
  }, []);

  // Play single item clicked from Media Library
  const handlePlaySingleItem = useCallback((item) => {
    setModalPlayingItem(item);
  }, []);

  // Login handler
  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    setIsLoginModalOpen(false);
    fetchFirstPage(selectedViewId, searchKeyword, statusFilter, sortMethod);
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
      <div className="relative w-screen h-screen bg-[#080b11] text-gray-100 overflow-hidden select-none">
        
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

        {/* Main View Mode Switch */}
        {viewMode === 'library' ? (
          <LibraryView
            items={mediaItems}
            totalRecordCount={totalRecordCount}
            userViews={userViews}
            selectedViewId={selectedViewId}
            onSelectView={setSelectedViewId}
            searchKeyword={searchKeyword}
            onSearchChange={setSearchKeyword}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            sortMethod={sortMethod}
            onSortMethodChange={setSortMethod}
            onEnterKanban={() => {
              setInitialKanbanItem(null);
              setViewMode('kanban');
            }}
            onPlaySingleItem={handlePlaySingleItem}
            onUpdateItem={handleUpdateItem}
            onDeleteItem={handleDeleteItem}
            onOpenMetadataEditor={(item) => setEditingItem(item)}
            onOpenIdentify={(item) => setIdentifyingItem(item)}
            onRefreshLibrary={() => fetchFirstPage(selectedViewId, searchKeyword, statusFilter, sortMethod)}
            isRefreshing={isLoading}
            isLoadingMore={isLoadingMore}
            onLoadMore={handleLoadMore}
            hasMore={mediaItems.length < totalRecordCount}
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
          onRefreshLibrary={() => fetchFirstPage(selectedViewId, searchKeyword, statusFilter, sortMethod)}
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
