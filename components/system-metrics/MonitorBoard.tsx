'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { ActionIcon, Group, Tooltip } from '@mantine/core';
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconFocusCentered,
  IconMinus,
  IconPlus,
} from '@tabler/icons-react';
import styles from './monitor.module.css';

/** Ancho por defecto del plano: el contenido conserva su forma y en pantallas chicas se hace zoom. */
export const BOARD_WIDTH = 1240;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 1.6;
const PAD = 16;
/** Alto mínimo y máximo de la caja (fuera de pantalla completa), en px y en fracción de la ventana. */
const MIN_HEIGHT = 320;
const MAX_HEIGHT_VH = 0.8;
const EASE = 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)';

/** Arrastrar desde estos elementos NO mueve el tablero (siguen funcionando normal). */
const NO_PAN =
  'button, a, input, textarea, select, label, canvas, [role="slider"], [role="tab"], [role="switch"], [data-no-pan]';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Tablero de los mapas del monitor: el contenido va sobre un plano con zoom (botones, Ctrl+rueda
 * o pellizco) y «Ampliar» a pantalla completa. Al abrir se ajusta al ancho y la caja toma el alto
 * del mapa, así se ve completo sin moverse.
 *
 * El plano tiene LÍMITES: no se puede arrastrar fuera de la vista (antes se desplazaba sin fin y
 * el mapa se perdía), y si cabe entero queda centrado y quieto. Solo se arrastra cuando hay algo
 * que ver fuera de la caja (por ejemplo, después de acercar). La rueda del mouse sigue bajando
 * la página; dentro de pantalla completa recorre el mapa.
 */
