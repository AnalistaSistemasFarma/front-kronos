/**
 * PORTAL DE TALENTO HUMANO — FORMACIÓN.
 *
 * Reglas compartidas por las rutas de cursos: cómo se calcula el progreso de
 * un estudiante y cuándo se emite (o se reimprime) su certificado. Vive
 * aparte de las rutas API para que las dos —la de marcar un material como
 * completado y la que arma el detalle de un curso— calculen el mismo número
 * de la misma forma.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../prisma';
import { generarCertificadoPdf } from './certificado-pdf';
import { MATERIAL_MIMES_PERMITIDOS, maxMaterialBytes, mensajeArchivoMuyGrande } from './config';
import { PDFDocument } from 'pdf-lib';
import {
  carpetaDeCurso,
  crearSesionSubida,
  descargarArchivoFormacion,
  leerConfigFormacion,
  obtenerArchivoSubidoEnCarpeta,
  moverMaterialAEliminados,
  subirArchivoFormacion,
  type ArchivoEnSharePoint,
  type SesionSubida,
} from './formacion-storage';

/** Un material tal como lo necesita el cálculo de progreso. */
interface MaterialParaProgreso {
  id: number;
  required: boolean;
}

/**
 * % de avance de un estudiante en un curso.
 *
 * Solo cuentan los materiales OBLIGATORIOS: uno opcional (un enlace "para el
 * que quiera profundizar", por ejemplo) no debe bloquear el 100%. Si el curso
 * no tiene ningún material obligatorio, se considera completo de una vez —no
 * hay nada que le falte marcar a nadie.
 */
export function calcularProgreso(
  materiales: MaterialParaProgreso[],
  completadosIds: Set<number>
): { porcentaje: number; obligatoriosTotal: number; obligatoriosHechos: number } {
  const obligatorios = materiales.filter((m) => m.required);
  const obligatoriosTotal = obligatorios.length;
  if (obligatoriosTotal === 0) return { porcentaje: 100, obligatoriosTotal: 0, obligatoriosHechos: 0 };

  const obligatoriosHechos = obligatorios.filter((m) => completadosIds.has(m.id)).length;
  const porcentaje = Math.round((obligatoriosHechos / obligatoriosTotal) * 100);
  return { porcentaje, obligatoriosTotal, obligatoriosHechos };
}

