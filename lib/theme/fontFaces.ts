import localFont from 'next/font/local';

/**
 * Fuentes WEB que el catálogo de lib/theme/fonts.ts puede usar.
 *
 * Google Sans (2026-10-16, pedido de Nicolás: «SAPSEND tiene una fuente;
 * quiero añadirla como otra fuente desde Perfil»). SAPSEND usa Product Sans,
 * que tiene licencia propietaria de Google (solo para productos de Google), así
 * que NO se copia. Google Sans es su sucesora directa y Google la publicó con
 * licencia abierta SIL OFL 1.1 (ver ./fuentes/google-sans/OFL.txt): mismo
 * diseño, uso libre.
 *
 * Archivos autoalojados con next/font/local (la versión de next/font/google de
 * Next 15.5 no la trae en su catálogo): subconjunto «latin» de Google Sans
 * Fonts, fuente variable (peso 400–700), normal ~35 KB e itálica ~38 KB. El
 * subconjunto latin cubre todo el español (tildes, ñ, ü, ¿, ¡).
 *
 * POR QUÉ ASÍ:
 *   - `preload: false`: la regla @font-face se declara para todos, pero el
 *     navegador SOLO descarga el archivo cuando algún texto la usa, es decir,
 *     cuando el usuario la escoge (o abre la vista previa del Perfil). Quien
 *     no la escoge no paga nada.
 *   - `display: 'swap'` + `adjustFontFallback`: mientras llega el archivo se
 *     pinta una fuente de respaldo con las métricas ajustadas a Google Sans,
 *     así que el cambio no mueve el contenido (sin salto de diseño).
 *   - `variable`: expone `--font-google-sans` en <html> (app/layout.tsx); el
 *     catálogo la usa dentro de `--font-sans`, que es lo que leen el CSS propio
 *     y el tema de Mantine. PDF y correos tienen sus propias fuentes y no leen
 *     esa variable, así que no cambian.
 */
export const googleSans = localFont({
  src: [
    { path: './fuentes/google-sans/GoogleSans-latin.woff2', weight: '400 700', style: 'normal' },
    { path: './fuentes/google-sans/GoogleSans-Italic-latin.woff2', weight: '400 700', style: 'italic' },
  ],
  variable: '--font-google-sans',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Arial',
});

/** Clases que definen las variables de las fuentes web; van en <html> */
export const FONT_FACE_VARIABLES = googleSans.variable;
