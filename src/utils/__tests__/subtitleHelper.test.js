import { describe, it, expect } from 'vitest';
import { hasHardcodedChineseSubtitles, getDefaultSubtitleIndex, detectChineseVariant } from '../subtitleHelper';

describe('subtitleHelper hardsub detection and stream selection', () => {
  it('detects hardcoded Chinese subtitles by file name suffix (-C, _C, [C], (C), -UC, _UC, etc.)', () => {
    expect(hasHardcodedChineseSubtitles({ Name: 'FC2-PPV-123456-C' })).toBe(true);
    expect(hasHardcodedChineseSubtitles({ Path: '/videos/MIDE-123_C.mp4' })).toBe(true);
    expect(hasHardcodedChineseSubtitles({ FileName: 'STARS-999 C.mkv' })).toBe(true);
    expect(hasHardcodedChineseSubtitles({ Name: 'ABP-456[C]' })).toBe(true);
    expect(hasHardcodedChineseSubtitles({ Name: 'SSIS-789(C)' })).toBe(true);
    expect(hasHardcodedChineseSubtitles({ Name: 'IPX-001-UC' })).toBe(true);
    expect(hasHardcodedChineseSubtitles({ Name: 'JUL-111_UC' })).toBe(true);
    expect(hasHardcodedChineseSubtitles({ Name: 'STARS-888[UC]' })).toBe(true);
    expect(hasHardcodedChineseSubtitles({ Name: 'STARS-888(UC)' })).toBe(true);
  });

  it('detects hardcoded subtitles by keyword', () => {
    expect(hasHardcodedChineseSubtitles({ Name: '某某视频 中文字幕 1080p' })).toBe(true);
    expect(hasHardcodedChineseSubtitles({ Name: '某某视频 内嵌中字' })).toBe(true);
    expect(hasHardcodedChineseSubtitles({ Name: '某某视频 硬字幕版' })).toBe(true);
  });

  it('returns false for items without hardcoded Chinese subtitles', () => {
    expect(hasHardcodedChineseSubtitles({ Name: 'FC2-PPV-123456' })).toBe(false);
    expect(hasHardcodedChineseSubtitles({ Path: '/videos/MIDE-123.mp4' })).toBe(false);
    expect(hasHardcodedChineseSubtitles({ Name: 'Captain America (2011)' })).toBe(false);
  });

  it('returns -1 for default subtitle index when hardsub is present', () => {
    const item = { Name: 'FC2-PPV-123456-C' };
    const streams = [
      { Index: 1, Type: 'Subtitle', Language: 'chi', Title: 'Chinese' },
      { Index: 2, Type: 'Subtitle', Language: 'eng', Title: 'English' }
    ];
    expect(getDefaultSubtitleIndex(item, streams)).toBe(-1);
  });

  it('selects Chinese/default subtitle when hardsub is not present', () => {
    const item = { Name: 'FC2-PPV-123456' };
    const streams = [
      { Index: 1, Type: 'Subtitle', Language: 'eng', Title: 'English' },
      { Index: 2, Type: 'Subtitle', Language: 'chi', Title: 'Chinese', IsDefault: true }
    ];
    expect(getDefaultSubtitleIndex(item, streams)).toBe(2);
  });
});

describe('detectChineseVariant simplified/traditional detection', () => {
  it('detects simplified from title or path markers', () => {
    expect(detectChineseVariant({ Title: 'Chs/SUP  简体', Language: 'zho' })).toBe('简');
    expect(detectChineseVariant({ Title: '简体中文', Language: 'zho' })).toBe('简');
    expect(detectChineseVariant({ Title: 'zh-cn', Language: 'zho' })).toBe('简');
    expect(detectChineseVariant({ Path: '/movies/movie.chi.zh-cn.ass', Language: 'zho' })).toBe('简');
  });

  it('detects traditional from title or path markers', () => {
    expect(detectChineseVariant({ Title: 'Cht/SUP  繁体', Language: 'zho' })).toBe('繁');
    expect(detectChineseVariant({ Title: '繁体中文', Language: 'zho' })).toBe('繁');
    expect(detectChineseVariant({ Path: '/movies/movie.cht.big5.srt', Language: 'zho' })).toBe('繁');
  });

  it('returns null when variant cannot be determined', () => {
    expect(detectChineseVariant({ Title: '', Language: 'zho' })).toBe(null);
    expect(detectChineseVariant({ Title: 'English', Language: 'eng' })).toBe(null);
    expect(detectChineseVariant(null)).toBe(null);
  });

  it('does not misfire on release names containing GBR', () => {
    expect(detectChineseVariant({ Title: 'Fight.Back.to.School.1991.GBR.BluRay', Language: 'zho' })).toBe(null);
  });
});
