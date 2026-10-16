import { describe, expect, it } from 'vitest';
import { resolveElaborator, type SgcElaboratorInput } from '../flows/elaborator';
import { normalizeSigners, pickAssigneeForDecision, type SgcAssigneeState } from '../flows/engine';
import {
  elaboratorMayReview,
  requesterMayElaborate,
  reviewExemptions,
  signerSegregationDenial,
  signerStepKind,
  strictSegregation,
  type SgcSegregationContext,
} from '../flows/segregation';
import { parseQualitySelfReview } from '../db/companySettings';

/**
 * EXCEPCIÓN PARA CALIDAD a la segregación de funciones (RN de Nicolás,
 * 2026-10-13, solicitud #1 de OLP). Calidad (permiso de Aseguramiento de
 * Calidad del SGC): (1) elabora aunque haya hecho la solicitud; (2) revisa
 * aunque haya hecho la solicitud; (3) revisa lo que elaboró solo si la empresa
 * lo habilitó (apagado por defecto). La aprobación no cambia. Para quien no es
 * de Calidad sigue la regla del 2026-10-05.
 */

const SOL_CAL = 'juan.calidad@olp.co';
const MC = 'mariacamila@olp.co';
const SOL = 'solicitante@olp.co';
const ELAB = 'elaborador@olp.co';
const REV = 'revisor@olp.co';
const APR = 'aprobador@olp.co';
const quality = new Set([SOL_CAL, MC]);
const eligible = new Set([SOL_CAL, MC, SOL, ELAB, REV, APR]);
const ctx = (o: Partial<SgcSegregationContext> = {}): SgcSegregationContext => ({ requesterEmail: SOL, elaboratorEmail: ELAB, quality, qualitySelfReview: false, ...o });

describe('[SGC-REQ-146] Excepción de Calidad · reglas puras', () => {
  it('el tipo de paso sale del significado de la firma', () => {
    expect(signerStepKind({ assignment: 'firmantes', signatureMeaning: 'reviso' })).toBe('revision');
    expect(signerStepKind({ assignment: 'firmantes', signatureMeaning: 'aprobo' })).toBe('aprobacion');
    expect(signerStepKind({ assignment: 'elaborador', signatureMeaning: 'elaboro' })).toBe('otro');
    expect(signerStepKind(undefined)).toBe('otro');
  });

  it('(1) el solicitante de Calidad puede elaborar; el solicitante que no es de Calidad, no', () => {
    expect(requesterMayElaborate(SOL_CAL, SOL_CAL, quality)).toBe(true);
    expect(requesterMayElaborate(SOL, SOL, quality)).toBe(false);
    expect(requesterMayElaborate('JUAN.CALIDAD@OLP.CO', SOL_CAL, quality)).toBe(true);
    expect(requesterMayElaborate(ELAB, SOL, quality)).toBe(true);
  });

  it('(2) el solicitante de Calidad puede ser revisor, pero nunca aprobador', () => {
    const c = ctx({ requesterEmail: SOL_CAL });
    expect(signerSegregationDenial(SOL_CAL, 'revision', 'Revisión', c)).toBeNull();
    expect(signerSegregationDenial(SOL_CAL, 'aprobacion', 'Aprobación', c)).toMatch(/Quien hizo la solicitud no puede ser firmante de Aprobación/);
  });

  it('(2) el solicitante que no es de Calidad sigue sin poder revisar', () => {
    expect(signerSegregationDenial(SOL, 'revision', 'Revisión', ctx())).toMatch(/Quien hizo la solicitud/);
  });

  it('(3) el elaborador de Calidad revisa SOLO con el ajuste de la empresa encendido; nunca aprueba', () => {
    const off = ctx({ elaboratorEmail: MC });
    const on = ctx({ elaboratorEmail: MC, qualitySelfReview: true });
    expect(signerSegregationDenial(MC, 'revision', 'Revisión', off)).toMatch(/El elaborador no puede ser firmante de Revisión/);
    expect(signerSegregationDenial(MC, 'revision', 'Revisión', on)).toBeNull();
    expect(signerSegregationDenial(MC, 'aprobacion', 'Aprobación', on)).toMatch(/El elaborador no puede ser firmante de Aprobación/);
    expect(elaboratorMayReview('revision', off)).toBe(false);
    expect(elaboratorMayReview('revision', on)).toBe(true);
    expect(elaboratorMayReview('aprobacion', on)).toBe(false);
  });

  it('(3) el elaborador que no es de Calidad no revisa aunque el ajuste esté encendido', () => {
    const on = ctx({ qualitySelfReview: true });
    expect(signerSegregationDenial(ELAB, 'revision', 'Revisión', on)).toMatch(/El elaborador/);
    expect(elaboratorMayReview('revision', on)).toBe(false);
  });

  it('solicitante y elaborador a la vez (Calidad): revisa solo con el ajuste encendido', () => {
    expect(signerSegregationDenial(SOL_CAL, 'revision', 'Revisión', ctx({ requesterEmail: SOL_CAL, elaboratorEmail: SOL_CAL }))).toMatch(/El elaborador/);
    expect(signerSegregationDenial(SOL_CAL, 'revision', 'Revisión', ctx({ requesterEmail: SOL_CAL, elaboratorEmail: SOL_CAL, qualitySelfReview: true }))).toBeNull();
  });

  it('reviewExemptions lista a quién deja ver la pantalla en la revisión', () => {
    expect(reviewExemptions(ctx())).toEqual([]);
    expect(reviewExemptions(ctx({ requesterEmail: SOL_CAL }))).toEqual([SOL_CAL]);
    expect(reviewExemptions(ctx({ requesterEmail: SOL_CAL, elaboratorEmail: MC, qualitySelfReview: true })).sort()).toEqual([MC, SOL_CAL].sort());
    expect(reviewExemptions(strictSegregation(SOL_CAL, MC))).toEqual([]);
  });

  it('el ajuste se lee de la última fila del control de cambios; por defecto apagado', () => {
    expect(parseQualitySelfReview(null)).toBe(false);
    expect(parseQualitySelfReview('no-json')).toBe(false);
    expect(parseQualitySelfReview('{"qualitySelfReview":false}')).toBe(false);
    expect(parseQualitySelfReview('{"qualitySelfReview":true}')).toBe(true);
  });
});

