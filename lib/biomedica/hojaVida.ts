import { SgcError } from '../sgc/errors';
import type { BiomedAccess } from './access';
import { ETIQUETA_CAMPO, ETIQUETA_ESTADO, historialEquipo, type BiomedDb, type EquipoDto, type EstadoEquipo, type InvActor } from './inventario';

/**
 * INGENIERÍA BIOMÉDICA · HOJA DE VIDA Y MANTENIMIENTOS (fase 3, 2026-11-23; reunión de Nicolás Rivera con
 * Juan Mora del 2026-11-23). Dentro de cada equipo del inventario:
 *  - la hoja de vida: fecha de ingreso, vida útil y cada cuántos meses le toca el mantenimiento preventivo;
 *  - «Nuevo mantenimiento»: fecha, número de reporte, tipo (preventivo, correctivo, metrológico), lista de
 *    chequeo, observaciones y responsables. No se borra ni se cambia: solo se anula con motivo;
 *  - los formatos diligenciados del equipo y su historial (trazabilidad);
 *  - «Generar reporte»: la hoja de vida en PDF con toda la trazabilidad, sobre el formato vigente de hojas
 *    de vida si Calidad lo habilitó en el módulo.
 * La hoja de vida se actualiza en cada mantenimiento y en cada cambio de cliente (historial del inventario).
 */

export const ACTIVIDAD_INSPECCION = 'Inspección de equipos biomédicos nuevos';
export const ACTIVIDAD_HOJA_VIDA = 'Elaboración y actualización de hojas de vida';

export const TIPOS_MANTENIMIENTO = ['preventivo', 'correctivo', 'metrologico'] as const;
export type TipoMantenimiento = (typeof TIPOS_MANTENIMIENTO)[number];
export const ETIQUETA_TIPO: Record<TipoMantenimiento, string> = { preventivo: 'Preventivo', correctivo: 'Correctivo', metrologico: 'Metrológico' };

export const RESULTADOS_CHEQUEO = ['ok', 'no_ok', 'na'] as const;
export type ResultadoChequeo = (typeof RESULTADOS_CHEQUEO)[number];
export const ETIQUETA_RESULTADO: Record<ResultadoChequeo, string> = { ok: 'OK', no_ok: 'No OK', na: 'N/A' };
/** Lista de chequeo sugerida (se puede quitar o agregar ítems en cada mantenimiento). */
export const CHEQUEO_SUGERIDO = ['Estado físico', 'Pantalla', 'Cableado', 'Batería', 'Alarmas', 'Limpieza y desinfección'] as const;
export const MAX_CHEQUEO = 40;

export interface ItemChequeo {
  item: string;
  resultado: ResultadoChequeo;
  nota: string | null;
}

export interface MantenimientoDto {
  id: number;
  fecha: string;
  tipo: TipoMantenimiento;
  numeroReporte: string | null;
  checklist: ItemChequeo[];
  observaciones: string | null;
  responsables: string;
  proximo: string | null;
  idRegistro: number | null;
  estado: 'vigente' | 'anulado';
  anuladoPor: string | null;
  anuladoAt: string | null;
  motivoAnulacion: string | null;
  createdBy: string;
  createdAt: string;
}

export interface FichaDto {
  fechaIngreso: string | null;
  vidaUtilAnios: number | null;
  periodicidadMeses: number | null;
  /** Fin de la vida útil (fecha de ingreso + vida útil). */
  finVidaUtil: string | null;
  ultimoPreventivo: string | null;
  /** Próximo mantenimiento preventivo: el del último preventivo o, si no hay, ingreso + periodicidad. */
  proximoMantenimiento: string | null;
  vencido: boolean;
}

export interface RegistroEquipoDto {
  id: number;
  code: string;
  title: string;
  actividad: string;
  estado: string;
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
}

const lower = (s: string) => s.trim().toLowerCase();
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

