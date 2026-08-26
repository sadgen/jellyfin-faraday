import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JellyfinClient } from '../jellyfinClient';

describe('JellyfinClient authentication and URL generation', () => {
  let client;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    client = new JellyfinClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sanitizes valid HTTP/HTTPS URLs and rejects invalid protocols', () => {
    expect(client.sanitizeServerUrl('http://192.168.1.100:8096///')).toBe('http://192.168.1.100:8096');
    expect(client.sanitizeServerUrl('https://jellyfin.example.com')).toBe('https://jellyfin.example.com');
    expect(client.sanitizeServerUrl('jellyfin.local:8096')).toBe('http://jellyfin.local:8096');

    expect(() => client.sanitizeServerUrl('javascript:alert(1)')).toThrow();
    expect(() => client.sanitizeServerUrl('file:///etc/passwd')).toThrow();
  });

  it('includes api_key query param in getImageUrl when authenticated', () => {
    client.auth = {
      serverUrl: 'https://jellyfin.example.com',
      token: 'secret_token_123',
      userId: 'user_1',
      isConfigured: true
    };

    const url = client.getImageUrl('item_999', 'tag_abc', 'Primary', 360, 80);
    expect(url).toContain('https://jellyfin.example.com/Items/item_999/Images/Primary');
    expect(url).toContain('tag=tag_abc');
    expect(url).toContain('api_key=secret_token_123');
  });

  it('handles rememberMe option (localStorage vs sessionStorage)', () => {
    // 1. rememberMe = true (default)
    client.saveAuth({
      serverUrl: 'https://jellyfin.example.com',
      token: 'token_local',
      userId: 'user_local',
      username: 'Alice'
    }, true);

    expect(localStorage.getItem('jellyfin_faraday_auth')).toBeTruthy();
    expect(sessionStorage.getItem('jellyfin_faraday_auth')).toBeNull();

    // 2. rememberMe = false (session only)
    client.saveAuth({
      serverUrl: 'https://jellyfin.example.com',
      token: 'token_session',
      userId: 'user_session',
      username: 'Bob'
    }, false);

    expect(sessionStorage.getItem('jellyfin_faraday_auth')).toBeTruthy();
    expect(localStorage.getItem('jellyfin_faraday_auth')).toBeNull();

    // 3. clearAuth clears both
    client.clearAuth();
    expect(localStorage.getItem('jellyfin_faraday_auth')).toBeNull();
    expect(sessionStorage.getItem('jellyfin_faraday_auth')).toBeNull();
    expect(client.auth.isConfigured).toBe(false);
  });

  it('rejects favorite updates when the server returns an error', async () => {
    client.auth = {
      serverUrl: 'https://jellyfin.example.com',
      token: 'secret_token_123',
      userId: 'user_1',
      isConfigured: true
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    await expect(client.toggleFavorite('item_999', true)).rejects.toThrow('HTTP 403');
  });
});
