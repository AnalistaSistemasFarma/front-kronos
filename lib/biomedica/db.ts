import type { PrismaClient } from '../../app/generated/prisma';
import { SgcError } from '../sgc/errors';
import { stampControlledCopy } from '../sgc/watermark';
import type { BiomedAccess } from './access';
import type { SealImageBytes } from '../orion/annotationStamp';
import { sha256Hex } from '../sgc/storage';
import { AnotacionInvalida, MAX_SELLOS, dibujarAnotaciones, leerDatos, normalizarAnotaciones, validarImagenSello, type BiomedAnotacion, type BiomedSello } from './anotaciones';

/**
 * INGENIERÍA BIOMÉDICA (2026-11-06; reunión con Juan Mora del 2026-11-05).
 *
 *   - Calidad elige qué FORMATOS del SGC usa el módulo y para qué actividad.
 *   - El ingeniero DILIGENCIA la versión vigente del formato (texto con fuente
 *     fija y marcas «X» encima del PDF), lo guarda como borrador y lo CIERRA.
 *   - CONTROL (lo único que se valida): si el formato deja de estar vigente
 *     (versión nueva, obsoleto o anulado), el borrador se BLOQUEA: no se edita
 *     ni se cierra; se diligencia de nuevo sobre la versión vigente. Lo ya
 *     cerrado queda como evidencia, con su versión.
 *   - El PDF diligenciado sale con la marca de copia controlada (quién y cuándo).
 *   - Todo queda en biomed_evento (solo inserción).
 */

export type BiomedDb = PrismaClient;
export interface BiomedActor {
  email: string;
  name?: string | null;
  ip?: string | null;
}

/** Actividades de Ingeniería Biomédica (boceto de Andrea Barragán, 2026-08-27). */
export const BIOMED_ACTIVIDADES = [
  'Inspección de equipos biomédicos nuevos',
  'Elaboración y actualización de hojas de vida',
  'Trazabilidad de equipos biomédicos',
  'Control de devoluciones',
  'Liberación de equipos',
  'Visita técnica',
  'Mantenimientos (preventivo, correctivo, metrológico)',
  'Cronograma de mantenimiento',
  'Trazabilidad de repuestos e insumos',
  'Trazabilidad de inventario de equipos biomédicos',
] as const;

function lower(e: string): string {
  return e.trim().toLowerCase();
}

function texto(v: unknown, campo: string, max: number, min = 1): string {
  const t = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (t.length < min) throw new SgcError(`${campo} es obligatorio${min > 1 ? ` (mínimo ${min} caracteres)` : ''}.`);
  return t.slice(0, max);
}

async function evento(db: BiomedDb, idCompany: number, accion: string, actor: BiomedActor, detalle: string, idRegistro: number | null = null) {
  await db.biomedEvento.create({ data: { id_company: idCompany, id_biomed_registro: idRegistro, accion, actor_email: lower(actor.email), detalle: detalle.slice(0, 2000), ip: actor.ip ?? null } });
}

/** Estado de vigencia del formato para un registro: el bloqueo del CONTROL. */
export interface BiomedVigencia {
  vigente: boolean;
  motivo: string | null;
  idVersionVigente: number | null;
}

export async function vigenciaDe(db: BiomedDb, idDocument: number, idVersion: number): Promise<BiomedVigencia> {
  const doc = await db.sgcDocument.findUnique({ where: { id_document: idDocument }, select: { code: true, status: true, current_version_id: true } });
  if (!doc) return { vigente: false, motivo: 'El formato ya no existe en el SGC.', idVersionVigente: null };
  const version = await db.sgcDocumentVersion.findUnique({ where: { id_document_version: idVersion }, select: { version_number: true, status: true } });
  if (doc.status !== 'vigente') return { vigente: false, motivo: `El formato ${doc.code} está ${doc.status} en el SGC: ya no se diligencia.`, idVersionVigente: null };
  if (doc.current_version_id !== idVersion || version?.status !== 'vigente') {
    return { vigente: false, motivo: `La versión ${version?.version_number ?? ''} del formato ${doc.code} ya no está vigente: diligencie la versión vigente.`, idVersionVigente: doc.current_version_id };
  }
  return { vigente: true, motivo: null, idVersionVigente: idVersion };
}

// ---------------------------------------------------------------------------
// Formatos del módulo (Calidad)
// ---------------------------------------------------------------------------

