import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // 读取 .env / .env.local（不入库，避免泄露私有域名）
  const env = loadEnv(mode, process.cwd(), '');

  // 反向代理访问的主机白名单（逗号分隔）。
  // Vite 5.4+ 默认拦截非 localhost 的 Host 头（防 DNS 重绑定）；
  // 局域网 IP 直连不受影响。未配置时不传该选项，保持默认行为。
  const allowedHosts = (env.VITE_ALLOWED_HOSTS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const hostAllowlist = allowedHosts.length > 0 ? { allowedHosts } : {};

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    server: {
      port: 5173,
      host: true,
      ...hostAllowlist
    },
    preview: {
      port: 3000,
      host: true,
      ...hostAllowlist
    },
    test: {
      environment: 'happy-dom',
      globals: true
    }
  };
});
