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

    let targetUri;

    switch (playerType) {
      case 'mpv':
        targetUri = `mpv://${encodeURIComponent(streamUrl)}`;
        break;

      case 'potplayer':
        targetUri = `potplayer://${encodeURIComponent(streamUrl)}`;
        break;

      case 'vlc':
        targetUri = `vlc://${encodeURIComponent(streamUrl)}`;
        break;

      case 'iina':
        targetUri = `iina://weblink?url=${encodeURIComponent(streamUrl)}`;
        break;

      default:
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