function puedeUsar(access: BiomedAccess) {
  if (!access.canUse) throw new SgcError('Sin acceso a Ingeniería biomédica.', 403);
}

/** «AAAA-MM-DD» válida (a medianoche UTC, como guarda SQL Server un DATE). */
export function fechaDe(v: unknown, campo: string, obligatoria = true): Date | null {
  const s = typeof v === 'string' ? v.trim().slice(0, 10) : '';
  if (!s) {
    if (obligatoria) throw new SgcError(`Escriba ${campo}.`, 400);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new SgcError(`${campo[0]!.toUpperCase()}${campo.slice(1)}: fecha inválida.`, 400);
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new SgcError(`${campo[0]!.toUpperCase()}${campo.slice(1)}: fecha inválida.`, 400);
  if (d.getUTCFullYear() < 1990) throw new SgcError(`${campo[0]!.toUpperCase()}${campo.slice(1)}: fecha inválida.`, 400);
  return d;
}

/** Hoy en Colombia (AAAA-MM-DD a medianoche UTC). */
export function hoyBogota(now: Date = new Date()): Date {
  return new Date(`${now.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })}T00:00:00.000Z`);
}

/** Suma meses a una fecha (el día se ajusta al último del mes si no existe: 31-ene + 1 = 28/29-feb). */
export function sumarMeses(d: Date, meses: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + meses;
  const ultimo = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), ultimo)));
}

function entero(v: unknown, campo: string, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new SgcError(`${campo}: escriba un número entero entre ${min} y ${max}.`, 400);
  return n;
}

function textoOpcional(v: unknown, campo: string, max: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length > max) throw new SgcError(`${campo}: máximo ${max} caracteres.`, 400);
  return s;
}

export function checklistDe(raw: unknown): ItemChequeo[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) throw new SgcError('Lista de chequeo inválida.', 400);
  if (raw.length > MAX_CHEQUEO) throw new SgcError(`La lista de chequeo admite máximo ${MAX_CHEQUEO} ítems.`, 400);
  const out: ItemChequeo[] = [];
  const vistos = new Set<string>();
  for (const x of raw) {
    const o = (x ?? {}) as Record<string, unknown>;
    const item = textoOpcional(o.item, 'Ítem de la lista de chequeo', 120);
    if (!item) continue;
    if (vistos.has(item.toLowerCase())) throw new SgcError(`Ítem repetido en la lista de chequeo: ${item}.`, 400);
    vistos.add(item.toLowerCase());
    const resultado = String(o.resultado ?? '') as ResultadoChequeo;
    if (!RESULTADOS_CHEQUEO.includes(resultado)) throw new SgcError(`Marque el resultado de «${item}» (OK, No OK o N/A).`, 400);
    out.push({ item, resultado, nota: textoOpcional(o.nota, `Nota de «${item}»`, 300) });
  }
  return out;
}

function leerChecklist(json: string): ItemChequeo[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as ItemChequeo[]) : [];
  } catch {
    return [];
  }
}

type FilaMant = Awaited<ReturnType<BiomedDb['biomedMantenimiento']['findFirst']>> & {};
function mantDto(m: NonNullable<FilaMant>): MantenimientoDto {
  return {
    id: m.id_biomed_mantenimiento,
    fecha: iso(m.fecha)!,
    tipo: m.tipo as TipoMantenimiento,
    numeroReporte: m.numero_reporte,
    checklist: leerChecklist(m.checklist_json),
    observaciones: m.observaciones,
    responsables: m.responsables,
    proximo: iso(m.proximo),
    idRegistro: m.id_biomed_registro,
    estado: m.estado as MantenimientoDto['estado'],
    anuladoPor: m.anulado_por,
    anuladoAt: m.anulado_at?.toISOString() ?? null,
    motivoAnulacion: m.motivo_anulacion,
    createdBy: m.created_by,
    createdAt: m.created_at.toISOString(),
  };
}

