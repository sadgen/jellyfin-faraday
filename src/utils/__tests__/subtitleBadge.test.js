import { describe, it, expect } from 'vitest';
import { getSubtitleBadge } from '../subtitleBadge';

const mk = (name, extra = {}) => ({
  Name: name,
  Path: `/media/lib/${name}.mp4`,
  ...extra,
});

describe('getSubtitleBadge 组合规则', () => {
  it('LTX → L / LC（有无字幕流决定）', () => {
    expect(getSubtitleBadge(mk('PPPE-447-LTX')).label).toBe('L');
    expect(getSubtitleBadge(mk('SSNI-865-LTX', { HasSubtitles: true })).label).toBe('LC');
    expect(
      getSubtitleBadge(mk('MIDV-530-LTX', { MediaStreams: [{ Type: 'Subtitle', IsExternal: true }] })).label
    ).toBe('LC');
  });

  it('U / UC：无码前缀', () => {
    expect(getSubtitleBadge(mk('ABC-123-U')).label).toBe('U');
    expect(getSubtitleBadge(mk('ABC-123-UC')).label).toBe('UC'); // UC 同时给出 U 前缀与硬字幕 C
  });

  it('硬字幕：-C / -ch / glued ch', () => {
    expect(getSubtitleBadge(mk('ABC-123-C')).label).toBe('C');
    expect(getSubtitleBadge(mk('ABC-123-ch')).label).toBe('C');
    expect(getSubtitleBadge(mk('MIKR-089ch')).label).toBe('C');
  });

  it('软字幕：字幕流存在即 C（本库有字幕流=中字）', () => {
    expect(getSubtitleBadge(mk('ABC-123', { HasSubtitles: true })).label).toBe('C');
    expect(
      getSubtitleBadge(mk('ABC-123', { MediaStreams: [{ Type: 'Video' }, { Type: 'Subtitle' }] })).label
    ).toBe('C');
  });

  it('生肉 → Raw', () => {
    expect(getSubtitleBadge(mk('ABC-123')).label).toBe('Raw');
    expect(getSubtitleBadge(mk('FC2-PPV-1234567')).label).toBe('Raw');
  });

  it('非番号条目 → null（普通影视库不误报）', () => {
    expect(getSubtitleBadge(mk('三大队 2023', { HasSubtitles: true }))).toBeNull();
    expect(getSubtitleBadge(mk('Inception 2010', { HasSubtitles: true }))).toBeNull();
    expect(getSubtitleBadge(mk('桃花映江山 S01E02', { HasSubtitles: true }))).toBeNull();
    expect(getSubtitleBadge(null)).toBeNull();
    expect(getSubtitleBadge({})).toBeNull();
  });

  it('判定以 Path 文件名为准（刮削 Name 不带后缀也不影响）', () => {
    expect(
      getSubtitleBadge({ Name: 'ABC-123 漂亮的标题文字', Path: '/x/y/ABC-123-C.mp4' }).label
    ).toBe('C');
    // 无 Path 时退回 Name
    expect(getSubtitleBadge({ Name: 'ABC-123-UC' }).label).toBe('UC');
  });

  it('MediaStreams 为空数组 / HasSubtitles 缺省不算有字幕', () => {
    expect(getSubtitleBadge(mk('ABC-123', { MediaStreams: [] }))).toEqual({ label: 'Raw' });
    expect(getSubtitleBadge(mk('ABC-123-LTX', { MediaStreams: [], HasSubtitles: false })).label).toBe('L');
  });
});
