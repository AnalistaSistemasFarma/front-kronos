import { describe, expect, it } from 'vitest';
import {
  attachmentDraftLabel,
  buildRoundNotice,
  devolutionObservations,
  devolutionStep,
  draftBackTarget,
  draftCardTitle,
  draftEditorHref,
  findDuplicateBySha,
  parseTaskParam,
  summarizeCurrentDraft,
} from '../draft/view';

const SHA = 'a'.repeat(64);
const word1 = { id: 11, fileName: 'Contrato_Prueba_Firmas_Digitales.docx', purpose: 'borrador', sha256: SHA, uploadedBy: 'Nicolás Rivera', createdAt: '2026-10-02T15:00:00.000Z', withdrawnAt: null };
const word2 = { ...word1, id: 12, createdAt: '2026-10-02T15:05:00.000Z' };
const soporte = { ...word1, id: 13, purpose: 'soporte', fileName: 'anexo.pdf' };
const rev2 = { id: 7, number: 2, savedBy: 'Nicolás Rivera', savedAt: '2026-10-02T17:00:00.000Z' };
const editorDraft = { kind: 'borrador_editor', ref: 'revision:7', name: 'Borrador editado en la app · revisión 2', sha256: 'b'.repeat(64), format: 'html', at: rev2.savedAt };
const attDraft = { kind: 'borrador_adjunto', ref: 'adjunto:12', name: word2.fileName, sha256: SHA, format: 'docx', at: word2.createdAt };

describe('SGC · borrador vigente destacado · etiquetas de adjuntos', () => {
  it('si el vigente es del editor, todos los adjuntos «borrador» quedan REEMPLAZADO', () => {
    expect(attachmentDraftLabel(word1, editorDraft)).toBe('reemplazado');
    expect(attachmentDraftLabel(word2, editorDraft)).toBe('reemplazado');
  });
  it('marca VIGENTE solo el adjunto que es el borrador vigente', () => {
    expect(attachmentDraftLabel(word2, attDraft)).toBe('vigente');
    expect(attachmentDraftLabel(word1, attDraft)).toBe('reemplazado');
  });
  it('no etiqueta soportes, retirados ni solicitudes sin borrador', () => {
    expect(attachmentDraftLabel(soporte, attDraft)).toBeNull();
    expect(attachmentDraftLabel({ ...word1, withdrawnAt: '2026-10-02T16:00:00.000Z' }, attDraft)).toBeNull();
    expect(attachmentDraftLabel(word1, null)).toBeNull();
  });
});

describe('SGC · borrador vigente destacado · tarjeta', () => {
  it('el título depende de la tarea abierta', () => {
    expect(draftCardTitle('revision')).toBe('Documento a revisar');
    expect(draftCardTitle('aprobacion')).toBe('Documento a aprobar');
    expect(draftCardTitle('elaboracion')).toBe('Documento a elaborar');
    expect(draftCardTitle(null)).toBe('Borrador vigente');
  });
  it('resume el borrador del editor con su revisión y autor', () => {
    const s = summarizeCurrentDraft(editorDraft, [word1, word2], [rev2]);
    expect(s).toMatchObject({ origin: 'Editor de la app · revisión 2', author: 'Nicolás Rivera', shortSha: 'b'.repeat(12) });
  });
  it('resume un adjunto como archivo Word o PDF', () => {
    expect(summarizeCurrentDraft(attDraft, [word1, word2], [])?.origin).toBe('Archivo Word cargado');
    expect(summarizeCurrentDraft({ ...attDraft, format: 'pdf' }, [word1, word2], [])?.origin).toBe('Archivo PDF cargado');
    expect(summarizeCurrentDraft(null, [], [])).toBeNull();
  });
});

