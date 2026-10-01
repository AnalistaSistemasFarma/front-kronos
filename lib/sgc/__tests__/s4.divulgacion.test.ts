import { describe, expect, it } from 'vitest';
import {
  SGC_READ_STATUS_LABELS,
  SGC_SCOPE_KIND_LABELS,
  defaultScope,
  getReadSignError,
  isSgcScopeKind,
  normalizeReadingEvent,
  normalizeScopeEntry,
  resolveReaders,
  scopeKey,
  summarizeCoverage,
  type SgcScopeDirectory,
} from '../dissemination/scope';
import { SgcError } from '../errors';
import { normalizeFlowDefinition, type SgcFlowDefinition } from '../flows/definition';
import { SGC_AUTH_TYPE_QUALITY, SGC_DOCUMENT_FLOW_V2, SGC_DOCUMENT_FLOW_V3 } from '../flows/documentFlow';
import { resolveNextStep } from '../flows/engine';

/** Sprint 4 — divulgación: alcance, lectores, cobertura y lectura hasta el final (reglas puras). */

const clone = (d: SgcFlowDefinition): SgcFlowDefinition => JSON.parse(JSON.stringify(d));
const dir: SgcScopeDirectory = {
  eligible: new Set(['ana@olp.co', 'beto@olp.co', 'caro@olp.co', 'dani@olp.co']),
  companyMembers: ['ana@olp.co', 'beto@olp.co', 'caro@olp.co', 'dani@olp.co'],
  departmentMembers: new Map([
    [3, ['ana@olp.co', 'BETO@olp.co', 'externo@olp.co']],
    [7, ['caro@olp.co']],
  ]),
  cargoMembers: new Map([[11, ['dani@olp.co', 'ana@olp.co']]]),
};

describe('SGC · S4 · flujo documental v3 (pasos 4 y 5 habilitados)', () => {
  it('[SGC-REQ-052] la v3 es válida: divulgación por alcance con firma «Leyó» administrada por Calidad y capacitación habilitada; solo cambia eso frente a la v2', () => {
    const def = normalizeFlowDefinition(clone(SGC_DOCUMENT_FLOW_V3));
    const div = def.tasks.find((t) => t.key === 'divulgacion')!;
    const cap = def.tasks.find((t) => t.key === 'capacitacion')!;
    expect(div).toMatchObject({ assignment: 'alcance', isEnabled: true, signatureMeaning: 'leyo', multiAssignee: false, signingModeDefault: null, poolAuthorizationTypeCode: SGC_AUTH_TYPE_QUALITY });
    expect(cap).toMatchObject({ assignment: 'calidad', isEnabled: true, signatureMeaning: 'capacito', conditionKey: 'tipo_exige_capacitacion' });
    expect(def.tasks.every((t) => t.isEnabled)).toBe(true);
    expect(def.transitions.filter((t) => t.action === 'cancelar').map((t) => t.from).sort()).toEqual(['aprobacion', 'capacitacion', 'divulgacion', 'elaboracion', 'revision', 'solicitud']);
    expect(def.formFields).toEqual(normalizeFlowDefinition(clone(SGC_DOCUMENT_FLOW_V2)).formFields);
    // Aprobar la Aprobación lleva a la Divulgación; la Divulgación, a la Capacitación; la Capacitación cierra «completada».
    expect(resolveNextStep(def, 'aprobacion', 'aprobar', { requestType: 'nueva_version', requiresTraining: true })).toMatchObject({ kind: 'task', task: { key: 'divulgacion' } });
    expect(resolveNextStep(def, 'divulgacion', 'aprobar', { requestType: 'nueva_version', requiresTraining: true })).toMatchObject({ kind: 'task', task: { key: 'capacitacion' } });
    expect(resolveNextStep(def, 'capacitacion', 'aprobar', { requestType: 'nueva_version', requiresTraining: true })).toEqual({ kind: 'terminal', status: 'completada' });
    // Si un tipo no exigiera capacitación, la divulgación cierra la solicitud.
    expect(resolveNextStep(def, 'divulgacion', 'aprobar', { requestType: 'nuevo', requiresTraining: false })).toEqual({ kind: 'terminal', status: 'completada' });
    expect(() => resolveNextStep(def, 'divulgacion', 'devolver', { requestType: 'nuevo', requiresTraining: true })).toThrow(SgcError);
  });

  it('[SGC-REQ-052] la asignación «alcance» exige firma «Leyó», un grupo que la administre y no admite varios responsables ni autorización', () => {
    const base = () => clone(SGC_DOCUMENT_FLOW_V3);
    const mut = (fn: (t: SgcFlowDefinition['tasks'][number]) => void) => {
      const d = base();
      fn(d.tasks.find((t) => t.key === 'divulgacion')!);
      return () => normalizeFlowDefinition(d);
    };
    expect(mut((t) => (t.signatureMeaning = 'aprobo'))).toThrow(/Leyó/);
    expect(mut((t) => (t.poolAuthorizationTypeCode = null))).toThrow(/grupo que administra/);
    expect(mut((t) => (t.multiAssignee = true))).toThrow(/varios responsables/);
    expect(mut((t) => {
      t.isAuthorization = true;
      t.authorizationTypeCode = 'SGC-APROBACION';
    })).toThrow(/no es una tarea de autorización/);
    const ok = base();
    ok.tasks.find((t) => t.key === 'divulgacion')!.signingModeDefault = 'orden';
    expect(normalizeFlowDefinition(ok).tasks.find((t) => t.key === 'divulgacion')!.signingModeDefault).toBeNull();
  });
});

