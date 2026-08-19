import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { jellyfin } from './api/jellyfinClient';
import DesktopLayout from './components/DesktopLayout';
import LibraryView from './components/LibraryView';
import LoginModal from './components/LoginModal';
import SettingsModal from './components/SettingsModal';
import MetadataEditorModal from './components/MetadataEditorModal';
import IdentifyModal from './components/IdentifyModal';
import ErrorBoundary from './components/ErrorBoundary';
import { Film, Loader2, AlertCircle } from 'lucide-react';

const STORAGE_KEY_TILES = 'jf_faraday_tile_count';
const STORAGE_KEY_FILTER = 'jf_faraday_filter_mode';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(jellyfin.auth.isConfigured);
  const [viewMode, setViewMode] = useState('library'); // 'library' | 'kanban'
  
  // Media items & libraries
  const [allMediaItems, setAllMediaItems] = useState([]);
  const [userViews, setUserViews] = useState([]);
  const [selectedViewId, setSelectedViewId] = useState('all');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'favorites' | 'unplayed' | 'played'
  const [sortMethod, setSortMethod] = useState('date_desc');

  // Loading & sync state
  const [isLoadingInitial, setIsLoadingInitial] = useState(false);
  const [isBackgroundSyncing, setIsBackgroundSyncing] = useState(false);
  const [isLoadingView, setIsLoadingView] = useState(false);
  const [loadProgress, setLoadProgress] = useState({ current: 0, total: 0 });
  const [errorText, setErrorText] = useState('');

  // Kanban Preferences
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
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Management modals
  const [editingItem, setEditingItem] = useState(null);
  const [identifyingItem, setIdentifyingItem] = useState(null);

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

  // Sync Media Library and user views
  const startMediaSync = useCallback(async (isUserManualRefresh = false) => {
    if (!jellyfin.auth.isConfigured) return;

    if (isUserManualRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoadingInitial(true);
    }
    setErrorText('');

    try {
      // Load user views (Categories/Libraries)
      const views = await jellyfin.getUserViews();
      setUserViews(views || []);

      await jellyfin.syncMediaLibrary({
        onFirstBatch: (batchItems, total, isFromCache) => {
          setAllMediaItems(batchItems);
          setIsLoadingInitial(false);
          if (!isFromCache) {
            setIsBackgroundSyncing(true);
            setLoadProgress({ current: batchItems.length, total });
          }
        },
        onProgress: (current, total) => {
          setIsBackgroundSyncing(current < total);
          setLoadProgress({ current, total });
        },
        onComplete: (fullItems, total) => {
          setAllMediaItems(fullItems);
          setIsLoadingInitial(false);
          setIsBackgroundSyncing(false);
          setIsRefreshing(false);
          setLoadProgress({ current: total, total });
        }
      });
    } catch (err) {
      console.error('Failed to sync media library:', err);
      setErrorText(err.message || '获取媒体库失败，请检查服务器网络或凭据');
    } finally {
      setIsLoadingInitial(false);
      setIsRefreshing(false);
    }
  }, []);

  // Initial load on mount
  useEffect(() => {
    if (jellyfin.auth.isConfigured) {
      startMediaSync(false);
    }
  }, [startMediaSync]);

  // On-demand fetch if a specific library view has 0 items loaded in local state
  const handleSelectView = useCallback(async (viewId) => {
    setSelectedViewId(viewId);
    if (viewId === 'all') return;

    // Check if we already have items tagged with this ViewId
    const existing = allMediaItems.filter(it => 
      it.ViewId === viewId || 
      (Array.isArray(it.ViewIds) && it.ViewIds.includes(viewId)) || 
      it.ParentId === viewId
    );

    if (existing.length === 0 && jellyfin.auth.isConfigured) {
      setIsLoadingView(true);
      try {
        const res = await jellyfin.getItemsByView(viewId, {
          Limit: 1000,
          SortBy: 'DateCreated',
          SortOrder: 'Descending'
        });
        const items = (res.Items || []).map(it => ({
          ...it,
          ViewId: viewId
        }));
        
        // Merge with existing items
        setAllMediaItems(prev => {
          const idSet = new Set(prev.map(p => p.Id));
          const newItems = items.filter(it => !idSet.has(it.Id));
          const updated = prev.map(it => {
            const found = items.find(n => n.Id === it.Id);
            return found ? { ...it, ViewId: viewId } : it;
          });
          return updated.concat(newItems);
        });
      } catch (err) {
        console.warn('Failed to load items for view:', viewId, err);
      } finally {
        setIsLoadingView(false);
      }
    }
  }, [allMediaItems]);

  // Compute Filtered Media Items based on current library, search, status, and sorting
  const filteredMediaItems = useMemo(() => {
    if (!allMediaItems || allMediaItems.length === 0) return [];

    let pool = [...allMediaItems];

    // 1. Filter by Library / View folder (if selectedViewId !== 'all')
    if (selectedViewId !== 'all') {
      pool = pool.filter(item => 
        item.ViewId === selectedViewId || 
        (Array.isArray(item.ViewIds) && item.ViewIds.includes(selectedViewId)) ||
        item.ParentId === selectedViewId
      );
    }

    // 2. Filter by search keyword
    if (searchKeyword.trim()) {
      const q = searchKeyword.toLowerCase().trim();
      pool = pool.filter(item => {
        const name = (item.Name || '').toLowerCase();
        const year = (item.ProductionYear || '').toString();
        const rating = (item.OfficialRating || '').toLowerCase();
        return name.includes(q) || year.includes(q) || rating.includes(q);
      });
    }

    // 3. Filter by status
    if (statusFilter === 'favorites') {
      pool = pool.filter(item => item.UserData?.IsFavorite);
    } else if (statusFilter === 'unplayed') {
      pool = pool.filter(item => !item.UserData?.Played);
    } else if (statusFilter === 'played') {
      pool = pool.filter(item => item.UserData?.Played);
    }

    // 4. Sort
    switch (sortMethod) {
      case 'name_asc':
        pool.sort((a, b) => (a.Name || '').localeCompare(b.Name || ''));
        break;
      case 'rating_desc':
        pool.sort((a, b) => (b.CommunityRating || 0) - (a.CommunityRating || 0));
        break;
      case 'playcount_asc':
        pool.sort((a, b) => (a.UserData?.PlayCount || 0) - (b.UserData?.PlayCount || 0));
        break;
      case 'playcount_desc':
        pool.sort((a, b) => (b.UserData?.PlayCount || 0) - (a.UserData?.PlayCount || 0));
        break;
      case 'date_desc':
      default:
        pool.sort((a, b) => new Date(b.DateCreated) - new Date(a.DateCreated));
        break;
    }

    return pool;
  }, [allMediaItems, selectedViewId, searchKeyword, statusFilter, sortMethod]);

  // Compute active scope name for display in HUD
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

  // Update item in local state when modified or favorited
  const handleUpdateItem = useCallback((updatedItem) => {
    if (!updatedItem?.Id) return;
    setAllMediaItems(prev => prev.map(item => item.Id === updatedItem.Id ? { ...item, ...updatedItem } : item));
  }, []);

  // Delete item from local state
  const handleDeleteItem = useCallback((deletedId) => {
    setAllMediaItems(prev => prev.filter(item => item.Id !== deletedId));
  }, []);

  // Play single item in Kanban mode
  const handlePlaySingleItem = useCallback((item) => {
    setViewMode('kanban');
  }, []);

  // Login handler
  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    setIsLoginModalOpen(false);
    startMediaSync(false);
  };

  // Logout handler
  const handleLogout = () => {
    setIsAuthenticated(false);
    setAllMediaItems([]);
    setIsLoginModalOpen(true);
  };

  return (
    <ErrorBoundary>
      <div className="relative w-screen h-screen bg-[#080b11] text-gray-100 overflow-hidden select-none">
        
        {/* Full-screen Loading Overlay (Initial connect only) */}
        {isLoadingInitial && allMediaItems.length === 0 && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md gap-4">
            <div className="relative flex items-center justify-center">
              <div className="w-14 h-14 rounded-full border-4 border-cyan-500/20 border-t-cyan-400 animate-spin" />
              <Film className="absolute text-cyan-400" size={24} />
            </div>
            <div className="flex flex-col items-center gap-1.5 text-center">
              <div className="text-sm font-semibold text-white">正在极速建立 Jellyfin 媒体索引...</div>
              <div className="text-xs font-mono text-cyan-300/80">
                {loadProgress.total > 0
                  ? `已同步 ${loadProgress.current} / ${loadProgress.total} 部影片`
                  : '正在连接服务器...'}
              </div>
            </div>
          </div>
        )}

        {/* Global Error Banner */}
        {errorText && !isLoadingInitial && (
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
            items={filteredMediaItems}
            userViews={userViews}
            selectedViewId={selectedViewId}
            onSelectView={handleSelectView}
            searchKeyword={searchKeyword}
            onSearchChange={setSearchKeyword}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            sortMethod={sortMethod}
            onSortMethodChange={setSortMethod}
            onEnterKanban={() => setViewMode('kanban')}
            onPlaySingleItem={handlePlaySingleItem}
            onUpdateItem={handleUpdateItem}
            onDeleteItem={handleDeleteItem}
            onOpenMetadataEditor={(item) => setEditingItem(item)}
            onOpenIdentify={(item) => setIdentifyingItem(item)}
            onRefreshLibrary={() => startMediaSync(true)}
            isRefreshing={isRefreshing || isBackgroundSyncing || isLoadingView}
          />
        ) : (
          <DesktopLayout
            items={filteredMediaItems}
            activeTileCount={activeTileCount}
            onTileCountChange={handleTileCountChange}
            filterMode={filterMode}
            onFilterModeChange={handleFilterModeChange}
            isGlobalMuted={isGlobalMuted}
            onToggleGlobalMute={() => setIsGlobalMuted(!isGlobalMuted)}
            playbackSpeed={playbackSpeed}
            onPlaybackSpeedChange={setPlaybackSpeed}
            onOpenSettings={() => setIsSettingsModalOpen(true)}
            onRefreshLibrary={() => startMediaSync(true)}
            isRefreshing={isRefreshing || isBackgroundSyncing || isLoadingView}
            onOpenLibraryView={() => setViewMode('library')}
            activeScopeName={activeScopeName}
          />
        )}

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
          onRefreshLibrary={() => startMediaSync(true)}
          isRefreshing={isRefreshing || isBackgroundSyncing || isLoadingView}
          totalItemsCount={allMediaItems.length}
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