/** Lo que se calcula de la hoja de vida con sus mantenimientos (vigentes). */
export function fichaDe(
  eq: { fecha_ingreso: Date | null; vida_util_anios: number | null; periodicidad_mant_meses: number | null },
  mantenimientos: Pick<MantenimientoDto, 'fecha' | 'tipo' | 'estado' | 'proximo'>[],
  hoy: Date = hoyBogota()
): FichaDto {
  const preventivos = mantenimientos.filter((m) => m.estado === 'vigente' && m.tipo === 'preventivo').sort((a, b) => b.fecha.localeCompare(a.fecha));
  const ultimo = preventivos[0] ?? null;
  const periodicidad = eq.periodicidad_mant_meses;
  let proximo: string | null = null;
  if (ultimo) proximo = ultimo.proximo ?? (periodicidad ? iso(sumarMeses(new Date(`${ultimo.fecha}T00:00:00.000Z`), periodicidad)) : null);
  else if (eq.fecha_ingreso && periodicidad) proximo = iso(sumarMeses(eq.fecha_ingreso, periodicidad));
  return {
    fechaIngreso: iso(eq.fecha_ingreso),
    vidaUtilAnios: eq.vida_util_anios,
    periodicidadMeses: periodicidad,
    finVidaUtil: eq.fecha_ingreso && eq.vida_util_anios ? iso(sumarMeses(eq.fecha_ingreso, eq.vida_util_anios * 12)) : null,
    ultimoPreventivo: ultimo?.fecha ?? null,
    proximoMantenimiento: proximo,
    vencido: proximo !== null && proximo < iso(hoy)!,
  };
}

async function equipoDe(db: BiomedDb, access: BiomedAccess, idEquipo: number) {
  puedeUsar(access);
  const eq = Number.isInteger(idEquipo) ? await db.biomedEquipo.findFirst({ where: { id_biomed_equipo: idEquipo, id_company: access.idCompany } }) : null;
  if (!eq) throw new SgcError('Equipo no encontrado.', 404);
  return eq;
}

async function evento(db: BiomedDb, idCompany: number, idEquipo: number, accion: string, actor: InvActor, despues: unknown, antes?: unknown, justificacion?: string | null) {
  await db.biomedEquipoEvento.create({
    data: {
      id_company: idCompany,
      id_biomed_equipo: idEquipo,
      accion,
      antes: antes === undefined ? null : JSON.stringify(antes),
      despues: JSON.stringify(despues),
      justificacion: justificacion ?? null,
      actor_email: lower(actor.email),
      ip: actor.ip ?? null,
    },
  });
}

export interface HojaVidaDto {
  equipo: EquipoDto;
  ficha: FichaDto;
  mantenimientos: MantenimientoDto[];
  registros: RegistroEquipoDto[];
  historial: Awaited<ReturnType<typeof historialEquipo>>['historial'];
}

export async function getHojaVida(db: BiomedDb, access: BiomedAccess, idEquipo: number): Promise<HojaVidaDto> {
  const eq = await equipoDe(db, access, idEquipo);
  const [h, mants, regs] = await Promise.all([
    historialEquipo(db, access, idEquipo),
    db.biomedMantenimiento.findMany({ where: { id_company: access.idCompany, id_biomed_equipo: idEquipo }, orderBy: [{ fecha: 'desc' }, { id_biomed_mantenimiento: 'desc' }], take: 500 }),
    db.biomedRegistro.findMany({ where: { id_company: access.idCompany, id_biomed_equipo: idEquipo }, orderBy: { id_biomed_registro: 'desc' }, take: 300, include: { formato: true } }),
  ]);
  const docs = regs.length
    ? new Map((await db.sgcDocument.findMany({ where: { id_document: { in: [...new Set(regs.map((r) => r.id_document))] } }, select: { id_document: true, code: true, title: true } })).map((d) => [d.id_document, d]))
    : new Map<number, { code: string; title: string }>();
  const mantenimientos = mants.map(mantDto);
  return {
    equipo: h.equipo,
    ficha: fichaDe(eq, mantenimientos),
    mantenimientos,
    registros: regs.map((r) => ({
      id: r.id_biomed_registro,
      code: docs.get(r.id_document)?.code ?? '—',
      title: docs.get(r.id_document)?.title ?? '—',
      actividad: r.formato.actividad,
      estado: r.estado,
      createdBy: r.created_by,
      createdAt: r.created_at.toISOString(),
      closedAt: r.closed_at?.toISOString() ?? null,
    })),
    historial: h.historial,
  };
}

