import { describe, expect, it } from 'vitest';
import { findSignerForVersion, rebuildOrionVersionHistory } from '../documentVersions';
import { signerSlotProgress } from '../signerStatus';
import type { OrionSignatureState, OrionSignerState } from '../types';

// La misma persona firma dos veces el mismo PDF (slots 1 y 2).
const JUAN = 'juan.fonseca@gsslatam.com';
const T1 = '2026-11-24T15:37:44.000Z';
const T2 = '2026-11-24T15:38:46.000Z';

function signers(secondSigned: boolean): OrionSignerState[] {
  return [
    { email: JUAN, name: 'Juan Fonseca', order: 1, status: 'FIRMADO', signedAt: T1 },
    {
      email: JUAN,
      name: 'Juan Fonseca',
      order: 2,
      status: secondSigned ? 'FIRMADO' : 'PENDIENTE',
      signedAt: secondSigned ? T2 : null,
    },
  ] as OrionSignerState[];
}

describe('versiones con dos firmas de la misma persona', () => {
  const state = rebuildOrionVersionHistory(
    {
      status: 'FIRMADO',
      signers: signers(true),
      signedFileUrl: 'https://orion.local/api/documents/1/signed-file',
      originalFileUrl: 'https://onedrive.local/original.pdf',
    } as OrionSignatureState,
    null
  );
  const partial = state.versions!.find((v) => v.kind === 'partial')!;
  const final = state.versions!.find((v) => v.kind === 'final')!;

  it('«Firma 2 (final)» corresponde al slot 2, no al primero del correo', () => {
    expect(final.label).toContain('Firma 2 (final)');
    expect(findSignerForVersion(state.signers, final)?.order).toBe(2);
  });

  it('«Firma 1» sigue correspondiendo al slot 1', () => {
    expect(findSignerForVersion(state.signers, partial)?.order).toBe(1);
  });

  it('sin id exacto, desempata por la fecha de firma', () => {
    const legacy = { id: 'legacy-x', signerEmail: JUAN, createdAt: T2 };
    expect(findSignerForVersion(state.signers, legacy)?.order).toBe(2);
  });
});

describe('signerSlotProgress', () => {
  it('después de la primera firma: le toca la 2 de 2', () => {
    expect(signerSlotProgress(signers(false), JUAN)).toEqual({ total: 2, done: 1, position: 2 });
  });

  it('con el slot indicado devuelve su posición', () => {
    expect(signerSlotProgress(signers(false), JUAN, { order: 1 }).position).toBe(1);
    expect(signerSlotProgress(signers(false), JUAN, { order: 2 }).position).toBe(2);
  });

  it('todas firmadas: done = total y sin posición pendiente', () => {
    expect(signerSlotProgress(signers(true), JUAN)).toEqual({ total: 2, done: 2, position: 0 });
  });

  it('una sola firma o correo ajeno', () => {
    expect(signerSlotProgress(signers(true).slice(0, 1), JUAN).total).toBe(1);
    expect(signerSlotProgress(signers(true), 'otro@gsslatam.com').total).toBe(0);
  });
});
