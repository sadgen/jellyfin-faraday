/**
 * 多账号管理（localStorage 持久化）
 * 保存多个 { serverUrl, token, userId, username } 凭据，支持一键切换。
 * 媒体缓存已按 服务器+用户 物理隔离（IndexedDB），切换账号后无需迁移数据。
 */

const ACCOUNTS_KEY = 'jf_faraday_accounts';

export function getSavedAccounts() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(a => a?.serverUrl && a?.token && a?.userId) : [];
  } catch {
    return [];
  }
}

export function saveAccount(auth) {
  if (!auth?.serverUrl || !auth?.token || !auth?.userId) return getSavedAccounts();
  const accounts = getSavedAccounts().filter(
    a => !(a.serverUrl === auth.serverUrl && a.userId === auth.userId)
  );
  accounts.unshift({
    serverUrl: auth.serverUrl,
    token: auth.token,
    userId: auth.userId,
    username: auth.username || auth.userId,
    savedAt: Date.now()
  });
  // 最多保留 8 个账号
  const trimmed = accounts.slice(0, 8);
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore storage errors
  }
  return trimmed;
}

export function removeAccount(serverUrl, userId) {
  const accounts = getSavedAccounts().filter(
    a => !(a.serverUrl === serverUrl && a.userId === userId)
  );
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // ignore storage errors
  }
  return accounts;
}
