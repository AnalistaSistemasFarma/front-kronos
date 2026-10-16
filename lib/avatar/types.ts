/**
 * Tipos del avatar estilo Notion, dibujado con DiceBear 9 (estilo "Lorelei",
 * @dicebear/lorelei).
 *
 * Un avatar NO es una imagen guardada: es una CONFIGURACIÓN pequeña (las
 * opciones de Lorelei elegidas) que se convierte en SVG al vuelo con
 * `createAvatar(lorelei, opciones)`. Personas y asistentes usan Lorelei; los
 * asistentes tienen además CABEZAS-FIGURA (animal, planeta, constelación,
 * estrella, robot: ver cabezas.ts) como opciones extra de la cabeza, sobre las
 * que se componen las demás partes de Lorelei.
 */

/** Componentes de Lorelei que siempre se dibujan. */
export type ParteFija = 'hair' | 'head' | 'eyes' | 'eyebrows' | 'mouth' | 'nose';

/** Componentes de Lorelei con probabilidad (pueden ir vacíos: "Ninguno"). */
export type ParteOpcional = 'glasses' | 'earrings' | 'beard' | 'freckles' | 'hairAccessories';

/** Colores que se pueden elegir en el editor. */
export type ColorAvatar = 'hairColor' | 'skinColor' | 'backgroundColor';

/** Dueño del avatar: cambia las reglas (los asistentes solo sonríen y tienen cabezas-figura). */
export type AvatarOwner = 'user' | 'agent';

/**
 * Lo que se guarda en dbo.avatar_config.config_json (versión 3).
 *
 * - Las partes son nombres de variante de Lorelei (`variant07`, `happy03`…);
 *   en las opcionales, null = ninguno.
 * - `head` de un ASISTENTE puede ser además una cabeza-figura
 *   (`figura:zorro`, `figura:saturno`…); solo con ella `hair` puede ser
 *   null (sin pelo).
 * - Colores en hexadecimal de 6 dígitos sin "#" (el fondo admite además
 *   `transparent`). En una cabeza-figura, la piel es su relleno y el color de
 *   cabello, sus acentos.
 * - `seed`: semilla con la que se generó (en los asistentes, su nombre). Como
 *   todas las partes van explícitas, el dibujo no depende de ella.
 */
export interface AvatarConfig
  extends Record<Exclude<ParteFija, 'hair'>, string>,
    Record<ParteOpcional, string | null>,
    Record<ColorAvatar, string> {
  v: 3;
  estilo: 'lorelei';
  seed: string;
  /** Variante de pelo de Lorelei; null (sin pelo) solo con una cabeza-figura. */
  hair: string | null;
  /** Opción `flip` de DiceBear 9 (booleano: espejo horizontal). */
  flip: boolean;
}
