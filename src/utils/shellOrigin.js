/**
 * 桌面壳（desktop-faraday）第二 origin 探测。
 *
 * 壳内页面恒由 127.0.0.1 的内嵌代理端口供给，且所有流量（视频流/HLS 分段/API/图片）
 * 都被 webRequest 接管收敛到这一个 origin——HTTP/1.1 下浏览器每 origin 仅 6 条连接，
 * 几路播放的视频流即可占满，低优先级的图片请求（海报/Trickplay 雪碧图）在连接池里
 * 无限排队：表现为「悬停缩略图一开始有、视频播起来后消失」。代理已在本端口同时
 * 监听 ::1（localhost 解析可达），走 http://localhost:<同端口> 即为独立 origin、
 * 独立连接池，不再与视频流争用。
 *
 * 非壳环境（局域网浏览器/安卓 WebView）返回 ''，调用方回退原地址。
 */

let cached = null;
let probing = false;

function probeAltOrigin(alt) {
  probing = true;
  // 用 Image 探活（图片加载无 CORS 要求；fetch 会因跨源 CORS 头缺失误判不可达）
  const img = new Image();
  const settle = (alive) => {
    if (!alive && cached === alt) cached = '';
    probing = false;
  };
  img.onload = () => settle(true);
  img.onerror = () => settle(false);
  img.src = `${alt}/faraday.svg`;
  setTimeout(() => settle(img.complete && img.naturalWidth > 0), 3000);
}

export function shellImageBase() {
  if (cached !== null) return cached;
  cached = '';
  try {
    if (typeof location !== 'undefined' &&
        location.hostname === '127.0.0.1' && location.port && location.protocol === 'http:') {
      cached = `http://localhost:${location.port}`;
      if (!probing) probeAltOrigin(cached);
    }
  } catch { cached = ''; }
  return cached;
}
