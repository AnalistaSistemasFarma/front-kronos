import 'server-only';
import { randomUUID } from 'node:crypto';
import type { VitrinaDb } from './access';
import { VITRINA_DOCUMENTO_TIPOS, VITRINA_IMAGEN_TIPOS, VITRINA_LIMITS, VITRINA_MODELO3D_MIME } from './constants';
import {
  dimensionesCm,
  documentoSgcMostrable,
  esTipoDocumento,
  esTipoImagen,
  idiomaDocumento,
  nombreArchivoImagen,
  nombreArchivoModelo3d,
  nombreOriginalModelo3d,
  siguienteVersion,
  validarImagen,
  validarModelo3d,
  type DimensionesCm,
} from './medios';
import { enteroOpcional, textoOpcional, VitrinaError } from './rules';
import { registrarHistorial, type VitrinaActor } from './service';
import type { VitrinaImageStorage } from './storage';

/**
 * «Vitrina Comercial · Gestión» (V3): imágenes de empaque por presentación y vínculos
 * con documentos vigentes del SGC. Todo queda en vitrina_historial.
 */

async function presentacionDeEmpresa(db: VitrinaDb, idCompany: number, id: number) {
  const p = await db.vitrinaPresentacion.findFirst({ where: { id_presentacion: id, id_company: idCompany }, select: { id_presentacion: true, estado: true, destacada: true } });
  if (!p) throw new VitrinaError('La presentación no existe en esta empresa.', 404);
  return p;
}

export async function listarMedios(db: VitrinaDb, idCompany: number, idPresentacion: number) {
  const p = await presentacionDeEmpresa(db, idCompany, idPresentacion);
  const [imagenes, vinculos, modelos] = await Promise.all([
    db.vitrinaImagen.findMany({ where: { id_presentacion: idPresentacion }, orderBy: { id_imagen: 'desc' }, take: 60 }),
    db.vitrinaDocumento.findMany({ where: { id_presentacion: idPresentacion }, orderBy: { id_vitrina_documento: 'asc' } }),
    db.vitrinaModelo3d.findMany({ where: { id_presentacion: idPresentacion }, orderBy: { id_modelo: 'desc' }, take: 30 }),
  ]);
  const docs = vinculos.length
    ? await db.sgcDocument.findMany({
        where: { id_document: { in: [...new Set(vinculos.map((v) => v.id_document))] } },
        select: { id_document: true, id_company: true, code: true, title: true, status: true, current_version_id: true, confidentiality: true },
      })
    : [];
  const porId = new Map(docs.map((d) => [d.id_document, d]));
  return {
    destacada: p.destacada,
    estado: p.estado,
    imagenes: VITRINA_IMAGEN_TIPOS.map((tipo) => {
      const delTipo = imagenes.filter((i) => i.tipo === tipo);
      const vigente = delTipo.find((i) => i.vigente) ?? null;
      return {
        tipo,
        vigente: vigente ? { id: vigente.id_imagen, version: vigente.version, cargadoEn: vigente.cargado_en.toISOString() } : null,
        anteriores: delTipo.filter((i) => !i.vigente).length,
      };
    }),
    modelo3d: resumenModelos3d(modelos),
    documentos: vinculos.map((v) => {
      const d = porId.get(v.id_document);
      const mostrable = !!d && d.id_company === idCompany && documentoSgcMostrable(d);
      return {
        id: v.id_vitrina_documento,
        tipo: v.tipo,
        idioma: v.idioma,
        pais: v.pais,
        idDocument: v.id_document,
        codigo: d?.code ?? null,
        titulo: d?.title ?? null,
        estadoSgc: d?.status ?? null,
        mostrable,
        motivo: mostrable ? null : !d ? 'El documento ya no existe en el SGC.' : d.status !== 'vigente' ? `En el SGC está «${d.status}»: no se muestra.` : 'No se puede mostrar (sin versión vigente o confidencial).',
      };
    }),
  };
}

