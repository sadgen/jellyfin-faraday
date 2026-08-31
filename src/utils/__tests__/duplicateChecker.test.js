import { describe, it, expect } from 'vitest';
import {
  hasIdentifiedMetadata,
  extractCleanFileName,
  getItemDuplicateKey,
  detectDuplicateMedia
} from '../duplicateChecker';

describe('duplicateChecker 自制视频 vs 已识别视频查重逻辑', () => {
  it('正确探测是否已识别元数据', () => {
    // 1. 带有 ProviderIds 的电影/剧集
    expect(hasIdentifiedMetadata({ Name: 'Inception', ProviderIds: { Tmdb: '27205' } })).toBe(true);
    expect(hasIdentifiedMetadata({ Name: 'Some Show', ProviderIds: { Imdb: 'tt1234567' } })).toBe(true);

    // 2. 自制视频（无 ProviderIds，无丰富刮削信息）
    expect(hasIdentifiedMetadata({ Name: '767113_hidana_20250819_2210_@kbjba.mp4' })).toBe(false);
    expect(hasIdentifiedMetadata({ Name: 'vlog_trip_2024.mp4', ProviderIds: {} })).toBe(false);
  });

  it('提取纯净文件名', () => {
    expect(extractCleanFileName({ Path: '/data/vids/my_home_video_part1.mp4' })).toBe('my_home_video_part1');
    expect(extractCleanFileName({ Name: '767113_hidana_20250819_2210_@kbjba.MP4' })).toBe('767113_hidana_20250819_2210_@kbjba');
  });

  it('未识别元数据的自制视频：必须完整文件名一致才算重复，不同时间/编号的自制片段不误判', () => {
    const videoA = { Id: '1', Name: '767113_hidana_20250819_2210_@kbjba.mp4', Path: '/a/767113_hidana_20250819_2210_@kbjba.mp4' };
    const videoB = { Id: '2', Name: '767277_hidana_20250819_2240_@kbjba.mp4', Path: '/a/767277_hidana_20250819_2240_@kbjba.mp4' };
    const videoACopy = { Id: '3', Name: '767113_hidana_20250819_2210_@kbjba.mp4', Path: '/b/767113_hidana_20250819_2210_@kbjba.mp4' };

    // videoA 和 videoB 文件名不同，不应视为重复
    expect(getItemDuplicateKey(videoA)).not.toBe(getItemDuplicateKey(videoB));

    // videoA 和 videoACopy 完整文件名一致，判定为重复
    expect(getItemDuplicateKey(videoA)).toBe(getItemDuplicateKey(videoACopy));

    const res = detectDuplicateMedia([videoA, videoB, videoACopy]);
    expect(res.duplicateCount).toBe(2);
    expect(Array.from(res.duplicateItemIds)).toEqual(['1', '3']);
  });

  it('已识别元数据的商业/番号影片：自动提取番号并去除 -C, [4K], 中文字幕 等标签去重', () => {
    const item1 = { Id: '10', Name: 'ABC-123 [4K] [中文字幕]', ProviderIds: { Tmdb: '999' } };
    const item2 = { Id: '20', Name: 'ABC-123-C', ProviderIds: { Tmdb: '999' } };

    // ProviderId 一致
    expect(getItemDuplicateKey(item1)).toBe('tmdb:999');
    expect(getItemDuplicateKey(item2)).toBe('tmdb:999');

    const res = detectDuplicateMedia([item1, item2]);
    expect(res.duplicateCount).toBe(2);
    expect(res.duplicateItemIds.has('10')).toBe(true);
    expect(res.duplicateItemIds.has('20')).toBe(true);
  });

  it('已识别番号但无 ProviderId：依然能靠番号格式 ABC-123 智能匹配', () => {
    const item1 = { Id: '31', Name: 'SSIS-888 中文字幕' };
    const item2 = { Id: '32', Name: 'SSIS-888-UC' };

    expect(getItemDuplicateKey(item1)).toBe('strict_code:SSIS-888');
    expect(getItemDuplicateKey(item2)).toBe('strict_code:SSIS-888');

    const res = detectDuplicateMedia([item1, item2]);
    expect(res.duplicateCount).toBe(2);
  });
});
