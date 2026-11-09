import { describe, expect, it } from 'vitest';
import { calcularTendencia, calificarFlujo, diagnosticar, tendenciaEmpresa, percentil, resumirFlujo, textoDias, textoTendencia, totalizar, type Solicitud, type TareaDef, type TareaInstancia } from '../mejora-continua-rules';

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
    // La autorización (1 asignado) no recibe «suplente»: la define el tipo de autorización.
    expect(claves).not.toContain('suplente:2');
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

describe('indicador del panel de flujos', () => {
  const { solicitudes, instancias } = casos();
  const d = diagnosticar({ ahora: AHORA, tareas, solicitudes, instancias, notas: [], erroresSap: [] });

  it('resume un flujo: semáforos, pendientes, decisiones y días ahorrados medidos', () => {
    // La validación tardaba 6 días cuando se aplicó la mejora; hoy, 4.
    const r = resumirFlujo(94, 'Solicitud de Pago', d, [
      { clave: 'paralelizar:3', estado: 'aplicada', medianaAntes: 6 },
      { clave: 'sin_uso:4', estado: 'descartada', medianaAntes: null },
    ]);
    expect(r).toMatchObject({ rojas: 1, aplicadas: 1, descartadas: 1, diasAhorrados: 2 });
    expect(r.pendientes).toBe(d.sugerencias.length - 2);
    expect(r.prioridad).toBeGreaterThan(0);
  });

  it('si la tarea empeoró, no cuenta como ahorro', () => {
    expect(resumirFlujo(94, 'X', d, [{ clave: 'paralelizar:3', estado: 'aplicada', medianaAntes: 2 }]).diasAhorrados).toBe(0);
  });

  it('totaliza la empresa con la adopción de sugerencias', () => {
    const a = resumirFlujo(1, 'A', d, [{ clave: 'paralelizar:3', estado: 'aplicada', medianaAntes: 6 }]);
    const b = resumirFlujo(2, 'B', d, [
      { clave: 'sin_uso:4', estado: 'descartada', medianaAntes: null },
      { clave: 'suplente:3', estado: 'aplicada', medianaAntes: 5 },
    ]);
    expect(totalizar([a, b])).toMatchObject({ flujos: 2, aplicadas: 2, descartadas: 1, adopcion: 67, diasAhorrados: 3 });
  });
});

describe('¿se han vuelto más rápidos? (tendencia)', () => {
  const H = new Date('2026-11-09T12:00:00Z');
  const hace = (dias: number) => H.getTime() - dias * 86_400_000;
  /** n solicitudes resueltas hace `desde`..`desde+n` días, cada una de `dur` días. */
  const lote = (n: number, desde: number, dur: number): [number, number][] => Array.from({ length: n }, (_, i) => [hace(desde + i), dur]);

  it('más rápido: lo reciente tarda 2 días y antes tardaba 4 → 50 % más rápido', () => {
    const t = calcularTendencia([...lote(10, 1, 2), ...lote(20, 40, 4)], H);
    expect(t).toMatchObject({ cambioPct: -50, veredicto: 'mas_rapido', reciente: { medianaDias: 2, casos: 10 }, base: { medianaDias: 4, casos: 20 } });
    expect(textoTendencia(t)).toBe('50 % más rápido');
  });

  it('más lento y casi igual', () => {
    expect(calcularTendencia([...lote(10, 1, 3), ...lote(10, 40, 2)], H)).toMatchObject({ cambioPct: 50, veredicto: 'mas_lento' });
    expect(calcularTendencia([...lote(10, 1, 2.1), ...lote(10, 40, 2)], H).veredicto).toBe('igual');
  });

  it('sin casos suficientes en alguno de los dos periodos: sin datos', () => {
    const t = calcularTendencia([...lote(3, 1, 2), ...lote(20, 40, 4)], H);
    expect(t.veredicto).toBe('sin_datos');
    expect(textoTendencia(t)).toBe('Sin datos suficientes');
  });

  it('flujos que se resuelven en minutos: igual, sin porcentajes engañosos', () => {
    expect(calcularTendencia([...lote(10, 1, 0.001), ...lote(10, 40, 0.02)], H)).toMatchObject({ cambioPct: 0, veredicto: 'igual' });
  });

  it('serie mensual de los últimos 6 meses', () => {
    const t = calcularTendencia(lote(10, 1, 2), H);
    expect(t.meses).toHaveLength(6);
    expect(t.meses[5]).toMatchObject({ mes: '2026-11', casos: 8, medianaDias: 2 });
    expect(t.meses[0].mes).toBe('2026-06');
  });

  it('el diagnóstico del flujo trae su tendencia y el indicador cuenta flujos más rápidos', () => {
    const { solicitudes, instancias } = casos();
    const d = diagnosticar({ ahora: AHORA, tareas, solicitudes, instancias, notas: [], erroresSap: [] });
    expect(d.tendencia.meses).toHaveLength(6);
    expect(d.ciclos).toHaveLength(24);
    const r = resumirFlujo(1, 'A', d, []);
    expect(totalizar([r])).toMatchObject({ masRapidos: 0, masLentos: 0 });
  });
});

