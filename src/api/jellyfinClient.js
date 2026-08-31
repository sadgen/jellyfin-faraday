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
    this.clientVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.2.0';
    this.deviceName = 'Web Browser';
  }

  getOrCreateDeviceId() {
    let id = localStorage.getItem('jf_faraday_device_id');
    if (!id) {
      id = 'jf-faraday-' + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('jf_faraday_device_id', id);
      if (typeof localStorage !== 'undefined') localStorage.setItem('jf_faraday_device_id', id);
    }
    return id;
  }

  loadStoredAuth() {
    try {
      // Check sessionStorage first (for session-only logins), then localStorage
      const sessionSaved = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY) : null;
      if (sessionSaved) {
        return JSON.parse(sessionSaved);
      }
      const localSaved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (localSaved) {
        return JSON.parse(localSaved);
      }
    } catch (e) {
      console.warn('Failed to load stored auth:', e);
    }
    return {
      serverUrl: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_JELLYFIN_SERVER_URL) || '',
      token: '',
      userId: '',
      username: '',
      isConfigured: false,
    };
  }

  saveAuth(authData, rememberMe = true) {
    this.auth = {
      ...this.auth,
      ...authData,
      isConfigured: !!(authData.serverUrl && authData.token && authData.userId)
    };
    try {
      if (rememberMe) {
        if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(this.auth));
        if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(STORAGE_KEY);
      } else {
        if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.auth));
        if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {
      console.error('Failed to save auth:', e);
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
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(STORAGE_KEY);
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
    let clean = url.trim().replace(/\/+$/, '');
    const schemeMatch = clean.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):(\/\/|[^0-9])/);
    if (schemeMatch) {
      const scheme = schemeMatch[1].toLowerCase();
      if (scheme !== 'http' && scheme !== 'https') {
        throw new Error('仅支持 HTTP 或 HTTPS 协议地址');
      }
    } else {
      clean = 'http://' + clean;
    }
    try {
      const parsed = new URL(clean);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('仅支持 HTTP 或 HTTPS 协议地址');
      }
      return clean;
    } catch (e) {
      throw new Error(e.message || '无效的服务器地址', { cause: e });
    }
  }

  /**
   * Authenticate user with Username & Password
   */
  async authenticateByName(serverUrl, username, password, rememberMe = true) {
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

    return this.saveAuth(authData, rememberMe);
  }

  /**
   * Connect using existing API Key / Token.
   * 多用户安全选择（audit #20）：不再默认取 users[0]。
   * - 单用户：直接落盘登录，返回 { status: 'connected', auth }
   * - 多用户：返回 { status: 'select_user', users }（不写任何状态），
   *   由 UI 展示用户列表，用户点选后调用 completeApiKeyLogin 完成登录
   */
  async connectWithApiKey(serverUrl, apiKey, rememberMe = true) {
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

    const auth = this.completeApiKeyLogin(cleanUrl, apiKey, users[0], rememberMe);
    return { status: 'connected', auth };
  }

  /**
   * 用指定用户完成 API Key 登录（第二阶段，落盘凭据）
   */
  completeApiKeyLogin(serverUrl, apiKey, user, rememberMe = true) {
    const authData = {
      serverUrl,
      token: apiKey,
      userId: user.Id,
      username: user.Name,
      isConfigured: true
    };
    return this.saveAuth(authData, rememberMe);
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
    ids = '',
    startIndex = 0,
    limit = 0
  } = {}) {
    if (!this.auth.isConfigured) return { Items: [], TotalRecordCount: 0 };

    const query = new URLSearchParams({
      IncludeItemTypes: 'Movie,Video,Episode',
      Recursive: 'true',
      Fields: 'PrimaryImageAspectRatio,UserData,CommunityRating,DateCreated,RunTimeTicks,ProductionYear,OfficialRating,ParentId,ImageTags,Trickplay,Genres,Overview,People',
      EnableImages: 'true',
      StartIndex: startIndex.toString()
    });

    if (limit > 0) {
      query.set('Limit', limit.toString());
    }

    if (parentId && parentId !== 'all') {
      query.set('ParentId', parentId);
    }

    if (ids) {
      query.set('Ids', ids);
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
   * 创建播放会话 ID。
   * 同一条目内切换画质/音轨应复用并在切换前上报 Stopped（携带该 ID），
   * 否则服务器会残留孤儿转码会话持续占用 CPU。
   */
  createPlaySessionId() {
    return 'jf_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
  }

  /**
   * Get robust HLS master playlist URL
   * @param {object} opts - { playSessionId, audioStreamIndex }
   */
  getHlsUrl(itemId, { playSessionId = null, audioStreamIndex = null } = {}) {
    if (!this.auth.serverUrl || !itemId) return '';
    const query = new URLSearchParams({
      MediaSourceId: itemId,
      api_key: this.auth.token,
      PlaySessionId: playSessionId || ('jf_' + Math.random().toString(36).substring(2, 10)),
      VideoCodec: 'h264',
      AudioCodec: 'aac,mp3',
      maxStreamingBitrate: '8000000',
      TranscodingMaxAudioChannels: '2',
      RequireAvc: 'false',
      SegmentContainer: 'ts',
      MinSegments: '2'
    });
    if (audioStreamIndex !== null && audioStreamIndex !== undefined) {
      query.set('AudioStreamIndex', String(audioStreamIndex));
    }
    return `${this.auth.serverUrl}/Videos/${itemId}/master.m3u8?${query.toString()}`;
  }

  /**
   * Get Smooth HLS Transcode URL (Forced bitrate H.264/AAC for 0 frame drops on stuttering / HEVC videos)
   * @param {object} opts - { playSessionId, audioStreamIndex }
   */
  getSmoothHlsUrl(itemId, maxBitrate = 4000000, { playSessionId = null, audioStreamIndex = null } = {}) {
    if (!this.auth.serverUrl || !itemId) return '';
    const query = new URLSearchParams({
      MediaSourceId: itemId,
      api_key: this.auth.token,
      PlaySessionId: playSessionId || ('jf_smooth_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6)),
      VideoCodec: 'h264',
      AudioCodec: 'aac',
      maxStreamingBitrate: String(maxBitrate),
      VideoBitrate: String(maxBitrate),
      AudioBitrate: '128000',
      TranscodingMaxAudioChannels: '2',
      SegmentContainer: 'ts',
      MinSegments: '2'
    });
    if (audioStreamIndex !== null && audioStreamIndex !== undefined) {
      query.set('AudioStreamIndex', String(audioStreamIndex));
    }
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
    if (this.auth.token) {
      url += `&api_key=${encodeURIComponent(this.auth.token)}`;
    }
    return url;
  }

  /**
   * 选择条目最佳可用封面 URL。
   * 回退链：Primary（海报/截图封面）→ Thumb → Backdrop；preferBackdrop 时优先 16:9 图源。
   * 最后尝试不带 tag 的 Primary：服务器为无元数据视频自动生成的截图封面，
   * 可能尚未反映在本地缓存的 ImageTags 里（无图时返回 404，由调用方 onError 回退占位图）。
   */
  getBestImageUrl(item, { maxWidth = 360, preferBackdrop = false, quality = 80 } = {}) {
    if (!this.auth.serverUrl || !item?.Id) return '';
    const tags = item.ImageTags || {};
    if (preferBackdrop) {
      if (tags.Backdrop) return this.getImageUrl(item.Id, tags.Backdrop, 'Backdrop', maxWidth, quality);
      if (tags.Thumb) return this.getImageUrl(item.Id, tags.Thumb, 'Thumb', maxWidth, quality);
      if (tags.Primary) return this.getImageUrl(item.Id, tags.Primary, 'Primary', maxWidth, quality);
    } else {
      if (tags.Primary) return this.getImageUrl(item.Id, tags.Primary, 'Primary', maxWidth, quality);
      if (tags.Thumb) return this.getImageUrl(item.Id, tags.Thumb, 'Thumb', maxWidth, quality);
      if (tags.Backdrop) return this.getImageUrl(item.Id, tags.Backdrop, 'Backdrop', maxWidth, quality);
    }
    return this.getImageUrl(item.Id, null, 'Primary', maxWidth, quality);
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
    if (!res.ok) {
      throw new Error(`更新收藏状态失败 (HTTP ${res.status})`);
    }
    return true;
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
   * @param {object} opts - { playSessionId, volumeLevel }
   */
  async reportPlayback(itemId, positionSec = 0, isPaused = false, type = 'Progress', { playSessionId = null, volumeLevel = null } = {}) {
    if (!this.auth.isConfigured || !itemId) return false;
    const endpoint = type === 'Started' ? '' : `/${type}`;
    const url = `${this.auth.serverUrl}/Sessions/Playing${endpoint}`;
    const body = {
      ItemId: itemId,
      PositionTicks: Math.floor(positionSec * 10000000),
      IsPaused: isPaused,
      VolumeLevel: (volumeLevel !== null && volumeLevel !== undefined) ? Math.round(volumeLevel) : 100,
      EventName: type
    };
    if (playSessionId) {
      body.PlaySessionId = playSessionId;
    }
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

  /**
   * Fetch all production years for current library (年份标签页)
   */
  async getYears(parentId = '') {
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
      const res = await fetch(`${this.auth.serverUrl}/Years?${query.toString()}`, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) return [];
      const data = await res.json();
      const items = data.Items || [];
      // 按年份倒序排列（新的在前）
      return items.sort((a, b) => (parseInt(b.Name, 10) || 0) - (parseInt(a.Name, 10) || 0));
    } catch (err) {
      console.warn('Failed to fetch years:', err);
      return [];
    }
  }

  /**
   * Fetch similar / recommended items (详情页"相似推荐")
   */
  async getSimilarItems(itemId, limit = 12) {
    if (!this.auth.isConfigured || !itemId) return [];
    try {
      const query = new URLSearchParams({
        userId: this.auth.userId,
        limit: String(limit),
        Fields: 'PrimaryImageAspectRatio,UserData,RunTimeTicks,ProductionYear,CommunityRating'
      });
      const res = await fetch(`${this.auth.serverUrl}/Items/${itemId}/Similar?${query.toString()}`, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.Items || [];
    } catch (err) {
      console.warn('Failed to fetch similar items:', err);
      return [];
    }
  }

  /**
   * Fetch resumable (partially watched) items (继续观看)
   */
  async getResumeItems(parentId = '', limit = 30) {
    if (!this.auth.isConfigured) return [];
    try {
      const query = new URLSearchParams({
        Recursive: 'true',
        Limit: String(limit),
        MediaTypes: 'Video',
        Fields: 'PrimaryImageAspectRatio,UserData,RunTimeTicks,ProductionYear,CommunityRating,DateCreated,SeriesName,ParentIndexNumber,IndexNumber'
      });
      if (parentId && parentId !== 'all') {
        query.set('ParentId', parentId);
      }
      const res = await fetch(`${this.auth.serverUrl}/Users/${this.auth.userId}/Items/Resume?${query.toString()}`, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.Items || [];
    } catch (err) {
      console.warn('Failed to fetch resume items:', err);
      return [];
    }
  }

  /**
   * Fetch played items sorted by last play date (观看历史)
   */
  async getPlayedHistory(parentId = '', startIndex = 0, limit = 100) {
    if (!this.auth.isConfigured) return [];
    try {
      const query = new URLSearchParams({
        IncludeItemTypes: 'Movie,Episode,Video',
        Recursive: 'true',
        Filters: 'IsPlayed',
        SortBy: 'DatePlayed',
        SortOrder: 'Descending',
        StartIndex: String(startIndex),
        Limit: String(limit),
        Fields: 'PrimaryImageAspectRatio,UserData,RunTimeTicks,ProductionYear,CommunityRating,SeriesName,ParentIndexNumber,IndexNumber'
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
      console.warn('Failed to fetch played history:', err);
      return [];
    }
  }

  /**
   * Fetch episodes of a series sorted by season/episode (剧集连播)
   */
  async getEpisodes(seriesId) {
    if (!this.auth.isConfigured || !seriesId) return [];
    try {
      const query = new URLSearchParams({
        userId: this.auth.userId,
        Fields: 'PrimaryImageAspectRatio,UserData,RunTimeTicks,SeriesName,ParentIndexNumber,IndexNumber',
        SortBy: 'ParentIndexNumber,IndexNumber',
        SortOrder: 'Ascending'
      });
      const res = await fetch(`${this.auth.serverUrl}/Shows/${seriesId}/Episodes?${query.toString()}`, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.Items || [];
    } catch (err) {
      console.warn('Failed to fetch episodes:', err);
      return [];
    }
  }

  /**
   * Fetch next-up episodes (NextUp 视图)
   */
  async getNextUp(parentId = '', limit = 50) {
    if (!this.auth.isConfigured) return [];
    try {
      const query = new URLSearchParams({
        userId: this.auth.userId,
        Limit: String(limit),
        Fields: 'PrimaryImageAspectRatio,UserData,RunTimeTicks,ProductionYear,CommunityRating,SeriesName,ParentIndexNumber,IndexNumber'
      });
      if (parentId && parentId !== 'all') {
        query.set('ParentId', parentId);
      }
      const res = await fetch(`${this.auth.serverUrl}/Shows/NextUp?${query.toString()}`, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.Items || [];
    } catch (err) {
      console.warn('Failed to fetch next-up episodes:', err);
      return [];
    }
  }
}

export const jellyfin = new JellyfinClient();
