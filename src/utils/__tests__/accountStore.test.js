import { describe, it, expect, beforeEach } from 'vitest';
import { getSavedAccounts, saveAccount, removeAccount } from '../accountStore';

describe('accountStore multi-account persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves, dedupes and puts most-recent login first', () => {
    saveAccount({ serverUrl: 'http://a', token: 't1', userId: 'u1', username: 'A' });
    saveAccount({ serverUrl: 'http://b', token: 't2', userId: 'u2', username: 'B' });
    saveAccount({ serverUrl: 'http://a', token: 't1b', userId: 'u1', username: 'A2' });

    const accounts = getSavedAccounts();
    expect(accounts).toHaveLength(2);
    expect(accounts[0].username).toBe('A2');
    expect(accounts[0].token).toBe('t1b');
    expect(accounts[1].username).toBe('B');
  });

  it('removes an account by serverUrl + userId', () => {
    saveAccount({ serverUrl: 'http://a', token: 't1', userId: 'u1', username: 'A' });
    saveAccount({ serverUrl: 'http://a', token: 't2', userId: 'u2', username: 'B' });
    removeAccount('http://a', 'u1');
    const accounts = getSavedAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].userId).toBe('u2');
  });

  it('ignores incomplete auth data', () => {
    saveAccount({ serverUrl: 'http://a', token: '', userId: 'u1' });
    saveAccount({ serverUrl: '', token: 't', userId: 'u1' });
    saveAccount(null);
    expect(getSavedAccounts()).toHaveLength(0);
  });
});
