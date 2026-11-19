/**
 * 原画直推的路由判定（2026-11-08 外网卡顿诊断落地）：
 * 外网（含跨网段站点）+ HEVC 10-bit 自动改走原样串流（Remux HLS）。
 *
 * 背景：浏览器 <video> 渐进式直推的前向缓冲极小（几秒），外网 RTT 下每次
 * Range 续拉都要经历 TCP 慢启动；HEVC 10-bit（P010）渲染管线对缓冲欠载的
 * 容忍度更低——同码率下 8-bit 外网直推流畅（HMN-639 实证 9.6Mbps 无恙）、
 * 10-bit 转圈卡死（JUQ-358 实证 7.3Mbps 卡死）。Remux 串流零重编码
 * （-c copy，实测 57x 实时），换取 hls.js 60~120s 缓冲垫，画质 100% 无损。
 * 仅「外网 + 10-bit」启用；局域网与非 10-bit 一律直连（秒开体验不变）。
 */

const PROBE_TTL_MS = 5 * 60 * 1000;
// 内网探测（连接复用后）约 0.5~3ms；跨网段站点/外网最低也 ~10ms 起步
const REMOTE_RTT_THRESHOLD_MS = 10;

let cachedProbe = null; // { isRemote, ts }

async function probeRttOnce(serverUrl) {
  const t0 = performance.now();
  await fetch(`${serverUrl.replace(/\/+$/, '')}/System/Info/Public`, { cache: 'no-store' });
  return performance.now() - t0;
}

/**
 * 探测客户端是否经高延迟链路访问服务器（外网 / 跨网段站点）。
 * 两次探测取最小值滤抖动；结果缓存 5 分钟；失败按内网处理（保持直连现状）。
 * @param {string} serverUrl
 * @returns {Promise<boolean>}
 */
export async function isRemoteNetwork(serverUrl) {
  if (!serverUrl) return false;
  if (cachedProbe && Date.now() - cachedProbe.ts < PROBE_TTL_MS) {
    return cachedProbe.isRemote;
  }
  try {
    const first = await probeRttOnce(serverUrl);
    const rtt = Math.min(first, await probeRttOnce(serverUrl));
    const isRemote = rtt > REMOTE_RTT_THRESHOLD_MS;
    cachedProbe = { isRemote, ts: Date.now() };
    return isRemote;
  } catch {
    return false;
  }
}

/**
 * 判定视频流是否为 HEVC 10-bit（外网直推卡顿的实证格式分水岭）。
 * @param {object} videoStream - PlaybackInfo MediaStreams 中 Type==='Video' 的流
 * @returns {boolean}
 */
export function isHevc10VideoStream(videoStream) {
  if (!videoStream) return false;
  if (String(videoStream?.Codec || '').toLowerCase() !== 'hevc') return false;
  return videoStream.BitDepth === 10 || String(videoStream.Profile || '').includes('10');
}

/**
 * 浏览器 MSE 是否支持喂该视频流（hls.js 串流的前置条件）。
 * h264 avc1 全系 MSE 通行；hevc 按源 codec tag（hvc1/hev1）与位深（Main10=2.4 / Main=1.6）
 * 拼串验证。不支持时回落直连，由既有的「直连失败自动回退转码」兜底。
 * @param {object} videoStream - PlaybackInfo MediaStreams 中 Type==='Video' 的流
 * @returns {boolean}
 */
export function canMsePlayVideoStream(videoStream) {
  try {
    if (typeof MediaSource === 'undefined' || typeof MediaSource.isTypeSupported !== 'function') {
      return false;
    }
    const codec = String(videoStream?.Codec || '').toLowerCase();
    if (codec === 'h264') return true;
    if (codec === 'hevc') {
      const tag = String(videoStream?.CodecTag || '').toLowerCase() === 'hev1' ? 'hev1' : 'hvc1';
      const profileId = isHevc10VideoStream(videoStream) ? '2.4' : '1.6';
      return MediaSource.isTypeSupported(`video/mp4; codecs="${tag}.${profileId}.L120.B0"`);
    }
    return false;
  } catch {
    return false;
  }
}
