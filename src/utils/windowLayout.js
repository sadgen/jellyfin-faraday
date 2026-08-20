/**
 * Calculates the exact asymmetric 3-window layout from the Tampermonkey script:
 * - Slot 0: Large Master Window on the Right (~60-65% width)
 * - Slot 1: Small Sub Window on Top-Left (~35-40% width)
 * - Slot 2: Small Sub Window on Bottom-Left (~35-40% width, stacked under Slot 1)
 */

export function calculateSlotStyle(slotIndex) {
  if (typeof window === 'undefined') {
    return { left: 20, top: 70, width: 340, height: 260 };
  }

  const padding = 12;
  const headerOffset = 64; // Top header navigation bar offset
  const bottomOffset = 60; // Bottom space
  const gap = 12;
  
  const screenW = Math.max(800, window.innerWidth - padding * 2);
  const screenH = Math.max(500, window.innerHeight - headerOffset - bottomOffset);
  const uiH = 34 + 38; // Header (~34px) + Footer (~38px)

  // Mobile / compact screens: responsive floating width
  if (window.innerWidth < 1024) {
    const w = Math.min(360, window.innerWidth - 32);
    const h = (w * 9 / 16) + uiH;
    const left = Math.max(16, window.innerWidth - w - 16 - slotIndex * 20);
    const top = headerOffset + 10 + slotIndex * 30;
    return { left, top, width: w, height: h };
  }

  // Calculate small window max width so 2 stacked small windows fit in screenH:
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
    left: padding + p.left,
    top: p.top,
    width: Math.round(p.width),
    height: Math.round(p.height)
  };
}
