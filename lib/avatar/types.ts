/**
 * Tipos del avatar estilo Notion, dibujado con DiceBear (estilo "Lorelei").
 *
 * Un avatar NO es una imagen guardada: es una CONFIGURACIÓN pequeña (las
 * opciones de Lorelei elegidas) que se convierte en SVG al vuelo con
 * `createAvatar(lorelei, opciones)`. Así se guarda en unos pocos bytes y el
 * dibujo sale siempre de la librería: ninguna cadena del usuario termina
 * dentro del SVG (todo se valida contra el esquema de Lorelei).
 */

/** Partes de Lorelei que siempre llevan un valor. */
export type ParteFija = 'hair' | 'head' | 'eyes' | 'eyebrows' | 'mouth' | 'nose';

/** Partes de Lorelei que pueden ir vacías ("Ninguno"). */
export type ParteOpcional = 'glasses' | 'beard' | 'earrings' | 'freckles' | 'hairAccessories';

/** Colores que se pueden elegir en el editor. */
export type ColorAvatar = 'hairColor' | 'skinColor' | 'backgroundColor';

/**
 * Lo que se guarda en dbo.avatar_config.config_json (versión 2).
 *
 * - Las partes son los nombres de variante del esquema de Lorelei
 *   (`variant07`, `happy03`…); en las opcionales, null = ninguno.
 * - Los colores van en hexadecimal de 6 dígitos sin "#" (el fondo admite
 *   además `transparent`).
 * - `seed` es la semilla con la que se generó el avatar (aleatorio o el
 *   nombre del asistente). Como todas las partes van explícitas, el dibujo
 *   no depende de ella; se guarda para trazabilidad.
 */
export interface AvatarConfig extends Record<ParteFija, string>, Record<ParteOpcional, string | null>, Record<ColorAvatar, string> {
  v: 2;
  estilo: 'lorelei';
  seed: string;
  flip: boolean;
}