export async function cargarImagen(
  db: VitrinaDb,
  storage: VitrinaImageStorage,
  actor: VitrinaActor,
  input: { idPresentacion: number | null; tipo: unknown; contenido: Uint8Array }
) {
  if (!input.idPresentacion) throw new VitrinaError('Elija la presentación.', 400);
  if (!esTipoImagen(input.tipo)) throw new VitrinaError(`Tipo de imagen no válido: use ${VITRINA_IMAGEN_TIPOS.join(', ')}.`, 400);
  const tipo = input.tipo;
  const formato = validarImagen(input.contenido);
  const p = await presentacionDeEmpresa(db, actor.idCompany, input.idPresentacion);
  if (p.estado === 'RETIRADA') throw new VitrinaError('La presentación está retirada.', 409);
  const previas = await db.vitrinaImagen.findMany({ where: { id_presentacion: p.id_presentacion, tipo }, select: { version: true } });
  const version = siguienteVersion(previas.map((x) => x.version));
  // Primero el almacenamiento (externo, no transaccional) y luego la base, como el chat y el SGC.
  const item = await storage.subir(actor.idCompany, p.id_presentacion, nombreArchivoImagen(tipo, version, randomUUID(), formato.ext), input.contenido, formato.mime);
  return db.$transaction(async (tx) => {
    await tx.vitrinaImagen.updateMany({ where: { id_presentacion: p.id_presentacion, tipo, vigente: true }, data: { vigente: false } });
    const img = await tx.vitrinaImagen.create({
      data: { id_presentacion: p.id_presentacion, tipo, ruta_archivo: item.id, version: String(version), vigente: true, cargado_por: actor.idUser },
    });
    await registrarHistorial(tx, {
      idCompany: actor.idCompany,
      entidad: 'imagen',
      idEntidad: img.id_imagen,
      accion: 'CARGAR',
      nuevo: { id_presentacion: p.id_presentacion, tipo, version, bytes: input.contenido.length, formato: formato.mime },
      idUser: actor.idUser,
    });
    return { id: img.id_imagen, tipo, version };
  });
}

/** Retira una imagen (deja de ser vigente). El archivo se conserva en el almacenamiento por trazabilidad. */
export async function retirarImagen(db: VitrinaDb, actor: VitrinaActor, idImagen: number) {
  const img = await db.vitrinaImagen.findFirst({ where: { id_imagen: idImagen, presentacion: { id_company: actor.idCompany } } });
  if (!img) throw new VitrinaError('La imagen no existe en esta empresa.', 404);
  if (!img.vigente) return { id: idImagen, cambios: 0 };
  return db.$transaction(async (tx) => {
    await tx.vitrinaImagen.update({ where: { id_imagen: idImagen }, data: { vigente: false } });
    await registrarHistorial(tx, { idCompany: actor.idCompany, entidad: 'imagen', idEntidad: idImagen, accion: 'RETIRAR', anterior: { vigente: true, tipo: img.tipo, version: img.version, id_presentacion: img.id_presentacion }, nuevo: { vigente: false }, idUser: actor.idUser });
    return { id: idImagen, cambios: 1 };
  });
}

/** Documentos VIGENTES del SGC de la empresa, por código o título (no confidenciales). */
export async function buscarDocumentosSgc(db: VitrinaDb, idCompany: number, q: string | null) {
  const t = (q ?? '').trim().slice(0, 100);
  if (t.length < 2) return { documentos: [], sgcActivo: true };
  const [config, docs] = await Promise.all([
    db.sgcCompanyConfig.findUnique({ where: { id_company: idCompany }, select: { is_active: true } }),
    db.sgcDocument.findMany({
      where: {
        id_company: idCompany,
        status: 'vigente',
        current_version_id: { not: null },
        confidentiality: { not: 'confidencial' },
        OR: [{ code: { contains: t } }, { title: { contains: t } }],
      },
      select: { id_document: true, code: true, title: true, documentType: { select: { name: true } } },
      orderBy: { code: 'asc' },
      take: 30,
    }),
  ]);
  return { sgcActivo: Boolean(config?.is_active), documentos: docs.map((d) => ({ idDocument: d.id_document, codigo: d.code, titulo: d.title, tipoDocumental: d.documentType.name })) };
}

export interface VinculoInput {
  id_presentacion?: unknown;
  id_document?: unknown;
  tipo?: unknown;
  idioma?: unknown;
  pais?: unknown;
}

