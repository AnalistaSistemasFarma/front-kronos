import { describe, it, expect } from 'vitest';
import {
  getTaskResolutionHours,
  formatResolutionDuration,
  formatTrendChange,
  buildResolutionTimeSeries,
  MAX_TICKET_RESOLUTION_HOURS,
  type TaskForResolutionTime,
} from '../resolutionTimeSeries';

// Pruebas de la SERIE TEMPORAL de tiempos de resolución de tareas del workflow.
// Cubren: cálculo de horas por tarea (con tope de descarte de outliers), formato
// legible de duración, cálculo de tendencia vs periodo anterior, y el ensamblado
// de la serie (filtrado por asignado, descarte de tareas abiertas). Lógica pura.

function makeTask(overrides: Partial<TaskForResolutionTime>): TaskForResolutionTime {
  return {
    estado_tarea: 'Completada',
    asignado_tarea: 'Pedro',
    hora_inicio_tarea: null,
    fecha_fin_tarea: null,
    fecha_resolucion_tarea: null,
    ...overrides,
  };
}

describe('getTaskResolutionHours', () => {
  it('mide desde inicio de trabajo hasta fin de tarea', () => {
    const h = getTaskResolutionHours(
      makeTask({ hora_inicio_tarea: '2026-01-01T08:00:00', fecha_fin_tarea: '2026-01-01T11:00:00' })
    );
    expect(h).toBeCloseTo(3, 5);
  });

  it('usa fecha_resolucion_tarea como respaldo si falta fecha_fin_tarea', () => {
    const h = getTaskResolutionHours(
      makeTask({
        hora_inicio_tarea: '2026-01-01T08:00:00',
        fecha_fin_tarea: null,
        fecha_resolucion_tarea: '2026-01-01T09:30:00',
      })
    );
    expect(h).toBeCloseTo(1.5, 5);
  });

  it('devuelve null si falta el inicio o el fin', () => {
    expect(getTaskResolutionHours(makeTask({ hora_inicio_tarea: null, fecha_fin_tarea: '2026-01-01T09:00:00' }))).toBeNull();
    expect(getTaskResolutionHours(makeTask({ hora_inicio_tarea: '2026-01-01T08:00:00', fecha_fin_tarea: null }))).toBeNull();
  });

  it('descarta duraciones negativas (fin anterior al inicio)', () => {
    expect(
      getTaskResolutionHours(
        makeTask({ hora_inicio_tarea: '2026-01-01T10:00:00', fecha_fin_tarea: '2026-01-01T09:00:00' })
      )
    ).toBeNull();
  });

  it('descarta outliers por encima del tope (30 días por defecto)', () => {
    // 31 días supera el máximo razonable -> registro inconsistente, se descarta.
    expect(
      getTaskResolutionHours(
        makeTask({ hora_inicio_tarea: '2026-01-01T00:00:00', fecha_fin_tarea: '2026-02-01T00:00:00' })
      )
    ).toBeNull();
  });

  it('respeta un tope personalizado (p. ej. tickets, un año)', () => {
    const h = getTaskResolutionHours(
      makeTask({ hora_inicio_tarea: '2026-01-01T00:00:00', fecha_fin_tarea: '2026-02-01T00:00:00' }),
      MAX_TICKET_RESOLUTION_HOURS
    );
    // Ahora sí entra porque el tope es de 365 días.
    expect(h).toBeCloseTo(31 * 24, 1);
  });
});

describe('formatResolutionDuration', () => {
  it('formatea minutos, horas y días con el umbral correcto', () => {
    expect(formatResolutionDuration(0)).toBe('< 1 min');
    expect(formatResolutionDuration(0.5)).toBe('30 min'); // media hora
    expect(formatResolutionDuration(2)).toBe('2 h');
    expect(formatResolutionDuration(2.5)).toBe('2 h 30 min');
    expect(formatResolutionDuration(48)).toBe('2.0 días');
  });

  it('devuelve guion largo para valores no finitos o negativos', () => {
    expect(formatResolutionDuration(-1)).toBe('—');
    expect(formatResolutionDuration(Number.NaN)).toBe('—');
  });
});

describe('formatTrendChange — tendencia vs periodo anterior', () => {
  it('el primer periodo no tiene comparación', () => {
    const r = formatTrendChange(5, null);
    expect(r.trend).toBeNull();
    expect(r.changeLabel).toBe('Primer periodo con datos');
  });

  it('marca "up" cuando ahora tarda más y "down" cuando fue más rápido', () => {
    expect(formatTrendChange(10, 5).trend).toBe('up'); // duplicó el tiempo
    expect(formatTrendChange(2, 10).trend).toBe('down'); // bajó bastante
  });

  it('trata diferencias ínfimas como "flat" / Sin cambio', () => {
    const r = formatTrendChange(5.0001, 5);
    expect(r.trend).toBe('flat');
    expect(r.changeLabel).toBe('Sin cambio');
  });
});

describe('buildResolutionTimeSeries — ensamblado de la serie', () => {
  it('sin tareas cerradas devuelve un resumen vacío', () => {
    const summary = buildResolutionTimeSeries([
      makeTask({ estado_tarea: 'Pendiente', hora_inicio_tarea: null, fecha_fin_tarea: null }),
    ]);
    expect(summary.completedTasks).toBe(0);
    expect(summary.points).toEqual([]);
    expect(summary.overallAvgHours).toBeNull();
  });

  it('promedia solo tareas cerradas y computa el promedio global', () => {
    const tasks = [
      makeTask({ hora_inicio_tarea: '2026-01-01T08:00:00', fecha_fin_tarea: '2026-01-01T10:00:00' }), // 2 h
      makeTask({ hora_inicio_tarea: '2026-01-02T08:00:00', fecha_fin_tarea: '2026-01-02T12:00:00' }), // 4 h
      // Abierta -> no entra en la serie.
      makeTask({ estado_tarea: 'En Proceso', hora_inicio_tarea: '2026-01-03T08:00:00', fecha_fin_tarea: null }),
    ];
    const summary = buildResolutionTimeSeries(tasks);
    expect(summary.completedTasks).toBe(2);
    expect(summary.overallAvgHours).toBeCloseTo(3, 5); // (2 + 4) / 2
    expect(summary.points.length).toBeGreaterThan(0);
  });

  it('filtra por persona asignada cuando se pasa el filtro', () => {
    const tasks = [
      makeTask({ asignado_tarea: 'Pedro', hora_inicio_tarea: '2026-01-01T08:00:00', fecha_fin_tarea: '2026-01-01T10:00:00' }),
      makeTask({ asignado_tarea: 'Ana', hora_inicio_tarea: '2026-01-01T08:00:00', fecha_fin_tarea: '2026-01-01T14:00:00' }),
    ];
    const soloPedro = buildResolutionTimeSeries(tasks, 'Pedro');
    expect(soloPedro.completedTasks).toBe(1);
    expect(soloPedro.overallAvgHours).toBeCloseTo(2, 5);
  });
});
