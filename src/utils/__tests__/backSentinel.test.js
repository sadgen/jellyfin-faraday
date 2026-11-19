import { describe, it, expect, vi, beforeEach } from 'vitest';

// 「关旧层 + 开新层」同批时（手机 ⋮ 面板点「详情/相似推荐」）的历史态交接。
// 真实浏览器 go(-1) 异步：若同批又 pushState，pending 后退会吃掉新层的历史条目，
// 下一次后退直接离开网页。交接模式要求：consume 不 go(-1)、push 不再 pushState。
describe('backSentinel handoff', () => {
  beforeEach(() => {
    vi.resetModules();
    window.__faradaySentinelInstalled = false;
  });

  it('交接时复用旧层历史态，既不 go(-1) 也不 pushState', async () => {
    const goSpy = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    const pushSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    const m = await import('../backSentinel.js');

    // ⋮ 面板打开：正常压入一层历史态
    m.pushSentinel(() => {});
    expect(pushSpy).toHaveBeenCalledTimes(1);

    // 同批：面板关闭（交接）+ 详情打开（复用那条历史态）
    m.prepareSentinelHandoff();
    m.consumeSentinel();
    m.pushSentinel(() => {});

    expect(goSpy).not.toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(m.sentinelDepth()).toBe(1);

    goSpy.mockRestore();
    pushSpy.mockRestore();
  });

  it('普通关闭仍执行 go(-1) 消费历史态', async () => {
    const goSpy = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    const m = await import('../backSentinel.js');

    m.pushSentinel(() => {});
    m.consumeSentinel();

    expect(goSpy).toHaveBeenCalledWith(-1);
    expect(m.sentinelDepth()).toBe(0);

    goSpy.mockRestore();
  });
});