describe('SGC · S4 · alcance de divulgación', () => {
  it('[SGC-REQ-053] valida las cuatro clases de alcance y su clave estable', () => {
    expect(normalizeScopeEntry({ kind: 'empresa' })).toEqual({ kind: 'empresa', idDepartment: null, idCargo: null, userEmail: null });
    expect(normalizeScopeEntry({ kind: 'departamento', idDepartment: '3' })).toMatchObject({ kind: 'departamento', idDepartment: 3 });
    expect(normalizeScopeEntry({ kind: 'cargo', idCargo: 11 })).toMatchObject({ kind: 'cargo', idCargo: 11 });
    expect(normalizeScopeEntry({ kind: 'persona', email: ' Ana@OLP.co ' })).toMatchObject({ kind: 'persona', userEmail: 'ana@olp.co' });
    expect(normalizeScopeEntry({ kind: 'persona', userEmail: 'x@y.co' }).userEmail).toBe('x@y.co');
    expect(() => normalizeScopeEntry({ kind: 'grupo' })).toThrow(/Clase de alcance/);
    expect(() => normalizeScopeEntry(null)).toThrow(SgcError);
    expect(() => normalizeScopeEntry({ kind: 'departamento', idDepartment: 0 })).toThrow(/departamento/);
    expect(() => normalizeScopeEntry({ kind: 'cargo' })).toThrow(/cargo/);
    expect(() => normalizeScopeEntry({ kind: 'persona', email: 'no-es-correo' })).toThrow(/correo/);
    expect(() => normalizeScopeEntry({ kind: 'persona', email: `${'a'.repeat(250)}@olp.co` })).toThrow(/correo/);
    expect(['empresa', 'departamento:3', 'cargo:11', 'persona:ana@olp.co']).toEqual([
      scopeKey(normalizeScopeEntry({ kind: 'empresa' })),
      scopeKey(normalizeScopeEntry({ kind: 'departamento', idDepartment: 3 })),
      scopeKey(normalizeScopeEntry({ kind: 'cargo', idCargo: 11 })),
      scopeKey(normalizeScopeEntry({ kind: 'persona', email: 'ana@olp.co' })),
    ]);
    expect(isSgcScopeKind('cargo')).toBe(true);
    expect(isSgcScopeKind(3)).toBe(false);
    expect(Object.keys(SGC_SCOPE_KIND_LABELS)).toHaveLength(4);
  });

  it('[SGC-REQ-053][SGC-REQ-054] resuelve lectores sin repetir, en orden, con su origen; quien no tiene acceso al SGC queda aparte', () => {
    const res = resolveReaders(
      [
        { kind: 'departamento', idDepartment: 3, idCargo: null, userEmail: null },
        { kind: 'cargo', idCargo: 11, idDepartment: null, userEmail: null },
        { kind: 'persona', userEmail: 'caro@olp.co', idDepartment: null, idCargo: null },
        { kind: 'departamento', idDepartment: 99, idCargo: null, userEmail: null },
        { kind: 'cargo', idCargo: 98, idDepartment: null, userEmail: null },
      ],
      dir
    );
    expect(res.readers).toEqual([
      { email: 'ana@olp.co', sources: ['cargo:11', 'departamento:3'] },
      { email: 'beto@olp.co', sources: ['departamento:3'] },
      { email: 'caro@olp.co', sources: ['persona:caro@olp.co'] },
      { email: 'dani@olp.co', sources: ['cargo:11'] },
    ]);
    expect(res.withoutAccess).toEqual([{ email: 'externo@olp.co', sources: ['departamento:3'] }]);
    const empresa = resolveReaders([{ kind: 'empresa', idDepartment: null, idCargo: null, userEmail: null }], dir, new Set(['ana@olp.co']));
    expect(empresa.readers.map((r) => r.email)).toEqual(['beto@olp.co', 'caro@olp.co', 'dani@olp.co']);
    expect(resolveReaders([{ kind: 'persona', userEmail: '  ', idDepartment: null, idCargo: null }], dir).readers).toEqual([]);
  });

  it('[SGC-REQ-053] sin alcance definido se toma el departamento dueño del proceso (si existe)', () => {
    expect(defaultScope(7)).toEqual([{ kind: 'departamento', idDepartment: 7, idCargo: null, userEmail: null }]);
    expect(defaultScope(null)).toEqual([]);
    expect(defaultScope(undefined)).toEqual([]);
  });
});

