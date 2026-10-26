import 'server-only';
import { sapGet, sapGetAll, sapLogin, sapLogout, sapPatch, type SapSession } from '../sap/serviceLayer';
import { getEndpointSap } from './access';
import { descifrarSecreto } from './cifrado';
import { enviarAlerta } from './alertas';
import {
  NabucoError,
  enviosPrevios,
  marcarAlertaEnviada,
  obtenerConfig,
  pendientesDeConfig,
  registrarResultado,
  soltarLock,
  tomarLock,
  type NabucoConfig,
} from './db';
import { construirPayload } from './mapeo';
import { type NabucoConexion } from './nabucoClient';
import { enviarConToken, obtenerToken, renovarToken, type IdentidadToken } from './tokenCache';
import { filtroCandidatos, reintentosAgotados, seleccionarDocumentos, type DocCandidato } from './seleccion';

/**
 * Motor de Transferencias Nabuco: lee documentos de SAP (Service Layer, cliente común
 * lib/sap/serviceLayer), arma el payload con el mapeo configurado y lo envía a Nabuco
 * (o solo lo registra en modo simulación). En SAP solo escribe por Service Layer y
 * únicamente si la config tiene «marcar UDF» encendido.
 */

export interface ResumenCorrida {
  encontrados: number;
  procesados: number;
  enviados: number;
  errores: number;
  simulados: number;
  omitido?: string;
}

export function textoResumen(r: ResumenCorrida, simulacion: boolean): string {
  if (r.omitido) return r.omitido;
  return `${simulacion ? '[SIMULACIÓN] ' : ''}Encontrados ${r.encontrados}, procesados ${r.procesados}: enviados ${r.enviados}, errores ${r.errores}, simulados ${r.simulados}.`;
}

export function conexionNabuco(cfg: NabucoConfig): NabucoConexion {
  if (!cfg.nabuco_url || !cfg.nabuco_usuario || !cfg.nabuco_password_enc) {
    throw new NabucoError('Faltan la URL, el usuario o la contraseña de Nabuco en la configuración.');
  }
  return {
    url: cfg.nabuco_url,
    usuario: cfg.nabuco_usuario,
    password: descifrarSecreto(cfg.nabuco_password_enc),
    org: cfg.nabuco_org,
    rutaToken: cfg.ruta_token,
    rutaSolicitudes: cfg.ruta_solicitudes,
    timeoutMs: cfg.timeout_ms,
  };
}

/** Identidad del token en caché (id_config + URL + usuario + hash de la contraseña cifrada). */
export function identidadToken(cfg: NabucoConfig): IdentidadToken {
  return { idConfig: cfg.id_config, url: cfg.nabuco_url ?? '', usuario: cfg.nabuco_usuario ?? '', passwordEnc: cfg.nabuco_password_enc ?? '' };
}

async function abrirSap(cfg: NabucoConfig): Promise<SapSession> {
  const ep = await getEndpointSap(cfg.id_company, cfg.id_sap_endpoint);
  if (!ep) throw new NabucoError('La empresa no tiene una conexión SAP (sap_endpoints) válida para esta configuración.');
  return sapLogin(ep);
}