export interface BiomedFormatoDto {
  id: number;
  idDocument: number;
  code: string;
  title: string;
  actividad: string;
  isActive: boolean;
  /** Versión vigente del formato en el SGC (null = no está vigente: no se puede diligenciar). */
  vigente: { idVersion: number; versionNumber: number } | null;
}

export async function listFormatos(db: BiomedDb, access: BiomedAccess): Promise<BiomedFormatoDto[]> {
  const rows = await db.biomedFormato.findMany({ where: { id_company: access.idCompany, ...(access.canConfigure ? {} : { is_active: true }) }, orderBy: [{ actividad: 'asc' }, { id_biomed_formato: 'asc' }] });
  if (!rows.length) return [];
  const docs = await db.sgcDocument.findMany({ where: { id_document: { in: rows.map((r) => r.id_document) } }, select: { id_document: true, code: true, title: true, status: true, current_version_id: true } });
  const versions = await db.sgcDocumentVersion.findMany({ where: { id_document_version: { in: docs.map((d) => d.current_version_id).filter((v): v is number => v !== null) } }, select: { id_document_version: true, version_number: true, status: true } });
  const byDoc = new Map(docs.map((d) => [d.id_document, d]));
  const byVersion = new Map(versions.map((v) => [v.id_document_version, v]));
  return rows.map((r) => {
    const d = byDoc.get(r.id_document);
    const v = d?.current_version_id ? byVersion.get(d.current_version_id) : undefined;
    return {
      id: r.id_biomed_formato,
      idDocument: r.id_document,
      code: d?.code ?? '—',
      title: d?.title ?? '(documento no encontrado)',
      actividad: r.actividad,
      isActive: r.is_active,
      vigente: d?.status === 'vigente' && v?.status === 'vigente' ? { idVersion: v.id_document_version, versionNumber: v.version_number } : null,
    };
  });
}

/** Habilita (o actualiza) un formato vigente del SGC en el módulo. Solo Calidad. */
export async function saveFormato(db: BiomedDb, access: BiomedAccess, input: { idDocument?: unknown; actividad?: unknown; isActive?: unknown }, actor: BiomedActor) {
  if (!access.canConfigure) throw new SgcError('Solo Aseguramiento de Calidad elige los formatos del módulo.', 403);
  const idDocument = Number(input.idDocument);
  const doc = Number.isInteger(idDocument) ? await db.sgcDocument.findFirst({ where: { id_document: idDocument, id_company: access.idCompany } }) : null;
  if (!doc) throw new SgcError('Documento no encontrado en el SGC de la empresa.', 404);
  const actividad = texto(input.actividad, 'La actividad', 200, 3);
  const isActive = input.isActive !== false;
  if (isActive && doc.status !== 'vigente') throw new SgcError(`El documento ${doc.code} no está vigente: solo se habilitan formatos vigentes.`, 409);
  const now = new Date();
  const row = await db.biomedFormato.upsert({
    where: { id_company_id_document: { id_company: access.idCompany, id_document: idDocument } },
    create: { id_company: access.idCompany, id_document: idDocument, actividad, is_active: isActive, created_by: lower(actor.email) },
    update: { actividad, is_active: isActive, updated_by: lower(actor.email), updated_at: now },
  });
  await evento(db, access.idCompany, isActive ? 'formato.habilitado' : 'formato.retirado', actor, `${doc.code} · ${actividad}`);
  return { id: row.id_biomed_formato };
}

// ---------------------------------------------------------------------------
// Registros (formatos diligenciados)
// ---------------------------------------------------------------------------

export interface BiomedRegistroResumenDto {
  id: number;
  idFormato: number;
  code: string;
  title: string;
  actividad: string;
  versionNumber: number;
  equipo: string;
  serial: string | null;
  estado: 'borrador' | 'cerrado' | 'anulado';
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
  /** Borrador cuyo formato ya no está vigente: bloqueado. */
  bloqueado: boolean;
}

