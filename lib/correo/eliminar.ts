import { createHmac, timingSafeEqual } from 'node:crypto';
import { invalidarHilo } from './cacheHilo';
import { CORREO_DESHACER_VIGENCIA_MS, CORREO_MAX_ELIMINAR_SELECCION } from './constants';
import * as data from './db';
import type { AccesoCorreo } from './db';
import { CorreoError } from './errors';
import { assertGraphId } from './graph';
import { proveedorDe, type CorreoDeps } from './service';
import type { UbicacionMensaje } from './types';

/**
 * Eliminar correos (deslizar a la izquierda, botón al pasar el mouse o la barra de selección; 2026-10-18,
 * pedido de Nicolás Rivera). Reglas:
 *
 * - NUNCA se borra de forma permanente: el correo se MUEVE a «Elementos eliminados» (Graph `move` a
 *   `deleteditems`). Un correo que ya está en Elementos eliminados no se toca.
 * - Solo el buzón de la sesión: los ids vienen del navegador, pero cada uno se consulta primero en
 *   /users/{correo de la sesión}/messages/{id} (pertenencia); un id de otro buzón no existe ahí y se informa
 *   como fallido sin mover nada. Ninguna ruta acepta un buzón del cliente.
 * - «Deshacer»: la respuesta trae un comprobante FIRMADO (HMAC con NEXTAUTH_SECRET) con la persona, el buzón,
 *   el id nuevo de cada correo en Elementos eliminados y su carpeta de origen, que salen del servidor. Así el
 *   navegador no puede pedir que se mueva otro correo ni a otra carpeta; vence a los 5 minutos.
 * - Hilos vinculados a una solicitud o a un proyecto: se pide confirmación (409 VINCULADO con el detalle). Si
 *   la persona confirma, se mueve igual y el vínculo SE CONSERVA: la solicitud ya tiene su copia (origen y
 *   notas) y Graph sigue encontrando el hilo en Elementos eliminados, así que «Deshacer» o restaurarlo desde
 *   Outlook lo deja como estaba.
 * - Interruptores: CORREO_ETIQUETAR_HABILITADO (escritura en el buzón) y CORREO_ELIMINAR_HABILITADO; el de
 *   envío (CORREO_ENVIO_HABILITADO) no aplica porque eliminar no envía nada.
 * - Auditoría: un registro ELIMINAR / RESTAURAR por correo (Message-ID, hilo, carpeta de origen, solicitud).
 */

export interface VinculoEliminar {
  mensajeId: string;
  conversationId: string;
  idRequest: number | null;
  proyectos: string[];
}

export type ResultadoEliminar =
  | { requiereConfirmacion: true; vinculos: VinculoEliminar[] }
  | {
      requiereConfirmacion: false;
      /** id con que lo pidió el navegador → id nuevo en Elementos eliminados. */
      eliminados: Array<{ id: string; nuevoId: string }>;
      /** Ya estaban en Elementos eliminados: no se tocan (nunca se borran de forma permanente). */
      yaEnEliminados: string[];
      /** No existen en el buzón de la sesión o Microsoft no pudo moverlos. */
      fallidos: string[];
      /** Comprobante firmado para «Deshacer» (null si no se movió nada). */
      deshacer: string | null;
      venceEn: string | null;
    };

export interface ResultadoDeshacer {
  /** id en Elementos eliminados → id nuevo, ya de vuelta en su carpeta. */
  restaurados: Array<{ id: string; nuevoId: string }>;
  fallidos: string[];
}

/** Eliminar escribe en el buzón (Mail.ReadWrite): exige la escritura general y su propio interruptor. */
export function eliminarHabilitado(d: CorreoDeps): boolean {
  return d.cfg.etiquetarHabilitado && d.cfg.eliminarHabilitado;
}

function exigirEliminar(d: CorreoDeps): void {
  if (!eliminarHabilitado(d)) throw new CorreoError('Eliminar correos no está habilitado en este ambiente.', 403);
}

function buzon(acceso: AccesoCorreo): string {
  return acceso.email.toLowerCase();
}

const ahora = (d: CorreoDeps) => (d.now ? d.now() : Date.now());

// ---------------------------------------------------------------------------
// Comprobante de «Deshacer» (firmado; sin estado en la base)
// ---------------------------------------------------------------------------

interface Comprobante {
  v: 1;
  /** Usuario de SynerLink. */
  u: string;
  /** Buzón de la sesión. */
  b: string;
  /** Vence (ms). */
  e: number;
  /** [id en Elementos eliminados, carpeta de origen]. */
  i: Array<[string, string]>;
}

function llave(d: CorreoDeps): Buffer {
  const secreto = String(d.secretoFirma ?? '');
  if (secreto.length < 16) throw new CorreoError('«Deshacer» no está configurado en este ambiente (falta el secreto del servidor). Avise a Tecnología.', 503);
  // Llave derivada solo para este uso: el secreto de NextAuth no firma nada más del módulo.
  return createHmac('sha256', secreto).update('synerlink-correo-deshacer-v1').digest();
}

