import { describe, expect, it } from 'vitest';
import {
  EMPRESA_DEL_ORGANIGRAMA,
  EQUIVALENCIAS,
  MODELO,
  TAMANO_TEXTO_MAX,
  TAMANO_TEXTO_MIN,
  ajustarTexto,
  cargosDelNodo,
  coincideBusqueda,
  normalizarCargo,
  partirEnLineas,
  personasPorNodo,
  textoDelNodo,
  type PersonaOrganigrama,
} from '../organigrama';

// Organigrama digital (Cristian Baldión, 2026-10-15).

const persona = (cargo: string, extra: Partial<PersonaOrganigrama> = {}): PersonaOrganigrama => ({ empresa: 'Farmalógica', nombre: 'GOMEZ RUIZ ANA', area: 'CALIDAD', cargo, correo: 'ana@farmalogica.com', ...extra });

describe('el modelo convertido del PDF', () => {
  it('trae los 122 cuadros, 3 franjas y los conectores, con ids únicos y dentro del dibujo', () => {
    expect(MODELO.nodos).toHaveLength(122);
    expect(MODELO.bandas).toHaveLength(3);
    expect(MODELO.conectores.length).toBeGreaterThan(100);
    expect(new Set(MODELO.nodos.map((n) => n.id)).size).toBe(122);
    const [vx, vy, vw, vh] = MODELO.vista;
    for (const n of MODELO.nodos) {
      expect(n.x).toBeGreaterThanOrEqual(vx);
      expect(n.y).toBeGreaterThanOrEqual(vy);
      expect(n.x + n.w).toBeLessThanOrEqual(vx + vw);
      expect(n.y + n.h).toBeLessThanOrEqual(vy + vh);
      expect(n.texto.trim().length).toBeGreaterThan(2);
    }
  });
  it('todos los cuadros tienen un cargo legible (sin restos de OCR)', () => {
    for (const n of MODELO.nodos) expect(n.texto, String(n.id)).not.toMatch(/[|_~^<>{}]|\bON\b|\bNU\b|\bMG\b/);
  });
  it('los cargos que el OCR leyó mal se corrigieron (revisados a mano)', () => {
    const textos = MODELO.nodos.map((n) => n.texto);
    for (const bueno of ['Analista de Aseguramiento Metrológico', 'Tecnólogo de Control de Calidad', 'Analista de Asuntos Regulatorios', 'Supervisor Logistico', 'Analista de Servicio al Cliente', 'Analista Senior de Seguridad y Salud en el Trabajo', 'Auxiliar de Seguridad y Salud en el Trabajo']) {
      expect(textos, bueno).toContain(bueno);
    }
  });
  it('los cuadros con texto girado son angostos (más altos que anchos)', () => {
    for (const n of MODELO.nodos.filter((x) => x.v)) expect(n.h).toBeGreaterThan(n.w);
  });
});

describe('normalizarCargo', () => {
  it('ignora tildes, mayúsculas, signos y espacios, y expande «Aux.» y «Gte.»', () => {
    expect(normalizarCargo('Auxiliar de Producción')).toBe('AUXILIAR DE PRODUCCION');
    expect(normalizarCargo('  AUXILIAR   DE  PRODUCCIÓN ')).toBe('AUXILIAR DE PRODUCCION');
    expect(normalizarCargo('Aux. de Oficina')).toBe('AUXILIAR DE OFICINA');
    expect(normalizarCargo('Gte. Comercial')).toBe('GERENTE COMERCIAL');
    expect(normalizarCargo('AUXILIAR DE OFICINA-GARANTIA DE CALIDAD')).toBe('AUXILIAR DE OFICINA GARANTIA DE CALIDAD');
    expect(normalizarCargo(null)).toBe('');
    expect(normalizarCargo(undefined)).toBe('');
  });
});

describe('equivalencias revisadas', () => {
  it('cada equivalencia apunta a un cuadro que existe en el dibujo', () => {
    const cuadros = new Set(MODELO.nodos.map((n) => normalizarCargo(n.texto)));
    for (const [dibujo] of EQUIVALENCIAS) expect(cuadros.has(normalizarCargo(dibujo)), dibujo).toBe(true);
  });
  it('un cuadro con equivalencia también busca su cargo literal; uno sin equivalencia solo el suyo', () => {
    expect(cargosDelNodo({ texto: 'Jefe Planeación' })).toEqual(['JEFE PLANEACION', 'JEFE DE PLANEACION']);
    expect(cargosDelNodo({ texto: 'Gerente de Calidad' })).toEqual(['GERENTE DE CALIDAD']);
  });
});

