import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  SGC_AUTH_TYPE_SUBSTITUTES,
  approverListApplies,
  authorizationStatus,
  bogotaDay,
  dayOf,
  isAuthorizationActive,
  isAuthorizedApprover,
  normalizeApproverAuthorization,
  normalizeSubstitution,
  onBehalfLabel,
  substitutionDenial,
  unauthorizedApproverMessage,
  unauthorizedApprovers,
  type SgcApproverAuthorizationRow,
} from '../approvers';
import { buildSignaturePayload, canonicalJson, computeRecordHash, payloadFromRow, type SgcSignatureRow } from '../signature/record';
import { computeRecordHash as computeRecordHashMjs, payloadFromRow as payloadFromRowMjs } from '../../../scripts/sgc/respaldo/lib.mjs';
import { buildControlledPdf, readManifest, signerWithSubstitution, type SgcManifest } from '../pdf/controlledPdf';

/**
 * Sprint 12 — APROBADORES AUTORIZADOS (R11) y FIRMANTE SUSTITUTO (R12):
 * vigencia de la lista, cuándo aplica, segregación del sustituto y la firma
 * «en sustitución de» en el registro encadenado, el respaldo y el PDF.
 */
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const auth = (over: Partial<SgcApproverAuthorizationRow> = {}): SgcApproverAuthorizationRow => ({ user_email: 'jefe@olp.co', id_process_map: 5, valid_from: d('2026-10-01'), valid_to: null, revoked_at: null, ...over });

describe('SGC · S12 · aprobadores autorizados', () => {
  it('[SGC-REQ-132] la autorización exige correo, motivo y una vigencia coherente; el proceso es opcional (todos)', () => {
    const today = new Date('2026-10-08T15:00:00Z');
    expect(normalizeApproverAuthorization({ email: ' Jefe@OLP.co ', reason: 'Jefe del área de calidad' }, today)).toEqual({ email: 'jefe@olp.co', idProcessMap: null, validFrom: d('2026-10-08'), validTo: null, reason: 'Jefe del área de calidad' });
    expect(normalizeApproverAuthorization({ email: 'a@b.co', idProcessMap: '7', validFrom: '2026-10-10', validTo: '2026-12-31', reason: 'Directora técnica' }, today)).toMatchObject({ idProcessMap: 7, validFrom: d('2026-10-10'), validTo: d('2026-12-31') });
    expect(() => normalizeApproverAuthorization({ email: 'x', reason: 'motivo largo' }, today)).toThrow(/correo válido/);
    expect(() => normalizeApproverAuthorization({ email: 'a@b.co', reason: 'no' }, today)).toThrow(/motivo/);
    expect(() => normalizeApproverAuthorization({ email: 'a@b.co', reason: 'x'.repeat(1001) }, today)).toThrow(/1.000/);
    expect(() => normalizeApproverAuthorization({ email: 'a@b.co', idProcessMap: -1, reason: 'motivo largo' }, today)).toThrow(/Proceso/);
    expect(() => normalizeApproverAuthorization({ email: 'a@b.co', validFrom: '2026-10-10', validTo: '2026-10-01', reason: 'motivo largo' }, today)).toThrow(/termina antes/);
    expect(() => normalizeApproverAuthorization(null, today)).toThrow(/correo/);
    expect(() => dayOf('2026-02-30', 'Fecha', false)).toThrow(/fecha válida/);
    expect(() => dayOf('', 'Fecha', false)).toThrow(/fecha válida/);
    expect(dayOf(null, 'Fecha', true)).toBeNull();
    expect(bogotaDay(new Date('2026-10-09T03:00:00Z'))).toEqual(d('2026-10-08'));
  });

  it('[SGC-REQ-133] vigente, programada, vencida o revocada; una autorización de «todos los procesos» sirve para cualquiera', () => {
    const at = new Date('2026-10-08T15:00:00Z');
    expect(authorizationStatus(auth(), at)).toBe('vigente');
    expect(authorizationStatus(auth({ valid_from: d('2026-10-09') }), at)).toBe('programada');
    expect(authorizationStatus(auth({ valid_to: d('2026-10-07') }), at)).toBe('vencida');
    expect(authorizationStatus(auth({ revoked_at: at }), at)).toBe('revocada');
    expect(isAuthorizationActive(auth({ valid_to: d('2026-10-08') }), at)).toBe(true);
    expect(isAuthorizationActive(auth({ valid_from: d('2026-10-09') }), at)).toBe(false);
    expect(isAuthorizedApprover([auth()], 'JEFE@olp.co', 5, at)).toBe(true);
    expect(isAuthorizedApprover([auth()], 'jefe@olp.co', 6, at)).toBe(false);
    expect(isAuthorizedApprover([auth({ id_process_map: null })], 'jefe@olp.co', 6, at)).toBe(true);
    expect(isAuthorizedApprover([auth({ revoked_at: at })], 'jefe@olp.co', 5, at)).toBe(false);
  });

  it('[SGC-REQ-134] la lista aplica solo si está activa y tiene al menos una persona (aunque esté revocada): un analista no queda como aprobador', () => {
    const at = new Date('2026-10-08T15:00:00Z');
    expect(approverListApplies(true, [])).toBe(false);
    expect(approverListApplies(false, [auth()])).toBe(false);
    expect(approverListApplies(true, [auth({ revoked_at: at })])).toBe(true);
    expect(unauthorizedApprovers({ enforced: true, list: [] }, ['analista@olp.co'], 5, at)).toEqual([]);
    expect(unauthorizedApprovers({ enforced: true, list: [auth()] }, ['jefe@olp.co', ' Analista@olp.co'], 5, at)).toEqual(['analista@olp.co']);
    expect(unauthorizedApprovers({ enforced: true, list: [auth({ revoked_at: at })] }, ['jefe@olp.co'], 5, at)).toEqual(['jefe@olp.co']);
    expect(unauthorizedApproverMessage(['a@olp.co'], 'Aprobación')).toMatch(/a@olp.co no está en la lista .* no puede quedar en «Aprobación»/);
    expect(unauthorizedApproverMessage(['a@olp.co', 'b@olp.co'], 'Aprobación')).toMatch(/no están .* no pueden/);
  });
});