describe('SGC · S4 · lectura obligatoria y cobertura', () => {
  const at = new Date('2026-10-01T15:00:00Z');
  it('[SGC-REQ-055] «Leído» solo se firma con la lectura pendiente, abierta y leída hasta el final', () => {
    expect(getReadSignError(null)).toMatch(/no tiene una lectura/);
    expect(getReadSignError({ status: 'leido', openedAt: at, reachedEndAt: at, signedAt: at })).toMatch(/ya firmó/);
    expect(getReadSignError({ status: 'excluido', openedAt: null, reachedEndAt: null, signedAt: null })).toMatch(/excluida/);
    expect(getReadSignError({ status: 'pendiente', openedAt: null, reachedEndAt: null, signedAt: null })).toMatch(/Abra el documento/);
    expect(getReadSignError({ status: 'pendiente', openedAt: at, reachedEndAt: null, signedAt: null })).toMatch(/llega al final/);
    expect(getReadSignError({ status: 'pendiente', openedAt: at, reachedEndAt: at, signedAt: null })).toBeNull();
  });

  it('[SGC-REQ-055] el visor solo informa «abierto» o «final» (con páginas válidas)', () => {
    expect(normalizeReadingEvent({ event: 'final', pages: 12 })).toEqual({ event: 'final', pages: 12 });
    expect(normalizeReadingEvent({ event: 'abierto', pages: -1 })).toEqual({ event: 'abierto', pages: null });
    expect(normalizeReadingEvent({ event: 'final', pages: 'x' }).pages).toBeNull();
    expect(() => normalizeReadingEvent({ event: 'leido' })).toThrow(/inválido/);
    expect(() => normalizeReadingEvent(undefined)).toThrow(SgcError);
  });

  it('[SGC-REQ-057] cobertura: leídos sobre los que cuentan (sin excluidos), pendientes, abiertos y al final', () => {
    const c = summarizeCoverage([
      { status: 'leido', openedAt: at, reachedEndAt: at, signedAt: at },
      { status: 'pendiente', openedAt: at, reachedEndAt: at, signedAt: null },
      { status: 'pendiente', openedAt: at, reachedEndAt: null, signedAt: null },
      { status: 'pendiente', openedAt: null, reachedEndAt: null, signedAt: null },
      { status: 'excluido', openedAt: at, reachedEndAt: at, signedAt: null },
    ]);
    expect(c).toEqual({ total: 5, read: 1, pending: 3, excluded: 1, opened: 3, reachedEnd: 2, percent: 25, complete: false });
    expect(summarizeCoverage([{ status: 'leido', openedAt: at, reachedEndAt: at, signedAt: at }, { status: 'excluido', openedAt: null, reachedEndAt: null, signedAt: null }])).toMatchObject({ percent: 100, complete: true });
    expect(summarizeCoverage([])).toMatchObject({ total: 0, percent: 0, complete: false });
    expect(SGC_READ_STATUS_LABELS.leido).toBe('Leído y firmado');
  });
});