describe('personasPorNodo', () => {
  const nodos = [
    { id: 1, texto: 'Gerente de Calidad' },
    { id: 2, texto: 'Jefe Planeación' },
    { id: 3, texto: 'Mensajero' },
  ];
  it('enlaza por cargo sin importar tildes ni mayúsculas, y por equivalencia', () => {
    const r = personasPorNodo(nodos, [persona('GERENTE DE CALIDAD'), persona('Jefe de Planeacion', { nombre: 'B' }), persona('OTRO CARGO', { nombre: 'C' })]);
    expect(Object.keys(r).map(Number)).toEqual([1, 2]);
    expect(r[1][0].cargo).toBe('GERENTE DE CALIDAD');
    expect(r[2][0].nombre).toBe('B');
  });
  it('solo devuelve cuadros con personas, y de las personas, nada más que lo suyo', () => {
    const r = personasPorNodo(nodos, [persona('OTRO CARGO')]);
    expect(r).toEqual({});
  });
  it('ordena por empresa y nombre; el mismo cargo en varias empresas queda todo junto', () => {
    const r = personasPorNodo([{ id: 1, texto: 'Gerente de Calidad' }], [persona('GERENTE DE CALIDAD', { empresa: 'Ryan', nombre: 'Z' }), persona('GERENTE DE CALIDAD', { empresa: 'Farmalógica', nombre: 'B' }), persona('GERENTE DE CALIDAD', { empresa: 'Farmalógica', nombre: 'A' })]);
    expect(r[1].map((p) => `${p.empresa}:${p.nombre}`)).toEqual(['Farmalógica:A', 'Farmalógica:B', 'Ryan:Z']);
  });
  it('no pierde ni inventa personas: las del cargo de dos cuadros iguales salen en los dos', () => {
    const r = personasPorNodo([{ id: 1, texto: 'Aux. de Controloes en Procesos' }, { id: 2, texto: 'Aux. de Controloes en Procesos' }], [persona('AUXILIAR DE CONTROLES EN PROCESO')]);
    expect(r[1]).toHaveLength(1);
    expect(r[2]).toHaveLength(1);
  });
  it('con la lista de BASE PERSONAL vacía no hay enlaces y no falla', () => {
    expect(personasPorNodo(MODELO.nodos, [])).toEqual({});
  });
  it('la empresa del organigrama es Farmalógica', () => {
    expect(EMPRESA_DEL_ORGANIGRAMA).toBe('Farmalógica');
  });
});

describe('texto dentro de los cuadros', () => {
  it('parte en líneas que caben y no pierde palabras', () => {
    const l = partirEnLineas('Subgerente de Control de Calidad Fisicoquímico', 200, 18);
    expect(l.join(' ')).toBe('Subgerente de Control de Calidad Fisicoquímico');
    expect(l.length).toBeGreaterThan(1);
  });
  it('usa la letra más grande que cabe y baja hasta el mínimo si no', () => {
    expect(ajustarTexto('Hola', 300, 80).tam).toBe(TAMANO_TEXTO_MAX);
    const largo = ajustarTexto('Analista Senior de Seguridad y Salud en el Trabajo', 120, 50);
    expect(largo.tam).toBeLessThan(TAMANO_TEXTO_MAX);
    expect(largo.tam).toBeGreaterThanOrEqual(TAMANO_TEXTO_MIN);
    expect(ajustarTexto('x '.repeat(200), 40, 20).tam).toBe(TAMANO_TEXTO_MIN);
  });
  it('en los cuadros girados, el largo del texto es el alto del cuadro', () => {
    const n = MODELO.nodos.find((x) => x.v)!;
    const t = textoDelNodo(n);
    expect(t.lineas.join(' ')).toBe(n.texto);
  });
  it('todos los cuadros del dibujo conservan su texto completo', () => {
    for (const n of MODELO.nodos) expect(textoDelNodo(n).lineas.join(' ').replace(/\s+/g, ' ')).toBe(n.texto.replace(/\s+/g, ' ').trim());
  });
});

describe('coincideBusqueda', () => {
  it('encuentra por cargo o por nombre de persona, sin tildes y con todas las palabras', () => {
    const n = { texto: 'Gerente de Calidad' };
    expect(coincideBusqueda(n, undefined, 'gerente calidad')).toBe(true);
    expect(coincideBusqueda(n, [persona('x', { nombre: 'PÉREZ GÓMEZ ANA' })], 'perez ana')).toBe(true);
    expect(coincideBusqueda(n, undefined, 'perez')).toBe(false);
    expect(coincideBusqueda(n, undefined, '   ')).toBe(false);
  });
});
