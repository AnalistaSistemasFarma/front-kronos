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

type Drawn = FlowEdge & { d: string; width: number; pulseWidth: number; speed: number };


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
      const screenBox = container.getBoundingClientRect();
      if (screenBox.width === 0 || container.offsetWidth === 0) {
        setDrawn(null);
        return;
      }
      // Dentro del tablero con zoom (MonitorBoard) los rectángulos de pantalla vienen escalados,
      // pero el SVG se dibuja dentro del mismo plano escalado: se pasa todo a medidas sin zoom.
      const scale = screenBox.width / container.offsetWidth || 1;
      const unscale = (r: DOMRect) =>
        new DOMRect(r.left / scale, r.top / scale, r.width / scale, r.height / scale);
      const box = unscale(screenBox);
      const rects = new Map<string, DOMRect>();
      container.querySelectorAll<HTMLElement>('[data-flow-node]').forEach((el) => {
        rects.set(el.dataset.flowNode!, unscale(el.getBoundingClientRect()));
      });

      // Nodos apilados (pantalla angosta): no hay hueco entre columnas por donde pasar.
      const visible = edges.flatMap((e) => {
        const a = rects.get(e.from);
        const b = rects.get(e.to);
        if (!a || !b) return [];
        const sideBySide = b.left >= a.right - 1 || b.right <= a.left + 1;
        return sideBySide ? [{ e, a, b }] : [];
      });

      // Varias curvas que salen/llegan al mismo nodo se reparten a lo alto, en el orden en que
      // están sus otros extremos: así no se cruzan al llegar (antes iban en el orden de los datos
      // y con muchas personas se trenzaban en un solo nudo).
      const centerY = (r: DOMRect) => r.top + r.height / 2;
      const slotOut = new Map<(typeof visible)[number], number>();
      const slotIn = new Map<(typeof visible)[number], number>();
      const outCount = new Map<string, number>();
      const inCount = new Map<string, number>();
      const group = (key: (v: (typeof visible)[number]) => string) => {
        const groups = new Map<string, typeof visible>();
        for (const v of visible) {
          const list = groups.get(key(v));
          if (list) list.push(v);
          else groups.set(key(v), [v]);
        }
        return groups;
      };
      for (const [node, list] of group((v) => v.e.from)) {
        list.sort((p, q) => centerY(p.b) - centerY(q.b)).forEach((v, i) => slotOut.set(v, i));
        outCount.set(node, list.length);
      }
      for (const [node, list] of group((v) => v.e.to)) {
        list.sort((p, q) => centerY(p.a) - centerY(q.a)).forEach((v, i) => slotIn.set(v, i));
        inCount.set(node, list.length);
      }

      const usableOf = (rect: DOMRect, count: number) => Math.min(rect.height * 0.8, count * 10);
      const spread = (rect: DOMRect, index: number, count: number) => {
        if (count <= 1) return centerY(rect);
        const usable = usableOf(rect, count);
        return centerY(rect) - usable / 2 + (usable * index) / (count - 1);
      };

      const paths: Drawn[] = [];
      for (const v of visible) {
        const { e, a, b } = v;
        const outs = outCount.get(e.from) ?? 1;
        const ins = inCount.get(e.to) ?? 1;

        const rightward = b.left >= a.left;
        const x1 = (rightward ? a.right : a.left) - box.left;
        const x2 = (rightward ? b.left : b.right) - box.left;
        const y1 = spread(a, slotOut.get(v) ?? 0, outs) - box.top;
        const y2 = spread(b, slotIn.get(v) ?? 0, ins) - box.top;
        const bend = Math.max(24, Math.abs(x2 - x1) * 0.5) * (rightward ? 1 : -1);
        const d = `M${x1.toFixed(1)},${y1.toFixed(1)} C${(x1 + bend).toFixed(1)},${y1.toFixed(1)} ${(x2 - bend).toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;

        // Si muchas curvas comparten un nodo, se adelgazan para caber en su franja sin taparse.
        const room = Math.min(usableOf(a, outs) / Math.max(1, outs - 1), usableOf(b, ins) / Math.max(1, ins - 1));
        const width = Math.min(1.5 + Math.max(0, Math.min(1, e.weight)) * 7, Math.max(1, room));
        const rate = e.rate ?? 0;
        paths.push({
          ...e,
          d,
          width,
          pulseWidth: Math.max(Math.min(2.5, width + 1), width * 0.7),
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
                strokeWidth={p.pulseWidth}
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
