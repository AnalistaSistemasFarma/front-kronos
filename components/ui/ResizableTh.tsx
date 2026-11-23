'use client';

import React, { useRef } from 'react';
import { Table } from '@mantine/core';
import { useUiPreference } from './useUiPreference';
import { widthsKey } from '../../lib/ui/preferences';

/**
 * Anchos de columna de una tabla, guardados por usuario (se arrastra el borde derecho del
 * encabezado). La tabla debe usar `tableLayout: 'fixed'` con el ancho total que devuelve el hook.
 */
export function useColumnWidths(table: string, defaults: Record<string, number>) {
  const [saved, setSaved] = useUiPreference<Record<string, number>>(widthsKey(table), {});
  const widths: Record<string, number> = { ...defaults, ...(saved ?? {}) };
  const total = Object.keys(defaults).reduce((sum, k) => sum + (widths[k] ?? defaults[k]), 0);
  const setWidth = (col: string, w: number) => {
    const next = { ...(saved ?? {}) };
    if (w < 0) delete next[col]; // doble clic: vuelve al ancho por defecto
    else next[col] = Math.max(60, Math.round(w));
    setSaved(next, { debounceMs: 600 });
  };
  const reset = () => setSaved({});
  return { widths, total, setWidth, reset };
}

export function ResizableTh({
  col,
  width,
  onResize,
  children,
  style,
}: {
  col: string;
  width: number;
  onResize: (col: string, width: number) => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    start.current = { x: e.clientX, w: width };
    const move = (ev: MouseEvent) => {
      if (start.current) onResize(col, start.current.w + ev.clientX - start.current.x);
    };
    const up = () => {
      start.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return (
    <Table.Th style={{ width, position: 'relative', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...style }}>
      {children}
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label="Cambiar el ancho de la columna"
        title="Arrastre para cambiar el ancho (doble clic: ancho por defecto)"
        onMouseDown={onMouseDown}
        onDoubleClick={() => onResize(col, -1)}
        style={{ position: 'absolute', top: 0, right: 0, width: 6, height: '100%', cursor: 'col-resize', borderRight: '2px solid var(--mantine-color-default-border)' }}
      />
    </Table.Th>
  );
}
