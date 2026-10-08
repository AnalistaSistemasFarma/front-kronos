import { describe, expect, it } from 'vitest';
import { describeElaboratorChoice, resolveElaborator, type SgcElaboratorInput } from '../flows/elaborator';

/**
 * 2026-10-05 (demo PiSA, pedido de Nicolás): el solicitante no elige al
 * elaborador; sale de la configuración del proceso (matriz de responsables)
 * y, por respaldo, de Aseguramiento de Calidad. Nunca el solicitante.
 */

const SOL = 'sol@x.co';
const A = 'a@x.co';
const B = 'b@x.co';
const Q = 'q@x.co';
const base = (o: Partial<SgcElaboratorInput> = {}): SgcElaboratorInput => ({
  requesterEmail: SOL,
  matrixPeople: [],
  eligible: new Set([SOL, A, B, Q]),
  quality: new Set([Q]),
  requireQuality: false,
  openLoad: new Map(),
  ...o,
});

describe('SGC · elaborador por configuración del proceso (reglas puras)', () => {
  it('toma la matriz cuando define a alguien habilitado', () => {
    expect(resolveElaborator(base({ matrixPeople: [A] }))).toMatchObject({ email: A, source: 'matriz', candidates: [A] });
  });

  it('entre varios de la matriz, gana el de menor carga; empate: el orden de la matriz', () => {
    expect(resolveElaborator(base({ matrixPeople: [A, B], openLoad: new Map([[A, 2], [B, 1]]) }))?.email).toBe(B);
    expect(resolveElaborator(base({ matrixPeople: [B, A] }))?.email).toBe(B);
  });

  it('descarta al solicitante, a quien no está habilitado y (si se exige) a quien no es de Calidad, con el motivo', () => {
    const r = resolveElaborator(base({ matrixPeople: [SOL, 'fuera@x.co', A], requireQuality: true }))!;
    expect(r).toMatchObject({ email: Q, source: 'calidad' });
    expect(r.discarded.map((d) => d.email)).toEqual([SOL, 'fuera@x.co', A]);
    expect(r.discarded[2].reason).toMatch(/Aseguramiento de Calidad/);
  });

  it('respaldo en Calidad sin el solicitante; sin nadie, null', () => {
    expect(resolveElaborator(base({ quality: new Set([SOL, Q]) }))?.email).toBe(Q);
    expect(resolveElaborator(base({ quality: new Set([SOL]) }))).toBeNull();
  });

  it('mayúsculas y espacios no cuelan al solicitante', () => {
    expect(resolveElaborator(base({ matrixPeople: [' SOL@X.CO '], quality: new Set([' Sol@x.co']) }))).toBeNull();
  });

  it('el historial dice de dónde salió y que Calidad puede reasignar', () => {
    const r = resolveElaborator(base({ matrixPeople: [A, B] }))!;
    expect(describeElaboratorChoice(r, 'proceso GC')).toMatch(/según la matriz de responsables \(proceso GC\): a@x\.co\. Candidatos: a@x\.co, b@x\.co .*Calidad puede reasignar/);
    expect(describeElaboratorChoice(resolveElaborator(base())!, null)).toMatch(/por respaldo: Aseguramiento de Calidad/);
  });
});
