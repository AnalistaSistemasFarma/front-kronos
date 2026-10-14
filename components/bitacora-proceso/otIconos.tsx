'use client';

import type { ComponentType } from 'react';
import {
  IconArrowsExchange,
  IconBuildingFactory2,
  IconCircleDot,
  IconCircles,
  IconClipboardCheck,
  IconDots,
  IconFlask,
  IconMicroscope,
  IconPackageImport,
  IconScale,
  IconSun,
  IconTemperature,
  IconTool,
  IconTools,
  IconToolsKitchen2,
  IconVaccineBottle,
  IconWind,
} from '@tabler/icons-react';
import { otPictograma, type OT_PICTOGRAMAS, type OtIcono } from '../../lib/bitacora-proceso/constants';

/**
 * Íconos de las actividades de la bitácora (lista cerrada; la base guarda solo la
 * clave): los 3 pictogramas de la especificación de Farmalógica y, para el resto,
 * íconos de Tabler.
 */
type TablerIcon = ComponentType<{ size?: number; stroke?: number }>;

export const OT_ICONO_COMPONENTE: Record<Exclude<OtIcono, keyof typeof OT_PICTOGRAMAS>, TablerIcon> = {
  tapon: IconCircleDot,
  'materia-prima': IconPackageImport,
  agrafe: IconCircles,
  control: IconClipboardCheck,
  autoclave: IconTemperature,
  uv: IconSun,
  pesaje: IconScale,
  viables: IconMicroscope,
  'no-viables': IconWind,
  'ajuste-operario': IconTool,
  'ajuste-mantenimiento': IconTools,
  formato: IconArrowsExchange,
  refrigerio: IconToolsKitchen2,
  frasco: IconVaccineBottle,
  laboratorio: IconFlask,
  equipo: IconBuildingFactory2,
  otra: IconDots,
};

/** Ícono de la actividad: pictograma de la especificación (imagen) o ícono de Tabler. */
export function OtIconoActividad({ icono, size = 28 }: { icono: string | null | undefined; size?: number }) {
  const src = otPictograma(icono);
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- imagen estática pequeña (~8 KB) servida desde /public
    return <img src={src} alt='' width={size} height={size} style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0 }} />;
  }
  const Icon = icono ? OT_ICONO_COMPONENTE[icono as keyof typeof OT_ICONO_COMPONENTE] : undefined;
  return Icon ? <Icon size={size} stroke={1.6} /> : null;
}
