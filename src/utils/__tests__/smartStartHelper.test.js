import { describe, it, expect } from 'vitest';
import { calculateSmartStartTime } from '../smartStartHelper';

describe('calculateSmartStartTime', () => {
  it('respects explicit startSecond = 0 (play from beginning)', () => {
    const item = {
      Id: 'test-1',
      RunTimeTicks: 36000000000, // 3600s
      UserData: { PlaybackPositionTicks: 12000000000 }
    };
    const res = calculateSmartStartTime(item, {
      explicitStartSecond: 0,
      smartStartEnabled: true
    });
    expect(res).toBe(0);
  });

  it('respects explicit positive startSecond', () => {
    const item = {
      Id: 'test-2',
      RunTimeTicks: 36000000000,
      UserData: { PlaybackPositionTicks: 5000000000 }
    };
    const res = calculateSmartStartTime(item, {
      explicitStartSecond: 150,
      smartStartEnabled: true
    });
    expect(res).toBe(150);
  });

  it('resumes from Jellyfin server PlaybackPositionTicks when no explicit seek provided', () => {
    const item = {
      Id: 'test-3',
      RunTimeTicks: 36000000000,
      UserData: { PlaybackPositionTicks: 4500000000 } // 450 seconds
    };
    const res = calculateSmartStartTime(item, {
      smartStartEnabled: true
    });
    expect(res).toBe(450);
  });

  it('returns 0 if smartStartEnabled is false and no resume/explicit seek', () => {
    const item = {
      Id: 'test-4',
      RunTimeTicks: 36000000000
    };
    const res = calculateSmartStartTime(item, {
      smartStartEnabled: false
    });
    expect(res).toBe(0);
  });

  it('prioritizes Chapter 2 start time when Chapter 1 is an Intro / Opening chapter', () => {
    const item = {
      Id: 'test-5',
      RunTimeTicks: 18000000000, // 1800s (30 mins)
      Chapters: [
        { StartPositionTicks: 0, Name: 'Intro 片头' },
        { StartPositionTicks: 950000000, Name: 'Main Story 正片' } // 95s
      ]
    };
    const res = calculateSmartStartTime(item, {
      smartStartEnabled: true
    });
    expect(res).toBe(95);
  });

  it('jumps to Chapter 2 start if Chapter 2 is within reasonable intro range', () => {
    const item = {
      Id: 'test-6',
      RunTimeTicks: 24000000000, // 2400s (40 mins)
      Chapters: [
        { StartPositionTicks: 0, Name: 'Chapter 1' },
        { StartPositionTicks: 1200000000, Name: 'Chapter 2' } // 120s
      ]
    };
    const res = calculateSmartStartTime(item, {
      smartStartEnabled: true
    });
    expect(res).toBe(120);
  });

  it('calculates 25%~35% golden start point for long videos (>= 10 mins)', () => {
    const item = {
      Id: 'test-7',
      RunTimeTicks: 36000000000 // 3600s (60 mins)
    };
    const resMin = calculateSmartStartTime(item, {
      smartStartEnabled: true,
      randomFactor: 0
    });
    const resMax = calculateSmartStartTime(item, {
      smartStartEnabled: true,
      randomFactor: 1
    });

    expect(resMin).toBe(900); // 25% of 3600s
    expect(resMax).toBe(1260); // 35% of 3600s
  });

  it('calculates 10%~15% intro skip for medium-length videos (2-10 mins)', () => {
    const item = {
      Id: 'test-8',
      RunTimeTicks: 3000000000 // 300s (5 mins)
    };
    const resMin = calculateSmartStartTime(item, {
      smartStartEnabled: true,
      randomFactor: 0
    });
    const resMax = calculateSmartStartTime(item, {
      smartStartEnabled: true,
      randomFactor: 1
    });

    expect(resMin).toBe(30); // 10% of 300s
    expect(resMax).toBe(45); // 15% of 300s
  });

  it('supports duration passed explicitly when item.RunTimeTicks is absent', () => {
    const item = { Id: 'test-9' }; // No RunTimeTicks on item
    const res = calculateSmartStartTime(item, {
      smartStartEnabled: true,
      duration: 1200, // 20 mins from videoEl.duration
      randomFactor: 0
    });
    expect(res).toBe(300); // 25% of 1200s
  });

  it('starts at 0 for very short clips under 60 seconds', () => {
    const item = {
      Id: 'test-10',
      RunTimeTicks: 450000000 // 45s
    };
    const res = calculateSmartStartTime(item, {
      smartStartEnabled: true
    });
    expect(res).toBe(0);
  });
});
