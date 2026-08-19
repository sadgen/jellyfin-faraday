import React, { useState } from 'react';
import { jellyfin } from '../api/jellyfinClient';
import { Search, Sparkles, Check, X, Loader2, AlertCircle, Film } from 'lucide-react';

export default function IdentifyModal({
  isOpen,
  onClose,
  item,
  onIdentified
}) {
  const [searchTerm, setSearchTerm] = useState(item?.Name || '');
  const [searchYear, setSearchYear] = useState(item?.ProductionYear ? item.ProductionYear.toString() : '');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  if (!isOpen || !item) return null;

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchTerm.trim()) return;

    setIsSearching(true);
    setErrorMsg('');
    setResults([]);
    setHasSearched(true);

    try {
      const searchRes = await jellyfin.searchRemoteMetadata(item.Id, {
        name: searchTerm.trim(),
        year: searchYear.trim()
      });
      setResults(searchRes || []);
    } catch (err) {
      console.error('Remote search error:', err);
      setErrorMsg(err.message || '远程刮削搜索失败');
    } finally {
      setIsSearching(false);
    }
  };

  const handleApply = async (selectedResult) => {
    setIsApplying(true);
    setErrorMsg('');

    try {
      await jellyfin.applyRemoteMetadata(item.Id, selectedResult, true);
      if (onIdentified) {
        onIdentified({
          ...item,
          Name: selectedResult.Name || item.Name,
          ProductionYear: selectedResult.ProductionYear || item.ProductionYear,
          CommunityRating: selectedResult.CommunityRating || item.CommunityRating
        });
      }
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (err) {
      console.error('Apply metadata error:', err);
      setErrorMsg(err.message || '应用刮削数据失败');
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div 
        className="w-full max-w-xl glass-panel rounded-2xl shadow-2xl p-6 border border-white/10 flex flex-col gap-4 text-gray-200 max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">识别与重新刮削 (Identify)</h2>
              <p className="text-[11px] text-gray-400 truncate max-w-[320px]">{item.Name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search Input Bar */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索番号 / 电影名称..."
            className="flex-1 px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400 transition"
          />
          <input
            type="number"
            value={searchYear}
            onChange={(e) => setSearchYear(e.target.value)}
            placeholder="年份 (可选)"
            className="w-24 px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400 transition font-mono"
          />
          <button
            type="submit"
            disabled={isSearching || !searchTerm.trim()}
            className="px-4 py-2 rounded-xl bg-jf-accent hover:bg-jf-accentHover text-white text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-50"
          >
            {isSearching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
            <span>搜索</span>
          </button>
        </form>

        {/* Error Alert */}
        {errorMsg && (
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-red-950/50 border border-red-500/30 text-xs text-red-300">
            <AlertCircle size={14} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Search Results List */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[220px]">
          {isSearching && (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-gray-400">
              <Loader2 size={24} className="animate-spin text-cyan-400" />
              <span className="text-xs">正在向刮削源检索匹配条目...</span>
            </div>
          )}

          {!isSearching && hasSearched && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 text-xs">
              未找到匹配的刮削结果，尝试修改搜索关键词或年份
            </div>
          )}

          {!isSearching && !hasSearched && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 text-xs">
              输入影片名称或番号后点击搜索进行自动匹配
            </div>
          )}

          {!isSearching && results.map((res, index) => {
            const poster = res.ImageUrl || (res.SearchInfo?.ImageUrl);
            return (
              <div
                key={index}
                className="flex items-center justify-between p-3 rounded-xl bg-black/40 hover:bg-white/5 border border-white/5 hover:border-cyan-500/30 transition group"
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  {poster ? (
                    <img
                      src={poster}
                      alt={res.Name}
                      className="w-10 h-14 object-cover rounded-md bg-black/50 flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-14 rounded-md bg-white/5 flex items-center justify-center text-gray-500 flex-shrink-0">
                      <Film size={18} />
                    </div>
                  )}

                  <div className="flex flex-col min-w-0">
                    <div className="text-xs font-semibold text-white truncate group-hover:text-cyan-300 transition">
                      {res.Name}
                    </div>
                    <div className="text-[11px] text-gray-400 flex items-center gap-2 mt-0.5">
                      {res.ProductionYear && <span>{res.ProductionYear}</span>}
                      {res.ProviderIds && (
                        <span className="font-mono text-[10px] text-gray-500">
                          {Object.entries(res.ProviderIds).map(([k, v]) => `${k}:${v}`).join(' ')}
                        </span>
                      )}
                    </div>
                    {res.Overview && (
                      <div className="text-[10px] text-gray-500 line-clamp-1 mt-1">
                        {res.Overview}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => handleApply(res)}
                  disabled={isApplying}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/40 text-cyan-300 border border-cyan-500/30 text-xs font-medium flex items-center gap-1 transition flex-shrink-0 disabled:opacity-50"
                >
                  {isApplying ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  <span>应用</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-white/5 pt-3">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs text-gray-300 transition"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
