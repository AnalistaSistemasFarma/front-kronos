import { describe, it, expect } from 'vitest';
import {
  parseDashboardDate,
  enrichRequestsWithResolution,
  computeResolutionSummary,
  listCompaniesFromTasks,
  type RequestWithResolution,
} from '../requestResolution';
import type { DashboardRequest, DashboardTask } from '../types';

// Pruebas de la LÓGICA DE RESOLUCIÓN del workflow: a partir de las solicitudes y
// sus tareas, calcula si una solicitud está cerrada, cuántas horas tomó y de qué
// fuente sale la fecha de cierre (la propia solicitud o la última tarea). Es el
// núcleo de los KPIs de tiempos del tablero. Todo es lógica pura sobre objetos.

// Fábrica de solicitud con valores por defecto neutros; cada caso sobreescribe
// solo los campos que le interesan.
function makeRequest(overrides: Partial<DashboardRequest>): DashboardRequest {
  return {
    id_solicitud: 1,
    asunto_solicitud: 'Asunto',
    descripcion_solicitud: 'Descripción',
    fecha_creacion_solicitud: '2026-01-01T00:00:00',
    empresa_solicitud: 'Farmalógica',
    creador_solicitud: 'Ana',
    estado_solicitud: 'Abierto',
    resolucion_solicitud: null,
    fecha_resolucion_solicitud: null,
    ejecutor_final_solicitud: null,
    proceso_solicitud: 'Compras',
    categoria_solicitud: 'General',
    encargado_proceso: null,
    ...overrides,
  };
}

function makeTask(overrides: Partial<DashboardTask>): DashboardTask {
  return {
    id_tarea: 100,
    tarea: 'Tarea',
    estado_tarea: 'Completada',
    asignado_tarea: 'Pedro',
    hora_inicio_tarea: null,
    fecha_fin_tarea: null,
    resolucion_tarea: null,
    fecha_resolucion_tarea: null,
    costo_tarea: null,
    centro_costo_tarea: null,
    activo_tarea: true,
    ejecutor_final_tarea: null,
    id_solicitud: 1,
    asunto_solicitud: 'Asunto',
    descripcion_solicitud: 'Descripción',
    fecha_creacion_solicitud: '2026-01-01T00:00:00',
    empresa_solicitud: 'Farmalógica',
    creador_solicitud: 'Ana',
    estado_solicitud: 'Abierto',
    resolucion_solicitud: null,
    fecha_resolucion_solicitud: null,
    ejecutor_final_solicitud: null,
    proceso_solicitud: 'Compras',
    categoria_solicitud: 'General',
    ...overrides,
  };
}

describe('parseDashboardDate', () => {
  it('acepta fechas ISO con y sin hora', () => {
    expect(parseDashboardDate('2026-07-28T10:30:00')?.getTime()).not.toBeNaN();
    expect(parseDashboardDate('2026-07-28')?.getTime()).not.toBeNaN();
  });

  it('devuelve null para vacío, nulo o fecha inválida', () => {
    expect(parseDashboardDate(null)).toBeNull();
    expect(parseDashboardDate(undefined)).toBeNull();
    expect(parseDashboardDate('   ')).toBeNull();
    expect(parseDashboardDate('no-es-fecha')).toBeNull();
  });
});

