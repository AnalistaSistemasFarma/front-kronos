import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { normalizeFlowDefinition, type SgcFormFieldDefinition } from '../flows/definition';
import { SGC_DOCUMENT_FLOW_V1, SGC_DOCUMENT_FLOW_V2, SGC_QUALITY_CHECKLIST_OLP } from '../flows/documentFlow';
import { checklistFieldsFor, normalizeChecklist } from '../signature/checklist';
import { SGC_CHECK_ANSWER_LABELS, SGC_SIGNATURE_CONSENT, SGC_SIGNATURE_CONSENT_VERSION, SGC_SIGNATURE_REASONS } from '../signature/consent';
import {
  buildEvidenceFile,
  buildSignaturePayload,
  canonicalJson,
  computeRecordHash,
  consentTextSha256,
  evidenceFolderSegments,
  payloadFromRow,
  sha256HexOf,
  validateSignInput,
  verifySignatureChain,
  verifySignatureRow,
  type SgcSignatureRow,
} from '../signature/record';
import { assertReauthNotLocked, recentReauthFailures, SGC_REAUTH_MAX_FAILURES, synerlinkPasswordVerifier } from '../signature/reauth';

/**
 * Sprint 3 — firma electrónica PROPIA del SGC: validación de la firma
 * (reautenticación, significado, motivo, consentimiento), sello de tiempo del
 * servidor, hash del contenido y del registro, evidencia, cadena de firmas,
 * reautenticación con bcrypt y bloqueo por intentos, lista de chequeo de
 * Calidad. Todo puro: sin base ni red (la base va en la integración).
 */

const SHA = 'a'.repeat(64);
const payloadOf = (over: Partial<Parameters<typeof buildSignaturePayload>[0]> = {}) =>
  buildSignaturePayload({
    uid: '11111111-2222-3333-4444-555555555555',
    idCompany: 3,
    idRequest: 10,
    idTask: 20,
    idTaskAssignee: 30,
    signerEmail: ' Revisor@OLP.com ',
    signerName: 'Revisor',
    meaning: 'reviso',
    reason: 'Revisé el contenido y es correcto.',
    signedAt: new Date('2026-10-01T15:04:05.678Z'),
    content: { kind: 'borrador_adjunto', ref: 'adjunto:7', name: 'PR.docx', sha256: SHA },
    masterSha256: null,
    ip: '10.0.0.5',
    userAgent: 'vitest',
    ...over,
  });

function rowOf(p: ReturnType<typeof payloadOf>, evidence: string, prev: string | null): SgcSignatureRow {
  return {
    signature_uid: p.uid,
    id_company: p.idCompany,
    id_request: p.idRequest,
    id_task: p.idTask,
    id_task_assignee: p.idTaskAssignee,
    signer_email: p.signerEmail,
    signer_name: p.signerName,
    meaning: p.meaning,
    reason: p.reason,
    signed_at: new Date(p.signedAt),
    content_kind: p.content.kind,
    content_ref: p.content.ref,
    content_name: p.content.name,
    content_sha256: p.content.sha256,
    auth_method: p.authMethod,
    consent_version: p.consentVersion,
    master_sha256: p.masterSha256,
    ip: p.ip,
    user_agent: p.userAgent,
    evidence_sha256: evidence,
    prev_record_hash: prev,
    record_hash: computeRecordHash(p, evidence, prev),
  };
}

