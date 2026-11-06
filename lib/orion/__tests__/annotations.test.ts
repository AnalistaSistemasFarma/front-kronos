import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_MAX_ITEMS,
  describeAnnotationChanges,
  documentFullySigned,
  documentHasCompletedSignature,
  emailHasSigned,
  latestAnnotatedCopy,
  nextAnnotatedCopyName,
  normalizeAnnotationsInput,
} from '../annotations';
import { annotationCaption, stampAnnotations } from '../annotationStamp';
import type { OrionDocumentAnnotation, OrionSignatureState } from '../types';

const odette = { email: 'Odette@GSS.com', name: 'Odette Hauzeur' };
const camila = { email: 'camila@gss.com', name: 'Camila Murillo' };
const T1 = '2026-10-28T15:00:00.000Z';
const T2 = '2026-10-28T16:30:00.000Z';

const rawText = { id: 'sf-tc', kind: 'text', page: 1, x: 60, y: 20, width: 20, height: 3, text: ' 4.123,45 ' };
const rawSeal = { id: 'sf-sello', kind: 'seal', page: 2, x: 70, y: 80, width: 16, height: 11, sealItemId: 'item-1', sealFileName: 'sello-1.png' };

describe('datos y sellos después de firmar: validación', () => {
  it('crea con el autor de la sesión (no del cliente) y limpia el texto', () => {
    const [a] = normalizeAnnotationsInput([{ ...rawText, createdByEmail: 'otro@x.com' }], [], odette, T1);
    expect(a).toMatchObject({
      id: 'sf-tc',
      kind: 'text',
      text: '4.123,45',
      createdByEmail: 'odette@gss.com',
      createdByName: 'Odette Hauzeur',
      createdAt: T1,
    });
  });

  it('al cambiar un dato conserva quién lo creó y marca quién lo cambió', () => {
    const [prev] = normalizeAnnotationsInput([rawText], [], odette, T1);
    const [same] = normalizeAnnotationsInput([rawText], [prev!], camila, T2);
    expect(same!.updatedByEmail ?? null).toBeNull();
    const [changed] = normalizeAnnotationsInput([{ ...rawText, text: '4.150' }], [prev!], camila, T2);
    expect(changed).toMatchObject({
      createdByEmail: 'odette@gss.com',
      createdAt: T1,
      updatedByEmail: 'camila@gss.com',
      updatedAt: T2,
    });
  });

  it('mantiene las cajas dentro de la página', () => {
    const [a] = normalizeAnnotationsInput([{ ...rawText, x: 95, y: -4, width: 20 }], [], odette, T1);
    expect(a!.x).toBe(80);
    expect(a!.y).toBe(0);
  });

  it('rechaza datos vacíos, sellos sin imagen, ids repetidos y listas enormes', () => {
    expect(() => normalizeAnnotationsInput([{ ...rawText, text: '  ' }], [], odette)).toThrow(/valor/);
    expect(() => normalizeAnnotationsInput([{ ...rawSeal, sealItemId: '' }], [], odette)).toThrow(/imagen/);
    expect(() => normalizeAnnotationsInput([rawText, rawText], [], odette)).toThrow(/Identificador/);
    expect(() => normalizeAnnotationsInput([{ ...rawText, id: 'a b' }], [], odette)).toThrow(/Identificador/);
    expect(() => normalizeAnnotationsInput([{ ...rawText, page: 0 }], [], odette)).toThrow(/Posición/);
    const many = Array.from({ length: ANNOTATION_MAX_ITEMS + 1 }, (_, i) => ({ ...rawText, id: `sf-${i}` }));
    expect(() => normalizeAnnotationsInput(many, [], odette)).toThrow(/Máximo/);
    expect(() => normalizeAnnotationsInput('nada', [], odette)).toThrow();
  });
});

describe('nota del historial', () => {
  it('resume lo agregado, cambiado, movido y quitado', () => {
    const prev = normalizeAnnotationsInput([rawText, rawSeal], [], odette, T1);
    const next = normalizeAnnotationsInput(
      [
        { ...rawText, text: '4.150' },
        { id: 'sf-fecha', kind: 'text', page: 1, x: 10, y: 10, width: 20, height: 3, text: '28/10/2026' },
      ],
      prev,
      camila,
      T2
    );
    expect(describeAnnotationChanges(prev, next)).toBe(
      'cambió "4.123,45" por "4.150", agregó "28/10/2026", quitó un sello'
    );
    const moved = normalizeAnnotationsInput([{ ...rawText, x: 61 }, rawSeal], prev, camila, T2);
    expect(describeAnnotationChanges(prev, moved)).toBe('movió "4.123,45"');
    expect(describeAnnotationChanges(prev, normalizeAnnotationsInput([rawText, rawSeal], prev, camila, T2))).toBeNull();
  });

  it('usa el nombre del dato (y registra si se renombra)', () => {
    const prev = normalizeAnnotationsInput([{ ...rawText, label: '  Tipo de cambio ' }], [], odette, T1);
    expect(prev[0]!.label).toBe('Tipo de cambio');
    expect(describeAnnotationChanges([], prev)).toBe('agregó Tipo de cambio "4.123,45"');
    const changed = normalizeAnnotationsInput([{ ...rawText, label: 'Tipo de cambio', text: '4.150' }], prev, camila, T2);
    expect(describeAnnotationChanges(prev, changed)).toBe('cambió Tipo de cambio "4.123,45" por "4.150"');
    const renamed = normalizeAnnotationsInput([{ ...rawText, label: 'TRM' }], prev, camila, T2);
    expect(describeAnnotationChanges(prev, renamed)).toBe('llamó "4.123,45" "TRM"');
    expect(describeAnnotationChanges(prev, [])).toBe('quitó Tipo de cambio "4.123,45"');
  });
});