export async function vincularDocumento(db: VitrinaDb, actor: VitrinaActor, body: VinculoInput) {
  const idPresentacion = enteroOpcional(body.id_presentacion, 'Presentación', 1, 2_000_000_000);
  const idDocument = enteroOpcional(body.id_document, 'Documento del SGC', 1, 2_000_000_000);
  if (!idPresentacion) throw new VitrinaError('Elija la presentación.', 400);
  if (!idDocument) throw new VitrinaError('Elija el documento del SGC.', 400);
  if (!esTipoDocumento(body.tipo)) throw new VitrinaError(`Tipo no válido: use ${VITRINA_DOCUMENTO_TIPOS.join(', ')}.`, 400);
  const tipo = body.tipo;
  const idioma = idiomaDocumento(body.idioma);
  const pais = textoOpcional(body.pais, VITRINA_LIMITS.pais, 'País');
  await presentacionDeEmpresa(db, actor.idCompany, idPresentacion);
  const doc = await db.sgcDocument.findFirst({
    where: { id_document: idDocument, id_company: actor.idCompany },
    select: { id_document: true, code: true, status: true, current_version_id: true, confidentiality: true },
  });
  if (!doc) throw new VitrinaError('El documento no existe en el SGC de esta empresa.', 404);
  if (!documentoSgcMostrable(doc)) throw new VitrinaError(`El documento ${doc.code} no está vigente en el SGC (o es confidencial): no se puede vincular.`, 409);
  return db.$transaction(async (tx) => {
    const dup = await tx.vitrinaDocumento.findFirst({ where: { id_presentacion: idPresentacion, id_document: idDocument, tipo } });
    if (dup) throw new VitrinaError(`${doc.code} ya está vinculado como ${tipo.toLowerCase()}.`, 409);
    const v = await tx.vitrinaDocumento.create({ data: { id_presentacion: idPresentacion, id_document: idDocument, tipo, idioma, pais, vinculado_por: actor.idUser } });
    await registrarHistorial(tx, { idCompany: actor.idCompany, entidad: 'documento', idEntidad: v.id_vitrina_documento, accion: 'VINCULAR', nuevo: { id_presentacion: idPresentacion, id_document: idDocument, codigo: doc.code, tipo, idioma, pais }, idUser: actor.idUser });
    return { id: v.id_vitrina_documento };
  });
}

export async function desvincularDocumento(db: VitrinaDb, actor: VitrinaActor, id: number) {
  const v = await db.vitrinaDocumento.findFirst({ where: { id_vitrina_documento: id, presentacion: { id_company: actor.idCompany } } });
  if (!v) throw new VitrinaError('El vínculo no existe en esta empresa.', 404);
  return db.$transaction(async (tx) => {
    await tx.vitrinaDocumento.delete({ where: { id_vitrina_documento: id } });
    await registrarHistorial(tx, {
      idCompany: actor.idCompany,
      entidad: 'documento',
      idEntidad: id,
      accion: 'DESVINCULAR',
      anterior: { id_presentacion: v.id_presentacion, id_document: v.id_document, tipo: v.tipo, idioma: v.idioma, pais: v.pais },
      idUser: actor.idUser,
    });
    return { id };
  });
}

// ---------------------------------------------------------------------------
// Modelo 3D (GLB) — 2026-11-04
// ---------------------------------------------------------------------------

type DecimalCol = { toString(): string } | number | null;
interface FilaModelo3d {
  id_modelo: number;
  version: number;
  vigente: boolean;
  nombre_original: string;
  tamano_bytes: number;
  ancho_cm: DecimalCol;
  alto_cm: DecimalCol;
  profundo_cm: DecimalCol;
  cargado_en: Date;
}

const cm = (v: DecimalCol): number | null => (v === null || v === undefined ? null : Number(v.toString()));

/** Lo que ve Gestión: el modelo vigente (el de id mayor) y cuántos anteriores hay. */
export function resumenModelos3d(modelos: readonly FilaModelo3d[]) {
  const vig = [...modelos].filter((m) => m.vigente).sort((a, b) => b.id_modelo - a.id_modelo)[0] ?? null;
  return {
    vigente: vig
      ? {
          id: vig.id_modelo,
          version: vig.version,
          nombreOriginal: vig.nombre_original,
          tamanoBytes: vig.tamano_bytes,
          cargadoEn: vig.cargado_en.toISOString(),
          dimensionesCm: { ancho: cm(vig.ancho_cm), alto: cm(vig.alto_cm), profundo: cm(vig.profundo_cm) },
        }
      : null,
    anteriores: modelos.filter((m) => !m.vigente).length,
  };
}

const dimsData = (d: DimensionesCm) => ({ ancho_cm: d.ancho, alto_cm: d.alto, profundo_cm: d.profundo });

/**
 * Carga (o REEMPLAZA) el modelo 3D de una presentación. Valida el GLB por contenido; primero el
 * almacenamiento de adjuntos (mismo que las imágenes) y luego la base: el anterior vigente pasa
 * a no vigente y queda en vitrina_historial (CARGAR o REEMPLAZAR).
 */