describe('SGC · S12 · firmante sustituto', () => {
  const ctx = {
    originalEmail: 'titular@olp.co',
    requesterEmail: 'sol@olp.co',
    elaboratorEmail: 'elab@olp.co',
    taskPeople: ['titular@olp.co', 'otro@olp.co'],
    eligible: new Set(['titular@olp.co', 'otro@olp.co', 'sust@olp.co', 'sol@olp.co', 'elab@olp.co', 'analista@olp.co']),
    mustBeAuthorizedApprover: false,
    isAuthorizedApprover: false,
  };

  it('[SGC-REQ-135] la sustitución exige sustituto, motivo y un periodo de ausencia coherente', () => {
    expect(SGC_AUTH_TYPE_SUBSTITUTES).toBe('SGC-SUSTITUTOS');
    expect(normalizeSubstitution({ toEmail: 'Sust@OLP.co', reason: 'Vacaciones del titular', absenceFrom: '2026-11-12', absenceTo: '2026-11-20' })).toEqual({ toEmail: 'sust@olp.co', reason: 'Vacaciones del titular', absenceFrom: d('2026-11-12'), absenceTo: d('2026-11-20') });
    expect(normalizeSubstitution({ toEmail: 'sust@olp.co', reason: 'Incapacidad' })).toMatchObject({ absenceFrom: null, absenceTo: null });
    expect(() => normalizeSubstitution({ toEmail: 'sust@olp.co', reason: 'no' })).toThrow(/motivo/);
    expect(() => normalizeSubstitution({ toEmail: 'sust@olp.co', reason: 'Vacaciones', absenceFrom: '2026-11-20', absenceTo: '2026-11-12' })).toThrow(/termina antes/);
    expect(() => normalizeSubstitution(undefined)).toThrow(/Sustituto/);
  });

  it('[SGC-REQ-136] el sustituto cumple las mismas reglas: distinto del titular, con permiso, sin ser solicitante ni elaborador, sin duplicar, y autorizado si sustituye a un aprobador', () => {
    expect(substitutionDenial('sust@olp.co', ctx)).toBeNull();
    expect(substitutionDenial('titular@olp.co', ctx)).toMatch(/distinta del titular/);
    expect(substitutionDenial('nadie@olp.co', ctx)).toMatch(/gestión documental/);
    expect(substitutionDenial('sol@olp.co', ctx)).toMatch(/solicitud no puede firmarla/);
    expect(substitutionDenial('elab@olp.co', ctx)).toMatch(/elaborador/);
    expect(substitutionDenial('OTRO@olp.co', ctx)).toMatch(/ya firma en este paso/);
    expect(substitutionDenial('analista@olp.co', { ...ctx, mustBeAuthorizedApprover: true })).toMatch(/aprobadores autorizados/);
    expect(substitutionDenial('analista@olp.co', { ...ctx, mustBeAuthorizedApprover: true, isAuthorizedApprover: true })).toBeNull();
    expect(onBehalfLabel('Ana', 'luis@olp.co')).toBe('Ana en sustitución de luis@olp.co');
    expect(onBehalfLabel('Ana', null)).toBe('Ana');
  });

  const base = {
    idCompany: 3,
    idRequest: 7,
    idTask: 9,
    idTaskAssignee: 11,
    signerEmail: 'sust@olp.co',
    signerName: 'Sustituta',
    meaning: 'aprobo' as const,
    reason: 'Apruebo en sustitución',
    signedAt: new Date('2026-11-13T15:00:00Z'),
    content: { kind: 'borrador_editor' as const, ref: 'revision:4', name: 'Borrador', sha256: 'a'.repeat(64) },
    masterSha256: null,
    ip: '10.0.0.5',
    userAgent: 'vitest',
    uid: '00000000-1111-4111-8111-111111111111',
  };
  const rowOf = (p: ReturnType<typeof buildSignaturePayload>, onBehalfOf: string | null): SgcSignatureRow => ({
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
    master_sha256: null,
    ip: p.ip,
    user_agent: p.userAgent,
    on_behalf_of: onBehalfOf,
    evidence_sha256: 'b'.repeat(64),
    prev_record_hash: null,
    record_hash: '',
  });

  it('[SGC-REQ-137] «en sustitución de» entra al registro encadenado solo si hay sustitución: las firmas anteriores conservan su hash y el respaldo verifica igual', () => {
    const plain = buildSignaturePayload(base);
    const sub = buildSignaturePayload({ ...base, onBehalfOf: ' Titular@OLP.co ' });
    expect('onBehalfOf' in plain).toBe(false);
    expect(buildSignaturePayload({ ...base, onBehalfOf: null })).toEqual(plain);
    expect(sub.onBehalfOf).toBe('titular@olp.co');
    expect(canonicalJson(sub)).toContain('"onBehalfOf":"titular@olp.co"');
    const hPlain = computeRecordHash(plain, 'b'.repeat(64), null);
    const hSub = computeRecordHash(sub, 'b'.repeat(64), null);
    expect(hSub).not.toBe(hPlain);
    // La fila sin la columna (firmas anteriores al S12) y con NULL reconstruyen el mismo payload.
    const legacy = rowOf(plain, null);
    delete (legacy as Partial<SgcSignatureRow>).on_behalf_of;
    expect(payloadFromRow(legacy)).toEqual(plain);
    expect(payloadFromRow(rowOf(plain, '  '))).toEqual(plain);
    expect(computeRecordHash(payloadFromRow(rowOf(sub, 'titular@olp.co')), 'b'.repeat(64), null)).toBe(hSub);
    // El script de respaldo (lib.mjs) reconstruye exactamente lo mismo.
    expect(payloadFromRowMjs(rowOf(sub, 'titular@olp.co'))).toEqual(payloadFromRow(rowOf(sub, 'titular@olp.co')));
    expect(payloadFromRowMjs(legacy)).toEqual(plain);
    expect(computeRecordHashMjs(payloadFromRowMjs(rowOf(sub, 'titular@olp.co')), 'b'.repeat(64), null)).toBe(hSub);
  });

  it('[SGC-REQ-138] el PDF controlado y su manifiesto muestran «en sustitución de»', async () => {
    expect(signerWithSubstitution({ signerName: 'Sustituta', signerEmail: 's@olp.co', onBehalfOf: 't@olp.co' })).toBe('Sustituta (s@olp.co) en sustitución de t@olp.co');
    expect(signerWithSubstitution({ signerName: null, signerEmail: 's@olp.co' }, false)).toBe('s@olp.co');
    const content = await PDFDocument.create();
    const font = await content.embedFont(StandardFonts.Helvetica);
    content.addPage([595.28, 841.89]).drawText('Cuerpo', { x: 60, y: 500, size: 12, font });
    const manifest: SgcManifest = {
      schema: 'sgc-manifiesto-firmas/v1',
      company: 'ONE LATAM PHARMA',
      idCompany: 3,
      code: 'OLP-GC-PR-012',
      title: 'Prueba de sustitución',
      versionNumber: 1,
      idRequest: 90,
      documentType: 'PR · Procedimiento',
      process: 'GC · Gestión de calidad',
      statusLabel: 'Aprobado — pendiente de divulgación',
      approvedAt: '2026-11-13T16:00:00.000Z',
      generatedAt: '2026-11-13T16:00:05.000Z',
      changeDescription: 'Emisión inicial.',
      signedContent: { name: 'Borrador', sha256: 'a'.repeat(64) },
      signatures: [{ uid: 'u-a', meaning: 'aprobo', meaningLabel: 'Aprobó', signerName: 'Sustituta', signerEmail: 's@olp.co', signedAt: '2026-11-13T15:00:00.000Z', reason: 'Apruebo', authMethod: 'contrasena_synerlink', contentSha256: 'a'.repeat(64), recordHash: '1'.repeat(64), onBehalfOf: 't@olp.co' }],
      verifyUrl: 'https://x/verificar',
    };
    const pdf = await buildControlledPdf(await content.save(), manifest);
    expect((await readManifest(pdf))?.signatures[0].onBehalfOf).toBe('t@olp.co');
  });
});
