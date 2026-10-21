import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { jellyfin } from '../api/jellyfinClient';
import {
  Subtitles, Download, Check, Search,
  X, RefreshCw, Sparkles, FileText, AlertCircle, Palette, Clock, Crosshair
} from 'lucide-react';
import {
  getSubtitleStyle, saveSubtitleStyle,
  SUBTITLE_COLORS, SUBTITLE_OUTLINES, SUBTITLE_BGS,
  outlineToShadow, bgToCss
} from '../utils/subtitleStyle';
import { detectChineseVariant, rankRemoteSubtitles } from '../utils/subtitleHelper';

/**
 * 轮询 PlaybackInfo 直到出现新字幕流。
 * 服务器端 /Items/{id}/Refresh 是异步队列（重新探测大文件需数秒），固定延时
 * 会与它竞速输掉，导致「下载成功但当前窗口看不到新字幕」，故轮询确认后再应用。
 */
async function pollForNewSubtitle(itemId, findNewStream, { intervalMs = 500, timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, intervalMs));
    try {
      const playback = await jellyfin.getItemPlaybackInfo(itemId);
      if (playback && findNewStream(playback)) return playback;
    } catch {
      // 单次拉取失败继续重试，直到超时
    }
  }
  return null;
}

// 下载记录：Jellyfin 对插件下载的字幕不保留来源与时间（文件 mtime 也无 API 可读），
// 因此在下载时刻由客户端记账。记录存服务端（DisplayPreferences 用户级 KV，同账号
// 全设备共享），localStorage 只作离线兜底；打开弹窗时自动把本地多出的旧记录迁到服务端。
// 按字幕文件名关联（轨道重编号不错位），index 作为无 Path 时的兜底键。
const SUBTITLE_DL_LOG_KEY = 'jf_subtitle_download_log';

function loadLocalSubtitleLog() {
  try {
    return JSON.parse(localStorage.getItem(SUBTITLE_DL_LOG_KEY)) || {};
  } catch {
    return {};
  }
}

function persistLocalSubtitleLog(log) {
  try {
    localStorage.setItem(SUBTITLE_DL_LOG_KEY, JSON.stringify(log));
  } catch {
    // 存储失败不影响下载本身
  }
}

function mergeSubtitleLogs(a, b) {
  const out = JSON.parse(JSON.stringify(a || {}));
  for (const [itemId, bucket] of Object.entries(b || {})) {
    out[itemId] = out[itemId] || {};
    for (const [key, entry] of Object.entries(bucket)) {
      const cur = out[itemId][key];
      if (!cur || (entry?.ts || 0) > (cur?.ts || 0)) out[itemId][key] = entry;
    }
  }
  return out;
}

function addSubtitleDownload(log, itemId, stream, remote) {
  const next = JSON.parse(JSON.stringify(log || {}));
  const entry = {
    ts: Date.now(),
    name: remote?.Name || '',
    provider: remote?.ProviderName || '',
    index: stream.Index
  };
  const bucket = next[itemId] || {};
  const file = (stream.Path || '').split('/').pop();
  if (file) bucket[file] = entry;
  bucket[`#${stream.Index}`] = entry;
  next[itemId] = bucket;
  return next;
}

function lookupSubtitleDownload(log, itemId, stream) {
  const bucket = itemId ? log?.[itemId] : null;
  if (!bucket) return null;
  const file = (stream.Path || '').split('/').pop();
  return (file && bucket[file]) || bucket[`#${stream.Index}`] || null;
}

function formatDownloadTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (d.getFullYear() === now.getFullYear()) return `${md} ${hm}`;
  return `${d.getFullYear()}-${md} ${hm}`;
}

