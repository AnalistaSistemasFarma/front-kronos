'use client';

import { useLayoutEffect, useState } from 'react';
import type { StatusTone } from './colors';
import styles from './monitor.module.css';

/**
 * Capa de flujo: dibuja curvas animadas entre nodos HTML marcados con `data-flow-node="id"`
 * dentro de `container`. El grosor sale de `weight` (0–1) y la velocidad de los puntos de
 * `rate` (eventos por minuto). Todo se calcula en el navegador con los datos que ya trajo la
 * pantalla: no hace consultas.
 *
 * Si los nodos quedan apilados (pantalla angosta) esa curva no se dibuja: las columnas ya se
 * leen de arriba abajo y la curva cruzaría encima de las tarjetas.
 */

export type FlowEdge = {
  id: string;
  from: string;
  to: string;
  /** 0–1, relativo al flujo más grande del dibujo. */
  weight: number;
  /** Eventos por minuto para la velocidad; 0 o null = conexión sin movimiento. */
  rate: number | null;
  tone?: StatusTone;
  /** Color propio (p. ej. el del módulo); si no, sale del tono. */
  color?: string;
  /** Texto del tooltip nativo (también lo leen los lectores de pantalla). */
  title: string;
};

type Drawn = FlowEdge & { d: string; width: number; speed: number };


const TONE_VAR: Record<StatusTone, string> = {
  ok: 'var(--sm-info)',
  info: 'var(--sm-info)',
  warning: 'var(--sm-warning)',
  critical: 'var(--sm-critical)',
  idle: 'var(--sm-idle)',
};

/** Normaliza valores a 0–1 en escala logarítmica (un flujo 100× mayor no tapa a los demás). */
export function flowWeights(values: number[]): number[] {
  const max = Math.max(0, ...values);
  if (max <= 0) return values.map(() => 0);
  const top = Math.log10(max + 1);
  return values.map((v) => (v > 0 ? Math.log10(v + 1) / top : 0));
}

export function FlowLayer({
  container,
  edges,
  highlight,
}: {
  /** El contenedor (vía estado, no ref: el efecto debe repetirse cuando aparece). */
  container: HTMLElement | null;
  edges: FlowEdge[];
  /** Si hay un nodo resaltado, solo se ven fuertes sus conexiones. */
  highlight?: string | null;
}) {
  const [drawn, setDrawn] = useState<{ w: number; h: number; paths: Drawn[] } | null>(null);

  useLayoutEffect(() => {
    if (!container) return;

    const measure = () => {
      const box = container.getBoundingClientRect();
      if (box.width === 0) {
        setDrawn(null);
        return;
      }
      const rects = new Map<string, DOMRect>();
      container.querySelectorAll<HTMLElement>('[data-flow-node]').forEach((el) => {
        rects.set(el.dataset.flowNode!, el.getBoundingClientRect());
      });

      // Varias curvas que salen/llegan al mismo nodo se reparten a lo alto para no encimarse.
      const outCount = new Map<string, number>();
      const inCount = new Map<string, number>();
      for (const e of edges) {
        outCount.set(e.from, (outCount.get(e.from) ?? 0) + 1);
        inCount.set(e.to, (inCount.get(e.to) ?? 0) + 1);
      }
      const outSeen = new Map<string, number>();
      const inSeen = new Map<string, number>();
      const spread = (rect: DOMRect, index: number, count: number) => {
        if (count <= 1) return rect.top + rect.height / 2;
        const usable = Math.min(rect.height * 0.6, count * 10);
        return rect.top + rect.height / 2 - usable / 2 + (usable * index) / (count - 1);
      };

      const paths: Drawn[] = [];
      for (const e of edges) {
        const a = rects.get(e.from);
        const b = rects.get(e.to);
        if (!a || !b) continue;
        // Nodos apilados (pantalla angosta): no hay hueco entre columnas por donde pasar.
        const sideBySide = b.left >= a.right - 1 || b.right <= a.left + 1;
        if (!sideBySide) continue;
        const oi = outSeen.get(e.from) ?? 0;
        const ii = inSeen.get(e.to) ?? 0;
        outSeen.set(e.from, oi + 1);
        inSeen.set(e.to, ii + 1);

        const rightward = b.left >= a.left;
        const x1 = (rightward ? a.right : a.left) - box.left;
        const x2 = (rightward ? b.left : b.right) - box.left;
        const y1 = spread(a, oi, outCount.get(e.from) ?? 1) - box.top;
        const y2 = spread(b, ii, inCount.get(e.to) ?? 1) - box.top;
        const bend = Math.max(24, Math.abs(x2 - x1) * 0.5) * (rightward ? 1 : -1);
        const d = `M${x1.toFixed(1)},${y1.toFixed(1)} C${(x1 + bend).toFixed(1)},${y1.toFixed(1)} ${(x2 - bend).toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;

        const rate = e.rate ?? 0;
        paths.push({
          ...e,
          d,
          width: 1.5 + Math.max(0, Math.min(1, e.weight)) * 7,
          speed: rate <= 0 ? 0 : Math.max(0.6, 3.4 - Math.log10(rate + 1) * 1.1),
        });
      }
      setDrawn({ w: box.width, h: box.height, paths });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    container.querySelectorAll('[data-flow-node]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [container, edges]);

  if (!drawn) return null;

  return (
    <svg className={styles.flowLayer} width={drawn.w} height={drawn.h} viewBox={`0 0 ${drawn.w} ${drawn.h}`} aria-hidden>
      {drawn.paths.map((p) => {
        const color = p.color ?? TONE_VAR[p.tone ?? 'info'];
        const dimmed = highlight != null && p.from !== highlight && p.to !== highlight;
        const moving = p.speed > 0;
        return (
          <g key={p.id} className={styles.flowEdge} style={{ opacity: dimmed ? 0.12 : 1 }}>
            <title>{p.title}</title>
            <path
              d={p.d}
              fill="none"
              stroke={color}
              strokeOpacity={moving ? 0.22 : 0.35}
              strokeWidth={p.width}
              strokeLinecap="round"
              strokeDasharray={moving ? undefined : '3 6'}
            />
            {moving && (
              <path
                d={p.d}
                fill="none"
                stroke={color}
                strokeWidth={Math.max(2.5, p.width * 0.7)}
                strokeLinecap="round"
                className={styles.flowPulse}
                style={{ ['--flow-speed' as string]: `${p.speed.toFixed(2)}s` }}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
