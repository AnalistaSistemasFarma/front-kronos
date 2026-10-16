import { SGC_SUBPROCESS_URLS } from '../constants';
import { resolveElaborator, type SgcElaboratorChoice } from '../flows/elaborator';
import { suggestResponsibles } from '../flows/matrix';
import type { SgcDb } from './catalogs';
import { listMatrix } from './matrix';

/**
 * Carga lo que necesita resolveElaborator (lib/sgc/flows/elaborator.ts): la
 * matriz de responsables (rol elaborador, sin filas de ejemplo), las personas
 * de los cargos que nombra, quiénes tienen Calidad y la carga de cada
 * candidato. Solo lectura; sin migración (usa tablas que ya existen).
 */

const low = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

export interface SgcElaboratorResolution {
  choice: SgcElaboratorChoice | null;
  /** «proceso GC × tipo PR», «proceso GC», «tipo PR» o «general de la empresa» (nivel de la matriz que decidió). */
  matrixLabel: string | null;
}

export async function resolveElaboratorFor(
  db: SgcDb,
  idCompany: number,
  target: { idProcess: number | null; idDocumentType: number | null },
  opts: { requesterEmail: string; eligible: ReadonlySet<string>; requireQuality: boolean }
): Promise<SgcElaboratorResolution> {
  const rows = (await listMatrix(db, idCompany)).filter((r) => !r.isExample);
  const sug = suggestResponsibles(rows, target).find((s) => s.role === 'elaborador');
  const cargoPeople: string[] = [];
  if (sug && sug.cargos.length) {
    const cargos = await db.cargo.findMany({ where: { nombre_normalizado: { in: sug.cargos } }, select: { id_cargo: true, nombre_normalizado: true } });
    const order = new Map(sug.cargos.map((c, i) => [c.toLowerCase(), i]));
    const ids = cargos.sort((a, b) => (order.get(a.nombre_normalizado.toLowerCase()) ?? 0) - (order.get(b.nombre_normalizado.toLowerCase()) ?? 0)).map((c) => c.id_cargo);
    if (ids.length) {
      const members = await db.sgcCargoMember.findMany({ where: { id_company: idCompany, id_cargo: { in: ids }, is_active: true }, select: { id_cargo: true, user_email: true } });
      for (const id of ids) for (const m of members.filter((x) => x.id_cargo === id).sort((a, b) => low(a.user_email).localeCompare(low(b.user_email)))) cargoPeople.push(low(m.user_email));
    }
  }
  const matrixPeople = [...(sug?.people ?? []), ...cargoPeople];
  const qualityRows = await db.subprocessUserCompany.findMany({
    where: { subprocess: { subprocess_url: SGC_SUBPROCESS_URLS.calidad }, companyUser: { company: { id_company: idCompany }, user: { isActive: true } } },
    select: { companyUser: { select: { user: { select: { email: true } } } } },
  });
  const quality = new Set(qualityRows.map((r) => low(r.companyUser.user.email)).filter(Boolean));
  const candidates = [...new Set([...matrixPeople.map(low), ...quality])].filter(Boolean);
  const loadRows = candidates.length
    ? await db.sgcRequest.groupBy({ by: ['elaborator_email'], where: { id_company: idCompany, status: { in: ['abierta', 'en_espera'] }, elaborator_email: { in: candidates } }, _count: { _all: true } })
    : [];
  const openLoad = new Map(loadRows.map((r) => [low(r.elaborator_email), r._count._all]));
  const choice = resolveElaborator({ requesterEmail: opts.requesterEmail, matrixPeople, eligible: opts.eligible, quality, requireQuality: opts.requireQuality, openLoad });

  let matrixLabel: string | null = null;
  if (choice?.source === 'matriz' && sug) {
    const any = rows.find((r) => r.role === 'elaborador' && r.isActive && (r.idProcess === null || r.idProcess === target.idProcess) && (r.idDocumentType === null || r.idDocumentType === target.idDocumentType) && (r.idProcess !== null ? 2 : 0) + (r.idDocumentType !== null ? 1 : 0) === sug.specificity);
    matrixLabel =
      sug.specificity === 3 ? `proceso ${any?.processCode ?? ''} × tipo ${any?.documentTypeCode ?? ''}` : sug.specificity === 2 ? `proceso ${any?.processCode ?? ''}` : sug.specificity === 1 ? `tipo ${any?.documentTypeCode ?? ''}` : 'general de la empresa';
  }
  return { choice, matrixLabel };
}
