'use client';

import type { ReactNode } from 'react';
import { KpiTile } from '../ui/panel/Panel';

/**
 * Indicador del Dashboard personal (mismo diseño de los paneles del Monitor).
 * `color` se conserva por compatibilidad: el diseño usa un solo acento.
 */
export function PersonalInsightCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: ReactNode;
  color?: string;
}) {
  return <KpiTile icon={icon} label={label} value={value} foot={hint} textValue />;
}
