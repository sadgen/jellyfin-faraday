import { describe, it, expect } from 'vitest';
import { inspectItemHealth, scanLibraryHealth } from '../healthInspector';
import { cleanMediaTitle } from '../titleCleaner';
import { extractPartInfo, stackMediaItems } from '../mediaStacking';

describe('healthInspector 损坏文件与下载中断排查', () => {
  it('正确识别下载中断的截断文件（3MB 但报 30 分钟）', () => {
    const item = {
      Id: 'bad-1',
      Name: '767113_hidana_20250819_2210_@kbjba.mp4',
      RunTimeTicks: 1800 * 10000000, // 30 分钟
      MediaSources: [{ Size: 3 * 1024 * 1024 }] // 3MB
    };
    const res = inspectItemHealth(item);
    expect(res.isHealthy).toBe(false);
    expect(res.issue).toBe('truncated');
  });

  it('正常文件判定为健康', () => {
    const normal = {
      Id: 'good-1',
      Name: 'normal_movie.mp4',
      RunTimeTicks: 1800 * 10000000,
      MediaSources: [{ Size: 1000 * 1024 * 1024 }] // 1GB
    };
    expect(inspectItemHealth(normal).isHealthy).toBe(true);
  });

  it('扫描并统计全库损坏文件', () => {
    const items = [
      { Id: '1', Name: 'good.mp4', RunTimeTicks: 600 * 10000000, MediaSources: [{ Size: 500 * 1024 * 1024 }] },
      { Id: '2', Name: 'broken_tg_clip.mp4', RunTimeTicks: 1200 * 10000000, MediaSources: [{ Size: 2 * 1024 * 1024 }] }
    ];
    const report = scanLibraryHealth(items);
    expect(report.brokenCount).toBe(1);
    expect(report.brokenItems[0].Id).toBe('2');
  });
});

describe('titleCleaner 标题净化与番号提取', () => {
  it('去除 TG 频道推广、广告标签及前缀网址', () => {
    const raw = 'masex.tv@767113_hidana_20250819_2210_@kbjba.mp4';
    const res = cleanMediaTitle(raw);
    expect(res.cleanedTitle).toBe('767113_hidana_20250819_2210');
    expect(res.isChanged).toBe(true);
  });

  it('从杂乱标题中提取标准商业番号', () => {
    const raw = '[4K中文字幕] masex.tv@ADN-799-C (破解原盘)';
    const res = cleanMediaTitle(raw);
    expect(res.extractedCode).toBe('ADN-799');
  });
});

describe('mediaStacking 自制切片智能聚合', () => {
  it('识别切片序号与分组名', () => {
    expect(extractPartInfo('vlog_part1.mp4')?.baseName).toBe('vlog');
    expect(extractPartInfo('vlog_part1.mp4')?.partIndex).toBe(1);
    expect(extractPartInfo('vacation_cd2.mkv')?.partIndex).toBe(2);
    expect(extractPartInfo('home_video_2')?.partIndex).toBe(2);
  });

  it('将多个分段聚合为单个虚拟主卡片', () => {
    const items = [
      { Id: 'p1', Name: 'trip_2024_part1.mp4', RunTimeTicks: 300 * 10000000 },
      { Id: 'p2', Name: 'trip_2024_part2.mp4', RunTimeTicks: 400 * 10000000 },
      { Id: 'other', Name: 'single_video.mp4', RunTimeTicks: 600 * 10000000 }
    ];
    const stacked = stackMediaItems(items);
    expect(stacked.length).toBe(2); // 聚合后从 3 个变成 2 个
    const group = stacked.find(it => it.isStacked);
    expect(group).toBeTruthy();
    expect(group.stackedCount).toBe(2);
    expect(group.RunTimeTicks).toBe(700 * 10000000); // 300 + 400
  });
});
