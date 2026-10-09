/**
 * PORTAL DE TALENTO HUMANO — FORMACIÓN — FORMULARIO PROPIO (lado servidor).
 *
 * Lo que necesita la base: leer la versión vigente de un formulario, crear
 * uno nuevo o una versión nueva, armar la tabla de respuestas y el Excel.
 * Las reglas puras (validación de definición y respuestas) están en
 * `formulario.ts`, compartidas con el navegador.
 *
 * DATOS SENSIBLES (Ley 1581 de 2012): las respuestas NUNCA se escriben en los
 * logs. Los errores de estas rutas se registran con `registrarErrorSinDatos`,
 * que deja solo el nombre y el código del error: un error de Prisma puede
 * traer en su mensaje los argumentos de la consulta (es decir, las respuestas).
 */
import 'server-only';
import ExcelJS from 'exceljs';
import { prisma } from '../prisma';
import {
  NOTA_MINIMA_POR_DEFECTO,
  celdaSegura,
  columnasDeRespuestas,
  esEvaluacion,
  textoDeRespuesta,
  validarDefinicion,
  type DefinicionFormulario,
  type Respuestas,
  type RespuestaGuardada,
} from './formulario';

/** Registra un error SIN su mensaje ni sus datos (ver nota arriba). */
export function registrarErrorSinDatos(contexto: string, error: unknown): void {
  const e = (error ?? {}) as { name?: unknown; code?: unknown };
  const nombre = typeof e.name === 'string' ? e.name : 'Error';
  const codigo = typeof e.code === 'string' ? ` ${e.code}` : '';
  console.error(`[portal] ${contexto}: ${nombre}${codigo}`);
}

/** Parsea y valida una definición guardada. null si está dañada. */
export function leerDefinicion(json: string): DefinicionFormulario | null {
  try {
    const r = validarDefinicion(JSON.parse(json));
    return r.ok ? r.definicion : null;
  } catch {
    return null;
  }
}

/** Respuestas guardadas (JSON). Vacío si está dañado: nunca se lanza con su contenido. */
export function leerRespuestas(json: string): Respuestas {
  try {
    const r = JSON.parse(json) as unknown;
    return r && typeof r === 'object' && !Array.isArray(r) ? (r as Respuestas) : {};
  } catch {
    return {};
  }
}

export interface VersionVigente {
  formularioId: number;
  codigo: string;
  versionId: number;
  version: number;
  definicion: DefinicionFormulario;
}

/** La versión VIGENTE de un formulario (la que se responde). */
export async function versionVigente(formularioId: number): Promise<VersionVigente | null> {
  const f = await prisma.portalFormulario.findUnique({
    where: { id: formularioId },
    select: { id: true, codigo: true, version_actual: true },
  });
  if (!f) return null;
  const v = await prisma.portalFormularioVersion.findUnique({
    where: { formulario_id_version: { formulario_id: f.id, version: f.version_actual } },
    select: { id: true, version: true, definicion: true },
  });
  if (!v) return null;
  const definicion = leerDefinicion(v.definicion);
  if (!definicion) return null;
  return { formularioId: f.id, codigo: f.codigo, versionId: v.id, version: v.version, definicion };
}

/** Ya existe un formulario con ese código (se responde 409). */
export class CodigoDeFormularioRepetido extends Error {
  constructor(readonly codigo: string) {
    super(`Ya existe un formulario con el código ${codigo}.`);
    this.name = 'CodigoDeFormularioRepetido';
  }
}

/** Crea un formulario con su versión 1. */
export async function crearFormulario(definicion: DefinicionFormulario, creadoPor: string) {
  const existe = await prisma.portalFormulario.findUnique({ where: { codigo: definicion.codigo }, select: { id: true } });
  if (existe) throw new CodigoDeFormularioRepetido(definicion.codigo);
  return prisma.$transaction(async (tx) => {
    const f = await tx.portalFormulario.create({
      data: { codigo: definicion.codigo, titulo: definicion.titulo, version_actual: 1, created_by: creadoPor },
      select: { id: true, codigo: true, titulo: true, version_actual: true },
    });
    await tx.portalFormularioVersion.create({
      data: { formulario_id: f.id, version: 1, definicion: JSON.stringify(definicion), created_by: creadoPor },
    });
    return f;
  });
}

/**
 * Guarda una VERSIÓN NUEVA (editar = versión nueva; las anteriores no se
 * tocan y sus respuestas siguen apuntando a ellas). El código no cambia.
 */
export async function guardarVersionNueva(formularioId: number, definicion: DefinicionFormulario, por: string) {
  return prisma.$transaction(async (tx) => {
    const f = await tx.portalFormulario.findUnique({ where: { id: formularioId }, select: { id: true, codigo: true, version_actual: true } });
    if (!f) return null;
    if (f.codigo !== definicion.codigo) throw new CodigoDeFormularioRepetido(definicion.codigo);
    const ultima = await tx.portalFormularioVersion.aggregate({ where: { formulario_id: f.id }, _max: { version: true } });
    const version = (ultima._max.version ?? 0) + 1;
    await tx.portalFormularioVersion.create({
      data: { formulario_id: f.id, version, definicion: JSON.stringify(definicion), created_by: por },
    });
    return tx.portalFormulario.update({
      where: { id: f.id },
      data: { version_actual: version, titulo: definicion.titulo },
      select: { id: true, codigo: true, titulo: true, version_actual: true },
    });
  });
}