describe('SGC · S3 · validación de la firma (reautenticación, significado, motivo, consentimiento)', () => {
  const ok = { meaning: 'reviso', reason: 'Revisado sin observaciones', consentAccepted: true, password: 'secreta' };

  it('[SGC-REQ-038][SGC-REQ-039] sin contraseña, sin motivo o sin aceptar el consentimiento NO se firma', () => {
    expect(validateSignInput(ok, 'reviso')).toEqual({ meaning: 'reviso', reason: 'Revisado sin observaciones', password: 'secreta' });
    expect(() => validateSignInput({ ...ok, password: '' }, 'reviso')).toThrow(/contraseña/);
    expect(() => validateSignInput({ ...ok, password: undefined }, 'reviso')).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => validateSignInput({ ...ok, password: 'x'.repeat(201) }, 'reviso')).toThrow(/Contraseña inválida/);
    expect(() => validateSignInput({ ...ok, reason: 'no' }, 'reviso')).toThrow(/motivo/);
    expect(() => validateSignInput({ ...ok, reason: 42 }, 'reviso')).toThrow(/motivo/);
    expect(() => validateSignInput({ ...ok, reason: 'x'.repeat(1001) }, 'reviso')).toThrow(/1000/);
    expect(() => validateSignInput({ ...ok, consentAccepted: 'si' }, 'reviso')).toThrow(/aceptar las condiciones/);
    // Autocompletado del navegador: el motivo no puede ser el correo del firmante.
    expect(() => validateSignInput({ ...ok, reason: 'Nicolas.Rivera@gsslatam.com' }, 'reviso', 'nicolas.rivera@gsslatam.com')).toThrow(/Escriba el motivo de la firma/);
    expect(() => validateSignInput({ ...ok, reason: ' nicolas.rivera@gsslatam.com ' }, 'reviso', 'nicolas.rivera@gsslatam.com')).toThrow(/Escriba el motivo de la firma/);
    expect(validateSignInput(ok, 'reviso', 'nicolas.rivera@gsslatam.com').reason).toBe('Revisado sin observaciones');
  });

  it('[SGC-REQ-039] el significado lo fija la tarea (Elaboró/Revisó/Aprobó/Leyó), no el cliente', () => {
    expect(() => validateSignInput({ ...ok, meaning: 'aprobo' }, 'reviso')).toThrow(/«Revisó»/);
    expect(() => validateSignInput(ok, null)).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => validateSignInput({ ...ok, meaning: 'otro' }, 'otro' as never)).toThrow(/inválido/);
    expect(SGC_SIGNATURE_REASONS.aprobo.length).toBeGreaterThan(0);
    expect(SGC_CHECK_ANSWER_LABELS.no_aplica).toBe('No aplica');
  });
});

