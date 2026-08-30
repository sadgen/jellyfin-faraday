import { describe, it, expect } from 'vitest';
import { detectVrVideo } from '../vrDetector';

describe('vrDetector VR detection and mode resolution', () => {
  it('detects VR by explicit keyword', () => {
    expect(detectVrVideo({ Name: 'MyVideo 180_SBS.mp4' }).isVr).toBe(true);
    expect(detectVrVideo({ Name: 'sample [VR] trip' }).isVr).toBe(true);
    expect(detectVrVideo({ Name: 'beach 360_TB tour' }).isVr).toBe(true);
  });

  it('detects VR by 1:1 square dimensions even without keywords (regression: dead condition)', () => {
    const item = {
      Name: 'Just a square video',
      MediaStreams: [{ Type: 'Video', Width: 2880, Height: 2880 }]
    };
    expect(detectVrVideo(item).isVr).toBe(true);
  });

  it('detects 2:1 high resolution as VR without keywords', () => {
    const item = {
      Name: 'wide angle clip',
      MediaStreams: [{ Type: 'Video', Width: 5760, Height: 2880 }]
    };
    expect(detectVrVideo(item).isVr).toBe(true);
  });

  it('does not detect normal 16:9 video as VR', () => {
    const item = {
      Name: 'Normal Movie',
      MediaStreams: [{ Type: 'Video', Width: 1920, Height: 1080 }]
    };
    expect(detectVrVideo(item).isVr).toBe(false);
  });

  it('resolves 360 TB mode from keywords', () => {
    const res = detectVrVideo({ Name: 'video 360_TB' });
    expect(res.isVr).toBe(true);
    expect(res.mode).toBe('360_3d_tb');
  });
});
