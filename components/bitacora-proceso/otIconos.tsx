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
import type { OtIcono } from '../../lib/bitacora-proceso/constants';

/**
 * Íconos de Tabler para las actividades de la bitácora (lista cerrada; la base
 * guarda solo la clave). No son los pictogramas del documento de Farmalógica.
 */
type TablerIcon = ComponentType<{ size?: number; stroke?: number }>;

export const OT_ICONO_COMPONENTE: Record<OtIcono, TablerIcon> = {
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

export function OtIconoActividad({ icono, size = 28 }: { icono: string | null | undefined; size?: number }) {
  const Icon = icono ? OT_ICONO_COMPONENTE[icono as OtIcono] : undefined;
  return Icon ? <Icon size={size} stroke={1.6} /> : null;
}