function q(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

async function leerDocumento(session: SapSession, entidad: string, docEntry: number): Promise<Record<string, unknown>> {
  return sapGet<Record<string, unknown>>(session, `${entidad}(${Math.trunc(docEntry)})`);
}

/** «Probar conexión»: SIEMPRE pide token nuevo a Nabuco (y actualiza la caché); no envía nada. */
export async function probarConexion(cfg: NabucoConfig): Promise<{ status: number }> {
  return renovarToken(identidadToken(cfg), conexionNabuco(cfg));
}

/** Vista previa del payload de un DocEntry (sin enviar nada). */
export async function vistaPrevia(cfg: NabucoConfig, docEntry: number): Promise<Record<string, unknown>> {
  const session = await abrirSap(cfg);
  try {
    const doc = await leerDocumento(session, cfg.entidad_sap, docEntry);
    return construirPayload(doc, cfg.entidad_sap, cfg.mapeo_encabezado, cfg.mapeo_lineas, cfg.clave_lineas);
  } finally {
    await sapLogout(session).catch(() => undefined);
  }
}

async function alertarFallo(cfg: NabucoConfig, doc: DocCandidato, idEnvio: number, intentos: number, error: string): Promise<void> {
  if (!cfg.alertar_fallo || !cfg.alertas_correos.length) return;
  const n = await enviarAlerta(
    cfg.alertas_correos,
    `Falló el envío del documento ${doc.DocNum ?? doc.DocEntry}`,
    [
      { Configuración: cfg.nombre },
      { Entidad: cfg.entidad_sap },
      { DocEntry: String(doc.DocEntry) },
      { DocNum: String(doc.DocNum ?? '') },
      { Intentos: String(intentos) },
      { Error: error.slice(0, 500) },
    ],
    'Se agotaron los reintentos automáticos. Revise el envío en SynerLink → Transferencias Nabuco y use «Reintentar» o «Descartar».'
  );
  if (n > 0) await marcarAlertaEnviada(idEnvio);
}

export interface OpcionesCorrida {
  /** Usuario que disparó a mano («Ejecutar ahora» / «Enviar ahora»); null = programador. */
  usuario?: string | null;
  /** Procesa solo este DocEntry («Enviar ahora» desde el tablero). */
  soloDocEntry?: number | null;
}

/** Corre UNA configuración con lock propio (dos corridas de la misma config nunca se pisan). */
export async function correrConfig(idConfig: number, opts: OpcionesCorrida = {}): Promise<ResumenCorrida & { simulacion: boolean }> {
  const cfg = await obtenerConfig(idConfig);
  if (!cfg) throw new NabucoError(`No existe la configuración ${idConfig}.`, 404);
  const base = { encontrados: 0, procesados: 0, enviados: 0, errores: 0, simulados: 0, simulacion: cfg.modo_simulacion };
  if (!cfg.activo && !opts.usuario) return { ...base, omitido: 'Configuración pausada: no se ejecutó.' };
  if (!(await tomarLock(idConfig))) return { ...base, omitido: 'Otra corrida de esta configuración está en curso: se omitió.' };

  let session: SapSession | null = null;
  try {
    session = await abrirSap(cfg);
    let candidatos: DocCandidato[];
    if (opts.soloDocEntry) {
      candidatos = [{ DocEntry: opts.soloDocEntry }];
    } else {
      const params: Record<string, string> = { $select: 'DocEntry,DocNum', $orderby: 'DocEntry asc' };
      const filtro = filtroCandidatos(cfg.desde_fecha, cfg.filtro_odata);
      if (filtro) params.$filter = filtro;
      candidatos = await sapGetAll<DocCandidato>(session, `${cfg.entidad_sap}?${q(params)}`, { cap: 20000 });
      // Los pendientes/errores del log se reintentan aunque ya no salgan en la consulta.
      candidatos.push(...(await pendientesDeConfig(cfg.id_config)));
    }
    base.encontrados = candidatos.length;
    const previos = await enviosPrevios(cfg.id_company, cfg.entidad_sap, [...new Set(candidatos.map((c) => c.DocEntry))]);
    const seleccion = seleccionarDocumentos(candidatos, previos, {
      simulacion: cfg.modo_simulacion,
      maxReintentos: cfg.max_reintentos,
      loteMax: opts.soloDocEntry ? 1 : cfg.lote_max,
      ahora: new Date(),
    });
    if (!seleccion.length) return base;

    // Token en la caché del proceso (tokenCache.ts): /AuthBI solo si no hay uno vigente o tras un 401.
    let conexion: NabucoConexion | null = null;
    const ident = identidadToken(cfg);
    if (!cfg.modo_simulacion) {
      conexion = conexionNabuco(cfg);
      await obtenerToken(ident, conexion); // falla temprano si las credenciales no sirven
    }

    for (const cand of seleccion) {
      base.procesados += 1;
      let payloadTxt: string | null = null;
      let docNum = cand.DocNum ?? null;
      try {
        const doc = await leerDocumento(session, cfg.entidad_sap, cand.DocEntry);
        docNum = typeof doc.DocNum === 'number' ? doc.DocNum : docNum;
        const payload = construirPayload(doc, cfg.entidad_sap, cfg.mapeo_encabezado, cfg.mapeo_lineas, cfg.clave_lineas);
        payloadTxt = JSON.stringify(payload);
        if (cfg.modo_simulacion || !conexion) {
          await registrarResultado(cfg, { DocEntry: cand.DocEntry, DocNum: docNum }, { estado: 'simulado', payload: payloadTxt, respuesta: null, http_status: null, error: null, proximoEnMin: null, cuentaIntento: false }, opts.usuario ?? null);
          base.simulados += 1;
          continue;
        }
        const resp = await enviarConToken(ident, conexion, payloadTxt);
        if (resp.ok) {
          let nota: string | null = null;
          if (cfg.marcar_udf && cfg.udf_campo && cfg.udf_valor) {
            try {
              await sapPatch(session, `${cfg.entidad_sap}(${cand.DocEntry})`, { [cfg.udf_campo]: cfg.udf_valor });
            } catch (e) {
              nota = `Enviado a Nabuco, pero no se pudo marcar ${cfg.udf_campo} en SAP: ${e instanceof Error ? e.message : String(e)}`;
            }
          }
          await registrarResultado(cfg, { DocEntry: cand.DocEntry, DocNum: docNum }, { estado: 'enviado', payload: payloadTxt, respuesta: resp.cuerpo, http_status: resp.status, error: nota, proximoEnMin: null, cuentaIntento: true }, opts.usuario ?? null);
          base.enviados += 1;
        } else {
          await registrarFallo(cfg, { DocEntry: cand.DocEntry, DocNum: docNum }, payloadTxt, resp.cuerpo, resp.status, `Nabuco respondió HTTP ${resp.status}`, opts.usuario ?? null);
          base.errores += 1;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await registrarFallo(cfg, { DocEntry: cand.DocEntry, DocNum: docNum }, payloadTxt, null, null, msg, opts.usuario ?? null);
        base.errores += 1;
      }
    }
    return base;
  } finally {
    if (session) await sapLogout(session).catch(() => undefined);
    await soltarLock(idConfig);
  }
}

async function registrarFallo(cfg: NabucoConfig, doc: DocCandidato, payload: string | null, respuesta: string | null, status: number | null, error: string, usuario: string | null) {
  // El próximo intento se calcula después de conocer el total de intentos.
  const r = await registrarResultado(cfg, doc, { estado: 'error', payload, respuesta, http_status: status, error, proximoEnMin: cfg.espera_reintento_min, cuentaIntento: true }, usuario);
  if (r && reintentosAgotados(r.intentos, cfg.max_reintentos)) {
    await alertarFallo(cfg, doc, r.id_envio, r.intentos, error).catch((e) => console.warn('[transferencias-nabuco] alerta:', e instanceof Error ? e.message : e));
  }
}
