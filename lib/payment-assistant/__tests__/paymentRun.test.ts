import { describe, it, expect } from 'vitest';
import {
  mapAuthStatusToRunStatus,
  isPaymentRunApproved,
  PAYMENT_RUN_PROCESS_NAME,
} from '../paymentRun';

describe('mapAuthStatusToRunStatus', () => {
  it('mapea 2 (Resuelto/Aprobado) a "aprobada"', () => {
    expect(mapAuthStatusToRunStatus(2)).toBe('aprobada');
  });

  it('mapea 3 (Cancelado/Rechazado) a "rechazada"', () => {
    expect(mapAuthStatusToRunStatus(3)).toBe('rechazada');
  });

  it('mapea 4, otros valores y null/undefined a "pendiente"', () => {
    expect(mapAuthStatusToRunStatus(4)).toBe('pendiente');
    expect(mapAuthStatusToRunStatus(1)).toBe('pendiente');
    expect(mapAuthStatusToRunStatus(null)).toBe('pendiente');
    expect(mapAuthStatusToRunStatus(undefined)).toBe('pendiente');
  });
});

describe('isPaymentRunApproved', () => {
  it('solo es true cuando el estado es 2 (aprobado)', () => {
    expect(isPaymentRunApproved(2)).toBe(true);
    expect(isPaymentRunApproved(3)).toBe(false);
    expect(isPaymentRunApproved(4)).toBe(false);
    expect(isPaymentRunApproved(null)).toBe(false);
    expect(isPaymentRunApproved(undefined)).toBe(false);
  });
});

describe('PAYMENT_RUN_PROCESS_NAME', () => {
  it('coincide con el nombre del proceso configurado en la base', () => {
    expect(PAYMENT_RUN_PROCESS_NAME).toBe('Corrida de Pago');
  });
});