/** Datos de la hoja de vida (fecha de ingreso, vida útil, periodicidad): exige justificación si cambia algo ya escrito. */
export async function guardarFicha(db: BiomedDb, access: BiomedAccess, idEquipo: number, input: Record<string, unknown>, actor: InvActor) {
  const eq = await equipoDe(db, access, idEquipo);
  const nuevos: Record<string, Date | number | null> = {};
  if ('fechaIngreso' in input) nuevos.fecha_ingreso = fechaDe(input.fechaIngreso, 'la fecha de ingreso', false);
  if ('vidaUtilAnios' in input) nuevos.vida_util_anios = entero(input.vidaUtilAnios, 'Vida útil (años)', 1, 50);
  if ('periodicidadMeses' in input) nuevos.periodicidad_mant_meses = entero(input.periodicidadMeses, 'Periodicidad del mantenimiento (meses)', 1, 120);
  if (nuevos.fecha_ingreso instanceof Date && nuevos.fecha_ingreso > hoyBogota()) throw new SgcError('La fecha de ingreso no puede ser futura.', 400);
  const actual = { fecha_ingreso: iso(eq.fecha_ingreso), vida_util_anios: eq.vida_util_anios, periodicidad_mant_meses: eq.periodicidad_mant_meses } as Record<string, string | number | null>;
  const antes: Record<string, unknown> = {};
  const despues: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(nuevos)) {
    const nv = v instanceof Date ? iso(v) : v;
    if ((actual[k] ?? null) !== (nv ?? null)) {
      antes[k] = actual[k] ?? null;
      despues[k] = nv;
    }
  }
  if (Object.keys(despues).length === 0) return { changed: false };
  const cambiaEscrito = Object.keys(despues).some((k) => antes[k] !== null);
  const just = typeof input.justificacion === 'string' ? input.justificacion.trim() : '';
  if (cambiaEscrito && just.length < 5) throw new SgcError('Escriba por qué cambia la hoja de vida (queda en el historial).', 400);
  await db.biomedEquipo.update({
    where: { id_biomed_equipo: eq.id_biomed_equipo },
    data: { ...Object.fromEntries(Object.keys(despues).map((k) => [k, nuevos[k]])), updated_by: lower(actor.email), updated_at: new Date() },
  });
  await evento(db, access.idCompany, eq.id_biomed_equipo, 'hoja_vida', actor, despues, antes, just ? just.slice(0, 1000) : null);
  return { changed: true };
}

