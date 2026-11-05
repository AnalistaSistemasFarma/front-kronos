/**
 * MATRICES de un proyecto — acceso a la base (2026-11-05). Reglas puras en ./matrices-rules.ts,
 * lectura de libros en ./matrices-excel.ts, diseño en docs/proyectos-matrices-dashboards.md.
 *
 * Permisos = los del PROYECTO (decisión de Nicolás Rivera): ve cualquier miembro; suben y
 * archivan dueño y editores (`contribute`); los agentes designados leen todas las matrices.
 *
 * A los agentes les llegan SIN cambiar el puente de hilos: el contexto del proyecto agrega
 * a su lista de archivos un CSV por hoja y una ficha por matriz (archivosParaAgente), y el
 * puente los baja como cualquier archivo del proyecto cuando cambia la versión.
 */
import { prisma } from '../prisma';
import { capabilitiesFor } from '../chat/projects-rules';
import type { ProjectAccess, ProjectUser } from '../chat/projects';
import { ProyectoError } from './acciones';
import { leerLibro } from './matrices-excel';
import {
  consultarFilas,
  fichaHoja,
  fichaMarkdown,
  hojaACsv,
  MATRIZ_FILAS_POR_BLOQUE,
  MAX_NOMBRE_MATRIZ,
  nombreDesdeArchivo,
  resumenCambios,
  aplicarEdicion,
  type EdicionHoja,
  type HojaMatriz,
  validarLibro,
  type Celda,
  type ColumnaMatriz,
  type ConsultaGrilla,
} from './matrices-rules';

export const MAX_MATRICES_PROYECTO = 30;
export const MAX_BYTES_MATRIZ = 25 * 1024 * 1024;

function exigirContribuir(project: ProjectAccess) {
  if (project.archived) throw new ProyectoError('El proyecto está archivado. Restáurelo para hacer cambios.', 403);
  if (!capabilitiesFor(project.role).contribute) throw new ProyectoError('Su rol en el proyecto no permite subir matrices.', 403);
}

/** Filas de una hoja, armadas desde sus bloques. */
export async function filasDeHoja(idSheet: number): Promise<Celda[][]> {
  const bloques = await prisma.chatProjectMatrixChunk.findMany({
    where: { id_sheet: idSheet },
    orderBy: { chunk_no: 'asc' },
  });
  return bloques.flatMap((b) => JSON.parse(b.rows_json) as Celda[][]);
}