describe('SGC · S3 · registro de la firma: sello de tiempo, hash, evidencia y cadena', () => {
  it('[SGC-REQ-040] el registro lleva el sello de tiempo del servidor (UTC), el hash SHA-256 del contenido y el método; nunca la contraseña', () => {
    const p = payloadOf();
    expect(p).toMatchObject({ signerEmail: 'revisor@olp.com', meaningLabel: 'Revisó', signedAt: '2026-10-01T15:04:05.678Z', authMethod: 'contrasena_synerlink', consentVersion: SGC_SIGNATURE_CONSENT_VERSION });
    expect(Object.keys(p)).not.toContain('password');
    expect(JSON.stringify(p)).not.toMatch(/"password"|secreta/i);
    expect(buildSignaturePayload({ ...payloadOf(), idCompany: 3, idRequest: 1, idTask: 1, idTaskAssignee: 1, signerEmail: 'a@b.co', signerName: null, meaning: 'aprobo', reason: 'Apruebo el documento', signedAt: new Date(), content: { kind: 'borrador_editor', ref: 'revision:1', name: 'x', sha256: SHA }, masterSha256: null, ip: null, userAgent: null }).uid).toMatch(/^[0-9a-f-]{36}$/);
    expect(() => payloadOf({ content: { kind: 'borrador_adjunto', ref: 'a', name: 'x', sha256: 'corto' } })).toThrow(/huella/);
  });

  it('[SGC-REQ-040] el JSON canónico es estable (orden de claves, fechas ISO, sin indefinidos) y el hash cambia si cambia un dato', () => {
    expect(canonicalJson({ b: 1, a: [new Date('2026-01-01T00:00:00Z'), { d: undefined, c: 2 }] })).toBe('{"a":["2026-01-01T00:00:00.000Z",{"c":2}],"b":1}');
    const p = payloadOf();
    const h = computeRecordHash(p, SHA, null);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(computeRecordHash({ ...p }, SHA, null)).toBe(h);
    expect(computeRecordHash({ ...p, reason: p.reason + '.' }, SHA, null)).not.toBe(h);
    expect(computeRecordHash(p, SHA, 'b'.repeat(64))).not.toBe(h);
    expect(sha256HexOf('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(consentTextSha256()).toMatch(/^[0-9a-f]{64}$/);
    expect(SGC_SIGNATURE_CONSENT.body).toMatch(/Ley 527 de 1999/);
  });

  it('[SGC-REQ-041] la evidencia (JSON) va a la carpeta propia <raíz>/_firmas/SOL-<n>/ y no lleva la contraseña', () => {
    const ev = buildEvidenceFile(payloadOf());
    expect(ev.fileName).toBe('20261001T150405Z_reviso_11111111-2222-3333-4444-555555555555.json');
    const doc = JSON.parse(new TextDecoder().decode(ev.bytes));
    expect(doc).toMatchObject({ uid: '11111111-2222-3333-4444-555555555555', consentimiento: { version: SGC_SIGNATURE_CONSENT_VERSION } });
    expect(new TextDecoder().decode(ev.bytes)).not.toMatch(/"password"/);
    expect(evidenceFolderSegments(' SGC/OLP/ ', 5)).toEqual(['SGC', 'OLP', '_firmas', 'SOL-5']);
    expect(() => evidenceFolderSegments('  ', 5)).toThrow(/carpeta raíz/);
  });

  it('[SGC-REQ-042] una firma alterada o una cadena rota se detectan (record_hash encadenado por empresa)', () => {
    const p1 = payloadOf();
    const r1 = rowOf(p1, SHA, null);
    const p2 = payloadOf({ uid: '22222222-2222-3333-4444-555555555555', meaning: 'aprobo', reason: 'Apruebo el documento para su emisión.' });
    const r2 = rowOf(p2, 'c'.repeat(64), r1.record_hash);
    expect(verifySignatureRow(r1)).toBe(true);
    expect(payloadFromRow({ ...r1, meaning: 'raro' }).meaningLabel).toBe('raro');
    expect(payloadFromRow({ ...r1, master_sha256: 'd'.repeat(64) }).masterSha256).toBe('d'.repeat(64));
    expect(verifySignatureChain([r1, r2])).toEqual({ ok: true, checked: 2, brokenAt: null, problem: null });
    expect(verifySignatureRow({ ...r1, reason: 'Otro motivo' })).toBe(false);
    expect(verifySignatureChain([{ ...r1, signed_at: new Date('2026-10-02T00:00:00Z') }, r2])).toMatchObject({ ok: false, brokenAt: p1.uid, problem: expect.stringMatching(/alterado/) });
    expect(verifySignatureChain([r2])).toMatchObject({ ok: false, problem: expect.stringMatching(/cadena/) });
    expect(verifySignatureChain([])).toMatchObject({ ok: true, checked: 0 });
  });
});

describe('SGC · S3 · reautenticación con la contraseña de SynerLink', () => {
  const hash = bcrypt.hashSync('Correcta#2026', 4);
  const dbWith = (rows: unknown[]) => ({ $queryRaw: vi.fn(async () => rows) }) as never;

  it('[SGC-REQ-038] compara con el hash bcrypt del usuario activo; proveedor, inactivo o inexistente no firman', async () => {
    expect(await synerlinkPasswordVerifier(dbWith([{ password: hash, role: 'user', isActive: true }]))('a@b.co', 'Correcta#2026')).toBe(true);
    expect(await synerlinkPasswordVerifier(dbWith([{ password: hash, role: 'user', isActive: true }]))('a@b.co', 'errada')).toBe(false);
    expect(await synerlinkPasswordVerifier(dbWith([{ password: hash, role: 'supplier', isActive: true }]))('a@b.co', 'Correcta#2026')).toBe(false);
    expect(await synerlinkPasswordVerifier(dbWith([{ password: hash, role: 'user', isActive: false }]))('a@b.co', 'Correcta#2026')).toBe(false);
    expect(await synerlinkPasswordVerifier(dbWith([{ password: null, role: 'user', isActive: true }]))('a@b.co', 'x')).toBe(false);
    expect(await synerlinkPasswordVerifier(dbWith([]))('nadie@b.co', 'x')).toBe(false);
  }, 20_000);

  it('[SGC-REQ-043] 5 intentos fallidos en 15 minutos bloquean la firma (429), contados desde la auditoría', async () => {
    const count = vi.fn(async () => SGC_REAUTH_MAX_FAILURES);
    const now = new Date('2026-10-01T12:00:00Z');
    await expect(assertReauthNotLocked({ sgcAuditLog: { count } } as never, 'A@b.co', now)).rejects.toMatchObject({ status: 429 });
    expect(count).toHaveBeenCalledWith({ where: { actor_email: 'a@b.co', action: 'firma.reautenticacion_fallida', occurred_at: { gte: new Date('2026-10-01T11:45:00Z') } } });
    await expect(assertReauthNotLocked({ sgcAuditLog: { count: vi.fn(async () => 4) } } as never, 'a@b.co', now)).resolves.toBeUndefined();
    expect(await recentReauthFailures({ sgcAuditLog: { count: vi.fn(async () => 2) } } as never, 'a@b.co', now)).toBe(2);
  });
});

describe('SGC · S3 · lista de chequeo de estructura documental de Calidad (configurable en el flujo)', () => {
  const fields = SGC_QUALITY_CHECKLIST_OLP;

  it('[SGC-REQ-044] los puntos se configuran como campos «Chequeo Calidad» de la tarea con grupo de verificación', () => {
    expect(checklistFieldsFor(SGC_DOCUMENT_FLOW_V2.formFields, 'aprobacion').map((f) => f.key)).toEqual(['chk_codificacion', 'chk_formato', 'chk_anexos']);
    expect(checklistFieldsFor(SGC_DOCUMENT_FLOW_V1.formFields, 'aprobacion')).toEqual([]);
    const v2 = normalizeFlowDefinition(JSON.parse(JSON.stringify(SGC_DOCUMENT_FLOW_V2)));
    expect(v2.formFields.filter((f) => f.qualityCheck)).toHaveLength(3);
    const bad = JSON.parse(JSON.stringify(SGC_DOCUMENT_FLOW_V2));
    bad.formFields.push({ taskKey: 'revision', key: 'chk_x', label: 'X', type: 'texto', required: false, qualityCheck: true });
    expect(() => normalizeFlowDefinition(bad)).toThrow(/grupo de verificación/);
    const typed = JSON.parse(JSON.stringify(SGC_DOCUMENT_FLOW_V1));
    typed.formFields.push({ taskKey: 'aprobacion', key: 'chk_y', label: 'Y', type: 'seleccion', options: ['a', 'b'], required: true, qualityCheck: true });
    expect(normalizeFlowDefinition(typed).formFields.find((f) => f.key === 'chk_y')).toMatchObject({ type: 'si_no', options: [], qualityCheck: true });
  });

  it('[SGC-REQ-044] todas las preguntas contestadas; «No aplica» no vale en las obligatorias; «No cumple» exige observación y da «no conforme»', () => {
    const answers = { chk_codificacion: { answer: 'cumple' }, chk_formato: 'cumple', chk_anexos: { answer: 'no_aplica', observation: '  ' } };
    expect(normalizeChecklist(fields, answers)).toEqual({
      result: 'conforme',
      items: [
        { key: 'chk_codificacion', label: fields[0].label, required: true, answer: 'cumple', answerLabel: 'Cumple', observation: null },
        { key: 'chk_formato', label: fields[1].label, required: true, answer: 'cumple', answerLabel: 'Cumple', observation: null },
        { key: 'chk_anexos', label: fields[2].label, required: false, answer: 'no_aplica', answerLabel: 'No aplica', observation: null },
      ],
    });
    expect(() => normalizeChecklist(fields, { ...answers, chk_formato: undefined })).toThrow(/responda «Formato/);
    expect(() => normalizeChecklist(fields, null)).toThrow(/responda/);
    expect(() => normalizeChecklist(fields, [])).toThrow(/responda/);
    expect(() => normalizeChecklist(fields, { ...answers, chk_codificacion: 'no_aplica' })).toThrow(/obligatorio/);
    expect(() => normalizeChecklist(fields, { ...answers, chk_formato: { answer: 'no_cumple', observation: 'x' } })).toThrow(/explique/);
    const nc = normalizeChecklist(fields, { ...answers, chk_formato: { answer: 'no_cumple', observation: 'Falta el encabezado institucional' } });
    expect(nc.result).toBe('no_conforme');
    expect(nc.items[1]).toMatchObject({ answerLabel: 'No cumple', observation: 'Falta el encabezado institucional' });
    const loose: SgcFormFieldDefinition[] = [{ ...fields[2], sortOrder: 1 }, { ...fields[0], sortOrder: 0 }];
    expect(checklistFieldsFor(loose, 'aprobacion').map((f) => f.key)).toEqual(['chk_codificacion', 'chk_anexos']);
  });
});
