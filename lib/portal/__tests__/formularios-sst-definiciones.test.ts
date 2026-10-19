import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import perfil from '../formularios/sst-01-fr-001.json';
import reporte from '../formularios/sst-reporte-actos-condiciones.json';
import salud from '../formularios/sst-condiciones-salud-osteomuscular.json';
import { PREFIJO_OTRAS, validarDefinicion, validarRespuestas, type DefinicionFormulario, type PreguntaFormulario, type Respuestas } from '../formulario';

// Los dos formularios SST que se replican desde Microsoft Forms (Cristian Baldión, 2026-10-19), con datos inventados.

const valida = (crudo: unknown): DefinicionFormulario => {
  const r = validarDefinicion(crudo);
  if (!r.ok) throw new Error(r.errores.join(' | '));
  return r.definicion;
};
const REPORTE = valida(reporte);
const SALUD = valida(salud);
const porId = (d: DefinicionFormulario, id: string) => d.preguntas.find((p) => p.id === id) as PreguntaFormulario;

/** Una respuesta válida para cada pregunta, según su tipo. */
function respuestaValida(p: PreguntaFormulario): Respuestas[string] {
  switch (p.tipo) {
    case 'seleccion':
    case 'seleccion_multiple':
      return p.tipo === 'seleccion' ? (p.opciones as string[])[0] : [(p.opciones as string[])[0]];
    case 'si_no':
      return 'Sí';
    case 'escala':
      return String(p.escala?.min ?? 0);
    default:
      return 'Dato de prueba';
  }
}
const completas = (d: DefinicionFormulario): Respuestas => Object.fromEntries(d.preguntas.map((p) => [p.id, respuestaValida(p)]));

describe('las dos definiciones son válidas y distintas de las que ya existen', () => {
  it('pasan la validación del portal y traen códigos propios', () => {
    expect(REPORTE.codigo).toBe('SST-REPORTE-ACTOS');
    expect(SALUD.codigo).toBe('SST-SALUD-OSTEOMUSCULAR');
    expect(new Set([REPORTE.codigo, SALUD.codigo, (perfil as { codigo: string }).codigo]).size).toBe(3);
  });
  it('son encuestas (no evaluaciones): nadie las califica', () => {
    expect(REPORTE.tipo ?? 'encuesta').toBe('encuesta');
    expect(SALUD.tipo ?? 'encuesta').toBe('encuesta');
  });
  it('los enunciados tratan de «usted»: no quedó ningún verbo en «tú»', () => {
    const textos = [REPORTE, SALUD].flatMap((d) => [d.titulo, d.descripcion ?? '', ...d.preguntas.flatMap((p) => [p.texto, p.ayuda ?? '', ...(p.opciones ?? [])])]).join(' ');
    expect(textos).not.toMatch(/\b(tienes|consumes|practicas|haces|puedes|eres|escribes|fumas|tomas)\b/i);
  });
});

describe('B1 · Reporte de actos y condiciones inseguras', () => {
  it('trae las 6 preguntas, todas obligatorias, y no pide autorización de datos sensibles', () => {
    expect(REPORTE.preguntas.map((p) => p.id)).toEqual(['r01', 'r02', 'r03', 'r04', 'r05', 'r06']);
    expect(REPORTE.preguntas.every((p) => p.obligatoria)).toBe(true);
    expect(REPORTE.datosSensibles).toBeFalsy();
    expect(REPORTE.autorizacion).toBeUndefined();
  });
  it('sede, área y tipo de reporte son de selección con sus opciones', () => {
    expect(porId(REPORTE, 'r03').opciones).toEqual(['Planta', 'Sede administrativa', 'Finales de línea']);
    expect(porId(REPORTE, 'r04').opciones).toHaveLength(13);
    expect(porId(REPORTE, 'r04').opciones).toContain('SEGURIDAD Y SALUD EN EL TRABAJO');
    expect(porId(REPORTE, 'r05').opciones).toHaveLength(2);
    expect(porId(REPORTE, 'r06').tipo).toBe('texto_largo');
  });
  it('el nombre se precarga con la sesión y el número de contacto para la imagen está en la descripción', () => {
    expect(porId(REPORTE, 'r01').prellenar).toBe('nombre');
    expect(REPORTE.descripcion).toContain('310 2480499');
  });
  it('se puede llenar completo, y sin una obligatoria no se envía', () => {
    expect(validarRespuestas(REPORTE, completas(REPORTE)).ok).toBe(true);
    const sin = completas(REPORTE);
    delete sin.r06;
    const r = validarRespuestas(REPORTE, sin);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.map((e) => e.id)).toEqual(['r06']);
  });
});

