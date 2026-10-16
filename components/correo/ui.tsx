'use client';

import { Avatar, type MantineSize } from '@mantine/core';
import {
  IconAlertOctagon,
  IconArchive,
  IconFolder,
  IconInbox,
  IconPencil,
  IconSend,
  IconTrash,
} from '@tabler/icons-react';
import type { Carpeta } from '../../lib/correo/types';

/** Piezas visuales compartidas de la bandeja y del hilo (estilo Gmail con el tema de SynerLink). */

const COLORES = ['blue', 'teal', 'grape', 'orange', 'indigo', 'cyan', 'pink', 'green', 'violet', 'red'] as const;

export function iniciales(nombre: string, correo = ''): string {
  const base = (nombre || correo || '?').replace(/[<>"']/g, '').trim();
  const partes = base.split(/[\s.@_-]+/).filter(Boolean);
  if (partes.length === 0) return '?';
  const a = partes[0][0] ?? '';
  const b = partes.length > 1 ? partes[1][0] ?? '' : '';
  return `${a}${b}`.toUpperCase();
}

export function colorPersona(clave: string): (typeof COLORES)[number] {
  let h = 0;
  for (const c of clave.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORES[h % COLORES.length];
}

export function AvatarPersona({ nombre, correo, size = 'md' }: { nombre: string; correo: string; size?: MantineSize | number }) {
  return (
    <Avatar size={size} radius='xl' color={colorPersona(correo || nombre)} variant='filled' aria-hidden style={{ flexShrink: 0 }}>
      {iniciales(nombre, correo)}
    </Avatar>
  );
}

/** Tipo de carpeta de Outlook según su nombre (Graph devuelve el nombre en el idioma del buzón). */
export type TipoCarpeta = 'entrada' | 'enviados' | 'borradores' | 'eliminados' | 'spam' | 'archivo' | 'otra';

export function tipoCarpeta(c: Pick<Carpeta, 'nombre'>): TipoCarpeta {
  const n = c.nombre.toLowerCase();
  if (/bandeja de entrada|^inbox$|recibidos/.test(n)) return 'entrada';
  if (/enviados|^sent/.test(n)) return 'enviados';
  if (/borradores|^drafts?$/.test(n)) return 'borradores';
  if (/eliminados|papelera|deleted|trash/.test(n)) return 'eliminados';
  if (/no deseado|junk|spam/.test(n)) return 'spam';
  if (/^archiv/.test(n)) return 'archivo';
  return 'otra';
}

const ORDEN: TipoCarpeta[] = ['entrada', 'enviados', 'borradores', 'archivo', 'spam', 'eliminados', 'otra'];
const OCULTAS = /bandeja de salida|^outbox$|historial de conversaciones|conversation history|rss|sync issues|problemas de sincronizaci/i;

export const NOMBRE_CARPETA: Partial<Record<TipoCarpeta, string>> = {
  entrada: 'Recibidos',
  enviados: 'Enviados',
  borradores: 'Borradores',
  eliminados: 'Papelera',
  spam: 'Spam',
  archivo: 'Archivo',
};

/** Carpetas para la barra lateral: Recibidos primero, luego Enviados, Borradores… y las propias. */
export function carpetasOrdenadas(carpetas: Carpeta[]): Array<Carpeta & { tipo: TipoCarpeta; etiqueta: string }> {
  return carpetas
    .filter((c) => !OCULTAS.test(c.nombre))
    .map((c) => {
      const tipo = tipoCarpeta(c);
      return { ...c, tipo, etiqueta: NOMBRE_CARPETA[tipo] ?? c.nombre };
    })
    .sort((a, b) => ORDEN.indexOf(a.tipo) - ORDEN.indexOf(b.tipo) || a.etiqueta.localeCompare(b.etiqueta, 'es'));
}

export function IconoCarpeta({ tipo, size = 18 }: { tipo: TipoCarpeta; size?: number }) {
  switch (tipo) {
    case 'entrada':
      return <IconInbox size={size} />;
    case 'enviados':
      return <IconSend size={size} />;
    case 'borradores':
      return <IconPencil size={size} />;
    case 'eliminados':
      return <IconTrash size={size} />;
    case 'spam':
      return <IconAlertOctagon size={size} />;
    case 'archivo':
      return <IconArchive size={size} />;
    default:
      return <IconFolder size={size} />;
  }
}
