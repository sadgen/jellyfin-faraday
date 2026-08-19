import { useCallback } from 'react';
import { jellyfin } from '../api/jellyfinClient';

/**
 * Hook for launching external desktop players with Direct Stream URL
 */
export function useExternalPlayer() {
  const launchPlayer = useCallback((playerType, item) => {
    if (!item?.Id) return;

    const streamUrl = jellyfin.getStreamUrl(item.Id);
    if (!streamUrl) return;

    let targetUri = '';

    switch (playerType) {
      case 'mpv':
        // MPV URL scheme (mpv:// or mpv://<stream-url>)
        targetUri = `mpv://${streamUrl}`;
        break;

      case 'potplayer':
        // PotPlayer URL scheme (potplayer://<stream-url>)
        targetUri = `potplayer://${streamUrl}`;
        break;

      case 'vlc':
        // VLC URL scheme (vlc://<stream-url>)
        targetUri = `vlc://${streamUrl}`;
        break;

      case 'iina':
        // IINA (macOS) URL scheme (iina://weblink?url=<encoded-url>)
        targetUri = `iina://weblink?url=${encodeURIComponent(streamUrl)}`;
        break;

      default:
        // Direct stream in new tab / download
        window.open(streamUrl, '_blank');
        return;
    }

    try {
      window.location.href = targetUri;
    } catch (e) {
      console.error(`Failed to launch ${playerType}:`, e);
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(streamUrl).then(() => {
        alert(`已复制视频流链接到剪贴板，可在 ${playerType} 中直接打开`);
      });
    }
  }, []);

  return { launchPlayer };
}
