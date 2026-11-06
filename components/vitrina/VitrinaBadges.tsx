'use client';

import { Badge, type BadgeProps } from '@mantine/core';
import {
  CANAL_LABEL,
  ESTADO_COLOR,
  ESTADO_LABEL,
  REGISTRO_COLOR,
  REGISTRO_LABEL,
  VISIBILIDAD_COLOR,
  VISIBILIDAD_LABEL,
  type VitrinaCanal,
  type VitrinaEstado,
  type VitrinaRegistroEstado,
  type VitrinaVisibilidad,
} from '../../lib/vitrina/constants';
import { fmtFecha } from './vitrinaClient';

/** Etiquetas de estado de la Vitrina, con los colores del tema de Mantine (claro, oscuro y paletas). */
type P = Omit<BadgeProps, 'children' | 'color'>;

export function RegistroBadge({ estado, venceEn, ...p }: P & { estado: string; venceEn?: string | null }) {
  const e = estado as VitrinaRegistroEstado;
  const texto = REGISTRO_LABEL[e] ?? estado;
  const fecha = venceEn && (e === 'POR_VENCER' || e === 'VENCIDO' || e === 'VIGENTE') ? ` · ${fmtFecha(`${venceEn}T12:00:00Z`)}` : '';
  return (
    <Badge variant='light' color={REGISTRO_COLOR[e] ?? 'gray'} size='sm' {...p}>
      {texto}
      {fecha}
    </Badge>
  );
}

export function EstadoBadge({ estado, ...p }: P & { estado: string }) {
  return (
    <Badge variant='light' color={ESTADO_COLOR[estado as VitrinaEstado] ?? 'gray'} size='sm' {...p}>
      {ESTADO_LABEL[estado as VitrinaEstado] ?? estado}
    </Badge>
  );
}

export function VisibilidadBadge({ visibilidad, ...p }: P & { visibilidad: string }) {
  if (visibilidad === 'OCULTA') {
    return (
      <Badge variant='outline' color='gray' size='sm' {...p}>
        No visible
      </Badge>
    );
  }
  return (
    <Badge variant='light' color={VISIBILIDAD_COLOR[visibilidad as VitrinaVisibilidad] ?? 'gray'} size='sm' {...p}>
      {VISIBILIDAD_LABEL[visibilidad as VitrinaVisibilidad] ?? visibilidad}
    </Badge>
  );
}

export function CanalBadge({ canal, ...p }: P & { canal: string }) {
  if (canal === 'SIN_DATO') return null;
  return (
    <Badge variant='outline' size='sm' {...p}>
      Canal {CANAL_LABEL[canal as VitrinaCanal]?.toLowerCase() ?? canal}
    </Badge>
  );
}