describe('B2 · Condiciones de salud y sintomatología osteomuscular', () => {
  it('trae 26 preguntas más la autorización (la pregunta 4 del original), numeradas como en Forms', () => {
    expect(SALUD.preguntas).toHaveLength(26);
    expect(SALUD.preguntas.map((p) => p.id)).not.toContain('o04');
    expect(SALUD.preguntas[0].id).toBe('o01');
    expect(SALUD.preguntas.at(-1)?.id).toBe('o27');
    expect(SALUD.preguntas.every((p) => p.obligatoria)).toBe(true); // las 26, incluidas la 1 y la 10 (Cristian, 2026-10-19)
  });
  it('maneja datos de salud: exige autorización, y su texto queda marcado como pendiente de validación jurídica', () => {
    expect(SALUD.datosSensibles).toBe(true);
    expect(SALUD.autorizacion?.pendienteValidacion).toBe(true);
    expect(SALUD.autorizacion?.texto[0]).toContain('totalmente confidencial');
    expect(SALUD.autorizacion?.casilla).toMatch(/Autorizo/);
  });
  it('la pregunta 10 lleva la imagen del cuerpo, que existe en public/portal-th, y admite «Otras»', () => {
    const p10 = porId(SALUD, 'o10');
    expect(p10.tipo).toBe('seleccion_multiple');
    expect(p10.permiteOtra).toBe(true);
    expect(p10.opciones).toHaveLength(12);
    expect(p10.imagen?.src).toBe('/portal-th/cuerpo-dolor.png');
    expect(p10.imagen?.alt.length).toBeGreaterThan(10);
    expect(existsSync(new URL('../../../public/portal-th/cuerpo-dolor.png', import.meta.url))).toBe(true);
  });
  it('la 11 es una escala de 0 a 10 con sus dos rótulos; la 7 y la 10 son múltiples con «Otras»; la 6 es única con «Otras»', () => {
    expect(porId(SALUD, 'o11')).toMatchObject({ tipo: 'escala', escala: { min: 0, max: 10, etiquetaMin: 'Muy poco dolor', etiquetaMax: 'Mucho dolor' } });
    expect(porId(SALUD, 'o07')).toMatchObject({ tipo: 'seleccion_multiple', permiteOtra: true });
    expect(porId(SALUD, 'o06')).toMatchObject({ tipo: 'seleccion', permiteOtra: true });
    expect(porId(SALUD, 'o07').opciones).toHaveLength(7);
    expect(porId(SALUD, 'o06').opciones).toHaveLength(10);
  });
  it('las preguntas de frecuencia usan la escala Nunca…Siempre y las de Sí/No usan Sí y No', () => {
    for (const id of ['o22', 'o24', 'o26']) expect(porId(SALUD, id).opciones).toEqual(['Nunca', 'Casi nunca', 'A veces', 'Casi siempre', 'Siempre']);
    for (const id of ['o12', 'o15', 'o17', 'o19', 'o20', 'o23', 'o25', 'o27']) expect(porId(SALUD, id).tipo).toBe('si_no');
  });
  it('se puede llenar completo (con la escala en 0) y cada obligatoria faltante se señala', () => {
    expect(validarRespuestas(SALUD, completas(SALUD)).ok).toBe(true);
    for (const id of ['o01', 'o10', 'o11', 'o27']) {
      const sin = completas(SALUD);
      delete sin[id];
      const r = validarRespuestas(SALUD, sin);
      expect(r.ok, id).toBe(false);
      if (!r.ok) expect(r.errores.map((e) => e.id)).toEqual([id]);
    }
  });
  it('acepta «Otras» con texto en la 7 y la 10, y rechaza una escala fuera de 0 a 10', () => {
    const ok = validarRespuestas(SALUD, { ...completas(SALUD), o10: ['Cabeza', `${PREFIJO_OTRAS}Ojo izquierdo`], o07: [`${PREFIJO_OTRAS}Mareo`], o06: { otra: 'Fibromialgia' } });
    expect(ok.ok).toBe(true);
    const mal = validarRespuestas(SALUD, { ...completas(SALUD), o11: '11' });
    expect(mal.ok).toBe(false);
    if (!mal.ok) expect(mal.errores).toEqual([{ id: 'o11', mensaje: 'Elija un valor de 0 a 10.' }]);
  });
});
