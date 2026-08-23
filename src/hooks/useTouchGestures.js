import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * 倍速档位（与 ControlHUD 全局倍速下拉菜单保持同一语义）
 * 右侧竖直滑动：上滑升档 / 下滑降档
 */
export const SPEED_OPTIONS = [1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

function formatSec(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Mobile Video Player Touch Gestures Hook
 * Supports:
 * 1. Horizontal swipe: Seek forward / rewind with real-time Trickplay thumbnail preview
 * 2. Left vertical swipe: Brightness adjust (0.2 - 1.0)
 * 3. Right vertical swipe: Playback speed stepping along SPEED_OPTIONS (up = faster, down = slower),
 *    with a transient toast showing the current speed that fades out after release.
 *    (2026-08 audit fix: replaced the old volume-control gesture — no longer touches
 *    video.volume / video.muted, so the isTileMuted icon cannot be clobbered by gestures.)
 * 4. Double tap: Play / Pause toggle
 * 5. Long press: 2.5x speed boost (倍速冲锋)，松手恢复冲锋前的档位
 */
export function useTouchGestures({
  videoRef,
  containerRef,
  duration = 0,
  currentTime = 0,
  onSeek,
  onSeekPreview,
  onSeekPreviewEnd,
  onTogglePlay,
  normalSpeed = 1.0,
  onSpeedChange
}) {
  const [gestureState, setGestureState] = useState({
    type: null, // 'seek' | 'brightness' | 'speed_step' | 'speed_boost'
    value: 0,
    text: '',
    fading: false
  });

  const [brightness, setBrightness] = useState(1.0); // 0.2 ~ 1.0

  // Touch tracking refs
  const touchStartRef = useRef({ x: 0, y: 0, time: 0 });
  const touchActionRef = useRef(null); // 'seek' | 'brightness' | 'speed_step' | null
  const initialValueRef = useRef(0);
  const longPressTimerRef = useRef(null);
  const lastTapRef = useRef({ time: 0, x: 0, y: 0 });
  const isBoostedRef = useRef(false);
  const boostRestoreSpeedRef = useRef(1.0); // 冲锋前的档位（修复松手恢复到已提升速度的竞态）
  const fadeTimerRef = useRef(null);

  // Unmount cleanup for the fade-out timer
  useEffect(() => () => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
  }, []);

  /** 手势结束后让提示滞留片刻再淡出移除 */
  const scheduleGestureFade = useCallback(() => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    setGestureState((s) => ({ ...s, fading: true }));
    fadeTimerRef.current = setTimeout(() => {
      fadeTimerRef.current = null;
      setGestureState({ type: null, value: 0, text: '', fading: false });
    }, 700);
  }, []);

  const applySpeedStep = useCallback((nextSpeed) => {
    if (!isBoostedRef.current && videoRef.current) {
      videoRef.current.playbackRate = nextSpeed;
    }
    if (onSpeedChange) onSpeedChange(nextSpeed);
  }, [videoRef, onSpeedChange]);

  const handleTouchStart = useCallback((e) => {
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    // A brand-new touch cancels any lingering fade-out toast immediately
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
      setGestureState({ type: null, value: 0, text: '', fading: false });
    }

    const relX = touch.clientX - rect.left;
    const relY = touch.clientY - rect.top;
    const isLeftHalf = relX < rect.width / 2;

    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
      relX,
      relY,
      isLeftHalf,
      rectWidth: rect.width,
      rectHeight: rect.height
    };

    touchActionRef.current = null;

    // Double-tap detection (< 300ms, < 35px displacement)
    const now = Date.now();
    const timeDiff = now - lastTapRef.current.time;
    const distDiff = Math.hypot(touch.clientX - lastTapRef.current.x, touch.clientY - lastTapRef.current.y);

    if (timeDiff < 300 && distDiff < 35) {
      // Clear double-tap reference
      lastTapRef.current = { time: 0, x: 0, y: 0 };
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (onTogglePlay) onTogglePlay();
      return;
    }

    lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY };

    // Setup Long-press speed boost (hold for > 400ms)
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      if (!touchActionRef.current && videoRef.current) {
        // Capture the PRE-boost speed now (closure value from touch start),
        // so release always restores the original pace even if onSpeedChange
        // re-rendered this hook with the boosted speed (audit race fix).
        boostRestoreSpeedRef.current = normalSpeed;
        isBoostedRef.current = true;
        touchActionRef.current = null;
        videoRef.current.playbackRate = 2.5;
        if (onSpeedChange) onSpeedChange(2.5);
        setGestureState({
          type: 'speed_boost',
          value: 2.5,
          text: '2.5x 倍速冲锋',
          fading: false
        });
      }
    }, 400);
  }, [containerRef, videoRef, onTogglePlay, onSpeedChange, normalSpeed]);

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const start = touchStartRef.current;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    // Cancel long press if user moves fingers
    if (Math.hypot(dx, dy) > 10) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }

    if (isBoostedRef.current) return;

    // Determine gesture direction on first significant movement (> 12px)
    if (!touchActionRef.current && Math.hypot(dx, dy) > 12) {
      if (Math.abs(dx) > Math.abs(dy)) {
        // Horizontal -> Seek
        touchActionRef.current = 'seek';
        initialValueRef.current = videoRef.current ? videoRef.current.currentTime : currentTime;
      } else {
        // Vertical -> Left: Brightness, Right: Speed stepping (SPEED_OPTIONS 档位)
        if (start.isLeftHalf) {
          touchActionRef.current = 'brightness';
          initialValueRef.current = brightness;
        } else {
          touchActionRef.current = 'speed_step';
          initialValueRef.current = normalSpeed;
        }
      }
    }

    if (!touchActionRef.current) return;

    e.preventDefault();

    if (touchActionRef.current === 'seek') {
      // Horizontal swipe: delta of full width = ~90 seconds seek
      const videoDuration = duration || (videoRef.current ? videoRef.current.duration : 100);
      const seekDelta = (dx / start.rectWidth) * 90;
      const targetTime = Math.max(0, Math.min(videoDuration, initialValueRef.current + seekDelta));
      const deltaSec = Math.round(targetTime - initialValueRef.current);
      const percent = videoDuration > 0 ? targetTime / videoDuration : 0;

      setGestureState({
        type: 'seek',
        value: targetTime,
        text: `${deltaSec >= 0 ? '+' : ''}${deltaSec}s (${formatSec(targetTime)} / ${formatSec(videoDuration)})`,
        fading: false
      });

      // Trigger real-time Trickplay thumbnail update during touch seek
      if (onSeekPreview) {
        onSeekPreview(targetTime, percent);
      }
    } else if (touchActionRef.current === 'brightness') {
      // Vertical swipe on left: up increases, down decreases
      const delta = -(dy / start.rectHeight) * 1.5;
      const nextB = Math.max(0.2, Math.min(1.0, initialValueRef.current + delta));
      setBrightness(nextB);
      setGestureState({
        type: 'brightness',
        value: Math.round(nextB * 100),
        text: `亮度 ${Math.round(nextB * 100)}%`,
        fading: false
      });
    } else if (touchActionRef.current === 'speed_step') {
      // Vertical swipe on right: up = faster step, down = slower step.
      // Full-height drag spans 4 steps across SPEED_OPTIONS.
      const steps = Math.round(-(dy / start.rectHeight) * 4);
      const baseIdx = SPEED_OPTIONS.indexOf(initialValueRef.current);
      const idx = baseIdx === -1 ? 0 : baseIdx;
      const nextIdx = Math.max(0, Math.min(SPEED_OPTIONS.length - 1, idx + steps));
      const nextSpeed = SPEED_OPTIONS[nextIdx];

      applySpeedStep(nextSpeed);
      setGestureState({
        type: 'speed_step',
        value: nextSpeed,
        text: `倍速 ${nextSpeed}x`,
        fading: false
      });
    }
  }, [currentTime, duration, brightness, normalSpeed, videoRef, onSeekPreview, applySpeedStep]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    const wasBoosted = isBoostedRef.current;

    if (wasBoosted) {
      // Restore the pace captured BEFORE the boost started
      isBoostedRef.current = false;
      if (videoRef.current) {
        videoRef.current.playbackRate = boostRestoreSpeedRef.current;
      }
      if (onSpeedChange) onSpeedChange(boostRestoreSpeedRef.current);
    }

    if (touchActionRef.current === 'seek' && gestureState.type === 'seek') {
      if (onSeek) onSeek(gestureState.value);
      if (videoRef.current) videoRef.current.currentTime = gestureState.value;
      if (onSeekPreviewEnd) onSeekPreviewEnd();
    }

    const endedAction = touchActionRef.current;
    touchActionRef.current = null;

    if ((endedAction === 'speed_step' || endedAction === 'speed_boost' || wasBoosted) && gestureState.type) {
      // Keep the speed toast visible briefly, then fade out
      scheduleGestureFade();
    } else {
      setGestureState({ type: null, value: 0, text: '', fading: false });
    }
  }, [gestureState, onSeek, onSeekPreviewEnd, onSpeedChange, videoRef, scheduleGestureFade]);

  return {
    gestureState,
    brightness,
    touchHandlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: handleTouchEnd
    }
  };
}
