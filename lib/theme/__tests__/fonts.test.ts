import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyFontToDocument,
  DEFAULT_FONT_KEY,
  FONT_STACKS,
  FONT_STORAGE_KEY,
  FONTS,
  isValidFontKey,
  readStoredFont,
  resolveFontStack,
} from '../fonts';
import { buildInitScript } from '../../../components/theme/ThemeInitScript';

/** :root mínimo: solo lo que tocan applyFontToDocument y el script de arranque */
function raizFalsa() {
  const props = new Map<string, string>();
  const attrs = new Map<string, string>();
  return {
    props,
    attrs,
    style: { setProperty: (k: string, v: string) => props.set(k, v) },
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
    classList: { toggle: () => undefined },
  };
}

describe('Catálogo de fuentes de la interfaz (Perfil)', () => {
  it('trae la predeterminada de SynerLink y la de SAPSEND', () => {
    const porClave = Object.fromEntries(FONTS.map((f) => [f.key, f]));
    expect(porClave.sistema.label).toBe('Predeterminada (SynerLink)');
    expect(porClave.sapsend.label).toBe('Google Sans (SAPSEND)');
    expect(porClave.sapsend.webFont).toBe(true);
    expect(DEFAULT_FONT_KEY).toBe('sistema');
  });

  it('las claves son únicas y caben en la columna uiFont', () => {
    const claves = FONTS.map((f) => f.key);
    expect(new Set(claves).size).toBe(claves.length);
    for (const k of claves) expect(k).toMatch(/^[a-z0-9-]{1,40}$/);
  });

  it('la de SAPSEND usa la variable de next/font y deja respaldo del sistema', () => {
    const pila = resolveFontStack('sapsend');
    expect(pila.startsWith('var(--font-google-sans')).toBe(true);
    expect(pila).toContain('sans-serif');
    expect(FONT_STACKS.sapsend).toBe(pila);
  });

  it('valida contra el catálogo: lo que no está no pasa (nada de CSS arbitrario)', () => {
    expect(isValidFontKey('sapsend')).toBe(true);
    expect(isValidFontKey('Comic Sans')).toBe(false);
    expect(isValidFontKey('x; } body { color:red')).toBe(false);
    expect(isValidFontKey(null)).toBe(false);
    expect(resolveFontStack('no-existe')).toBe(resolveFontStack(DEFAULT_FONT_KEY));
  });

  it('ninguna pila del catálogo trae caracteres que rompan la declaración CSS', () => {
    for (const f of FONTS) expect(f.stack).not.toMatch(/[;{}<>]/);
  });
});

describe('Aplicar la fuente al documento', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('redefine --font-sans y deja data-font', () => {
    const r = raizFalsa();
    vi.stubGlobal('document', { documentElement: r });
    applyFontToDocument('sapsend');
    expect(r.props.get('--font-sans')).toBe(FONT_STACKS.sapsend);
    expect(r.attrs.get('data-font')).toBe('sapsend');
  });

  it('una clave inválida vuelve a la predeterminada', () => {
    const r = raizFalsa();
    vi.stubGlobal('document', { documentElement: r });
    applyFontToDocument('inyectada');
    expect(r.attrs.get('data-font')).toBe(DEFAULT_FONT_KEY);
  });

  it('readStoredFont solo devuelve claves del catálogo', () => {
    const store = new Map<string, string>([[FONT_STORAGE_KEY, 'sapsend']]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null });
    expect(readStoredFont()).toBe('sapsend');
    store.set(FONT_STORAGE_KEY, 'otra');
    expect(readStoredFont()).toBeNull();
  });
});

describe('Script de arranque: la fuente guardada se aplica antes de pintar', () => {
  function correr(pathname: string, guardada: string | null) {
    const r = raizFalsa();
    const store = new Map<string, string>();
    if (guardada !== null) store.set(FONT_STORAGE_KEY, guardada);
    runInNewContext(buildInitScript(), {
      document: { documentElement: r },
      location: { pathname },
      localStorage: { getItem: (k: string) => store.get(k) ?? null },
    });
    return r;
  }

  it('con SAPSEND guardada, --font-sans ya llega con Google Sans', () => {
    const r = correr('/process', 'sapsend');
    expect(r.props.get('--font-sans')).toBe(FONT_STACKS.sapsend);
    expect(r.attrs.get('data-font')).toBe('sapsend');
  });

  it('la portada pública no hereda la fuente de nadie', () => {
    const r = correr('/', 'sapsend');
    expect(r.props.has('--font-sans')).toBe(false);
  });

  it('un valor guardado que no es del catálogo se ignora', () => {
    const r = correr('/process', 'x;}body{');
    expect(r.props.has('--font-sans')).toBe(false);
  });
});
