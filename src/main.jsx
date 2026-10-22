import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

// 构建标记：控制台读 window.__FARADAY_BUILD__ 判定浏览器实际加载的构建
// （生产 preview 无热刷新，防"改了没生效"误判）
window.__FARADAY_BUILD__ = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev';
if (import.meta.env.PROD) {
  console.info(`[Faraday] build ${window.__FARADAY_BUILD__} (v${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?'})`);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// PWA: 注册 Service Worker（仅生产构建），提供离线应用壳
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service Worker registration failed:', err);
    });
  });
}