export default function SubtitleModal({
  isOpen,
  item,
  currentSubtitleIndex = -1,
  onSelectSubtitle,
  onSubtitleDownloaded,
  onClose
}) {
  const [activeTab, setActiveTab] = useState('local'); // 'local' | 'remote' | 'style'
  const [selectedLanguage, setSelectedLanguage] = useState('chi'); // 'chi' | 'eng'
  const [remoteSubtitles, setRemoteSubtitles] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showAllRelated, setShowAllRelated] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [playbackData, setPlaybackData] = useState(null);
  // 字幕下载记录：服务端为主（同账号全设备共享），本地为离线兜底
  const [downloadLog, setDownloadLog] = useState(() => loadLocalSubtitleLog());
  const latestLogRef = useRef(downloadLog);
  useEffect(() => {
    latestLogRef.current = downloadLog;
  }, [downloadLog]);
  // 字幕外观（全局持久化，保存即广播给所有播放器实例）
  const [subStyle, setSubStyle] = useState(() => getSubtitleStyle());
  const updateSubStyle = (patch) => setSubStyle(saveSubtitleStyle(patch));

  // Fetch full playback info with MediaSources & MediaStreams when opened
  useEffect(() => {
    if (isOpen && item?.Id) {
      jellyfin.getItemPlaybackInfo(item.Id).then(data => {
        if (data) setPlaybackData(data);
      }).catch(() => {});
    }
  }, [isOpen, item?.Id]);

  // 打开时拉服务端下载记录并与本地合并；本地多出的旧记录（其它端看不到的）自动迁到服务端
  useEffect(() => {
    if (!isOpen || !item?.Id) return;
    let cancelled = false;
    (async () => {
      const serverLog = await jellyfin.getSubtitleDownloadLog();
      if (cancelled || !serverLog) return; // 服务器不可达：保持本地数据
      const merged = mergeSubtitleLogs(serverLog, loadLocalSubtitleLog());
      latestLogRef.current = merged;
      setDownloadLog(merged);
      if (JSON.stringify(merged) !== JSON.stringify(serverLog)) {
        jellyfin.saveSubtitleDownloadLog(merged).catch(() => {});
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, item?.Id]);

  // Extract local subtitle streams (from fresh playbackData or item)
  const mediaSource = playbackData?.MediaSources?.[0] || item?.MediaSources?.[0];
  const mediaStreams = mediaSource?.MediaStreams || playbackData?.MediaStreams || item?.MediaStreams || [];
  const localSubtitles = mediaStreams.filter(s => s.Type === 'Subtitle' && !['pgssub', 'dvdsub', 'dvbsub'].includes(s.Codec?.toLowerCase()));

  const handleSearchRemote = useCallback(async (lang = selectedLanguage) => {
    if (!item?.Id) return;
    setIsSearching(true);
    setErrorMsg('');
    setSuccessMsg('');
    setShowAllRelated(false);
    try {
      const results = await jellyfin.searchRemoteSubtitles(item.Id, lang);
      setRemoteSubtitles(results || []);
      if (!results || results.length === 0) {
        setErrorMsg(lang === 'eng'
          ? '未找到英语在线字幕：迅雷仅支持中文；射手按文件哈希匹配（重编码的文件搜不到）；OpenSubtitles 依赖条目元数据。'
          : '未找到匹配的在线字幕：迅雷按名称检索（改过名的文件可能搜不到）、射手按文件哈希检索（重编码必不命中）。请确认服务器已安装 MeiamSub 插件，或稍后刷新重试。');
      }
    } catch (err) {
      setErrorMsg(err.message || '搜索远程字幕失败');
    } finally {
      setIsSearching(false);
    }
  }, [item?.Id, selectedLanguage]);

  useEffect(() => {
    if (isOpen && activeTab === 'remote' && remoteSubtitles.length === 0) {
      handleSearchRemote(selectedLanguage);
    }
  }, [isOpen, activeTab, remoteSubtitles.length, handleSearchRemote, selectedLanguage]);

  // 番号相关度排序：精确番号匹配置顶（audit 2026-10：迅雷模糊搜索顶部常混入其他番号的字幕）
  const rankedRemote = useMemo(
    () => rankRemoteSubtitles(remoteSubtitles, item),
    [remoteSubtitles, item]
  );
  const RELATED_PAGE = 24;
  const visibleRelated = showAllRelated
    ? rankedRemote.related
    : rankedRemote.related.slice(0, RELATED_PAGE);

  const handleDownload = async (sub) => {
    if (!item?.Id || !sub?.Id) return;
    setDownloadingId(sub.Id);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const ok = await jellyfin.downloadRemoteSubtitle(item.Id, sub.Id);
      if (ok) {
        setSuccessMsg(`字幕「${sub.Name || '在线字幕'}」下载成功，正在等待服务器加载字幕流...`);
        // 只在可渲染的文本字幕流中挑选（排除 PGS/DVD/DVB 等图像字幕流），
        // 必须等到本次新下载出现的流真正进入 MediaStreams 才应用，
        // 拿不到就不动当前字幕（绝不能乱切到已有旧轨）
        const isTextSub = (s) =>
          s && s.Type === 'Subtitle' &&
          !['pgssub', 'dvdsub', 'dvbsub'].includes(String(s.Codec || '').toLowerCase());
        const previousIndexes = new Set(localSubtitles.map(s => s.Index));
        const findNewStream = (playback) => {
          const streams = playback?.MediaSources?.[0]?.MediaStreams || playback?.MediaStreams || [];
          return streams.find(s => isTextSub(s) && !previousIndexes.has(s.Index)) || null;
        };
        const updatedPlayback = await pollForNewSubtitle(item.Id, findNewStream);
        const newStream = updatedPlayback ? findNewStream(updatedPlayback) : null;
        if (newStream) {
          const nextLog = addSubtitleDownload(latestLogRef.current, item.Id, newStream, sub);
          latestLogRef.current = nextLog;
          setDownloadLog(nextLog);
          persistLocalSubtitleLog(nextLog);
          jellyfin.saveSubtitleDownloadLog(nextLog).catch(() => {});
          setPlaybackData(updatedPlayback);
          setSuccessMsg(`字幕「${sub.Name || '在线字幕'}」已应用到当前播放`);
          if (onSelectSubtitle) onSelectSubtitle(newStream.Index);
          if (onSubtitleDownloaded) onSubtitleDownloaded(updatedPlayback, newStream.Index);
          setTimeout(() => {
            onClose();
          }, 1200);
        } else {
          setErrorMsg('字幕已保存到服务器，但后台刷新尚未完成，请稍后重新打开播放窗口加载字幕');
        }
      } else {
        setErrorMsg('字幕下载失败，请检查 Jellyfin 插件权限');
      }
    } catch (err) {
      setErrorMsg(err.message || '下载出错');
    } finally {
      setDownloadingId(null);
    }
  };

  const renderRemoteResult = (sub, isExact) => (
    <div
      key={sub.Id}
      className={`p-3 rounded-xl flex items-center justify-between gap-3 transition ${
        isExact
          ? 'bg-emerald-950/30 border border-emerald-500/30 hover:border-emerald-400/60'
          : 'bg-black/40 border border-white/5 hover:border-cyan-500/40'
      }`}
    >
      <div className="flex flex-col min-w-0 flex-1">
        <span className="font-bold text-white truncate" title={sub.Name}>{sub.Name}</span>
        <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
          {sub.ProviderName && (
            <span className="px-1.5 py-0.2 rounded bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 font-medium">
              {sub.ProviderName}
            </span>
          )}
          {isExact && (
            <span className="px-1.5 py-0.2 rounded bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-bold">
              番号匹配
            </span>
          )}
          {sub.Format && <span className="font-mono text-gray-400">.{sub.Format}</span>}
          {sub.Language && <span className="font-mono text-gray-400">{sub.Language}</span>}
          {sub.CommunityRating !== undefined && <span className="text-amber-400">★ {sub.CommunityRating}</span>}
        </div>
      </div>

      <button
        onClick={() => handleDownload(sub)}
        disabled={downloadingId === sub.Id}
        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold flex items-center gap-1 transition flex-shrink-0 disabled:opacity-50 shadow"
      >
        {downloadingId === sub.Id ? (
          <RefreshCw size={13} className="animate-spin" />
        ) : (
          <Download size={13} />
        )}
        <span>{downloadingId === sub.Id ? '下载中...' : '下载并应用'}</span>
      </button>
    </div>
  );

  if (!isOpen || !item) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div 
        className="relative max-w-lg w-full glass-panel rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col max-h-[85vh] text-xs text-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/40">
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <Subtitles size={18} className="text-cyan-400 flex-shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-white text-sm truncate">{item.Name}</span>
              <span className="text-[11px] text-gray-400 font-mono">字幕管理 & 迅雷/射手/MeiamSub 在线下载</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-white/5 bg-slate-950/80 px-4 pt-2 gap-4">
          <button
            onClick={() => setActiveTab('local')}
            className={`pb-2.5 font-bold transition border-b-2 flex items-center gap-1.5 ${
              activeTab === 'local' 
                ? 'text-cyan-400 border-cyan-400' 
                : 'text-gray-400 border-transparent hover:text-gray-200'
            }`}
          >
            <span>现有字幕 ({localSubtitles.length})</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('remote');
              if (remoteSubtitles.length === 0) handleSearchRemote(selectedLanguage);
            }}
            className={`pb-2.5 font-bold transition border-b-2 flex items-center gap-1.5 ${
              activeTab === 'remote'
                ? 'text-cyan-400 border-cyan-400'
                : 'text-gray-400 border-transparent hover:text-gray-200'
            }`}
          >
            <Sparkles size={13} className="text-amber-400" />
            <span>下载在线字幕 (MeiamSub/迅雷)</span>
          </button>

          <button
            onClick={() => setActiveTab('style')}
            className={`pb-2.5 font-bold transition border-b-2 flex items-center gap-1.5 ${
              activeTab === 'style'
                ? 'text-cyan-400 border-cyan-400'
                : 'text-gray-400 border-transparent hover:text-gray-200'
            }`}
          >
            <Palette size={13} className="text-pink-400" />
            <span>字幕外观</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-3 min-h-[220px]">
          {/* Status Messages */}
          {errorMsg && (
            <div className="p-2.5 rounded-xl bg-red-950/60 border border-red-500/30 text-red-300 flex items-center gap-2 text-xs">
              <AlertCircle size={15} className="flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 flex items-center gap-2 text-xs animate-pulse">
              <Check size={15} className="flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* TAB 1: LOCAL SUBTITLES */}
          {activeTab === 'local' && (
            <div className="flex flex-col gap-2">
              {/* Option: Disable Subtitles */}
              <button
                onClick={() => {
                  onSelectSubtitle(-1);
                  onClose();
                }}
                className={`p-3 rounded-xl border flex items-center justify-between transition ${
                  currentSubtitleIndex === -1 
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-bold' 
                    : 'bg-black/40 border-white/5 text-gray-300 hover:bg-white/5'
                }`}
              >
                <span>关闭字幕</span>
                {currentSubtitleIndex === -1 && <Check size={16} className="text-cyan-400" />}
              </button>

              {/* Local Subtitle Items */}
              {localSubtitles.map((s, idx) => {
                const isSelected = currentSubtitleIndex === s.Index;
                const title = s.Title || s.DisplayTitle || `${s.Language || '字幕'} #${idx + 1}`;
                const variant = detectChineseVariant(s);
                const download = lookupSubtitleDownload(downloadLog, item?.Id, s);
                return (
                  <button
                    key={s.Index}
                    onClick={() => {
                      onSelectSubtitle(s.Index);
                      onClose();
                    }}
                    className={`p-3 rounded-xl border flex items-center justify-between text-left transition ${
                      isSelected
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-bold'
                        : 'bg-black/40 border-white/5 text-gray-300 hover:bg-white/5'
                    }`}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <span className="truncate">
                        {title}
                        {variant && (
                          <span className="ml-1.5 px-1 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 text-[9px] font-bold align-middle">
                            {variant}
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] text-gray-500 font-mono mt-0.5">
                        {s.Codec?.toUpperCase()} {s.Language && `• ${s.Language}`} {s.IsDefault && '• 默认'} {s.IsForced && '• 强制'}
                      </span>
                      {download && (
                        <span className="text-[10px] text-emerald-400/90 font-mono mt-0.5 truncate">
                          ⬇ {formatDownloadTime(download.ts)}{download.provider ? ` · ${download.provider}` : ''}
                        </span>
                      )}
                    </div>
                    {isSelected && <Check size={16} className="text-cyan-400 flex-shrink-0" />}
                  </button>
                );
              })}

              {localSubtitles.length === 0 && (
                <div className="flex flex-col items-center justify-center text-gray-500 py-8 gap-2">
                  <FileText size={32} className="text-gray-600" />
                  <span>当前视频暂无本地字幕</span>
                  <button
                    onClick={() => {
                      setActiveTab('remote');
                      handleSearchRemote('chi');
                    }}
                    className="mt-2 px-3 py-1.5 bg-jf-accent hover:bg-cyan-400 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5"
                  >
                    <Sparkles size={13} />
                    <span>立即在线搜索下载</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: REMOTE SEARCH & DOWNLOAD */}
          {activeTab === 'remote' && (
            <div className="flex flex-col gap-3">
              {/* Search Bar */}
              <div className="flex items-center gap-2">
                <select
                  value={selectedLanguage}
                  onChange={(e) => {
                    setSelectedLanguage(e.target.value);
                    handleSearchRemote(e.target.value);
                  }}
                  className="bg-black/60 px-3 py-2 rounded-xl border border-white/10 text-cyan-300 font-bold focus:outline-none cursor-pointer"
                >
                  <option value="chi">中文 (chi)</option>
                  <option value="eng">English (eng)</option>
                </select>

                <button
                  onClick={() => handleSearchRemote(selectedLanguage)}
                  disabled={isSearching}
                  className="flex-1 px-4 py-2 bg-jf-accent hover:bg-cyan-400 text-white rounded-xl font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                >
                  {isSearching ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                  <span>{isSearching ? '正在检索插件字幕...' : '刷新搜索在线字幕'}</span>
                </button>
              </div>
              <div className="text-[10px] text-gray-500 -mt-1">
                迅雷：仅中文，按名称模糊检索 · 射手：中/英，按文件哈希（重编码搜不到） · OpenSubtitles：依赖元数据
              </div>

              {/* Remote Results List：番号精确匹配置顶，其余按原始顺序 */}
              {rankedRemote.exact.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400">
                    <Crosshair size={12} />
                    <span>番号精确匹配 ({rankedRemote.exact.length})</span>
                  </div>
                  {rankedRemote.exact.map(sub => renderRemoteResult(sub, true))}
                </div>
              )}

              {visibleRelated.length > 0 && (
                <div className="flex flex-col gap-2">
                  {rankedRemote.exact.length > 0 && (
                    <div className="text-[11px] font-bold text-gray-400 pt-1">
                      其他相关结果 ({rankedRemote.related.length})
                    </div>
                  )}
                  {visibleRelated.map(sub => renderRemoteResult(sub, false))}
                  {rankedRemote.related.length > visibleRelated.length && (
                    <button
                      onClick={() => setShowAllRelated(true)}
                      className="py-2 rounded-xl bg-black/40 border border-white/10 text-gray-400 hover:text-cyan-300 hover:border-cyan-500/40 text-[11px] font-bold transition"
                    >
                      显示其余 {rankedRemote.related.length - visibleRelated.length} 条模糊结果
                    </button>
                  )}
                </div>
              )}

              {rankedRemote.exact.length === 0 && rankedRemote.related.length === 0 && !isSearching && (
                <div className="flex flex-col items-center justify-center text-gray-500 py-6 gap-1.5">
                  <FileText size={28} className="text-gray-600" />
                  <span>没有可显示的在线字幕结果</span>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SUBTITLE APPEARANCE */}
          {activeTab === 'style' && (
            <div className="flex flex-col gap-4">
              {/* 实时预览 */}
              <div className="rounded-xl bg-gradient-to-b from-slate-800 to-slate-900 border border-white/10 h-20 flex items-end justify-center pb-3 overflow-hidden">
                <div
                  className="max-w-[92%] whitespace-pre-line text-center leading-snug font-medium rounded-md px-3 py-1"
                  style={{
                    color: subStyle.color,
                    fontSize: `${Math.round(20 * (subStyle.scale || 1))}px`,
                    textShadow: outlineToShadow(subStyle.outline),
                    background: bgToCss(subStyle.bg)
                  }}
                >
                  字幕样式预览 Subtitle Preview
                </div>
              </div>

              {/* 字号 */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-gray-300 font-bold">
                  <span>字号</span>
                  <span className="font-mono text-cyan-400">{Math.round((subStyle.scale || 1) * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.7"
                  max="2"
                  step="0.05"
                  value={subStyle.scale || 1}
                  onChange={(e) => updateSubStyle({ scale: parseFloat(e.target.value) })}
                  className="w-full accent-cyan-400 cursor-pointer"
                />
              </div>

              {/* 颜色 */}
              <div className="flex flex-col gap-1.5">
                <span className="text-gray-300 font-bold">字体颜色</span>
                <div className="flex items-center gap-2">
                  {SUBTITLE_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => updateSubStyle({ color: c })}
                      className={`w-7 h-7 rounded-full border-2 transition flex items-center justify-center ${
                        subStyle.color === c ? 'border-cyan-400 scale-110' : 'border-white/20 hover:border-white/50'
                      }`}
                      style={{ background: c }}
                      title={c}
                    >
                      {subStyle.color === c && <Check size={13} className="text-slate-900 stroke-[3]" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* 描边 + 背景 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <span className="text-gray-300 font-bold">描边</span>
                  <div className="flex gap-1">
                    {SUBTITLE_OUTLINES.map(o => (
                      <button
                        key={o.id}
                        onClick={() => updateSubStyle({ outline: o.id })}
                        className={`flex-1 px-1 py-1.5 rounded-lg text-[11px] font-bold border transition ${
                          subStyle.outline === o.id
                            ? 'bg-cyan-400 text-slate-950 border-cyan-400'
                            : 'bg-black/40 border-white/10 text-gray-300 hover:border-cyan-500/40'
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-gray-300 font-bold">背景</span>
                  <div className="flex gap-1">
                    {SUBTITLE_BGS.map(b => (
                      <button
                        key={b.id}
                        onClick={() => updateSubStyle({ bg: b.id })}
                        className={`flex-1 px-1 py-1.5 rounded-lg text-[11px] font-bold border transition ${
                          subStyle.bg === b.id
                            ? 'bg-cyan-400 text-slate-950 border-cyan-400'
                            : 'bg-black/40 border-white/10 text-gray-300 hover:border-cyan-500/40'
                        }`}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 延迟补偿 */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-gray-300 font-bold">
                  <span className="flex items-center gap-1.5"><Clock size={13} className="text-cyan-400" />延迟补偿</span>
                  <span className={`font-mono ${(subStyle.delaySec || 0) === 0 ? 'text-gray-500' : 'text-amber-300'}`}>
                    {(subStyle.delaySec || 0) > 0 ? '+' : ''}{(subStyle.delaySec || 0).toFixed(1)}s
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => updateSubStyle({ delaySec: Math.max(-30, Math.round(((subStyle.delaySec || 0) - 0.5) * 10) / 10) })}
                    className="flex-1 py-1.5 rounded-lg bg-black/40 border border-white/10 text-gray-300 hover:border-cyan-500/40 font-mono font-bold text-xs"
                  >
                    −0.5s
                  </button>
                  <button
                    onClick={() => updateSubStyle({ delaySec: 0 })}
                    className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-gray-300 hover:border-cyan-500/40 text-[11px] font-bold"
                  >
                    归零
                  </button>
                  <button
                    onClick={() => updateSubStyle({ delaySec: Math.min(30, Math.round(((subStyle.delaySec || 0) + 0.5) * 10) / 10) })}
                    className="flex-1 py-1.5 rounded-lg bg-black/40 border border-white/10 text-gray-300 hover:border-cyan-500/40 font-mono font-bold text-xs"
                  >
                    +0.5s
                  </button>
                </div>
                <span className="text-[10px] text-gray-500">正值 = 字幕延后显示（画面先出、字幕慢半拍时使用）</span>
              </div>

              <div className="text-[10px] text-gray-500 border-t border-white/5 pt-2">
                样式全局生效：影院播放、悬浮小窗与 VR 模式共享同一套设置。
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
