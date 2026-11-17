import { describe, it, expect } from 'vitest';
import {
  listMediaVersions,
  selectMediaSource,
  describeMediaVersion,
  formatVersionSize
} from '../mediaVersions';

// 多版本条目形态（8098「转码对比」库实测结构）：
// 主版本 MediaSource.Id == ItemId，其余版本各有独立 Id 与版本名
const playbackData = {
  MediaSources: [
    {
      Id: 'item_primary',
      Name: 'AV1-10bit',
      Container: 'mp4',
      Size: 2490809794,
      Path: '/data/xxx_aria2/transcode-compare/IPZZ-932 (LTX)/IPZZ-932 (LTX) - AV1-10bit.mp4',
      MediaStreams: [
        { Type: 'Video', Codec: 'av1', BitDepth: 10, Height: 1080 },
        { Type: 'Audio', Codec: 'aac' }
      ]
    },
    {
      Id: 'source_hevc8',
      Name: 'HEVC8',
      Container: 'mp4',
      Size: 3404537124,
      Path: '/data/xxx_aria2/transcode-compare/IPZZ-932 (LTX)/IPZZ-932 (LTX) - HEVC8.mp4',
      MediaStreams: [
        { Type: 'Video', Codec: 'hevc', BitDepth: 8, Height: 1080 },
        { Type: 'Audio', Codec: 'aac' }
      ]
    }
  ]
};

describe('listMediaVersions', () => {
  it('returns all versions in server order with duplicates removed', () => {
    const versions = listMediaVersions(playbackData, null);
    expect(versions.map(v => v.Id)).toEqual(['item_primary', 'source_hevc8']);
  });

  it('dedupes repeated source ids (playbackData overlapping item)', () => {
    const item = { Id: 'item_primary', MediaSources: playbackData.MediaSources };
    const versions = listMediaVersions(playbackData, item);
    // playbackData 优先，不因 item 重复而翻倍
    expect(versions).toHaveLength(2);
  });

  it('falls back to item.MediaSources when playbackData is absent', () => {
    const item = { Id: 'item_primary', MediaSources: playbackData.MediaSources };
    expect(listMediaVersions(null, item)).toHaveLength(2);
  });

  it('returns empty array for single-version-less items', () => {
    expect(listMediaVersions(null, { Id: 'x' })).toEqual([]);
    expect(listMediaVersions({ MediaSources: [] }, null)).toEqual([]);
  });
});

describe('selectMediaSource', () => {
  const sources = playbackData.MediaSources;

  it('selects the preferred version by id', () => {
    expect(selectMediaSource(sources, 'source_hevc8').Name).toBe('HEVC8');
  });

  it('falls back to the primary version for unknown/null preferred id', () => {
    expect(selectMediaSource(sources, 'missing').Id).toBe('item_primary');
    expect(selectMediaSource(sources, null).Id).toBe('item_primary');
  });

  it('returns null without sources', () => {
    expect(selectMediaSource([], 'x')).toBeNull();
    expect(selectMediaSource(null, 'x')).toBeNull();
  });
});

describe('describeMediaVersion', () => {
  it('prefers the server-side version name', () => {
    expect(describeMediaVersion(playbackData.MediaSources[1])).toBe('HEVC8');
  });

  it('derives a label from video stream when Name is missing', () => {
    const unlabeled = {
      Container: 'mp4',
      MediaStreams: [{ Type: 'Video', Codec: 'hevc', BitDepth: 8, Height: 1080 }]
    };
    expect(describeMediaVersion(unlabeled)).toBe('HEVC · 8bit · 1080p · MP4');
  });

  it('handles empty sources gracefully', () => {
    expect(describeMediaVersion(null)).toBe('');
    expect(describeMediaVersion({})).toBe('默认版本');
  });
});

describe('formatVersionSize', () => {
  it('formats bytes as GB with two decimals', () => {
    expect(formatVersionSize(playbackData.MediaSources[0])).toBe('2.32 GB');
    expect(formatVersionSize(playbackData.MediaSources[1])).toBe('3.17 GB');
  });

  it('returns empty string when size is missing or zero', () => {
    expect(formatVersionSize(null)).toBe('');
    expect(formatVersionSize({ Size: 0 })).toBe('');
  });
});
