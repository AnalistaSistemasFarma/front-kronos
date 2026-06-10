type LayoutCallback = () => void;

const pending = new Set<LayoutCallback>();
let scrollEndTimer: ReturnType<typeof setTimeout> | undefined;
let scrolling = false;
let listenersAttached = false;

function flushPendingLayoutUpdates(): void {
  if (scrolling || pending.size === 0) return;
  const batch = Array.from(pending);
  pending.clear();
  batch.forEach((fn) => fn());
}

function attachScrollListeners(): void {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;

  window.addEventListener(
    'scroll',
    () => {
      scrolling = true;
      clearTimeout(scrollEndTimer);
      scrollEndTimer = setTimeout(() => {
        scrolling = false;
        flushPendingLayoutUpdates();
      }, 120);
    },
    { passive: true }
  );

  window.addEventListener('scrollend', () => {
    scrolling = false;
    clearTimeout(scrollEndTimer);
    flushPendingLayoutUpdates();
  });
}

/** Evita trabajo de layout sincronizado con el scroll (advertencia Firefox APZ). */
export function scheduleLayoutUpdate(fn: LayoutCallback): void {
  attachScrollListeners();
  pending.add(fn);

  if (scrolling) return;

  requestAnimationFrame(() => {
    requestAnimationFrame(flushPendingLayoutUpdates);
  });
}
