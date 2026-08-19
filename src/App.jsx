import React, { useState, useEffect, useCallback } from 'react';
import { jellyfin } from './api/jellyfinClient';
import DesktopLayout from './components/DesktopLayout';
import LoginModal from './components/LoginModal';
import SettingsModal from './components/SettingsModal';
import ErrorBoundary from './components/ErrorBoundary';
import { Film, Loader2, Sparkles, AlertCircle } from 'lucide-react';

const STORAGE_KEY_TILES = 'jf_faraday_tile_count';
const STORAGE_KEY_FILTER = 'jf_faraday_filter_mode';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(jellyfin.auth.isConfigured);
  const [mediaItems, setMediaItems] = useState([]);
  const [isLoadingMedia, setIsLoadingMedia] = useState(false);
  const [loadProgress, setLoadProgress] = useState({ current: 0, total: 0 });
  const [errorText, setErrorText] = useState('');

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
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  // Fetch full media library
  const loadMediaLibrary = useCallback(async () => {
    if (!jellyfin.auth.isConfigured) return;

    setIsLoadingMedia(true);
    setErrorText('');
    setLoadProgress({ current: 0, total: 0 });

    try {
      const items = await jellyfin.fetchAllMediaLibrary((current, total) => {
        setLoadProgress({ current, total });
      });
      setMediaItems(items);
    } catch (err) {
      console.error('Failed to load media library:', err);
      setErrorText(err.message || '获取媒体库失败，请检查服务器网络或凭据');
    } finally {
      setIsLoadingMedia(false);
      setIsRefreshing(false);
    }
  }, []);

  // Initial load on mount if configured
  useEffect(() => {
    if (jellyfin.auth.isConfigured) {
      loadMediaLibrary();
    }
  }, [loadMediaLibrary]);

  // Login handler
  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    setIsLoginModalOpen(false);
    loadMediaLibrary();
  };

  // Logout handler
  const handleLogout = () => {
    setIsAuthenticated(false);
    setMediaItems([]);
    setIsLoginModalOpen(true);
  };

  // Refresh library
  const handleRefreshLibrary = () => {
    setIsRefreshing(true);
    loadMediaLibrary();
  };

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger when typing in inputs
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      if (e.key === '1') handleTileCountChange(1);
      if (e.key === '2') handleTileCountChange(2);
      if (e.key === '4') handleTileCountChange(4);
      if (e.key === 'm' || e.key === 'M') setIsGlobalMuted(prev => !prev);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <ErrorBoundary>
      <div className="relative w-screen h-screen bg-[#080b11] text-gray-100 overflow-hidden select-none">
        
        {/* Loading Overlay */}
        {isLoadingMedia && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md gap-4">
            <div className="relative flex items-center justify-center">
              <div className="w-14 h-14 rounded-full border-4 border-cyan-500/20 border-t-cyan-400 animate-spin" />
              <Film className="absolute text-cyan-400" size={24} />
            </div>
            <div className="flex flex-col items-center gap-1.5 text-center">
              <div className="text-sm font-semibold text-white">正在加载 Jellyfin 媒体库...</div>
              <div className="text-xs font-mono text-cyan-300/80">
                {loadProgress.total > 0
                  ? `已同步 ${loadProgress.current} / ${loadProgress.total} 部影片`
                  : '正在与服务器建立高速索引...'}
              </div>
            </div>
          </div>
        )}

        {/* Global Error Banner */}
        {errorText && !isLoadingMedia && (
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

        {/* Main Desktop Kanban Layout */}
        <DesktopLayout
          items={mediaItems}
          activeTileCount={activeTileCount}
          onTileCountChange={handleTileCountChange}
          filterMode={filterMode}
          onFilterModeChange={handleFilterModeChange}
          isGlobalMuted={isGlobalMuted}
          onToggleGlobalMute={() => setIsGlobalMuted(!isGlobalMuted)}
          playbackSpeed={playbackSpeed}
          onPlaybackSpeedChange={setPlaybackSpeed}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          onRefreshLibrary={handleRefreshLibrary}
          isRefreshing={isRefreshing}
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
          onRefreshLibrary={handleRefreshLibrary}
          isRefreshing={isRefreshing}
          totalItemsCount={mediaItems.length}
        />
      </div>
    </ErrorBoundary>
  );
}
