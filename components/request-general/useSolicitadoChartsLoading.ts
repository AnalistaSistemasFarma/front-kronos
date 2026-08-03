'use client';

import { useState } from 'react';
import { useSolicitadoData } from './SolicitadoShell';

/**
 * Clave de animación: cambia al montar la pestaña y al cambiar el periodo.
 * ChartBox anima 0 → valor al cambiar esta clave.
 */
export function useSolicitadoChartEntranceKey(): string {
  const { appliedRange } = useSolicitadoData();
  const [mountId] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  return `${mountId}|${appliedRange}`;
}
