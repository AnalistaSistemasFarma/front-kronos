/**
 * Tipos del avatar estilo Notion (inspirado en Avatartion, MIT).
 *
 * Un avatar NO es una imagen guardada: es una CONFIGURACIÓN pequeña (índices
 * de partes) que se compone en SVG al vuelo. Así se guarda en unos pocos bytes
 * y el dibujo final sale siempre del catálogo de este repositorio: ninguna
 * cadena que llegue del usuario termina dentro del SVG.
 */

/** Una opción de una categoría (p. ej. "Cabello corto"). */
export interface AvatarOption {
  /** Nombre visible en la interfaz (español, formal). */
  label: string;
  /** Marcado SVG (sin la etiqueta <svg>) en el lienzo de 300×300. */
  svg: string;
  /**
   * Capa de ATRÁS, opcional: lo que debe quedar detrás de la cabeza y del
   * cuerpo (p. ej. el cabello largo cae por detrás de los hombros).
   */
  back?: string;
}

/** Una categoría de partes (Cara, Cabello, Ojos…). */
export interface AvatarCategory {
  /** Clave estable que se guarda en la configuración. NO renombrar. */
  id: string;
  /** Texto del botón (singular). */
  label: string;
  /** Título del selector (plural), como en Avatartion ("Faces", "Hairs"…). */
  title: string;
  options: AvatarOption[];
  /**
   * Recorte (viewBox) para la miniatura del botón: muestra solo la zona donde
   * vive la parte, igual que Avatartion amplía cada pieza en su botón.
   */
  thumbViewBox: string;
  /** Se puede dejar vacía (índice de "Ninguno") al generar al azar. */
  optional?: boolean;
}

/** Tipo de avatar: persona (perfil) o animal (agentes). */
export type AvatarKind = 'persona' | 'animal';

/** Lo que se guarda en la base: versión, tipo, índice por categoría y fondo. */
export interface AvatarConfig {
  v: 1;
  tipo: AvatarKind;
  /** Índice (base 0) de la opción elegida en cada categoría. */
  partes: Record<string, number>;
  /** Índice (base 0) dentro de AVATAR_BACKGROUNDS. */
  fondo: number;
}

/** Un fondo disponible. `color` null = transparente. */
export interface AvatarBackground {
  label: string;
  color: string | null;
}