describe('tendencia de la empresa sin efecto mezcla', () => {
  const H = new Date('2026-11-09T12:00:00Z');
  const hace = (dias: number) => H.getTime() - dias * 86_400_000;
  const lote = (n: number, desde: number, dur: number): [number, number][] => Array.from({ length: n }, (_, i) => [hace(desde + i), dur]);

  it('un flujo automatizado que gana volumen NO hace «más rápida» a la empresa', () => {
    // Pagos: igual (5 días antes y ahora). Ofertas: instantáneas, solo recientes (sin base).
    const pagos = [...lote(10, 1, 5), ...lote(10, 40, 5)];
    const ofertas = lote(30, 1, 0.001);
    const fl = [pagos, ofertas].map((c) => ({ tendencia: calcularTendencia(c, H), ciclos: c }));
    const mezclado = calcularTendencia([...pagos, ...ofertas], H);
    expect(mezclado.veredicto).toBe('mas_rapido'); // lo que daba antes: engañoso
    expect(tendenciaEmpresa(fl, H)).toMatchObject({ veredicto: 'igual', cambioPct: 0 });
  });

  it('promedia los cambios de cada flujo pesados por sus casos recientes', () => {
    const a = [...lote(30, 0, 2), ...lote(10, 40, 4)]; // −50 %, 30 recientes (días 0 a 29)
    const b = [...lote(10, 1, 3), ...lote(10, 40, 2)]; // +50 %, 10 recientes
    const fl = [a, b].map((c) => ({ tendencia: calcularTendencia(c, H), ciclos: c }));
    expect(tendenciaEmpresa(fl, H)).toMatchObject({ cambioPct: -25, veredicto: 'mas_rapido' });
  });

  it('sin flujos comparables: sin datos', () => {
    expect(tendenciaEmpresa([{ tendencia: calcularTendencia(lote(3, 1, 2), H), ciclos: lote(3, 1, 2) }], H).veredicto).toBe('sin_datos');
  });
});

describe('criterio: ¿va bien o necesita mejoras?', () => {
  const H = new Date('2026-11-09T12:00:00Z');
  const vacio = (over: Partial<Parameters<typeof calificarFlujo>[0]> = {}) => ({
    desde: '2026-05-13',
    solicitudes: 2,
    resueltas: 1,
    cicloMedianaDias: 11.8,
    cicloP90Dias: 11.8,
    abiertas: 0,
    devueltas: 0,
    conRetrabajo: 0,
    tendencia: calcularTendencia([], H),
    ciclos: [],
    tareas: [],
    sugerencias: [],
    ...over,
  });

  it('11,8 días con pocos casos = necesita mejoras (no «va bien»), y lo dice', () => {
    const c = calificarFlujo(vacio(), 0);
    expect(c.estado).toBe('necesita_mejoras');
    expect(c.pocosCasos).toBe(true);
    expect(c.motivos[0]).toContain('11,8 días');
    expect(c.motivos.at(-1)).toContain('Con pocos casos: 1 solicitud resuelta');
  });

  it('4 días o sugerencias sin revisar = revisar; rápido y con casos = va bien; sin casos = pocos datos', () => {
    expect(calificarFlujo(vacio({ cicloMedianaDias: 4, resueltas: 20 }), 0).estado).toBe('revisar');
    expect(calificarFlujo(vacio({ cicloMedianaDias: 0.5, resueltas: 20 }), 2).estado).toBe('revisar');
    expect(calificarFlujo(vacio({ cicloMedianaDias: 0.5, resueltas: 20 }), 0).estado).toBe('va_bien');
    expect(calificarFlujo(vacio({ cicloMedianaDias: null, resueltas: 0 }), 0).estado).toBe('pocos_datos');
  });

  it('una tarea en rojo = necesita mejoras', () => {
    const { solicitudes, instancias } = casos();
    const d = diagnosticar({ ahora: AHORA, tareas, solicitudes, instancias, notas: [], erroresSap: [] });
    expect(calificarFlujo(d, 0)).toMatchObject({ estado: 'necesita_mejoras', pocosCasos: false });
  });
});

