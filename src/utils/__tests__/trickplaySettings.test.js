import { describe, it, expect, beforeEach } from 'vitest';
import { getAutoTrickplayEnabled, setAutoTrickplayEnabled } from '../trickplaySettings';

describe('悬停自动加载 Trickplay 开关', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('未设置时默认开启（保持既有行为）', () => {
    expect(getAutoTrickplayEnabled()).toBe(true);
  });

  it('关闭后写入 0，重新读取仍为关闭', () => {
    setAutoTrickplayEnabled(false);
    expect(localStorage.getItem('faraday_auto_trickplay')).toBe('0');
    expect(getAutoTrickplayEnabled()).toBe(false);
  });

  it('重新开启后写入 1，读取为开启', () => {
    setAutoTrickplayEnabled(false);
    setAutoTrickplayEnabled(true);
    expect(localStorage.getItem('faraday_auto_trickplay')).toBe('1');
    expect(getAutoTrickplayEnabled()).toBe(true);
  });

  it('只认显式关闭值，其它脏数据一律按开启处理', () => {
    for (const v of ['', '1', 'true', 'garbage']) {
      localStorage.setItem('faraday_auto_trickplay', v);
      expect(getAutoTrickplayEnabled()).toBe(true);
    }
  });
});
