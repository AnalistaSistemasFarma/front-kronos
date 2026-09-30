import type { PrismaClient } from '../../app/generated/prisma';
import { readClientOrigin } from './clientOrigin';

/**
 * Registro de auditoría del SGC (sgc.audit_log, SOLO INSERCIÓN: un trigger de
 * la base rechaza UPDATE y DELETE). Quién, qué, cuándo (hora del servidor),
 * desde dónde (IP sin puerto y navegador) y el antes/después.
 */

export const SGC_AUDIT_ACTIONS = {
  documentoCarga: 'documento.carga',
  documentoConsulta: 'documento.consulta',
  documentoDescarga: 'documento.descarga',
  documentoImpresion: 'documento.impresion',
  documentoEdicion: 'documento.edicion',
  documentoAnulacion: 'documento.anulacion',
  accesoOtorgado: 'acceso.otorgado',
  accesoRevocado: 'acceso.revocado',
  maestroCreado: 'maestro.creado',
  maestroEditado: 'maestro.editado',
  guiaCodificacionEditada: 'guia_codificacion.editada',
  accesoDenegado: 'acceso.denegado',
  // Sprint 2: flujos validados, Tareas documentales y Autorizaciones SGC.
  flujoConfigurado: 'flujo.configurado',
  flujoPublicado: 'flujo.publicado',
  matrizEditada: 'matriz.editada',
  autorizacionConfigurada: 'autorizacion.configurada',
  solicitudCreada: 'solicitud.creada',
  solicitudCancelada: 'solicitud.cancelada',
  solicitudFormulario: 'solicitud.formulario',
  tareaDecision: 'tarea.decision',
  tareaReasignada: 'tarea.reasignada',
  firmantesCambiados: 'solicitud.firmantes',
  notaAgregada: 'solicitud.nota',
  adjuntoCargado: 'solicitud.adjunto',
  adjuntoRetirado: 'solicitud.adjunto_retirado',
  adjuntoDescarga: 'solicitud.adjunto_descarga',
  // Sprint 3: firma electrónica propia, PDF controlado, Calidad y borrador en la app.
  firmaRegistrada: 'firma.registrada',
  firmaReautenticacionFallida: 'firma.reautenticacion_fallida',
  firmaRechazada: 'firma.rechazada',
  firmaConsentimiento: 'firma.consentimiento',
  firmaMaestroRegistrado: 'firma.maestro_registrado',
  firmaMaestroRevocado: 'firma.maestro_revocado',
  chequeoCalidad: 'calidad.chequeo',
  pdfControladoGenerado: 'documento.pdf_controlado',
  pdfControladoError: 'documento.pdf_controlado_error',
  pdfControladoVerificado: 'documento.pdf_verificado',
  borradorGuardado: 'solicitud.borrador_guardado',
  reporteAuditoria: 'documento.reporte_auditoria',
} as const;

export type SgcAuditAction = (typeof SGC_AUDIT_ACTIONS)[keyof typeof SGC_AUDIT_ACTIONS];

export interface SgcAuditEntry {
  idCompany: number | null;
  actorEmail: string | null;
  action: SgcAuditAction;
  entity: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  detail?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export type SgcAuditDb = Pick<PrismaClient, 'sgcAuditLog'>;

const MAX_DETAIL = 1000;

function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

/** Fila lista para insertar (pura; se prueba sin base). */
export function buildAuditRow(entry: SgcAuditEntry) {
  return {
    id_company: entry.idCompany,
    actor_email: entry.actorEmail,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId),
    ip: entry.ip ?? null,
    user_agent: entry.userAgent ?? null,
    before_json: toJson(entry.before),
    after_json: toJson(entry.after),
    detail: entry.detail ? entry.detail.slice(0, MAX_DETAIL) : null,
  };
}

/** Origen (IP/navegador) de la petición, para adjuntarlo a la entrada. */
export function auditOrigin(request: Request): { ip: string | null; userAgent: string | null } {
  const { clientIp, userAgent } = readClientOrigin(request);
  return { ip: clientIp, userAgent };
}

/** Inserta la entrada de auditoría. */
export async function writeSgcAudit(db: SgcAuditDb, entry: SgcAuditEntry): Promise<void> {
  await db.sgcAuditLog.create({ data: buildAuditRow(entry) });
}
