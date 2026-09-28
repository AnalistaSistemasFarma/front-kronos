import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  normalizeValidatorFields,
  splitValidatorFields,
  toOrionSignatureFields,
  validatorPlacementOrder,
  type SignatureFieldPlacement,
} from '../signatureFields';
import type { OrionSignatureState } from '../types';
import { buildValidatorMarks, formatValidatorDate, stampValidatorMarks } from '../validatorStamp';

const signerField: SignatureFieldPlacement = {
  id: 'sig-1',
  documentId: 'doc',
  signerOrder: 1,
  page: 1,
  x: 10,
  y: 70,
  width: 24,
  height: 12,
  kind: 'signature',
};

const approvalField: SignatureFieldPlacement = {
  id: 'ap-1',
  documentId: 'doc',
  signerOrder: validatorPlacementOrder(1),
  page: 1,
  x: 80,
  y: 90,
  width: 14,
  height: 5,
  kind: 'approval',
};

const approvedState: OrionSignatureState = {
  status: 'FIRMADO',
  review: {
    status: 'APROBADO',
    approvals: [
      { email: 'Ana@X.com', name: 'Ana', order: 1, decision: 'APROBADO', decidedAt: '2026-09-28T10:00:00Z' },
      { email: 'luis@x.com', name: 'Luis', order: 2, decision: 'APROBADO', decidedAt: '2026-09-28T11:00:00Z' },
    ],
  },
  validatorFields: [{ ...approvalField, kind: 'approval', validatorEmail: 'ana@x.com' }],
};

describe('cajas de validadores', () => {
  it('no se envían a Orion', () => {
    const payload = toOrionSignatureFields([signerField, approvalField]);
    expect(payload.map((f) => f.id)).toEqual(['sig-1']);
    const split = splitValidatorFields([signerField, approvalField]);
    expect(split.validatorFields.map((f) => f.id)).toEqual(['ap-1']);
  });

  it('resuelve el correo del validador y descarta órdenes que ya no existen', () => {
    const orphan = { ...approvalField, id: 'ap-9', signerOrder: validatorPlacementOrder(9) };
    const result = normalizeValidatorFields(
      [approvalField, orphan],
      [{ order: 1, email: ' Ana@X.com ' }],
      'doc'
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'ap-1', kind: 'approval', validatorEmail: 'ana@x.com' });
  });
});

describe('visto bueno en el PDF', () => {
  it('usa la caja ubicada y, sin caja, la esquina inferior derecha de la última página', () => {
    const marks = buildValidatorMarks(approvedState);
    expect(marks).toHaveLength(2);
    expect(marks[0]).toMatchObject({ email: 'ana@x.com', name: 'Ana', order: 1 });
    expect(marks[0]!.field).toMatchObject({ page: 1, x: 80, y: 90 });
    expect(marks[1]).toMatchObject({ email: 'luis@x.com', order: 2 });
    expect(marks[1]!.field.page).toBe(0);
    expect(marks[1]!.field.x + marks[1]!.field.width).toBeLessThanOrEqual(100);
  });

  it('muestra la fecha de validación en hora de Colombia', () => {
    expect(formatValidatorDate('2026-09-28T16:51:00Z')).toBe('28/09/2026 11:51');
  });

  it('sin validación aprobada no hay marcas', () => {
    expect(
      buildValidatorMarks({
        ...approvedState,
        review: { ...approvedState.review!, status: 'EN_VALIDACION' },
      })
    ).toEqual([]);
  });

  it('estampa chulito o firma guardada sin romper el PDF', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    const bytes = await pdf.save();
    const marks = buildValidatorMarks(approvedState);

    const withCheck = await stampValidatorMarks(bytes, marks);
    expect(withCheck.byteLength).toBeGreaterThan(bytes.byteLength);

    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const withSignature = await stampValidatorMarks(bytes, marks, { 'ana@x.com': png });
    const reloaded = await PDFDocument.load(withSignature);
    expect(reloaded.getPageCount()).toBe(1);
  });
});
