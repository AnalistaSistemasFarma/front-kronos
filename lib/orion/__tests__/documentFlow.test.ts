import { describe, expect, it } from 'vitest';
import { buildDocumentFlow } from '../documentFlow';
import type { OrionDraftState, OrionSignatureBagBag, OrionSignatureState } from '../types';

const draft = (over: Partial<OrionDraftState> = {}): OrionDraftState =>
  ({
    fileId: 'docx-1',
    fileName: 'Contrato.docx',
    status: 'CONVERTIDO_PDF',
    versionLabel: 'v0.2',
    versions: [
      { id: 'v1', label: 'v0.1', kind: 'elaboracion', oneDriveItemId: 'x', fileName: 'Contrato.docx', uploadedByEmail: 'prep@gss.com', uploadedByName: 'Paula Prep', createdAt: '2026-11-01T10:00:00Z' },
      { id: 'v2', label: 'PDF', kind: 'pdf', oneDriveItemId: 'y', fileName: 'Contrato.pdf', uploadedByEmail: 'prep@gss.com', createdAt: '2026-11-03T10:00:00Z' },
    ],
    internalReview: {
      status: 'APROBADO',
      approvals: [
        { email: 'val1@gss.com', name: 'Victor Val', order: 1, decision: 'APROBADO', decidedAt: '2026-11-02T10:00:00Z' },
        { email: 'val2@gss.com', name: 'val2@gss.com', order: 2, decision: 'APROBADO', decidedAt: '2026-11-02T11:00:00Z' },
      ],
    },
    pdfFileId: 'pdf-1',
    createdByEmail: 'prep@gss.com',
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-03T10:00:00Z',
    ...over,
  }) as OrionDraftState;

const pdf = (over: Partial<OrionSignatureState> = {}): OrionSignatureState =>
  ({
    fileId: 'pdf-1',
    fileName: 'Contrato.pdf',
    status: 'EN_PROCESO',
    review: { status: 'APROBADO', source: 'word', approvals: [{ email: 'val1@gss.com', name: 'Victor Val', order: 1, decision: 'APROBADO', decidedAt: '2026-11-03T12:00:00Z' }] },
    signers: [
      { email: 'ana@gss.com', name: 'Ana Firma', order: 1, status: 'FIRMADO', signedAt: '2026-11-04T09:00:00Z' },
      { email: 'beto@gss.com', name: 'Beto Firma', order: 2, status: 'PENDIENTE', turnStartedAt: '2026-11-04T09:00:01Z' },
      { email: 'cata@cliente.com', order: 3, status: 'PENDIENTE', type: 'external' },
    ],
    ...over,
  }) as OrionSignatureState;

const bag = (d: OrionDraftState | null, p: OrionSignatureState | null): OrionSignatureBagBag => ({
  documents: p ? { 'pdf-1': p } : {},
  drafts: d ? { 'docx-1': d } : {},
});

