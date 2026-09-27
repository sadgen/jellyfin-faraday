/**
 * Calculates the exact asymmetric 3-window layout from the Tampermonkey script:
 * - Desktop:
 *   - Slot 0: Large Master Window on the Right (~60-65% width)
 *   - Slot 1: Small Sub Window on Top-Left (~35-40% width)
 *   - Slot 2: Small Sub Window on Bottom-Left (~35-40% width, stacked under Slot 1)
 * - Mobile / Tablet (< 768px / < 1024px):
 *   - Fluid responsive floating card that fits mobile touch screen bounds with safe-area spacing
 */

export function calculateSlotStyle(slotIndex) {
  if (typeof window === 'undefined') {
    return { left: 16, top: 70, width: 340, height: 260 };
  }

  const padding = 12;
  const headerOffset = 64; // Top header navigation bar offset
  const bottomOffset = 60; // Bottom space
  const gap = 12;
  const uiH = 34 + 38; // Header (~34px) + Footer (~38px)

  // Mobile Phones (< 768px): Stack 2 windows cleanly without overlap for simultaneous playback
  // 默认锚定屏幕中下方（拇指热区，避开底部导航栏），双窗时自底向上堆叠：slot 0 最靠下
  if (window.innerWidth < 768) {
    const padding = 8;
    const mobileGap = 8;
    const availTop = headerOffset + 4;
    const availBottom = window.innerHeight - bottomOffset;
    const availH = availBottom - availTop;
    let w = Math.min(420, window.innerWidth - padding * 2);
    let h = Math.round((w * 9 / 16) + uiH);
    // 双窗纵向放不下时按"两窗 + 间距"整体收窄，保证任意屏高下双窗都不与彼此/header 重叠
    const maxH = Math.floor((availH - mobileGap) / 2);
    if (h > maxH) {
      w = Math.max(240, Math.round((maxH - uiH) * 16 / 9));
      h = Math.round((w * 9 / 16) + uiH);
    }
    const left = Math.max(padding, Math.round((window.innerWidth - w) / 2));
    const top = Math.max(availTop, availBottom - h - (slotIndex * (h + mobileGap)));
    return {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(w),
      height: Math.round(h)
    };
  }

  // Tablets & Compact Screens (< 1024px)
  if (window.innerWidth < 1024) {
    const w = Math.min(380, window.innerWidth - 32);
    const h = (w * 9 / 16) + uiH;
    const left = Math.max(16, window.innerWidth - w - 16 - slotIndex * 24);
    const top = headerOffset + 12 + slotIndex * 36;
    return { left: Math.round(left), top: Math.round(top), width: Math.round(w), height: Math.round(h) };
  }

  const screenW = Math.max(800, window.innerWidth - padding * 2);
  const screenH = Math.max(500, window.innerHeight - headerOffset - bottomOffset);

  // Desktop: calculate small window max width so 2 stacked small windows fit in screenH:
  // 2 * (w_small * 9/16 + uiH) + gap <= screenH
  let max_w_small = (screenH - (uiH * 2) - gap) / (18 / 16);
  
  // Calculate big window max width:
  // w_big * 9/16 + uiH <= screenH
  let max_w_big = (screenH - uiH) / (9 / 16);

  // Allocate ~62% width for big window, ~38% for small
  let w_big = Math.min(max_w_big, screenW * 0.62);
  let w_small = Math.min(max_w_small, screenW - w_big - gap);
  
  // Distribute remaining width proportionally
  const remainingW = screenW - (w_big + w_small + gap);
  if (remainingW > 0) {
    const ratio = w_big / (w_big + w_small);
    w_big += remainingW * ratio;
    w_small += remainingW * (1 - ratio);
    w_big = Math.min(w_big, max_w_big);
    w_small = Math.min(w_small, max_w_small);
  }

  const h_big = (w_big * 9 / 16) + uiH;
  const h_small = (w_small * 9 / 16) + uiH;

  // Exact 3 Slot Positions from Tampermonkey:
  // Slot 0: Right Big
  // Slot 1: Left Top
  // Slot 2: Left Bottom
  const positions = [
    { left: screenW - w_big, top: headerOffset, width: w_big, height: h_big },
    { left: 0, top: headerOffset, width: w_small, height: h_small },
    { left: 0, top: headerOffset + h_small + gap, width: w_small, height: h_small }
  ];
  
  const p = positions[slotIndex % positions.length];
  return {
    left: Math.round(padding + p.left),
    top: Math.round(p.top),
    width: Math.round(p.width),
    height: Math.round(p.height)
  };
}

/**
 * 单窗铺满模式：高度占满页面可用区，宽度按视频宽高比自适应（无黑边），
 * 右缘贴住网页右侧，左侧留出海报墙可见空间。
 * @param {number} videoAspect 视频宽高比（videoWidth/videoHeight），未知时按 16:9
 * @param {number} chromeHeight 窗内头部+控制条实测高度（点击铺满时测量），缺省按 72px 估算
 */
export function calculateMaximizedStyle(videoAspect, chromeHeight) {
  if (typeof window === 'undefined') {
    return { left: 12, top: 64, width: 1024, height: 576 };
  }
  const padding = 12;
  const headerOffset = 64;
  const bottomOffset = 12; // 铺满模式与两侧一致的小边距（槽位布局的 60px 底部预留不适用）
  // 保证左侧海报墙至少 160px 可见，超宽视频在此处收窄（会有少量黑边，不可避免）
  const posterWallMin = 160;
  const availH = Math.max(240, window.innerHeight - headerOffset - bottomOffset);
  const videoH = Math.max(200, availH - (chromeHeight || 72));
  const maxW = Math.max(320, window.innerWidth - padding * 2 - posterWallMin);
  const aspect = videoAspect && videoAspect > 0 ? videoAspect : 16 / 9;
  const width = Math.min(maxW, Math.round(videoH * aspect));
  return {
    left: Math.round(window.innerWidth - padding - width),
    top: headerOffset,
    width,
    height: availH
  };
}
