import { describe, expect, it } from 'vitest';
import { createKeyboardDetector } from './keyboard-open';

describe('createKeyboardDetector', () => {
  it('detects the iPhone keyboard even though innerHeight shrinks with it', () => {
    const open = createKeyboardDetector();
    // Home-screen app, keyboard closed: innerHeight == visual viewport height.
    expect(open({ height: 844, layoutWidth: 390, layoutHeight: 844, windowHeight: 844 })).toBe(false);
    // Keyboard + accessory bar: iOS shrinks innerHeight too (old check saw 0).
    expect(open({ height: 470, layoutWidth: 390, layoutHeight: 844, windowHeight: 470 })).toBe(true);
    expect(open({ height: 844, layoutWidth: 390, layoutHeight: 844, windowHeight: 844 })).toBe(false);
  });

  it('uses the tallest height seen when the layout height is not reliable', () => {
    const open = createKeyboardDetector();
    expect(open({ height: 750, layoutWidth: 390, windowHeight: 750 })).toBe(false);
    expect(open({ height: 420, layoutWidth: 390, windowHeight: 420 })).toBe(true);
  });

  it('keeps one baseline per orientation', () => {
    const open = createKeyboardDetector();
    expect(open({ height: 844, layoutWidth: 390, windowHeight: 844 })).toBe(false);
    // Landscape: shorter, but no keyboard.
    expect(open({ height: 390, layoutWidth: 844, windowHeight: 390 })).toBe(false);
  });

  it('ignores Safari toolbar changes and the hardware-keyboard accessory bar', () => {
    const open = createKeyboardDetector();
    expect(open({ height: 750, layoutWidth: 390, windowHeight: 750 })).toBe(false);
    expect(open({ height: 664, layoutWidth: 390, windowHeight: 664 })).toBe(false);
  });

  it('returns null while pinch-zoomed', () => {
    const open = createKeyboardDetector();
    expect(open({ height: 400, scale: 2, layoutWidth: 390, layoutHeight: 844 })).toBeNull();
  });

  it('works with Chromium, where innerHeight is the layout viewport', () => {
    const open = createKeyboardDetector();
    expect(open({ height: 400, layoutWidth: 412, windowHeight: 720 })).toBe(true);
  });
});
