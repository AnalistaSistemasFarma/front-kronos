import { describe, expect, it, vi } from 'vitest';
import {
  APPROVAL_FIELD_HEIGHT,
  FINGERPRINT_FIELD_WIDTH,
  MAX_FIELD_HEIGHT,
  MAX_FIELD_WIDTH,
  SGC_MAX_LAYOUT_FIELDS,
  VALIDATION_FIELD_WIDTH,
  clampFieldSize,
  createFieldId,
  defaultSizeForKind,
  fieldFromRect,
  fromPlacements,
  isValidatorPlacementOrder,
  missingPlacements,
  normalizeFieldKind,
  normalizeFieldsForStorage,
  normalizeSgcFields,
  parseStoredFields,
  pctFromClientPoint,
  roundPct,
  sgcSignerKey,
  sizeBoundsForKind,
  toPlacements,
  validatorPlacementOrder,
  type SgcPlacementParticipant,
} from '../signature/fields';

/**
 * Correcciones de Calidad OLP (2026-10-02): FIRMAS DENTRO DEL DOCUMENTO. El
 * modelo de cajas es copia congelada del de SynerLink (lib/orion/signatureFields.ts);
 * las primeras pruebas son las mismas que SynerLink tiene para su modelo.
 */
const P: SgcPlacementParticipant[] = [
  { key: 'elaboracion:elab@onelatampharma.com', meaning: 'elaboro', name: 'Elaboradora', email: 'elab@onelatampharma.com', role: 'Elaboró' },
  { key: 'revision:rev@onelatampharma.com', meaning: 'reviso', name: 'Revisor', email: 'rev@onelatampharma.com', role: 'Revisó' },
  { key: 'aprobacion:apr@onelatampharma.com', meaning: 'aprobo', name: 'Aprobadora', email: 'apr@onelatampharma.com', role: 'Aprobó' },
  { key: 'aprobacion:grupo:SGC-VERIF-CALIDAD', meaning: 'aprobo', name: 'Aseguramiento de Calidad (grupo)', email: 'SGC-VERIF-CALIDAD', role: 'Aprobó' },
];

describe('SGC · firmas dentro del documento · modelo de cajas (copia de SynerLink)', () => {
  it('[SGC-REQ-094] clamp respeta los límites con width/height reales (igual que SynerLink)', () => {
    const clamped = clampFieldSize({ id: 'sf-1', documentId: 'doc-1', signerOrder: 1, page: 1, x: 90, y: 90, width: 60, height: 40 });
    expect(clamped.width).toBeLessThanOrEqual(MAX_FIELD_WIDTH);
    expect(clamped.height).toBeLessThanOrEqual(MAX_FIELD_HEIGHT);
    expect(clamped.x).toBeLessThanOrEqual(100 - clamped.width);
    expect(clamped.y).toBeLessThanOrEqual(100 - clamped.height);
  });

  it('[SGC-REQ-094] fieldFromRect calcula porcentajes desde el rectángulo de la página; con página vacía usa la caja por defecto', () => {
    const field = fieldFromRect({ pageRect: { left: 0, top: 0, width: 1000, height: 2000 } as DOMRect, fieldRect: { left: 100, top: 1500, width: 360, height: 320 } as DOMRect, signerOrder: 1, page: 2, documentId: 'doc-1' });
    expect([field.x, field.y, field.width, field.height]).toEqual([10, 75, 36, 16]);
    const fallback = fieldFromRect({ pageRect: { left: 0, top: 0, width: 0, height: 0 } as DOMRect, fieldRect: { left: 0, top: 0, width: 10, height: 10 } as DOMRect, signerOrder: 2, page: 1, documentId: 'd', id: 'x', kind: 'validation' });
    expect(fallback).toMatchObject({ id: 'x', x: 8, kind: 'validation', width: VALIDATION_FIELD_WIDTH });
  });

  it('[SGC-REQ-094] tipos, tamaños por defecto y límites por tipo de caja', () => {
    expect(['huella', 'validacion', 'validación', 'validador', 'approval', 'cualquiera', null].map((k) => normalizeFieldKind(k))).toEqual(['fingerprint', 'validation', 'validation', 'approval', 'approval', 'signature', 'signature']);
    expect(defaultSizeForKind('fingerprint').width).toBe(FINGERPRINT_FIELD_WIDTH);
    expect(defaultSizeForKind('approval').height).toBe(APPROVAL_FIELD_HEIGHT);
    expect(defaultSizeForKind('validation').width).toBe(VALIDATION_FIELD_WIDTH);
    expect(defaultSizeForKind(null)).toEqual({ width: 24, height: 12 });
    expect(sizeBoundsForKind('validation').maxW).toBe(28);
    expect(sizeBoundsForKind('approval').minW).toBe(8);
    expect(sizeBoundsForKind('fingerprint').minH).toBe(10);
    expect(sizeBoundsForKind('signature').maxW).toBe(MAX_FIELD_WIDTH);
    expect(validatorPlacementOrder(2)).toBe(902);
    expect([isValidatorPlacementOrder(902), isValidatorPlacementOrder(3)]).toEqual([true, false]);
    expect(pctFromClientPoint({ left: 10, top: 10, width: 100, height: 200 } as DOMRect, 60, 110)).toEqual({ x: 50, y: 50 });
    expect(pctFromClientPoint({ left: 0, top: 0, width: 0, height: 0 } as DOMRect, 1, 1)).toBeNull();
    expect(roundPct(1.23456)).toBe(1.23);
    expect(createFieldId()).toMatch(/^sf-[a-z0-9]+-[a-z0-9]+$/);
    const stored = normalizeFieldsForStorage([{ id: 'a', documentId: '', signerOrder: 0.4, page: 0, x: -5, y: 120, width: 20, height: 10, kind: 'huella' as never }], 'doc');
    expect(stored[0]).toMatchObject({ documentId: 'doc', signerOrder: 1, page: 1, x: 0, kind: 'fingerprint' });
  });
});

