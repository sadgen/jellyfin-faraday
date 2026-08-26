# Jellyfin Faraday ⚡

<p align="center">
  <img src="./public/vite.svg" width="80" height="80" alt="Jellyfin Faraday Logo" />
</p>

<p align="center">
  <strong>专为高效观影与极速浏览打造的现代轻量级 Jellyfin Web 客户端</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React 18" />
  <img src="https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white" alt="Vite 5" />
  <img src="https://img.shields.io/badge/TailwindCSS-3-38B2AC?logo=tailwind-css&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Three.js-WebGL-black?logo=three.js" alt="Three.js" />
  <img src="https://img.shields.io/badge/Tests-Vitest-729B1B?logo=vitest&logoColor=white" alt="Vitest" />
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License" />
</p>

---

## 🌟 核心特性 (Features)

### 🪟 1. 多窗画中画随机连播 (Multi-Window Floating PIP)
- **桌面端三窗连播 / 移动端双窗同屏**：右上角随机画中画窗口，支持 FIFO 队列无缝轮播。
- **全域拖拽定位**：长按窗口任意位置即可触发展示按压反馈并自由拖拽。
- **独立播放控制**：每个浮动窗口均具备独立的进度微调、静音切换、倍速选择、清晰度切换及固定海报预览。

### 🎞️ 2. 帧级时间轴 Trickplay 缩略图预览
- **卡片/进度条精准定位**：鼠标悬停或触控滑动进度条时，即时渲染清晰帧预览。
- **智能视口自适应**：靠近顶部自动下沉，靠近底部自动上浮，保证预览画幅完整不遮挡。

### 🥽 3. 全景 VR 与 3D 沉浸式播放 (Inline VR & 360°/180°)
- **多模式 WebGL 3D 渲染**：支持 180° SBS (左右 3D)、180° Dome 半球全景、360° 全景、360° Top-Bottom (上下 3D) 以及虚拟曲面巨幕影院。
- **重力感应与视角追踪**：移动端支持 DeviceOrientation 陀螺仪体感追踪与手势阻尼平滑视角转动。

### 🚀 4. 全量离线秒级水合引擎 (IndexedDB Engine)
- **物理分库隔离**：按 `服务器地址 + 用户ID` 独立划分 IndexedDB 存储区，彻底杜绝多账号/多服务器数据污染。
- **瞬时检索与复合过滤**：全量缓存秒级挂载，支持拼音首字母检索、演职员、类型、年份、播放状态以及**影片查重清理**。

### 💬 5. 智能字幕与外部播放器联动
- **硬字幕智能识别**：自动识别文件名中的硬字幕特征（如 `-C`、`_UC`、`中文字幕` 等），智能免除重复软字幕挂载。
- **远程在线字幕搜索**：一键检索 Jellyfin 服务器插件在线字幕并直接下载挂载。
- **一键外部播放器调起**：支持唤醒 PotPlayer、VLC、IINA、MX Player、Infuse 等本地播放器。

### 📱 6. 双端极佳触控手势体系
- **三档滑动快进/快退**：支持慢速 (5s)、中速 (15s)、快速 (30s) 档位调节。
- **左侧亮度 / 右侧音量手势**：移动端直觉式上下划动调节。

---

## 🛠️ 技术栈 (Tech Stack)

| 领域 | 技术方案 |
| :--- | :--- |
| **前端框架** | React 18 + Vite 5 |
| **样式与图标** | Tailwind CSS + Tailwind-Animate + Lucide Icons |
| **视频流引擎** | 原生 HTML5 Video + Hls.js |
| **3D / VR** | Three.js (WebGL PerspectiveCamera & SphereGeometry) |
| **数据持久化** | IndexedDB (物理隔离) + LocalStorage + SessionStorage |
| **测试框架** | Vitest + happy-dom + fake-indexeddb |

---

## 🚀 快速上手 (Getting Started)

### 环境要求
- **Node.js** >= 18.0.0
- **npm** >= 9.0.0

### 本地开发与运行

1. **克隆仓库**
   ```bash
   git clone https://github.com/sadgen/jellyfin-faraday.git
   cd jellyfin-faraday
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **启动开发服务器**
   ```bash
   npm run dev
   ```
   启动后访问 `http://localhost:5173`。

4. **运行单元测试**
   ```bash
   npm test
   ```

5. **执行代码规范检查**
   ```bash
   npm run lint
   ```

6. **生产打包构建**
   ```bash
   npm run build
   ```
   打包生成的文件位于 `dist/` 目录。

---

## ⚙️ 部署建议 (Deployment)

### 方式一：静态 Web 服务器 (Nginx)

```nginx
server {
    listen 80;
    server_name jellyfin-faraday.yourdomain.com;

    root /path/to/jellyfin-faraday/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 方式二：Systemd 用户服务 (Node / Vite Preview)

```ini
[Unit]
Description=Jellyfin Faraday Web Client
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/jellyfin-faraday
ExecStart=/usr/bin/npm run preview -- --host 0.0.0.0 --port 3000
Restart=always

[Install]
WantedBy=default.target
```

---

## 🔒 安全性说明 (Security)

- **凭据最小范围存储**：支持「记住登录状态」切换，未勾选时仅存放于 `sessionStorage`，关闭标签页即时销毁。
- **协议白名单机制**：严格限制仅允许连接 `http:` 和 `https:` 地址，阻止任意非法 URI 协议注入。
- **全量凭据清理**：登出时主动清除对应用户在浏览器端的所有 IndexedDB 数据表、视图缓存与认证 Token。

---

## 📄 开源许可证 (License)

本项目采用 [MIT License](LICENSE) 开源许可证。欢迎提交 Issue 与 Pull Request！
