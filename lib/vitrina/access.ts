import 'server-only';
import type { PrismaClient } from '../../app/generated/prisma';
import { VITRINA_SUBPROCESS_URLS } from './constants';
import { resolveVitrinaAccess, type VitrinaCompanyAccess } from './rules';

/**
 * Permisos de la Vitrina Comercial, con el patrón de SynerLink: subproceso ×
 * company_user (subprocess_user_company). Sin roles nuevos:
 *   - «Vitrina Comercial»            (/process/vitrina)          → consulta en ESA empresa;
 *   - «Vitrina Comercial · Gestión»  (/process/vitrina/gestion)  → administra ESA empresa.
 * Igual que Bitácora de Proceso: el usuario debe estar activo.
 */
export type VitrinaDb = PrismaClient;

export async function getVitrinaAccessForUser(db: VitrinaDb, email: string): Promise<VitrinaCompanyAccess[]> {
  const grants = await db.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email, isActive: true } },
      subprocess: { subprocess_url: { in: Object.values(VITRINA_SUBPROCESS_URLS) } },
    },
    select: {
      subprocess: { select: { subprocess_url: true } },
      companyUser: { select: { company: { select: { id_company: true, company: true } } } },
    },
  });
  return resolveVitrinaAccess(
    grants.map((g) => ({
      subprocessUrl: g.subprocess.subprocess_url,
      idCompany: g.companyUser.company.id_company,
      companyName: g.companyUser.company.company,
    }))
  );
}

export async function getActiveUserId(db: VitrinaDb, email: string): Promise<string | null> {
  const u = await db.user.findFirst({ where: { email, isActive: true }, select: { id: true } });
  return u?.id ?? null;
}

/** Endpoint SAP de una empresa (credenciales de sap_endpoints). SOLO servidor: nunca al navegador. */
export interface VitrinaSapEndpoint {
  baseUrl: string;
  username: string;
  password: string;
  companyDB: string;
  /** UDO de registros sanitarios (p. ej. FAR_RegiSanitario); null = la empresa no lo tiene mapeado. */
  healthRecordsEntity: string | null;
}

/**
 * Endpoint ACTIVO de la empresa (mismo criterio que Artículos y Registros Sanitarios:
 * el activo, o el primero). Cada empresa lee SU propio SAP: Farmalógica el de la
 * empresa 1 y Ryan el de la empresa 2. null si no está configurado.
 */
export async function getCompanySapEndpoint(db: VitrinaDb, idCompany: number): Promise<VitrinaSapEndpoint | null> {
  const eps = await db.sap_endpoints.findMany({ where: { id_company: idCompany }, orderBy: { id_sap_endpoint: 'asc' } });
  const ep = eps.find((e) => e.is_active) ?? eps[0] ?? null;
  if (!ep || !ep.base_url || !ep.client) return null;
  return {
    baseUrl: ep.base_url,
    username: ep.username ?? '',
    password: ep.password ?? '',
    companyDB: ep.client,
    healthRecordsEntity: ep.health_records_entity?.trim() || null,
  };
}
