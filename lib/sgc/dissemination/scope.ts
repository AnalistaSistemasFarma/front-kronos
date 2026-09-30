import { SgcError } from '../errors';

/**
 * DIVULGACIÓN del SGC (Sprint 4, paso 4 del flujo documental) — funciones
 * PURAS: alcance, resolución de lectores y cobertura de lectura.
 *
 * El alcance de una solicitud se arma con entradas de cuatro clases:
 *   - empresa       todas las personas con acceso al SGC de la empresa;
 *   - departamento  las personas del departamento (dbo.department_user);
 *   - cargo         las personas que Calidad registró en ese cargo
 *                   (sgc.cargo_member: SynerLink no vincula persona↔cargo);
 *   - persona       una persona puntual.
 * Solo reciben tarea de lectura quienes tienen permiso de consulta del SGC en
 * la empresa; los demás se informan aparte («sin acceso al SGC») para que
 * Calidad les otorgue el permiso o los excluya. Nada se borra: una entrada
 * se retira con motivo y un lector se excluye con motivo.
 */

export const SGC_SCOPE_KINDS = ['empresa', 'departamento', 'cargo', 'persona'] as const;
export type SgcScopeKind = (typeof SGC_SCOPE_KINDS)[number];

export const SGC_SCOPE_KIND_LABELS: Record<SgcScopeKind, string> = {
  empresa: 'Toda la empresa',
  departamento: 'Departamento',
  cargo: 'Cargo',
  persona: 'Persona',
};

export type SgcReadStatus = 'pendiente' | 'leido' | 'excluido';

export const SGC_READ_STATUS_LABELS: Record<SgcReadStatus, string> = {
  pendiente: 'Pendiente',
  leido: 'Leído y firmado',
  excluido: 'Excluido (con justificación)',
};

export interface SgcScopeEntry {
  kind: SgcScopeKind;
  idDepartment: number | null;
  idCargo: number | null;
  userEmail: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isSgcScopeKind(value: unknown): value is SgcScopeKind {
  return typeof value === 'string' && (SGC_SCOPE_KINDS as readonly string[]).includes(value);
}

/** Valida una entrada de alcance tal como llega del formulario. */
export function normalizeScopeEntry(raw: unknown): SgcScopeEntry {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!isSgcScopeKind(r.kind)) throw new SgcError('Clase de alcance inválida: empresa, departamento, cargo o persona.');
  const kind = r.kind;
  if (kind === 'empresa') return { kind, idDepartment: null, idCargo: null, userEmail: null };
  if (kind === 'departamento') {
    const id = Number(r.idDepartment);
    if (!Number.isInteger(id) || id < 1) throw new SgcError('Seleccione el departamento.');
    return { kind, idDepartment: id, idCargo: null, userEmail: null };
  }
  if (kind === 'cargo') {
    const id = Number(r.idCargo);
    if (!Number.isInteger(id) || id < 1) throw new SgcError('Seleccione el cargo.');
    return { kind, idDepartment: null, idCargo: id, userEmail: null };
  }
  const email = String(r.email ?? r.userEmail ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 255) throw new SgcError('Indique el correo de la persona.');
  return { kind, idDepartment: null, idCargo: null, userEmail: email };
}

/** Clave estable de una entrada (para no repetirla en el alcance). */
export function scopeKey(e: SgcScopeEntry): string {
  switch (e.kind) {
    case 'empresa':
      return 'empresa';
    case 'departamento':
      return `departamento:${e.idDepartment}`;
    case 'cargo':
      return `cargo:${e.idCargo}`;
    default:
      return `persona:${e.userEmail}`;
  }
}

/** Directorio de la empresa con el que se resuelve el alcance (lo arma la capa de base de datos). */
export interface SgcScopeDirectory {
  /** Personas activas de la empresa con permiso de consulta del SGC (en minúscula). */
  eligible: ReadonlySet<string>;
  /** Todas las personas activas de la empresa (para «toda la empresa»). */
  companyMembers: readonly string[];
  departmentMembers: ReadonlyMap<number, readonly string[]>;
  cargoMembers: ReadonlyMap<number, readonly string[]>;
}

export interface SgcResolvedReader {
  email: string;
  /** Claves de las entradas que lo incluyen (p. ej. ["departamento:3", "persona:x@y"]). */
  sources: string[];
}

