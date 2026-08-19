import React, { useState } from 'react';
import { jellyfin } from '../api/jellyfinClient';
import { Server, Lock, User, Key, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

export default function LoginModal({ isOpen, onClose, onLoginSuccess }) {
  const [serverUrl, setServerUrl] = useState(jellyfin.auth.serverUrl || '');
  const [authMode, setAuthMode] = useState('password'); // 'password' | 'apikey'
  const [username, setUsername] = useState(jellyfin.auth.username || '');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState(jellyfin.auth.token || '');
  
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!serverUrl.trim()) {
      setErrorMsg('请输入 Jellyfin 服务器地址');
      return;
    }

    setIsLoading(true);

    try {
      if (authMode === 'password') {
        if (!username.trim()) {
          throw new Error('请输入用户名');
        }
        await jellyfin.authenticateByName(serverUrl, username, password);
      } else {
        if (!apiKey.trim()) {
          throw new Error('请输入 API Key');
        }
        await jellyfin.connectWithApiKey(serverUrl, apiKey);
      }

      setSuccessMsg('连接成功！');
      setTimeout(() => {
        if (onLoginSuccess) onLoginSuccess();
        if (onClose) onClose();
      }, 600);
    } catch (err) {
      console.error('Login error:', err);
      setErrorMsg(err.message || '连接失败，请检查服务器地址与凭据');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div 
        className="w-full max-w-md glass-panel rounded-2xl shadow-2xl p-6 border border-white/10 flex flex-col gap-5 text-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-jf-accent/20 border border-jf-accent/40 flex items-center justify-center text-cyan-400">
            <Server size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">连接 Jellyfin 服务器</h2>
            <p className="text-xs text-gray-400">输入服务器信息与凭据以启动随机播放看板</p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-black/40 p-1 rounded-xl border border-white/5 text-xs">
          <button
            type="button"
            onClick={() => setAuthMode('password')}
            className={`flex-1 py-1.5 rounded-lg font-medium transition ${
              authMode === 'password' ? 'bg-slate-700 text-white shadow' : 'text-gray-400 hover:text-white'
            }`}
          >
            账号密码登录
          </button>
          <button
            type="button"
            onClick={() => setAuthMode('apikey')}
            className={`flex-1 py-1.5 rounded-lg font-medium transition ${
              authMode === 'apikey' ? 'bg-slate-700 text-white shadow' : 'text-gray-400 hover:text-white'
            }`}
          >
            API Key 快速连接
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-xs">
          {/* Server URL */}
          <div className="flex flex-col gap-1.5">
            <label className="text-gray-300 font-medium flex items-center gap-1.5">
              <Server size={13} className="text-cyan-400" />
              <span>服务器地址 (Server URL)</span>
            </label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://jellyfin.example.com 或 http://localhost:8096"
              className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400 transition"
              required
            />
          </div>

          {authMode === 'password' ? (
            <>
              {/* Username */}
              <div className="flex flex-col gap-1.5">
                <label className="text-gray-300 font-medium flex items-center gap-1.5">
                  <User size={13} className="text-cyan-400" />
                  <span>用户名 (Username)</span>
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Jellyfin 账号"
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400 transition"
                  required
                />
              </div>

              {/* Password */}
              <div className="flex flex-col gap-1.5">
                <label className="text-gray-300 font-medium flex items-center gap-1.5">
                  <Lock size={13} className="text-cyan-400" />
                  <span>密码 (Password)</span>
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="留空（如无密码）或输入登录密码"
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400 transition"
                />
              </div>
            </>
          ) : (
            /* API Key */
            <div className="flex flex-col gap-1.5">
              <label className="text-gray-300 font-medium flex items-center gap-1.5">
                <Key size={13} className="text-amber-400" />
                <span>API Key / 访问令牌</span>
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="在 Jellyfin 控制台 > API 密钥中生成的 Token"
                className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400 transition font-mono"
                required
              />
            </div>
          )}

          {/* Feedback messages */}
          {errorMsg && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-red-950/50 border border-red-500/30 text-red-300">
              <AlertCircle size={15} className="flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-950/50 border border-emerald-500/30 text-emerald-300">
              <CheckCircle2 size={15} className="flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 mt-2">
            {jellyfin.auth.isConfigured && onClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 transition"
              >
                取消
              </button>
            )}
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 px-4 py-2.5 rounded-xl bg-jf-accent hover:bg-jf-accentHover text-white font-medium flex items-center justify-center gap-2 transition shadow-lg shadow-cyan-500/20 disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>正在连接...</span>
                </>
              ) : (
                <span>确认并连接</span>
              )}
            </button>
          </div>
        </form>

        <div className="text-[11px] text-gray-500 border-t border-white/5 pt-3">
          🔒 隐私提示：服务器地址与访问令牌仅保存在当前浏览器的 localStorage 中，绝不向任何第三方上报。
        </div>
      </div>
    </div>
  );
}