export async function listRegistros(db: BiomedDb, access: BiomedAccess, filtros: { q?: string | null } = {}): Promise<BiomedRegistroResumenDto[]> {
  const q = (filtros.q ?? '').trim().slice(0, 100);
  const rows = await db.biomedRegistro.findMany({
    where: { id_company: access.idCompany, ...(q ? { OR: [{ equipo: { contains: q } }, { serial: { contains: q } }] } : {}) },
    orderBy: { id_biomed_registro: 'desc' },
    take: 300,
    include: { formato: true },
  });
  if (!rows.length) return [];
  const docs = new Map((await db.sgcDocument.findMany({ where: { id_document: { in: [...new Set(rows.map((r) => r.id_document))] } }, select: { id_document: true, code: true, title: true, status: true, current_version_id: true } })).map((d) => [d.id_document, d]));
  const versions = new Map((await db.sgcDocumentVersion.findMany({ where: { id_document_version: { in: [...new Set(rows.map((r) => r.id_document_version))] } }, select: { id_document_version: true, version_number: true, status: true } })).map((v) => [v.id_document_version, v]));
  return rows.map((r) => {
    const d = docs.get(r.id_document);
    const v = versions.get(r.id_document_version);
    const vigente = d?.status === 'vigente' && d.current_version_id === r.id_document_version && v?.status === 'vigente';
    return {
      id: r.id_biomed_registro,
      idFormato: r.id_biomed_formato,
      code: d?.code ?? '—',
      title: d?.title ?? '—',
      actividad: r.formato.actividad,
      versionNumber: v?.version_number ?? 0,
      equipo: r.equipo,
      serial: r.serial,
      estado: r.estado as BiomedRegistroResumenDto['estado'],
      createdBy: r.created_by,
      createdAt: r.created_at.toISOString(),
      closedAt: r.closed_at?.toISOString() ?? null,
      bloqueado: r.estado === 'borrador' && !vigente,
    };
  });
}

/** Nuevo registro sobre la VERSIÓN VIGENTE del formato. */
export async function createRegistro(db: BiomedDb, access: BiomedAccess, input: { idFormato?: unknown; equipo?: unknown; serial?: unknown }, actor: BiomedActor) {
  if (!access.canUse) throw new SgcError('Sin acceso al módulo de Ingeniería biomédica.', 403);
  const idFormato = Number(input.idFormato);
  const formato = Number.isInteger(idFormato) ? await db.biomedFormato.findFirst({ where: { id_biomed_formato: idFormato, id_company: access.idCompany, is_active: true } }) : null;
  if (!formato) throw new SgcError('El formato no está habilitado en el módulo.', 404);
  const doc = await db.sgcDocument.findUnique({ where: { id_document: formato.id_document }, select: { code: true, status: true, current_version_id: true } });
  if (!doc || doc.status !== 'vigente' || !doc.current_version_id) throw new SgcError('El formato no está vigente en el SGC: no se puede diligenciar.', 409);
  const equipo = texto(input.equipo, 'El equipo', 200, 2);
  const serial = typeof input.serial === 'string' && input.serial.trim() ? input.serial.trim().slice(0, 100) : null;
  const row = await db.biomedRegistro.create({
    data: { id_company: access.idCompany, id_biomed_formato: formato.id_biomed_formato, id_document: formato.id_document, id_document_version: doc.current_version_id, equipo, serial, created_by: lower(actor.email) },
  });
  await evento(db, access.idCompany, 'registro.creado', actor, `${doc.code} · ${equipo}${serial ? ` (serial ${serial})` : ''}`, row.id_biomed_registro);
  return { id: row.id_biomed_registro };
}

async function registroDe(db: BiomedDb, access: BiomedAccess, idRegistro: number) {
  const r = Number.isInteger(idRegistro) ? await db.biomedRegistro.findFirst({ where: { id_biomed_registro: idRegistro, id_company: access.idCompany }, include: { formato: true } }) : null;
  if (!r) throw new SgcError('Registro no encontrado.', 404);
  return r;
}

export interface BiomedRegistroDto extends BiomedRegistroResumenDto {
  anotaciones: BiomedAnotacion[];
  motivoBloqueo: string | null;
  puedeEditar: boolean;
}

export async function getRegistro(db: BiomedDb, access: BiomedAccess, idRegistro: number, viewerEmail: string): Promise<BiomedRegistroDto> {
  const r = await registroDe(db, access, idRegistro);
  const [resumen] = (await listRegistros(db, access)).filter((x) => x.id === r.id_biomed_registro);
  const vig = await vigenciaDe(db, r.id_document, r.id_document_version);
  const base: BiomedRegistroResumenDto =
    resumen ?? { id: r.id_biomed_registro, idFormato: r.id_biomed_formato, code: '—', title: '—', actividad: r.formato.actividad, versionNumber: 0, equipo: r.equipo, serial: r.serial, estado: r.estado as BiomedRegistroResumenDto['estado'], createdBy: r.created_by, createdAt: r.created_at.toISOString(), closedAt: r.closed_at?.toISOString() ?? null, bloqueado: !vig.vigente };
  const esAutor = lower(r.created_by) === lower(viewerEmail);
  return {
    ...base,
    anotaciones: leerDatos(r.data_json).anotaciones,
    motivoBloqueo: r.estado === 'borrador' && !vig.vigente ? vig.motivo : null,
    puedeEditar: r.estado === 'borrador' && vig.vigente && (esAutor || access.canConfigure),
  };
}

