import { afterEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}));
import { useAltoVisible } from '../../components/chat/useAltoVisible';
afterEach(() => { hooks.effects.length = 0; vi.unstubAllGlobals(); });

it('coalesces viewport events and skips identical geometry; removes listeners on cleanup', () => {
  const listeners = new Map<string, () => void>();
  const frames: Array<() => void> = [];
  const setProperty = vi.fn();
  const removeProperty = vi.fn();
  const notify = vi.fn();
  const vv = {
    height: 720, offsetTop: 0,
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  vi.stubGlobal('document', { documentElement: { style: { setProperty, removeProperty } } });
  vi.stubGlobal('window', { visualViewport: vv,
    requestAnimationFrame: (fn: () => void) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: vi.fn(),
  });
  useAltoVisible(notify);
  const cleanup = hooks.effects[0]();
  expect(notify).toHaveBeenCalledTimes(1);
  listeners.get('scroll')!();
  listeners.get('resize')!();
  expect(frames).toHaveLength(1);
  frames.shift()!();
  expect(notify).toHaveBeenCalledTimes(1);
  vv.height = 400;
  vv.offsetTop = 12;
  listeners.get('resize')!();
  frames.shift()!();
  expect(notify).toHaveBeenCalledTimes(2);
  expect(setProperty).toHaveBeenLastCalledWith('--desplazamiento-visible', '12px');
  cleanup?.();
  expect(listeners.size).toBe(0);
  expect(removeProperty).toHaveBeenCalledTimes(2);
});

it('leaves CSS fallback intact without VisualViewport', () => {
  vi.stubGlobal('window', {});
  const notify = vi.fn();
  useAltoVisible(notify);
  expect(hooks.effects[0]()).toBeUndefined();
  expect(notify).not.toHaveBeenCalled();
});
