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

/** Arrastrar desde estos elementos NO mueve el tablero (siguen funcionando normal). */
const NO_PAN =
  'button, a, input, textarea, select, label, canvas, [role="slider"], [role="tab"], [role="switch"], [data-no-pan]';

/**
 * Tablero estilo muro de San Valentín (lo usan los mapas del monitor): el contenido va sobre un
 * plano que se arrastra (mouse, dedo o rueda), con zoom (Ctrl+rueda, pellizco o botones) y
 * «Ampliar» a pantalla completa. Al abrir se ajusta al ancho disponible.
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

  const viewportRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: PAD, y: PAD });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; id: number; moved: boolean } | null>(
    null
  );
  const rafRef = useRef(0);

  const applyTransform = useCallback(() => {
    const el = planeRef.current;
    if (!el) return;
    const { x, y } = panRef.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoomRef.current})`;
  }, []);

  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      applyTransform();
    });
  }, [applyTransform]);

  /** Cambia el zoom dejando quieto el punto bajo (clientX, clientY). */
  const zoomAt = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
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
      schedule();
    },
    [schedule]
  );

  /** Ajusta el tablero al ancho visible (sin pasar de 100 %). */
  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const z = Math.min(1, Math.max(ZOOM_MIN, (viewport.clientWidth - PAD * 2) / width));
    zoomRef.current = z;
    panRef.current = { x: Math.max(PAD, (viewport.clientWidth - width * z) / 2), y: PAD };
    setZoomLabel(Math.round(z * 100));
    applyTransform();
  }, [applyTransform, width]);

  useLayoutEffect(() => {
    fit();
  }, [fit, expanded]);

  // Rueda: mueve el tablero; con Ctrl/Cmd (o pellizco del trackpad) hace zoom hacia el cursor.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(zoomRef.current * (e.deltaY > 0 ? 0.92 : 1.08), e.clientX, e.clientY);
        return;
      }
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
    if (e.button !== 0 || (e.target as HTMLElement).closest(NO_PAN)) return;
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
          Arrastra para moverte · Ctrl + rueda o pellizca para hacer zoom
        </span>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="Alejar">
            <ActionIcon variant="subtle" radius="xl" onClick={() => zoomAt(zoomRef.current / 1.2)} aria-label="Alejar">
              <IconMinus size={16} />
            </ActionIcon>
          </Tooltip>
          <span className={styles.boardZoom} aria-live="polite">
            {zoomLabel}%
          </span>
          <Tooltip label="Acercar">
            <ActionIcon variant="subtle" radius="xl" onClick={() => zoomAt(zoomRef.current * 1.2)} aria-label="Acercar">
              <IconPlus size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Ajustar al ancho">
            <ActionIcon variant="subtle" radius="xl" onClick={fit} aria-label="Ajustar al ancho">
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
        className={`${styles.boardViewport} ${dragging ? styles.boardViewportDragging : ''}`}
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

