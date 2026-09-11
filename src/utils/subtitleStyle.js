/**
 * 字幕外观样式（localStorage 持久化 + 事件广播）
 * 由 SubtitleOverlay（自定义字幕渲染层）消费：
 * 选中字幕轨以 hidden 模式加载 cue，由覆盖层按 delaySec 偏移渲染，实现
 * 字号 / 颜色 / 描边 / 背景 / 延迟补偿的完整自定义。
 */

const STORAGE_KEY = 'jf_subtitle_style';
export const SUBTITLE_STYLE_EVENT = 'faraday:subtitle_style_changed';

export const DEFAULT_SUBTITLE_STYLE = {
  scale: 1,        // 字号倍率（相对视频高度的基准字号）
  color: '#ffffff',// 字体颜色
  outline: 'normal', // 描边：'none' | 'normal' | 'strong'
  bg: 'semi',      // 背景：'none' | 'semi' | 'solid'
  delaySec: 0      // 延迟补偿（秒）：正值字幕延后显示，负值提前
};

export const SUBTITLE_COLORS = ['#ffffff', '#ffe14d', '#7dd3fc', '#f9a8d4', '#86efac', '#fdba74'];
export const SUBTITLE_OUTLINES = [
  { id: 'none', label: '无描边' },
  { id: 'normal', label: '常规' },
  { id: 'strong', label: '加粗' }
];
export const SUBTITLE_BGS = [
  { id: 'none', label: '无背景' },
  { id: 'semi', label: '半透明' },
  { id: 'solid', label: '不透明' }
];

export function getSubtitleStyle() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...DEFAULT_SUBTITLE_STYLE, ...(saved || {}) };
  } catch {
    return { ...DEFAULT_SUBTITLE_STYLE };
  }
}

export function saveSubtitleStyle(style) {
  const next = { ...getSubtitleStyle(), ...(style || {}) };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
  try {
    // eslint-disable-next-line no-undef
    window.dispatchEvent(new CustomEvent(SUBTITLE_STYLE_EVENT, { detail: next }));
  } catch {
    // ignore
  }
  return next;
}

// 描边 → text-shadow 预设
export function outlineToShadow(outline) {
  if (outline === 'none') return 'none';
  if (outline === 'strong') {
    return [
      '0 0 2px #000', '0 0 6px #000', '1px 1px 0 #000', '-1px 1px 0 #000',
      '1px -1px 0 #000', '-1px -1px 0 #000', '0 2px 6px rgba(0,0,0,.9)'
    ].join(', ');
  }
  return '0 0 4px rgba(0,0,0,.9), 0 1px 3px rgba(0,0,0,.9), 0 0 2px rgba(0,0,0,.8)';
}

// 背景 → CSS background
export function bgToCss(bg) {
  if (bg === 'none') return 'transparent';
  if (bg === 'solid') return '#000000';
  return 'rgba(0, 0, 0, 0.55)';
}