export async function cargarModelo3d(
  db: VitrinaDb,
  storage: VitrinaImageStorage,
  actor: VitrinaActor,
  input: { idPresentacion: number | null; contenido: Uint8Array; nombreOriginal?: unknown; ancho_cm?: unknown; alto_cm?: unknown; profundo_cm?: unknown }
) {
  if (!input.idPresentacion) throw new VitrinaError('Elija la presentación.', 400);
  validarModelo3d(input.contenido);
  const dims = dimensionesCm(input);
  const nombreOriginal = nombreOriginalModelo3d(input.nombreOriginal);
  const p = await presentacionDeEmpresa(db, actor.idCompany, input.idPresentacion);
  if (p.estado === 'RETIRADA') throw new VitrinaError('La presentación está retirada.', 409);
  const previos = await db.vitrinaModelo3d.findMany({ where: { id_presentacion: p.id_presentacion }, select: { id_modelo: true, version: true, vigente: true } });
  const version = siguienteVersion(previos.map((x) => String(x.version)));
  const anterior = previos.filter((x) => x.vigente).sort((a, b) => b.id_modelo - a.id_modelo)[0] ?? null;
  const item = await storage.subir(actor.idCompany, p.id_presentacion, nombreArchivoModelo3d(version, randomUUID()), input.contenido, VITRINA_MODELO3D_MIME);
  return db.$transaction(async (tx) => {
    await tx.vitrinaModelo3d.updateMany({ where: { id_presentacion: p.id_presentacion, vigente: true }, data: { vigente: false } });
    const m = await tx.vitrinaModelo3d.create({
      data: {
        id_presentacion: p.id_presentacion,
        ruta_archivo: item.id,
        nombre_original: nombreOriginal,
        tamano_bytes: input.contenido.length,
        version,
        vigente: true,
        ...dimsData(dims),
        cargado_por: actor.idUser,
      },
    });
    await registrarHistorial(tx, {
      idCompany: actor.idCompany,
      entidad: 'modelo_3d',
      idEntidad: m.id_modelo,
      accion: anterior ? 'REEMPLAZAR' : 'CARGAR',
      anterior: anterior ? { id_modelo: anterior.id_modelo, version: anterior.version, vigente: true } : undefined,
      nuevo: { id_presentacion: p.id_presentacion, version, bytes: input.contenido.length, nombre: nombreOriginal, formato: VITRINA_MODELO3D_MIME, dimensiones_cm: dims },
      idUser: actor.idUser,
    });
    return { id: m.id_modelo, version, reemplazo: anterior?.id_modelo ?? null };
  });
}

async function modeloDeEmpresa(db: VitrinaDb, idCompany: number, idModelo: number) {
  const m = await db.vitrinaModelo3d.findFirst({ where: { id_modelo: idModelo, presentacion: { id_company: idCompany } } });
  if (!m) throw new VitrinaError('El modelo 3D no existe en esta empresa.', 404);
  return m;
}

/** Retira el modelo (deja de mostrarse). El archivo se conserva en el almacenamiento por trazabilidad. */
export async function retirarModelo3d(db: VitrinaDb, actor: VitrinaActor, idModelo: number) {
  const m = await modeloDeEmpresa(db, actor.idCompany, idModelo);
  if (!m.vigente) return { id: idModelo, cambios: 0 };
  return db.$transaction(async (tx) => {
    await tx.vitrinaModelo3d.update({ where: { id_modelo: idModelo }, data: { vigente: false } });
    await registrarHistorial(tx, {
      idCompany: actor.idCompany,
      entidad: 'modelo_3d',
      idEntidad: idModelo,
      accion: 'RETIRAR',
      anterior: { vigente: true, version: m.version, id_presentacion: m.id_presentacion },
      nuevo: { vigente: false },
      idUser: actor.idUser,
    });
    return { id: idModelo, cambios: 1 };
  });
}

/** Cambia las medidas opcionales (cm) del modelo vigente. */
export async function editarDimensionesModelo3d(db: VitrinaDb, actor: VitrinaActor, idModelo: number, body: { ancho_cm?: unknown; alto_cm?: unknown; profundo_cm?: unknown }) {
  const dims = dimensionesCm(body);
  const m = await modeloDeEmpresa(db, actor.idCompany, idModelo);
  if (!m.vigente) throw new VitrinaError('El modelo 3D ya no está vigente.', 409);
  const antes = { ancho: cm(m.ancho_cm), alto: cm(m.alto_cm), profundo: cm(m.profundo_cm) };
  if (antes.ancho === dims.ancho && antes.alto === dims.alto && antes.profundo === dims.profundo) return { id: idModelo, cambios: 0 };
  return db.$transaction(async (tx) => {
    await tx.vitrinaModelo3d.update({ where: { id_modelo: idModelo }, data: dimsData(dims) });
    await registrarHistorial(tx, { idCompany: actor.idCompany, entidad: 'modelo_3d', idEntidad: idModelo, accion: 'EDITAR', anterior: { dimensiones_cm: antes }, nuevo: { dimensiones_cm: dims }, idUser: actor.idUser });
    return { id: idModelo, cambios: 1 };
  });
}
