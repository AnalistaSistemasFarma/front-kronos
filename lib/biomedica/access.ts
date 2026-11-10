import type { PrismaClient } from '../../app/generated/prisma';
import { getSgcAccessForUser, type SgcAccessDb } from '../sgc/access';

/**
 * Acceso al módulo de INGENIERÍA BIOMÉDICA (2026-11-06). Solo los ingenieros
 * biomédicos (permiso «SGC · Ingeniería biomédica») y Aseguramiento de Calidad
 * del SGC; nadie más (reunión con Juan Mora, 2026-11-05). Solo en empresas con
 * el SGC activo (el módulo diligencia los formatos vigentes del SGC).
 */
export const BIOMED_SUBPROCESS_URL = '/process/sgc-documental/biomedica';
export const BIOMED_SUBPROCESS_NAME = 'SGC · Ingeniería biomédica';

export interface BiomedAccess {
  idCompany: number;
  companyName: string;
  /** Diligencia formatos. */
  canUse: boolean;
  /** Elige qué formatos del SGC usa el módulo (Aseguramiento de Calidad). */
  canConfigure: boolean;
}

export type BiomedAccessDb = SgcAccessDb & Pick<PrismaClient, 'subprocessUserCompany'>;

export async function getBiomedAccessForUser(db: BiomedAccessDb, email: string): Promise<BiomedAccess[]> {
  const [sgc, grants] = await Promise.all([
    getSgcAccessForUser(db, email),
    db.subprocessUserCompany.findMany({
      where: { companyUser: { user: { email, isActive: true } }, subprocess: { subprocess_url: BIOMED_SUBPROCESS_URL } },
      select: { companyUser: { select: { company: { select: { id_company: true } } } } },
    }),
  ]);
  const engineer = new Set(grants.map((g) => g.companyUser.company.id_company));
  return sgc
    .filter((a) => a.canRead && (a.canQuality || engineer.has(a.idCompany)))
    .map((a) => ({ idCompany: a.idCompany, companyName: a.companyName, canUse: true, canConfigure: a.canQuality }));
}