export function firmarComprobante(d: CorreoDeps, c: Comprobante): string {
  const cuerpo = Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
  return `${cuerpo}.${createHmac('sha256', llave(d)).update(cuerpo).digest('base64url')}`;
}

export function leerComprobante(d: CorreoDeps, acceso: AccesoCorreo, token: unknown): Comprobante {
  const invalido = () => new CorreoError('El aviso para deshacer ya no es válido. Busque el correo en la Papelera (Elementos eliminados).', 400, 'DESHACER_INVALIDO');
  const t = typeof token === 'string' ? token : '';
  if (t.length > 120_000) throw invalido();
  const [cuerpo, firma, ...resto] = t.split('.');
  if (!cuerpo || !firma || resto.length) throw invalido();
  const esperada = createHmac('sha256', llave(d)).update(cuerpo).digest();
  const recibida = Buffer.from(firma, 'base64url');
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) throw invalido();
  let c: Comprobante;
  try {
    c = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as Comprobante;
  } catch {
    throw invalido();
  }
  // De otra persona o de otro buzón: 403 (aunque la firma sea buena, solo sirve a quien eliminó).
  if (c?.v !== 1 || !Array.isArray(c.i)) throw invalido();
  if (c.u !== acceso.idUser || c.b !== buzon(acceso)) throw new CorreoError('Ese aviso para deshacer no es de su buzón.', 403);
  if (!(Number(c.e) > ahora(d))) throw new CorreoError('Pasó el tiempo para deshacer. Busque el correo en la Papelera (Elementos eliminados).', 410, 'DESHACER_VENCIDO');
  return c;
}

// ---------------------------------------------------------------------------
// Eliminar
// ---------------------------------------------------------------------------

function idsValidos(ids: unknown[]): string[] {
  const unicos = [...new Set(ids.map((x) => String(x ?? '').trim()))].filter(Boolean);
  if (unicos.length === 0) throw new CorreoError('Seleccione al menos un correo.', 400);
  if (unicos.length > CORREO_MAX_ELIMINAR_SELECCION) throw new CorreoError(`Máximo ${CORREO_MAX_ELIMINAR_SELECCION} correos por vez.`, 400);
  return unicos.map((id) => assertGraphId(id));
}

function detalleVinculo(v: VinculoEliminar | undefined): string {
  if (!v) return '';
  const partes: string[] = [];
  if (v.idRequest) partes.push(`hilo vinculado a la solicitud #${v.idRequest}`);
  if (v.proyectos.length) partes.push(`hilo vinculado a ${v.proyectos.length === 1 ? 'el proyecto' : 'los proyectos'} ${v.proyectos.join(', ')}`);
  return partes.length ? `; ${partes.join('; ')} (el vínculo se conserva)` : '';
}