/** Registra un mantenimiento (preventivo, correctivo o metrológico) y actualiza la hoja de vida. */
export async function crearMantenimiento(db: BiomedDb, access: BiomedAccess, idEquipo: number, input: Record<string, unknown>, actor: InvActor) {
  const eq = await equipoDe(db, access, idEquipo);
  const fecha = fechaDe(input.fecha, 'la fecha del mantenimiento')!;
  if (fecha > hoyBogota()) throw new SgcError('La fecha del mantenimiento no puede ser futura.', 400);
  const tipo = String(input.tipo ?? '') as TipoMantenimiento;
  if (!TIPOS_MANTENIMIENTO.includes(tipo)) throw new SgcError('Elija el tipo de mantenimiento (preventivo, correctivo o metrológico).', 400);
  const responsables = textoOpcional(input.responsables, 'Responsables', 500);
  if (!responsables) throw new SgcError('Escriba los responsables del mantenimiento.', 400);
  const checklist = checklistDe(input.checklist);
  const observaciones = textoOpcional(input.observaciones, 'Observaciones', 2000);
  const numeroReporte = textoOpcional(input.numeroReporte, 'Número de reporte', 50);
  let idRegistro: number | null = null;
  if (input.idRegistro !== null && input.idRegistro !== undefined && input.idRegistro !== '') {
    idRegistro = Number(input.idRegistro);
    const reg = Number.isInteger(idRegistro) ? await db.biomedRegistro.findFirst({ where: { id_biomed_registro: idRegistro, id_company: access.idCompany }, select: { id_biomed_equipo: true } }) : null;
    if (!reg || (reg.id_biomed_equipo !== null && reg.id_biomed_equipo !== eq.id_biomed_equipo)) throw new SgcError('El formato diligenciado no es de este equipo.', 400);
  }
  const proximo = tipo === 'preventivo' && eq.periodicidad_mant_meses ? sumarMeses(fecha, eq.periodicidad_mant_meses) : null;
  const email = lower(actor.email);
  const row = await db.biomedMantenimiento.create({
    data: {
      id_company: access.idCompany,
      id_biomed_equipo: eq.id_biomed_equipo,
      fecha,
      tipo,
      numero_reporte: numeroReporte,
      checklist_json: JSON.stringify(checklist),
      observaciones,
      responsables,
      proximo,
      id_biomed_registro: idRegistro,
      created_by: email,
    },
  });
  if (idRegistro !== null) await db.biomedRegistro.updateMany({ where: { id_biomed_registro: idRegistro, id_company: access.idCompany, id_biomed_equipo: null }, data: { id_biomed_equipo: eq.id_biomed_equipo } });
  const noOk = checklist.filter((c) => c.resultado === 'no_ok').map((c) => c.item);
  await evento(db, access.idCompany, eq.id_biomed_equipo, 'mantenimiento', actor, {
    mantenimiento: row.id_biomed_mantenimiento,
    tipo,
    fecha: iso(fecha),
    numeroReporte,
    responsables,
    ...(noOk.length ? { noOk } : {}),
    ...(proximo ? { proximo: iso(proximo) } : {}),
  });
  return { id: row.id_biomed_mantenimiento, proximo: iso(proximo) };
}

/** Un mantenimiento no se borra: se anula con su motivo (queda en el historial). */
export async function anularMantenimiento(db: BiomedDb, access: BiomedAccess, idEquipo: number, idMant: number, input: { motivo?: unknown }, actor: InvActor) {
  const eq = await equipoDe(db, access, idEquipo);
  const m = Number.isInteger(idMant) ? await db.biomedMantenimiento.findFirst({ where: { id_biomed_mantenimiento: idMant, id_company: access.idCompany, id_biomed_equipo: eq.id_biomed_equipo } }) : null;
  if (!m) throw new SgcError('Mantenimiento no encontrado.', 404);
  if (m.estado === 'anulado') throw new SgcError('El mantenimiento ya está anulado.', 409);
  const motivo = typeof input.motivo === 'string' ? input.motivo.trim() : '';
  if (motivo.length < 5) throw new SgcError('Escriba el motivo de la anulación (mínimo 5 caracteres).', 400);
  const now = new Date();
  await db.biomedMantenimiento.update({ where: { id_biomed_mantenimiento: m.id_biomed_mantenimiento }, data: { estado: 'anulado', anulado_por: lower(actor.email), anulado_at: now, motivo_anulacion: motivo.slice(0, 1000) } });
  await evento(db, access.idCompany, eq.id_biomed_equipo, 'mantenimiento_anulado', actor, { mantenimiento: m.id_biomed_mantenimiento, tipo: m.tipo, fecha: iso(m.fecha) }, undefined, motivo.slice(0, 1000));
  return { anulado: true };
}