describe('letra y tamaño del texto', () => {
  it('guarda letra, tamaño y negrita válidos; lo demás cae a Helvetica y a los límites', () => {
    const [a] = normalizeAnnotationsInput([{ ...rawText, fontFamily: 'times', fontSize: 12.3, bold: true }], [], odette, T1);
    expect(a).toMatchObject({ fontFamily: 'times', fontSize: 12.5, bold: true });
    const [b] = normalizeAnnotationsInput([{ ...rawText, fontFamily: 'comic', fontSize: 500 }], [], odette, T1);
    expect(b).toMatchObject({ fontFamily: 'helvetica', fontSize: 48, bold: false });
    const [old] = normalizeAnnotationsInput([rawText], [], odette, T1);
    expect(old).toMatchObject({ fontFamily: null, fontSize: null, bold: null });
  });

  it('cambiar la letra queda en el historial', () => {
    const prev = normalizeAnnotationsInput([{ ...rawText, fontSize: 11 }], [], odette, T1);
    const next = normalizeAnnotationsInput([{ ...rawText, fontSize: 14 }], prev, camila, T2);
    expect(describeAnnotationChanges(prev, next)).toBe('cambió la letra de "4.123,45"');
  });

  it('estampa con cada letra sin romper el PDF', async () => {
    const input = await blankPdf(1);
    const list = normalizeAnnotationsInput(
      (['helvetica', 'times', 'courier'] as const).map((f, i) => ({
        ...rawText,
        id: `sf-${f}`,
        y: 10 + i * 5,
        fontFamily: f,
        fontSize: 14,
        bold: i === 1,
      })),
      [],
      odette,
      T1
    );
    const out = await stampAnnotations(input, list);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
});

describe('quién puede agregar', () => {
  const state: OrionSignatureState = {
    signers: [
      { email: 'jorge@gss.com', status: 'FIRMADO', order: 1 },
      { email: 'odette@gss.com', status: 'PENDIENTE', order: 2 },
    ],
  };

  it('solo cuando ya hay alguna firma, y reconoce a quien ya firmó', () => {
    expect(documentHasCompletedSignature(state)).toBe(true);
    expect(documentHasCompletedSignature({ signers: [{ email: 'a@x.com', status: 'PENDIENTE' }] })).toBe(false);
    expect(emailHasSigned(state, 'JORGE@gss.com')).toBe(true);
    expect(emailHasSigned(state, 'odette@gss.com')).toBe(false);
    expect(emailHasSigned(state, '')).toBe(false);
  });
});

describe('copias "Datos N"', () => {
  it('los datos solo se guardan con todas las firmas', () => {
    expect(documentFullySigned({ status: 'FIRMADO' })).toBe(true);
    expect(
      documentFullySigned({ signers: [{ status: 'FIRMADO' }, { status: 'SIGNED' }] })
    ).toBe(true);
    expect(
      documentFullySigned({ status: 'EN_PROCESO', signers: [{ status: 'FIRMADO' }, { status: 'PENDIENTE' }] })
    ).toBe(false);
    expect(documentFullySigned({ signers: [] })).toBe(false);
  });

  it('la vigente es la de mayor número y la siguiente continúa la numeración', () => {
    const copy = (round: number) => ({
      id: `datos-${round}-1`,
      round,
      label: `v1.0 · Datos ${round}`,
      oneDriveItemId: `item-${round}`,
      fileName: 'x.pdf',
      sha256: 'abc',
      createdAt: T1,
      createdByEmail: 'odette@gss.com',
    });
    const state: OrionSignatureState = {
      versionLabel: 'v1.2',
      fileName: 'Giro: USP/octubre.pdf',
      annotatedCopies: [copy(2), copy(1)],
    };
    expect(latestAnnotatedCopy(state)?.round).toBe(2);
    expect(latestAnnotatedCopy({})).toBeNull();
    expect(nextAnnotatedCopyName(state, new Date(T2))).toEqual({
      id: `datos-3-${Date.parse(T2)}`,
      round: 3,
      label: 'v1.2 · Datos 3',
      fileName: 'Giro_ USP_octubre - v1.2 datos 3.pdf',
    });
    expect(nextAnnotatedCopyName({}, new Date(T2)).label).toBe('v1.0 · Datos 1');
  });
});

async function blankPdf(pages = 2): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage([595, 842]);
  return pdf.save();
}

// PNG 1×1 transparente.
const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  )
);

describe('estampado sobre el PDF firmado', () => {
  const annotations: OrionDocumentAnnotation[] = normalizeAnnotationsInput(
    [rawText, rawSeal, { ...rawText, id: 'sf-fuera', page: 9 }],
    [],
    odette,
    T1
  );

  it('dibuja datos y sellos sin romper el PDF (página inexistente se ignora)', async () => {
    const input = await blankPdf();
    const out = await stampAnnotations(input, annotations, { 'item-1': { bytes: PNG_1X1, mime: 'image/png' } });
    expect(out.byteLength).toBeGreaterThan(input.byteLength);
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(2);
  });

  it('sin imagen del sello igual estampa los datos; sin elementos devuelve el mismo PDF', async () => {
    const input = await blankPdf();
    const out = await stampAnnotations(input, annotations, {});
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
    expect(await stampAnnotations(input, [])).toBe(input);
  });

  it('la leyenda dice quién y cuándo (hora Colombia)', () => {
    expect(annotationCaption(annotations[0]!)).toBe('Agregado tras firmar · Odette Hauzeur · 28/10/2026 10:00');
    expect(annotationCaption(annotations[1]!)).toBe('Sello ubicado por Odette Hauzeur · 28/10/2026 10:00');
  });
});
