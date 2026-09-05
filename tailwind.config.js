/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      // xs 断点：<420px 的紧凑手机场景（时间显示、播放数徽章等在此之下隐藏）
      // 注意：screens 必须放在 extend 下，写在 theme 根会覆盖掉 Tailwind 默认的 sm/md/lg 断点
      screens: {
        xs: '420px'
      },
      colors: {
        jf: {
          bg: '#0a0d14',
          surface: '#111726',
          card: '#161e31',
          accent: '#00a4dc',
          accentHover: '#0085b2',
          danger: '#ff4d4d',
          gold: '#f59e0b'
        }
      },
      backdropBlur: {
        xs: '2px'
      }
    },
  },
  plugins: [
    // tailwindcss-animate：animate-in / fade-in / zoom-in-95 / slide-in-from-bottom 等入场动画类
    require('tailwindcss-animate')
  ],
}
