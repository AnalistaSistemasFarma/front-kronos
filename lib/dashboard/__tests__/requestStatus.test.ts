import { describe, it, expect } from 'vitest';
import {
  normalizeRequestStatus,
  isRequestClosedStatus,
  countRequestsByDashboardStatus,
} from '../requestStatus';

// Pruebas unitarias sobre la MÁQUINA DE ESTADOS del workflow BPM de solicitudes.
// `normalizeRequestStatus` es el punto único que traduce los múltiples textos de
// estado que llegan de SynerLink/Kronos (con variantes de idioma, mayúsculas,
// espacios y sinónimos) a las cinco categorías canónicas del dashboard. Es lógica
// PURA (sin BD ni red), así que se puede probar de forma determinista.

describe('normalizeRequestStatus — alias exactos', () => {
  it('mapea los estados "cerrados" a Cerrada (resuelto, cancelado, finalizado, etc.)', () => {
    expect(normalizeRequestStatus('Resuelto')).toBe('Cerrada');
    expect(normalizeRequestStatus('cancelada')).toBe('Cerrada');
    expect(normalizeRequestStatus('Completado')).toBe('Cerrada');
    expect(normalizeRequestStatus('finalizada')).toBe('Cerrada');
    expect(normalizeRequestStatus('closed')).toBe('Cerrada');
  });

  it('distingue Abierto de "En proceso" (son categorías separadas del tablero)', () => {
    expect(normalizeRequestStatus('Abierto')).toBe('Abierto');
    expect(normalizeRequestStatus('abierta')).toBe('Abierto');
    expect(normalizeRequestStatus('En proceso')).toBe('En proceso');
    expect(normalizeRequestStatus('asignado')).toBe('En proceso');
    expect(normalizeRequestStatus('en curso')).toBe('En proceso');
  });

  it('mapea los estados de "aún sin trabajar" a Pendiente', () => {
    expect(normalizeRequestStatus('Pendiente')).toBe('Pendiente');
    expect(normalizeRequestStatus('sin empezar')).toBe('Pendiente');
    expect(normalizeRequestStatus('nuevo')).toBe('Pendiente');
  });
});

describe('normalizeRequestStatus — normalización de forma', () => {
  it('es insensible a mayúsculas y a espacios repetidos', () => {
    expect(normalizeRequestStatus('  EN   PROCESO ')).toBe('En proceso');
    expect(normalizeRequestStatus('CANCELADO')).toBe('Cerrada');
  });

  it('nulo, indefinido y cadena vacía caen en "Sin estado"', () => {
    expect(normalizeRequestStatus(null)).toBe('Sin estado');
    expect(normalizeRequestStatus(undefined)).toBe('Sin estado');
    expect(normalizeRequestStatus('')).toBe('Sin estado');
    expect(normalizeRequestStatus('   ')).toBe('Sin estado');
  });
});

describe('normalizeRequestStatus — respaldo por expresión regular', () => {
  it('reconoce variantes no listadas por raíz de palabra', () => {
    // No están en los alias exactos, pero las regex las clasifican igual.
    expect(normalizeRequestStatus('Solicitud resuelta con éxito')).toBe('Cerrada');
    expect(normalizeRequestStatus('en progreso avanzado')).toBe('En proceso');
    expect(normalizeRequestStatus('pendientes por revisar')).toBe('Pendiente');
  });

  it('la prioridad de reglas pone "cerrado" por encima del resto', () => {
    // Contiene "pendiente" y "cerrada"; el orden de evaluación (CLOSED primero)
    // debe ganar para que un caso ya cerrado no cuente como abierto/pendiente.
    expect(normalizeRequestStatus('cerrada, sin pendientes')).toBe('Cerrada');
  });

  it('un texto sin ninguna coincidencia cae en "Sin estado"', () => {
    expect(normalizeRequestStatus('estado desconocido xyz')).toBe('Sin estado');
  });
});

describe('isRequestClosedStatus', () => {
  it('es verdadero solo cuando el estado normaliza a Cerrada', () => {
    expect(isRequestClosedStatus('Resuelto')).toBe(true);
    expect(isRequestClosedStatus('cancelada')).toBe(true);
    expect(isRequestClosedStatus('Abierto')).toBe(false);
    expect(isRequestClosedStatus('En proceso')).toBe(false);
    expect(isRequestClosedStatus(null)).toBe(false);
  });
});

describe('countRequestsByDashboardStatus', () => {
  it('cuenta cada solicitud en su bucket canónico y respeta el total', () => {
    const requests = [
      { estado_solicitud: 'Abierto' },
      { estado_solicitud: 'abierta' },
      { estado_solicitud: 'En proceso' },
      { estado_solicitud: 'Resuelto' },
      { estado_solicitud: 'cancelado' },
      { estado_solicitud: 'Pendiente' },
      { estado_solicitud: 'texto raro sin match' }, // Sin estado -> no suma a ningún bucket
    ];

    const counts = countRequestsByDashboardStatus(requests);

    expect(counts.total).toBe(7);
    expect(counts.abierto).toBe(2);
    expect(counts.enProceso).toBe(1);
    expect(counts.cerrada).toBe(2);
    expect(counts.pendiente).toBe(1);
    // "Sin estado" no incrementa ninguno de los cuatro buckets contables.
    expect(counts.abierto + counts.enProceso + counts.cerrada + counts.pendiente).toBe(6);
  });

  it('devuelve todos los buckets en cero para una lista vacía', () => {
    expect(countRequestsByDashboardStatus([])).toEqual({
      total: 0,
      cerrada: 0,
      pendiente: 0,
      abierto: 0,
      enProceso: 0,
    });
  });
});
