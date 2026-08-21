import { flushSync } from 'react-dom';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Fundido breve al cambiar claro/oscuro. Sin animación si el usuario pide menos movimiento. */
export function runThemeTransition(apply: () => void) {
  if (typeof document === 'undefined' || prefersReducedMotion()) {
    apply();
    return;
  }

  if (typeof document.startViewTransition !== 'function') {
    apply();
    return;
  }

  document.startViewTransition(() => {
    flushSync(apply);
  });
}
