/**
 * Jellyfin REST API Client (Official Web Client-Style Architecture)
 * High-performance, supports indexed library views, genres, persons, collections, server-side and bulk queries.
 */

const STORAGE_KEY = 'jellyfin_faraday_auth';

export class JellyfinClient {
  constructor() {
    this.auth = this.loadStoredAuth();
    this.deviceId = this.getOrCreateDeviceId();
    this.clientName = 'JellyfinFaraday';
    this.clientVersion = '0.2.0';
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
   * Connect using existing API Key / Token.
   * 多用户安全选择（audit #20）：不再默认取 users[0]。
   * - 单用户：直接落盘登录，返回 { status: 'connected', auth }
   * - 多用户：返回 { status: 'select_user', users }（不写任何状态），
   *   由 UI 展示用户列表，用户点选后调用 completeApiKeyLogin 完成登录
   */
  async connectWithApiKey(serverUrl, apiKey) {
    const cleanUrl = this.sanitizeServerUrl(serverUrl);
    const authHeader = `MediaBrowser Client="${this.clientName}", Device="${this.deviceName}", DeviceId="${this.deviceId}", Version="${this.clientVersion}", Token="${apiKey}"`;

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

    if (users.length > 1) {
      return {
        status: 'select_user',
        serverUrl: cleanUrl,
        users: users.map(u => ({ Id: u.Id, Name: u.Name }))
      };
    }

    const auth = this.completeApiKeyLogin(cleanUrl, apiKey, users[0]);
    return { status: 'connected', auth };
  }

  /**
   * 用指定用户完成 API Key 登录（第二阶段，落盘凭据）
   */
  completeApiKeyLogin(serverUrl, apiKey, user) {
    const authData = {
      serverUrl,
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
   * Fetch user top-level library folders / views (< 10ms)
   */
  async getUserViews() {
    if (!this.auth.isConfigured) return [];
    try {
      const res = await fetch(`${this.auth.serverUrl}/Users/${this.auth.userId}/Views`, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.Items || [];
    } catch (err) {
      console.warn('Failed to fetch user views:', err);
      return [];
    }
  }

  /**
   * Server-side Paginated / Bulk Query (Official Jellyfin Web Client Pattern)
   * High performance: Server executes indexed query with lightweight fields.
   */
  async queryMediaPage({
    parentId = '',
    searchTerm = '',
    statusFilter = 'all',
    sortMethod = 'date_desc',
    genre = '',
    year = '',
    nameStartsWithOrGreater = '',
    startIndex = 0,
    limit = 0
  } = {}) {
    if (!this.auth.isConfigured) return { Items: [], TotalRecordCount: 0 };

    const query = new URLSearchParams({
      IncludeItemTypes: 'Movie,Video,Episode',
      Recursive: 'true',
      Fields: 'PrimaryImageAspectRatio,UserData,CommunityRating,DateCreated,RunTimeTicks,ProductionYear,OfficialRating,ParentId,ImageTags,Trickplay,Genres,Overview',
      EnableImages: 'true',
      StartIndex: startIndex.toString()
    });

    if (limit > 0) {
      query.set('Limit', limit.toString());
    }

    if (parentId && parentId !== 'all') {
      query.set('ParentId', parentId);
    }

    if (searchTerm && searchTerm.trim()) {
      query.set('SearchTerm', searchTerm.trim());
    }

    if (genre) {
      query.set('Genres', genre);
    }

    if (year) {
      query.set('Years', year.toString());
    }

    if (nameStartsWithOrGreater) {
      if (nameStartsWithOrGreater === '#') {
        query.set('NameLessThan', 'A');
      } else {
        query.set('NameStartsWith', nameStartsWithOrGreater);
      }
    }

    // Status Filters
    if (statusFilter === 'favorites') {
      query.set('Filters', 'IsFavorite');
    } else if (statusFilter === 'unplayed') {
      query.set('Filters', 'IsUnplayed');
    } else if (statusFilter === 'played') {
      query.set('Filters', 'IsPlayed');
    }

    // Sort Mapping
    switch (sortMethod) {
      case 'name_asc':
        query.set('SortBy', 'SortName');
        query.set('SortOrder', 'Ascending');
        break;
      case 'name_desc':
        query.set('SortBy', 'SortName');
        query.set('SortOrder', 'Descending');
        break;
      case 'rating_desc':
        query.set('SortBy', 'CommunityRating,SortName');
        query.set('SortOrder', 'Descending');
        break;
      case 'rating_asc':
        query.set('SortBy', 'CommunityRating,SortName');
        query.set('SortOrder', 'Ascending');
        break;
      case 'playcount_asc':
        query.set('SortBy', 'PlayCount,SortName');
        query.set('SortOrder', 'Ascending');
        break;
      case 'playcount_desc':
        query.set('SortBy', 'PlayCount,SortName');
        query.set('SortOrder', 'Descending');
        break;
      case 'runtime_desc':
        query.set('SortBy', 'Runtime,SortName');
        query.set('SortOrder', 'Descending');
        break;
      case 'year_desc':
        query.set('SortBy', 'ProductionYear,SortName');
        query.set('SortOrder', 'Descending');
        break;
      case 'year_asc':
        query.set('SortBy', 'ProductionYear,SortName');
        query.set('SortOrder', 'Ascending');
        break;
      case 'random':
        query.set('SortBy', 'Random');
        break;
      case 'date_asc':
        query.set('SortBy', 'DateCreated,SortName');
        query.set('SortOrder', 'Ascending');
        break;
      case 'date_desc':
      default:
        query.set('SortBy', 'DateCreated,SortName');
        query.set('SortOrder', 'Descending');
        break;
    }

    const res = await fetch(`${this.auth.serverUrl}/Users/${this.auth.userId}/Items?${query.toString()}`, {
      headers: this.getAuthHeaders()
    });

    if (!res.ok) {
      throw new Error(`获取媒体列表失败 (HTTP ${res.status})`);
    }

    return res.json();
  }

  /**
   * Fetch all genres for current library or global
   */
  async getGenres(parentId = '') {
    if (!this.auth.isConfigured) return [];
    try {
      const query = new URLSearchParams({
        userId: this.auth.userId,
        Recursive: 'true',
        IncludeItemTypes: 'Movie,Video,Episode'
      });
      if (parentId && parentId !== 'all') {
        query.set('parentId', parentId);
      }
      const res = await fetch(`${this.auth.serverUrl}/Genres?${query.toString()}`, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.Items || [];
    } catch (err) {
      console.warn('Failed to fetch genres:', err);
      return [];
    }
  }

  /**
   * Fetch all persons (Actors/Directors) for current library
   */
  async getPersons(parentId = '', limit = 100) {
    if (!this.auth.isConfigured) return [];
    try {
      const query = new URLSearchParams({
        userId: this.auth.userId,
        Recursive: 'true',
        Limit: limit.toString()
      });
      if (parentId && parentId !== 'all') {
        query.set('parentId', parentId);
      }
      const res = await fetch(`${this.auth.serverUrl}/Persons?${query.toString()}`, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.Items || [];
    } catch (err) {
      console.warn('Failed to fetch persons:', err);
      return [];
    }
  }

  /**
   * Fetch collections (BoxSets)
   */
  async getCollections(parentId = '') {
    if (!this.auth.isConfigured) return [];
    try {
      const query = new URLSearchParams({
        IncludeItemTypes: 'BoxSet',
        Recursive: 'true'
      });
      if (parentId && parentId !== 'all') {
        query.set('ParentId', parentId);
      }
      const res = await fetch(`${this.auth.serverUrl}/Users/${this.auth.userId}/Items?${query.toString()}`, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.Items || [];
    } catch (err) {
      console.warn('Failed to fetch collections:', err);
      return [];
    }
  }

  /**
   * Fast Batch Fetch for Kanban Random Queue
   */
  async queryRandomBatch({
    parentId = '',
    filterMode = 'pure_random',
    limit = 100
  } = {}) {
    if (!this.auth.isConfigured) return [];

    let statusFilter = 'all';
    let sortMethod = 'random';

    if (filterMode === 'favorite_random') {
      statusFilter = 'favorites';
      sortMethod = 'random';
    } else if (filterMode === 'least_played_random') {
      sortMethod = 'playcount_asc';
    } else if (filterMode === 'latest_random') {
      sortMethod = 'date_desc';
    }

    const data = await this.queryMediaPage({
      parentId,
      statusFilter,
      sortMethod,
      startIndex: 0,
      limit
    });

    return data.Items || [];
  }

  /**
   * Fetch full item details for editing/playback (On demand only)
   */
  async getItemDetails(itemId) {
    if (!this.auth.isConfigured || !itemId) return null;
    const res = await fetch(`${this.auth.serverUrl}/Users/${this.auth.userId}/Items/${itemId}`, {
      headers: this.getAuthHeaders()
    });
    if (!res.ok) throw new Error(`获取媒体详情失败 (HTTP ${res.status})`);
    return res.json();
  }

  /**
   * Update item metadata (Name, Overview, Year, Rating, Tags, Genres)
   */
  async updateItemMetadata(itemId, itemData) {
    if (!this.auth.isConfigured || !itemId) return false;
    const res = await fetch(`${this.auth.serverUrl}/Items/${itemId}`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(itemData)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `保存元数据失败 (HTTP ${res.status})`);
    }
    return true;
  }

  /**
   * Trigger refresh metadata on a single item
   */
  async refreshItemMetadata(itemId) {
    if (!this.auth.isConfigured || !itemId) return false;
    const res = await fetch(`${this.auth.serverUrl}/Items/${itemId}/Refresh?Recursive=true&MetadataRefreshMode=Full&ImageRefreshMode=Full&ReplaceAllMetadata=true&ReplaceAllImages=false`, {
      method: 'POST',
      headers: this.getAuthHeaders()
    });
    return res.ok;
  }

  /**
   * Remote metadata search / scraping for Identify modal
   */
  async searchRemoteMetadata(itemId, searchParams) {
    if (!this.auth.isConfigured || !itemId) return [];
    const res = await fetch(`${this.auth.serverUrl}/Items/RemoteSearch/Movie`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        SearchInfo: {
          Name: searchParams.name || '',
          Year: searchParams.year ? parseInt(searchParams.year, 10) : undefined,
          ProviderIds: searchParams.providerIds || {}
        },
        ItemId: itemId
      })
    });
    if (!res.ok) {
      const seriesRes = await fetch(`${this.auth.serverUrl}/Items/RemoteSearch/Series`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          SearchInfo: {
            Name: searchParams.name || '',
            Year: searchParams.year ? parseInt(searchParams.year, 10) : undefined
          },
          ItemId: itemId
        })
      });
      if (!seriesRes.ok) return [];
      return seriesRes.json();
    }
    return res.json();
  }

