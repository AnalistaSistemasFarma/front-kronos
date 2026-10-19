/**
 * Catálogo de tipografías seleccionables por el usuario.
 *
 * POR QUÉ EXISTE: la cadena de fuentes del sistema no da el mismo resultado en
 * todos los equipos. Nicolás lo notó en su Android: `system-ui` lo resuelve el
 * NAVEGADOR, y Chrome no lee la fuente del tema del fabricante, así que la
 * aplicación se veía distinta al resto del celular. Dejarlo a criterio del
 * navegador no tenía arreglo confiable; que el usuario escoja, sí.
 *
 * FAMILIAS DEL SISTEMA, salvo excepciones marcadas con `webFont`: cargar una
 * tipografía por gusto personal no debe costarle peso de descarga a TODOS los
 * usuarios. La única fuente web (Google Sans, la de SAPSEND, 2026-10-16) se
 * declara con `preload: false` en lib/theme/fontFaces.ts: el navegador solo la
 * descarga cuando alguien la usa.
 *
 * PARA AGREGAR UNA FUENTE: una entrada aquí (clave nueva, sin migración: la
 * columna `uiFont` guarda la clave en NVARCHAR(1000)) y, si es web, su
 * `localFont` en fontFaces.ts con su propia variable CSS.
 *
 * Cada opción es una cadena CSS completa que se inyecta en `--font-sans`, la
 * única fuente de verdad de la tipografía (ver app/globals.css y
 * lib/theme/mantineTheme.ts, que la lee con `var()`).
 */

export interface FontOption {
  /** Clave estable que se persiste en el perfil y en localStorage */
  key: string;
  /** Nombre visible para el usuario */
  label: string;
  /** Explicación corta de qué esperar */
  hint: string;
  /** Cadena CSS que se inyecta en --font-sans */
  stack: string;
  /** true si es una fuente web autoalojada (se descarga al usarla) */
  webFont?: boolean;
}

/** Respaldo del sistema que va detrás de cualquier fuente web */
const SYSTEM_STACK = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const FONTS: FontOption[] = [
  {
    key: 'sistema',
    label: 'Predeterminada (SynerLink)',
    hint: 'La que trae SynerLink. Es la que se ve hoy.',
    stack: SYSTEM_STACK,
  },
  {
    // La de SAPSEND (2026-10-16). SAPSEND usa Product Sans, de licencia
    // propietaria; esta es Google Sans, su sucesora con licencia abierta (OFL).
    // `--font-google-sans` la define next/font en <html> (fontFaces.ts); el
    // nombre de respaldo cubre el caso en que la variable no exista.
    key: 'sapsend',
    label: 'Google Sans (SAPSEND)',
    hint: 'La misma letra de SAPSEND. Se descarga una sola vez (unos 36 KB) solo si la escoge.',
    stack: `var(--font-google-sans, "Google Sans"), ${SYSTEM_STACK}`,
    webFont: true,
  },
  {
    key: 'dispositivo',
    // `sans-serif` a secas es el alias que el sistema operativo mapea a su
    // propia fuente. Es la única opción que puede tomar la del equipo, aunque
    // el navegador tiene la última palabra.
    label: 'La de mi dispositivo',
    hint: 'Deja que su celular o computador decida. En algunos equipos no cambia nada.',
    stack: 'sans-serif',
  },
  {
    key: 'serif',
    label: 'Con serifas',
    hint: 'Estilo documento, más para leer que para operar.',
    stack: 'Georgia, "Times New Roman", "Noto Serif", serif',
  },
  {
    key: 'mono',
    label: 'Monoespaciada',
    hint: 'Todos los caracteres del mismo ancho. Cómoda para datos y códigos.',
    stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  },
];

/** Tipografía por defecto: la de siempre, para que nadie note un cambio que no pidió */
export const DEFAULT_FONT_KEY = 'sistema';

/** Clave de localStorage donde se persiste la tipografía elegida */
export const FONT_STORAGE_KEY = 'theme-font';

const FONT_KEY_SET = new Set(FONTS.map((f) => f.key));

/**
 * Clave → cadena CSS, para el script de arranque (ThemeInitScript), que aplica
 * la fuente guardada ANTES de pintar: así no se ve primero la predeterminada y
 * luego la del usuario.
 */
export const FONT_STACKS: Record<string, string> = Object.fromEntries(
  FONTS.map((f) => [f.key, f.stack]),
);

export function isValidFontKey(key: unknown): key is string {
  return typeof key === 'string' && FONT_KEY_SET.has(key);
}

/** Resuelve una clave a su cadena CSS, con respaldo al default */
export function resolveFontStack(key: unknown): string {
  const found = FONTS.find((f) => f.key === key);
  return (found ?? FONTS.find((f) => f.key === DEFAULT_FONT_KEY)!).stack;
}

/** Lee la tipografía guardada en localStorage; null si no hay o no es válida */
export function readStoredFont(): string | null {
  try {
    const stored = localStorage.getItem(FONT_STORAGE_KEY);
    return isValidFontKey(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Aplica la tipografía al documento redefiniendo `--font-sans` en :root.
 *
 * Con eso queda cubierta TODA la aplicación de una sola vez —CSS propio y
 * componentes de Mantine— porque el tema también lee esa variable. El atributo
 * `data-font` no se usa para pintar: sirve para depurar y para reglas futuras.
 */
export function applyFontToDocument(key: unknown): void {
  const resolved = isValidFontKey(key) ? key : DEFAULT_FONT_KEY;
  const raiz = document.documentElement;
  raiz.style.setProperty('--font-sans', resolveFontStack(resolved));
  raiz.setAttribute('data-font', resolved);
}
