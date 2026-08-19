/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
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
  plugins: [],
}
