import { CORREO_MAX_ASUNTO, CORREO_MAX_DESCRIPCION, CORREO_MAX_LOTE } from './constants';
import { CorreoError } from './errors';
import { extracto, htmlATexto } from './sanitize';
import type { AlertaFila, Direccion, FilaSimulacion, MensajeCompleto } from './types';

/** Reglas PURAS del módulo Correo (simulación, validación de filas, sugerencias). */

const PREFIJO = /^(?:re|rv|fw|fwd|reenv|tr|aw|ref|res) ?:/i;

/** Asunto sin «RE:», «RV:», «FW:»… repetidos, recortado al largo de la solicitud. */
export function normalizarAsunto(asunto: string): string {
  let s = String(asunto ?? '');
  for (let i = 0; i < 10; i++) {
    const t = s.trimStart();
    if (!PREFIJO.test(t)) break;
    s = t.replace(PREFIJO, '');
  }
  s = s.replace(/\s+/g, ' ').trim();
  return (s || '(Sin asunto)').slice(0, CORREO_MAX_ASUNTO);
}

function sinTildes(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

const STOP = new Set(['solicitud', 'solicitudes', 'proceso', 'general', 'para', 'sobre', 'entre', 'desde', 'revision', 'gestion', 'elaboracion']);
/** Sinónimos de Jurídica: palabras del correo que apuntan a un proceso. */
const SINONIMOS: Record<string, string> = {
  otrosi: 'contrato',
  arrendamiento: 'contrato',
  contratos: 'contrato',
  poderes: 'poder',
  marcas: 'marca',
  firmas: 'firma',
};

function raiz(w: string): string {
  const s = SINONIMOS[w] ?? w;
  return s.length > 5 ? s.replace(/(es|s)$/, '') : s;
}

function palabras(s: string): Set<string> {
  return new Set(
    sinTildes(s)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
      .map(raiz)
  );
}

export interface ProcesoOpcion {
  id: number;
  nombre: string;
  descripcion?: string | null;
}

/**
 * Proceso sugerido por palabras clave del asunto (determinístico, sin IA):
 * gana el proceso que comparte más palabras con el asunto; empate → el primero.
 * Sin coincidencias → el predeterminado que eligió la persona (o ninguno).
 */
export function sugerirProceso(
  asunto: string,
  procesos: ProcesoOpcion[],
  predeterminado: number | null
): { id: number | null; por: FilaSimulacion['procesoSugeridoPor'] } {
  const pa = palabras(asunto);
  let mejor: { id: number; score: number } | null = null;
  for (const p of procesos) {
    const pp = palabras(`${p.nombre} ${p.descripcion ?? ''}`);
    let score = 0;
    for (const w of pp) if (pa.has(w)) score++;
    if (score > 0 && (!mejor || score > mejor.score)) mejor = { id: p.id, score };
  }
  if (mejor) return { id: mejor.id, por: 'palabra-clave' };
  if (predeterminado && procesos.some((p) => p.id === predeterminado)) return { id: predeterminado, por: 'predeterminado' };
  return { id: null, por: null };
}

export function dominio(correo: string): string {
  return String(correo ?? '').split('@')[1]?.toLowerCase() ?? '';
}

/** Agrupa mensajes por hilo (conversationId), cada grupo del más antiguo al más reciente. */
export function agruparPorHilo(mensajes: MensajeCompleto[]): MensajeCompleto[][] {
  const grupos = new Map<string, MensajeCompleto[]>();
  // Copias del MISMO correo (Enviados + Bandeja de entrada cuando la persona se escribe a
  // sí misma) comparten internetMessageId: cuentan como un solo correo.
  const vistos = new Set<string>();
  for (const m of mensajes) {
    if (m.internetMessageId) {
      if (vistos.has(m.internetMessageId)) continue;
      vistos.add(m.internetMessageId);
    }
    const k = m.conversationId || m.id;
    const g = grupos.get(k) ?? [];
    g.push(m);
    grupos.set(k, g);
  }
  return [...grupos.values()].map((g) => g.sort((a, b) => a.fecha.localeCompare(b.fecha)));
}

export interface UsuarioSynerLink {
  id: string;
  nombre: string;
  correo: string;
  empresas: number[];
}

export interface ContextoSimulacion {
  idOperador: string;
  idCompany: number;
  procesos: ProcesoOpcion[];
  procesoPredeterminado: number | null;
  /** correo (minúsculas) → usuario activo de SynerLink. */
  usuarios: Map<string, UsuarioSynerLink>;
  /** internetMessageId o conversationId → solicitud ya vinculada. */
  duplicados: Map<string, number>;
  dominiosGrupo: string[];
}

/** Descripción de la solicitud: remitente, fecha y extracto del cuerpo (sin historial citado). */
export function descripcionDesdeCorreo(m: MensajeCompleto): string {
  const encabezado = `Correo de ${m.de.nombre} <${m.de.correo}> del ${m.fecha.slice(0, 10)}.`;
  const cuerpo = htmlATexto(m.html);
  return extracto(`${encabezado}\n\n${cuerpo}`, CORREO_MAX_DESCRIPCION);
}

/** Construye la fila de simulación de un hilo (función pura). */
export function filaDesdeHilo(grupo: MensajeCompleto[], ctx: ContextoSimulacion): FilaSimulacion {
  const origen = grupo[0];
  const remitente: Direccion = origen.de;
  const usuario = ctx.usuarios.get(remitente.correo) ?? null;
  const sugerido = sugerirProceso(origen.asunto, ctx.procesos, ctx.procesoPredeterminado);
  const duplicadoDe =
    grupo.map((m) => ctx.duplicados.get(m.internetMessageId)).find((x) => x != null) ??
    ctx.duplicados.get(origen.conversationId) ??
    null;
  const fila: FilaSimulacion = {
    conversationId: origen.conversationId,
    mensajeId: origen.id,
    internetMessageId: origen.internetMessageId,
    mensajesIds: grupo.map((m) => m.id),
    idCompany: ctx.idCompany,
    idProcess: sugerido.id,
    procesoSugeridoPor: sugerido.por,
    remitente,
    idSolicitante: usuario?.id ?? null,
    solicitanteNombre: usuario?.nombre ?? null,
    titulo: normalizarAsunto(origen.asunto),
    descripcion: descripcionDesdeCorreo(origen),
    adjuntos: grupo.flatMap((m) => m.adjuntos.filter((a) => !a.enLinea)),
    duplicadoDe,
    alertas: [],
    incluir: true,
  };
  fila.alertas = alertasDeFila(fila, ctx);
  fila.incluir = !fila.alertas.some((a) => a === 'DUPLICADO' || a === 'SIN_USUARIO' || a === 'SIN_PROCESO');
  return fila;
}

export function alertasDeFila(
  fila: Pick<FilaSimulacion, 'duplicadoDe' | 'idSolicitante' | 'idProcess' | 'remitente' | 'idCompany'>,
  ctx: Pick<ContextoSimulacion, 'idOperador' | 'usuarios' | 'dominiosGrupo'>
): AlertaFila[] {
  const a: AlertaFila[] = [];
  if (fila.duplicadoDe) a.push('DUPLICADO');
  if (!ctx.dominiosGrupo.includes(dominio(fila.remitente.correo))) a.push('EXTERNO');
  if (!fila.idSolicitante) a.push('SIN_USUARIO');
  else {
    if (fila.idSolicitante === ctx.idOperador) a.push('AUTOSOLICITUD');
    const u = [...ctx.usuarios.values()].find((x) => x.id === fila.idSolicitante);
    if (u && fila.idCompany && !u.empresas.includes(fila.idCompany)) a.push('SOLICITANTE_OTRA_EMPRESA');
  }
  if (!fila.idProcess) a.push('SIN_PROCESO');
  return a;
}

/** Lo que el navegador puede enviar al crear: solo los campos EDITABLES; el resto se relee de Graph. */
export interface FilaCrear {
  conversationId: string;
  mensajeId: string;
  idCompany: number;
  idProcess: number;
  idSolicitante: string;
  titulo: string;
  descripcion: string;
  adjuntosIds: string[];
  etiquetar: boolean;
}

const ID_USER_RE = /^[A-Za-z0-9_-]{1,50}$/;
const GRAPH_ID_RE = /^[A-Za-z0-9+=_-]{8,512}$/;

export function parseFilaCrear(body: unknown): FilaCrear {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const num = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const conversationId = String(b.conversationId ?? '');
  const mensajeId = String(b.mensajeId ?? '');
  const idCompany = num(b.idCompany);
  const idProcess = num(b.idProcess);
  const idSolicitante = String(b.idSolicitante ?? '');
  const titulo = String(b.titulo ?? '').replace(/\s+/g, ' ').trim();
  const descripcion = String(b.descripcion ?? '').trim();
  if (!GRAPH_ID_RE.test(conversationId) || !GRAPH_ID_RE.test(mensajeId)) throw new CorreoError('Correo inválido.', 400);
  if (!idCompany) throw new CorreoError('Elija la empresa.', 400);
  if (!idProcess) throw new CorreoError('Elija el proceso.', 400);
  if (!ID_USER_RE.test(idSolicitante)) throw new CorreoError('Elija el solicitante (usuario de SynerLink).', 400);
  if (titulo.length < 3) throw new CorreoError('El título es obligatorio.', 400);
  if (descripcion.length < 3) throw new CorreoError('La descripción es obligatoria.', 400);
  const adjuntosIds = Array.isArray(b.adjuntosIds) ? b.adjuntosIds.map(String).filter((x) => GRAPH_ID_RE.test(x)).slice(0, 30) : [];
  return {
    conversationId,
    mensajeId,
    idCompany,
    idProcess,
    idSolicitante,
    titulo: titulo.slice(0, CORREO_MAX_ASUNTO),
    descripcion: descripcion.slice(0, CORREO_MAX_DESCRIPCION),
    adjuntosIds,
    etiquetar: b.etiquetar !== false,
  };
}

/** Ids de mensajes seleccionados para simular (únicos, válidos y con tope de lote). */
export function parseSeleccion(body: unknown): string[] {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const ids = Array.isArray(b.mensajesIds) ? [...new Set(b.mensajesIds.map(String))] : [];
  if (ids.length === 0) throw new CorreoError('Seleccione al menos un correo.', 400);
  if (ids.length > CORREO_MAX_LOTE) throw new CorreoError(`Máximo ${CORREO_MAX_LOTE} correos por lote.`, 400);
  if (!ids.every((x) => GRAPH_ID_RE.test(x))) throw new CorreoError('Hay correos inválidos en la selección.', 400);
  return ids;
}

/** Nota de la solicitud con un correo nuevo del hilo (sin el cuerpo completo: solo el extracto). */
export function notaDesdeCorreo(m: MensajeCompleto, max: number): string {
  const cuerpo = htmlATexto(m.html);
  return extracto(`Correo recibido en el hilo vinculado — de ${m.de.nombre} <${m.de.correo}>, ${m.fecha.slice(0, 16).replace('T', ' ')} (UTC).\nAsunto: ${m.asunto}\n\n${cuerpo}`, max);
}

/** Nota de la solicitud con una respuesta enviada desde SynerLink. */
export function notaDesdeRespuesta(p: { operador: string; para: string[]; texto: string; adjuntos: string[]; todos: boolean; automatica?: boolean }, max: number): string {
  const adj = p.adjuntos.length ? `\nAdjuntos: ${p.adjuntos.join(', ')}` : '';
  return extracto(
    `${p.automatica ? 'Respuesta automática (acuse de creación del caso)' : 'Respuesta'} enviada desde SynerLink (módulo Correo) por ${p.operador}${p.todos ? ' a todos' : ''}${p.para.length ? ` — para: ${p.para.join(', ')}` : ''}.${adj}\n\n${p.texto.trim()}`,
    max
  );
}