// ── Reporte en PDF ─────────────────────────────────────────────────────────

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const fechaCo = (s: string | null) => (s ? s.split('-').reverse().join('/') : '—');
const fechaHoraCo = (s: string) => new Date(s).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' });

const ACCION_HISTORIAL: Record<string, string> = {
  alta: 'Ingreso al inventario',
  edicion: 'Edición de datos',
  cambio_serial: 'Cambio de serial',
  distribuir: 'Distribuido',
  devolver: 'Devuelto a bodega',
  faltante: 'Marcado faltante',
  danado: 'Marcado dañado',
  reintegrar: 'Reintegrado',
  hoja_vida: 'Hoja de vida actualizada',
  mantenimiento: 'Mantenimiento',
  mantenimiento_anulado: 'Mantenimiento anulado',
  articulo_sap: 'Artículo de SAP',
};
export const etiquetaAccion = (a: string) => ACCION_HISTORIAL[a] ?? a.replace(/_/g, ' ');

/** Formato vigente de hojas de vida habilitado en el módulo (su código y versión van en el reporte). */
export async function formatoHojaVida(db: BiomedDb, idCompany: number): Promise<{ code: string; title: string; version: number } | null> {
  const f = await db.biomedFormato.findFirst({ where: { id_company: idCompany, actividad: ACTIVIDAD_HOJA_VIDA, is_active: true }, orderBy: { id_biomed_formato: 'asc' } });
  if (!f) return null;
  const doc = await db.sgcDocument.findUnique({ where: { id_document: f.id_document }, select: { code: true, title: true, status: true, current_version_id: true } });
  if (!doc || doc.status !== 'vigente' || !doc.current_version_id) return null;
  const v = await db.sgcDocumentVersion.findUnique({ where: { id_document_version: doc.current_version_id }, select: { version_number: true } });
  return { code: doc.code, title: doc.title, version: v?.version_number ?? 0 };
}

export function hojaVidaHtml(h: HojaVidaDto, formato: { code: string; title: string; version: number } | null, meta: { empresa: string; generadoPor: string; generadoAt: Date }): string {
  const e = h.equipo;
  const filaDato = (k: string, v: unknown) => `<tr><th>${esc(k)}</th><td>${esc(v === null || v === undefined || v === '' ? '—' : v)}</td></tr>`;
  const datos = [
    [ETIQUETA_CAMPO.equipo, e.equipo],
    [ETIQUETA_CAMPO.marca, e.marca],
    [ETIQUETA_CAMPO.modelo, e.modelo],
    [ETIQUETA_CAMPO.serie, e.serie],
    [ETIQUETA_CAMPO.codigo_interno, e.codigoInterno],
    [ETIQUETA_CAMPO.clasificacion_riesgo, e.clasificacionRiesgo],
    [ETIQUETA_CAMPO.registro_sanitario, e.registroSanitario],
    ['Estado', ETIQUETA_ESTADO[e.estado as EstadoEquipo] ?? e.estado],
    ['Ubicación', [e.cliente, e.sede, e.ciudad].filter(Boolean).join(' · ')],
    ['Fecha de ingreso', fechaCo(h.ficha.fechaIngreso)],
    ['Vida útil', h.ficha.vidaUtilAnios ? `${h.ficha.vidaUtilAnios} año(s) · hasta ${fechaCo(h.ficha.finVidaUtil)}` : null],
    ['Mantenimiento preventivo', h.ficha.periodicidadMeses ? `cada ${h.ficha.periodicidadMeses} mes(es)` : null],
    ['Último preventivo', fechaCo(h.ficha.ultimoPreventivo)],
    ['Próximo preventivo', `${fechaCo(h.ficha.proximoMantenimiento)}${h.ficha.vencido ? ' (vencido)' : ''}`],
  ];
  const mants = h.mantenimientos
    .map(
      (m) => `<tr class="${m.estado === 'anulado' ? 'anulado' : ''}">
  <td>${esc(fechaCo(m.fecha))}</td><td>${esc(ETIQUETA_TIPO[m.tipo])}</td><td>${esc(m.numeroReporte ?? '—')}</td>
  <td>${m.checklist.length ? m.checklist.map((c) => `${esc(c.item)}: <b>${esc(ETIQUETA_RESULTADO[c.resultado])}</b>${c.nota ? ` (${esc(c.nota)})` : ''}`).join('<br>') : '—'}</td>
  <td>${esc(m.observaciones ?? '—')}${m.estado === 'anulado' ? `<br><i>Anulado: ${esc(m.motivoAnulacion)}</i>` : ''}</td><td>${esc(m.responsables)}</td></tr>`
    )
    .join('');
  const hist = h.historial
    .map((x) => `<tr><td>${esc(fechaHoraCo(x.at))}</td><td>${esc(etiquetaAccion(x.accion))}</td><td>${esc(x.justificacion ?? '')}</td><td>${esc(x.actor)}</td></tr>`)
    .join('');
  const regs = h.registros.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.actividad)}</td><td>${esc(r.estado)}</td><td>${esc(fechaHoraCo(r.createdAt))}</td><td>${esc(r.createdBy)}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Hoja de vida ${esc(e.serie)}</title><style>
