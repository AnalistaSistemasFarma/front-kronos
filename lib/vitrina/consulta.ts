import 'server-only';
import type { Prisma } from '../../app/generated/prisma';
import type { VitrinaDb } from './access';
import { armarCatalogo, itemDeCatalogo, type CatalogoItem, type VitrinaModo } from './catalogo';
import { documentoSgcMostrable } from './medios';
import { hoyColombia, VitrinaError } from './rules';

/**
 * Lecturas de los COMERCIALES (/process/vitrina, V3/V4). Solo lectura de las
 * tablas vitrina_* y de sgc.document; las reglas viven en catalogo.ts y rules.ts.
 * El modo presentación se arma en el SERVIDOR: lo interno nunca llega al navegador.
 */

const INCLUDE = {
  codigos: {
    select: {
      item_code: true,
      pais: true,
      canal: true,
      visibilidad_canal: true,
      activado_vitrina: true,
      activo_en_sap: true,
      registro_estado: true,
      registro_sanitario: true,
      registro_vence_en: true,
    },
  },
  areas: { select: { area: { select: { nombre: true, activa: true, orden: true } } } },
  imagenes: { where: { vigente: true }, select: { id_imagen: true, tipo: true, vigente: true } },
  exclusividades: { select: { cliente_beneficiario: true, pais: true, canal: true, alcance: true, vigente_desde: true, vigente_hasta: true } },
} satisfies Prisma.VitrinaPresentacionInclude;

/** Presentaciones candidatas: validadas y con al menos un código activado y activo en SAP. */
const candidatas = (idCompany: number): Prisma.VitrinaPresentacionWhereInput => ({
  id_company: idCompany,
  estado: 'VALIDADA',
  codigos: { some: { activado_vitrina: true, activo_en_sap: true } },
});

export async function listarCatalogo(db: VitrinaDb, idCompany: number, modo: VitrinaModo): Promise<CatalogoItem[]> {
  const filas = await db.vitrinaPresentacion.findMany({ where: candidatas(idCompany), include: INCLUDE });
  return armarCatalogo(filas, modo, hoyColombia());
}

export interface FichaDocumento {
  id: number;
  tipo: string;
  idioma: string | null;
  pais: string | null;
  idDocument: number;
  codigo: string;
  titulo: string;
  idVersion: number;
  version: number | null;
}

export interface Ficha extends CatalogoItem {
  documentos: FichaDocumento[];
}

/**
 * Documentos del SGC vinculados que se pueden mostrar HOY: el documento debe seguir
 * vigente en el SGC de la misma empresa, con versión vigente y no confidencial.
 */
export async function documentosMostrables(
  db: VitrinaDb,
  idCompany: number,
  vinculos: readonly { id_vitrina_documento: number; id_document: number; tipo: string; idioma: string | null; pais: string | null }[]
): Promise<FichaDocumento[]> {
  if (!vinculos.length) return [];
  const docs = await db.sgcDocument.findMany({
    where: { id_document: { in: [...new Set(vinculos.map((v) => v.id_document))] }, id_company: idCompany },
    select: { id_document: true, code: true, title: true, status: true, current_version_id: true, confidentiality: true },
  });
  const porId = new Map(docs.filter(documentoSgcMostrable).map((d) => [d.id_document, d]));
  const versionIds = [...porId.values()].map((d) => d.current_version_id as number);
  const versiones = versionIds.length
    ? await db.sgcDocumentVersion.findMany({ where: { id_document_version: { in: versionIds } }, select: { id_document_version: true, version_number: true, status: true } })
    : [];
  const vPorId = new Map(versiones.filter((v) => v.status === 'vigente').map((v) => [v.id_document_version, v.version_number]));
  const out: FichaDocumento[] = [];
  for (const v of vinculos) {
    const d = porId.get(v.id_document);
    if (!d || !vPorId.has(d.current_version_id as number)) continue;
    out.push({
      id: v.id_vitrina_documento,
      tipo: v.tipo,
      idioma: v.idioma,
      pais: v.pais,
      idDocument: d.id_document,
      codigo: d.code,
      titulo: d.title,
      idVersion: d.current_version_id as number,
      version: vPorId.get(d.current_version_id as number) ?? null,
    });
  }
  return out.sort((a, b) => a.tipo.localeCompare(b.tipo) || a.codigo.localeCompare(b.codigo));
}

/** Ficha (vista interna) de una presentación de la empresa; 404 si no está en la Vitrina. */
export async function obtenerFicha(db: VitrinaDb, idCompany: number, id: number): Promise<Ficha> {
  const fila = await db.vitrinaPresentacion.findFirst({
    where: { ...candidatas(idCompany), id_presentacion: id },
    include: { ...INCLUDE, documentos: { select: { id_vitrina_documento: true, id_document: true, tipo: true, idioma: true, pais: true } } },
  });
  const item = fila ? itemDeCatalogo(fila, 'interna', hoyColombia()) : null;
  if (!fila || !item) throw new VitrinaError('La presentación no está en la Vitrina de esta empresa.', 404);
  return { ...item, documentos: await documentosMostrables(db, idCompany, fila.documentos) };
}

/** Archivo de una imagen y la empresa dueña (para validar el permiso en la ruta). */
export async function imagenParaVer(db: VitrinaDb, idImagen: number): Promise<{ idCompany: number; itemId: string } | null> {
  const img = await db.vitrinaImagen.findUnique({ where: { id_imagen: idImagen }, select: { ruta_archivo: true, presentacion: { select: { id_company: true } } } });
  return img ? { idCompany: img.presentacion.id_company, itemId: img.ruta_archivo } : null;
}
