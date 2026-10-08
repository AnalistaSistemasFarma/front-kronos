/**
 * Tipos del avatar estilo Notion, dibujado con DiceBear 10 (estilo "Lorelei"
 * de @dicebear/styles).
 *
 * Un avatar NO es una imagen guardada: es una CONFIGURACIÓN pequeña (las
 * opciones de Lorelei elegidas) que se convierte en SVG al vuelo con
 * `new Avatar(lorelei, opciones)`. Todos los avatares —personas y asistentes
 * del chat— son personas Lorelei; no hay otros tipos.
 */

/** Componentes de Lorelei que siempre se dibujan. */
export type ParteFija = 'hair' | 'head' | 'eyes' | 'eyebrows' | 'mouth' | 'nose';

/** Componentes de Lorelei con probabilidad (pueden ir vacíos: "Ninguno"). */
export type ParteOpcional = 'glasses' | 'earrings' | 'beard' | 'freckles' | 'hairAccessories';

/** Colores que se pueden elegir en el editor. */
export type ColorAvatar = 'hairColor' | 'skinColor' | 'backgroundColor';

/** Valores de la opción `flip` de DiceBear 10. */
export type FlipAvatar = 'none' | 'horizontal' | 'vertical' | 'both';

/** Dueño del avatar: cambia las reglas (los asistentes solo sonríen). */
export type AvatarOwner = 'user' | 'agent';

/**
 * Lo que se guarda en dbo.avatar_config.config_json (versión 3).
 *
 * - Las partes son nombres de variante de Lorelei (`variant07`, `happy03`…);
 *   en las opcionales, null = ninguno.
 * - Colores en hexadecimal de 6 dígitos sin "#" (el fondo admite además
 *   `transparent`).
 * - `seed`: semilla con la que se generó (en los asistentes, su nombre). Como
 *   todas las partes van explícitas, el dibujo no depende de ella.
 */
export interface AvatarConfig
  extends Record<ParteFija, string>,
    Record<ParteOpcional, string | null>,
    Record<ColorAvatar, string> {
  v: 3;
  estilo: 'lorelei';
  seed: string;
  flip: FlipAvatar;
}
