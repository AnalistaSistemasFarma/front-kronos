import 'server-only';
import { PRUEBAS_MANUALES, esUrlProduccionNabuco } from './constants';
import { NabucoError, registrarPruebaManual, type NabucoConfig } from './db';
import { descifrarSecreto } from './cifrado';
import { resolverConexionPrueba } from './conexionPrueba';
import { NabucoDiagnosticoError, diagnosticoInterno, resumenDiagnostico, serializarDiagnostico, type DiagnosticoNabuco } from './diagnostico';
import { conexionNabuco, identidadToken } from './motor';
import { pedirTokenDetalle, urlSolicitudes, urlToken } from './nabucoClient';
import { enviarConToken, renovarToken, type OpcionesToken } from './tokenCache';

/**
 * Pruebas manuales contra Nabuco (pestaña «Pruebas manuales», solo administradores).
 * - Ignoran el modo simulación (es un envío explícito) y NO tocan nabuco_envio: no afectan
 *   la idempotencia del envío automático.
 * - Cada prueba queda en nabuco_prueba_manual (sin token ni contraseña). Si la tabla aún no
 *   existe (script sin correr), la prueba se hace igual y solo se avisa en el log.
 */

export interface ResultadoPrueba {
  ok: boolean;
  url: string;
  http_status: number | null;
  duracion_ms: number;
  respuesta: string | null;
  error: string | null;
  id_prueba: number | null;
  diagnostico: DiagnosticoNabuco;
  /** «Probar conexión»: true si se probó con datos de pantalla que difieren de lo guardado. */
  usaCambiosSinGuardar?: boolean;
}

function diagnosticoDe(e: unknown, inicio: number): DiagnosticoNabuco {
  if (e instanceof NabucoDiagnosticoError) return e.diagnostico;
  if (e instanceof NabucoError) return { ok: false, etapa: 'validacion', mensaje: e.message, duracion_ms: Date.now() - inicio, cuando: new Date().toISOString() };
  return diagnosticoInterno(e, inicio);
}

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function urlSegura(f: () => string, cfg: NabucoConfig): string {
  try {
    return f();
  } catch {
    return cfg.nabuco_url ?? '';
  }
}

async function registrar(...args: Parameters<typeof registrarPruebaManual>): Promise<number | null> {
  try {
    return await registrarPruebaManual(...args);
  } catch (e) {
    console.warn('[transferencias-nabuco] no se pudo registrar la prueba manual (¿falta correr el script 2026-10-26?):', mensaje(e));
    return null;
  }
}

/** Valida el texto del editor: JSON bien formado (objeto o lista) y de tamaño razonable. */
export function validarCuerpoManual(raw: unknown): string {
  const texto = typeof raw === 'string' ? raw : raw !== undefined && raw !== null ? JSON.stringify(raw) : '';
  if (!texto.trim()) throw new NabucoError('Escriba o arme el JSON a enviar.');
  if (texto.length > PRUEBAS_MANUALES.maxPayload) throw new NabucoError('El JSON supera 1 000 000 de caracteres.');
  let v: unknown;
  try {
    v = JSON.parse(texto);
  } catch (e) {
    throw new NabucoError(`El JSON no es válido: ${mensaje(e)}`);
  }
  if (!v || typeof v !== 'object') throw new NabucoError('El JSON debe ser un objeto o una lista.');
  return texto;
}

/** Regla del servidor: a producción de Nabuco solo con `confirmoProduccion: true`. */
export function exigirConfirmacionProduccion(url: string | null, confirmo: unknown): void {
  if (esUrlProduccionNabuco(url) && confirmo !== true) {
    throw new NabucoError(`La URL de esta configuración es la de PRODUCCIÓN de Nabuco (${PRUEBAS_MANUALES.hostProduccion}). Confirme escribiendo ${PRUEBAS_MANUALES.palabraProduccion} para enviar.`, 409);
  }
}

/**
 * «Probar conexión» con registro tipo 'conexion' (sin payload). Siempre pide token nuevo.
 * `pantalla` = datos del formulario sin guardar (ver conexionPrueba.ts). La caché de token de la
 * config SOLO se actualiza si lo probado coincide con lo guardado. Errores de validación de los
 * datos (faltan, URL o protocolo inválidos) se lanzan (NabucoDiagnosticoError etapa 'validacion').
 */
export async function probarConexionRegistrada(cfg: NabucoConfig, usuario: string, pantalla: Record<string, unknown> | null = null, opts: OpcionesToken = {}): Promise<ResultadoPrueba> {
  const { conexion, usaCambiosSinGuardar } = resolverConexionPrueba(cfg, pantalla, descifrarSecreto);
  const inicio = Date.now();
  let diagnostico: DiagnosticoNabuco;
  try {
    diagnostico = usaCambiosSinGuardar ? (await pedirTokenDetalle(conexion, opts.fetcher)).diagnostico : (await renovarToken(identidadToken(cfg), conexion, opts)).diagnostico;
  } catch (e) {
    diagnostico = diagnosticoDe(e, inicio);
  }
  const http = diagnostico.respuesta?.http_status ?? null;
  const error = diagnostico.ok ? null : resumenDiagnostico(diagnostico);
  const url = urlSegura(() => urlToken(conexion), cfg);
  const id = await registrar({ idConfig: cfg.id_config, idCompany: cfg.id_company, usuario, tipo: 'conexion', docEntry: null, url, payload: null, httpStatus: http, duracionMs: diagnostico.duracion_ms, respuesta: serializarDiagnostico(diagnostico), error });
  return { ok: diagnostico.ok, url, http_status: http, duracion_ms: diagnostico.duracion_ms, respuesta: null, error, id_prueba: id, diagnostico, usaCambiosSinGuardar };
}

/** Envía el JSON TAL CUAL a la ruta de solicitudes con el token en caché (401 → token nuevo y un reintento). */
export async function enviarPruebaManual(
  cfg: NabucoConfig,
  usuario: string,
  cuerpoJson: string,
  docEntry: number | null,
  opts: OpcionesToken = {}
): Promise<ResultadoPrueba> {
  const url = urlSegura(() => urlSolicitudes(conexionNabuco(cfg)), cfg);
  const inicio = Date.now();
  let respuesta: string | null = null;
  let diagnostico: DiagnosticoNabuco;
  try {
    const r = await enviarConToken(identidadToken(cfg), conexionNabuco(cfg), cuerpoJson, { ...opts, maxCuerpo: PRUEBAS_MANUALES.maxRespuesta });
    respuesta = r.cuerpo;
    diagnostico = r.diagnostico;
  } catch (e) {
    diagnostico = diagnosticoDe(e, inicio);
  }
  const http = diagnostico.respuesta?.http_status ?? null;
  const error = diagnostico.ok ? null : resumenDiagnostico(diagnostico);
  const duracion = Date.now() - inicio;
  const id = await registrar({ idConfig: cfg.id_config, idCompany: cfg.id_company, usuario, tipo: 'envio', docEntry, url, payload: cuerpoJson, httpStatus: http, duracionMs: duracion, respuesta: serializarDiagnostico(diagnostico), error });
  return { ok: diagnostico.ok, url, http_status: http, duracion_ms: duracion, respuesta, error, id_prueba: id, diagnostico };
}
