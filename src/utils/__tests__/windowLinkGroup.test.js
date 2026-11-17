import { describe, it, expect } from 'vitest';
import {
  createLinkGroup,
  toggleLinkMembership,
  relayRelativeSeek,
  relayPlayPause
} from '../windowLinkGroup';

describe('windowLinkGroup（浮窗 N 窗链接组）', () => {
  it('第一个窗加入：成为基准窗，不产生任何命令', () => {
    const g = toggleLinkMembership(null, 'winA');
    expect(g.ids).toEqual(['winA']);
    expect(g.seekCmds).toEqual({});
    expect(g.playCmds).toEqual({});
  });

  it('第二个窗加入且基准窗位置可读：直接对齐到基准窗进度（absolute seek, reason=join）', () => {
    let g = toggleLinkMembership(null, 'winA');
    g = toggleLinkMembership(g, 'winB', 371.5);
    expect(g.ids).toEqual(['winA', 'winB']);
    expect(g.seekCmds.winB).toMatchObject({ seq: 1, from: 0, to: 371.5, mode: 'absolute', reason: 'join' });
    expect(g.seekSeq).toBe(1);
  });

  it('第三个窗加入：同样对齐到基准窗（第一个）进度，前窗不被新命令打扰', () => {
    let g = toggleLinkMembership(null, 'winA');
    g = toggleLinkMembership(g, 'winB', 100);
    g = toggleLinkMembership(g, 'winC', 200); // 基准恒为 winA；winB 位置不是基准
    expect(g.ids).toEqual(['winA', 'winB', 'winC']);
    expect(g.seekCmds.winC.to).toBe(200);
    expect(g.seekCmds.winA).toBeUndefined();
    expect(g.seekCmds.winB).toMatchObject({ seq: 1, to: 100 }); // 保留各自加入时的命令（已被接收方消费）
  });

  it('基准窗位置不可读（尚未上报）时加入：不产生 seek 命令，链接仍建立', () => {
    let g = toggleLinkMembership(null, 'winA');
    g = toggleLinkMembership(g, 'winB', null);
    expect(g.ids).toEqual(['winA', 'winB']);
    expect(g.seekCmds).toEqual({});
  });

  it('再次点击 = 退出链接组：组收缩且不惊扰其余成员', () => {
    let g = toggleLinkMembership(null, 'winA');
    g = toggleLinkMembership(g, 'winB', 50);
    g = toggleLinkMembership(g, 'winB');
    expect(g.ids).toEqual(['winA']);
    expect(g.seekCmds.winA).toBeUndefined();
  });

  it('最后一个窗退出：链接组散（null）', () => {
    let g = toggleLinkMembership(null, 'winA');
    expect(toggleLinkMembership(g, 'winA')).toBeNull();
  });

  it('相对 seek 中继：来源窗以外全员收到，各自按本窗位置平移同一 delta', () => {
    let g = toggleLinkMembership(null, 'winA');
    g = toggleLinkMembership(g, 'winB', 0);
    g = toggleLinkMembership(g, 'winC', 0);
    g = relayRelativeSeek(g, 'winB', 100, 115);
    expect(g.seekSeq).toBe(3); // 两次 join 各占一个 seq
    const a = g.seekCmds.winA;
    const c = g.seekCmds.winC;
    expect(a.seq).toBe(3);
    expect(c.seq).toBe(3);
    expect(a.to - a.from).toBe(15);
    expect(c.to - c.from).toBe(15);
    expect(g.seekCmds.winB).toMatchObject({ seq: 1, to: 0 }); // 来源窗不被中继覆盖，保留加入时的对齐命令
  });

  it('非成员来源的 seek 不中继', () => {
    let g = toggleLinkMembership(null, 'winA');
    expect(relayRelativeSeek(g, 'winX', 0, 10)).toBe(g);
    expect(relayRelativeSeek(null, 'winX', 0, 10)).toBeNull();
  });

  it('播放/暂停中继：来源窗以外全员同 seq 命令', () => {
    let g = toggleLinkMembership(null, 'winA');
    g = toggleLinkMembership(g, 'winB', 0);
    g = relayPlayPause(g, 'winA', true);
    expect(g.playCmds.winB).toMatchObject({ seq: 1, paused: true });
    expect(g.playCmds.winA).toBeUndefined();
    g = relayPlayPause(g, 'winB', false);
    expect(g.playCmds.winA).toMatchObject({ seq: 2, paused: false });
    expect(g.playCmds.winB).toMatchObject({ seq: 1, paused: true }); // 来源窗不被自身命令覆盖
  });

  it('null/空态安全', () => {
    let g = createLinkGroup();
    expect(g.ids).toEqual([]);
    g = relayRelativeSeek(g, 'winA', 0, 5);
    expect(g.seekCmds).toEqual({});
  });
});
