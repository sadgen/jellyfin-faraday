import { describe, it, expect, beforeEach } from 'vitest';
import { getTrickplayInfo, getTrickplayStyle } from '../trickplay';
import { jellyfin } from '../../api/jellyfinClient';

describe('trickplay 竖屏 vs 横屏宽高比测试', () => {
  beforeEach(() => {
    jellyfin.auth.serverUrl = 'http://localhost:8096';
  });
  it('正确解析横屏 16:9 视频 Trickplay', () => {
    const item = {
      Id: 'item_h',
      Width: 1920,
      Height: 1080,
      MediaSources: [{
        Id: 'source_h',
        Trickplay: {
          '320': {
            Width: 320,
            Height: 180,
            TileWidth: 10,
            TileHeight: 10,
            ThumbnailCount: 100,
            Interval: 10000
          }
        }
      }]
    };

    const info = getTrickplayInfo(item);
    expect(info.hasTrickplay).toBe(true);
    expect(info.isVertical).toBe(false);
    expect(info.width).toBe(320);
    expect(info.height).toBe(180);
    expect(info.aspectRatio).toBeCloseTo(16 / 9, 2);

    const style = getTrickplayStyle(item, 25);
    expect(style).not.toBeNull();
    expect(style.aspectRatio).toBeDefined();
  });

  it('正确解析竖屏 9:16 视频 Trickplay 并标记为竖屏', () => {
    const item = {
      Id: 'item_v',
      Width: 720,
      Height: 1280,
      PrimaryImageAspectRatio: 0.5625,
      MediaSources: [{
        Id: 'source_v',
        Trickplay: {
          '320': {
            Width: 320,
            Height: 568,
            TileWidth: 10,
            TileHeight: 10,
            ThumbnailCount: 100,
            Interval: 10000
          }
        }
      }]
    };

    const info = getTrickplayInfo(item);
    expect(info.hasTrickplay).toBe(true);
    expect(info.isVertical).toBe(true);
    expect(info.width).toBe(320);
    expect(info.height).toBe(568);
    expect(info.aspectRatio).toBeCloseTo(9 / 16, 2);

    const style = getTrickplayStyle(item, 25);
    expect(style).not.toBeNull();
    expect(style.aspectRatio).toBeDefined();
  });

  it('在无 Trickplay 清单时根据条目宽高推断竖屏与比例', () => {
    const item = {
      Id: 'item_no_tp',
      Width: 720,
      Height: 1280
    };

    const info = getTrickplayInfo(item);
    expect(info.hasTrickplay).toBe(false);
    expect(info.isVertical).toBe(true);
    expect(info.aspectRatio).toBeCloseTo(720 / 1280, 2);
  });
});
