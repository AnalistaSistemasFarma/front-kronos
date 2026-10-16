import { describe, expect, it } from 'vitest';
import {
  buildPendingApprovals,
  knownReadyForSigning,
  orderDocumentValidators,
  previousReviewValidatorIds,
  type OrionReviewValidator,
} from '../reviewState';
import type { OrionReviewState } from '../types';

const flow: OrionReviewValidator[] = [
  { userId: 'u-ana', email: 'ana@x.com', name: 'Ana', order: 1 },
  { userId: 'u-beto', email: 'beto@x.com', name: 'Beto', order: 2 },
  { userId: 'u-caro', email: 'caro@x.com', name: 'Caro', order: 3 },
];

describe('orden de validadores por documento', () => {
  it('respeta el orden elegido por el preparador, no el del flujo', () => {
    const { validators, unknownIds } = orderDocumentValidators(flow, ['u-caro', 'u-ana']);
    expect(unknownIds).toEqual([]);
    expect(validators.map((v) => [v.userId, v.order])).toEqual([
      ['u-caro', 1],
      ['u-ana', 2],
    ]);
    expect(buildPendingApprovals(validators).map((a) => a.email)).toEqual([
      'caro@x.com',
      'ana@x.com',
    ]);
  });

  it('ignora duplicados y vacíos, y reporta personas fuera del grupo del flujo', () => {
    const { validators, unknownIds } = orderDocumentValidators(flow, [
      'u-beto',
      '',
      'u-beto',
      'u-intruso',
    ]);
    expect(validators.map((v) => v.userId)).toEqual(['u-beto']);
    expect(unknownIds).toEqual(['u-intruso']);
  });

  it('sin selección no hay validadores', () => {
    expect(orderDocumentValidators(flow, undefined).validators).toEqual([]);
    expect(orderDocumentValidators(flow, 'u-ana').validators).toEqual([]);
  });

  it('el reenvío toma el orden de la ronda anterior', () => {
    const review: OrionReviewState = {
      status: 'DEVUELTO_CORRECCION',
      approvals: [
        { userId: 'u-ana', email: 'ana@x.com', order: 2, decision: 'PENDIENTE' },
        { userId: 'u-caro', email: 'caro@x.com', order: 1, decision: 'DEVUELTO' },
        { email: 'sin-id@x.com', order: 3, decision: 'PENDIENTE' },
      ],
    };
    expect(previousReviewValidatorIds(review)).toEqual(['u-caro', 'u-ana']);
    expect(previousReviewValidatorIds(null)).toEqual([]);
  });
});

describe('habilitar preparación sin consultar el flujo', () => {
  const withReview = (status: OrionReviewState['status']) => ({
    review: { status, approvals: [] },
  });

  it('solo con validación aprobada se puede preparar', () => {
    expect(knownReadyForSigning(withReview('APROBADO'))).toBe(true);
    expect(knownReadyForSigning(withReview('EN_VALIDACION'))).toBe(false);
    expect(knownReadyForSigning(withReview('DEVUELTO_CORRECCION'))).toBe(false);
  });

  it('sin validación iniciada depende del flujo', () => {
    expect(knownReadyForSigning(withReview('SIN_VALIDACION'))).toBeNull();
    expect(knownReadyForSigning({})).toBeNull();
    expect(knownReadyForSigning(null)).toBeNull();
  });
});
