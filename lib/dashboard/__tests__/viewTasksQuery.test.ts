import { describe, it, expect } from 'vitest';
import {
  validateDateRange,
  parseViewTasksFilters,
  resolveSolicitudId,
  buildSummary,
} from '../viewTasksQuery';
import { normalizeActivityStatus, normalizeAssigneeName } from '../normalizeActivityFields';

// Pruebas de utilidades PURAS del endpoint de tareas del workflow:
//  - validación de rangos de fecha del filtro (formato y coherencia),
//  - lectura de filtros desde los query params,
//  - resolución del id de solicitud tolerando las variantes de columna de la
//    vista SQL (id_solicitud / ID_Solicitud / id),
//  - normalización de estado y asignado de actividades,
//  - resumen de conteos por estado de tarea.
// No se prueba la construcción del SQL crudo ni la ejecución (dependen de mssql).

describe('validateDateRange', () => {
  it('sin ninguna fecha es válido (filtro opcional)', () => {
    expect(validateDateRange(null, null)).toBeNull();
    expect(validateDateRange(undefined, undefined)).toBeNull();
  });

  it('exige que ambas fechas vengan juntas', () => {
    expect(validateDateRange('2026-01-01', null)).toMatch(/juntos/i);
    expect(validateDateRange(null, '2026-01-31')).toMatch(/juntos/i);
  });

  it('rechaza formatos que no sean YYYY-MM-DD', () => {
    expect(validateDateRange('01/01/2026', '2026-01-31')).toMatch(/formato YYYY-MM-DD/i);
  });

  it('rechaza fechas de calendario imposibles', () => {
    // 2026 no es bisiesto: el 29 de febrero no existe.
    expect(validateDateRange('2026-02-29', '2026-03-01')).toMatch(/inválida/i);
    expect(validateDateRange('2026-13-01', '2026-12-31')).toBeTruthy();
  });

  it('rechaza que el inicio sea posterior al fin', () => {
    expect(validateDateRange('2026-03-01', '2026-01-01')).toMatch(/posterior/i);
  });

  it('acepta un rango válido', () => {
    expect(validateDateRange('2026-01-01', '2026-01-31')).toBeNull();
    // Mismo día también es válido.
    expect(validateDateRange('2026-01-15', '2026-01-15')).toBeNull();
  });
});

describe('parseViewTasksFilters', () => {
  it('extrae los filtros presentes y deja null los ausentes', () => {
    const params = new URLSearchParams('company=Ryan&process=Compras&task_status=Completada');
    const filters = parseViewTasksFilters(params);
    expect(filters.company).toBe('Ryan');
    expect(filters.process).toBe('Compras');
    expect(filters.task_status).toBe('Completada');
    expect(filters.creator).toBeNull();
    expect(filters.date_from).toBeNull();
  });
});

describe('resolveSolicitudId — tolerancia a variantes de columna', () => {
  it('lee id_solicitud en minúsculas', () => {
    expect(resolveSolicitudId({ id_solicitud: 15 } as never)).toBe(15);
  });

  it('cae a ID_Solicitud cuando no hay minúsculas', () => {
    expect(resolveSolicitudId({ ID_Solicitud: 22 } as never)).toBe(22);
  });

  it('cae a id como último recurso', () => {
    expect(resolveSolicitudId({ id: 30 } as never)).toBe(30);
  });

  it('coacciona cadenas numéricas', () => {
    expect(resolveSolicitudId({ id_solicitud: '7' } as never)).toBe(7);
  });

  it('devuelve null para ausente, cero, negativo o no numérico', () => {
    expect(resolveSolicitudId({} as never)).toBeNull();
    expect(resolveSolicitudId({ id_solicitud: 0 } as never)).toBeNull();
    expect(resolveSolicitudId({ id_solicitud: -3 } as never)).toBeNull();
    expect(resolveSolicitudId({ id_solicitud: 'abc' } as never)).toBeNull();
  });
});

describe('normalizeActivityStatus', () => {
  it('agrupa sinónimos de cierre en "Completada"', () => {
    expect(normalizeActivityStatus('completada')).toBe('Completada');
    expect(normalizeActivityStatus('Resuelto')).toBe('Completada');
    expect(normalizeActivityStatus('resuelta')).toBe('Completada');
  });

  it('agrupa en proceso / en progreso', () => {
    expect(normalizeActivityStatus('en proceso')).toBe('En Proceso');
    expect(normalizeActivityStatus('en progreso')).toBe('En Proceso');
  });

  it('vacío o nulo cae en "Pendiente"', () => {
    expect(normalizeActivityStatus(null)).toBe('Pendiente');
    expect(normalizeActivityStatus('')).toBe('Pendiente');
    expect(normalizeActivityStatus('sin empezar')).toBe('Pendiente');
  });

  it('un estado desconocido se conserva tal cual (recortado)', () => {
    expect(normalizeActivityStatus('  Estado X  ')).toBe('Estado X');
  });
});

describe('normalizeAssigneeName', () => {
  it('recorta y usa "Sin asignar" cuando queda vacío', () => {
    expect(normalizeAssigneeName('  Ana  ')).toBe('Ana');
    expect(normalizeAssigneeName('')).toBe('Sin asignar');
    expect(normalizeAssigneeName(null)).toBe('Sin asignar');
  });
});

describe('buildSummary — conteo por estado de tarea', () => {
  it('cuenta completadas, pendientes, en proceso y otros', () => {
    const rows = [
      { estado_tarea: 'Completada' },
      { estado_tarea: 'Completada' },
      { estado_tarea: 'Pendiente' },
      { estado_tarea: 'En Proceso' },
      { estado_tarea: 'Cancelada' }, // no encaja en los tres -> "otros"
    ] as never[];
    const summary = buildSummary(rows as never);
    expect(summary).toEqual({
      total: 5,
      completada: 2,
      pendiente: 1,
      en_proceso: 1,
      otros: 1,
    });
  });
});
