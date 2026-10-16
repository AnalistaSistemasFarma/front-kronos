import { describe, expect, it } from 'vitest';
import semilla from '../../../prisma/seeds/organigrama-gss.json';
import {
  ALTO_CUADRO,
  ANCHO_CUADRO,
  EMPRESA_POR_DEFECTO,
  EQUIVALENCIAS,
  TAMANO_TEXTO_MAX,
  TAMANO_TEXTO_MIN,
  ajustarTexto,
  cargosDelNodo,
  coincideBusqueda,
  disenarOrganigrama,
  hijosPorCargo,
  nombreLegible,
  normalizarCargo,
  partirEnLineas,
  personasPorNodo,
  textoDelNodo,
  type NodoCargo,
  type PersonaOrganigrama,
} from '../organigrama';

// Organigrama de GSS (Cristian Baldión, 2026-10-15). El árbol sale de la base; aquí se prueba con los MISMOS datos que carga el script.

interface Cargo { nombre: string; nivel: string; padre: string | null; aproximada: boolean; nuevo: boolean }
const SEMILLA = semilla as unknown as { cargos: Cargo[] };
const ID = new Map(SEMILLA.cargos.map((c, i) => [c.nombre, i + 1]));
const NODOS: NodoCargo[] = SEMILLA.cargos.map((c) => ({ id: ID.get(c.nombre)!, nombre: c.nombre, nivel: c.nivel, padre: c.padre ? ID.get(c.padre)! : null }));
const persona = (cargo: string, extra: Partial<PersonaOrganigrama> = {}): PersonaOrganigrama => ({ empresa: 'GSS', nombre: 'GOMEZ RUIZ ANA', area: 'CALIDAD', cargo, correo: 'ana@gsslatam.com', ...extra });
const nodo = (id: number, nombre: string, padre: number | null): NodoCargo => ({ id, nombre, nivel: null, padre });

describe('los datos que carga el script (el PDF vigente)', () => {
  it('118 cargos, una sola cima (Director General), todos los jefes existen y no hay ciclos', () => {
    expect(SEMILLA.cargos).toHaveLength(118);
    expect(new Set(SEMILLA.cargos.map((c) => c.nombre)).size).toBe(118);
    const cimas = SEMILLA.cargos.filter((c) => c.padre === null);
    expect(cimas.map((c) => c.nombre)).toEqual(['DIRECTOR GENERAL']);
    for (const c of SEMILLA.cargos) if (c.padre !== null) expect(ID.has(c.padre), c.nombre).toBe(true);
    const padre = new Map(SEMILLA.cargos.map((c) => [c.nombre, c.padre]));
    for (const c of SEMILLA.cargos) {
      const visto = new Set<string>();
      let a: string | null = c.nombre;
      while (a !== null) {
        expect(visto.has(a), 'ciclo en ' + c.nombre).toBe(false);
        visto.add(a);
        a = padre.get(a) ?? null;
      }
    }
  });
  it('nombres normalizados (mayúsculas, sin tildes ni restos de OCR) y niveles válidos', () => {
    for (const c of SEMILLA.cargos) {
      expect(c.nombre, c.nombre).toBe(normalizarCargo(c.nombre));
      expect(c.nombre, c.nombre).not.toMatch(/\b(CONTROLOES|INFRASTRUCTURA)\b/);
      expect(['Estratégico', 'Táctico', 'Operativo']).toContain(c.nivel);
    }
  });
  it('los dos cargos que el PDF repite con jefes distintos quedan marcados como aproximados', () => {
    expect(SEMILLA.cargos.filter((c) => c.aproximada).map((c) => c.nombre).sort()).toEqual(['AUXILIAR DE CONTROLES EN PROCESOS', 'AUXILIAR DE PRODUCCION']);
  });
  it('51 cargos son nuevos en el catálogo y 67 ya existían', () => {
    expect(SEMILLA.cargos.filter((c) => c.nuevo)).toHaveLength(51);
  });
});