export async function eliminarMensajes(
  d: CorreoDeps,
  acceso: AccesoCorreo,
  idsEntrada: unknown[],
  opciones: { confirmarVinculados: boolean },
  ip: string | null
): Promise<ResultadoEliminar> {
  exigirEliminar(d);
  const ids = idsValidos(idsEntrada);
  llave(d); // Sin «Deshacer» no se elimina: se verifica ANTES de mover nada.
  const prov = await proveedorDe(d, acceso);

  // 1. Pertenencia al buzón de la sesión y carpeta actual (para volver a ella al deshacer).
  const [ubicaciones, idEliminados] = await Promise.all([prov.ubicarMensajes(ids), prov.idCarpetaEliminados()]);
  const fallidos: string[] = [];
  const yaEnEliminados: string[] = [];
  const mover: Array<{ id: string; u: UbicacionMensaje }> = [];
  for (const id of ids) {
    const u = ubicaciones.get(id) ?? null;
    if (!u) fallidos.push(id);
    else if (u.carpetaId === idEliminados) yaEnEliminados.push(id);
    else mover.push({ id, u });
  }
  // Ninguno existe en el buzón de la sesión (p. ej. ids de otro buzón): 404, sin mover nada.
  if (fallidos.length === ids.length) throw new CorreoError('No se encontró el correo en su buzón (pudo moverse o borrarse).', 404);

  // 2. Hilos vinculados (solicitud propia o proyecto del mismo buzón): confirmación explícita.
  const hilos = [...new Set(mover.map((x) => x.u.conversationId).filter(Boolean))];
  const [solicitudes, proyectos] = hilos.length
    ? await Promise.all([data.vinculosDeHilos(d.db, acceso.idUser, hilos), data.proyectosDeHilos(d.db, buzon(acceso), hilos)])
    : [new Map(), new Map<string, string[]>()];
  const vinculos = new Map<string, VinculoEliminar>();
  for (const { id, u } of mover) {
    const idRequest = solicitudes.get(u.conversationId)?.idRequest ?? null;
    const enProyectos = proyectos.get(u.conversationId) ?? [];
    if (idRequest || enProyectos.length) vinculos.set(id, { mensajeId: id, conversationId: u.conversationId, idRequest, proyectos: enProyectos });
  }
  if (vinculos.size && !opciones.confirmarVinculados) return { requiereConfirmacion: true, vinculos: [...vinculos.values()] };

  // 3. Mover a Elementos eliminados (nombre conocido de Graph). Nada se borra.
  const nuevos = mover.length ? await prov.moverMensajes(mover.map((x) => x.id), 'deleteditems') : new Map<string, string | null>();
  const eliminados: Array<{ id: string; nuevoId: string }> = [];
  const comprobante: Array<[string, string]> = [];
  for (const { id, u } of mover) {
    const nuevoId = nuevos.get(id) ?? null;
    if (!nuevoId) {
      fallidos.push(id);
      continue;
    }
    eliminados.push({ id, nuevoId });
    comprobante.push([nuevoId, u.carpetaId]);
  }
  if (eliminados.length) {
    invalidarHilo(acceso.idUser);
    const porId = new Map(mover.map((x) => [x.id, x.u]));
    await Promise.all(
      eliminados.map(({ id }) => {
        const u = porId.get(id)!;
        const v = vinculos.get(id);
        return data.auditar(d.db, {
          idUser: acceso.idUser,
          mailbox: buzon(acceso),
          accion: 'ELIMINAR',
          mensajeId: id,
          conversationId: u.conversationId || null,
          internetMessageId: u.internetMessageId || null,
          idRequest: v?.idRequest ?? null,
          detalle: `Movido a Elementos eliminados (sin borrar) desde la carpeta ${u.carpetaId}${detalleVinculo(v)}`,
          ip,
        });
      })
    );
  }
  const vence = ahora(d) + CORREO_DESHACER_VIGENCIA_MS;
  return {
    requiereConfirmacion: false,
    eliminados,
    yaEnEliminados,
    fallidos,
    deshacer: comprobante.length ? firmarComprobante(d, { v: 1, u: acceso.idUser, b: buzon(acceso), e: vence, i: comprobante }) : null,
    venceEn: comprobante.length ? new Date(vence).toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Deshacer
// ---------------------------------------------------------------------------

/**
 * Devuelve a su carpeta de origen los correos del comprobante, SOLO si siguen en Elementos eliminados del buzón
 * de la sesión (si la persona ya los movió o vació la papelera, no se tocan y salen como fallidos).
 */
export async function deshacerEliminar(d: CorreoDeps, acceso: AccesoCorreo, token: unknown, ip: string | null): Promise<ResultadoDeshacer> {
  exigirEliminar(d);
  const c = leerComprobante(d, acceso, token);
  const items = c.i
    .filter((x): x is [string, string] => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string')
    .slice(0, CORREO_MAX_ELIMINAR_SELECCION)
    .map(([id, origen]) => [assertGraphId(id), assertGraphId(origen, 'identificador de carpeta')] as const);
  if (items.length === 0) return { restaurados: [], fallidos: [] };
  const prov = await proveedorDe(d, acceso);
  const [ubicaciones, idEliminados] = await Promise.all([prov.ubicarMensajes(items.map((x) => x[0])), prov.idCarpetaEliminados()]);
  const fallidos: string[] = [];
  const porOrigen = new Map<string, string[]>();
  for (const [id, origen] of items) {
    if (ubicaciones.get(id)?.carpetaId !== idEliminados) {
      fallidos.push(id);
      continue;
    }
    porOrigen.set(origen, [...(porOrigen.get(origen) ?? []), id]);
  }
  const restaurados: Array<{ id: string; nuevoId: string }> = [];
  for (const [origen, ids] of porOrigen) {
    const nuevos = await prov.moverMensajes(ids, origen);
    for (const id of ids) {
      const nuevoId = nuevos.get(id) ?? null;
      if (nuevoId) restaurados.push({ id, nuevoId });
      else fallidos.push(id);
    }
  }
  if (restaurados.length) {
    invalidarHilo(acceso.idUser);
    const origenDe = new Map(items.map(([id, o]) => [id, o]));
    await Promise.all(
      restaurados.map(({ id }) => {
        const u = ubicaciones.get(id);
        return data.auditar(d.db, {
          idUser: acceso.idUser,
          mailbox: buzon(acceso),
          accion: 'RESTAURAR',
          mensajeId: id,
          conversationId: u?.conversationId || null,
          internetMessageId: u?.internetMessageId || null,
          detalle: `«Deshacer»: devuelto de Elementos eliminados a la carpeta ${origenDe.get(id)}`,
          ip,
        });
      })
    );
  }
  return { restaurados, fallidos };
}
