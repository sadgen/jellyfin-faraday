import React, { useState, useEffect } from 'react';
import { jellyfin } from '../api/jellyfinClient';
import { 
  Subtitles, Download, Check, Search, 
  X, RefreshCw, Sparkles, FileText, AlertCircle
} from 'lucide-react';

export default function SubtitleModal({
  isOpen,
  item,
  currentSubtitleIndex = -1,
  onSelectSubtitle,
  onSubtitleDownloaded,
  onClose
}) {
  const [activeTab, setActiveTab] = useState('local'); // 'local' | 'remote'
  const [selectedLanguage, setSelectedLanguage] = useState('chi');
  const [isSearching, setIsSearching] = useState(false);
  const [remoteSubtitles, setRemoteSubtitles] = useState([]);
  const [downloadingId, setDownloadingId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Extract local subtitle streams
  const mediaSource = item?.MediaSources?.[0];
  const mediaStreams = mediaSource?.MediaStreams || item?.MediaStreams || [];
  const localSubtitles = mediaStreams.filter(s => s.Type === 'Subtitle');

  const handleSearchRemote = async (lang = selectedLanguage) => {
    if (!item?.Id) return;
    setIsSearching(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const results = await jellyfin.searchRemoteSubtitles(item.Id, lang);
      setRemoteSubtitles(results || []);
      if (!results || results.length === 0) {
        setErrorMsg('未找到匹配的在线字幕 (请确认服务器已安装 MeiamSub.Thunder 或 OpenSubtitles 插件)');
      }
    } catch (err) {
      setErrorMsg(err.message || '搜索远程字幕失败');
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === 'remote' && remoteSubtitles.length === 0) {
      handleSearchRemote(selectedLanguage);
    }
  }, [isOpen, activeTab]);

  const handleDownload = async (sub) => {
    if (!item?.Id || !sub?.Id) return;
    setDownloadingId(sub.Id);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const ok = await jellyfin.downloadRemoteSubtitle(item.Id, sub.Id);
      if (ok) {
        setSuccessMsg(`字幕「${sub.Name || '在线字幕'}」下载成功！正在重新加载视频...`);
        setTimeout(() => {
          if (onSubtitleDownloaded) onSubtitleDownloaded();
          onClose();
        }, 1200);
      } else {
        setErrorMsg('字幕下载失败，请检查 Jellyfin 插件权限');
      }
    } catch (err) {
      setErrorMsg(err.message || '下载出错');
    } finally {
      setDownloadingId(null);
    }
  };

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
                      <span className="truncate">{title}</span>
                      <span className="text-[10px] text-gray-500 font-mono mt-0.5">
                        {s.Codec?.toUpperCase()} {s.Language && `• ${s.Language}`} {s.IsDefault && '• 默认'} {s.IsForced && '• 强制'}
                      </span>
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
                  <option value="chi">中文 (Chinese / chi)</option>
                  <option value="zho">中文 (zho)</option>
                  <option value="eng">English (eng)</option>
                  <option value="jpn">日本語 (jpn)</option>
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

              {/* Remote Results List */}
              <div className="flex flex-col gap-2">
                {remoteSubtitles.map(sub => (
                  <div
                    key={sub.Id}
                    className="p-3 rounded-xl bg-black/40 border border-white/5 hover:border-cyan-500/40 flex items-center justify-between gap-3 transition"
                  >
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="font-bold text-white truncate" title={sub.Name}>{sub.Name}</span>
                      <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                        {sub.ProviderName && (
                          <span className="px-1.5 py-0.2 rounded bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 font-medium">
                            {sub.ProviderName}
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
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
