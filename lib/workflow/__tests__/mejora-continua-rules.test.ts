import { describe, expect, it } from 'vitest';
import { diagnosticar, percentil, textoDias, type Solicitud, type TareaDef, type TareaInstancia } from '../mejora-continua-rules';

/* Mejora continua de los flujos (2026-11-09). Reglas PURAS (lib/workflow/mejora-continua-rules.ts). */

const AHORA = new Date('2026-11-09T12:00:00Z');
const dia = (n: number, h = 0) => new Date(Date.UTC(2026, 9, 1 + n, 12 + h));

const tareas: TareaDef[] = [
  { id: 1, nombre: 'Radicar soportes', orden: 0, secuencial: false, autorizacion: false, tipo: 'normal', asignados: 3 },
  { id: 2, nombre: 'Autorización jefe', orden: 1, secuencial: true, autorizacion: true, tipo: 'authorization', asignados: 1 },
  { id: 3, nombre: 'Validación tesorería', orden: 2, secuencial: true, autorizacion: false, tipo: 'normal', asignados: 1 },
  { id: 4, nombre: 'Tarea vieja', orden: 3, secuencial: false, autorizacion: false, tipo: 'normal', asignados: 1 },
];

/** 24 solicitudes: radicar 0,5 día, autorización 1 día, validación 4 días, todas aprobadas. */
function casos(): { solicitudes: Solicitud[]; instancias: TareaInstancia[] } {
  const solicitudes: Solicitud[] = [];
  const instancias: TareaInstancia[] = [];
  for (let i = 0; i < 24; i += 1) {
    const c = dia(i);
    solicitudes.push({ id: i + 1, creada: c, resuelta: new Date(c.getTime() + 5.5 * 86_400_000), estado: 2 });
    instancias.push(
      { idSolicitud: i + 1, idTarea: 1, estado: 2, resuelta: new Date(c.getTime() + 0.5 * 86_400_000), ejecutor: 'u1', resolucion: 'Listo' },
      { idSolicitud: i + 1, idTarea: 2, estado: 2, resuelta: new Date(c.getTime() + 1.5 * 86_400_000), ejecutor: 'u2', resolucion: 'Solicitud Autorizada Correctamente' },
      { idSolicitud: i + 1, idTarea: 3, estado: 2, resuelta: new Date(c.getTime() + 5.5 * 86_400_000), ejecutor: 'u3', resolucion: 'Validado' }
    );
  }
  return { solicitudes, instancias };
}

describe('utilidades', () => {
  it('percentil y textos de duración', () => {
    expect(percentil([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentil([], 0.5)).toBeNull();
    expect(textoDias(0.25)).toBe('6 horas');
    expect(textoDias(1)).toBe('1 día');
    expect(textoDias(2.46)).toBe('2,5 días');
  });
});

describe('diagnosticar', () => {
  const { solicitudes, instancias } = casos();
  const d = diagnosticar({
    ahora: AHORA,
    tareas,
    solicitudes,
    instancias,
    notas: [
      { idSolicitud: 1, texto: 'Se devuelve: falta el soporte de la factura' },
      { idSolicitud: 2, texto: 'Devuelta, no adjuntó el documento' },
      { idSolicitud: 3, texto: 'Corregir el certificado adjunto' },
    ],
    erroresSap: [],
    nombres: new Map([['u3', 'Ana Pérez']]),
  });

  it('mide cada tarea desde que quedó disponible (las secuenciales, desde la anterior)', () => {
    const t = new Map(d.tareas.map((x) => [x.idTarea, x]));
    expect(t.get(1)?.medianaDias).toBe(0.5);
    expect(t.get(2)?.medianaDias).toBe(1);
    expect(t.get(3)?.medianaDias).toBe(4);
    expect(d.cicloMedianaDias).toBe(5.5);
    expect(d.resueltas).toBe(24);
  });

  it('semáforo: la validación (4 días, ~73 % del tiempo) en rojo; la radicación en verde', () => {
    const t = new Map(d.tareas.map((x) => [x.idTarea, x]));
    expect(t.get(3)?.semaforo).toBe('rojo');
    expect(t.get(1)?.semaforo).toBe('verde');
    expect(t.get(4)?.semaforo).toBe('sin_datos');
  });

  it('sugiere paralelizar dos tareas lentas seguidas, con su acción para el editor', () => {
    const s = d.sugerencias.find((x) => x.clave === 'paralelizar:3');
    expect(s?.accion).toEqual({ tipo: 'quitar_secuencial', idTarea: 3 });
    expect(s?.impacto).toBe('Hasta 1 día menos por solicitud.');
  });

  it('suplente donde una sola persona represa; autorización que siempre aprueba; documentos; tarea sin uso', () => {
    const claves = d.sugerencias.map((x) => x.clave);
    expect(claves).toContain('suplente:3');
    expect(claves).toContain('autorizacion:2');
    expect(claves).toContain('obligatorio:flujo');
    expect(claves).toContain('sin_uso:4');
    expect(claves).not.toContain('suplente:1');
  });

  it('no sugiere quitar una autorización que sí rechaza', () => {
    const { solicitudes: s2, instancias: i2 } = casos();
    i2[1].resolucion = 'Rechazada por presupuesto';
    const d2 = diagnosticar({ ahora: AHORA, tareas, solicitudes: s2, instancias: i2, notas: [], erroresSap: [] });
    expect(d2.sugerencias.map((x) => x.clave)).not.toContain('autorizacion:2');
    expect(d2.tareas.find((x) => x.idTarea === 2)?.rechazos).toBe(1);
  });

  it('tareas automáticas con SAP que fallan seguido', () => {
    const d3 = diagnosticar({
      ahora: AHORA,
      tareas: [...tareas, { id: 9, nombre: 'Publicar en SAP', orden: 4, secuencial: true, autorizacion: false, tipo: 'sap_executor', asignados: 0 }],
      solicitudes,
      instancias,
      notas: [],
      erroresSap: [{ idTarea: 9, total: 20, errores: 4 }],
    });
    expect(d3.sugerencias.find((x) => x.clave === 'sap:9')?.evidencia).toBe('4 errores en 20 ejecuciones (20 %).');
  });

  it('cuenta pendientes con su antigüedad', () => {
    const { solicitudes: s4, instancias: i4 } = casos();
    s4.push({ id: 99, creada: new Date('2026-11-01T12:00:00Z'), resuelta: null, estado: 1 });
    i4.push({ idSolicitud: 99, idTarea: 1, estado: 4, resuelta: null, ejecutor: null, resolucion: null });
    const d4 = diagnosticar({ ahora: AHORA, tareas, solicitudes: s4, instancias: i4, notas: [], erroresSap: [] });
    expect(d4.tareas.find((x) => x.idTarea === 1)).toMatchObject({ pendientes: 1, pendientesMedianaDias: 8 });
    expect(d4.abiertas).toBe(1);
  });
});