/** Código de verificación del certificado: corto, legible, difícil de adivinar. */
function generarCodigo(): string {
  // 8 caracteres de un UUID, en mayúsculas: se puede transcribir a mano desde
  // un PDF impreso sin que sea una cadena de 36 caracteres imposible de leer.
  return `GSS-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/**
 * Si el estudiante llegó al 100% del curso, emite su certificado — o, si ya
 * tenía uno, devuelve el mismo sin tocarlo.
 *
 * NUNCA regenera uno existente con datos distintos: `student_name` y
 * `course_title` quedan congelados desde la primera vez, a propósito (ver la
 * migración). Se llama después de marcar (o desmarcar) un material.
 */
export async function emitirCertificadoSiCorresponde(params: {
  courseId: number;
  studentEmail: string;
  studentName: string;
  courseTitle: string;
  porcentaje: number;
}): Promise<{ code: string; issuedAt: Date } | null> {
  const { courseId, studentEmail, studentName, courseTitle, porcentaje } = params;
  if (porcentaje < 100) return null;

  const existente = await prisma.portalCertificate.findUnique({
    where: { course_id_student_email: { course_id: courseId, student_email: studentEmail } },
    select: { code: true, issued_at: true },
  });
  if (existente) return { code: existente.code, issuedAt: existente.issued_at };

  // Reintenta si por una coincidencia de 1 en muchos millones el código ya
  // existe — más barato que una transacción con reintento manual completo.
  for (let intento = 0; intento < 3; intento++) {
    try {
      const creado = await prisma.portalCertificate.create({
        data: {
          code: generarCodigo(),
          course_id: courseId,
          student_email: studentEmail,
          student_name: studentName,
          course_title: courseTitle,
        },
        select: { code: true, issued_at: true },
      });
      // Archiva el PDF en SharePoint (FORMACION/<curso>/certificados). Si
      // falla, el certificado YA está emitido y se puede descargar igual (se
      // genera al vuelo): el reintento ocurre la próxima vez que alguien lo
      // abra — ver `GET /api/portal/certificates/[code]`.
      await archivarCertificadoEnSharePoint(creado.code).catch((e) =>
        console.error('[portal] No se pudo archivar el certificado en SharePoint', creado.code, e)
      );
      return { code: creado.code, issuedAt: creado.issued_at };
    } catch (error) {
      const mensaje = (error as { code?: string })?.code;
      if (mensaje !== 'P2002' || intento === 2) throw error;
    }
  }
  return null;
}

/** El nombre a mostrar de un estudiante cuando no hay más que su correo. */
export function nombreDesdeCorreo(correo: string): string {
  const usuario = correo.split('@')[0] ?? correo;
  return usuario
    .split(/[._-]+/)
    .filter(Boolean)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(' ');
}

/**
 * El nombre de pila de un estudiante para mostrar en la interfaz y estampar
 * en el certificado.
 *
 * El portal solo garantiza un correo (ver `lib/portal/acceso.ts`): quien
 * entra por código nunca dio su nombre. Si esa persona SÍ tiene usuario en
 * SynerLink (`user.name`), se usa ese; si no, se deriva del correo — mejor
 * "Nicolas Rivera" que nada, y mejor eso que bloquear la emisión del
 * certificado por un dato que el portal nunca pidió.
 */
export async function resolverNombreEstudiante(correo: string): Promise<string> {
  const usuario = await prisma.user.findUnique({ where: { email: correo }, select: { name: true } });
  const nombre = usuario?.name?.trim();
  return nombre || nombreDesdeCorreo(correo);
}

/**
 * La carpeta del curso dentro de FORMACION (`<slug>-<id>`).
 *
 * Se calcula con el título en la PRIMERA subida y se guarda en
 * `portal_course.sp_folder_name`: si después se renombra el curso, sus
 * archivos siguen yendo a la misma carpeta en vez de repartirse en dos.
 */
export async function carpetaSharePointDelCurso(cursoId: number): Promise<string> {
  const curso = await prisma.portalCourse.findUnique({
    where: { id: cursoId },
    select: { title: true, sp_folder_name: true },
  });
  if (!curso) throw new Error(`Curso ${cursoId} no encontrado.`);
  if (curso.sp_folder_name) return curso.sp_folder_name;

  const carpeta = carpetaDeCurso(curso.title, cursoId);
  // `updateMany` con la condición de nulo: si dos subidas llegan a la vez, la
  // segunda no pisa lo que fijó la primera.
  await prisma.portalCourse.updateMany({
    where: { id: cursoId, sp_folder_name: null },
    data: { sp_folder_name: carpeta },
  });
  const releido = await prisma.portalCourse.findUnique({ where: { id: cursoId }, select: { sp_folder_name: true } });
  return releido?.sp_folder_name ?? carpeta;
}

/**
 * Genera el PDF de un certificado y lo sube a
 * `FORMACION/<curso>/certificados/<codigo>.pdf`, guardando la referencia.
 * Si ya estaba archivado, no hace nada. Lanza si SharePoint no está
 * configurado o falla — quien llama decide si eso es fatal.
 */
export async function archivarCertificadoEnSharePoint(code: string): Promise<ArchivoEnSharePoint | null> {
  const cert = await prisma.portalCertificate.findUnique({ where: { code } });
  if (!cert) return null;
  if (cert.sp_drive_item_id) return null;

  const pdf = await generarCertificadoPdf({
    code: cert.code,
    studentName: cert.student_name,
    courseTitle: cert.course_title,
    issuedAt: cert.issued_at,
  });
  const carpetaCurso = await carpetaSharePointDelCurso(cert.course_id);
  const archivo = await subirArchivoFormacion({
    carpetaCurso,
    subcarpeta: 'certificados',
    nombreArchivo: `${cert.code}.pdf`,
    contenido: pdf,
    mime: 'application/pdf',
  });
  await prisma.portalCertificate.update({
    where: { code },
    data: {
      sp_drive_item_id: archivo.driveItemId,
      sp_web_url: archivo.webUrl,
      file_name: archivo.nombre || `${cert.code}.pdf`,
      file_size: BigInt(archivo.tamano),
    },
  });
  return archivo;
}

/**
 * Valida el archivo de un material (mismas reglas al agregarlo y al
 * reemplazarlo). Devuelve el mensaje de error, o `null` si pasa.
 */
export function validarArchivoMaterial(archivo: unknown): string | null {
  if (!(archivo instanceof File)) return 'Falta el archivo del documento.';
  const mime = (archivo.type || '').toLowerCase();
  if (!MATERIAL_MIMES_PERMITIDOS.includes(mime)) return `Formato no admitido (${mime || 'desconocido'}).`;
  if (archivo.size === 0) return 'El archivo llegó vacío.';
  const tope = maxMaterialBytes();
  if (tope !== null && archivo.size > tope) return mensajeArchivoMuyGrande(tope);
  return null;
}

/** Lo que el navegador declara ANTES de subir directo a SharePoint. */
export interface DeclaracionArchivo {
  nombre: string;
  mime: string;
  tamano: number;
}

/**
 * Valida lo que el navegador declara del archivo antes de abrirle una upload
 * session. Mismas reglas de formato que `validarArchivoMaterial` (no se
 * amplían los tipos); sin tope de tamaño salvo `PORTAL_TH_MAX_UPLOAD_MB`.
 * Devuelve la declaración normalizada o el mensaje de error.
 */
export function validarDeclaracionMaterial(cuerpo: unknown): { ok: true; valor: DeclaracionArchivo } | { ok: false; error: string } {
  const c = (cuerpo ?? {}) as Record<string, unknown>;
  const nombre = typeof c.nombre === 'string' ? c.nombre.trim() : '';
  const mime = typeof c.mime === 'string' ? c.mime.trim().toLowerCase() : '';
  const tamano = typeof c.tamano === 'number' ? c.tamano : Number.NaN;
  if (!nombre) return { ok: false, error: 'Falta el nombre del archivo.' };
  if (!MATERIAL_MIMES_PERMITIDOS.includes(mime)) return { ok: false, error: `Formato no admitido (${mime || 'desconocido'}).` };
  if (!Number.isSafeInteger(tamano) || tamano < 0) return { ok: false, error: 'Tamaño de archivo no válido.' };
  if (tamano === 0) return { ok: false, error: 'El archivo está vacío.' };
  const tope = maxMaterialBytes();
  if (tope !== null && tamano > tope) return { ok: false, error: mensajeArchivoMuyGrande(tope) };
  return { ok: true, valor: { nombre, mime, tamano } };
}

/**
 * Abre la upload session de un material en FORMACION/<curso>/materiales.
 * Lanza `FormacionStorageNoConfigurado` si falta la configuración.
 */
export async function abrirSubidaDeMaterial(courseId: number, declaracion: DeclaracionArchivo): Promise<SesionSubida> {
  leerConfigFormacion();
  const carpetaCurso = await carpetaSharePointDelCurso(courseId);
  return crearSesionSubida({ carpetaCurso, subcarpeta: 'materiales', nombreArchivo: declaracion.nombre });
}

/**
 * Tras la subida directa del navegador: comprueba que el driveItem esté en
 * FORMACION/<curso>/materiales (y que respete el tope, si lo hay) y devuelve
 * las columnas a guardar. Lanza `FormacionStorageError` si no cumple.
 */
export async function referenciaDeMaterialSubido(
  courseId: number,
  driveItemId: string,
  mime: string
): Promise<ReferenciaMaterial> {
  leerConfigFormacion();
  const carpetaCurso = await carpetaSharePointDelCurso(courseId);
  const item = await obtenerArchivoSubidoEnCarpeta({ driveItemId, carpetaCurso, subcarpeta: 'materiales', mime });
  const tope = maxMaterialBytes();
  if (tope !== null && item.tamano > tope) {
    // Se registra igual el error, pero el archivo queda en SharePoint: no se
    // borra nada desde el portal. Se mueve a ELIMINADOS para no dejarlo suelto.
    await moverMaterialAEliminados({ driveItemId: item.driveItemId, carpetaCurso, nombreArchivo: item.nombre || 'material' }).catch(
      () => undefined
    );
    throw new MaterialNoValido(mensajeArchivoMuyGrande(tope));
  }
  return {
    file_name: (item.nombre || 'material').slice(0, 255),
    mime,
    sp_drive_item_id: item.driveItemId,
    sp_web_url: item.webUrl,
    file_size: BigInt(item.tamano),
  };
}

/** El material subido no cumple una regla (se responde 400 con el mensaje). */
export class MaterialNoValido extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaterialNoValido';
  }
}

/**
 * Lee el cuerpo JSON de "registrar un material ya subido": `driveItemId` y
 * `mime` (el mismo que se declaró al abrir la sesión, validado otra vez).
 */
export function validarRegistroSubido(cuerpo: unknown): { ok: true; driveItemId: string; mime: string } | { ok: false; error: string } {
  const c = (cuerpo ?? {}) as Record<string, unknown>;
  const driveItemId = typeof c.driveItemId === 'string' ? c.driveItemId.trim() : '';
  const mime = typeof c.mime === 'string' ? c.mime.trim().toLowerCase() : '';
  if (!/^[A-Za-z0-9!._-]{1,200}$/.test(driveItemId)) return { ok: false, error: 'Falta la referencia del archivo subido.' };
  if (!MATERIAL_MIMES_PERMITIDOS.includes(mime)) return { ok: false, error: `Formato no admitido (${mime || 'desconocido'}).` };
  return { ok: true, driveItemId, mime };
}

/** Columnas de referencia de un material ya subido a SharePoint. */
export interface ReferenciaMaterial {
  file_name: string;
  mime: string;
  sp_drive_item_id: string;
  sp_web_url: string | null;
  file_size: bigint;
}

/**
 * Sube el archivo (ya validado) de un material a
 * FORMACION/<curso>/materiales y devuelve las columnas a guardar. Lanza
 * `FormacionStorageNoConfigurado` ANTES de leer el archivo si falta la
 * configuración.
 */
export async function subirArchivoDeMaterial(courseId: number, archivo: File): Promise<ReferenciaMaterial> {
  leerConfigFormacion();
  const mime = (archivo.type || '').toLowerCase();
  const carpetaCurso = await carpetaSharePointDelCurso(courseId);
  const subido = await subirArchivoFormacion({
    carpetaCurso,
    subcarpeta: 'materiales',
    nombreArchivo: archivo.name,
    contenido: new Uint8Array(await archivo.arrayBuffer()),
    mime,
  });
  return {
    file_name: (subido.nombre || archivo.name).slice(0, 255) || 'material',
    mime,
    sp_drive_item_id: subido.driveItemId,
    sp_web_url: subido.webUrl,
    file_size: BigInt(subido.tamano),
  };
}

/**
 * Mueve a FORMACION/ELIMINADOS/<curso>/materiales el archivo de un material
 * (al quitarlo o al reemplazarlo). Nada se borra de SharePoint.
 */
export async function moverArchivoDeMaterialAEliminados(
  courseId: number,
  driveItemId: string,
  nombreArchivo: string | null
): Promise<ArchivoEnSharePoint> {
  return moverMaterialAEliminados({
    driveItemId,
    carpetaCurso: await carpetaSharePointDelCurso(courseId),
    nombreArchivo: nombreArchivo ?? 'material',
  });
}

/* ─────────────── Progreso: recalcular y marcar (2026-10-08) ─────────────── */

/**
 * Recalcula el % del curso del material para un estudiante y, si llegó al
 * 100 %, emite su certificado (o devuelve el que ya tenía). Lo comparten el
 * marcado MANUAL (administradores/formadores) y el AUTOMÁTICO (reporte de
 * revisión), para que los dos calculen lo mismo.
 */
export async function recalcularProgresoDeMaterial(
  materialId: number,
  correo: string,
  opciones: { emitirCertificado?: boolean } = {}
): Promise<{ porcentaje: number; certificado: { code: string; emitidoEl: Date } | null } | null> {
  const material = await prisma.portalCourseMaterial.findFirst({
    where: { id: materialId, eliminado_at: null },
    select: { course_id: true, course: { select: { title: true, active: true } } },
  });
  if (!material) return null;

  const materiales = await prisma.portalCourseMaterial.findMany({
    where: { course_id: material.course_id, eliminado_at: null },
    select: { id: true, required: true },
  });
  const completados = await prisma.portalMaterialProgress.findMany({
    where: { student_email: correo, material_id: { in: materiales.map((m) => m.id) } },
    select: { material_id: true },
  });
  const { porcentaje } = calcularProgreso(materiales, new Set(completados.map((c) => c.material_id)));

  let certificado = null;
  if (opciones.emitirCertificado !== false && material.course.active) {
    const nombre = await resolverNombreEstudiante(correo);
    const emitido = await emitirCertificadoSiCorresponde({
      courseId: material.course_id,
      studentEmail: correo,
      studentName: nombre,
      courseTitle: material.course.title,
      porcentaje,
    });
    if (emitido) certificado = { code: emitido.code, emitidoEl: emitido.issuedAt };
  }
  return { porcentaje, certificado };
}

/**
 * Marca un material como completado. No pisa una marca existente (su fecha y
 * su origen quedan como estaban).
 */
export async function marcarMaterialCompletado(params: {
  materialId: number;
  correo: string;
  origen: 'AUTO' | 'MANUAL';
  marcadoPor?: string | null;
}): Promise<void> {
  const { materialId, correo, origen, marcadoPor } = params;
  await prisma.portalMaterialProgress.upsert({
    where: { material_id_student_email: { material_id: materialId, student_email: correo } },
    update: {},
    create: {
      material_id: materialId,
      student_email: correo,
      origen,
      marcado_por: origen === 'MANUAL' ? (marcadoPor ?? null) : null,
    },
  });
}

/** PDFs más grandes que esto no se descargan para contar páginas. */
const MAX_BYTES_CONTAR_PAGINAS = 60 * 1024 * 1024;
const paginasPorArchivo = new Map<string, number>();

/** Solo para pruebas. */
export function _reiniciarCachePaginas() {
  paginasPorArchivo.clear();
}

/**
 * Páginas de un PDF de Formación (para el tiempo mínimo de revisión).
 * Devuelve null si no se pudo contar; quien llama usa entonces el máximo.
 * Se recuerda por archivo: reemplazar el archivo cambia el driveItemId.
 */
export async function contarPaginasPdf(material: {
  id: number;
  sp_drive_item_id: string | null;
  file_size: bigint | null;
  contenido?: Uint8Array | null;
}): Promise<number | null> {
  const clave = material.sp_drive_item_id ?? `bd-${material.id}`;
  const enCache = paginasPorArchivo.get(clave);
  if (enCache) return enCache;
  try {
    if (material.file_size !== null && Number(material.file_size) > MAX_BYTES_CONTAR_PAGINAS) return null;
    let bytes: Uint8Array | null = null;
    if (material.sp_drive_item_id) {
      const archivo = await descargarArchivoFormacion(material.sp_drive_item_id);
      if (!archivo.cuerpo) return null;
      bytes = new Uint8Array(await new Response(archivo.cuerpo).arrayBuffer());
    } else if (material.contenido) {
      bytes = material.contenido;
    }
    if (!bytes) return null;
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const paginas = pdf.getPageCount();
    if (paginas > 0) paginasPorArchivo.set(clave, paginas);
    return paginas > 0 ? paginas : null;
  } catch (error) {
    console.warn('[portal] No se pudieron contar las páginas del PDF', material.id, (error as Error).message);
    return null;
  }
}