describe('disenarOrganigrama', () => {
  const d = disenarOrganigrama(NODOS);
  it('coloca los 118 cargos, ninguno encima de otro, todos dentro de la vista', () => {
    expect(d.cuadros).toHaveLength(118);
    expect(new Set(d.cuadros.map((c) => c.id)).size).toBe(118);
    for (let i = 0; i < d.cuadros.length; i++) {
      for (let j = i + 1; j < d.cuadros.length; j++) {
        const a = d.cuadros[i];
        const b = d.cuadros[j];
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${a.id} y ${b.id} se solapan`).toBe(false);
      }
    }
    const [vx, vy, vw, vh] = d.vista;
    for (const c of d.cuadros) {
      expect(c.x).toBeGreaterThanOrEqual(vx);
      expect(c.y).toBeGreaterThanOrEqual(vy);
      expect(c.x + c.w).toBeLessThanOrEqual(vx + vw);
      expect(c.y + c.h).toBeLessThanOrEqual(vy + vh);
      expect(c.w).toBe(ANCHO_CUADRO);
      expect(c.h).toBe(ALTO_CUADRO);
    }
  });
  it('cada jefe queda arriba de sus subordinados, y la cima en la fila de arriba', () => {
    const pos = new Map(d.cuadros.map((c) => [c.id, c]));
    for (const n of NODOS) if (n.padre !== null) expect(pos.get(n.padre)!.y, n.nombre).toBeLessThan(pos.get(n.id)!.y);
    const cima = pos.get(ID.get('DIRECTOR GENERAL')!)!;
    expect(Math.min(...d.cuadros.map((c) => c.y))).toBe(cima.y);
  });
  it('trae una línea por subordinado (más la del tronco de cada lista) y todas son trazos válidos', () => {
    expect(d.caminos.length).toBeGreaterThanOrEqual(117);
    for (const c of d.caminos) expect(c).toMatch(/^M[-0-9. HV]+$/);
  });
  it('un ciclo o un jefe que no existe no cuelga el cálculo ni hace desaparecer cargos', () => {
    const raro = [nodo(1, 'A', 2), nodo(2, 'B', 1), nodo(3, 'C', 99), nodo(4, 'D', 4), nodo(5, 'E', 3)];
    const r = disenarOrganigrama(raro);
    expect(r.cuadros.map((c) => c.id).sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it('sin cargos: un dibujo vacío válido', () => {
    const r = disenarOrganigrama([]);
    expect(r.cuadros).toEqual([]);
    expect(r.vista[2]).toBeGreaterThan(0);
  });
  it('hijosPorCargo: cimas y subordinados ordenados por nombre', () => {
    const { raices, hijos } = hijosPorCargo([nodo(1, 'RAIZ', null), nodo(2, 'ZETA', 1), nodo(3, 'ALFA', 1)]);
    expect(raices.map((r) => r.id)).toEqual([1]);
    expect(hijos.get(1)!.map((h) => h.nombre)).toEqual(['ALFA', 'ZETA']);
  });
});

describe('normalizarCargo y nombreLegible', () => {
  it('ignora tildes, mayúsculas, signos y espacios, y expande «Aux.» y «Gte.»', () => {
    expect(normalizarCargo('Auxiliar de Producción')).toBe('AUXILIAR DE PRODUCCION');
    expect(normalizarCargo('  AUXILIAR   DE  PRODUCCIÓN ')).toBe('AUXILIAR DE PRODUCCION');
    expect(normalizarCargo('Aux. de Oficina')).toBe('AUXILIAR DE OFICINA');
    expect(normalizarCargo('Gte. Comercial')).toBe('GERENTE COMERCIAL');
    expect(normalizarCargo('AUXILIAR DE OFICINA-GARANTIA DE CALIDAD')).toBe('AUXILIAR DE OFICINA GARANTIA DE CALIDAD');
    expect(normalizarCargo(null)).toBe('');
  });
  it('el nombre se muestra en minúsculas con artículos y siglas respetadas', () => {
    expect(nombreLegible('SUBGERENTE DE GARANTIA DE CALIDAD')).toBe('Subgerente de Garantia de Calidad');
    expect(nombreLegible('COORDINADOR DE SEGURIDAD Y SALUD EN EL TRABAJO SST')).toBe('Coordinador de Seguridad y Salud en el Trabajo SST');
    expect(nombreLegible('DIRECTOR GENERAL')).toBe('Director General');
  });
});

describe('equivalencias revisadas', () => {
  it('cada equivalencia apunta a un cargo que existe en el organigrama', () => {
    const cargos = new Set(NODOS.map((n) => normalizarCargo(n.nombre)));
    for (const [organigrama] of EQUIVALENCIAS) expect(cargos.has(normalizarCargo(organigrama)), organigrama).toBe(true);
  });
  it('un cargo con equivalencia también busca el suyo; uno sin equivalencia solo el suyo', () => {
    expect(cargosDelNodo({ nombre: 'JEFE PLANEACION' })).toEqual(['JEFE PLANEACION', 'JEFE DE PLANEACION']);
    expect(cargosDelNodo({ nombre: 'GERENTE DE CALIDAD' })).toEqual(['GERENTE DE CALIDAD']);
  });
});

describe('personasPorNodo', () => {
  const nodos = [
    { id: 1, nombre: 'GERENTE DE CALIDAD' },
    { id: 2, nombre: 'JEFE PLANEACION' },
    { id: 3, nombre: 'MENSAJERO' },
  ];
  it('enlaza por cargo sin importar tildes ni mayúsculas, y por equivalencia', () => {
    const r = personasPorNodo(nodos, [persona('Gerente de Calidad'), persona('Jefe de Planeacion', { nombre: 'B' }), persona('OTRO CARGO', { nombre: 'C' })]);
    expect(Object.keys(r).map(Number)).toEqual([1, 2]);
    expect(r[2][0].nombre).toBe('B');
  });
  it('solo devuelve cuadros con personas; de las demás personas no sale nada', () => {
    expect(personasPorNodo(nodos, [persona('OTRO CARGO')])).toEqual({});
  });
  it('ordena por empresa y nombre; el mismo cargo en varias empresas queda todo junto', () => {
    const r = personasPorNodo([nodos[0]], [persona('GERENTE DE CALIDAD', { empresa: 'Ryan', nombre: 'Z' }), persona('GERENTE DE CALIDAD', { empresa: 'Farmalógica', nombre: 'B' }), persona('GERENTE DE CALIDAD', { empresa: 'Farmalógica', nombre: 'A' })]);
    expect(r[1].map((p) => `${p.empresa}:${p.nombre}`)).toEqual(['Farmalógica:A', 'Farmalógica:B', 'Ryan:Z']);
  });
  it('de cada persona salen SOLO los cinco datos: una cédula que llegara de más no pasa', () => {
    const conCedula = { ...persona('GERENTE DE CALIDAD'), cedula: '1010101010', fechaNacimiento: 33178 } as unknown as PersonaOrganigrama;
    const r = personasPorNodo([nodos[0]], [conCedula]);
    expect(Object.keys(r[1][0]).sort()).toEqual(['area', 'cargo', 'correo', 'empresa', 'nombre']);
    expect(JSON.stringify(r)).not.toMatch(/1010101010|33178|cedula/);
  });
  it('con BASE PERSONAL vacía no hay enlaces y no falla; la empresa por defecto es GSS', () => {
    expect(personasPorNodo(NODOS, [])).toEqual({});
    expect(EMPRESA_POR_DEFECTO).toBe('GSS');
  });
});

describe('texto dentro de los cuadros', () => {
  it('parte en líneas que caben y no pierde palabras', () => {
    const l = partirEnLineas('Subgerente de Control de Calidad Fisicoquimico', 200, 18);
    expect(l.join(' ')).toBe('Subgerente de Control de Calidad Fisicoquimico');
    expect(l.length).toBeGreaterThan(1);
  });
  it('usa la letra más grande que cabe y baja hasta el mínimo si no', () => {
    expect(ajustarTexto('Hola', 300, 80).tam).toBe(TAMANO_TEXTO_MAX);
    const largo = ajustarTexto('Analista Senior de Seguridad y Salud en el Trabajo', 120, 50);
    expect(largo.tam).toBeLessThan(TAMANO_TEXTO_MAX);
    expect(largo.tam).toBeGreaterThanOrEqual(TAMANO_TEXTO_MIN);
    expect(ajustarTexto('x '.repeat(200), 40, 20).tam).toBe(TAMANO_TEXTO_MIN);
  });
  it('todos los cargos caben completos en su cuadro', () => {
    for (const n of NODOS) {
      const t = textoDelNodo(n.nombre);
      expect(t.lineas.join(' ')).toBe(nombreLegible(n.nombre));
      expect(t.lineas.length * t.tam * 1.2, n.nombre).toBeLessThanOrEqual(ALTO_CUADRO - 10 + 0.001);
    }
  });
});

describe('coincideBusqueda', () => {
  it('encuentra por cargo o por nombre de persona, sin tildes y con todas las palabras', () => {
    const n = { nombre: 'GERENTE DE CALIDAD' };
    expect(coincideBusqueda(n, undefined, 'gerente calidad')).toBe(true);
    expect(coincideBusqueda(n, [persona('x', { nombre: 'PÉREZ GÓMEZ ANA' })], 'perez ana')).toBe(true);
    expect(coincideBusqueda(n, undefined, 'perez')).toBe(false);
    expect(coincideBusqueda(n, undefined, '   ')).toBe(false);
  });
});
