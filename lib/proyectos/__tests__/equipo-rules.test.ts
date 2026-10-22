import { describe, expect, it } from 'vitest';
import {
  capacidadesEquipo,
  diferencias,
  editorApruebaEquipo,
  esSlugValido,
  herramientasADb,
  herramientasDeDb,
  herramientasDisponibles,
  normalizarConfig,
  normalizarCorrida,
  normalizarMiembro,
  slugDe,
} from '../equipo-rules';

/* Equipo de subagentes (F2, 2026-10-18): reglas puras. */

describe('permisos por rol', () => {
  it('lector ve; editor pide; solo el dueño aprueba y configura (el editor aprueba solo con la bandera)', () => {
    expect(capacidadesEquipo('reader', false, false)).toEqual({ ver: true, sugerir: false, aprobar: false, configurar: false });
    expect(capacidadesEquipo('editor', false, false)).toEqual({ ver: true, sugerir: true, aprobar: false, configurar: false });
    expect(capacidadesEquipo('editor', false, true)).toEqual({ ver: true, sugerir: true, aprobar: true, configurar: false });
    expect(capacidadesEquipo('owner', false, false)).toEqual({ ver: true, sugerir: true, aprobar: true, configurar: true });
    expect(capacidadesEquipo('owner', true, true)).toEqual({ ver: true, sugerir: false, aprobar: false, configurar: false });
    expect(capacidadesEquipo(null, false, true).ver).toBe(false);
  });
  it('la bandera del editor está APAGADA por defecto y solo se enciende con «1»', () => {
    expect(editorApruebaEquipo({})).toBe(false);
    expect(editorApruebaEquipo({ PROYECTOS_EQUIPO_EDITOR_APRUEBA: 'true' })).toBe(false);
    expect(editorApruebaEquipo({ PROYECTOS_EQUIPO_EDITOR_APRUEBA: '1' })).toBe(true);
  });
});

describe('catálogo cerrado', () => {
  it('lo que admite cada perfil', () => {
    expect(herramientasDisponibles('sin-conectores')).toEqual(['archivos', 'trabajo']);
    expect(herramientasDisponibles('ryan')).toEqual(['archivos', 'trabajo', 'conectores']);
    expect(herramientasDisponibles('comex-latam')).toEqual(['archivos', 'trabajo', 'web', 'conectores']);
    expect(herramientasDisponibles('inventado')).toEqual(['archivos']);
  });
  it('de la persona: fuera del catálogo o no admitido por el perfil se rechaza; «archivos» siempre', () => {
    const disp = herramientasDisponibles('ryan');
    expect(normalizarMiembro({ name: 'Analista', purpose: 'x', tools: ['bash'] }, disp)).toMatchObject({ ok: false });
    expect(normalizarMiembro({ name: 'Analista', purpose: 'x', tools: ['web'] }, disp)).toMatchObject({ ok: false });
    expect(normalizarMiembro({ name: 'Analista', purpose: 'x', tools: [], model: 'gpt' }, disp)).toMatchObject({ ok: false });
    const ok = normalizarMiembro({ name: '  Analista   de SAP ', purpose: 'Lotes', tools: ['conectores'], model: 'sonnet' }, disp);
    expect(ok).toEqual({ ok: true, value: { name: 'Analista de SAP', purpose: 'Lotes', instructions: null, tools: ['archivos', 'conectores'], model: 'sonnet' } });
  });
  it('de la sugerencia (tolerante): recorta en vez de rechazar', () => {
    const r = normalizarMiembro({ name: 'Investigador', purpose: 'Normas', tools: ['web', 'bash', 'conectores'], model: 'gpt' }, herramientasDisponibles('ryan'), { tolerante: true });
    expect(r).toEqual({ ok: true, value: { name: 'Investigador', purpose: 'Normas', instructions: null, tools: ['archivos', 'conectores'], model: null } });
  });
  it('CSV de la base: lo desconocido se ignora y «archivos» va primero', () => {
    expect(herramientasDeDb('conectores,bash,web')).toEqual(['archivos', 'web', 'conectores']);
    expect(herramientasADb(['conectores', 'trabajo'])).toBe('archivos,trabajo,conectores');
  });
});

describe('identificadores (subagent_type)', () => {
  it('sin tildes, en minúsculas, únicos y sin nombres reservados de Claude Code', () => {
    expect(slugDe('Investigador de Regulación Sanitaria')).toBe('investigador-de-regulacion-sanitar'); // 34: deja espacio al sufijo;
    expect(slugDe('Analista', ['analista', 'analista-2'])).toBe('analista-3');
    expect(slugDe('General Purpose')).toBe('general-purpose-equipo');
    expect(slugDe('Explore')).toBe('explore-equipo');
    expect(slugDe('¿?')).toBe('subagente');
    expect(esSlugValido('general-purpose')).toBe(false);
    expect(esSlugValido('../x')).toBe(false);
    expect(esSlugValido('analista-sap')).toBe(true);
  });
});

describe('configuración y auditoría', () => {
  it('tope de simultáneos de 1 a 5', () => {
    expect(normalizarConfig({ maxParallel: 6 })).toMatchObject({ ok: false });
    expect(normalizarConfig({ maxParallel: 2.5 })).toMatchObject({ ok: false });
    expect(normalizarConfig({ enabled: 'si' })).toMatchObject({ ok: false });
    expect(normalizarConfig({})).toMatchObject({ ok: false });
    expect(normalizarConfig({ maxParallel: 3, enabled: false })).toEqual({ ok: true, value: { maxParallel: 3, enabled: false } });
  });
  it('diferencias legibles', () => {
    const a = { name: 'A', purpose: 'p', instructions: null, tools: ['archivos' as const], model: null };
    expect(diferencias(a, { ...a, name: 'B', tools: ['archivos', 'web'] })).toEqual({ name: ['A', 'B'], tools: [['archivos'], ['archivos', 'web']] });
  });
  it('corridas del puente: entrada no confiable', () => {
    expect(normalizarCorrida({ slug: '../x' })).toBeNull();
    expect(normalizarCorrida({ slug: 'redactor', status: 'otro', totalTokens: -3, description: '' })).toMatchObject({ status: 'cancelado', totalTokens: 0, description: 'Sin descripción' });
  });
});
