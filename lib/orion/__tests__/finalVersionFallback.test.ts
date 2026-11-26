import { describe, expect, it } from 'vitest';
import { coversAllSigners } from '../documentVersions';
import type { OrionSignerState } from '../types';

// La versión final se pide a Orion sin maxOrder para que tenga respaldo (último PDF en OneDrive).
const JUAN = 'juan.fonseca@gsslatam.com';
const done = (order: number): OrionSignerState =>
  ({ email: JUAN, order, status: 'FIRMADO', signedAt: `2026-11-24T15:3${order}:00.000Z` }) as OrionSignerState;
const pending = (order: number): OrionSignerState =>
  ({ email: JUAN, order, status: 'PENDIENTE', signedAt: null }) as OrionSignerState;

describe('coversAllSigners', () => {
  const signed = { status: 'FIRMADO', signers: [done(1), done(2)] };

  it('«Firma 2 (final)» de un documento firmado = documento completo', () => {
    expect(coversAllSigners(signed, 'final', 2)).toBe(true);
  });

  it('una parcial que ya llega al último orden también es el documento completo', () => {
    expect(coversAllSigners(signed, 'partial', 2)).toBe(true);
  });

  it('«Firma 1» sigue siendo histórica (se reconstruye hasta el orden 1)', () => {
    expect(coversAllSigners(signed, 'partial', 1)).toBe(false);
  });

  it('documento aún en firma: nunca se trata como completo', () => {
    const inProgress = { status: 'EN_PROCESO', signers: [done(1), pending(2)] };
    expect(coversAllSigners(inProgress, 'partial', 1)).toBe(false);
    expect(coversAllSigners(inProgress, 'final', 1)).toBe(false);
  });

  it('sin firmantes: no aplica', () => {
    expect(coversAllSigners({ status: 'FIRMADO', signers: [] }, 'final', null)).toBe(false);
  });
});
