/**
 * Jellyfin REST API Client
 * Lightweight, zero-dependency, handles authentication, media streaming, and metadata.
 */

const STORAGE_KEY = 'jellyfin_faraday_auth';

export class JellyfinClient {
  constructor() {
    this.auth = this.loadStoredAuth();
    this.deviceId = this.getOrCreateDeviceId();
    this.clientName = 'JellyfinFaraday';
    this.clientVersion = '0.1.0';
    this.deviceName = 'Web Browser';
  }

  getOrCreateDeviceId() {
    let id = localStorage.getItem('jf_faraday_device_id');
    if (!id) {
      id = 'jf-faraday-' + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('jf_faraday_device_id', id);
    }
    return id;
  }

  loadStoredAuth() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load stored auth:', e);
    }
    return {
      serverUrl: import.meta.env.VITE_JELLYFIN_SERVER_URL || '',
      token: '',
      userId: '',
      username: '',
      isConfigured: false,
    };
  }

  saveAuth(authData) {
    this.auth = {
      ...this.auth,
      ...authData,
      isConfigured: !!(authData.serverUrl && authData.token && authData.userId)
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.auth));
    } catch (e) {
      console.error('Failed to save auth to localStorage:', e);
    }
    return this.auth;
  }

  clearAuth() {
    this.auth = {
      serverUrl: '',
      token: '',
      userId: '',
      username: '',
      isConfigured: false,
    };
    localStorage.removeItem(STORAGE_KEY);
  }

  getAuthHeaders() {
    const authHeader = `MediaBrowser Client="${this.clientName}", Device="${this.deviceName}", DeviceId="${this.deviceId}", Version="${this.clientVersion}"` +
      (this.auth.token ? `, Token="${this.auth.token}"` : '');
    
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Emby-Authorization': authHeader,
      ...(this.auth.token ? { 'X-MediaBrowser-Token': this.auth.token } : {})
    };
  }

  sanitizeServerUrl(url) {
    if (!url) return '';
    return url.trim().replace(/\/+$/, '');
  }

  /**
   * Authenticate user with Username & Password
   */
  async authenticateByName(serverUrl, username, password) {
    const cleanUrl = this.sanitizeServerUrl(serverUrl);
    const authHeader = `MediaBrowser Client="${this.clientName}", Device="${this.deviceName}", DeviceId="${this.deviceId}", Version="${this.clientVersion}"`;

    const res = await fetch(`${cleanUrl}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Emby-Authorization': authHeader,
      },
      body: JSON.stringify({
        Username: username,
        Pw: password || ''
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `登录失败 (HTTP ${res.status})`);
    }

    const data = await res.json();
    const authData = {
      serverUrl: cleanUrl,
      token: data.AccessToken,
      userId: data.User.Id,
      username: data.User.Name,
      isConfigured: true,
      serverId: data.ServerId
    };

    return this.saveAuth(authData);
  }

  /**
   * Connect using existing API Key / Token
   */
  async connectWithApiKey(serverUrl, apiKey) {
    const cleanUrl = this.sanitizeServerUrl(serverUrl);
    const authHeader = `MediaBrowser Client="${this.clientName}", Device="${this.deviceName}", DeviceId="${this.deviceId}", Version="${this.clientVersion}", Token="${apiKey}"`;

    // Fetch user or system info
    const res = await fetch(`${cleanUrl}/Users`, {
      headers: {
        'Accept': 'application/json',
        'X-Emby-Authorization': authHeader,
        'X-MediaBrowser-Token': apiKey
      }
    });

    if (!res.ok) {
      throw new Error(`连接失败，请检查服务器地址与 API Key (HTTP ${res.status})`);
    }

    const users = await res.json();
    if (!users || users.length === 0) {
      throw new Error('未在服务器上找到可用用户');
    }

    // Default to first user or admin
    const user = users[0];
    const authData = {
      serverUrl: cleanUrl,
      token: apiKey,
      userId: user.Id,
      username: user.Name,
      isConfigured: true
    };

    return this.saveAuth(authData);
  }

  /**
   * Validate current connection
   */
  async checkConnection() {
    if (!this.auth.serverUrl || !this.auth.token || !this.auth.userId) {
      return false;
    }
    try {
      const res = await fetch(`${this.auth.serverUrl}/System/Info`, {
        headers: this.getAuthHeaders()
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetch library items with optional filters
   */
  async getItems(params = {}) {
    if (!this.auth.isConfigured) return { Items: [], TotalRecordCount: 0 };

    const query = new URLSearchParams({
      IncludeItemTypes: 'Movie,Video,Episode',
      Recursive: 'true',
      Fields: 'PrimaryImageAspectRatio,Path,MediaSources,UserData,Overview,Genres,Taglines,CommunityRating,DateCreated,RunTimeTicks',
      ...params
    });

    const res = await fetch(`${this.auth.serverUrl}/Users/${this.auth.userId}/Items?${query.toString()}`, {
      headers: this.getAuthHeaders()
    });

    if (!res.ok) {
      throw new Error(`获取媒体列表失败 (HTTP ${res.status})`);
    }

    return res.json();
  }

  /**
   * Fetch all video items for high-performance client-side shuffling & filtering
   */
  async fetchAllMediaLibrary(onProgress = null) {
    if (!this.auth.isConfigured) return [];

    let allItems = [];
    let startIndex = 0;
    const limit = 500;
    let total = Infinity;

    while (allItems.length < total) {
      const res = await this.getItems({
        StartIndex: startIndex,
        Limit: limit,
        SortBy: 'DateCreated',
        SortOrder: 'Descending'
      });

      total = res.TotalRecordCount || 0;
      const items = res.Items || [];
      if (items.length === 0) break;

      allItems = allItems.concat(items);
      startIndex += items.length;

      if (onProgress) {
        onProgress(allItems.length, total);
      }

      if (allItems.length >= total) break;
    }

    return allItems;
  }

  /**
   * Get direct playable stream URL
   */
  getStreamUrl(itemId) {
    if (!this.auth.serverUrl || !itemId) return '';
    return `${this.auth.serverUrl}/Videos/${itemId}/stream?static=true&api_key=${this.auth.token}`;
  }

  /**
   * Get HLS master playlist URL
   */
  getHlsUrl(itemId) {
    if (!this.auth.serverUrl || !itemId) return '';
    const query = new URLSearchParams({
      api_key: this.auth.token,
      VideoCodec: 'h264,hevc,av1,vp9',
      AudioCodec: 'aac,mp3,opus,flac',
      TranscodingMaxAudioChannels: '2',
      RequireAvc: 'false',
      SegmentContainer: 'ts',
      MinSegments: '2'
    });
    return `${this.auth.serverUrl}/Videos/${itemId}/master.m3u8?${query.toString()}`;
  }

  /**
   * Get Poster/Backdrop Image URL
   */
  getImageUrl(itemId, tag = null, type = 'Primary', maxWidth = 600) {
    if (!this.auth.serverUrl || !itemId) return '';
    let url = `${this.auth.serverUrl}/Items/${itemId}/Images/${type}?maxWidth=${maxWidth}&quality=90`;
    if (tag) {
      url += `&tag=${tag}`;
    }
    return url;
  }

  /**
   * Toggle favorite status
   */
  async toggleFavorite(itemId, isFavorite) {
    if (!this.auth.isConfigured || !itemId) return false;
    const method = isFavorite ? 'POST' : 'DELETE';
    const res = await fetch(`${this.auth.serverUrl}/Users/${this.auth.userId}/FavoriteItems/${itemId}`, {
      method,
      headers: this.getAuthHeaders()
    });
    return res.ok;
  }

  /**
   * Mark item played / unplayed
   */
  async markPlayed(itemId, isPlayed) {
    if (!this.auth.isConfigured || !itemId) return false;
    const method = isPlayed ? 'POST' : 'DELETE';
    const res = await fetch(`${this.auth.serverUrl}/Users/${this.auth.userId}/PlayedItems/${itemId}`, {
      method,
      headers: this.getAuthHeaders()
    });
    return res.ok;
  }

  /**
   * Trigger Jellyfin library rescan
   */
  async refreshLibrary() {
    if (!this.auth.isConfigured) return false;
    const res = await fetch(`${this.auth.serverUrl}/Library/Refresh`, {
      method: 'POST',
      headers: this.getAuthHeaders()
    });
    return res.ok;
  }
}

export const jellyfin = new JellyfinClient();
