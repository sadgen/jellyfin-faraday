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
// 「关旧层 + 开新层」同批发生时的历史态交接（2026-11-19 手机实测定罪）：
// 浏览器 go(-1) 是异步的，若同批又 pushState，pending 的那次后退会把新层刚压入的
// 历史条目吃掉（Chrome 实测：select push → go(-1) → detail push，popstate 却落在
// 最初的 null 历史上），下一次后退直接离开网页。交接模式下 consume 不 go(-1)、
// push 不再 pushState，旧层那条历史态原样转给新层。
let handoffRequested = false; // 调用方预告：即将关旧层并开新层
let handoffPending = false;   // 旧层已让出历史态，等新层接管

/** 关旧层 + 开新层同批时，在关层动作之前调用（如 ⋮ 面板里的「详情」按钮） */
export function prepareSentinelHandoff() {
  handoffRequested = true;
}

/** 压入一层浮层哨兵（同 URL 历史态），onPop 在用户后退触发时执行 */
export function pushSentinel(onPop) {
  layerStack.push({ onPop });
  if (handoffPending) {
    // 复用上一层的历史态，不新增条目——避免异步 go(-1) 冲掉它
    handoffPending = false;
    return;
  }
  handoffRequested = false; // 无旧层可交接时兜底清理
  try {
    window.history.pushState({ faradayLayer: layerStack.length }, '');
  } catch {
    layerStack.pop();
  }
}

/** UI 主动关闭时消费对应历史条目（下一次 popstate 为程序性后退，协调器忽略） */
export function consumeSentinel() {
  if (!layerStack.length) {
    handoffRequested = false;
    return;
  }
  layerStack.pop();
  if (handoffRequested) {
    handoffRequested = false;
    handoffPending = true; // 历史态留给随后 pushSentinel 的新层
    return;
  }
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
      // 通知浮窗后退处理器同样忽略本次程序性 pop（App 的 onPopState 是独立监听，
      // 不吞会误判为用户后退：多选清场+开双窗联动时 popstate 落在开窗之后，
      // 把刚开的最新窗关掉 = 「联动只打开一个窗口」的根因，2026-11-10）
      window.__faradaySuppressWinPopOnce = true;
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