async function editable(db: BiomedDb, access: BiomedAccess, idRegistro: number, actor: BiomedActor) {
  const r = await registroDe(db, access, idRegistro);
  if (r.estado !== 'borrador') throw new SgcError('El registro ya está cerrado: no se modifica.', 409);
  if (lower(r.created_by) !== lower(actor.email) && !access.canConfigure) throw new SgcError('Solo quien lo diligenció (o Calidad) modifica el registro.', 403);
  const vig = await vigenciaDe(db, r.id_document, r.id_document_version);
  if (!vig.vigente) throw new SgcError(vig.motivo ?? 'El formato ya no está vigente.', 409);
  return r;
}

/** Guarda lo escrito encima del formato (borrador). */
export async function saveAnotaciones(db: BiomedDb, access: BiomedAccess, idRegistro: number, raw: unknown, actor: BiomedActor) {
  const r = await editable(db, access, idRegistro, actor);
  const datos = leerDatos(r.data_json);
  const anotaciones = normalizarAnotaciones(raw, datos.anotaciones, datos.sellos, { email: lower(actor.email), name: actor.name ?? null });
  await db.biomedRegistro.update({ where: { id_biomed_registro: r.id_biomed_registro }, data: { data_json: JSON.stringify({ ...datos, anotaciones }), updated_by: lower(actor.email), updated_at: new Date() } });
  await evento(db, access.idCompany, 'registro.guardado', actor, `${anotaciones.length} anotación(es)`, r.id_biomed_registro);
  return { saved: anotaciones.length };
}

/** Cierra el registro: queda como evidencia (no se modifica más). */
export async function closeRegistro(db: BiomedDb, access: BiomedAccess, idRegistro: number, actor: BiomedActor) {
  const r = await editable(db, access, idRegistro, actor);
  if (leerDatos(r.data_json).anotaciones.length === 0) throw new SgcError('El formato está vacío: diligéncielo antes de cerrarlo.');
  const now = new Date();
  await db.biomedRegistro.update({ where: { id_biomed_registro: r.id_biomed_registro }, data: { estado: 'cerrado', closed_by: lower(actor.email), closed_at: now, updated_by: lower(actor.email), updated_at: now } });
  await evento(db, access.idCompany, 'registro.cerrado', actor, `${r.equipo}`, r.id_biomed_registro);
  return { closed: true };
}

/**
 * PDF del registro: la versión del formato (verificada por su huella) con lo
 * diligenciado encima (`vacio` = solo el formato, para el editor) y la marca de
 * copia controlada con quién lo consulta y cuándo.
 */
export async function pdfRegistro(
  db: BiomedDb,
  access: BiomedAccess,
  idRegistro: number,
  opts: { vacio: boolean; viewerEmail: string; now?: Date },
  deps: { downloadVerifiedPdf: (itemId: string, sha256: string) => Promise<Uint8Array>; downloadVerifiedFile: (itemId: string, sha256: string) => Promise<Uint8Array> },
  actor: BiomedActor
): Promise<Uint8Array> {
  const r = await registroDe(db, access, idRegistro);
  const version = await db.sgcDocumentVersion.findUnique({ where: { id_document_version: r.id_document_version }, include: { document: { select: { code: true } } } });
  if (!version) throw new SgcError('La versión del formato no existe.', 404);
  const original = await deps.downloadVerifiedPdf(version.pdf_item_id, version.pdf_sha256);
  let lleno = original;
  if (!opts.vacio) {
    const datos = leerDatos(r.data_json);
    lleno = await dibujarAnotaciones(original, datos.anotaciones, await imagenesDeSellos(datos, deps.downloadVerifiedFile));
  }
  const now = opts.now ?? new Date();
  const out = await stampControlledCopy(lleno, {
    code: version.document.code,
    versionNumber: version.version_number,
    viewerEmail: opts.viewerEmail,
    at: now,
    mode: 'consulta',
    state: version.status === 'vigente' ? 'vigente' : version.status === 'anulado' ? 'anulado' : 'obsoleto',
  });
  if (!opts.vacio) await evento(db, access.idCompany, 'registro.consultado', actor, `${version.document.code} V${version.version_number} · ${r.equipo}`, r.id_biomed_registro);
  return out;
}