describe('SGC · borrador vigente destacado · aviso de ronda', () => {
  const body = 'Devolvió a elaboración en «Revisión».\nObservaciones: Ajustar la cláusula 3 y el anexo.\nPunto de firma: Revisó (pendiente).';
  const devolucion = { kind: 'devolucion', author: 'María Camila', body, createdAt: '2026-10-02T16:00:00.000Z', idTask: 5 };
  const tasks = [
    { id: 4, key: 'elaboracion', name: 'Elaboración', round: 1, status: 'resuelta' },
    { id: 5, key: 'revision', name: 'Revisión', round: 1, status: 'devuelta' },
    { id: 6, key: 'elaboracion', name: 'Elaboración', round: 2, status: 'resuelta' },
    { id: 8, key: 'revision', name: 'Revisión', round: 2, status: 'abierta' },
  ];

  it('extrae observaciones y paso de la interacción «devolucion»', () => {
    expect(devolutionObservations(body)).toBe('Ajustar la cláusula 3 y el anexo.');
    expect(devolutionStep(body)).toBe('Revisión');
    expect(devolutionObservations('Devolvió a elaboración en «Revisión».')).toBeNull();
  });
  it('muestra la ronda, quién devolvió y que se editó en la app (revisión 2)', () => {
    const n = buildRoundNotice({ openTask: { key: 'revision', round: 2 }, tasks, interactions: [devolucion], attachments: [word1, word2], revisions: [{ ...rev2, number: 1, id: 6, savedAt: '2026-10-02T14:00:00.000Z' }, rev2] });
    expect(n).toMatchObject({ round: 2, returnedBy: 'María Camila', fromStep: 'Revisión', observations: 'Ajustar la cláusula 3 y el anexo.' });
    expect(n?.changes).toEqual(['Nicolás Rivera editó el borrador en la app (revisión 2).']);
  });
  it('dice cuando se subió un archivo nuevo, o que no cambió nada', () => {
    const nuevo = { ...word2, id: 14, fileName: 'v2.docx', createdAt: '2026-10-02T16:30:00.000Z' };
    expect(buildRoundNotice({ openTask: { key: 'revision', round: 2 }, tasks, interactions: [devolucion], attachments: [word1, nuevo], revisions: [] })?.changes).toEqual(['Nicolás Rivera subió un archivo nuevo: v2.docx.']);
    expect(buildRoundNotice({ openTask: { key: 'revision', round: 2 }, tasks, interactions: [devolucion], attachments: [word1], revisions: [] })?.changes).toEqual(['El borrador no ha cambiado desde la devolución.']);
  });
  it('no hay aviso en la primera ronda', () => {
    expect(buildRoundNotice({ openTask: { key: 'revision', round: 1 }, tasks: tasks.slice(0, 2), interactions: [], attachments: [], revisions: [] })).toBeNull();
  });
});

describe('SGC · borrador duplicado (mismo SHA-256)', () => {
  it('encuentra adjuntos idénticos no retirados, sin importar mayúsculas', () => {
    const rows = [
      { id: 1, sha256: SHA, withdrawn_at: null },
      { id: 2, sha256: SHA.toUpperCase(), withdrawn_at: null },
      { id: 3, sha256: SHA, withdrawn_at: new Date() },
      { id: 4, sha256: 'c'.repeat(64), withdrawn_at: null },
    ];
    expect(findDuplicateBySha(rows, SHA).map((r) => r.id)).toEqual([1, 2]);
  });
});

describe('SGC · regreso a la tarea desde el borrador', () => {
  it('lleva el id de la tarea en el enlace del editor', () => {
    expect(draftEditorHref(9, 3, 42)).toBe('/process/sgc-documental/solicitudes/9/borrador?empresa=3&tarea=42');
    expect(draftEditorHref(9, 3, null)).toBe('/process/sgc-documental/solicitudes/9/borrador?empresa=3');
    expect(draftEditorHref(9, 3, 42, 7)).toBe('/process/sgc-documental/solicitudes/9/borrador?empresa=3&ver=7&tarea=42');
  });
  it('«Volver» regresa a la tarea si vino de una tarea; si no, a la solicitud', () => {
    expect(draftBackTarget(9, 3, '42')).toEqual({ href: '/process/sgc-documental/tareas/42?empresa=3', label: 'Volver a la tarea', crumb: 'Tarea #42' });
    expect(draftBackTarget(9, 3, null)).toEqual({ href: '/process/sgc-documental/solicitudes/9?empresa=3', label: 'Volver a la solicitud', crumb: 'Solicitud #9' });
  });
  it('nunca acepta una URL ni rutas externas como destino', () => {
    for (const bad of ['https://evil.com', '//evil.com', '/process/x', '42abc', '-1', '0', '', ' 42', '1e3']) {
      expect(parseTaskParam(bad)).toBeNull();
      expect(draftBackTarget(9, 3, bad).href).toBe('/process/sgc-documental/solicitudes/9?empresa=3');
    }
  });
});
