import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Mobile Video Player Touch Gestures Hook
 * Supports:
 * 1. Horizontal swipe: Seek forward / rewind with seconds indicator
 * 2. Left vertical swipe: Brightness adjust (0.2 - 1.0)
 * 3. Right vertical swipe: Volume adjust (0.0 - 1.0)
 * 4. Double tap: Play / Pause toggle
 * 5. Long press: 2.5x / 3.0x speed boost (倍速冲锋)
 */
export function useTouchGestures({
  videoRef,
  containerRef,
  duration = 0,
  currentTime = 0,
  onSeek,
  onTogglePlay,
  normalSpeed = 1.0,
  onSpeedChange
}) {
  const [gestureState, setGestureState] = useState({
    type: null, // 'seek' | 'brightness' | 'volume' | 'speed_boost'
    value: 0,
    text: ''
  });

  const [brightness, setBrightness] = useState(1.0); // 0.2 ~ 1.0

  // Touch tracking refs
  const touchStartRef = useRef({ x: 0, y: 0, time: 0 });
  const touchActionRef = useRef(null); // 'seek' | 'brightness' | 'volume' | null
  const initialValueRef = useRef(0);
  const longPressTimerRef = useRef(null);
  const lastTapRef = useRef({ time: 0, x: 0, y: 0 });
  const isBoostedRef = useRef(false);

  const handleTouchStart = useCallback((e) => {
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

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

    // Double-tap detection (< 300ms, < 30px displacement)
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
        isBoostedRef.current = true;
        touchActionRef.current = 'speed_boost';
        videoRef.current.playbackRate = 2.5;
        if (onSpeedChange) onSpeedChange(2.5);
        setGestureState({
          type: 'speed_boost',
          value: 2.5,
          text: '2.5x 倍速冲锋'
        });
      }
    }, 400);
  }, [containerRef, videoRef, onTogglePlay, onSpeedChange]);

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
        // Vertical -> Left: Brightness, Right: Volume
        if (start.isLeftHalf) {
          touchActionRef.current = 'brightness';
          initialValueRef.current = brightness;
        } else {
          touchActionRef.current = 'volume';
          initialValueRef.current = videoRef.current ? videoRef.current.volume : 1.0;
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

      setGestureState({
        type: 'seek',
        value: targetTime,
        text: `${deltaSec >= 0 ? '+' : ''}${deltaSec}s (${formatSec(targetTime)} / ${formatSec(videoDuration)})`
      });
    } else if (touchActionRef.current === 'brightness') {
      // Vertical swipe on left: up increases, down decreases
      const delta = -(dy / start.rectHeight) * 1.5;
      const nextB = Math.max(0.2, Math.min(1.0, initialValueRef.current + delta));
      setBrightness(nextB);
      setGestureState({
        type: 'brightness',
        value: Math.round(nextB * 100),
        text: `亮度 ${Math.round(nextB * 100)}%`
      });
    } else if (touchActionRef.current === 'volume') {
      // Vertical swipe on right: up increases, down decreases
      const delta = -(dy / start.rectHeight) * 1.5;
      const nextV = Math.max(0, Math.min(1.0, initialValueRef.current + delta));
      if (videoRef.current) {
        videoRef.current.volume = nextV;
        videoRef.current.muted = nextV === 0;
      }
      setGestureState({
        type: 'volume',
        value: Math.round(nextV * 100),
        text: `音量 ${Math.round(nextV * 100)}%`
      });
    }
  }, [currentTime, duration, brightness, videoRef]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (isBoostedRef.current) {
      // Restore normal playback rate
      isBoostedRef.current = false;
      if (videoRef.current) {
        videoRef.current.playbackRate = normalSpeed;
      }
      if (onSpeedChange) onSpeedChange(normalSpeed);
    }

    if (touchActionRef.current === 'seek' && gestureState.type === 'seek') {
      if (onSeek) onSeek(gestureState.value);
      if (videoRef.current) videoRef.current.currentTime = gestureState.value;
    }

    touchActionRef.current = null;
    setGestureState({ type: null, value: 0, text: '' });
  }, [gestureState, onSeek, normalSpeed, onSpeedChange, videoRef]);

  function formatSec(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

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