/** Las imágenes de los sellos que se usan (verificadas por su huella); la que falle se omite. */
async function imagenesDeSellos(datos: { anotaciones: BiomedAnotacion[]; sellos: BiomedSello[] }, download: (itemId: string, sha256: string) => Promise<Uint8Array>) {
  const usados = new Set(datos.anotaciones.filter((a) => a.kind === 'seal').map((a) => String(a.sealItemId)));
  const out: Record<string, SealImageBytes | null> = {};
  for (const s of datos.sellos.filter((x) => usados.has(x.itemId))) {
    try {
      out[s.itemId] = { bytes: await download(s.itemId, s.sha256), mime: s.mime };
    } catch {
      out[s.itemId] = null;
    }
  }
  return out;
}

/**
 * Carga la imagen de un SELLO en el registro (borrador): PNG o JPG de máximo 2 MB, a la
 * carpeta del SGC de la empresa (<raíz>/_biomedica/sellos/registro-<id>) con su huella.
 */
export async function addSello(
  db: BiomedDb,
  access: BiomedAccess,
  idRegistro: number,
  file: { bytes: Uint8Array; fileName: string },
  actor: BiomedActor,
  deps: { upload: (segments: string[], fileName: string, content: Uint8Array, contentType: string) => Promise<{ id: string }> }
): Promise<{ sealItemId: string; sealFileName: string }> {
  const r = await editable(db, access, idRegistro, actor);
  let mime: BiomedSello['mime'];
  try {
    mime = validarImagenSello(file.bytes);
  } catch (e) {
    throw new SgcError(e instanceof AnotacionInvalida ? e.message : 'Imagen inválida.', 400);
  }
  const datos = leerDatos(r.data_json);
  if (datos.sellos.length >= MAX_SELLOS) throw new SgcError(`Máximo ${MAX_SELLOS} sellos por registro.`, 400);
  const config = await db.sgcCompanyConfig.findUnique({ where: { id_company: access.idCompany }, select: { storage_root: true } });
  if (!config?.storage_root) throw new SgcError('La empresa no tiene configurada la carpeta del SGC.', 409);
  const segments = [...config.storage_root.split('/').filter(Boolean), '_biomedica', 'sellos', `registro-${r.id_biomed_registro}`];
  const now = new Date();
  const fileName = `sello-${now.getTime()}.${mime === 'image/png' ? 'png' : 'jpg'}`;
  const item = await deps.upload(segments, fileName, file.bytes, mime);
  const sello: BiomedSello = { itemId: item.id, fileName, mime, sha256: sha256Hex(file.bytes), uploadedBy: lower(actor.email), uploadedAt: now.toISOString() };
  await db.biomedRegistro.update({ where: { id_biomed_registro: r.id_biomed_registro }, data: { data_json: JSON.stringify({ ...datos, sellos: [...datos.sellos, sello] }), updated_by: lower(actor.email), updated_at: now } });
  await evento(db, access.idCompany, 'registro.sello', actor, `${file.fileName || fileName} (${file.bytes.byteLength} bytes)`, r.id_biomed_registro);
  return { sealItemId: item.id, sealFileName: file.fileName || fileName };
}

/** Imagen de un sello DEL registro (verificada por su huella), para dibujarlo en pantalla. */
export async function getSello(
  db: BiomedDb,
  access: BiomedAccess,
  idRegistro: number,
  itemId: string,
  deps: { downloadVerifiedFile: (itemId: string, sha256: string) => Promise<Uint8Array> }
): Promise<{ bytes: Uint8Array; mime: BiomedSello['mime'] }> {
  const r = await registroDe(db, access, idRegistro);
  const sello = leerDatos(r.data_json).sellos.find((s) => s.itemId === itemId);
  if (!sello) throw new SgcError('Sello no encontrado.', 404);
  return { bytes: await deps.downloadVerifiedFile(sello.itemId, sello.sha256), mime: sello.mime };
}
