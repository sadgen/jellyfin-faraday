/**
 * 桌面壳（desktop-faraday v0.4+）图片缓存通道。
 *
 * 壳内页面跑在 app:// 内部协议上：API/视频直连真实服务器，图片类 URL 由这里
 * 改写为 faraday-img://img/<host:port><原路径>，主进程查磁盘缓存命中直接回盘、
 * 未命中回源并落盘。图片不进浏览器 HTTP 连接池——视频流占满连接不再饿死
 * trickplay/海报（旧 127.0.0.1 代理方案的顽疾，随代理一起移除）。
 *
 * 非壳环境（局域网浏览器/安卓 WebView）返回 ''，调用方回退原地址。
 */

export function shellImageBase(fallbackBase) {
  try {
    if (typeof location !== 'undefined' && location.protocol === 'app:' && fallbackBase) {
      const u = new URL(fallbackBase);
      // 端口编码进首段路径：Chromium 会剥自定义协议 URL 的端口（实测），
      // faraday-img://img/<host:port>/Items/... 由壳内服务解码还原
      return `faraday-img://img/${u.host}`;
    }
  } catch { /* fallthrough */ }
  return '';
}