export interface TablaDeRespuestas {
  formulario: { id: number; codigo: string; titulo: string; version: number };
  /** true = evaluación: cada fila trae `nota` (%) e `intentos`. */
  evaluacion: boolean;
  notaMinima: number | null;
  columnas: { id: string; texto: string }[];
  filas: RespuestaGuardada[];
}

/** Respuestas de un material formulario, con las columnas para mostrarlas. */
export async function tablaDeRespuestas(materialId: number, formularioId: number): Promise<TablaDeRespuestas | null> {
  const vigente = await versionVigente(formularioId);
  if (!vigente) return null;
  const filas = await prisma.portalFormularioRespuesta.findMany({
    where: { material_id: materialId },
    orderBy: { enviada_at: 'asc' },
    select: {
      id: true,
      student_email: true,
      enviada_at: true,
      respuestas: true,
      autorizacion_version: true,
      autorizado_at: true,
      version: { select: { id: true, version: true, definicion: true } },
    },
  });
  const anteriores = new Map<number, DefinicionFormulario>();
  for (const f of filas) {
    if (f.version.id === vigente.versionId || anteriores.has(f.version.id)) continue;
    const d = leerDefinicion(f.version.definicion);
    if (d) anteriores.set(f.version.id, d);
  }

  // Evaluación: la nota de cada persona es la de su intento APROBADO (el que
  // creó la respuesta) y se cuentan todos sus intentos.
  const evaluacion = esEvaluacion(vigente.definicion);
  const porCorreo = new Map<string, { intentos: number; nota: number | null }>();
  if (evaluacion) {
    const intentos = await prisma.portalFormularioIntento.findMany({
      where: { material_id: materialId },
      orderBy: { enviado_at: 'asc' },
      select: { student_email: true, porcentaje: true, aprobado: true },
    });
    for (const i of intentos) {
      const acc = porCorreo.get(i.student_email) ?? { intentos: 0, nota: null };
      acc.intentos += 1;
      if (i.aprobado) acc.nota = i.porcentaje;
      porCorreo.set(i.student_email, acc);
    }
  }

  return {
    formulario: { id: vigente.formularioId, codigo: vigente.codigo, titulo: vigente.definicion.titulo, version: vigente.version },
    evaluacion,
    notaMinima: evaluacion ? (vigente.definicion.notaMinima ?? NOTA_MINIMA_POR_DEFECTO) : null,
    columnas: columnasDeRespuestas(vigente.definicion, [...anteriores.values()]),
    filas: filas.map((f) => ({
      id: f.id,
      correo: f.student_email,
      enviadaEl: f.enviada_at,
      version: f.version.version,
      autorizacionVersion: f.autorizacion_version,
      autorizadoEl: f.autorizado_at,
      respuestas: leerRespuestas(f.respuestas),
      ...(evaluacion
        ? { nota: porCorreo.get(f.student_email)?.nota ?? null, intentos: porCorreo.get(f.student_email)?.intentos ?? 1 }
        : {}),
    })),
  };
}

const fechaHora = (v: Date | string | null) => {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v) : v;
  // Hora de Colombia, que es como la lee Talento Humano.
  return d.toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: false });
};

/** El Excel de respuestas (una hoja; una fila por persona). */
export async function excelDeRespuestas(tabla: TablaDeRespuestas, curso: string): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'SynerLink — Portal de Talento Humano';
  libro.created = new Date();
  const hoja = libro.addWorksheet('Respuestas', { views: [{ state: 'frozen', ySplit: 1 }] });
  const fijas = ['Correo (sesión)', 'Enviado', 'Versión', 'Autorización de datos', 'Autorizado el'];
  if (tabla.evaluacion) fijas.push('Nota (%)', 'Intentos');
  hoja.addRow([...fijas, ...tabla.columnas.map((c, i) => `${i + 1}. ${c.texto}`)]);
  for (const f of tabla.filas) {
    hoja.addRow(
      [
        f.correo,
        fechaHora(f.enviadaEl),
        f.version,
        f.autorizacionVersion ?? '',
        fechaHora(f.autorizadoEl),
        ...(tabla.evaluacion ? [f.nota ?? '', f.intentos ?? ''] : []),
        ...tabla.columnas.map((c) => textoDeRespuesta(f.respuestas[c.id])),
      ].map((v) => (typeof v === 'string' ? celdaSegura(v) : v))
    );
  }
  const cabecera = hoja.getRow(1);
  cabecera.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cabecera.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3C6E' } };
  cabecera.alignment = { wrapText: true, vertical: 'top' };
  hoja.columns.forEach((col, i) => {
    col.width = i < fijas.length ? 22 : 28;
  });
  const info = libro.addWorksheet('Información');
  info.addRow(['Formulario', `${tabla.formulario.titulo} (${tabla.formulario.codigo})`]);
  info.addRow(['Curso', curso]);
  info.addRow(['Versión vigente', tabla.formulario.version]);
  info.addRow(['Respuestas', tabla.filas.length]);
  info.addRow(['Generado', fechaHora(new Date())]);
  info.addRow([
    'Aviso',
    'Contiene datos personales SENSIBLES (Ley 1581 de 2012). Uso exclusivo de Talento Humano y del SG-SST: no reenviar ni publicar.',
  ]);
  info.getColumn(1).width = 18;
  info.getColumn(2).width = 90;
  return Buffer.from(await libro.xlsx.writeBuffer());
}
