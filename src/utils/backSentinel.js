/**
 * 全局返回哨兵协调器：手机返回键/返回手势逐层关闭浮层（多选批量栏、操作面板）而非退出页面。
 *
 * 与 App 浮窗哨兵的共存约定：
 * - 多选层激活期间 LibraryView 置 window.__faradayLayerActive = true，
 *   浮窗 onPopState 见此标志让出后退（后退优先关多选层）；
 * - 任何一方主动关闭（UI 按钮/手势）消费历史前必须 suppressPopOnce()，
 *   避免对方的 popstate 监听把程序性后退误判为用户后退。
 */

const layerStack = []; // { onPop }
let suppressNext = false;

/** 压入一层浮层哨兵（同 URL 历史态），onPop 在用户后退触发时执行 */
export function pushSentinel(onPop) {
  layerStack.push({ onPop });
  try {
    window.history.pushState({ faradayLayer: layerStack.length }, '');
  } catch {
    layerStack.pop();
  }
}

/** UI 主动关闭时消费对应历史条目（下一次 popstate 为程序性后退，协调器忽略） */
export function consumeSentinel() {
  if (!layerStack.length) return;
  layerStack.pop();
  suppressNext = true;
  try {
    window.history.go(-1);
  } catch {
    suppressNext = false;
  }
}

/** 供外部（浮窗哨兵）在主动 history.go 前调用，防止协调器误消费 */
export function suppressPopOnce() {
  suppressNext = true;
}

export function sentinelDepth() {
  return layerStack.length;
}

if (typeof window !== 'undefined' && !window.__faradaySentinelInstalled) {
  window.__faradaySentinelInstalled = true;
  window.addEventListener('popstate', () => {
    if (suppressNext) {
      suppressNext = false;
      return;
    }
    const top = layerStack.pop();
    if (top && typeof top.onPop === 'function') {
      try {
        top.onPop();
      } catch {
        // ignore
      }
    }
  });
}