describe('enrichRequestsWithResolution — fuente de la fecha de cierre', () => {
  it('usa la fecha de la solicitud cuando existe (fuente = solicitud)', () => {
    const req = makeRequest({
      fecha_creacion_solicitud: '2026-01-01T00:00:00',
      fecha_resolucion_solicitud: '2026-01-02T00:00:00', // +24 h
      estado_solicitud: 'Resuelto',
    });
    const [out] = enrichRequestsWithResolution([req], []);
    expect(out.resolutionSource).toBe('solicitud');
    expect(out.resolutionHours).toBeCloseTo(24, 5);
    expect(out.isClosed).toBe(true);
  });

  it('cae a la ÚLTIMA tarea cuando la solicitud no tiene fecha de resolución (fuente = tareas)', () => {
    const req = makeRequest({
      id_solicitud: 7,
      fecha_creacion_solicitud: '2026-01-01T00:00:00',
      fecha_resolucion_solicitud: null,
    });
    const tasks = [
      makeTask({ id_solicitud: 7, fecha_fin_tarea: '2026-01-01T05:00:00' }),
      makeTask({ id_solicitud: 7, fecha_fin_tarea: '2026-01-01T09:00:00' }), // la más tardía
    ];
    const [out] = enrichRequestsWithResolution([req], tasks);
    expect(out.resolutionSource).toBe('tareas');
    // 9 horas hasta la tarea más tardía.
    expect(out.resolutionHours).toBeCloseTo(9, 5);
    expect(out.isClosed).toBe(true);
  });

  it('empareja tareas por id_solicitud aunque la fila venga como ID_Solicitud', () => {
    const req = makeRequest({
      id_solicitud: 42,
      fecha_creacion_solicitud: '2026-01-01T00:00:00',
      fecha_resolucion_solicitud: null,
    });
    // vw_tareas_solicitudes a veces expone ID_Solicitud (mayúsculas) en vez de id_solicitud.
    const rawTask = {
      ...makeTask({ fecha_fin_tarea: '2026-01-01T02:00:00' }),
      id_solicitud: undefined,
      ID_Solicitud: 42,
    } as unknown as DashboardTask;
    const [out] = enrichRequestsWithResolution([req], [rawTask]);
    expect(out.resolutionSource).toBe('tareas');
    expect(out.resolutionHours).toBeCloseTo(2, 5);
  });

  it('deja la solicitud ABIERTA (sin horas) cuando no hay ninguna fecha de cierre', () => {
    const req = makeRequest({ estado_solicitud: 'En proceso', fecha_resolucion_solicitud: null });
    const [out] = enrichRequestsWithResolution([req], []);
    expect(out.resolutionHours).toBeNull();
    expect(out.resolutionSource).toBeNull();
    expect(out.isClosed).toBe(false);
  });

  it('marca cerrada por ESTADO aunque no haya fecha (isClosed=true, horas=null)', () => {
    const req = makeRequest({ estado_solicitud: 'Cancelado', fecha_resolucion_solicitud: null });
    const [out] = enrichRequestsWithResolution([req], []);
    expect(out.isClosed).toBe(true);
    expect(out.resolutionHours).toBeNull();
  });

  it('descarta duraciones negativas (cierre anterior a la creación)', () => {
    const req = makeRequest({
      fecha_creacion_solicitud: '2026-01-02T00:00:00',
      fecha_resolucion_solicitud: '2026-01-01T00:00:00', // antes de crear
      estado_solicitud: 'Resuelto',
    });
    const [out] = enrichRequestsWithResolution([req], []);
    // La fuente sigue siendo la solicitud, pero no se computan horas inválidas.
    expect(out.resolutionHours).toBeNull();
  });
});

describe('computeResolutionSummary — estadísticos de tiempos', () => {
  function enrichedFrom(hoursList: (number | null)[]): RequestWithResolution[] {
    return hoursList.map((h, i) => ({
      ...makeRequest({ id_solicitud: i + 1 }),
      resolutionHours: h,
      resolutionEndDate: h == null ? null : '2026-01-01T00:00:00',
      resolutionSource: h == null ? null : 'solicitud',
      isClosed: h != null,
    }));
  }

  it('calcula promedio, mediana (impar), mínimo y máximo; cuenta abiertas', () => {
    const enriched = enrichedFrom([2, 4, 6, null]); // 3 cerradas con tiempo, 1 abierta
    const s = computeResolutionSummary(enriched);
    expect(s.closedWithTime).toBe(3);
    expect(s.openCount).toBe(1);
    expect(s.avgHours).toBeCloseTo(4, 5);
    expect(s.medianHours).toBe(4); // longitud impar -> valor central
    expect(s.minHours).toBe(2);
    expect(s.maxHours).toBe(6);
  });

  it('la mediana con cantidad par promedia los dos valores centrales', () => {
    const s = computeResolutionSummary(enrichedFrom([1, 3, 5, 7]));
    expect(s.medianHours).toBe(4); // (3 + 5) / 2
  });

  it('sin cierres con tiempo devuelve nulos y solo cuenta las abiertas', () => {
    const s = computeResolutionSummary(enrichedFrom([null, null]));
    expect(s).toEqual({
      closedWithTime: 0,
      openCount: 2,
      avgHours: null,
      medianHours: null,
      minHours: null,
      maxHours: null,
    });
  });
});

describe('listCompaniesFromTasks', () => {
  it('devuelve empresas únicas, sin vacíos y ordenadas en español', () => {
    const tasks = [
      makeTask({ empresa_solicitud: 'Ryan' }),
      makeTask({ empresa_solicitud: 'Abamia' }),
      makeTask({ empresa_solicitud: '  Ryan  ' }), // duplicada tras trim
      makeTask({ empresa_solicitud: '' }), // se ignora
    ];
    expect(listCompaniesFromTasks(tasks)).toEqual(['Abamia', 'Ryan']);
  });
});