function columnasDe(json: string): ColumnaMatriz[] {
  return JSON.parse(json) as ColumnaMatriz[];
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Escribe las hojas de una versión: columnas y filas en bloques de MATRIZ_FILAS_POR_BLOQUE. */
async function escribirHojas(tx: Tx, idVersion: number, hojas: HojaMatriz[]) {
  for (const [i, h] of hojas.entries()) {
    const hoja = await tx.chatProjectMatrixSheet.create({
      data: {
        id_version: idVersion,
        sheet_index: i,
        name: h.nombre,
        header_row: h.filaEncabezados,
        columns_json: JSON.stringify(h.columnas),
        row_count: h.filas.length,
      },
      select: { id_sheet: true },
    });
    const bloques = [];
    for (let b = 0; b * MATRIZ_FILAS_POR_BLOQUE < h.filas.length; b += 1) {
      bloques.push({
        id_sheet: hoja.id_sheet,
        chunk_no: b,
        rows_json: JSON.stringify(h.filas.slice(b * MATRIZ_FILAS_POR_BLOQUE, (b + 1) * MATRIZ_FILAS_POR_BLOQUE)),
      });
    }
    if (bloques.length > 0) await tx.chatProjectMatrixChunk.createMany({ data: bloques });
  }
}

/**
 * Sube una matriz nueva (sin idMatrix) o una VERSIÓN nueva de una existente.
 * `autor`: la persona (id de usuario) o el agente (idAgent) que la sube.
 */
export async function subirMatriz(
  project: ProjectAccess,
  autor: { idUser: string } | { idAgent: number },
  entrada: {
    fileName: string;
    bytes: Uint8Array;
    idMatrix?: number | null;
    nombre?: string | null;
    descripcion?: string | null;
    filaEncabezados?: number | null;
  }
): Promise<{
  idMatrix: number;
  idVersion: number;
  versionNo: number;
  resumen: string;
}> {
  if (entrada.bytes.byteLength > MAX_BYTES_MATRIZ) throw new ProyectoError('El archivo pasa de 25 MB.', 400);
  const libro = await leerLibro(entrada.fileName, entrada.bytes, entrada.filaEncabezados ?? undefined);
  if (!libro.ok) throw new ProyectoError(libro.error, 400);
  const error = validarLibro(libro.hojas);
  if (error) throw new ProyectoError(error, 400);

  let previa: { nombre: string; filas: number }[] | null = null;
  let idMatrix = entrada.idMatrix ?? null;
  if (idMatrix) {
    const m = await prisma.chatProjectMatrix.findFirst({
      where: {
        id_matrix: idMatrix,
        id_project: project.idProject,
        archived: false,
      },
      select: { id_version_actual: true },
    });
    if (!m) throw new ProyectoError('Matriz no encontrada.', 404);
    if (m.id_version_actual) {
      previa = (
        await prisma.chatProjectMatrixSheet.findMany({
          where: { id_version: m.id_version_actual },
          select: { name: true, row_count: true },
        })
      ).map((h) => ({ nombre: h.name, filas: h.row_count }));
    }
  } else {
    const n = await prisma.chatProjectMatrix.count({
      where: { id_project: project.idProject, archived: false },
    });
    if (n >= MAX_MATRICES_PROYECTO) throw new ProyectoError(`Un proyecto admite máximo ${MAX_MATRICES_PROYECTO} matrices.`, 409);
  }

  const resumen = resumenCambios(
    previa,
    libro.hojas.map((h) => ({ nombre: h.nombre, filas: h.filas.length }))
  );
  const ahora = new Date();
  const idUser = 'idUser' in autor ? autor.idUser : null;
  const idAgent = 'idAgent' in autor ? autor.idAgent : null;
  const nombre = (entrada.nombre?.replace(/\s+/g, ' ').trim() || nombreDesdeArchivo(entrada.fileName)).slice(0, MAX_NOMBRE_MATRIZ);

  return prisma.$transaction(
    async (tx) => {
      if (!idMatrix) {
        const m = await tx.chatProjectMatrix.create({
          data: {
            id_project: project.idProject,
            name: nombre,
            description: entrada.descripcion?.trim().slice(0, 1000) || null,
            created_by: idUser,
            created_at: ahora,
            updated_at: ahora,
          },
          select: { id_matrix: true },
        });
        idMatrix = m.id_matrix;
      }
      const ultima = await tx.chatProjectMatrixVersion.findFirst({
        where: { id_matrix: idMatrix },
        orderBy: { version_no: 'desc' },
        select: { version_no: true },
      });
      const versionNo = (ultima?.version_no ?? 0) + 1;
      const v = await tx.chatProjectMatrixVersion.create({
        data: {
          id_matrix: idMatrix,
          version_no: versionNo,
          file_name: entrada.fileName.slice(0, 400),
          size_bytes: entrada.bytes.byteLength,
          uploaded_by: idUser,
          id_agent: idAgent,
          summary: resumen.slice(0, 1000),
          created_at: ahora,
        },
        select: { id_version: true },
      });
      await escribirHojas(tx, v.id_version, libro.hojas);
      await tx.chatProjectMatrix.update({
        where: { id_matrix: idMatrix },
        data: {
          id_version_actual: v.id_version,
          updated_at: ahora,
          ...(entrada.nombre ? { name: nombre } : {}),
        },
      });
      // Cambia la «versión» del proyecto: el puente de cada agente vuelve a sincronizar.
      await tx.chatProject.update({
        where: { id_project: project.idProject },
        data: { updated_at: ahora },
      });
      return {
        idMatrix: idMatrix!,
        idVersion: v.id_version,
        versionNo,
        resumen,
      };
    },
    { timeout: 120_000, maxWait: 10_000 }
  );
}

/** Subida de una PERSONA (dueño o editor). */
export async function subirMatrizPersona(user: ProjectUser, project: ProjectAccess, entrada: Parameters<typeof subirMatriz>[2]) {
  exigirContribuir(project);
  return subirMatriz(project, { idUser: user.id }, entrada);
}

/**
 * EDITAR dentro de SynerLink (2026-11-05): aplica los cambios de UNA hoja sobre la versión
 * de base y guarda una VERSIÓN nueva (las demás hojas se copian iguales). Si alguien guardó
 * o subió otra versión mientras tanto, 409: no se pisa el trabajo de otra persona.
 */
export async function editarMatriz(
  user: ProjectUser,
  project: ProjectAccess,
  idMatrix: number,
  entrada: Record<string, unknown>
): Promise<{ idMatrix: number; idVersion: number; versionNo: number; resumen: string }> {
  exigirContribuir(project);
  const m = await matrizDelProyecto(project, idMatrix);
  if (!m.id_version_actual || Number(entrada.idVersionBase) !== m.id_version_actual) {
    throw new ProyectoError('Alguien guardó otra versión de esta matriz mientras usted editaba. Recargue y vuelva a hacer sus cambios.', 409);
  }
  const hojasBase = await prisma.chatProjectMatrixSheet.findMany({ where: { id_version: m.id_version_actual }, orderBy: { sheet_index: 'asc' } });
  const idx = Number(entrada.hoja);
  if (!Number.isInteger(idx) || idx < 0 || idx >= hojasBase.length) throw new ProyectoError('Hoja no encontrada.', 400);
  const edicion: EdicionHoja = {
    cambios: Array.isArray(entrada.cambios) ? (entrada.cambios as EdicionHoja['cambios']) : [],
    nuevas: Array.isArray(entrada.nuevas) ? (entrada.nuevas as string[][]).filter(Array.isArray) : [],
    borrar: Array.isArray(entrada.borrar) ? (entrada.borrar as number[]) : [],
  };
  const hojas: HojaMatriz[] = await Promise.all(
    hojasBase.map(async (h) => ({ nombre: h.name, filaEncabezados: h.header_row, columnas: columnasDe(h.columns_json), filas: await filasDeHoja(h.id_sheet) }))
  );
  const objetivo = hojas[idx];
  const r = aplicarEdicion(objetivo.columnas, objetivo.filas, edicion);
  if (!r.ok) throw new ProyectoError(r.error, 400);
  objetivo.filas = r.filas;
  const resumen = `Edición en SynerLink, hoja «${objetivo.nombre}»: ${r.resumen}.`;
  const ahora = new Date();

  return prisma.$transaction(
    async (tx) => {
      // Bloqueo optimista: solo una edición gana sobre la misma versión de base.
      const marca = await tx.chatProjectMatrix.updateMany({
        where: { id_matrix: m.id_matrix, id_version_actual: m.id_version_actual },
        data: { updated_at: ahora },
      });
      if (marca.count === 0) {
        throw new ProyectoError('Alguien guardó otra versión de esta matriz mientras usted editaba. Recargue y vuelva a hacer sus cambios.', 409);
      }
      const ultima = await tx.chatProjectMatrixVersion.findFirst({
        where: { id_matrix: m.id_matrix },
        orderBy: { version_no: 'desc' },
        select: { version_no: true },
      });
      const versionNo = (ultima?.version_no ?? 0) + 1;
      const v = await tx.chatProjectMatrixVersion.create({
        data: {
          id_matrix: m.id_matrix,
          version_no: versionNo,
          file_name: 'Edición en SynerLink',
          uploaded_by: user.id,
          summary: resumen.slice(0, 1000),
          created_at: ahora,
        },
        select: { id_version: true },
      });
      await escribirHojas(tx, v.id_version, hojas);
      await tx.chatProjectMatrix.update({ where: { id_matrix: m.id_matrix }, data: { id_version_actual: v.id_version, updated_at: ahora } });
      await tx.chatProject.update({ where: { id_project: project.idProject }, data: { updated_at: ahora } });
      return { idMatrix: m.id_matrix, idVersion: v.id_version, versionNo, resumen };
    },
    { timeout: 120_000, maxWait: 10_000 }
  );
}

async function nombresPersonas(ids: (string | null)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  if (unicos.length === 0) return new Map();
  const us = await prisma.user.findMany({
    where: { id: { in: unicos } },
    select: { id: true, name: true, email: true },
  });
  return new Map(us.map((u) => [u.id, u.name?.trim() || u.email]));
}

async function nombresAgentes(ids: (number | null)[]): Promise<Map<number, string>> {
  const unicos = [...new Set(ids.filter((x): x is number => x !== null))];
  if (unicos.length === 0) return new Map();
  const as = await prisma.agent.findMany({
    where: { id_agent: { in: unicos } },
    select: { id_agent: true, display_name: true },
  });
  return new Map(as.map((a) => [a.id_agent, a.display_name]));
}

/** Lista de matrices del proyecto (cualquier miembro). */
export async function listarMatrices(project: ProjectAccess) {
  const ms = await prisma.chatProjectMatrix.findMany({
    where: { id_project: project.idProject, archived: false },
    orderBy: { updated_at: 'desc' },
    include: {
      versiones: {
        orderBy: { version_no: 'desc' },
        take: 1,
        include: {
          hojas: {
            orderBy: { sheet_index: 'asc' },
            select: {
              id_sheet: true,
              name: true,
              row_count: true,
              columns_json: true,
            },
          },
        },
      },
    },
  });
  const personas = await nombresPersonas(ms.map((m) => m.versiones[0]?.uploaded_by ?? null));
  const agentes = await nombresAgentes(ms.map((m) => m.versiones[0]?.id_agent ?? null));
  return ms.map((m) => {
    const v = m.versiones[0];
    return {
      idMatrix: m.id_matrix,
      nombre: m.name,
      descripcion: m.description,
      version: v?.version_no ?? 0,
      archivo: v?.file_name ?? null,
      actualizada: (v?.created_at ?? m.updated_at).toISOString(),
      subidaPor: v ? (v.id_agent ? `${agentes.get(v.id_agent) ?? 'Agente'} (agente)` : (personas.get(v.uploaded_by ?? '') ?? null)) : null,
      hojas: (v?.hojas ?? []).map((h) => ({
        idSheet: h.id_sheet,
        nombre: h.name,
        filas: h.row_count,
        columnas: columnasDe(h.columns_json).length,
      })),
    };
  });
}

async function matrizDelProyecto(project: ProjectAccess, idMatrix: number) {
  const m = await prisma.chatProjectMatrix.findFirst({
    where: {
      id_matrix: idMatrix,
      id_project: project.idProject,
      archived: false,
    },
  });
  if (!m) throw new ProyectoError('Matriz no encontrada.', 404);
  return m;
}

/** Detalle: versiones, hojas de la versión vigente (o la pedida) y una página de la hoja elegida. */
export async function detalleMatriz(
  project: ProjectAccess,
  idMatrix: number,
  opciones: { idVersion?: number; hoja?: number } & ConsultaGrilla
) {
  const m = await matrizDelProyecto(project, idMatrix);
  const versiones = await prisma.chatProjectMatrixVersion.findMany({
    where: { id_matrix: m.id_matrix },
    orderBy: { version_no: 'desc' },
    select: {
      id_version: true,
      version_no: true,
      file_name: true,
      uploaded_by: true,
      id_agent: true,
      summary: true,
      created_at: true,
    },
  });
  const idVersion =
    opciones.idVersion && versiones.some((v) => v.id_version === opciones.idVersion) ? opciones.idVersion : m.id_version_actual;
  const hojas = idVersion
    ? await prisma.chatProjectMatrixSheet.findMany({
        where: { id_version: idVersion },
        orderBy: { sheet_index: 'asc' },
      })
    : [];
  const hoja = hojas[Math.min(Math.max(opciones.hoja ?? 0, 0), Math.max(hojas.length - 1, 0))] ?? null;
  const columnas = hoja ? columnasDe(hoja.columns_json) : [];
  const filas = hoja ? await filasDeHoja(hoja.id_sheet) : [];
  const pagina = consultarFilas(filas, opciones);
  const personas = await nombresPersonas(versiones.map((v) => v.uploaded_by));
  const agentes = await nombresAgentes(versiones.map((v) => v.id_agent));
  return {
    idMatrix: m.id_matrix,
    nombre: m.name,
    descripcion: m.description,
    idVersion,
    /** Versión vigente: la base de una edición (si se mira una vieja, no se edita). */
    idVersionActual: m.id_version_actual,
    versiones: versiones.map((v) => ({
      idVersion: v.id_version,
      version: v.version_no,
      archivo: v.file_name,
      subidaPor: v.id_agent ? `${agentes.get(v.id_agent) ?? 'Agente'} (agente)` : (personas.get(v.uploaded_by ?? '') ?? null),
      resumen: v.summary,
      fecha: v.created_at.toISOString(),
    })),
    hojas: hojas.map((h) => ({
      idSheet: h.id_sheet,
      nombre: h.name,
      filas: h.row_count,
    })),
    hoja: hoja
      ? {
          idSheet: hoja.id_sheet,
          nombre: hoja.name,
          filaEncabezados: hoja.header_row,
        }
      : null,
    columnas,
    ficha: hoja ? fichaHoja(columnas, filas) : [],
    ...pagina,
  };
}

/** Todas las hojas de una versión (para exportar a Excel). */
export async function hojasDeVersion(project: ProjectAccess, idMatrix: number, idVersion?: number) {
  const m = await matrizDelProyecto(project, idMatrix);
  const id = idVersion ?? m.id_version_actual;
  if (!id) throw new ProyectoError('La matriz no tiene versiones.', 404);
  const v = await prisma.chatProjectMatrixVersion.findFirst({
    where: { id_version: id, id_matrix: m.id_matrix },
    select: { version_no: true },
  });
  if (!v) throw new ProyectoError('Versión no encontrada.', 404);
  const hojas = await prisma.chatProjectMatrixSheet.findMany({
    where: { id_version: id },
    orderBy: { sheet_index: 'asc' },
  });
  return {
    nombre: m.name,
    version: v.version_no,
    hojas: await Promise.all(
      hojas.map(async (h) => ({
        nombre: h.name,
        columnas: columnasDe(h.columns_json),
        filas: await filasDeHoja(h.id_sheet),
      }))
    ),
  };
}

/** Archiva (no borra): deja de verse y deja de llegarle a los agentes. */
export async function archivarMatriz(project: ProjectAccess, idMatrix: number) {
  exigirContribuir(project);
  const m = await matrizDelProyecto(project, idMatrix);
  const ahora = new Date();
  await prisma.$transaction([
    prisma.chatProjectMatrix.update({
      where: { id_matrix: m.id_matrix },
      data: { archived: true, updated_at: ahora },
    }),
    prisma.chatProject.update({
      where: { id_project: project.idProject },
      data: { updated_at: ahora },
    }),
  ]);
  return { ok: true as const };
}

/* ───────────────────────────── Para los agentes ───────────────────────────── */

/** Nombre de archivo seguro para la carpeta del agente. */
function nombreArchivo(t: string): string {
  return t
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * «Archivos virtuales» de las matrices para el contexto del puente: por cada matriz, una
 * FICHA (.md) y un CSV por hoja de la versión vigente. El id lleva la versión, así que una
 * versión nueva reemplaza los archivos viejos en la carpeta del agente.
 */
export async function archivosParaAgente(idProject: number) {
  const ms = await prisma.chatProjectMatrix.findMany({
    where: {
      id_project: idProject,
      archived: false,
      id_version_actual: { not: null },
    },
    select: { name: true, id_version_actual: true },
    orderBy: { id_matrix: 'asc' },
  });
  if (ms.length === 0) return [];
  const hojas = await prisma.chatProjectMatrixSheet.findMany({
    where: { id_version: { in: ms.map((m) => m.id_version_actual!) } },
    select: { id_sheet: true, id_version: true, name: true, row_count: true },
    orderBy: [{ id_version: 'asc' }, { sheet_index: 'asc' }],
  });
  const out: {
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number | null;
    downloadUrl: string;
  }[] = [];
  for (const m of ms) {
    const base = nombreArchivo(`MATRIZ ${m.name}`);
    out.push({
      id: `mf${m.id_version_actual}`,
      fileName: `${base} - ficha.md`,
      contentType: 'text/markdown; charset=utf-8',
      sizeBytes: null,
      downloadUrl: `/api/chat/agent/projects/matrices/ficha-${m.id_version_actual}`,
    });
    for (const h of hojas.filter((x) => x.id_version === m.id_version_actual)) {
      out.push({
        id: `mh${h.id_sheet}`,
        fileName: `${base} - ${nombreArchivo(h.name)}.csv`,
        contentType: 'text/csv; charset=utf-8',
        sizeBytes: null,
        downloadUrl: `/api/chat/agent/projects/matrices/hoja-${h.id_sheet}`,
      });
    }
  }
  return out;
}

/** Nombre del CSV de una hoja (el mismo que lista archivosParaAgente, sin el prefijo de id). */
function nombreCsv(matriz: string, hoja: string) {
  return `${nombreArchivo(`MATRIZ ${matriz}`)} - ${nombreArchivo(hoja)}.csv`;
}

/**
 * Contenido para el agente: `hoja-<idSheet>` (CSV) o `ficha-<idVersion>` (Markdown).
 * `whereProyecto` = el ancla de seguridad del agente (proyecto activo donde está
 * designado, en empresas donde está habilitado). Null si no le corresponde.
 */
export async function contenidoParaAgente(
  ref: string,
  whereProyecto: Record<string, unknown>
): Promise<{ tipo: string; nombre: string; texto: string } | null> {
  const mh = /^hoja-(\d+)$/.exec(ref);
  const mf = /^ficha-(\d+)$/.exec(ref);
  if (mh) {
    const h = await prisma.chatProjectMatrixSheet.findFirst({
      where: {
        id_sheet: Number(mh[1]),
        version: { matrix: { archived: false, project: whereProyecto } },
      },
      include: {
        version: {
          select: {
            id_version: true,
            matrix: { select: { name: true, id_version_actual: true } },
          },
        },
      },
    });
    if (!h || h.version.matrix.id_version_actual !== h.version.id_version) return null;
    return {
      tipo: 'text/csv; charset=utf-8',
      nombre: nombreCsv(h.version.matrix.name, h.name),
      texto: hojaACsv(columnasDe(h.columns_json), await filasDeHoja(h.id_sheet)),
    };
  }
  if (mf) {
    const v = await prisma.chatProjectMatrixVersion.findFirst({
      where: {
        id_version: Number(mf[1]),
        matrix: { archived: false, project: whereProyecto },
      },
      include: {
        matrix: { select: { name: true } },
        hojas: { orderBy: { sheet_index: 'asc' } },
      },
    });
    if (!v) return null;
    const hojas = await Promise.all(
      v.hojas.map(async (h) => {
        const columnas = columnasDe(h.columns_json);
        // El puente antepone el id al nombre («mh12-…»): así lo encuentra el agente en su carpeta.
        return {
          nombre: h.name,
          filas: h.row_count,
          csv: `mh${h.id_sheet}-${nombreCsv(v.matrix.name, h.name)}`,
          ficha: fichaHoja(columnas, await filasDeHoja(h.id_sheet)),
        };
      })
    );
    return {
      tipo: 'text/markdown; charset=utf-8',
      nombre: `${nombreArchivo(`MATRIZ ${v.matrix.name}`)} - ficha.md`,
      texto: fichaMarkdown({
        matriz: v.matrix.name,
        version: v.version_no,
        archivo: v.file_name,
        fecha: v.created_at.toISOString().slice(0, 10),
        hojas,
      }),
    };
  }
  return null;
}