describe('[SGC-REQ-146] Excepción de Calidad · normalizeSigners', () => {
  const base = { stepName: 'Revisión', elaboratorEmail: ELAB, requesterEmail: SOL_CAL, eligibleEmails: eligible };

  it('sin contexto de segregación se conserva la regla estricta (compatibilidad)', () => {
    expect(() => normalizeSigners([SOL_CAL], base)).toThrow(/Quien hizo la solicitud no puede ser firmante/);
  });

  it('el solicitante de Calidad queda como revisor; como aprobador, no', () => {
    expect(normalizeSigners([REV, SOL_CAL], { ...base, kind: 'revision', segregation: { quality, qualitySelfReview: false } })).toEqual([
      { email: REV, order: 1 },
      { email: SOL_CAL, order: 2 },
    ]);
    expect(() => normalizeSigners([SOL_CAL], { ...base, stepName: 'Aprobación', kind: 'aprobacion', segregation: { quality, qualitySelfReview: true } })).toThrow(/Quien hizo la solicitud/);
  });

  it('el solicitante que no es de Calidad sigue rechazado como revisor', () => {
    expect(() => normalizeSigners([SOL], { ...base, requesterEmail: SOL, kind: 'revision', segregation: { quality, qualitySelfReview: true } })).toThrow(/Quien hizo la solicitud/);
  });

  it('el elaborador de Calidad: rechazado con el ajuste apagado y aceptado con el ajuste encendido (solo revisión)', () => {
    const opts = { ...base, elaboratorEmail: MC, kind: 'revision' as const };
    expect(() => normalizeSigners([MC], { ...opts, segregation: { quality, qualitySelfReview: false } })).toThrow(/El elaborador no puede ser firmante/);
    expect(normalizeSigners([MC], { ...opts, segregation: { quality, qualitySelfReview: true } })).toEqual([{ email: MC, order: 1 }]);
    expect(() => normalizeSigners([MC], { ...opts, stepName: 'Aprobación', kind: 'aprobacion', segregation: { quality, qualitySelfReview: true } })).toThrow(/El elaborador no puede ser firmante de Aprobación/);
  });

  it('el elaborador que no es de Calidad sigue rechazado aunque el ajuste esté encendido', () => {
    expect(() => normalizeSigners([ELAB], { ...base, kind: 'revision', segregation: { quality, qualitySelfReview: true } })).toThrow(/El elaborador no puede ser firmante/);
  });
});

describe('[SGC-REQ-146] Excepción de Calidad · elaborador por configuración', () => {
  const input = (o: Partial<SgcElaboratorInput> = {}): SgcElaboratorInput => ({
    requesterEmail: SOL_CAL,
    matrixPeople: [],
    eligible,
    quality,
    requireQuality: false,
    openLoad: new Map(),
    ...o,
  });

  it('el solicitante de Calidad ya no se descarta de la matriz (se le permite, no se le obliga)', () => {
    const r = resolveElaborator(input({ matrixPeople: [SOL_CAL, REV], openLoad: new Map([[SOL_CAL, 3]]) }))!;
    expect(r.discarded).toEqual([]);
    expect(r.candidates).toEqual([SOL_CAL, REV]);
    expect(r.email).toBe(REV);
  });

  it('en el respaldo de Calidad el solicitante de Calidad es un candidato más', () => {
    expect(resolveElaborator(input({ openLoad: new Map([[MC, 1]]) }))).toMatchObject({ source: 'calidad', candidates: [SOL_CAL, MC].sort(), email: SOL_CAL });
    expect(resolveElaborator(input({ openLoad: new Map([[SOL_CAL, 2]]) }))?.email).toBe(MC);
  });

  it('el solicitante que no es de Calidad sigue descartado', () => {
    const r = resolveElaborator(input({ requesterEmail: SOL, matrixPeople: [SOL] }))!;
    expect(r.discarded).toEqual([{ email: SOL, reason: 'es quien hace la solicitud' }]);
    expect(r.source).toBe('calidad');
  });
});

describe('[SGC-REQ-146] Excepción de Calidad · decisión en la tarea', () => {
  const slot: SgcAssigneeState = { id: 1, userEmail: MC, poolTypeCode: null, signOrder: 1, status: 'pendiente' };
  it('sin la excepción el elaborador no decide; con ella (revisión habilitada) sí', () => {
    expect(() => pickAssigneeForDecision([slot], 'paralelo', { email: MC, poolTypeCodes: [] }, { elaboratorEmail: MC, allowElaborator: false })).toThrow(/El elaborador no puede revisar ni aprobar/);
    const allow = elaboratorMayReview('revision', { requesterEmail: SOL, elaboratorEmail: MC, quality, qualitySelfReview: true });
    expect(pickAssigneeForDecision([slot], 'paralelo', { email: MC, poolTypeCodes: [] }, { elaboratorEmail: MC, allowElaborator: allow }).id).toBe(1);
  });
});