@page { size: A4; margin: 1.6cm 1.5cm; }
body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 9.5pt; color: #1a1a1a; margin: 0; }
.enc { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #005EA8; padding-bottom: 6pt; margin-bottom: 10pt; }
.enc h1 { font-size: 15pt; margin: 0; color: #005EA8; } .enc .meta { text-align: right; font-size: 8.5pt; color: #444; }
h2 { font-size: 11pt; color: #005EA8; margin: 14pt 0 5pt; }
table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #bbb; padding: 3pt 5pt; text-align: left; vertical-align: top; }
th { background: #f0f4f8; font-weight: 600; } table.datos th { width: 32%; }
tr.anulado td { color: #888; text-decoration: line-through; } tr.anulado td i { text-decoration: none; }
thead { display: table-header-group; } tr { break-inside: avoid; }
.pie { margin-top: 14pt; font-size: 8pt; color: #666; }
</style></head><body>
<div class="enc"><div><h1>Hoja de vida del equipo</h1><div>${esc(e.equipo)} · Serie ${esc(e.serie)}</div></div>
<div class="meta">${esc(meta.empresa)}<br>${formato ? `Formato ${esc(formato.code)} · V${formato.version}` : 'Reporte del sistema (sin formato de hoja de vida habilitado)'}</div></div>
<h2>Datos del equipo</h2><table class="datos">${datos.map(([k, v]) => filaDato(String(k), v)).join('')}</table>
<h2>Registro histórico de mantenimientos</h2>
${h.mantenimientos.length ? `<table><thead><tr><th>Fecha</th><th>Tipo</th><th>Reporte</th><th>Lista de chequeo</th><th>Observaciones</th><th>Responsables</th></tr></thead><tbody>${mants}</tbody></table>` : '<p>Sin mantenimientos registrados.</p>'}
<h2>Formatos diligenciados</h2>
${h.registros.length ? `<table><thead><tr><th>Formato</th><th>Actividad</th><th>Estado</th><th>Fecha</th><th>Diligenció</th></tr></thead><tbody>${regs}</tbody></table>` : '<p>Sin formatos diligenciados ligados al equipo.</p>'}
<h2>Trazabilidad (ubicación y cambios)</h2>
${h.historial.length ? `<table><thead><tr><th>Fecha</th><th>Acción</th><th>Justificación</th><th>Quién</th></tr></thead><tbody>${hist}</tbody></table>` : '<p>Sin movimientos.</p>'}
<div class="pie">Generado desde SynerLink por ${esc(meta.generadoPor)} el ${esc(fechaHoraCo(meta.generadoAt.toISOString()))}. Impreso o descargado fuera del sistema es copia no controlada.</div>
</body></html>`;
}
