/**
 * Decides whether the on-screen keyboard is open from visual viewport readings.
 *
 * Why not `window.innerHeight - visualViewport.height` (the previous check):
 * on iPhone, WebKit reports `window.innerHeight` as the VISUAL viewport height,
 * so it shrinks together with the keyboard and the difference stays ~0. The
 * composer never got `html.teclado-abierto` and kept the 34 pt home-indicator
 * inset above the keyboard (Nicolás, IMG_0246, 2026-11-24). Android/Chrome
 * reports the layout viewport there, which is why it worked on desktop tests.
 *
 * The baseline is the tallest of:
 * - the tallest unzoomed visual viewport seen for the current layout width
 *   (one entry per orientation), which is the keyboard-closed height;
 * - `documentElement.clientHeight` (layout viewport / ICB, which the iOS
 *   keyboard does not resize);
 * - `window.innerHeight` (layout viewport on Chromium).
 *
 * Returns `null` while the page is pinch-zoomed: the visual viewport shrinks
 * with the zoom too, so the reading says nothing about the keyboard and the
 * caller keeps its previous state.
 */
export interface ViewportReading {
  height: number;
  scale?: number;
  layoutWidth: number;
  layoutHeight?: number;
  windowHeight?: number;
}

export const KEYBOARD_THRESHOLD_PX = 150;

export function createKeyboardDetector(threshold = KEYBOARD_THRESHOLD_PX) {
  const tallestByWidth = new Map<number, number>();
  return (reading: ViewportReading): boolean | null => {
    const scale = reading.scale ?? 1;
    if (Math.abs(scale - 1) > 0.05) return null;
    const key = Math.round(reading.layoutWidth || 0);
    const tallest = Math.max(tallestByWidth.get(key) ?? 0, reading.height);
    tallestByWidth.set(key, tallest);
    const baseline = Math.max(tallest, reading.layoutHeight || 0, reading.windowHeight || 0);
    return baseline - reading.height > threshold;
  };
}
