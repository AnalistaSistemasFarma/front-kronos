import 'server-only';
import { sapGet, sapLogout, type SapSession } from '../sap/serviceLayer';
import { ASISTIDA, coleccionLineas } from './constants';
import { NabucoError, enviosPrevios, soltarLock, tomarLock, type NabucoConfig } from './db';
import { problemasArmado } from './mapeo';
import type { DiagnosticoNabuco } from './diagnostico';
import { abrirSap, conexionNabuco, identidadToken, procesarDocumento, rutaCandidatos, type ContextoEnvio } from './motor';
import { exigirConfirmacionProduccion } from './pruebas';
import type { EnvioPrevio } from './seleccion';
import { obtenerToken } from './tokenCache';
import { ordenarPendientes, type DocSap, type DocPendiente } from './asistidaReglas';

export * from './asistidaReglas';

/**
 * Transferencia asistida (pestaña «Pruebas manuales»): Buscar pendientes → Simular → Crear.
 * Reutiliza el motor: mismo filtro de candidatos, mismo armado por mapeo, mismo envío con token
 * en caché, mismo registro en nabuco_envio (nunca pisa un 'enviado') y mismas alertas.
 * Simular y Crear toman el lock de la config (en_ejecucion_desde): no corren en paralelo con una
 * corrida automática ni con «Ejecutar ahora».
 */

export interface ResultadoSimular {
  docEntry: number;
  docNum: number | null;
  ok: boolean;
  payload?: Record<string, unknown> | null;
  error?: string | null;
  diagnostico?: DiagnosticoNabuco | null;
}

export interface ResultadoCrear {
  docEntry: number;
  docNum: number | null;
  estado: 'enviado' | 'error' | 'ya_enviado' | 'omitido';
  http_status?: number | null;
  respuesta?: string | null;
  error?: string | null;
  id_envio?: number | null;
  diagnostico?: DiagnosticoNabuco | null;
}

const MENSAJE_OCUPADA = 'Hay una corrida de esta configuración en curso (automática, «Ejecutar ahora» u otra acción manual). Espere a que termine e intente de nuevo.';

async function conLockYSap<T>(cfg: NabucoConfig, fn: (session: SapSession) => Promise<T>): Promise<T> {
  if (!(await tomarLock(cfg.id_config))) throw new NabucoError(MENSAJE_OCUPADA, 409);
  let session: SapSession | null = null;
  try {
    session = await abrirSap(cfg);
    return await fn(session);
  } finally {
    if (session) await sapLogout(session).catch(() => undefined);
    await soltarLock(cfg.id_config);
  }
}

function validador(cfg: NabucoConfig): ContextoEnvio['validar'] {
  return (doc) => {
    const p = problemasArmado(doc, cfg.entidad_sap, cfg.mapeo_encabezado, cfg.mapeo_lineas);
    return p.length ? p.join(' ') : null;
  };
}

/** Estado previo en el log que impide simular/crear (enviado o descartado). */
function bloqueo(previo: EnvioPrevio | undefined): ResultadoCrear['estado'] | null {
  if (previo?.estado === 'enviado') return 'ya_enviado';
  if (previo?.estado === 'descartado') return 'omitido';
  return null;
}

/**
 * Documentos de SAP de la config (mismo filtro del motor) que NO están enviados ni descartados,
 * del más reciente al más antiguo. Recorre SAP por páginas ($select acotado) hasta juntar
 * `limite` + 1 (para saber si hay más) o agotar ASISTIDA.escaneoMax documentos.
 */