describe('recorrido del documento', () => {
  it('arma el recorrido completo del Word a la firma y dice en quién va', () => {
    const flow = buildDocumentFlow(bag(draft(), pdf()), 'pdf-1');
    expect(flow.stages.map((s) => s.key)).toEqual(['word', 'word-validacion', 'pdf', 'pdf-validacion', 'firmas', 'firmado']);
    expect(flow.stages.map((s) => s.status)).toEqual(['hecho', 'hecho', 'hecho', 'hecho', 'actual', 'pendiente']);
    expect(flow.currentStageKey).toBe('firmas');
    expect(flow.currentLabel).toBe('Le toca firmar a Beto Firma');
    expect(flow.doneCount).toBe(4);
    expect(flow.total).toBe(6);
    const firmas = flow.stages.find((s) => s.key === 'firmas')!;
    expect(firmas.people.map((p) => [p.name, p.statusLabel])).toEqual([
      ['Ana Firma', 'Firmó'],
      ['Beto Firma', 'Le toca'],
      ['Firmante 3', 'En espera'],
    ]);
    expect(firmas.people[2]?.role).toBe('Firmante externo');
  });

  it('también se encuentra desde el Word (fileId del .docx)', () => {
    expect(buildDocumentFlow(bag(draft(), pdf()), 'docx-1').currentStageKey).toBe('firmas');
  });

  it('nunca devuelve correos (ni siquiera si el «nombre» es un correo)', () => {
    const flow = buildDocumentFlow(bag(draft(), pdf()), 'pdf-1');
    expect(JSON.stringify(flow)).not.toMatch(/@/);
    const validadores = flow.stages.find((s) => s.key === 'word-validacion')!;
    expect(validadores.people[1]?.name).toBe('Validador 2');
  });

  it('Word en validación: la etapa en curso es la del Word y lo demás queda pendiente', () => {
    const d = draft({
      status: 'EN_VALIDACION_INTERNA',
      pdfFileId: null,
      internalReview: {
        status: 'EN_VALIDACION',
        approvals: [
          { email: 'a@gss.com', name: 'Ana', order: 1, decision: 'APROBADO', decidedAt: '2026-11-02T10:00:00Z' },
          { email: 'b@gss.com', name: 'Beto', order: 2, decision: 'PENDIENTE' },
        ],
      },
    });
    const flow = buildDocumentFlow(bag(d, null), 'docx-1');
    expect(flow.currentStageKey).toBe('word-validacion');
    expect(flow.currentLabel).toBe('Revisando: Beto');
    expect(flow.stages.find((s) => s.key === 'firmas')?.status).toBe('pendiente');
  });

  it('devuelto a la preparadora y firmante que rechazó se marcan como devueltos', () => {
    const devuelto = buildDocumentFlow(bag(draft({ status: 'DEVUELTO_INTERNO', pdfFileId: null }), null), 'docx-1');
    expect(devuelto.currentStageKey).toBe('word');
    expect(devuelto.currentLabel).toBe('Devuelto a la preparadora para corregir');

    const rechazo = buildDocumentFlow(
      bag(null, pdf({ review: null, signers: [{ email: 'a@gss.com', name: 'Ana', order: 1, status: 'RECHAZADO' }] })),
      'pdf-1'
    );
    expect(rechazo.stages.find((s) => s.key === 'firmas')?.status).toBe('devuelto');
    expect(rechazo.currentLabel).toBe('Un firmante rechazó el documento');
  });

  it('todo firmado: proceso terminado', () => {
    const p = pdf({
      status: 'FIRMADO',
      signedAt: '2026-11-05T10:00:00Z',
      signers: [{ email: 'a@gss.com', name: 'Ana', order: 1, status: 'FIRMADO', signedAt: '2026-11-05T10:00:00Z' }],
    });
    const flow = buildDocumentFlow(bag(null, p), 'pdf-1');
    expect(flow.currentLabel).toBe('Proceso terminado');
    expect(flow.doneCount).toBe(flow.total);
  });

  it('agrega «Solicitud creada» y cambia correos por nombres con el mapa del servidor', () => {
    const flow = buildDocumentFlow(bag(draft(), pdf()), 'pdf-1', {
      request: { createdAt: '2026-10-30T09:00:00Z', requesterName: 'Sara Solicitante' },
      names: { 'val2@gss.com': 'Valentina Dos', 'cata@cliente.com': 'Catalina Cliente' },
    });
    expect(flow.stages[0]).toMatchObject({ key: 'solicitud', status: 'hecho', at: '2026-10-30T09:00:00Z' });
    expect(flow.stages[0]?.people[0]?.name).toBe('Sara Solicitante');
    const validadores = flow.stages.find((s) => s.key === 'word-validacion')!;
    expect(validadores.people[1]?.name).toBe('Valentina Dos');
    expect(flow.stages.find((s) => s.key === 'firmas')!.people[2]?.name).toBe('Catalina Cliente');
    expect(JSON.stringify(flow)).not.toMatch(/@/);
  });

  it('cada paso trae su historial: versiones del Word, envío a validación y PDF', () => {
    const d = draft({
      internalReview: {
        status: 'APROBADO',
        round: 2,
        submittedAt: '2026-11-02T08:00:00Z',
        submittedBy: 'prep@gss.com',
        approvedAt: '2026-11-02T11:00:00Z',
        approvals: [{ email: 'val1@gss.com', name: 'Victor Val', order: 1, decision: 'APROBADO', decidedAt: '2026-11-02T11:00:00Z' }],
      },
    });
    const flow = buildDocumentFlow(bag(d, pdf()), 'pdf-1', { names: { 'prep@gss.com': 'Paula Prep' } });
    const word = flow.stages.find((s) => s.key === 'word')!;
    expect(word.events.map((e) => e.label)).toEqual(['v0.1 · versión de trabajo']);
    expect(word.events[0]?.who).toBe('Paula Prep');
    const validacion = flow.stages.find((s) => s.key === 'word-validacion')!;
    expect(validacion.events.map((e) => [e.label, e.who])).toEqual([
      ['Enviado a validación (ronda 2)', 'Paula Prep'],
      ['Aprobado por todos los validadores', null],
    ]);
    expect(validacion.description).toBe('1 de 1 aprobaron · ronda 2');
    expect(flow.stages.find((s) => s.key === 'pdf')!.events[0]?.label).toBe('PDF generado');
  });

  it('el firmante en turno muestra su plazo y el historial dice cuándo se envió a firmar', () => {
    const p = pdf({
      signers: [
        { email: 'ana@gss.com', name: 'Ana Firma', order: 1, status: 'PENDIENTE', turnStartedAt: '2026-11-04T09:00:00Z', expiresAt: '2026-11-05T09:00:00Z' },
      ],
    });
    const firmas = buildDocumentFlow(bag(null, p), 'pdf-1').stages.find((s) => s.key === 'firmas')!;
    expect(firmas.people[0]?.statusLabel).toBe('Le toca');
    expect(firmas.people[0]?.detail).toMatch(/^Plazo hasta /);
    expect(firmas.events[0]).toMatchObject({ label: 'Enviado a firmar', at: '2026-11-04T09:00:00Z' });
    expect(firmas.description).toBe('0 de 1 firmaron');
  });
});
