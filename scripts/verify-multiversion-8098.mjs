// 8098「转码对比」库多版本结构验证（只做 API 结构断言，不取任何媒体内容）
// 用法: node scripts/verify-multiversion-8098.mjs <apiKey>
const KEY = process.argv[2];
if (!KEY) { console.error('usage: node verify-multiversion-8098.mjs <apiKey>'); process.exit(2); }
const BASE = 'http://192.168.5.200:8098';
const HDRS = { 'Authorization': `MediaBrowser Token="${KEY}"` };
const ITEMS = [
  'dc205d292b419d77fa2fedf50567595a', // IPZZ-932 对比条目
  'ad3e1aacb8334e3d80d0a640421f4da8'  // ABF-308 对比条目
];
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const usersRes = await fetch(`${BASE}/Users`, { headers: HDRS });
const users = await usersRes.json();
check('GET /Users 200', usersRes.ok && Array.isArray(users) && users.length > 0, `${usersRes.status}, ${Array.isArray(users) ? users.length : '?'} users`);
const uid = users[0].Id;

for (const itemId of ITEMS) {
  console.log(`\n=== item ${itemId} ===`);
  const res = await fetch(`${BASE}/Users/${uid}/Items/${itemId}?Fields=MediaSources`, { headers: HDRS });
  check('GET item 200', res.ok, `HTTP ${res.status}`);
  if (!res.ok) continue;
  const item = await res.json();
  const sources = item.MediaSources || [];
  check('item has 2 versions', sources.length === 2, `got ${sources.length}`);

  // 结构打印（不含标题/简介）
  for (const s of sources) {
    const video = (s.MediaStreams || []).find(x => x.Type === 'Video');
    console.log(`  - Id=${s.Id} Name=${JSON.stringify(s.Name)} Size=${s.Size} Container=${s.Container} Video=${video?.Codec}/${video?.BitDepth}bit Trickplay=${Object.keys(s.Trickplay || s.TrickPlay || {}).join(',') || 'none'}`);
  }
  check('primary version Id == item Id', sources[0]?.Id === itemId, `${sources[0]?.Id}`);
  check('second version Id differs from item Id', sources[1] && sources[1].Id !== itemId, `${sources[1]?.Id}`);
  check('version Names present', sources.every(s => !!s.Name), sources.map(s => s.Name).join('/'));

  // PlaybackInfo 路径（useMediaPlaybackInfo 所用）也须返回全部版本
  const piRes = await fetch(`${BASE}/Items/${itemId}/PlaybackInfo?UserId=${uid}`, {
    method: 'POST', headers: { ...HDRS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ DeviceProfile: { MaxStreamingBitrate: 140000000, DirectPlayProfiles: [{ Container: 'mp4,mkv,webm,mov,avi', Type: 'Video' }] } })
  });
  const pi = piRes.ok ? await piRes.json() : null;
  check('PlaybackInfo returns 2 MediaSources', (pi?.MediaSources || []).length === 2, `got ${(pi?.MediaSources || []).length}`);

  // 直推 URL（getStreamUrl 构造形态）：HEAD 探测，只看状态与长度，不取内容
  for (const s of sources) {
    const msidParam = s.Id !== itemId ? `&MediaSourceId=${s.Id}` : '';
    const url = `${BASE}/Videos/${itemId}/stream?static=true&ApiKey=${KEY}&api_key=${KEY}${msidParam}`;
    const head = await fetch(url, { method: 'HEAD' });
    const lenOk = head.headers.get('content-length') === String(s.Size);
    check(`HEAD direct stream (${s.Name || s.Id}) 200 + Content-Length==Size`, head.status === 200 && lenOk, `HTTP ${head.status}, len=${head.headers.get('content-length')}, expected=${s.Size}`);
  }

  // HLS master.m3u8（getHlsUrl 构造形态，带 MediaSourceId）返回播放列表
  const msid = sources[1].Id;
  const m3u8Url = `${BASE}/Videos/${itemId}/master.m3u8?MediaSourceId=${msid}&ApiKey=${KEY}&api_key=${KEY}&DeviceId=FaradayVerify&PlaySessionId=verify_${Date.now()}&VideoCodec=h264&AudioCodec=aac&maxStreamingBitrate=8000000&TranscodingMaxAudioChannels=2&RequireAvc=false&SegmentContainer=ts&MinSegments=1&VideoBitrate=8000000&AudioBitrate=128000&SegmentLength=3`;
  const m3u8Res = await fetch(m3u8Url);
  const m3u8Text = m3u8Res.ok ? await m3u8Res.text() : '';
  check(`master.m3u8 with MediaSourceId=${msid.slice(0, 8)}… is a playlist`, m3u8Res.ok && m3u8Text.includes('#EXTM3U'), `HTTP ${m3u8Res.status}`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