export interface SgcScopeResolution {
  readers: SgcResolvedReader[];
  /** Personas del alcance SIN permiso de consulta del SGC: no reciben tarea. */
  withoutAccess: SgcResolvedReader[];
}

/**
 * Personas del alcance (sin repetir, en orden alfabético). Quien no tiene
 * acceso al SGC queda aparte. `exclude` deja por fuera correos puntuales
 * (p. ej. personas ya excluidas con justificación).
 */
export function resolveReaders(entries: readonly SgcScopeEntry[], dir: SgcScopeDirectory, exclude: ReadonlySet<string> = new Set()): SgcScopeResolution {
  const found = new Map<string, Set<string>>();
  const add = (email: string, source: string) => {
    const e = email.trim().toLowerCase();
    if (!e || exclude.has(e)) return;
    if (!found.has(e)) found.set(e, new Set());
    found.get(e)!.add(source);
  };
  for (const entry of entries) {
    const key = scopeKey(entry);
    if (entry.kind === 'empresa') dir.companyMembers.forEach((m) => add(m, key));
    else if (entry.kind === 'departamento') (dir.departmentMembers.get(entry.idDepartment!) ?? []).forEach((m) => add(m, key));
    else if (entry.kind === 'cargo') (dir.cargoMembers.get(entry.idCargo!) ?? []).forEach((m) => add(m, key));
    else add(entry.userEmail!, key);
  }
  const readers: SgcResolvedReader[] = [];
  const withoutAccess: SgcResolvedReader[] = [];
  for (const [email, sources] of [...found.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    (dir.eligible.has(email) ? readers : withoutAccess).push({ email, sources: [...sources].sort() });
  }
  return { readers, withoutAccess };
}

/** Alcance por defecto cuando nadie lo definió: el departamento dueño del proceso (si existe). */
export function defaultScope(idOwnerDepartment: number | null | undefined): SgcScopeEntry[] {
  return idOwnerDepartment ? [{ kind: 'departamento', idDepartment: idOwnerDepartment, idCargo: null, userEmail: null }] : [];
}

export interface SgcReadRecordState {
  status: SgcReadStatus;
  openedAt: Date | null;
  reachedEndAt: Date | null;
  signedAt: Date | null;
}

export interface SgcCoverage {
  total: number;
  read: number;
  pending: number;
  excluded: number;
  opened: number;
  reachedEnd: number;
  /** Porcentaje leído sobre los que cuentan (total − excluidos), redondeado a un decimal. */
  percent: number;
  complete: boolean;
}

/** Cobertura de lectura de una divulgación. */
export function summarizeCoverage(records: readonly SgcReadRecordState[]): SgcCoverage {
  const total = records.length;
  const read = records.filter((r) => r.status === 'leido').length;
  const excluded = records.filter((r) => r.status === 'excluido').length;
  const pending = records.filter((r) => r.status === 'pendiente').length;
  const opened = records.filter((r) => r.status !== 'excluido' && r.openedAt).length;
  const reachedEnd = records.filter((r) => r.status !== 'excluido' && r.reachedEndAt).length;
  const counted = total - excluded;
  const percent = counted > 0 ? Math.round((read / counted) * 1000) / 10 : 0;
  return { total, read, pending, excluded, opened, reachedEnd, percent, complete: counted > 0 && pending === 0 };
}

/**
 * ¿Puede la persona firmar «Leyó»? Solo si su lectura está pendiente y el
 * servidor registró que llegó al final del documento. Devuelve el motivo si no.
 */
export function getReadSignError(r: SgcReadRecordState | null): string | null {
  if (!r) return 'Usted no tiene una lectura asignada en esta divulgación.';
  if (r.status === 'leido') return 'Usted ya firmó la lectura de este documento.';
  if (r.status === 'excluido') return 'Su lectura fue excluida por Calidad: no se firma.';
  if (!r.openedAt) return 'Abra el documento y léalo hasta el final antes de firmar «Leído».';
  if (!r.reachedEndAt) return 'Aún no llega al final del documento: «Leído» se habilita al terminar de leerlo.';
  return null;
}

/** Normaliza el evento de avance de lectura que envía el visor. */
export function normalizeReadingEvent(raw: unknown): { event: 'abierto' | 'final'; pages: number | null } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (r.event !== 'abierto' && r.event !== 'final') throw new SgcError('Evento de lectura inválido.');
  const pages = Number(r.pages);
  return { event: r.event, pages: Number.isInteger(pages) && pages > 0 && pages < 10_000 ? pages : null };
}