export function MonitorBoard({
  children,
  width = BOARD_WIDTH,
  columns = 1,
}: {
  children: ReactNode;
  /** Ancho del plano sin zoom, en px. */
  width?: number;
  columns?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [zoomLabel, setZoomLabel] = useState(100);
  const [dragging, setDragging] = useState(false);
  const [canPan, setCanPan] = useState(false);
  const [height, setHeight] = useState<number | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: PAD, y: PAD });
  const canPanRef = useRef(false);
  const expandedRef = useRef(false);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; id: number; moved: boolean } | null>(
    null
  );
  const rafRef = useRef(0);

  /** Mantiene el plano dentro de la vista: centrado si cabe, sin bordes vacíos si no cabe. */
  const clampPan = useCallback(() => {
    const viewport = viewportRef.current;
    const plane = planeRef.current;
    if (!viewport || !plane) return;
    const z = zoomRef.current;
    const axis = (pan: number, content: number, avail: number) =>
      content + PAD * 2 <= avail ? (avail - content) / 2 : Math.min(PAD, Math.max(avail - content - PAD, pan));
    const contentW = plane.offsetWidth * z;
    const contentH = plane.offsetHeight * z;
    panRef.current = {
      x: axis(panRef.current.x, contentW, viewport.clientWidth),
      y: axis(panRef.current.y, contentH, viewport.clientHeight),
    };
    const overflow = contentW + PAD * 2 > viewport.clientWidth + 1 || contentH + PAD * 2 > viewport.clientHeight + 1;
    if (overflow !== canPanRef.current) {
      canPanRef.current = overflow;
      setCanPan(overflow);
    }
  }, []);

  const applyTransform = useCallback(
    (animate = false) => {
      const el = planeRef.current;
      if (!el) return;
      clampPan();
      const { x, y } = panRef.current;
      el.style.transition = animate && !prefersReducedMotion() ? EASE : 'none';
      el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoomRef.current})`;
    },
    [clampPan]
  );

  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      applyTransform();
    });
  }, [applyTransform]);

  /** Cambia el zoom dejando quieto el punto bajo (clientX, clientY). */
  const zoomAt = useCallback(
    (next: number, clientX?: number, clientY?: number, animate = false) => {
      const viewport = viewportRef.current;
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
      if (viewport) {
        const rect = viewport.getBoundingClientRect();
        const cx = (clientX ?? rect.left + rect.width / 2) - rect.left;
        const cy = (clientY ?? rect.top + rect.height / 2) - rect.top;
        const px = (cx - panRef.current.x) / zoomRef.current;
        const py = (cy - panRef.current.y) / zoomRef.current;
        panRef.current = { x: cx - px * z, y: cy - py * z };
      }
      zoomRef.current = z;
      setZoomLabel(Math.round(z * 100));
      if (animate) applyTransform(true);
      else schedule();
    },
    [applyTransform, schedule]
  );

  /** Zoom que hace caber el ancho del mapa (sin pasar de 100 %). */
  const fitZoom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return 1;
    return Math.min(1, Math.max(ZOOM_MIN, (viewport.clientWidth - PAD * 2) / width));
  }, [width]);

  /**
   * Fuera de pantalla completa la caja toma el alto del mapa ajustado al ancho (con tope), para
   * que se vea entero sin espacio vacío ni barras internas.
   */
  const syncHeight = useCallback(() => {
    const plane = planeRef.current;
    if (!plane || expandedRef.current) {
      setHeight(null);
      return;
    }
    const content = plane.offsetHeight * fitZoom() + PAD * 2;
    const max = Math.max(MIN_HEIGHT, window.innerHeight * MAX_HEIGHT_VH);
    setHeight(Math.round(Math.min(max, Math.max(MIN_HEIGHT, content))));
  }, [fitZoom]);

  /** Ajusta el tablero al ancho visible y lo deja arriba. */
  const fit = useCallback(
    (animate = false) => {
      const z = fitZoom();
      zoomRef.current = z;
      panRef.current = { x: PAD, y: PAD };
      setZoomLabel(Math.round(z * 100));
      applyTransform(animate);
    },
    [applyTransform, fitZoom]
  );

  useLayoutEffect(() => {
    expandedRef.current = expanded;
    syncHeight();
    fit();
  }, [fit, syncHeight, expanded]);

  // Si cambia el tamaño de la ventana o del contenido (llegan datos nuevos), se recalcula el
  // alto y se vuelve a acomodar dentro de los límites, sin perder el zoom que eligió la persona.
  useEffect(() => {
    const viewport = viewportRef.current;
    const plane = planeRef.current;
    if (!viewport || !plane) return;
    const observer = new ResizeObserver(() => {
      syncHeight();
      schedule();
    });
    observer.observe(viewport);
    observer.observe(plane);
    return () => observer.disconnect();
  }, [syncHeight, schedule]);

  // Rueda: con Ctrl/Cmd (o pellizco del trackpad) hace zoom hacia el cursor. Sin Ctrl, fuera de
  // pantalla completa se deja pasar para que la página baje normal; en pantalla completa recorre
  // el mapa (con límites).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(zoomRef.current * (e.deltaY > 0 ? 0.92 : 1.08), e.clientX, e.clientY);
        return;
      }
      if (!expandedRef.current || !canPanRef.current) return;
      e.preventDefault();
      panRef.current = {
        x: panRef.current.x - (e.shiftKey ? e.deltaY : e.deltaX),
        y: panRef.current.y - (e.shiftKey ? 0 : e.deltaY),
      };
      schedule();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [schedule, zoomAt]);

  // Pellizco con dos dedos (celular / tablet).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let pinch: { dist: number; zoom: number } | null = null;
    const dist = (a: Touch, b: Touch) => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      dragRef.current = null;
      setDragging(false);
      pinch = { dist: Math.max(1, dist(e.touches[0], e.touches[1])), zoom: zoomRef.current };
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch) return;
      e.preventDefault();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      zoomAt(pinch.zoom * (Math.max(1, dist(e.touches[0], e.touches[1])) / pinch.dist), cx, cy);
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [zoomAt]);

  // Pantalla completa: Esc la cierra y la página de atrás no se desplaza.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  useEffect(
    () => () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    },
    []
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Si el mapa cabe entero no hay nada que arrastrar: el clic y la selección funcionan normal.
    if (!canPanRef.current || e.button !== 0 || (e.target as HTMLElement).closest(NO_PAN)) return;
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
      id: e.pointerId,
      moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    // Umbral: un clic normal (sin moverse) no se convierte en arrastre.
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      setDragging(true);
      window.getSelection()?.removeAllRanges();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignorar */
      }
    }
    panRef.current = { x: drag.panX + dx, y: drag.panY + dy };
    schedule();
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.id !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignorar */
    }
  };

  return (
    <div className={`${styles.boardShell} ${expanded ? styles.boardShellExpanded : ''}`}>
      <div className={styles.boardToolbar}>
        <span className={styles.boardHint}>
          {canPan
            ? expanded
              ? 'Arrastra o usa la rueda para recorrer · Ctrl + rueda para zoom'
              : 'Arrastra para recorrer · Ctrl + rueda o pellizca para zoom'
            : 'Usa + o Ctrl + rueda para acercar'}
        </span>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="Alejar">
            <ActionIcon
              variant="subtle"
              radius="xl"
              onClick={() => zoomAt(zoomRef.current / 1.2, undefined, undefined, true)}
              aria-label="Alejar"
            >
              <IconMinus size={16} />
            </ActionIcon>
          </Tooltip>
          <span className={styles.boardZoom} aria-live="polite">
            {zoomLabel}%
          </span>
          <Tooltip label="Acercar">
            <ActionIcon
              variant="subtle"
              radius="xl"
              onClick={() => zoomAt(zoomRef.current * 1.2, undefined, undefined, true)}
              aria-label="Acercar"
            >
              <IconPlus size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Ver el mapa completo">
            <ActionIcon variant="subtle" radius="xl" onClick={() => fit(true)} aria-label="Ver el mapa completo">
              <IconFocusCentered size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={expanded ? 'Salir de pantalla completa (Esc)' : 'Ampliar tablero'}>
            <ActionIcon
              variant="light"
              radius="xl"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'Reducir tablero' : 'Ampliar tablero'}
            >
              {expanded ? <IconArrowsMinimize size={16} /> : <IconArrowsMaximize size={16} />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </div>
      <div
        ref={viewportRef}
        className={`${styles.boardViewport} ${canPan ? styles.boardViewportPannable : ''} ${
          dragging ? styles.boardViewportDragging : ''
        }`}
        style={!expanded && height != null ? { height } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          ref={planeRef}
          className={styles.boardPlane}
          style={{ width, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