describe('SGC · firmas dentro del documento · lo propio del SGC', () => {
  it('[SGC-REQ-094] la llave de cada caja es el paso + la persona (o el grupo de Calidad)', () => {
    expect(sgcSignerKey('revision', ' Rev@OLP.com ')).toBe('revision:rev@olp.com');
    expect(sgcSignerKey('aprobacion', null, 'sgc-verif-calidad')).toBe('aprobacion:grupo:SGC-VERIF-CALIDAD');
    expect(sgcSignerKey('elaboracion', null)).toBe('elaboracion:');
  });

  it('[SGC-REQ-094] valida lo que guarda el elaborador: solo firmantes actuales, una caja por persona (gana la última), dentro del documento y del tamaño permitido', () => {
    expect(normalizeSgcFields('x', P, 2).error).toMatch(/inválidas/);
    expect(normalizeSgcFields(Array.from({ length: SGC_MAX_LAYOUT_FIELDS + 1 }, () => ({})), P, 2).error).toMatch(/Máximo/);
    expect(normalizeSgcFields([{ signerKey: 'revision:otro@x.com', page: 1, x: 1, y: 1, width: 20, height: 10 }], P, 2).error).toMatch(/ya no firma/);
    expect(normalizeSgcFields([{ signerKey: P[0].key, page: 1, x: 'a', y: 1, width: 20, height: 10 }], P, 2).error).toMatch(/inválidos/);
    expect(normalizeSgcFields([{ signerKey: P[0].key, page: 3, x: 1, y: 1, width: 20, height: 10 }], P, 2).error).toMatch(/fuera del documento \(página 3\)/);
    expect(normalizeSgcFields([{ signerKey: P[0].key, page: 0, x: 1, y: 1, width: 20, height: 10 }], P, null).error).toMatch(/fuera/);
    const ok = normalizeSgcFields(
      [
        { signerKey: P[0].key, page: 1, x: 5, y: 5, width: 20, height: 10, id: 'sug-0-0', label: '  Elaboró · Elaboradora ' },
        { signerKey: P[0].key, page: '2', x: '95', y: 1, width: 99, height: 2, id: '<script>' },
        { signerKey: P[3].key, page: 1, x: 70, y: 10, width: 20, height: 10, label: 7 },
      ],
      P,
      2
    );
    expect(ok.error).toBeNull();
    expect(ok.fields).toHaveLength(2);
    const elab = ok.fields.find((f) => f.signerKey === P[0].key)!;
    // Caja PEQUEÑA de SynerLink (validation): 6–28 % × 3–14 %, para caber en los recuadros «Firma».
    expect(elab).toMatchObject({ page: 2, meaning: 'elaboro', width: 28, height: 3, label: null });
    expect(elab.x).toBeLessThanOrEqual(100 - elab.width);
    expect(elab.id).toMatch(/^sf-/);
    expect(ok.fields.find((f) => f.signerKey === P[3].key)).toMatchObject({ meaning: 'aprobo', label: null });
  });

  it('[SGC-REQ-094] lee el JSON guardado con tolerancia, sabe quién falta y convierte entre el editor (orden) y lo guardado (llave)', () => {
    expect(parseStoredFields('no es json')).toEqual([]);
    expect(parseStoredFields('{"a":1}')).toEqual([]);
    expect(parseStoredFields(null)).toEqual([]);
    const stored = parseStoredFields(JSON.stringify([{ id: 'a', signerKey: P[1].key, meaning: 'reviso', page: 1, x: 1, y: 2, width: 20, height: 10, label: null }, { nada: true }, null]));
    expect(stored).toHaveLength(1);
    expect(missingPlacements(P, stored).map((p) => p.key)).toEqual([P[0].key, P[2].key, P[3].key]);
    const placements = toPlacements([...stored, { ...stored[0], signerKey: 'aprobacion:retirado@x.com' }], P, 'SOL-1');
    expect(placements).toEqual([{ id: 'a', documentId: 'SOL-1', signerOrder: 2, page: 1, x: 1, y: 2, width: 20, height: 10, label: undefined, kind: 'validation' }]);
    const back = fromPlacements([...placements, { ...placements[0], signerOrder: 9 }, { ...placements[0], signerOrder: 1, label: 'Elaboró · X' }], P);
    expect(back).toEqual([
      { id: 'a', signerKey: P[1].key, page: 1, x: 1, y: 2, width: 20, height: 10, label: null },
      { id: 'a', signerKey: P[0].key, page: 1, x: 1, y: 2, width: 20, height: 10, label: 'Elaboró · X' },
    ]);
  });

  it('[SGC-REQ-094] los identificadores de caja generados no se repiten', () => {
    const spy = vi.spyOn(Math, 'random');
    spy.mockReturnValueOnce(0.111).mockReturnValueOnce(0.222);
    expect(createFieldId()).not.toBe(createFieldId());
    spy.mockRestore();
  });
});