  /**
   * Apply remote search scraped metadata
   */
  async applyRemoteMetadata(itemId, searchResult, replaceAllImages = true) {
    if (!this.auth.isConfigured || !itemId) return false;
    const query = new URLSearchParams({
      ReplaceAllImages: replaceAllImages ? 'true' : 'false'
    });
    const res = await fetch(`${this.auth.serverUrl}/Items/RemoteSearch/Apply/${itemId}?${query.toString()}`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(searchResult)
    });
    return res.ok;
  }

  /**
   * Delete media item from library / disk
   */
  async deleteItem(itemId) {
    if (!this.auth.isConfigured || !itemId) return false;
    const res = await fetch(`${this.auth.serverUrl}/Items/${itemId}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) {
      throw new Error(`删除失败，可能没有管理员/写权限 (HTTP ${res.status})`);
    }
    return true;
  }

  /**
   * Get direct playable stream URL
   */
  getStreamUrl(itemId) {
    if (!this.auth.serverUrl || !itemId) return '';
    return `${this.auth.serverUrl}/Videos/${itemId}/stream?static=true&api_key=${this.auth.token}`;
  }

  /**
   * Get robust HLS master playlist URL
   */
  getHlsUrl(itemId) {
    if (!this.auth.serverUrl || !itemId) return '';
    const playSessionId = 'jf_' + Math.random().toString(36).substring(2, 10);
    const query = new URLSearchParams({
      MediaSourceId: itemId,
      api_key: this.auth.token,
      PlaySessionId: playSessionId,
      VideoCodec: 'h264',
      AudioCodec: 'aac,mp3',
      maxStreamingBitrate: '8000000',
      TranscodingMaxAudioChannels: '2',
      RequireAvc: 'false',
      SegmentContainer: 'ts',
      MinSegments: '2'
    });
    return `${this.auth.serverUrl}/Videos/${itemId}/master.m3u8?${query.toString()}`;
  }

  /**
   * Get Poster/Backdrop Image URL (Optimized for instant decoding)
   */
  getImageUrl(itemId, tag = null, type = 'Primary', maxWidth = 360, quality = 80) {
    if (!this.auth.serverUrl || !itemId) return '';
    let url = `${this.auth.serverUrl}/Items/${itemId}/Images/${type}?maxWidth=${maxWidth}&quality=${quality}`;
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
   * Report Playback Session progress to Jellyfin server (Increments PlayCount and updates last played)
   */
  async reportPlayback(itemId, positionSec = 0, isPaused = false, type = 'Progress') {
    if (!this.auth.isConfigured || !itemId) return false;
    const endpoint = type === 'Started' ? '' : `/${type}`;
    const url = `${this.auth.serverUrl}/Sessions/Playing${endpoint}?api_key=${this.auth.token}`;
    const body = {
      ItemId: itemId,
      PositionTicks: Math.floor(positionSec * 10000000),
      IsPaused: isPaused,
      VolumeLevel: 100,
      EventName: type
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(body)
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get full playback info including MediaSources and MediaStreams (Subtitles, Audio, Video)
   */
  async getItemPlaybackInfo(itemId) {
    if (!this.auth.isConfigured || !itemId) return null;
    try {
      const res = await fetch(`${this.auth.serverUrl}/Items/${itemId}/PlaybackInfo?UserId=${this.auth.userId}`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          DeviceProfile: {
            MaxStreamingBitrate: 140000000,
            DirectPlayProfiles: [
              { Container: 'mp4,mkv,webm,mov,avi', Type: 'Video' }
            ],
            SubtitleProfiles: [
              { Format: 'vtt', Method: 'External' },
              { Format: 'srt', Method: 'External' }
            ]
          }
        })
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn('Failed to get playback info:', err);
    }
    // Fallback to getItemDetails
    return await this.getItemDetails(itemId);
  }

  /**
   * Fetch additional parts / multi-part video segments (e.g. part1/part2/part3, CD1/CD2)
   */
  async getAdditionalParts(itemId) {
    if (!this.auth.isConfigured || !itemId) return [];
    try {
      const res = await fetch(`${this.auth.serverUrl}/Videos/${itemId}/AdditionalParts?userId=${this.auth.userId}`, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.Items || [];
    } catch (err) {
      console.warn('Failed to fetch additional parts:', err);
      return [];
    }
  }

  /**
   * Search Remote Subtitles from plugins (MeiamSub.Thunder, Shooter, OpenSubtitles, etc.)
   */
  async searchRemoteSubtitles(itemId, language = 'chi') {
    if (!this.auth.isConfigured || !itemId) return [];
    try {
      const res = await fetch(`${this.auth.serverUrl}/Items/${itemId}/RemoteSearch/Subtitles/${language}`, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) return [];
      return await res.json();
    } catch (err) {
      console.warn('Failed to search remote subtitles:', err);
      return [];
    }
  }

  /**
   * Download and attach Remote Subtitle to media item, then refresh item metadata
   */
  async downloadRemoteSubtitle(itemId, subtitleId) {
    if (!this.auth.isConfigured || !itemId || !subtitleId) return false;
    try {
      const res = await fetch(`${this.auth.serverUrl}/Items/${itemId}/RemoteSearch/Subtitles/${subtitleId}`, {
        method: 'POST',
        headers: this.getAuthHeaders()
      });
      if (!res.ok) return false;
      
      // Request Jellyfin to refresh metadata so the new subtitle file is immediately probed into MediaStreams
      await this.refreshItemMetadata(itemId).catch(() => {});
      return true;
    } catch (err) {
      console.warn('Failed to download subtitle:', err);
      return false;
    }
  }

  /**
   * Get Subtitle WebVTT Stream URL
   */
  getSubtitleTrackUrl(itemId, mediaSourceId, subtitleIndex) {
    if (!this.auth.serverUrl || !itemId || subtitleIndex === undefined) return '';
    const srcId = mediaSourceId || itemId;
    return `${this.auth.serverUrl}/Videos/${itemId}/${srcId}/Subtitles/${subtitleIndex}/Stream.vtt?api_key=${this.auth.token}`;
  }

  /**
   * Trigger Jellyfin library rescan & metadata refresh (Scans for newly added movies on disk)
   */
  async refreshLibrary(parentId = '') {
    if (!this.auth.isConfigured) return false;
    try {
      if (parentId && parentId !== 'all') {
        // Refresh specific media folder
        await fetch(`${this.auth.serverUrl}/Items/${parentId}/Refresh?Recursive=true&ImageRefreshMode=Default&MetadataRefreshMode=Default&ReplaceAllImages=false&ReplaceAllMetadata=false`, {
          method: 'POST',
          headers: this.getAuthHeaders()
        }).catch(() => {});
      }
      const res = await fetch(`${this.auth.serverUrl}/Library/Refresh`, {
        method: 'POST',
        headers: this.getAuthHeaders()
      });
      return res.ok;
    } catch (err) {
      console.warn('Failed to trigger library refresh:', err);
      return false;
    }
  }
}

export const jellyfin = new JellyfinClient();
