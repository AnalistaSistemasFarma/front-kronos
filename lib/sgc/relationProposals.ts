import { inheritsParentNumber, parseChildSequence, type SgcCodingGuideInput } from './coding';
import type { SgcRelationType } from './relations';

/**
 * «RELACIONAR DOCUMENTOS» (Sprint 9, socialización con Calidad OLP del
 * 2026-10-07) — funciones PURAS.
 *
 * Con el listado maestro cargado, el sistema PROPONE las relaciones por el
 * número del código (OLP-GCC-02 → sus formatos e instructivos) y Calidad las
 * confirma una por una o en bloque. Fuentes de la propuesta, en este orden:
 *   1. «listado»: el «Código del documento padre» que trae el Excel.
 *   2. «codigo»:  la guía de codificación con herencia (si está configurada).
 *   3. «codigo»:  el código del hijo empieza por el del padre seguido de un
 *                 separador (OLP-GCC-02-FO01 → OLP-GCC-02), cuando el padre no
 *                 es de un tipo que hereda.
 * Nunca se propone lo que ya está relacionado (en cualquier sentido o tipo).
 */

export interface SgcProposalDoc {
  id: number;
  code: string;
  status: string;
  documentTypeCode: string;
  processTypeCode: string;
  processCode: string;
}

export interface SgcRelationProposal {
  idSource: number;
  idTarget: number;
  type: SgcRelationType;
  origin: 'listado' | 'codigo';
  /** Por qué se propone (texto para Calidad). */
  reason: string;
}

/**
 * Tipo de relación según el tipo documental del HIJO (configurable aquí):
 * un formato «es formato de» su procedimiento; un anexo «es anexo de»; el
 * resto (instructivos…) cuelga con «procedimiento padre» (padre → hijo).
 */
export const SGC_PROPOSAL_TYPE_BY_CHILD: Readonly<Record<string, SgcRelationType>> = { FO: 'formato', FR: 'formato', AN: 'anexo' };

/** Relación propuesta entre un padre y un hijo, con el sentido de su tipo. */
export function proposalFor(parent: SgcProposalDoc, child: SgcProposalDoc, origin: SgcRelationProposal['origin'], reason: string): SgcRelationProposal {
  const type = SGC_PROPOSAL_TYPE_BY_CHILD[child.documentTypeCode.toUpperCase()] ?? 'procedimiento_padre';
  // «formato» y «anexo» se leen desde el hijo («A es formato de B»); «procedimiento padre», desde el padre.
  return type === 'procedimiento_padre'
    ? { idSource: parent.id, idTarget: child.id, type, origin, reason }
    : { idSource: child.id, idTarget: parent.id, type, origin, reason };
}

const SEP = /^[-._\s]/;

/**
 * Propuestas para la empresa. `listParents` = código del padre que dio el
 * listado maestro por documento; `related` = pares ya relacionados
 * («idA:idB» con idA < idB). Solo documentos que no están anulados.
 */
export function proposeRelations(
  docs: readonly SgcProposalDoc[],
  opts: { guide: SgcCodingGuideInput | null; listParents: ReadonlyMap<number, string>; related: ReadonlySet<string> }
): SgcRelationProposal[] {
  const live = docs.filter((d) => d.status !== 'anulado');
  const byCode = new Map(live.map((d) => [d.code.toUpperCase(), d]));
  const seen = new Set(opts.related);
  const out: SgcRelationProposal[] = [];
  const push = (parent: SgcProposalDoc, child: SgcProposalDoc, origin: SgcRelationProposal['origin'], reason: string) => {
    if (parent.id === child.id) return;
    const key = pairKey(parent.id, child.id);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(proposalFor(parent, child, origin, reason));
  };
  for (const child of live) {
    const listed = opts.listParents.get(child.id);
    const parent = listed ? byCode.get(listed.toUpperCase()) : undefined;
    if (parent) push(parent, child, 'listado', `El listado maestro indica que ${child.code} se desprende de ${parent.code}.`);
  }
  for (const child of live) {
    for (const parent of live) {
      if (parent.id === child.id || seen.has(pairKey(parent.id, child.id))) continue;
      const g = opts.guide;
      const childParts = { processTypeCode: child.processTypeCode, processCode: child.processCode, documentTypeCode: child.documentTypeCode };
      if (g && inheritsParentNumber(g, child.documentTypeCode) && !inheritsParentNumber(g, parent.documentTypeCode)) {
        let follows = false;
        try {
          follows = parseChildSequence(g, childParts, { code: parent.code, parts: { processTypeCode: parent.processTypeCode, processCode: parent.processCode, documentTypeCode: parent.documentTypeCode } }, child.code) !== null;
        } catch {
          follows = false;
        }
        if (follows) {
          push(parent, child, 'codigo', `${child.code} hereda el número de ${parent.code} (guía de codificación).`);
          continue;
        }
      }
      const parentIsChildType = g ? inheritsParentNumber(g, parent.documentTypeCode) : false;
      const pc = parent.code.toUpperCase();
      const cc = child.code.toUpperCase();
      if (!parentIsChildType && cc.length > pc.length + 1 && cc.startsWith(pc) && SEP.test(cc.slice(pc.length)) && longestPrefixParent(cc, live) === parent.id) {
        push(parent, child, 'codigo', `El código ${child.code} empieza por el de ${parent.code}.`);
      }
    }
  }
  return out;
}

/** Par sin sentido («menor:mayor»). */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Entre los documentos cuyo código es prefijo del hijo, el de código más largo (el padre inmediato). */
function longestPrefixParent(childCode: string, docs: readonly SgcProposalDoc[]): number | null {
  let best: SgcProposalDoc | null = null;
  for (const d of docs) {
    const c = d.code.toUpperCase();
    if (c.length < childCode.length - 1 && childCode.startsWith(c) && SEP.test(childCode.slice(c.length)) && (!best || c.length > best.code.length)) best = d;
  }
  return best?.id ?? null;
}
