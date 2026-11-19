/**
 * 悬停自动加载 Trickplay 开关（默认开启，保持既有行为）
 *
 * 关闭后：鼠标移到海报/缩略图上不再触发预览窗与雪碧图加载（getTrickplayStyle
 * 不会被调用，零网络请求）。右键自动预览、右下角「框内 trickplay」按钮、
 * 手机触摸擦洗等显式操作不受影响——本开关只管「鼠标移动即加载」这一条路径。
 */

const STORAGE_KEY = 'faraday_auto_trickplay';

export function getAutoTrickplayEnabled() {
  if (typeof window === 'undefined') return true;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // 只有显式写入 '0' / 'false' 才关闭，其余（含未设置）一律开启
    return stored !== '0' && stored !== 'false';
  } catch {
    return true;
  }
}

export function setAutoTrickplayEnabled(enabled) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // 隐私模式下 localStorage 可能不可写，忽略即可（本次会话仍按内存态走）
  }
  if (typeof window.CustomEvent === 'function') {
    window.dispatchEvent(new window.CustomEvent('faraday:auto_trickplay_changed', { detail: !!enabled }));
  }
}