export async function buscarPendientes(cfg: NabucoConfig, limite: number): Promise<{ documentos: DocPendiente[]; hayMas: boolean }> {
  const campos = ['DocEntry', 'DocNum', 'DocDate', 'CardName', ...(coleccionLineas(cfg.entidad_sap) === 'DocumentLines' ? ['DocTotal'] : [])];
  const pagina = Math.min(500, Math.max(50, limite * 2));
  const session = await abrirSap(cfg);
  try {
    const out: DocPendiente[] = [];
    let hayMas = false;
    for (let skip = 0; ; skip += pagina) {
      if (skip >= ASISTIDA.escaneoMax) {
        hayMas = true; // quedan documentos sin revisar
        break;
      }
      const ruta = rutaCandidatos(cfg, { $select: campos.join(','), $orderby: 'DocDate desc,DocEntry desc', $top: String(pagina), $skip: String(skip) });
      const page = await sapGet<{ value?: DocSap[] }>(session, ruta, { Prefer: `odata.maxpagesize=${pagina}` });
      const filas = page.value ?? [];
      const previos = await enviosPrevios(cfg.id_company, cfg.entidad_sap, filas.map((f) => f.DocEntry));
      out.push(...ordenarPendientes(filas, previos));
      if (out.length > limite) {
        hayMas = true;
        break;
      }
      if (filas.length < pagina) break;
    }
    return { documentos: ordenarPendientes(out, []).slice(0, limite), hayMas };
  } finally {
    await sapLogout(session).catch(() => undefined);
  }
}

/** Simular: arma (sin enviar) y registra 'simulado' los documentos válidos; reporta los errores de armado. */
export async function simularDocumentos(cfg: NabucoConfig, docEntries: number[], usuario: string): Promise<ResultadoSimular[]> {
  return conLockYSap(cfg, async (session) => {
    const previos = new Map((await enviosPrevios(cfg.id_company, cfg.entidad_sap, docEntries)).map((p) => [p.doc_entry, p]));
    const ident = identidadToken(cfg);
    const out: ResultadoSimular[] = [];
    for (const docEntry of docEntries) {
      const b = bloqueo(previos.get(docEntry));
      if (b) {
        out.push({ docEntry, docNum: null, ok: false, error: b === 'ya_enviado' ? 'Ya fue enviado a Nabuco.' : 'Está descartado en el log de envíos.' });
        continue;
      }
      const r = await procesarDocumento(cfg, session, { DocEntry: docEntry }, { conexion: null, ident, usuario, simular: true, validar: validador(cfg) });
      out.push({ docEntry, docNum: r.docNum, ok: r.estado === 'simulado', payload: r.payload, error: r.error, diagnostico: r.diagnostico ?? null });
    }
    return out;
  });
}

/**
 * Crear: envía DE VERDAD (ignora el modo simulación de la config; solo desde este botón), uno por
 * uno y con el token reutilizado. Vuelve a leer y validar cada documento en SAP; justo antes de
 * enviarlo revisa el log y, si ya está 'enviado' (carrera), NO lo reenvía. A producción de Nabuco
 * solo con confirmoProduccion === true.
 */
export async function crearDocumentos(cfg: NabucoConfig, docEntries: number[], usuario: string, confirmoProduccion: unknown): Promise<ResultadoCrear[]> {
  exigirConfirmacionProduccion(cfg.nabuco_url, confirmoProduccion);
  const conexion = conexionNabuco(cfg);
  return conLockYSap(cfg, async (session) => {
    const ident = identidadToken(cfg);
    // Falla temprano si las credenciales no sirven: NabucoDiagnosticoError → la ruta responde 200 ok:false con el diagnóstico.
    await obtenerToken(ident, conexion);
    const out: ResultadoCrear[] = [];
    for (const docEntry of docEntries) {
      const [previo] = await enviosPrevios(cfg.id_company, cfg.entidad_sap, [docEntry]);
      const b = bloqueo(previo);
      if (b) {
        out.push({ docEntry, docNum: null, estado: b, error: b === 'ya_enviado' ? 'Ya estaba enviado: no se reenvió.' : 'Está descartado en el log de envíos: no se envió.' });
        continue;
      }
      const r = await procesarDocumento(cfg, session, { DocEntry: docEntry }, { conexion, ident, usuario, simular: false, validar: validador(cfg) });
      out.push({
        docEntry,
        docNum: r.docNum,
        estado: r.estado === 'simulado' ? 'omitido' : r.estado,
        http_status: r.http_status,
        respuesta: r.respuesta ? r.respuesta.slice(0, 2000) : null,
        error: r.error,
        id_envio: r.id_envio,
        diagnostico: r.diagnostico ?? null,
      });
    }
    return out;
  });
}
