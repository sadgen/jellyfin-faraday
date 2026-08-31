/**
 * 播放失败诊断工具：
 * 采集直连流 HTTP 状态、浏览器 MediaError、hls.js 致命错误类型等信息，
 * 显示在播放器错误卡片上，便于远程排查播放失败原因（无需打开控制台）。
 */

/** 用 GET + Range 探测流地址的 HTTP 可达性与响应类型（不下载内容） */
export async function probeStreamStatus(url) {
  if (!url) return '';
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-1' } });
    const contentType = res.headers.get('content-type');
    return `HTTP ${res.status}${contentType ? ` (${contentType.split(';')[0]})` : ''}`;
  } catch (e) {
    return `网络请求失败: ${e?.message || 'unknown'}`;
  }
}

/** 把浏览器 MediaError 转成可读描述 */
export function describeVideoMediaError(videoEl) {
  const err = videoEl?.error;
  if (!err) return '';
  const codeNames = { 1: '加载中止', 2: '网络错误', 3: '解码错误', 4: '格式或源不支持' };
  const name = codeNames[err.code] ? ` ${codeNames[err.code]}` : '';
  return `MediaError(${err.code}${name})${err.message ? ` ${err.message}` : ''}`;
}
