import 'server-only';
import { randomUUID } from 'node:crypto';
import type { VitrinaDb } from './access';
import { VITRINA_DOCUMENTO_TIPOS, VITRINA_IMAGEN_TIPOS, VITRINA_LIMITS } from './constants';
import { documentoSgcMostrable, esTipoDocumento, esTipoImagen, idiomaDocumento, nombreArchivoImagen, siguienteVersion, validarImagen } from './medios';
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
  const [imagenes, vinculos] = await Promise.all([
    db.vitrinaImagen.findMany({ where: { id_presentacion: idPresentacion }, orderBy: { id_imagen: 'desc' }, take: 60 }),
    db.vitrinaDocumento.findMany({ where: { id_presentacion: idPresentacion }, orderBy: { id_vitrina_documento: 'asc' } }),
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
